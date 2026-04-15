import "@tanstack/react-start/server-only";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  payments,
  enrollments,
  subscriptions,
  courses,
  tenants,
  users,
  userTenants,
} from "#/db/schema/index.ts";
import { assertCanAddStudent } from "./plans.ts";
import { getStripe } from "./stripe.ts";
import { sendJob } from "./job-queue.ts";
import { enqueuePurchaseConfirmation, enqueueEnrollmentConfirmation } from "./email-jobs.ts";
import { dispatchTenantWebhookEvent } from "./webhook-delivery-jobs.ts";

// ---------------------------------------------------------------------------
// Webhook event types we handle
// ---------------------------------------------------------------------------

export const WEBHOOK_JOB_NAME = "process_stripe_webhook";

export interface WebhookJobData {
  type: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Dispatch webhook event to background job queue
// ---------------------------------------------------------------------------

export async function dispatchWebhookEvent(
  type: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  return sendJob<WebhookJobData>(WEBHOOK_JOB_NAME, { type, data });
}

// ---------------------------------------------------------------------------
// Process webhook events
// ---------------------------------------------------------------------------

export async function processWebhookEvent(event: WebhookJobData): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data);
      break;
    case "charge.refunded":
      await handleChargeRefunded(event.data);
      break;
    case "customer.subscription.created":
      await handleSubscriptionCreated(event.data);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data);
      break;
    default:
      // Ignore unhandled event types
      break;
  }
}

// ---------------------------------------------------------------------------
// checkout.session.completed → create payment + enrollment + emails
// ---------------------------------------------------------------------------

async function handleCheckoutSessionCompleted(data: Record<string, unknown>): Promise<void> {
  const metadata = data.metadata as {
    tenantId: string;
    courseId: string;
    userId: string;
  };
  if (!metadata?.tenantId || !metadata?.courseId || !metadata?.userId) {
    throw new Error("Missing metadata in checkout session");
  }

  const sessionId = data.id as string;
  const paymentIntentId = data.payment_intent as string | undefined;
  const amountTotal = data.amount_total as number; // in cents
  const currency = (data.currency as string) ?? "usd";

  // Idempotency: skip if payment record already exists for this session
  const [existingPayment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.stripeCheckoutSessionId, sessionId));
  if (existingPayment) return;

  // Double-check plan student limit — if exceeded by race condition, auto-refund
  try {
    await assertCanAddStudent(metadata.tenantId);
  } catch {
    // Plan limit exceeded — refund the payment and abort
    if (paymentIntentId) {
      try {
        const stripe = getStripe();
        await stripe.refunds.create({ payment_intent: paymentIntentId });
      } catch {
        // Log but don't throw — we still want to avoid creating the enrollment
      }
    }
    return;
  }

  // Create payment record
  const amountDecimal = (amountTotal / 100).toFixed(2);
  await db.insert(payments).values({
    tenantId: metadata.tenantId,
    userId: metadata.userId,
    courseId: metadata.courseId,
    amount: amountDecimal,
    currency,
    stripePaymentIntentId: paymentIntentId ?? null,
    stripeCheckoutSessionId: sessionId,
  });

  // Create student membership if not already a member (idempotent upsert)
  const [existingMembership] = await db
    .select({ userId: userTenants.userId })
    .from(userTenants)
    .where(
      and(
        eq(userTenants.userId, metadata.userId),
        eq(userTenants.tenantId, metadata.tenantId),
      ),
    );

  if (!existingMembership) {
    await db.insert(userTenants).values({
      userId: metadata.userId,
      tenantId: metadata.tenantId,
      role: "student",
    });
  }

  // Create enrollment (skip if already enrolled — handles re-enrollment edge case)
  const [existingEnrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, metadata.userId),
        eq(enrollments.courseId, metadata.courseId),
        isNull(enrollments.revokedAt),
      ),
    );

  if (!existingEnrollment) {
    await db.insert(enrollments).values({
      tenantId: metadata.tenantId,
      userId: metadata.userId,
      courseId: metadata.courseId,
    });

    // Dispatch enrollment.created webhook (best-effort)
    try {
      await dispatchTenantWebhookEvent(metadata.tenantId, "enrollment.created", {
        userId: metadata.userId,
        courseId: metadata.courseId,
      });
    } catch {
      // Webhook dispatch failure should not break payment processing
    }
  }

  // Dispatch payment.completed webhook (best-effort)
  try {
    await dispatchTenantWebhookEvent(metadata.tenantId, "payment.completed", {
      userId: metadata.userId,
      courseId: metadata.courseId,
      amount: amountDecimal,
      currency,
    });
  } catch {
    // Webhook dispatch failure should not break payment processing
  }

  // Queue confirmation emails (best-effort — don't fail the webhook)
  try {
    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, metadata.userId));
    const [course] = await db
      .select({ title: courses.title, slug: courses.slug })
      .from(courses)
      .where(eq(courses.id, metadata.courseId));
    const [tenant] = await db
      .select({ name: tenants.name, subdomain: tenants.subdomain })
      .from(tenants)
      .where(eq(tenants.id, metadata.tenantId));

    if (user && course && tenant) {
      await enqueuePurchaseConfirmation({
        to: user.email,
        studentName: user.name,
        courseName: course.title,
        amount: amountDecimal,
        currency,
        schoolName: tenant.name,
      });

      await enqueueEnrollmentConfirmation({
        to: user.email,
        studentName: user.name,
        courseName: course.title,
        schoolName: tenant.name,
        courseUrl: `https://${tenant.subdomain}.platform.com/courses/${course.slug}`,
      });
    }
  } catch {
    // Email failures should not break payment processing
  }
}

