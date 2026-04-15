import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, tenants, payments, enrollments, subscriptions } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { getStripe } from "./stripe.ts";
import { tenantIdStore } from "./tenant-context.ts";

async function requireStudent() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");
  const user = session.user as { id: string; role: string };
  const tenantId = tenantIdStore.getStore()!;
  return { user: { ...user, tenantId }, request };
}

async function requireAdmin() {
  const { user, request } = await requireStudent();
  if (!["tenant_owner", "tenant_admin"].includes(user.role)) {
    throw new Error("Forbidden");
  }
  return { user, request };
}

/**
 * Create a Stripe Checkout Session for a one-time course purchase.
 * Uses Stripe Connect with destination charge and platform application fee.
 */
export const createCheckoutSessionFn = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string; promotionCodeId?: string }) => d)
  .handler(async ({ data }) => {
    const { user, request } = await requireStudent();

    // Load course (must be published and belong to user's tenant)
    const [course] = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.id, data.courseId),
          eq(courses.tenantId, user.tenantId),
          eq(courses.status, "published"),
        ),
      );
    if (!course) throw new Error("Course not found");
    if (!course.price || Number(course.price) <= 0) {
      throw new Error("Course has no price set");
    }

    // Check if already enrolled
    const [existing] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, user.id),
          eq(enrollments.courseId, course.id),
          isNull(enrollments.revokedAt),
        ),
      );
    if (existing) throw new Error("Already enrolled in this course");

    // Load tenant to get Stripe Connect account
    const [tenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        subdomain: tenants.subdomain,
        stripeConnectAccountId: tenants.stripeConnectAccountId,
        planId: tenants.planId,
      })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId));
    if (!tenant) throw new Error("Tenant not found");
    if (!tenant.stripeConnectAccountId) {
      throw new Error("Instructor has not connected Stripe");
    }

    // Calculate application fee from plan (default 10% if no plan)
    let applicationFeePercent = 10;
    if (tenant.planId) {
      const { plans } = await import("#/db/schema/index.ts");
      const [plan] = await db
        .select({ applicationFeePercent: plans.applicationFeePercent })
        .from(plans)
        .where(eq(plans.id, tenant.planId));
      if (plan?.applicationFeePercent) {
        applicationFeePercent = Number(plan.applicationFeePercent);
      }
    }

    const amountInCents = Math.round(Number(course.price) * 100);
    const applicationFeeAmount = Math.round(amountInCents * (applicationFeePercent / 100));

    // Build success/cancel URLs from request origin
    const origin =
      request.headers.get("origin") ??
      `${request.headers.get("x-forwarded-proto") ?? "http"}://${request.headers.get("host")}`;

    const stripe = getStripe();
    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: course.title,
              description: course.description ?? undefined,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
        transfer_data: {
          destination: tenant.stripeConnectAccountId,
        },
      },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout/cancel`,
      metadata: {
        tenantId: tenant.id,
        courseId: course.id,
        userId: user.id,
      },
    };

    if (data.promotionCodeId) {
      sessionParams.discounts = [{ promotion_code: data.promotionCodeId }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return { url: session.url };
  });

/**
 * Look up a completed checkout session and return its details.
 * Used by the success page to confirm the purchase.
 */
export const getCheckoutResultFn = createServerFn({ method: "GET" })
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data }) => {
    const { user } = await requireStudent();

    // Find the payment record matching this session
    const [payment] = await db
      .select({
        id: payments.id,
        courseId: payments.courseId,
        amount: payments.amount,
        currency: payments.currency,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(
        and(
          eq(payments.stripeCheckoutSessionId, data.sessionId),
          eq(payments.userId, user.id),
          eq(payments.tenantId, user.tenantId),
        ),
      );

    if (!payment || !payment.courseId) {
      return { status: "pending" as const };
    }

    // Grab course title for display
    const [course] = await db
      .select({ title: courses.title, slug: courses.slug })
      .from(courses)
      .where(eq(courses.id, payment.courseId));

    return {
      status: "complete" as const,
      courseName: course?.title ?? "Course",
      courseSlug: course?.slug ?? "",
      amount: payment.amount,
      currency: payment.currency,
    };
  });

/**
 * Create a Stripe Checkout Session for a monthly subscription.
 * Subscription gives access to all published courses for the tenant.
 * Uses Stripe Connect with application_fee_percent for recurring billing.
 */
export const createSubscriptionCheckoutFn = createServerFn({ method: "POST" })
  .inputValidator((d: { promotionCodeId?: string }) => d)
  .handler(async ({ data }) => {
    const { user, request } = await requireStudent();

    // Check if already has an active subscription
    const [existingSub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, user.id),
          eq(subscriptions.tenantId, user.tenantId),
          eq(subscriptions.status, "active"),
        ),
      );
    if (existingSub) throw new Error("Already have an active subscription");

    // Load tenant to get Stripe Connect account + subscription price
    const [tenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        subdomain: tenants.subdomain,
        stripeConnectAccountId: tenants.stripeConnectAccountId,
        subscriptionPrice: tenants.subscriptionPrice,
        planId: tenants.planId,
      })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId));
    if (!tenant) throw new Error("Tenant not found");
    if (!tenant.stripeConnectAccountId) {
      throw new Error("Instructor has not connected Stripe");
    }
    if (!tenant.subscriptionPrice || Number(tenant.subscriptionPrice) <= 0) {
      throw new Error("Subscription pricing not configured");
    }

    // Calculate application fee percentage from plan (default 10%)
    let applicationFeePercent = 10;
    if (tenant.planId) {
      const { plans } = await import("#/db/schema/index.ts");
      const [plan] = await db
        .select({ applicationFeePercent: plans.applicationFeePercent })
        .from(plans)
        .where(eq(plans.id, tenant.planId));
      if (plan?.applicationFeePercent) {
        applicationFeePercent = Number(plan.applicationFeePercent);
      }
    }

    const amountInCents = Math.round(Number(tenant.subscriptionPrice) * 100);

    const origin =
      request.headers.get("origin") ??
      `${request.headers.get("x-forwarded-proto") ?? "http"}://${request.headers.get("host")}`;

    const stripe = getStripe();
    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${tenant.name} — Monthly Access`,
              description: "Monthly subscription for access to all courses",
            },
            unit_amount: amountInCents,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        application_fee_percent: applicationFeePercent,
        transfer_data: {
          destination: tenant.stripeConnectAccountId,
        },
        metadata: {
          tenantId: tenant.id,
          userId: user.id,
        },
      },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
      cancel_url: `${origin}/checkout/cancel`,
      metadata: {
        tenantId: tenant.id,
        userId: user.id,
        type: "subscription",
      },
    };

    if (data?.promotionCodeId) {
      sessionParams.discounts = [{ promotion_code: data.promotionCodeId }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return { url: session.url };
  });

/**
 * Cancel the current user's active subscription.
 * Sets subscription to cancel at period end (graceful cancellation).
 */
export const cancelSubscriptionFn = createServerFn({ method: "POST" }).handler(async () => {
  const { user } = await requireStudent();

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, user.id),
        eq(subscriptions.tenantId, user.tenantId),
        eq(subscriptions.status, "active"),
      ),
    );
  if (!sub) throw new Error("No active subscription");

  const stripe = getStripe();
  // Cancel at period end — student keeps access until period expires
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await db
    .update(subscriptions)
    .set({ canceledAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  return { canceledAt: new Date().toISOString(), periodEnd: sub.currentPeriodEnd?.toISOString() };
});

/**
 * Get the current user's subscription status for the current tenant.
 */
export const getSubscriptionStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const { user } = await requireStudent();

  const [sub] = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      canceledAt: subscriptions.canceledAt,
    })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.tenantId, user.tenantId)));

  if (!sub) return { hasSubscription: false as const };

  return {
    hasSubscription: true as const,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    canceledAt: sub.canceledAt?.toISOString() ?? null,
  };
});

/**
 * Set subscription pricing for the tenant (instructor only).
 */
export const setSubscriptionPriceFn = createServerFn({ method: "POST" })
  .inputValidator((d: { price: string | null }) => d)
  .handler(async ({ data }) => {
    const { user } = await requireAdmin();

    await db
      .update(tenants)
      .set({ subscriptionPrice: data.price })
      .where(eq(tenants.id, user.tenantId));

    return { success: true };
  });

/**
 * Get subscription pricing for the tenant (instructor only).
 */
export const getSubscriptionPriceFn = createServerFn({ method: "GET" }).handler(async () => {
  const { user } = await requireAdmin();

  const [tenant] = await db
    .select({ subscriptionPrice: tenants.subscriptionPrice })
    .from(tenants)
    .where(eq(tenants.id, user.tenantId));

  return { subscriptionPrice: tenant?.subscriptionPrice ?? null };
});
