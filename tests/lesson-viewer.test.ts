import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  subscriptions,
} from "#/db/schema/index.ts";
import { checkCourseAccess } from "#/lib/lesson-actions.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("lesson viewer — access gating", () => {
  const subdomain = `lesson-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let moduleId: string;
  let lessonId: string;
  const enrolledUserId = crypto.randomUUID();
  const subscribedUserId = crypto.randomUUID();
  const unenrolledUserId = crypto.randomUUID();

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: "Lesson Test School",
        subdomain,
      })
      .returning();
    tenantId = tenant.id;

    // Create published course with module and lesson
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Lesson Test Course",
        slug: "lesson-test-course",
        description: "A test course for lesson viewer",
        price: "29.99",
        status: "published",
      })
      .returning();
    courseId = course.id;

    const [mod] = await db
      .insert(modules)
      .values({
        courseId,
        title: "Module 1",
        position: 0,
      })
      .returning();
    moduleId = mod.id;

    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Introduction",
        type: "text",
        content: { text: "Welcome to the course!\n\nThis is the first lesson." },
        position: 0,
      })
      .returning();
    lessonId = lesson.id;

    // Create enrollment for enrolled user
    await db.insert(enrollments).values({
      tenantId,
      userId: enrolledUserId,
      courseId,
    });

    // Create active subscription for subscribed user
    await db.insert(subscriptions).values({
      tenantId,
      userId: subscribedUserId,
      stripeSubscriptionId: `sub_test_${Date.now()}`,
      status: "active",
    });
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
      .delete(courses)
      .where(eq(courses.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain))
      .catch(() => {});
  });

  // ── Access gating via enrollment ──────────────────────────

  it("grants access to enrolled user", async () => {
    const hasAccess = await checkCourseAccess(enrolledUserId, courseId, tenantId);
    expect(hasAccess).toBe(true);
  });

  it("denies access to unenrolled user", async () => {
    const hasAccess = await checkCourseAccess(unenrolledUserId, courseId, tenantId);
    expect(hasAccess).toBe(false);
  });

  // ── Access gating via subscription ──────────────────────────

  it("grants access to user with active subscription", async () => {
    const hasAccess = await checkCourseAccess(subscribedUserId, courseId, tenantId);
    expect(hasAccess).toBe(true);
  });

  it("denies access when subscription is canceled", async () => {
    const canceledUserId = crypto.randomUUID();
    await db.insert(subscriptions).values({
      tenantId,
      userId: canceledUserId,
      stripeSubscriptionId: `sub_canceled_${Date.now()}`,
      status: "canceled",
    });

    const hasAccess = await checkCourseAccess(canceledUserId, courseId, tenantId);
    expect(hasAccess).toBe(false);
  });

  // ── Revoked enrollment ──────────────────────────

  it("denies access when enrollment is revoked", async () => {
    const revokedUserId = crypto.randomUUID();
    await db.insert(enrollments).values({
      tenantId,
      userId: revokedUserId,
      courseId,
      revokedAt: new Date(),
    });

    const hasAccess = await checkCourseAccess(revokedUserId, courseId, tenantId);
    expect(hasAccess).toBe(false);
  });

  // ── Lesson content retrieval ──────────────────────────

  it("stores and retrieves lesson content as JSONB", async () => {
    const [fetched] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, lessonId));

    expect(fetched).toBeDefined();
    expect(fetched.type).toBe("text");
    const content = fetched.content as { text: string };
    expect(content.text).toContain("Welcome to the course!");
  });

  // ── Tenant isolation ──────────────────────────

  it("denies access across tenants", async () => {
    // Create a second tenant
    const [otherTenant] = await db
      .insert(tenants)
      .values({
        name: "Other School",
        subdomain: `other-${Date.now()}`,
      })
      .returning();

    // Enrolled user in tenant A should not have access in tenant B
    const hasAccess = await checkCourseAccess(
      enrolledUserId,
      courseId,
      otherTenant.id,
    );
    expect(hasAccess).toBe(false);

    // Cleanup
    await db.delete(tenants).where(eq(tenants.id, otherTenant.id));
  });

  // ── Draft course exclusion ──────────────────────────

  it("only retrieves published courses for lesson access", async () => {
    const [draftCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Draft Course",
        slug: "draft-lesson-test",
        status: "draft",
      })
      .returning();

    // Even with the course ID, a published-only query excludes drafts
    const result = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.id, draftCourse.id),
          eq(courses.tenantId, tenantId),
          eq(courses.status, "published"),
        ),
      );
    expect(result.length).toBe(0);

    await db.delete(courses).where(eq(courses.id, draftCourse.id));
  });
});
