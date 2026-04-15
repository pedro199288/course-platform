import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, sql, desc, isNull, asc } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, modules, lessons, enrollments, payments } from "#/db/schema/index.ts";
import { lessonProgress } from "#/db/schema/enrollments.ts";
import { users } from "#/db/schema/auth.ts";
import { auth } from "./auth.ts";
import { tenantIdStore } from "./tenant-context.ts";

async function requireAdmin() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as { id: string; role: string };
  if (!["platform_admin", "tenant_owner", "tenant_admin"].includes(user.role)) {
    throw new Error("Forbidden");
  }
  const tenantId = tenantIdStore.getStore()!;
  return { ...user, tenantId };
}

export interface DashboardMetrics {
  totalCourses: number;
  publishedCourses: number;
  draftCourses: number;
  totalStudents: number;
  totalRevenue: string;
  recentEnrollments: Array<{
    id: string;
    userName: string | null;
    userEmail: string;
    courseTitle: string;
    enrolledAt: Date;
  }>;
  perCourseStats: Array<{
    courseId: string;
    courseTitle: string;
    status: "draft" | "published";
    enrolledStudents: number;
    revenue: string;
  }>;
}

export const getInstructorDashboardFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardMetrics> => {
    const user = await requireAdmin();
    const tenantId = user.tenantId;

    // Run independent queries in parallel
    const [
      courseStats,
      studentCount,
      revenueResult,
      recentEnrollmentRows,
      perCourseEnrollments,
      perCourseRevenue,
    ] = await Promise.all([
      // Course counts by status
      db
        .select({
          status: courses.status,
          count: sql<number>`count(*)::int`,
        })
        .from(courses)
        .where(eq(courses.tenantId, tenantId))
        .groupBy(courses.status),

      // Total unique students (from non-revoked enrollments)
      db
        .select({
          count: sql<number>`count(distinct ${enrollments.userId})::int`,
        })
        .from(enrollments)
        .where(and(eq(enrollments.tenantId, tenantId), isNull(enrollments.revokedAt))),

      // Total revenue
      db
        .select({
          total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(eq(payments.tenantId, tenantId)),

      // Recent enrollments (last 10) with user and course info
      db
        .select({
          id: enrollments.id,
          userName: users.name,
          userEmail: users.email,
          courseTitle: courses.title,
          enrolledAt: enrollments.enrolledAt,
        })
        .from(enrollments)
        .innerJoin(users, eq(enrollments.userId, users.id))
        .innerJoin(courses, eq(enrollments.courseId, courses.id))
        .where(and(eq(enrollments.tenantId, tenantId), isNull(enrollments.revokedAt)))
        .orderBy(desc(enrollments.enrolledAt))
        .limit(10),

      // Per-course enrollment counts
      db
        .select({
          courseId: courses.id,
          courseTitle: courses.title,
          status: courses.status,
          enrolledStudents: sql<number>`count(${enrollments.id})::int`,
        })
        .from(courses)
        .leftJoin(
          enrollments,
          and(eq(courses.id, enrollments.courseId), isNull(enrollments.revokedAt)),
        )
        .where(eq(courses.tenantId, tenantId))
        .groupBy(courses.id, courses.title, courses.status),

      // Per-course revenue
      db
        .select({
          courseId: payments.courseId,
          revenue: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(eq(payments.tenantId, tenantId))
        .groupBy(payments.courseId),
    ]);

    // Aggregate course counts
    const publishedCourses = courseStats.find((s) => s.status === "published")?.count ?? 0;
    const draftCourses = courseStats.find((s) => s.status === "draft")?.count ?? 0;
    const totalCourses = publishedCourses + draftCourses;

    // Build per-course revenue map
    const revenueMap = new Map(perCourseRevenue.map((r) => [r.courseId, r.revenue]));

    // Merge per-course stats
    const perCourseStats = perCourseEnrollments.map((c) => ({
      courseId: c.courseId,
      courseTitle: c.courseTitle,
      status: c.status,
      enrolledStudents: c.enrolledStudents,
      revenue: revenueMap.get(c.courseId) ?? "0",
    }));

    return {
      totalCourses,
      publishedCourses,
      draftCourses,
      totalStudents: studentCount[0].count,
      totalRevenue: revenueResult[0].total,
      recentEnrollments: recentEnrollmentRows,
      perCourseStats,
    };
  },
);

// ── Engagement Analytics ──────────────────────────

export interface CourseCompletionRate {
  courseId: string;
  courseTitle: string;
  enrolledStudents: number;
  completedStudents: number;
  completionRate: number;
}

export const getCourseCompletionRatesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<CourseCompletionRate[]> => {
    const user = await requireAdmin();
    const tenantId = user.tenantId;

    // For each published course, count enrolled students and students who completed all lessons.
    // A student "completed" a course when they have a completed lessonProgress row for every lesson in the course.
    const rows = await db
      .select({
        courseId: courses.id,
        courseTitle: courses.title,
        enrolledStudents: sql<number>`count(distinct ${enrollments.userId})::int`,
      })
      .from(courses)
      .leftJoin(
        enrollments,
        and(eq(courses.id, enrollments.courseId), isNull(enrollments.revokedAt)),
      )
      .where(and(eq(courses.tenantId, tenantId), eq(courses.status, "published")))
      .groupBy(courses.id, courses.title);

    if (rows.length === 0) return [];

    // For each course, count how many enrolled students completed ALL lessons
    const completionCounts = await db
      .select({
        courseId: courses.id,
        completedStudents: sql<number>`count(distinct ${enrollments.userId})::int`,
      })
      .from(courses)
      .innerJoin(modules, eq(courses.id, modules.courseId))
      .innerJoin(lessons, eq(modules.id, lessons.moduleId))
      .innerJoin(
        enrollments,
        and(eq(courses.id, enrollments.courseId), isNull(enrollments.revokedAt)),
      )
      .leftJoin(
        lessonProgress,
        and(
          eq(lessons.id, lessonProgress.lessonId),
          eq(enrollments.userId, lessonProgress.userId),
          eq(lessonProgress.completed, true),
        ),
      )
      .where(and(eq(courses.tenantId, tenantId), eq(courses.status, "published")))
      .groupBy(courses.id, enrollments.userId)
      .having(sql`count(${lessons.id}) = count(${lessonProgress.id})`)
      .then((studentRows) => {
        // Group by courseId and count distinct students
        const map = new Map<string, number>();
        for (const row of studentRows) {
          map.set(row.courseId, (map.get(row.courseId) ?? 0) + 1);
        }
        return map;
      });

    return rows.map((row) => {
      const completedStudents = completionCounts.get(row.courseId) ?? 0;
      return {
        courseId: row.courseId,
        courseTitle: row.courseTitle,
        enrolledStudents: row.enrolledStudents,
        completedStudents,
        completionRate: row.enrolledStudents > 0 ? completedStudents / row.enrolledStudents : 0,
      };
    });
  },
);

export interface ModuleCompletionRate {
  moduleId: string;
  moduleTitle: string;
  position: number;
  enrolledStudents: number;
  completedStudents: number;
  completionRate: number;
}

export const getModuleCompletionRatesFn = createServerFn({ method: "POST" })
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data }): Promise<ModuleCompletionRate[]> => {
    const user = await requireAdmin();
    const tenantId = user.tenantId;
    const { courseId } = data;

    // Verify course belongs to tenant
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)));
    if (!course) throw new Error("Course not found");

    // Count enrolled students
    const [{ enrolledStudents }] = await db
      .select({
        enrolledStudents: sql<number>`count(distinct ${enrollments.userId})::int`,
      })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), isNull(enrollments.revokedAt)));

    // For each module, count students who completed ALL lessons in that module
    const moduleRows = await db
      .select({
        moduleId: modules.id,
        moduleTitle: modules.title,
        position: modules.position,
        totalLessons: sql<number>`count(distinct ${lessons.id})::int`,
      })
      .from(modules)
      .innerJoin(lessons, eq(modules.id, lessons.moduleId))
      .where(eq(modules.courseId, courseId))
      .groupBy(modules.id, modules.title, modules.position)
      .orderBy(asc(modules.position));

    if (moduleRows.length === 0 || enrolledStudents === 0) {
      return moduleRows.map((m) => ({
        moduleId: m.moduleId,
        moduleTitle: m.moduleTitle,
        position: m.position,
        enrolledStudents,
        completedStudents: 0,
        completionRate: 0,
      }));
    }

    // For each module, find students who completed all lessons
    const completionRows = await db
      .select({
        moduleId: modules.id,
        userId: enrollments.userId,
        completedLessons: sql<number>`count(${lessonProgress.id})::int`,
        totalLessons: sql<number>`count(${lessons.id})::int`,
      })
      .from(modules)
      .innerJoin(lessons, eq(modules.id, lessons.moduleId))
      .innerJoin(
        enrollments,
        and(eq(enrollments.courseId, courseId), isNull(enrollments.revokedAt)),
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

    const moduleCompletionMap = new Map<string, number>();
    for (const row of completionRows) {
      moduleCompletionMap.set(row.moduleId, (moduleCompletionMap.get(row.moduleId) ?? 0) + 1);
    }

    return moduleRows.map((m) => {
      const completedStudents = moduleCompletionMap.get(m.moduleId) ?? 0;
      return {
        moduleId: m.moduleId,
        moduleTitle: m.moduleTitle,
        position: m.position,
        enrolledStudents,
        completedStudents,
        completionRate: enrolledStudents > 0 ? completedStudents / enrolledStudents : 0,
      };
    });
  });

