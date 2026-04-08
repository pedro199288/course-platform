import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, tenants, payments, enrollments } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { getStripe } from "./stripe.ts";

async function requireStudent() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");
  const user = session.user as { id: string; role: string; tenantId: string };
  return { user, request };
}

/**
 * Create a Stripe Checkout Session for a one-time course purchase.
 * Uses Stripe Connect with destination charge and platform application fee.
 */
export const createCheckoutSessionFn = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string }) => d)
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
    const applicationFeeAmount = Math.round(
      amountInCents * (applicationFeePercent / 100),
    );

    // Build success/cancel URLs from request origin
    const origin =
      request.headers.get("origin") ??
      `${request.headers.get("x-forwarded-proto") ?? "http"}://${request.headers.get("host")}`;

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
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
    });

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
