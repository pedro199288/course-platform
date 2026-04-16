import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  payments,
  enrollments,
  plans,
  users,
  accounts,
  userTenants,
} from "#/db/schema/index.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock job queue
vi.mock("#/lib/job-queue.ts", () => ({
  sendJob: vi.fn().mockResolvedValue("mock-job-id"),
  registerHandler: vi.fn(),
  startWorkers: vi.fn(),
  getBoss: vi.fn(),
}));

// Mock Stripe — needed for auto-refund on plan limit race condition
const mockRefundCreate = vi.fn().mockResolvedValue({ id: "re_mock" });
vi.mock("#/lib/stripe.ts", () => ({
  getStripe: () => ({
    refunds: { create: mockRefundCreate },
  }),
}));

import { processWebhookEvent } from "#/lib/webhook-actions.ts";
import { assertCanAddStudent } from "#/lib/plans.ts";

describe("checkout: student membership on purchase", () => {
  const ts = Date.now();
  const subdomain = `checkout-mem-${ts}`;
  let tenantId: string;
  let courseId: string;
  let planId: string;
  let userId: string;

  beforeAll(async () => {
    // Create plan with student limit of 2
    const [plan] = await db
      .insert(plans)
      .values({
        name: `Checkout Mem Plan ${ts}`,
        maxCourses: 100,
        maxStudents: 2,
        applicationFeePercent: "5.00",
      })
      .returning();
    planId = plan.id;

    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: `Checkout Mem School ${ts}`,
        subdomain,
        stripeConnectAccountId: "acct_test_mem",
        stripeOnboardingComplete: "true",
        planId,
      })
      .returning();
    tenantId = tenant.id;

    // Create user (no membership — simulates a fresh registration)
    const [user] = await db
      .insert(users)
      .values({
        name: "Buyer User",
        email: `buyer-${ts}@test.com`,
        emailVerified: true,
      })
      .returning();
    userId = user.id;

    // Create account for user
    await db.insert(accounts).values({
      userId,
      accountId: userId,
      providerId: "credential",
    });

    // Create published course
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Membership Test Course",
        slug: `mem-test-course-${ts}`,
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
      .delete(userTenants)
      .where(eq(userTenants.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(courses)
      .where(eq(courses.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(accounts)
      .where(eq(accounts.userId, userId))
      .catch(() => {});
    // Clean up extra users created in tests
    const extraEmails = [`buyer2-${ts}@test.com`, `buyer3-${ts}@test.com`];
    for (const email of extraEmails) {
      const u = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (u) {
        await db
          .delete(accounts)
          .where(eq(accounts.userId, u.id))
          .catch(() => {});
        await db
          .delete(userTenants)
          .where(eq(userTenants.userId, u.id))
          .catch(() => {});
        await db
          .delete(users)
          .where(eq(users.id, u.id))
          .catch(() => {});
      }
    }
    await db
      .delete(users)
      .where(eq(users.id, userId))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.id, tenantId))
      .catch(() => {});
    await db
      .delete(plans)
      .where(eq(plans.id, planId))
      .catch(() => {});
  });

  // ── Student membership created on purchase ────────────────

  it("creates user_tenants student membership on checkout.session.completed", async () => {
    // Verify no membership before purchase
    const [before] = await db
      .select()
      .from(userTenants)
      .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)));
    expect(before).toBeUndefined();

    const sessionId = `cs_mem_${ts}`;
    await processWebhookEvent({
      type: "checkout.session.completed",
      data: {
        id: sessionId,
        payment_intent: `pi_mem_${ts}`,
        amount_total: 4999,
        currency: "usd",
        metadata: { tenantId, courseId, userId },
      },
    });

    // Verify membership was created
    const [membership] = await db
      .select()
      .from(userTenants)
      .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)));
    expect(membership).toBeDefined();
    expect(membership.role).toBe("student");

    // Verify enrollment was also created
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, courseId),
          isNull(enrollments.revokedAt),
        ),
      );
    expect(enrollment).toBeDefined();
  });

  // ── Idempotent membership ────────────────────────────────

  it("does not create duplicate membership on second purchase", async () => {
    // Create a second course for the same tenant
    const [course2] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Second Course",
        slug: `second-course-${ts}`,
        price: "29.99",
        pricingModel: "one_time",
        status: "published",
      })
      .returning();

    const sessionId = `cs_mem2_${ts}`;
    await processWebhookEvent({
      type: "checkout.session.completed",
      data: {
        id: sessionId,
        payment_intent: `pi_mem2_${ts}`,
        amount_total: 2999,
        currency: "usd",
        metadata: { tenantId, courseId: course2.id, userId },
      },
    });

    // Should still have exactly one membership
    const memberships = await db
      .select()
      .from(userTenants)
      .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)));
    expect(memberships.length).toBe(1);

    // But should have enrollment for second course
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, course2.id),
          isNull(enrollments.revokedAt),
        ),
      );
    expect(enrollment).toBeDefined();

    // Clean up second course (delete payments before courses due to FK)
    await db.delete(enrollments).where(eq(enrollments.courseId, course2.id));
    await db.delete(payments).where(eq(payments.courseId, course2.id));
    await db.delete(courses).where(eq(courses.id, course2.id));
  });

  // ── Plan limit enforcement ───────────────────────────────

  it("assertCanAddStudent counts student memberships from user_tenants", async () => {
    // Already have 1 student from prior test. Add another to hit the limit of 2.
    const [user2] = await db
      .insert(users)
      .values({ name: "Student 2", email: `buyer2-${ts}@test.com`, emailVerified: true })
      .returning();
    await db.insert(userTenants).values({ userId: user2.id, tenantId, role: "student" });

    // Now at limit (2 students) — should reject
    await expect(assertCanAddStudent(tenantId)).rejects.toThrow(/Plan limit reached/);

    // Clean up second student
    await db.delete(userTenants).where(eq(userTenants.userId, user2.id));
    await db.delete(users).where(eq(users.id, user2.id));
  });

  it("auto-refunds via Stripe when plan limit exceeded in webhook (race condition)", async () => {
    mockRefundCreate.mockClear();

    // Fill up to the plan limit (2 students)
    const [user2] = await db
      .insert(users)
      .values({ name: "Student 2", email: `buyer2-${ts}@test.com`, emailVerified: true })
      .returning();
    await db.insert(userTenants).values({ userId: user2.id, tenantId, role: "student" });

    // Create a third user who tries to purchase (would exceed limit)
    const [user3] = await db
      .insert(users)
      .values({ name: "Student 3", email: `buyer3-${ts}@test.com`, emailVerified: true })
      .returning();

    const sessionId = `cs_refund_${ts}`;
    const paymentIntentId = `pi_refund_${ts}`;

    await processWebhookEvent({
      type: "checkout.session.completed",
      data: {
        id: sessionId,
        payment_intent: paymentIntentId,
        amount_total: 4999,
        currency: "usd",
        metadata: { tenantId, courseId, userId: user3.id },
      },
    });

    // Stripe refund should have been called
    expect(mockRefundCreate).toHaveBeenCalledWith({ payment_intent: paymentIntentId });

    // No payment record should have been created
    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.stripeCheckoutSessionId, sessionId));
    expect(paymentRows.length).toBe(0);

    // No membership should have been created for user3
    const [membership3] = await db
      .select()
      .from(userTenants)
      .where(and(eq(userTenants.userId, user3.id), eq(userTenants.tenantId, tenantId)));
    expect(membership3).toBeUndefined();

    // No enrollment should have been created
    const [enrollment3] = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, user3.id),
          eq(enrollments.courseId, courseId),
          isNull(enrollments.revokedAt),
        ),
      );
    expect(enrollment3).toBeUndefined();

    // Clean up
    await db.delete(userTenants).where(eq(userTenants.userId, user2.id));
    await db.delete(users).where(eq(users.id, user2.id));
    await db.delete(users).where(eq(users.id, user3.id));
  });

  // ── Owner/admin memberships don't count toward student limit ─

  it("owner and admin memberships do not consume student slots", async () => {
    // Clean existing student memberships except userId (our buyer)
    // userId already has a student membership from earlier tests

    // Add an owner and admin — they should not count
    const [ownerUser] = await db
      .insert(users)
      .values({ name: "Owner", email: `buyer2-${ts}@test.com`, emailVerified: true })
      .returning();
    await db.insert(userTenants).values({ userId: ownerUser.id, tenantId, role: "tenant_owner" });

    const [adminUser] = await db
      .insert(users)
      .values({ name: "Admin", email: `buyer3-${ts}@test.com`, emailVerified: true })
      .returning();
    await db.insert(userTenants).values({ userId: adminUser.id, tenantId, role: "tenant_admin" });

    // With 1 student + 1 owner + 1 admin, limit is 2 students, so we can add 1 more
    await expect(assertCanAddStudent(tenantId)).resolves.toBeUndefined();

    // Clean up
    await db.delete(userTenants).where(eq(userTenants.userId, ownerUser.id));
    await db.delete(userTenants).where(eq(userTenants.userId, adminUser.id));
    await db.delete(users).where(eq(users.id, ownerUser.id));
    await db.delete(users).where(eq(users.id, adminUser.id));
  });
});