export interface LessonDropOff {
  lessonId: string;
  lessonTitle: string;
  moduleTitle: string;
  position: number;
  modulePosition: number;
  enrolledStudents: number;
  completedStudents: number;
  completionRate: number;
}

export const getLessonDropOffFn = createServerFn({ method: "POST" })
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data }): Promise<LessonDropOff[]> => {
    const user = await requireAdmin();
    const tenantId = user.tenantId;
    const { courseId } = data;

    // Verify course belongs to tenant
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)));
    if (!course) throw new Error("Course not found");

    // Count enrolled students
    const [{ enrolledStudents }] = await db
      .select({
        enrolledStudents: sql<number>`count(distinct ${enrollments.userId})::int`,
      })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), isNull(enrollments.revokedAt)));

    // Get per-lesson completion counts
    const lessonRows = await db
      .select({
        lessonId: lessons.id,
        lessonTitle: lessons.title,
        moduleTitle: modules.title,
        position: lessons.position,
        modulePosition: modules.position,
        completedStudents: sql<number>`count(distinct ${lessonProgress.userId})::int`,
      })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .leftJoin(
        lessonProgress,
        and(eq(lessons.id, lessonProgress.lessonId), eq(lessonProgress.completed, true)),
      )
      .where(eq(modules.courseId, courseId))
      .groupBy(lessons.id, lessons.title, lessons.position, modules.title, modules.position)
      .orderBy(asc(modules.position), asc(lessons.position));

    return lessonRows.map((row) => ({
      lessonId: row.lessonId,
      lessonTitle: row.lessonTitle,
      moduleTitle: row.moduleTitle,
      position: row.position,
      modulePosition: row.modulePosition,
      enrolledStudents,
      completedStudents: row.completedStudents,
      completionRate: enrolledStudents > 0 ? row.completedStudents / enrolledStudents : 0,
    }));
  });

