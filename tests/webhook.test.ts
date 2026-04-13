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
} from "#/db/schema/index.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock job queue — we verify jobs are dispatched, not that pg-boss works
const mockSendJob = vi.fn().mockResolvedValue("mock-job-id");
vi.mock("#/lib/job-queue.ts", () => ({
  sendJob: (...args: unknown[]) => mockSendJob(...args),
  registerHandler: vi.fn(),
  startWorkers: vi.fn(),
  getBoss: vi.fn(),
}));

import { processWebhookEvent, dispatchWebhookEvent } from "#/lib/webhook-actions.ts";

describe("webhook handling", () => {
  const subdomain = `webhook-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let planId: string;
  let userId: string;
  const stripeConnectAccountId = "acct_webhook_test";

  beforeAll(async () => {
    // Create plan
    const [plan] = await db
      .insert(plans)
      .values({
        name: "Webhook Test Plan",
        maxCourses: 100,
        maxStudents: 1000,
        applicationFeePercent: "5.00",
      })
      .returning();
    planId = plan.id;

    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: "Webhook Test School",
        subdomain,
        stripeConnectAccountId,
        stripeOnboardingComplete: "true",
        planId,
      })
      .returning();
    tenantId = tenant.id;

    // Create user (needed for email notifications)
    const [user] = await db
      .insert(users)
      .values({
        tenantId,
        name: "Test Student",
        email: `webhook-student-${Date.now()}@test.com`,
        emailVerified: true,
        role: "student",
      })
      .returning();
    userId = user.id;

    // Create account for user (Better Auth requires it)
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
        title: "Webhook Test Course",
        slug: "webhook-test-course",
        description: "A test course for webhooks",
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
      .delete(accounts)
      .where(eq(accounts.userId, userId))
      .catch(() => {});
    await db
      .delete(users)
      .where(eq(users.id, userId))
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

  // ── Webhook dispatch to job queue ──────────────────────────

  it("dispatches webhook event to background job queue", async () => {
    mockSendJob.mockClear();

    const jobId = await dispatchWebhookEvent("checkout.session.completed", {
      id: "cs_test_dispatch",
      metadata: { tenantId, courseId, userId },
    });

    expect(jobId).toBe("mock-job-id");
    expect(mockSendJob).toHaveBeenCalledWith("process_stripe_webhook", {
      type: "checkout.session.completed",
      data: {
        id: "cs_test_dispatch",
        metadata: { tenantId, courseId, userId },
      },
    });
  });

  // ── checkout.session.completed → payment + enrollment ─────

  it("creates payment record on checkout.session.completed", async () => {
    const sessionId = `cs_test_payment_${Date.now()}`;

    await processWebhookEvent({
      type: "checkout.session.completed",
      data: {
        id: sessionId,
        payment_intent: `pi_test_${Date.now()}`,
        amount_total: 4999,
        currency: "usd",
        metadata: { tenantId, courseId, userId },
      },
    });

    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.stripeCheckoutSessionId, sessionId));

    expect(payment).toBeDefined();
    expect(payment.amount).toBe("49.99");
    expect(payment.currency).toBe("usd");
    expect(payment.courseId).toBe(courseId);
    expect(payment.userId).toBe(userId);
    expect(payment.tenantId).toBe(tenantId);
  });

  it("creates enrollment record on checkout.session.completed", async () => {
    // Clean up any prior enrollment from previous test
    await db
      .delete(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));

    const sessionId = `cs_test_enroll_${Date.now()}`;

    await processWebhookEvent({
      type: "checkout.session.completed",
      data: {
        id: sessionId,
        payment_intent: `pi_test_enroll_${Date.now()}`,
        amount_total: 4999,
        currency: "usd",
        metadata: { tenantId, courseId, userId },
      },
    });

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
    expect(enrollment.enrolledAt).toBeDefined();
    expect(enrollment.revokedAt).toBeNull();
  });

  // ── Idempotency ─────────────────────────────────────────────

  it("is idempotent — duplicate session does not create duplicate records", async () => {
    // Clean slate
    await db
      .delete(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));
    await db.delete(payments).where(eq(payments.tenantId, tenantId));

    const sessionId = `cs_test_idempotent_${Date.now()}`;
    const eventData = {
      type: "checkout.session.completed" as const,
      data: {
        id: sessionId,
        payment_intent: `pi_test_idempotent_${Date.now()}`,
        amount_total: 4999,
        currency: "usd",
        metadata: { tenantId, courseId, userId },
      },
    };

    // Process twice
    await processWebhookEvent(eventData);
    await processWebhookEvent(eventData);

    // Should have exactly one payment record
    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.stripeCheckoutSessionId, sessionId));
    expect(paymentRows.length).toBe(1);

    // Should have exactly one active enrollment
    const enrollmentRows = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, courseId),
          isNull(enrollments.revokedAt),
        ),
      );
    expect(enrollmentRows.length).toBe(1);
  });

  // ── charge.refunded → enrollment revocation ────────────────

  it("revokes enrollment on charge.refunded", async () => {
    // Clean slate
    await db
      .delete(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));
    await db.delete(payments).where(eq(payments.tenantId, tenantId));

    const paymentIntentId = `pi_test_refund_${Date.now()}`;
    const sessionId = `cs_test_refund_${Date.now()}`;

    // First: complete checkout (creates payment + enrollment)
    await processWebhookEvent({
      type: "checkout.session.completed",
      data: {
        id: sessionId,
        payment_intent: paymentIntentId,
        amount_total: 4999,
        currency: "usd",
        metadata: { tenantId, courseId, userId },
      },
    });

    // Verify enrollment exists
    const [beforeRefund] = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, courseId),
          isNull(enrollments.revokedAt),
        ),
      );
    expect(beforeRefund).toBeDefined();

    // Then: process refund
    await processWebhookEvent({
      type: "charge.refunded",
      data: {
        id: `ch_test_refund_${Date.now()}`,
        payment_intent: paymentIntentId,
      },
    });

    // Enrollment should be revoked
    const [afterRefund] = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, courseId),
          isNull(enrollments.revokedAt),
        ),
      );
    expect(afterRefund).toBeUndefined();

    // But the enrollment record still exists (with revokedAt set)
    const [revokedEnrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)));
    expect(revokedEnrollment).toBeDefined();
    expect(revokedEnrollment.revokedAt).not.toBeNull();
  });

  // ── Missing metadata rejection ─────────────────────────────

  it("throws on missing metadata in checkout event", async () => {
    await expect(
      processWebhookEvent({
        type: "checkout.session.completed",
        data: {
          id: "cs_no_metadata",
          amount_total: 4999,
          currency: "usd",
          metadata: {},
        },
      }),
    ).rejects.toThrow("Missing metadata");
  });

  // ── Missing payment_intent in refund event ─────────────────

  it("throws on missing payment_intent in refund event", async () => {
    await expect(
      processWebhookEvent({
        type: "charge.refunded",
        data: {
          id: "ch_no_pi",
        },
      }),
    ).rejects.toThrow("Missing payment_intent");
  });

  // ── Refund for unknown payment is a no-op ──────────────────

  it("handles refund for unknown payment gracefully", async () => {
    // Should not throw — just silently does nothing
    await processWebhookEvent({
      type: "charge.refunded",
      data: {
        id: "ch_unknown",
        payment_intent: "pi_nonexistent_" + Date.now(),
      },
    });
  });

  // ── Unknown event types are ignored ────────────────────────

  it("ignores unknown event types", async () => {
    // Should not throw
    await processWebhookEvent({
      type: "some.unknown.event",
      data: { id: "unknown" },
    });
  });
});
