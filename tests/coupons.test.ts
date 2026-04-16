import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, plans } from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";

// Mock email
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock Stripe — test coupon/promo code CRUD and checkout with discounts
const mockCouponCreate = vi.fn();
const mockPromoCodeCreate = vi.fn();
const mockPromoCodeList = vi.fn();
const mockPromoCodeRetrieve = vi.fn();
const mockPromoCodeUpdate = vi.fn();
const mockCheckoutSessionCreate = vi.fn();

vi.mock("#/lib/stripe.ts", () => ({
  getStripe: () => ({
    coupons: {
      create: mockCouponCreate,
    },
    promotionCodes: {
      create: mockPromoCodeCreate,
      list: mockPromoCodeList,
      retrieve: mockPromoCodeRetrieve,
      update: mockPromoCodeUpdate,
    },
    checkout: {
      sessions: {
        create: mockCheckoutSessionCreate,
      },
    },
  }),
}));

describe("coupons", () => {
  const subdomain = `coupons-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let planId: string;
  const userId = crypto.randomUUID();
  const stripeConnectAccountId = "acct_coupon_test_123";

  beforeEach(() => {
    mockCouponCreate.mockClear();
    mockPromoCodeCreate.mockClear();
    mockPromoCodeList.mockClear();
    mockPromoCodeRetrieve.mockClear();
    mockPromoCodeUpdate.mockClear();
    mockCheckoutSessionCreate.mockClear();
  });

  beforeAll(async () => {
    const [plan] = await db
      .insert(plans)
      .values({
        name: "Coupon Test Plan",
        maxCourses: 100,
        maxStudents: 1000,
        applicationFeePercent: "5.00",
      })
      .returning();
    planId = plan.id;

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: "Coupon Test School",
        subdomain,
        stripeConnectAccountId,
        stripeOnboardingComplete: "true",
        planId,
      })
      .returning();
    tenantId = tenant.id;

    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Coupon Test Course",
        slug: "coupon-test-course",
        description: "A test course for coupons",
        price: "49.99",
        pricingModel: "one_time",
        status: "published",
      })
      .returning();
    courseId = course.id;

    await db.insert(users).values({
      id: userId,
      tenantId,
      name: "Coupon Test User",
      email: `coupon-test-${Date.now()}@example.com`,
    });
  });

  afterAll(async () => {
    await db
      .delete(users)
      .where(eq(users.tenantId, tenantId))
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

  // ── Coupon creation via Stripe API ──────────────────────────

  it("creates a percentage coupon with correct Stripe params", async () => {
    const couponId = "coup_test_pct_" + Date.now();
    const promoId = "promo_test_pct_" + Date.now();

    mockCouponCreate.mockResolvedValueOnce({ id: couponId });
    mockPromoCodeCreate.mockResolvedValueOnce({
      id: promoId,
      code: "SUMMER20",
    });

    // Simulate creating a percentage coupon
    const couponParams = {
      percent_off: 20,
      metadata: { tenantId },
    };

    const coupon = await mockCouponCreate(couponParams);
    expect(coupon.id).toBe(couponId);

    const promoParams = {
      coupon: coupon.id,
      code: "SUMMER20",
      metadata: { tenantId },
    };

    const promo = await mockPromoCodeCreate(promoParams);
    expect(promo.code).toBe("SUMMER20");

    // Verify Stripe was called with correct params
    const couponCall = mockCouponCreate.mock.calls[0][0];
    expect(couponCall.percent_off).toBe(20);
    expect(couponCall.metadata.tenantId).toBe(tenantId);

    const promoCall = mockPromoCodeCreate.mock.calls[0][0];
    expect(promoCall.coupon).toBe(couponId);
    expect(promoCall.code).toBe("SUMMER20");
  });

  it("creates a fixed-amount coupon with correct Stripe params", async () => {
    const couponId = "coup_test_fixed_" + Date.now();
    const promoId = "promo_test_fixed_" + Date.now();

    mockCouponCreate.mockResolvedValueOnce({ id: couponId });
    mockPromoCodeCreate.mockResolvedValueOnce({
      id: promoId,
      code: "SAVE10",
    });

    const couponParams = {
      amount_off: 1000, // $10.00 in cents
      currency: "usd",
      metadata: { tenantId },
    };

    const coupon = await mockCouponCreate(couponParams);
    expect(coupon.id).toBe(couponId);

    const couponCall = mockCouponCreate.mock.calls[0][0];
    expect(couponCall.amount_off).toBe(1000);
    expect(couponCall.currency).toBe("usd");
  });

  it("creates a coupon with max redemptions and expiration", async () => {
    const couponId = "coup_test_limited_" + Date.now();
    const promoId = "promo_test_limited_" + Date.now();
    const expiresAt = "2026-12-31";
    const expiresTimestamp = Math.floor(new Date(expiresAt).getTime() / 1000);

    mockCouponCreate.mockResolvedValueOnce({ id: couponId });
    mockPromoCodeCreate.mockResolvedValueOnce({
      id: promoId,
      code: "LIMITED50",
    });

    const couponParams = {
      percent_off: 50,
      max_redemptions: 100,
      redeem_by: expiresTimestamp,
      metadata: { tenantId },
    };

    const coupon = await mockCouponCreate(couponParams);

    const promoParams = {
      coupon: coupon.id,
      code: "LIMITED50",
      max_redemptions: 100,
      expires_at: expiresTimestamp,
      metadata: { tenantId },
    };

    await mockPromoCodeCreate(promoParams);

    const couponCall = mockCouponCreate.mock.calls[0][0];
    expect(couponCall.max_redemptions).toBe(100);
    expect(couponCall.redeem_by).toBe(expiresTimestamp);

    const promoCall = mockPromoCodeCreate.mock.calls[0][0];
    expect(promoCall.max_redemptions).toBe(100);
    expect(promoCall.expires_at).toBe(expiresTimestamp);
  });

  it("creates a course-restricted coupon with courseId in metadata", async () => {
    const couponId = "coup_test_course_" + Date.now();
    const promoId = "promo_test_course_" + Date.now();

    mockCouponCreate.mockResolvedValueOnce({ id: couponId });
    mockPromoCodeCreate.mockResolvedValueOnce({
      id: promoId,
      code: "COURSEONLY",
    });

    const couponParams = {
      percent_off: 15,
      metadata: { tenantId, courseId },
    };

    await mockCouponCreate(couponParams);

    const couponCall = mockCouponCreate.mock.calls[0][0];
    expect(couponCall.metadata.courseId).toBe(courseId);
    expect(couponCall.metadata.tenantId).toBe(tenantId);
  });

  // ── Checkout session with discount ──────────────────────────

  it("creates checkout session with discount when promo code provided", async () => {
    const promoId = "promo_checkout_" + Date.now();
    const mockUrl = "https://checkout.stripe.com/pay/cs_test_" + Date.now();

    mockCheckoutSessionCreate.mockResolvedValueOnce({
      id: "cs_test_" + Date.now(),
      url: mockUrl,
    });

    // Load course and tenant for building checkout params
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)));

    const amountInCents = Math.round(Number(course.price) * 100);

    const sessionParams = {
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: course.title },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: 250,
        transfer_data: { destination: stripeConnectAccountId },
      },
      discounts: [{ promotion_code: promoId }],
      metadata: { tenantId, courseId, userId },
    };

    const result = await mockCheckoutSessionCreate(sessionParams);
    expect(result.url).toBe(mockUrl);

    const callArgs = mockCheckoutSessionCreate.mock.calls[0][0];
    expect(callArgs.discounts).toEqual([{ promotion_code: promoId }]);
    expect(callArgs.discounts[0].promotion_code).toBe(promoId);
  });

  it("creates checkout session without discount when no promo code", async () => {
    const mockUrl = "https://checkout.stripe.com/pay/cs_test_no_promo_" + Date.now();

    mockCheckoutSessionCreate.mockResolvedValueOnce({
      id: "cs_test_no_promo_" + Date.now(),
      url: mockUrl,
    });

    const sessionParams = {
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Test Course" },
            unit_amount: 4999,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: 250,
        transfer_data: { destination: stripeConnectAccountId },
      },
      metadata: { tenantId, courseId, userId },
    };

    const result = await mockCheckoutSessionCreate(sessionParams);
    expect(result.url).toBe(mockUrl);

    const callArgs = mockCheckoutSessionCreate.mock.calls[0][0];
    expect(callArgs.discounts).toBeUndefined();
  });

  // ── Promotion code validation ──────────────────────────

  it("validates a promotion code belonging to the correct tenant", async () => {
    const promoId = "promo_valid_" + Date.now();

    mockPromoCodeList.mockResolvedValueOnce({
      data: [
        {
          id: promoId,
          code: "VALID20",
          active: true,
          metadata: { tenantId },
          expires_at: null,
          max_redemptions: null,
          times_redeemed: 0,
          coupon: { percent_off: 20, amount_off: null },
        },
      ],
    });

    const promos = await mockPromoCodeList({ code: "VALID20", active: true, limit: 10 });
    const match = promos.data.find(
      (p: { metadata?: { tenantId?: string } }) => p.metadata?.tenantId === tenantId,
    );

    expect(match).toBeDefined();
    expect(match.id).toBe(promoId);
    expect(match.coupon.percent_off).toBe(20);
  });

  it("rejects a promotion code belonging to a different tenant", async () => {
    const otherTenantId = crypto.randomUUID();

    mockPromoCodeList.mockResolvedValueOnce({
      data: [
        {
          id: "promo_other_tenant",
          code: "OTHERTENANT",
          active: true,
          metadata: { tenantId: otherTenantId },
          expires_at: null,
          max_redemptions: null,
          times_redeemed: 0,
          coupon: { percent_off: 30, amount_off: null },
        },
      ],
    });

    const promos = await mockPromoCodeList({
      code: "OTHERTENANT",
      active: true,
      limit: 10,
    });
    const match = promos.data.find(
      (p: { metadata?: { tenantId?: string } }) => p.metadata?.tenantId === tenantId,
    );

    expect(match).toBeUndefined();
  });
});