export interface AverageProgress {
  courseId: string;
  courseTitle: string;
  totalLessons: number;
  enrolledStudents: number;
  averageProgress: number;
}

export const getAverageProgressFn = createServerFn({ method: "POST" })
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data }): Promise<AverageProgress> => {
    const user = await requireAdmin();
    const tenantId = user.tenantId;
    const { courseId } = data;

    // Verify course belongs to tenant and get title
    const [course] = await db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)));
    if (!course) throw new Error("Course not found");

    // Count total lessons
    const [{ totalLessons }] = await db
      .select({
        totalLessons: sql<number>`count(*)::int`,
      })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, courseId));

    if (totalLessons === 0) {
      return {
        courseId,
        courseTitle: course.title,
        totalLessons: 0,
        enrolledStudents: 0,
        averageProgress: 0,
      };
    }

    // For each enrolled student, count completed lessons in this course
    const rows = await db
      .select({
        userId: enrollments.userId,
        completedLessons: sql<number>`count(distinct ${lessonProgress.id})::int`,
      })
      .from(enrollments)
      .leftJoin(
        lessonProgress,
        and(eq(enrollments.userId, lessonProgress.userId), eq(lessonProgress.completed, true)),
      )
      .leftJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
      .leftJoin(modules, eq(lessons.moduleId, modules.id))
      .where(
        and(
          eq(enrollments.courseId, courseId),
          isNull(enrollments.revokedAt),
          sql`(${modules.courseId} = ${courseId} or ${lessonProgress.id} is null)`,
        ),
      )
      .groupBy(enrollments.userId);

    const enrolledStudents = rows.length;
    if (enrolledStudents === 0) {
      return {
        courseId,
        courseTitle: course.title,
        totalLessons,
        enrolledStudents: 0,
        averageProgress: 0,
      };
    }

    const totalProgress = rows.reduce((sum, row) => sum + row.completedLessons / totalLessons, 0);

    return {
      courseId,
      courseTitle: course.title,
      totalLessons,
      enrolledStudents,
      averageProgress: totalProgress / enrolledStudents,
    };
  });
