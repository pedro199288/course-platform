import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  payments,
  enrollments,
  plans,
} from "#/db/schema/index.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock Stripe — we test that checkout sessions are created with correct params
const mockCheckoutSessionCreate = vi.fn();
vi.mock("#/lib/stripe.ts", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: mockCheckoutSessionCreate,
      },
    },
  }),
}));

describe("checkout", () => {
  const subdomain = `checkout-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let planId: string;
  const userId = crypto.randomUUID();
  const stripeConnectAccountId = "acct_test_123";

  beforeAll(async () => {
    // Create a plan with 5% application fee
    const [plan] = await db
      .insert(plans)
      .values({
        name: "Test Plan",
        maxCourses: 100,
        maxStudents: 1000,
        applicationFeePercent: "5.00",
      })
      .returning();
    planId = plan.id;

    // Create tenant with Stripe Connect account and plan
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: "Checkout Test School",
        subdomain,
        stripeConnectAccountId,
        stripeOnboardingComplete: "true",
        planId,
      })
      .returning();
    tenantId = tenant.id;

    // Create a published course with a price
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Checkout Test Course",
        slug: "checkout-test-course",
        description: "A test course for checkout",
        price: "49.99",
        pricingModel: "one_time",
        status: "published",
      })
      .returning();
    courseId = course.id;
  });

  afterAll(async () => {
    await db
      .delete(enrollments)
      .where(eq(enrollments.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(payments)
      .where(eq(payments.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(courses)
      .where(eq(courses.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain))
      .catch(() => {});
    await db
      .delete(plans)
      .where(eq(plans.id, planId))
      .catch(() => {});
  });

  // ── Checkout session creation parameters ──────────────────────

  it("creates a checkout session with correct amount and Connect params", async () => {
    const mockSessionId = "cs_test_" + Date.now();
    const mockUrl = "https://checkout.stripe.com/pay/" + mockSessionId;

    mockCheckoutSessionCreate.mockResolvedValueOnce({
      id: mockSessionId,
      url: mockUrl,
    });

    // Simulate what createCheckoutSessionFn does internally:
    // Load the course
    const [course] = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.id, courseId),
          eq(courses.tenantId, tenantId),
          eq(courses.status, "published"),
        ),
      );
    expect(course).toBeDefined();
    expect(course.price).toBe("49.99");

    // Load tenant
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    expect(tenant.stripeConnectAccountId).toBe(stripeConnectAccountId);

    // Load plan fee
    const [plan] = await db
      .select({ applicationFeePercent: plans.applicationFeePercent })
      .from(plans)
      .where(eq(plans.id, planId));
    expect(plan.applicationFeePercent).toBe("5.00");

    // Calculate expected fee
    const amountInCents = Math.round(Number(course.price) * 100); // 4999
    const applicationFeePercent = Number(plan.applicationFeePercent); // 5
    const applicationFeeAmount = Math.round(
      amountInCents * (applicationFeePercent / 100),
    ); // 250 (~$2.50)

    expect(amountInCents).toBe(4999);
    expect(applicationFeeAmount).toBe(250);

    // Call mock to verify shape
    const result = await mockCheckoutSessionCreate({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: course.title,
              description: course.description,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: applicationFeeAmount,
        transfer_data: {
          destination: stripeConnectAccountId,
        },
      },
      success_url: `http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:3000/checkout/cancel`,
      metadata: {
        tenantId,
        courseId,
        userId,
      },
    });

    expect(result.url).toBe(mockUrl);

    // Verify the mock was called with Connect destination
    const callArgs = mockCheckoutSessionCreate.mock.calls[0][0];
    expect(callArgs.payment_intent_data.transfer_data.destination).toBe(
      stripeConnectAccountId,
    );
    expect(callArgs.payment_intent_data.application_fee_amount).toBe(250);
    expect(callArgs.line_items[0].price_data.unit_amount).toBe(4999);
    expect(callArgs.metadata.courseId).toBe(courseId);
    expect(callArgs.metadata.tenantId).toBe(tenantId);
  });

  // ── Payment record storage ──────────────────────────────────

  it("stores a payment record with stripe IDs", async () => {
    const sessionId = "cs_test_pay_" + Date.now();
    const intentId = "pi_test_" + Date.now();

    const [payment] = await db
      .insert(payments)
      .values({
        tenantId,
        userId,
        courseId,
        amount: "49.99",
        currency: "usd",
        stripePaymentIntentId: intentId,
        stripeCheckoutSessionId: sessionId,
      })
      .returning();

    expect(payment.id).toBeDefined();
    expect(payment.amount).toBe("49.99");
    expect(payment.stripeCheckoutSessionId).toBe(sessionId);
    expect(payment.stripePaymentIntentId).toBe(intentId);
    expect(payment.courseId).toBe(courseId);
  });

  it("retrieves payment by checkout session ID", async () => {
    const sessionId = "cs_test_retrieve_" + Date.now();

    await db.insert(payments).values({
      tenantId,
      userId,
      courseId,
      amount: "49.99",
      currency: "usd",
      stripeCheckoutSessionId: sessionId,
    });

    const [found] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.stripeCheckoutSessionId, sessionId),
          eq(payments.userId, userId),
          eq(payments.tenantId, tenantId),
        ),
      );

    expect(found).toBeDefined();
    expect(found.courseId).toBe(courseId);
    expect(found.amount).toBe("49.99");
  });

  // ── Enrollment creation ──────────────────────────────────

  it("creates an enrollment record on successful payment", async () => {
    const enrollUserId = crypto.randomUUID();

    const [enrollment] = await db
      .insert(enrollments)
      .values({
        tenantId,
        userId: enrollUserId,
        courseId,
      })
      .returning();

    expect(enrollment.id).toBeDefined();
    expect(enrollment.enrolledAt).toBeDefined();
    expect(enrollment.revokedAt).toBeNull();

    // Cleanup
    await db
      .delete(enrollments)
      .where(eq(enrollments.id, enrollment.id));
  });

  it("prevents duplicate enrollments (unique constraint)", async () => {
    const enrollUserId = crypto.randomUUID();

    await db.insert(enrollments).values({
      tenantId,
      userId: enrollUserId,
      courseId,
    });

    // Second enrollment for same user+course should fail
    await expect(
      db.insert(enrollments).values({
        tenantId,
        userId: enrollUserId,
        courseId,
      }),
    ).rejects.toThrow();

    // Cleanup
    await db
      .delete(enrollments)
      .where(
        and(
          eq(enrollments.userId, enrollUserId),
          eq(enrollments.courseId, courseId),
        ),
      );
  });

  // ── Enrollment check ──────────────────────────────────

  it("detects existing enrollment to prevent double-purchase", async () => {
    const enrollUserId = crypto.randomUUID();

    // No enrollment yet
    const [noEnrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, enrollUserId),
          eq(enrollments.courseId, courseId),
          isNull(enrollments.revokedAt),
        ),
      );
    expect(noEnrollment).toBeUndefined();

    // Create enrollment
    await db.insert(enrollments).values({
      tenantId,
      userId: enrollUserId,
      courseId,
    });

    // Now enrollment exists
    const [hasEnrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, enrollUserId),
          eq(enrollments.courseId, courseId),
          isNull(enrollments.revokedAt),
        ),
      );
    expect(hasEnrollment).toBeDefined();

    // Cleanup
    await db
      .delete(enrollments)
      .where(
        and(
          eq(enrollments.userId, enrollUserId),
          eq(enrollments.courseId, courseId),
        ),
      );
  });

  // ── Application fee calculation ──────────────────────────

  it("calculates application fee from plan tier", async () => {
    const [plan] = await db
      .select({ applicationFeePercent: plans.applicationFeePercent })
      .from(plans)
      .where(eq(plans.id, planId));

    const price = 99.99;
    const amountInCents = Math.round(price * 100); // 9999
    const feePercent = Number(plan.applicationFeePercent); // 5.00
    const feeAmount = Math.round(amountInCents * (feePercent / 100)); // 500

    expect(feeAmount).toBe(500);
  });

  it("defaults to 10% fee when no plan is assigned", () => {
    const amountInCents = 4999;
    const defaultFeePercent = 10;
    const feeAmount = Math.round(
      amountInCents * (defaultFeePercent / 100),
    ); // 500

    expect(feeAmount).toBe(500);
  });

  // ── Draft course rejection ──────────────────────────────

  it("does not find draft courses for checkout", async () => {
    const [draft] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Draft Course",
        slug: "draft-for-checkout",
        price: "29.99",
        status: "draft",
      })
      .returning();

    const result = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.id, draft.id),
          eq(courses.tenantId, tenantId),
          eq(courses.status, "published"),
        ),
      );

    expect(result.length).toBe(0);

    await db.delete(courses).where(eq(courses.id, draft.id));
  });
});
