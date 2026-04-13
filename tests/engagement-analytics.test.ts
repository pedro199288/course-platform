import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, sql } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
} from "#/db/schema/index.ts";
import { lessonProgress } from "#/db/schema/enrollments.ts";
import { users } from "#/db/schema/auth.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("engagement analytics", () => {
  const subdomain = `analytics-${Date.now()}`;
  let tenantId: string;
  let otherTenantId: string;
  let courseId: string;
  let moduleAId: string;
  let moduleBId: string;
  let lessonA1Id: string;
  let lessonA2Id: string;
  let lessonB1Id: string;
  let emptyCourseId: string;
  const studentId1 = crypto.randomUUID();
  const studentId2 = crypto.randomUUID();
  const studentId3 = crypto.randomUUID();

  beforeAll(async () => {
    // Create tenants
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Analytics School", subdomain })
      .returning();
    tenantId = tenant.id;

    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other Analytics School", subdomain: `other-analytics-${Date.now()}` })
      .returning();
    otherTenantId = otherTenant.id;

    // Create course with modules and lessons
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Analytics Course",
        slug: "analytics-course",
        status: "published",
        price: "49.99",
      })
      .returning();
    courseId = course.id;

    // Empty published course (no modules/lessons)
    const [emptyCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Empty Course",
        slug: "empty-course",
        status: "published",
      })
      .returning();
    emptyCourseId = emptyCourse.id;

    const [modA] = await db
      .insert(modules)
      .values({ courseId, title: "Module A", position: 0 })
      .returning();
    moduleAId = modA.id;

    const [modB] = await db
      .insert(modules)
      .values({ courseId, title: "Module B", position: 1 })
      .returning();
    moduleBId = modB.id;

    const [lessonA1] = await db
      .insert(lessons)
      .values({ moduleId: moduleAId, title: "Lesson A1", position: 0 })
      .returning();
    lessonA1Id = lessonA1.id;

    const [lessonA2] = await db
      .insert(lessons)
      .values({ moduleId: moduleAId, title: "Lesson A2", position: 1 })
      .returning();
    lessonA2Id = lessonA2.id;

    const [lessonB1] = await db
      .insert(lessons)
      .values({ moduleId: moduleBId, title: "Lesson B1", position: 0 })
      .returning();
    lessonB1Id = lessonB1.id;

    // Create users
    await db.insert(users).values([
      {
        id: studentId1,
        tenantId,
        name: "Student 1",
        email: `analytics-s1-${Date.now()}@example.com`,
      },
      {
        id: studentId2,
        tenantId,
        name: "Student 2",
        email: `analytics-s2-${Date.now()}@example.com`,
      },
      {
        id: studentId3,
        tenantId: otherTenantId,
        name: "Student 3",
        email: `analytics-s3-${Date.now()}@example.com`,
      },
    ]);

    // Enroll students
    await db.insert(enrollments).values([
      { tenantId, userId: studentId1, courseId },
      { tenantId, userId: studentId2, courseId },
    ]);

    // Student 1 completed all lessons (course complete)
    await db.insert(lessonProgress).values([
      {
        tenantId,
        userId: studentId1,
        lessonId: lessonA1Id,
        completed: true,
        completedAt: new Date(),
      },
      {
        tenantId,
        userId: studentId1,
        lessonId: lessonA2Id,
        completed: true,
        completedAt: new Date(),
      },
      {
        tenantId,
        userId: studentId1,
        lessonId: lessonB1Id,
        completed: true,
        completedAt: new Date(),
      },
    ]);

    // Student 2 completed only lesson A1
    await db.insert(lessonProgress).values([
      {
        tenantId,
        userId: studentId2,
        lessonId: lessonA1Id,
        completed: true,
        completedAt: new Date(),
      },
    ]);

    // Other tenant data for isolation
    const [otherCourse] = await db
      .insert(courses)
      .values({
        tenantId: otherTenantId,
        title: "Other Course",
        slug: "other-course",
        status: "published",
      })
      .returning();

    const [otherMod] = await db
      .insert(modules)
      .values({ courseId: otherCourse.id, title: "Other Module", position: 0 })
      .returning();

    await db
      .insert(lessons)
      .values({ moduleId: otherMod.id, title: "Other Lesson", position: 0 });

    await db.insert(enrollments).values({
      tenantId: otherTenantId,
      userId: studentId3,
      courseId: otherCourse.id,
    });
  });

  afterAll(async () => {
    // Clean up in reverse dependency order
    for (const tid of [tenantId, otherTenantId]) {
      await db
        .delete(lessonProgress)
        .where(eq(lessonProgress.tenantId, tid))
        .catch(() => {});
      await db
        .delete(enrollments)
        .where(eq(enrollments.tenantId, tid))
        .catch(() => {});
      await db
        .delete(users)
        .where(eq(users.tenantId, tid))
        .catch(() => {});
      await db
        .delete(courses)
        .where(eq(courses.tenantId, tid))
        .catch(() => {});
      await db
        .delete(tenants)
        .where(eq(tenants.id, tid))
        .catch(() => {});
    }
  });

  // ── Course completion rates ──────────────────────────

  describe("course completion rates", () => {
    it("counts enrolled and completed students per course", async () => {
      // Query: for each published course, count enrolled and students who completed all lessons
      const rows = await db
        .select({
          courseId: courses.id,
          courseTitle: courses.title,
          enrolledStudents: sql<number>`count(distinct ${enrollments.userId})::int`,
        })
        .from(courses)
        .leftJoin(
          enrollments,
          and(eq(courses.id, enrollments.courseId), sql`${enrollments.revokedAt} is null`),
        )
        .where(and(eq(courses.tenantId, tenantId), eq(courses.status, "published")))
        .groupBy(courses.id, courses.title);

      const main = rows.find((r) => r.courseId === courseId);
      expect(main?.enrolledStudents).toBe(2);

      const empty = rows.find((r) => r.courseId === emptyCourseId);
      expect(empty?.enrolledStudents).toBe(0);
    });

    it("identifies students who completed all course lessons", async () => {
      // Student 1 completed all 3 lessons, student 2 only 1
      const completionRows = await db
        .select({
          courseId: courses.id,
          userId: enrollments.userId,
        })
        .from(courses)
        .innerJoin(modules, eq(courses.id, modules.courseId))
        .innerJoin(lessons, eq(modules.id, lessons.moduleId))
        .innerJoin(
          enrollments,
          and(eq(courses.id, enrollments.courseId), sql`${enrollments.revokedAt} is null`),
        )
        .leftJoin(
          lessonProgress,
          and(
            eq(lessons.id, lessonProgress.lessonId),
            eq(enrollments.userId, lessonProgress.userId),
            eq(lessonProgress.completed, true),
          ),
        )
        .where(and(eq(courses.id, courseId)))
        .groupBy(courses.id, enrollments.userId)
        .having(sql`count(${lessons.id}) = count(${lessonProgress.id})`);

      // Only student 1 completed all lessons
      expect(completionRows.length).toBe(1);
      expect(completionRows[0].userId).toBe(studentId1);
    });
  });

  // ── Module completion rates ──────────────────────────

  describe("module completion rates", () => {
    it("calculates per-module completion", async () => {
      // Module A has 2 lessons: student1 completed both, student2 completed 1
      // Module B has 1 lesson: student1 completed it, student2 did not
      const completionRows = await db
        .select({
          moduleId: modules.id,
          userId: enrollments.userId,
        })
        .from(modules)
        .innerJoin(lessons, eq(modules.id, lessons.moduleId))
        .innerJoin(
          enrollments,
          and(eq(enrollments.courseId, courseId), sql`${enrollments.revokedAt} is null`),
        )
        .leftJoin(
          lessonProgress,
          and(
            eq(lessons.id, lessonProgress.lessonId),
            eq(enrollments.userId, lessonProgress.userId),
            eq(lessonProgress.completed, true),
          ),
        )
        .where(eq(modules.courseId, courseId))
        .groupBy(modules.id, enrollments.userId)
        .having(sql`count(${lessons.id}) = count(${lessonProgress.id})`);

      const modAComplete = completionRows.filter((r) => r.moduleId === moduleAId);
      const modBComplete = completionRows.filter((r) => r.moduleId === moduleBId);

      // Module A: only student1 completed both lessons
      expect(modAComplete.length).toBe(1);
      expect(modAComplete[0].userId).toBe(studentId1);

      // Module B: student1 completed the one lesson
      expect(modBComplete.length).toBe(1);
      expect(modBComplete[0].userId).toBe(studentId1);
    });
  });

  // ── Lesson drop-off ──────────────────────────

  describe("lesson drop-off", () => {
    it("returns per-lesson completion counts sorted by curriculum order", async () => {
      const lessonRows = await db
        .select({
          lessonId: lessons.id,
          lessonTitle: lessons.title,
          moduleTitle: modules.title,
          completedStudents: sql<number>`count(distinct ${lessonProgress.userId})::int`,
        })
        .from(lessons)
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .leftJoin(
          lessonProgress,
          and(eq(lessons.id, lessonProgress.lessonId), eq(lessonProgress.completed, true)),
        )
        .where(eq(modules.courseId, courseId))
        .groupBy(lessons.id, lessons.title, modules.title);

      const a1 = lessonRows.find((r) => r.lessonId === lessonA1Id);
      const a2 = lessonRows.find((r) => r.lessonId === lessonA2Id);
      const b1 = lessonRows.find((r) => r.lessonId === lessonB1Id);

      // Lesson A1: both students completed
      expect(a1?.completedStudents).toBe(2);
      // Lesson A2: only student1 completed
      expect(a2?.completedStudents).toBe(1);
      // Lesson B1: only student1 completed
      expect(b1?.completedStudents).toBe(1);
    });

    it("surfaces lowest-completion lessons first when sorted", async () => {
      const lessonRows = await db
        .select({
          lessonId: lessons.id,
          completedStudents: sql<number>`count(distinct ${lessonProgress.userId})::int`,
        })
        .from(lessons)
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .leftJoin(
          lessonProgress,
          and(eq(lessons.id, lessonProgress.lessonId), eq(lessonProgress.completed, true)),
        )
        .where(eq(modules.courseId, courseId))
        .groupBy(lessons.id);

      const sorted = [...lessonRows].sort(
        (a, b) => a.completedStudents - b.completedStudents,
      );

      // A2 and B1 both have 1 completion, A1 has 2
      expect(sorted[sorted.length - 1].lessonId).toBe(lessonA1Id);
      expect(sorted[sorted.length - 1].completedStudents).toBe(2);
    });
  });

  // ── Average progress ──────────────────────────

  describe("average progress", () => {
    it("calculates mean progress across enrolled students", async () => {
      const totalLessons = 3; // A1, A2, B1

      // Student1: 3/3 = 100%, Student2: 1/3 = 33.3%
      // Average: (100 + 33.3) / 2 = 66.7%
      const rows = await db
        .select({
          userId: enrollments.userId,
          completedLessons: sql<number>`count(distinct ${lessonProgress.id})::int`,
        })
        .from(enrollments)
        .leftJoin(
          lessonProgress,
          and(
            eq(enrollments.userId, lessonProgress.userId),
            eq(lessonProgress.completed, true),
          ),
        )
        .leftJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
        .leftJoin(modules, eq(lessons.moduleId, modules.id))
        .where(
          and(
            eq(enrollments.courseId, courseId),
            sql`${enrollments.revokedAt} is null`,
            sql`(${modules.courseId} = ${courseId} or ${lessonProgress.id} is null)`,
          ),
        )
        .groupBy(enrollments.userId);

      expect(rows.length).toBe(2);

      const s1 = rows.find((r) => r.userId === studentId1);
      const s2 = rows.find((r) => r.userId === studentId2);
      expect(s1?.completedLessons).toBe(3);
      expect(s2?.completedLessons).toBe(1);

      const avgProgress =
        rows.reduce((sum, r) => sum + r.completedLessons / totalLessons, 0) / rows.length;
      expect(avgProgress).toBeCloseTo(0.667, 2);
    });

    it("returns 0 for course with no lessons", async () => {
      const [{ totalLessons }] = await db
        .select({
          totalLessons: sql<number>`count(*)::int`,
        })
        .from(lessons)
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .where(eq(modules.courseId, emptyCourseId));

      expect(totalLessons).toBe(0);
    });
  });

  // ── Tenant isolation ──────────────────────────

  describe("tenant isolation", () => {
    it("only returns courses for the scoped tenant", async () => {
      const rows = await db
        .select({ courseId: courses.id })
        .from(courses)
        .where(and(eq(courses.tenantId, tenantId), eq(courses.status, "published")));

      const otherRows = await db
        .select({ courseId: courses.id })
        .from(courses)
        .where(and(eq(courses.tenantId, otherTenantId), eq(courses.status, "published")));

      // Our tenant has 2 published courses, other has 1
      expect(rows.length).toBe(2);
      expect(otherRows.length).toBe(1);
      expect(rows.every((r) => r.courseId !== otherRows[0].courseId)).toBe(true);
    });
  });
});
