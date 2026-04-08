import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, sql } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  enrollments,
  payments,
} from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("instructor dashboard", () => {
  const subdomain = `instr-dash-${Date.now()}`;
  let tenantId: string;
  let otherTenantId: string;
  let publishedCourseId: string;
  let draftCourseId: string;
  let publishedCourse2Id: string;
  const studentId1 = crypto.randomUUID();
  const studentId2 = crypto.randomUUID();
  const studentId3 = crypto.randomUUID();

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Instructor Dashboard School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Create other tenant for isolation tests
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other School", subdomain: `other-instr-${Date.now()}` })
      .returning();
    otherTenantId = otherTenant.id;

    // Create published course
    const [pub1] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Published Course A",
        slug: "published-a",
        status: "published",
        price: "49.99",
      })
      .returning();
    publishedCourseId = pub1.id;

    // Create second published course
    const [pub2] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Published Course B",
        slug: "published-b",
        status: "published",
        price: "29.99",
      })
      .returning();
    publishedCourse2Id = pub2.id;

    // Create draft course
    const [draft] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Draft Course",
        slug: "draft-course",
        status: "draft",
        price: "19.99",
      })
      .returning();
    draftCourseId = draft.id;

    // Enroll students in published course A
    await db.insert(enrollments).values([
      { tenantId, userId: studentId1, courseId: publishedCourseId },
      { tenantId, userId: studentId2, courseId: publishedCourseId },
    ]);

    // Enroll student 1 in published course B too
    await db.insert(enrollments).values({
      tenantId,
      userId: studentId1,
      courseId: publishedCourse2Id,
    });

    // Create payment records
    await db.insert(payments).values([
      {
        tenantId,
        userId: studentId1,
        courseId: publishedCourseId,
        amount: "49.99",
        currency: "usd",
        stripePaymentIntentId: "pi_test_1",
        stripeCheckoutSessionId: "cs_test_1",
      },
      {
        tenantId,
        userId: studentId2,
        courseId: publishedCourseId,
        amount: "49.99",
        currency: "usd",
        stripePaymentIntentId: "pi_test_2",
        stripeCheckoutSessionId: "cs_test_2",
      },
      {
        tenantId,
        userId: studentId1,
        courseId: publishedCourse2Id,
        amount: "29.99",
        currency: "usd",
        stripePaymentIntentId: "pi_test_3",
        stripeCheckoutSessionId: "cs_test_3",
      },
    ]);

    // Create data in other tenant for isolation
    const [otherCourse] = await db
      .insert(courses)
      .values({
        tenantId: otherTenantId,
        title: "Other Tenant Course",
        slug: "other-course",
        status: "published",
        price: "99.99",
      })
      .returning();

    await db.insert(enrollments).values({
      tenantId: otherTenantId,
      userId: studentId3,
      courseId: otherCourse.id,
    });

    await db.insert(payments).values({
      tenantId: otherTenantId,
      userId: studentId3,
      courseId: otherCourse.id,
      amount: "99.99",
      currency: "usd",
      stripePaymentIntentId: "pi_other_1",
      stripeCheckoutSessionId: "cs_other_1",
    });
  });

  afterAll(async () => {
    await db.delete(payments).where(eq(payments.tenantId, tenantId)).catch(() => {});
    await db.delete(payments).where(eq(payments.tenantId, otherTenantId)).catch(() => {});
    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId)).catch(() => {});
    await db.delete(enrollments).where(eq(enrollments.tenantId, otherTenantId)).catch(() => {});
    await db.delete(courses).where(eq(courses.tenantId, tenantId)).catch(() => {});
    await db.delete(courses).where(eq(courses.tenantId, otherTenantId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, otherTenantId)).catch(() => {});
  });

  // ── Course counts ──────────────────────────

  it("counts courses by status for tenant", async () => {
    const stats = await db
      .select({
        status: courses.status,
        count: sql<number>`count(*)::int`,
      })
      .from(courses)
      .where(eq(courses.tenantId, tenantId))
      .groupBy(courses.status);

    const published = stats.find((s) => s.status === "published")?.count ?? 0;
    const draft = stats.find((s) => s.status === "draft")?.count ?? 0;

    expect(published).toBe(2);
    expect(draft).toBe(1);
    expect(published + draft).toBe(3);
  });

  // ── Student count ──────────────────────────

  it("counts unique students from non-revoked enrollments", async () => {
    const [result] = await db
      .select({
        count: sql<number>`count(distinct ${enrollments.userId})::int`,
      })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.tenantId, tenantId),
          sql`${enrollments.revokedAt} is null`,
        ),
      );

    // studentId1 and studentId2 are enrolled (studentId1 in 2 courses, but counted once)
    expect(result.count).toBe(2);
  });

  // ── Revenue ──────────────────────────

  it("calculates total revenue for tenant", async () => {
    const [result] = await db
      .select({
        total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(eq(payments.tenantId, tenantId));

    // 49.99 + 49.99 + 29.99 = 129.97
    expect(parseFloat(result.total)).toBeCloseTo(129.97);
  });

  // ── Per-course stats ──────────────────────────

  it("returns per-course enrollment counts", async () => {
    const perCourse = await db
      .select({
        courseId: courses.id,
        courseTitle: courses.title,
        enrolledStudents: sql<number>`count(${enrollments.id})::int`,
      })
      .from(courses)
      .leftJoin(
        enrollments,
        and(
          eq(courses.id, enrollments.courseId),
          sql`${enrollments.revokedAt} is null`,
        ),
      )
      .where(eq(courses.tenantId, tenantId))
      .groupBy(courses.id, courses.title);

    const courseA = perCourse.find((c) => c.courseId === publishedCourseId);
    const courseB = perCourse.find((c) => c.courseId === publishedCourse2Id);
    const courseDraft = perCourse.find((c) => c.courseId === draftCourseId);

    expect(courseA?.enrolledStudents).toBe(2);
    expect(courseB?.enrolledStudents).toBe(1);
    expect(courseDraft?.enrolledStudents).toBe(0);
  });

  it("returns per-course revenue", async () => {
    const perCourse = await db
      .select({
        courseId: payments.courseId,
        revenue: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(eq(payments.tenantId, tenantId))
      .groupBy(payments.courseId);

    const courseA = perCourse.find((c) => c.courseId === publishedCourseId);
    const courseB = perCourse.find((c) => c.courseId === publishedCourse2Id);

    expect(parseFloat(courseA?.revenue ?? "0")).toBeCloseTo(99.98);
    expect(parseFloat(courseB?.revenue ?? "0")).toBeCloseTo(29.99);
  });

  // ── Tenant isolation ──────────────────────────

  it("isolates course counts by tenant", async () => {
    const stats = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(courses)
      .where(eq(courses.tenantId, tenantId));

    const otherStats = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(courses)
      .where(eq(courses.tenantId, otherTenantId));

    expect(stats[0].count).toBe(3);
    expect(otherStats[0].count).toBe(1);
  });

  it("isolates revenue by tenant", async () => {
    const [result] = await db
      .select({
        total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(eq(payments.tenantId, tenantId));

    const [otherResult] = await db
      .select({
        total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(eq(payments.tenantId, otherTenantId));

    expect(parseFloat(result.total)).toBeCloseTo(129.97);
    expect(parseFloat(otherResult.total)).toBeCloseTo(99.99);
  });

  it("isolates student counts by tenant", async () => {
    const [result] = await db
      .select({
        count: sql<number>`count(distinct ${enrollments.userId})::int`,
      })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.tenantId, tenantId),
          sql`${enrollments.revokedAt} is null`,
        ),
      );

    const [otherResult] = await db
      .select({
        count: sql<number>`count(distinct ${enrollments.userId})::int`,
      })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.tenantId, otherTenantId),
          sql`${enrollments.revokedAt} is null`,
        ),
      );

    expect(result.count).toBe(2);
    expect(otherResult.count).toBe(1);
  });

  // ── Revoked enrollments excluded ──────────────────────────

  it("excludes revoked enrollments from student count", async () => {
    // Revoke studentId2's enrollment
    await db
      .update(enrollments)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(enrollments.userId, studentId2),
          eq(enrollments.courseId, publishedCourseId),
        ),
      );

    const [result] = await db
      .select({
        count: sql<number>`count(distinct ${enrollments.userId})::int`,
      })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.tenantId, tenantId),
          sql`${enrollments.revokedAt} is null`,
        ),
      );

    // Only studentId1 remains active
    expect(result.count).toBe(1);

    // Restore
    await db
      .update(enrollments)
      .set({ revokedAt: null })
      .where(
        and(
          eq(enrollments.userId, studentId2),
          eq(enrollments.courseId, publishedCourseId),
        ),
      );
  });
});
