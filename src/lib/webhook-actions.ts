import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  payments,
  enrollments,
  courses,
  tenants,
  users,
} from "#/db/schema/index.ts";
import { sendJob } from "./job-queue.ts";
import {
  enqueuePurchaseConfirmation,
  enqueueEnrollmentConfirmation,
} from "./email-jobs.ts";

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
    default:
      // Ignore unhandled event types
      break;
  }
}

// ---------------------------------------------------------------------------
// checkout.session.completed → create payment + enrollment + emails
// ---------------------------------------------------------------------------

async function handleCheckoutSessionCompleted(
  data: Record<string, unknown>,
): Promise<void> {
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

async function handleChargeRefunded(
  data: Record<string, unknown>,
): Promise<void> {
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
}
