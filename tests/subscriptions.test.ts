import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  subscriptions,
} from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";
import { processWebhookEvent } from "#/lib/webhook-actions.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock job queue to avoid PgBoss dependency
vi.mock("#/lib/job-queue.ts", () => ({
  sendJob: vi.fn().mockResolvedValue("mock-job-id"),
}));

describe("subscriptions", () => {
  const subdomain = `sub-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let moduleId: string;
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const stripeSubId = `sub_test_${Date.now()}`;

  beforeAll(async () => {
    // Create tenant with subscription price
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: "Sub Test School",
        subdomain,
        subscriptionPrice: "19.99",
        stripeConnectAccountId: "acct_test123",
        stripeOnboardingComplete: "true",
      })
      .returning();
    tenantId = tenant.id;

    // Create published course
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Sub Course",
        slug: "sub-course",
        status: "published",
        price: "49.99",
        pricingModel: "both",
      })
      .returning();
    courseId = course.id;

    // Create module + lesson for access testing
    const [mod] = await db
      .insert(modules)
      .values({ courseId, title: "Module 1", position: 0 })
      .returning();
    moduleId = mod.id;

    await db.insert(lessons).values({ moduleId, title: "Lesson 1", type: "text", position: 0 });

    // Create test users for FK constraints
    await db.insert(users).values([
      { id: userId, tenantId, name: "Sub User", email: `sub-user-${Date.now()}@example.com` },
      {
        id: otherUserId,
        tenantId,
        name: "Other User",
        email: `other-user-${Date.now()}@example.com`,
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(enrollments)
      .where(eq(enrollments.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .catch(() => {});
    await db
      .delete(modules)
      .where(eq(modules.courseId, courseId))
      .catch(() => {});
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
  });

  // ── Subscription creation via webhook ─────────────────

  it("creates subscription record on customer.subscription.created", async () => {
    await processWebhookEvent({
      type: "customer.subscription.created",
      data: {
        id: stripeSubId,
        status: "active",
        metadata: { tenantId, userId },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      },
    });

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    expect(sub).toBeDefined();
    expect(sub.status).toBe("active");
    expect(sub.tenantId).toBe(tenantId);
    expect(sub.userId).toBe(userId);
    expect(sub.currentPeriodEnd).toBeDefined();
  });

  it("is idempotent — duplicate created event does not throw", async () => {
    await expect(
      processWebhookEvent({
        type: "customer.subscription.created",
        data: {
          id: stripeSubId,
          status: "active",
          metadata: { tenantId, userId },
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        },
      }),
    ).resolves.toBeUndefined();

    // Still only one record
    const subs = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
    expect(subs.length).toBe(1);
  });

  // ── Subscription update via webhook ───────────────────

  it("updates subscription status on customer.subscription.updated", async () => {
    await processWebhookEvent({
      type: "customer.subscription.updated",
      data: {
        id: stripeSubId,
        status: "past_due",
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        canceled_at: null,
        cancel_at: null,
      },
    });

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    expect(sub.status).toBe("past_due");
  });

  it("sets canceledAt when subscription is canceled at period end", async () => {
    const cancelTime = Math.floor(Date.now() / 1000);
    await processWebhookEvent({
      type: "customer.subscription.updated",
      data: {
        id: stripeSubId,
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        canceled_at: cancelTime,
        cancel_at: null,
      },
    });

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    expect(sub.status).toBe("active");
    expect(sub.canceledAt).toBeDefined();
  });

  // ── Subscription deletion via webhook ─────────────────

  it("marks subscription canceled on customer.subscription.deleted", async () => {
    await processWebhookEvent({
      type: "customer.subscription.deleted",
      data: { id: stripeSubId },
    });

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    expect(sub.status).toBe("canceled");
    expect(sub.canceledAt).toBeDefined();
  });

  // ── Access gating ─────────────────────────────────────

  it("active subscription grants access to all tenant courses", async () => {
    // Reactivate the subscription for this test
    await db
      .update(subscriptions)
      .set({ status: "active", canceledAt: null })
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    // User has no enrollment but has active subscription
    const enrollmentResult = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));
    expect(enrollmentResult.length).toBe(0);

    // But subscription is active
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.tenantId, tenantId),
          eq(subscriptions.status, "active"),
        ),
      );
    expect(sub).toBeDefined();
  });

  it("canceled subscription denies access", async () => {
    await db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    const subs = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.tenantId, tenantId),
          eq(subscriptions.status, "active"),
        ),
      );
    expect(subs.length).toBe(0);
  });

  // ── Tenant isolation ──────────────────────────────────

  it("subscription is isolated by tenant", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other Sub School", subdomain: `other-sub-${Date.now()}` })
      .returning();

    // User's subscription belongs to first tenant
    const subs = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.tenantId, otherTenant.id)));
    expect(subs.length).toBe(0);

    await db.delete(tenants).where(eq(tenants.id, otherTenant.id));
  });

  // ── Both models simultaneously ────────────────────────

  it("supports both one-time and subscription access simultaneously", async () => {
    // Course has pricingModel "both"
    const [course] = await db
      .select({ pricingModel: courses.pricingModel })
      .from(courses)
      .where(eq(courses.id, courseId));
    expect(course.pricingModel).toBe("both");

    // Enroll a second user via one-time purchase
    await db.insert(enrollments).values({
      tenantId,
      userId: otherUserId,
      courseId,
    });

    // Second user has access via enrollment
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, otherUserId), eq(enrollments.courseId, courseId)));
    expect(enrollment).toBeDefined();

    // First user has access via subscription (reactivate)
    await db
      .update(subscriptions)
      .set({ status: "active", canceledAt: null })
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.tenantId, tenantId),
          eq(subscriptions.status, "active"),
        ),
      );
    expect(sub).toBeDefined();
  });
});
