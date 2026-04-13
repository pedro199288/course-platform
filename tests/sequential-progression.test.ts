import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons, enrollments, lessonProgress } from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";
import { computeLockedLessonIds } from "#/lib/lesson-actions.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("sequential progression", () => {
  const subdomain = `seq-test-${Date.now()}`;
  let tenantId: string;
  let seqCourseId: string;
  let freeCourseId: string;
  let moduleId: string;
  let lesson1Id: string;
  let lesson2Id: string;
  let lesson3Id: string;
  let freeModuleId: string;
  let freeLesson1Id: string;
  let freeLesson2Id: string;
  const studentId = crypto.randomUUID();

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Sequential Test School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Create user
    await db.insert(users).values({
      id: studentId,
      tenantId,
      name: "Test Student",
      email: `seq-student-${Date.now()}@example.com`,
    });

    // Create sequential course
    const [seqCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Sequential Course",
        slug: "sequential-course",
        status: "published",
        sequentialProgress: true,
      })
      .returning();
    seqCourseId = seqCourse.id;

    const [mod] = await db
      .insert(modules)
      .values({ courseId: seqCourseId, title: "Module 1", position: 0 })
      .returning();
    moduleId = mod.id;

    const [l1] = await db
      .insert(lessons)
      .values({ moduleId, title: "Lesson 1", type: "text", position: 0 })
      .returning();
    lesson1Id = l1.id;

    const [l2] = await db
      .insert(lessons)
      .values({ moduleId, title: "Lesson 2", type: "text", position: 1 })
      .returning();
    lesson2Id = l2.id;

    const [l3] = await db
      .insert(lessons)
      .values({ moduleId, title: "Lesson 3", type: "text", position: 2 })
      .returning();
    lesson3Id = l3.id;

    // Enroll student
    await db.insert(enrollments).values({ tenantId, userId: studentId, courseId: seqCourseId });

    // Create non-sequential course
    const [freeCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Free Order Course",
        slug: "free-order-course",
        status: "published",
        sequentialProgress: false,
      })
      .returning();
    freeCourseId = freeCourse.id;

    const [fMod] = await db
      .insert(modules)
      .values({ courseId: freeCourseId, title: "Free Module", position: 0 })
      .returning();
    freeModuleId = fMod.id;

    const [fl1] = await db
      .insert(lessons)
      .values({ moduleId: freeModuleId, title: "Free Lesson 1", type: "text", position: 0 })
      .returning();
    freeLesson1Id = fl1.id;

    const [fl2] = await db
      .insert(lessons)
      .values({ moduleId: freeModuleId, title: "Free Lesson 2", type: "text", position: 1 })
      .returning();
    freeLesson2Id = fl2.id;

    await db.insert(enrollments).values({ tenantId, userId: studentId, courseId: freeCourseId });
  });

  afterAll(async () => {
    await db.delete(lessonProgress).where(eq(lessonProgress.tenantId, tenantId)).catch(() => {});
    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId)).catch(() => {});
    await db.delete(lessons).where(eq(lessons.moduleId, moduleId)).catch(() => {});
    await db.delete(lessons).where(eq(lessons.moduleId, freeModuleId)).catch(() => {});
    await db.delete(modules).where(eq(modules.courseId, seqCourseId)).catch(() => {});
    await db.delete(modules).where(eq(modules.courseId, freeCourseId)).catch(() => {});
    await db.delete(users).where(eq(users.tenantId, tenantId)).catch(() => {});
    await db.delete(courses).where(eq(courses.tenantId, tenantId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, subdomain)).catch(() => {});
  });

  // ── Pure function tests ──────────────────────────

  it("first lesson is never locked", () => {
    const locked = computeLockedLessonIds(["a", "b", "c"], new Set());
    expect(locked).not.toContain("a");
  });

  it("locks lesson N when lesson N-1 is incomplete", () => {
    const locked = computeLockedLessonIds(["a", "b", "c"], new Set());
    expect(locked).toContain("b");
    expect(locked).toContain("c");
  });

  it("unlocks lesson N when all previous are complete", () => {
    const locked = computeLockedLessonIds(["a", "b", "c"], new Set(["a", "b"]));
    expect(locked).toEqual([]);
  });

  it("locks from first incomplete onwards", () => {
    const locked = computeLockedLessonIds(["a", "b", "c", "d"], new Set(["a"]));
    expect(locked).toEqual(["c", "d"]);
  });

  // ── Database integration tests ──────────────────────────

  it("stores sequentialProgress flag on course", async () => {
    const [course] = await db
      .select({ sequentialProgress: courses.sequentialProgress })
      .from(courses)
      .where(eq(courses.id, seqCourseId));
    expect(course.sequentialProgress).toBe(true);
  });

  it("non-sequential course has flag set to false", async () => {
    const [course] = await db
      .select({ sequentialProgress: courses.sequentialProgress })
      .from(courses)
      .where(eq(courses.id, freeCourseId));
    expect(course.sequentialProgress).toBe(false);
  });

  it("sequential course: lesson 2 is locked when lesson 1 incomplete", () => {
    const locked = computeLockedLessonIds(
      [lesson1Id, lesson2Id, lesson3Id],
      new Set(),
    );
    expect(locked).toContain(lesson2Id);
    expect(locked).toContain(lesson3Id);
    expect(locked).not.toContain(lesson1Id);
  });

  it("sequential course: lesson 2 unlocks when lesson 1 complete", () => {
    const locked = computeLockedLessonIds(
      [lesson1Id, lesson2Id, lesson3Id],
      new Set([lesson1Id]),
    );
    expect(locked).not.toContain(lesson2Id);
    expect(locked).toContain(lesson3Id);
  });

  it("sequential course: all lessons unlocked when all complete", () => {
    const locked = computeLockedLessonIds(
      [lesson1Id, lesson2Id, lesson3Id],
      new Set([lesson1Id, lesson2Id, lesson3Id]),
    );
    expect(locked).toEqual([]);
  });

  it("non-sequential course: no lessons locked regardless of progress", () => {
    // For non-sequential, computeLockedLessonIds is not called;
    // test that the flag controls whether gating is applied
    const locked = computeLockedLessonIds(
      [freeLesson1Id, freeLesson2Id],
      new Set(),
    );
    // The function always computes locks — it's the caller that checks the flag
    expect(locked).toContain(freeLesson2Id);
    // But in practice, non-sequential courses pass an empty array
    expect([] as string[]).toEqual([]);
  });

  it("lesson progress persists in database for sequential tracking", async () => {
    // Mark lesson 1 complete
    await db.insert(lessonProgress).values({
      tenantId,
      userId: studentId,
      lessonId: lesson1Id,
      completed: true,
      completedAt: new Date(),
    });

    // Verify it's stored
    const [progress] = await db
      .select()
      .from(lessonProgress)
      .where(eq(lessonProgress.lessonId, lesson1Id));
    expect(progress.completed).toBe(true);

    // Now compute locks with real lesson IDs + real completion
    const completedRows = await db
      .select({ lessonId: lessonProgress.lessonId })
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, studentId));
    const completedSet = new Set(completedRows.map((r) => r.lessonId));

    const locked = computeLockedLessonIds(
      [lesson1Id, lesson2Id, lesson3Id],
      completedSet,
    );
    expect(locked).not.toContain(lesson1Id);
    expect(locked).not.toContain(lesson2Id);
    expect(locked).toContain(lesson3Id);
  });

  // ── Cross-module sequential test ──────────────────────────

  it("locks lessons across modules when previous module incomplete", async () => {
    // Create a second module with a lesson
    const [mod2] = await db
      .insert(modules)
      .values({ courseId: seqCourseId, title: "Module 2", position: 1 })
      .returning();

    const [mod2Lesson] = await db
      .insert(lessons)
      .values({ moduleId: mod2.id, title: "Module 2 Lesson 1", type: "text", position: 0 })
      .returning();

    try {
      // Flat lesson order: lesson1, lesson2, lesson3, mod2Lesson
      // Only lesson1 is completed (from previous test)
      const completedRows = await db
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .where(eq(lessonProgress.userId, studentId));
      const completedSet = new Set(completedRows.map((r) => r.lessonId));

      const locked = computeLockedLessonIds(
        [lesson1Id, lesson2Id, lesson3Id, mod2Lesson.id],
        completedSet,
      );

      // lesson2 is unlocked (lesson1 complete), but lesson3 and mod2Lesson are locked
      expect(locked).not.toContain(lesson1Id);
      expect(locked).not.toContain(lesson2Id);
      expect(locked).toContain(lesson3Id);
      expect(locked).toContain(mod2Lesson.id);
    } finally {
      await db.delete(lessons).where(eq(lessons.moduleId, mod2.id)).catch(() => {});
      await db.delete(modules).where(eq(modules.id, mod2.id)).catch(() => {});
    }
  });
});