// ---------------------------------------------------------------------------
// charge.refunded → revoke enrollment
// ---------------------------------------------------------------------------

async function handleChargeRefunded(data: Record<string, unknown>): Promise<void> {
  const paymentIntentId = data.payment_intent as string | undefined;
  if (!paymentIntentId) {
    throw new Error("Missing payment_intent in charge.refunded event");
  }

  // Find the payment record by payment intent ID
  const [payment] = await db
    .select({
      id: payments.id,
      userId: payments.userId,
      courseId: payments.courseId,
      tenantId: payments.tenantId,
    })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, paymentIntentId));

  if (!payment || !payment.courseId) return;

  // Revoke enrollment by setting revokedAt timestamp
  await db
    .update(enrollments)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(enrollments.userId, payment.userId),
        eq(enrollments.courseId, payment.courseId),
        isNull(enrollments.revokedAt),
      ),
    );

  // Dispatch webhook events (best-effort)
  try {
    await dispatchTenantWebhookEvent(payment.tenantId, "payment.refunded", {
      userId: payment.userId,
      courseId: payment.courseId,
    });
    await dispatchTenantWebhookEvent(payment.tenantId, "enrollment.revoked", {
      userId: payment.userId,
      courseId: payment.courseId,
    });
  } catch {
    // Webhook dispatch failure should not break refund processing
  }
}

// ---------------------------------------------------------------------------
// customer.subscription.created → create subscription record
// ---------------------------------------------------------------------------

async function handleSubscriptionCreated(data: Record<string, unknown>): Promise<void> {
  const subscriptionId = data.id as string;
  const metadata = data.metadata as {
    tenantId?: string;
    userId?: string;
  };
  if (!metadata?.tenantId || !metadata?.userId) {
    throw new Error("Missing metadata in subscription");
  }

  const status = data.status as string;
  const currentPeriod = data.current_period_start as number | undefined;
  const currentPeriodEnd = data.current_period_end as number | undefined;

  // Idempotency: skip if subscription record already exists
  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
  if (existing) return;

  // Create student membership if not already a member
  const [existingMembership] = await db
    .select({ userId: userTenants.userId })
    .from(userTenants)
    .where(
      and(
        eq(userTenants.userId, metadata.userId),
        eq(userTenants.tenantId, metadata.tenantId),
      ),
    );

  if (!existingMembership) {
    await db.insert(userTenants).values({
      userId: metadata.userId,
      tenantId: metadata.tenantId,
      role: "student",
    });
  }

  await db.insert(subscriptions).values({
    tenantId: metadata.tenantId,
    userId: metadata.userId,
    stripeSubscriptionId: subscriptionId,
    status: mapSubscriptionStatus(status),
    currentPeriodStart: currentPeriod ? new Date(currentPeriod * 1000) : null,
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
  });

  // Dispatch subscription.created webhook (best-effort)
  try {
    await dispatchTenantWebhookEvent(metadata.tenantId, "subscription.created", {
      userId: metadata.userId,
      stripeSubscriptionId: subscriptionId,
    });
  } catch {
    // Webhook dispatch failure should not break subscription processing
  }
}

// ---------------------------------------------------------------------------
// customer.subscription.updated → update status + period
// ---------------------------------------------------------------------------

async function handleSubscriptionUpdated(data: Record<string, unknown>): Promise<void> {
  const subscriptionId = data.id as string;
  const status = data.status as string;
  const currentPeriodEnd = data.current_period_end as number | undefined;
  const cancelAt = data.cancel_at as number | null | undefined;
  const canceledAt = data.canceled_at as number | null | undefined;

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));

  if (!existing) {
    // Subscription not in our DB — might be from a different source; ignore
    return;
  }

  await db
    .update(subscriptions)
    .set({
      status: mapSubscriptionStatus(status),
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : undefined,
      canceledAt: canceledAt
        ? new Date(canceledAt * 1000)
        : cancelAt
          ? new Date(cancelAt * 1000)
          : undefined,
    })
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted → mark subscription canceled
// ---------------------------------------------------------------------------

async function handleSubscriptionDeleted(data: Record<string, unknown>): Promise<void> {
  const subscriptionId = data.id as string;

  // Look up subscription before updating to get tenantId/userId for webhook
  const [sub] = await db
    .select({ tenantId: subscriptions.tenantId, userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));

  await db
    .update(subscriptions)
    .set({
      status: "canceled",
      canceledAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));

  // Dispatch subscription.canceled webhook (best-effort)
  if (sub) {
    try {
      await dispatchTenantWebhookEvent(sub.tenantId, "subscription.canceled", {
        userId: sub.userId,
        stripeSubscriptionId: subscriptionId,
      });
    } catch {
      // Webhook dispatch failure should not break subscription processing
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSubscriptionStatus(
  stripeStatus: string,
): "active" | "canceled" | "past_due" | "incomplete" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "canceled":
      return "canceled";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return "incomplete";
  }
}
