import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { requireMembership } from "./authorization.ts";
import { getStripe } from "./stripe.ts";
import { tenantIdStore } from "./tenant-context.ts";

/**
 * Create a Stripe coupon + promotion code on the platform account,
 * scoped to the instructor's tenant via metadata.
 */
export const createCouponFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      code: string;
      type: "percent" | "fixed";
      value: number;
      maxRedemptions: number | null;
      expiresAt: string | null;
      courseId: string | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    const stripe = getStripe();

    // Validate code format
    const code = data.code.trim().toUpperCase();
    if (!code || code.length < 2 || code.length > 30) {
      throw new Error("Code must be 2-30 characters");
    }
    if (!/^[A-Z0-9_-]+$/.test(code)) {
      throw new Error("Code can only contain letters, numbers, hyphens, and underscores");
    }

    // Validate value
    if (data.type === "percent" && (data.value < 1 || data.value > 100)) {
      throw new Error("Percentage must be between 1 and 100");
    }
    if (data.type === "fixed" && data.value < 1) {
      throw new Error("Amount must be at least 1 cent");
    }

    // If course-restricted, verify course belongs to tenant
    if (data.courseId) {
      const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.id, data.courseId));
      if (!course) throw new Error("Course not found");
    }

    // Create Stripe coupon
    const couponParams: Record<string, unknown> = {
      metadata: {
        tenantId,
        ...(data.courseId ? { courseId: data.courseId } : {}),
      },
    };
    if (data.type === "percent") {
      couponParams.percent_off = data.value;
    } else {
      couponParams.amount_off = data.value;
      couponParams.currency = "usd";
    }
    if (data.maxRedemptions) {
      couponParams.max_redemptions = data.maxRedemptions;
    }
    if (data.expiresAt) {
      couponParams.redeem_by = Math.floor(new Date(data.expiresAt).getTime() / 1000);
    }

    const coupon = await stripe.coupons.create(
      couponParams as Parameters<typeof stripe.coupons.create>[0],
    );

    // Create promotion code with the human-readable code
    const promotionCode = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code,
      max_redemptions: data.maxRedemptions ?? undefined,
      expires_at: data.expiresAt
        ? Math.floor(new Date(data.expiresAt).getTime() / 1000)
        : undefined,
      metadata: {
        tenantId,
        ...(data.courseId ? { courseId: data.courseId } : {}),
      },
    });

    return { id: promotionCode.id, code: promotionCode.code };
  });

/**
 * List promotion codes for the current tenant.
 * Fetches from Stripe API filtered by tenant metadata.
 */
export const listCouponsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { tenantId } = await requireMembership("tenant_admin");
  const stripe = getStripe();

  // Stripe doesn't support filtering by metadata, so we fetch all active + inactive
  // and filter client-side. Limit to 100 (reasonable for a single tenant).
  const [activePromos, inactivePromos] = await Promise.all([
    stripe.promotionCodes.list({ limit: 100, active: true }),
    stripe.promotionCodes.list({ limit: 100, active: false }),
  ]);

  const allPromos = [...activePromos.data, ...inactivePromos.data];
  const tenantPromos = allPromos.filter((p) => p.metadata?.tenantId === tenantId);

  // Map promo codes to response shape, extracting coupon details from promotion.coupon
  const results = tenantPromos.map((promo) => {
    const coupon = typeof promo.promotion.coupon === "object" ? promo.promotion.coupon : null;
    return {
      id: promo.id,
      code: promo.code,
      active: promo.active,
      type: (coupon?.percent_off ? "percent" : "fixed") as "percent" | "fixed",
      value: coupon?.percent_off ?? coupon?.amount_off ?? 0,
      maxRedemptions: promo.max_redemptions,
      timesRedeemed: promo.times_redeemed,
      expiresAt: promo.expires_at ? new Date(promo.expires_at * 1000).toISOString() : null,
      courseId: promo.metadata?.courseId ?? null,
      createdAt: new Date(promo.created * 1000).toISOString(),
    };
  });

  // Sort by created date descending
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return results;
});

/**
 * Deactivate a promotion code.
 */
export const deactivateCouponFn = createServerFn({ method: "POST" })
  .inputValidator((d: { promotionCodeId: string }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    const stripe = getStripe();

    // Verify ownership
    const promo = await stripe.promotionCodes.retrieve(data.promotionCodeId);
    if (promo.metadata?.tenantId !== tenantId) {
      throw new Error("Not found");
    }

    await stripe.promotionCodes.update(data.promotionCodeId, { active: false });
    return { success: true };
  });

/**
 * Activate a promotion code.
 */
export const activateCouponFn = createServerFn({ method: "POST" })
  .inputValidator((d: { promotionCodeId: string }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    const stripe = getStripe();

    const promo = await stripe.promotionCodes.retrieve(data.promotionCodeId);
    if (promo.metadata?.tenantId !== tenantId) {
      throw new Error("Not found");
    }

    await stripe.promotionCodes.update(data.promotionCodeId, { active: true });
    return { success: true };
  });

/**
 * Validate a promotion code for a student at checkout time.
 * Returns the Stripe promotion code ID if valid, null otherwise.
 */
export const validatePromotionCodeFn = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string; courseId?: string }) => d)
  .handler(async ({ data }) => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new Error("Unauthorized");
    const tenantId = tenantIdStore.getStore()!;

    const stripe = getStripe();
    const code = data.code.trim().toUpperCase();

    // Search for active promotion codes matching this code
    const promos = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 10,
    });

    // Find one that belongs to this tenant
    const match = promos.data.find((p) => p.metadata?.tenantId === tenantId);
    if (!match) {
      return { valid: false as const, error: "Invalid or expired coupon code" };
    }

    // Check course restriction
    const restrictedCourseId = match.metadata?.courseId;
    if (restrictedCourseId && data.courseId && restrictedCourseId !== data.courseId) {
      return { valid: false as const, error: "This coupon is not valid for this course" };
    }

    // Check expiration
    if (match.expires_at && match.expires_at < Math.floor(Date.now() / 1000)) {
      return { valid: false as const, error: "This coupon has expired" };
    }

    // Check max redemptions
    if (match.max_redemptions && match.times_redeemed >= match.max_redemptions) {
      return { valid: false as const, error: "This coupon has reached its usage limit" };
    }

    // Build discount description from promotion.coupon
    const coupon = typeof match.promotion.coupon === "object" ? match.promotion.coupon : null;
    let discount = "";
    if (coupon?.percent_off) {
      discount = `${coupon.percent_off}% off`;
    } else if (coupon?.amount_off) {
      discount = `$${(coupon.amount_off / 100).toFixed(2)} off`;
    }

    return {
      valid: true as const,
      promotionCodeId: match.id,
      discount,
    };
  });
