import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, enrollments, payments } from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";
import { auth } from "./auth.ts";

async function requireAdmin() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as { id: string; role: string; tenantId: string };
  if (!["platform_admin", "tenant_owner", "tenant_admin"].includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
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
