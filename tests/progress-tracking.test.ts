import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  lessonProgress,
} from "#/db/schema/index.ts";
import { deriveCourseCompletion } from "#/lib/progress-actions.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("progress tracking", () => {
  const subdomain = `progress-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let module1Id: string;
  let module2Id: string;
  let lesson1Id: string;
  let lesson2Id: string;
  let lesson3Id: string;
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Progress Test School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Create published course
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Progress Course",
        slug: "progress-course",
        status: "published",
        price: "19.99",
      })
      .returning();
    courseId = course.id;

    // Create two modules with lessons
    const [mod1] = await db
      .insert(modules)
      .values({ courseId, title: "Module 1", position: 0 })
      .returning();
    module1Id = mod1.id;

    const [mod2] = await db
      .insert(modules)
      .values({ courseId, title: "Module 2", position: 1 })
      .returning();
    module2Id = mod2.id;

    const [l1] = await db
      .insert(lessons)
      .values({
        moduleId: module1Id,
        title: "Lesson 1",
        type: "text",
        content: { text: "Content 1" },
        position: 0,
      })
      .returning();
    lesson1Id = l1.id;

    const [l2] = await db
      .insert(lessons)
      .values({
        moduleId: module1Id,
        title: "Lesson 2",
        type: "text",
        content: { text: "Content 2" },
        position: 1,
      })
      .returning();
    lesson2Id = l2.id;

    const [l3] = await db
      .insert(lessons)
      .values({
        moduleId: module2Id,
        title: "Lesson 3",
        type: "text",
        content: { text: "Content 3" },
        position: 0,
      })
      .returning();
    lesson3Id = l3.id;

    // Enroll the user
    await db.insert(enrollments).values({
      tenantId,
      userId,
      courseId,
    });
  });

  afterAll(async () => {
    await db
      .delete(lessonProgress)
      .where(eq(lessonProgress.tenantId, tenantId))
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

  // ── Lesson progress storage ──────────────────────────

  it("stores lesson progress record", async () => {
    await db.insert(lessonProgress).values({
      tenantId,
      userId,
      lessonId: lesson1Id,
      completed: true,
      completedAt: new Date(),
    });

    const [record] = await db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.lessonId, lesson1Id),
        ),
      );

    expect(record).toBeDefined();
    expect(record.completed).toBe(true);
    expect(record.completedAt).toBeTruthy();
    expect(record.tenantId).toBe(tenantId);
  });

  it("enforces unique constraint on user + lesson", async () => {
    // Inserting same user+lesson again should conflict
    await expect(
      db.insert(lessonProgress).values({
        tenantId,
        userId,
        lessonId: lesson1Id,
        completed: true,
        completedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("supports upsert via onConflictDoUpdate", async () => {
    // First, the record exists from the first test.
    // Upsert should update without error.
    await db
      .insert(lessonProgress)
      .values({
        tenantId,
        userId,
        lessonId: lesson1Id,
        completed: true,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: { completed: true, completedAt: new Date() },
      });

    const [record] = await db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.lessonId, lesson1Id),
        ),
      );

    expect(record).toBeDefined();
    expect(record.completed).toBe(true);
  });

  // ── Query progress for a course ──────────────────────────

  it("retrieves completed lessons for a user in a course", async () => {
    // Mark lesson2 complete as well
    await db.insert(lessonProgress).values({
      tenantId,
      userId,
      lessonId: lesson2Id,
      completed: true,
      completedAt: new Date(),
    });

    // Query all completed lessons for this user and tenant
    const completed = await db
      .select({ lessonId: lessonProgress.lessonId })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.tenantId, tenantId),
          eq(lessonProgress.completed, true),
        ),
      );

    const completedIds = completed.map((c) => c.lessonId);
    expect(completedIds).toContain(lesson1Id);
    expect(completedIds).toContain(lesson2Id);
    expect(completedIds).not.toContain(lesson3Id);
  });

  // ── Tenant isolation ──────────────────────────

  it("isolates progress by tenant", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other School", subdomain: `other-progress-${Date.now()}` })
      .returning();

    const completedInOther = await db
      .select({ lessonId: lessonProgress.lessonId })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.tenantId, otherTenant.id),
          eq(lessonProgress.completed, true),
        ),
      );

    expect(completedInOther.length).toBe(0);

    await db.delete(tenants).where(eq(tenants.id, otherTenant.id));
  });

  // ── Course completion derivation (pure function) ──────────────────────────

  it("derives module completion from lesson progress", () => {
    const curriculum = [
      { id: "mod-1", lessons: [{ id: "l-1" }, { id: "l-2" }] },
      { id: "mod-2", lessons: [{ id: "l-3" }] },
    ];
    const completedSet = new Set(["l-1", "l-2"]);

    const result = deriveCourseCompletion(curriculum, completedSet);

    expect(result.moduleStats[0].isComplete).toBe(true);
    expect(result.moduleStats[1].isComplete).toBe(false);
    expect(result.isCourseComplete).toBe(false);
    expect(result.completedLessons).toBe(2);
    expect(result.totalLessons).toBe(3);
    expect(result.progressPercent).toBe(67);
  });

  it("derives course completion when all lessons are done", () => {
    const curriculum = [
      { id: "mod-1", lessons: [{ id: "l-1" }, { id: "l-2" }] },
      { id: "mod-2", lessons: [{ id: "l-3" }] },
    ];
    const completedSet = new Set(["l-1", "l-2", "l-3"]);

    const result = deriveCourseCompletion(curriculum, completedSet);

    expect(result.moduleStats[0].isComplete).toBe(true);
    expect(result.moduleStats[1].isComplete).toBe(true);
    expect(result.isCourseComplete).toBe(true);
    expect(result.completedLessons).toBe(3);
    expect(result.totalLessons).toBe(3);
    expect(result.progressPercent).toBe(100);
  });

  it("handles empty curriculum gracefully", () => {
    const result = deriveCourseCompletion([], new Set());
    expect(result.isCourseComplete).toBe(false);
    expect(result.totalLessons).toBe(0);
    expect(result.progressPercent).toBe(0);
  });

  it("handles modules with no lessons", () => {
    const curriculum = [{ id: "mod-1", lessons: [] as { id: string }[] }];
    const result = deriveCourseCompletion(curriculum, new Set());

    expect(result.moduleStats[0].isComplete).toBe(false);
    expect(result.isCourseComplete).toBe(false);
    expect(result.totalLessons).toBe(0);
  });
});
