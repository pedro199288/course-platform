import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  lessonProgress,
  subscriptions,
} from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";
import { findNextLesson } from "#/lib/dashboard-actions.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("student dashboard", () => {
  const subdomain = `dashboard-test-${Date.now()}`;
  let tenantId: string;
  let course1Id: string;
  let course2Id: string;
  let module1Id: string;
  let module2Id: string;
  let lesson1Id: string;
  let lesson2Id: string;
  let lesson3Id: string;
  let course2Module1Id: string;
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Dashboard Test School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Create published course 1 with modules and lessons
    const [course1] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Course One",
        slug: "course-one",
        status: "published",
        price: "29.99",
      })
      .returning();
    course1Id = course1.id;

    const [mod1] = await db
      .insert(modules)
      .values({ courseId: course1Id, title: "Module 1", position: 0 })
      .returning();
    module1Id = mod1.id;

    const [mod2] = await db
      .insert(modules)
      .values({ courseId: course1Id, title: "Module 2", position: 1 })
      .returning();
    module2Id = mod2.id;

    const [l1] = await db
      .insert(lessons)
      .values({ moduleId: module1Id, title: "Lesson 1", type: "text", position: 0 })
      .returning();
    lesson1Id = l1.id;

    const [l2] = await db
      .insert(lessons)
      .values({ moduleId: module1Id, title: "Lesson 2", type: "text", position: 1 })
      .returning();
    lesson2Id = l2.id;

    const [l3] = await db
      .insert(lessons)
      .values({ moduleId: module2Id, title: "Lesson 3", type: "video", position: 0 })
      .returning();
    lesson3Id = l3.id;

    // Create published course 2
    const [course2] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Course Two",
        slug: "course-two",
        status: "published",
        price: "19.99",
      })
      .returning();
    course2Id = course2.id;

    const [c2mod] = await db
      .insert(modules)
      .values({ courseId: course2Id, title: "C2 Module", position: 0 })
      .returning();
    course2Module1Id = c2mod.id;

    await db
      .insert(lessons)
      .values({ moduleId: course2Module1Id, title: "C2 Lesson 1", type: "text", position: 0 });
    // Create a draft course (should not appear in dashboard)
    await db
      .insert(courses)
      .values({
        tenantId,
        title: "Draft Course",
        slug: "draft-course",
        status: "draft",
        price: "9.99",
      })
      .returning();

    // Create test user
    await db.insert(users).values({
      id: userId,
      tenantId,
      name: "Dashboard Test User",
      email: `dashboard-test-${Date.now()}@example.com`,
    });

    // Enroll user in course 1
    await db.insert(enrollments).values({
      tenantId,
      userId,
      courseId: course1Id,
    });

    // Mark lesson 1 as complete
    await db.insert(lessonProgress).values({
      tenantId,
      userId,
      lessonId: lesson1Id,
      completed: true,
      completedAt: new Date(),
    });
  });

  afterAll(async () => {
    await db
      .delete(lessonProgress)
      .where(eq(lessonProgress.tenantId, tenantId))
      .catch(() => {});
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
      .where(eq(lessons.moduleId, module1Id))
      .catch(() => {});
    await db
      .delete(lessons)
      .where(eq(lessons.moduleId, module2Id))
      .catch(() => {});
    await db
      .delete(lessons)
      .where(eq(lessons.moduleId, course2Module1Id))
      .catch(() => {});
    await db
      .delete(modules)
      .where(eq(modules.courseId, course1Id))
      .catch(() => {});
    await db
      .delete(modules)
      .where(eq(modules.courseId, course2Id))
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

  // ── Enrollment queries ──────────────────────────

  it("returns enrolled courses for a user", async () => {
    const userEnrollments = await db
      .select({ courseId: enrollments.courseId })
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.tenantId, tenantId)));

    expect(userEnrollments.length).toBe(1);
    expect(userEnrollments[0].courseId).toBe(course1Id);
  });

  it("excludes revoked enrollments", async () => {
    // Enroll in course 2 then revoke
    await db.insert(enrollments).values({
      tenantId,
      userId,
      courseId: course2Id,
    });
    await db
      .update(enrollments)
      .set({ revokedAt: new Date() })
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, course2Id)));

    const activeEnrollments = await db
      .select({ courseId: enrollments.courseId })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.tenantId, tenantId),
          isNull(enrollments.revokedAt),
        ),
      );

    // Only course1 should remain (course2 is revoked)
    expect(activeEnrollments.length).toBe(1);
    expect(activeEnrollments[0].courseId).toBe(course1Id);

    // Clean up revoked enrollment
    await db
      .delete(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, course2Id)));
  });

  it("isolates enrollments by tenant", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other School", subdomain: `other-dash-${Date.now()}` })
      .returning();

    const otherEnrollments = await db
      .select({ courseId: enrollments.courseId })
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.tenantId, otherTenant.id)));

    expect(otherEnrollments.length).toBe(0);

    await db.delete(tenants).where(eq(tenants.id, otherTenant.id));
  });

  // ── Progress computation ──────────────────────────

  it("computes progress for enrolled course", async () => {
    // User has completed lesson 1 of 3 in course 1
    const allLessonIds = [lesson1Id, lesson2Id, lesson3Id];

    const completedRows = await db
      .select({ lessonId: lessonProgress.lessonId })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.tenantId, tenantId),
          eq(lessonProgress.completed, true),
        ),
      );

    const completedIds = new Set(completedRows.map((r) => r.lessonId));
    const completedCount = allLessonIds.filter((id) => completedIds.has(id)).length;
    const progressPercent = Math.round((completedCount / allLessonIds.length) * 100);

    expect(completedCount).toBe(1);
    expect(progressPercent).toBe(33);
  });

  // ── findNextLesson (pure function) ──────────────────────────

  it("returns first incomplete lesson as next", () => {
    const curriculum = [
      {
        id: "mod-1",
        lessons: [
          { id: "l-1", title: "Lesson 1", type: "text" },
          { id: "l-2", title: "Lesson 2", type: "text" },
        ],
      },
      {
        id: "mod-2",
        lessons: [{ id: "l-3", title: "Lesson 3", type: "video" }],
      },
    ];

    const completed = new Set(["l-1"]);
    const next = findNextLesson(curriculum, completed);

    expect(next).toEqual({ id: "l-2", title: "Lesson 2" });
  });

  it("returns first lesson of next module when current module is complete", () => {
    const curriculum = [
      {
        id: "mod-1",
        lessons: [
          { id: "l-1", title: "Lesson 1", type: "text" },
          { id: "l-2", title: "Lesson 2", type: "text" },
        ],
      },
      {
        id: "mod-2",
        lessons: [{ id: "l-3", title: "Lesson 3", type: "video" }],
      },
    ];

    const completed = new Set(["l-1", "l-2"]);
    const next = findNextLesson(curriculum, completed);

    expect(next).toEqual({ id: "l-3", title: "Lesson 3" });
  });

  it("returns last lesson when all lessons are complete", () => {
    const curriculum = [
      {
        id: "mod-1",
        lessons: [
          { id: "l-1", title: "Lesson 1", type: "text" },
          { id: "l-2", title: "Lesson 2", type: "text" },
        ],
      },
      {
        id: "mod-2",
        lessons: [{ id: "l-3", title: "Lesson 3", type: "video" }],
      },
    ];

    const completed = new Set(["l-1", "l-2", "l-3"]);
    const next = findNextLesson(curriculum, completed);

    expect(next).toEqual({ id: "l-3", title: "Lesson 3" });
  });

  it("returns null for empty curriculum", () => {
    const next = findNextLesson([], new Set());
    expect(next).toBeNull();
  });

  it("returns first lesson when nothing is completed", () => {
    const curriculum = [
      {
        id: "mod-1",
        lessons: [{ id: "l-1", title: "First Lesson", type: "text" }],
      },
    ];

    const next = findNextLesson(curriculum, new Set());
    expect(next).toEqual({ id: "l-1", title: "First Lesson" });
  });
});
