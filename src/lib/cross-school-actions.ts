import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, asc, isNull, inArray } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  courses,
  modules,
  lessons,
  enrollments,
  lessonProgress,
  tenants,
  userTenants,
} from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { PLATFORM_DOMAIN } from "./config.ts";
import { findNextLesson } from "./dashboard-actions.ts";

async function requireAuth() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");
  return session.user as { id: string };
}

/**
 * Core logic: fetch all enrollments across all schools for a given user.
 * Extracted for testability (createServerFn wrappers can't be called in tests).
 */
export async function getCrossSchoolDashboard(userId: string) {
  // Get all tenant memberships for this user
  const memberships = await db
    .select({
      tenantId: userTenants.tenantId,
      role: userTenants.role,
    })
    .from(userTenants)
    .where(eq(userTenants.userId, userId));

  if (memberships.length === 0) {
    return { schools: [] };
  }

  const tenantIds = memberships.map((m) => m.tenantId);
  const membershipMap = new Map(memberships.map((m) => [m.tenantId, m.role]));

  // Get all active enrollments across all tenants
  const allEnrollments = await db
    .select({
      courseId: enrollments.courseId,
      tenantId: enrollments.tenantId,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        inArray(enrollments.tenantId, tenantIds),
        isNull(enrollments.revokedAt),
      ),
    );

  if (allEnrollments.length === 0) {
    return { schools: [] };
  }

  // Get tenant details
  const tenantDetails = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      subdomain: tenants.subdomain,
      logoUrl: tenants.logoUrl,
    })
    .from(tenants)
    .where(inArray(tenants.id, tenantIds));

  const tenantMap = new Map(tenantDetails.map((t) => [t.id, t]));

  // Get course details for all enrolled courses
  const courseIds = allEnrollments.map((e) => e.courseId);
  const courseDetails = await db
    .select({
      id: courses.id,
      tenantId: courses.tenantId,
      title: courses.title,
      slug: courses.slug,
      thumbnailUrl: courses.thumbnailUrl,
    })
    .from(courses)
    .where(inArray(courses.id, courseIds));

  const courseMap = new Map(courseDetails.map((c) => [c.id, c]));

  // For each course, load curriculum + progress
  const coursesWithProgress = await Promise.all(
    allEnrollments.map(async (enrollment) => {
      const course = courseMap.get(enrollment.courseId);
      if (!course) return null;

      // Load curriculum
      const courseModules = await db
        .select({ id: modules.id, position: modules.position })
        .from(modules)
        .where(eq(modules.courseId, course.id))
        .orderBy(asc(modules.position));

      const curriculum = await Promise.all(
        courseModules.map(async (m) => {
          const modLessons = await db
            .select({
              id: lessons.id,
              title: lessons.title,
              type: lessons.type,
              position: lessons.position,
            })
            .from(lessons)
            .where(eq(lessons.moduleId, m.id))
            .orderBy(asc(lessons.position));
          return { ...m, lessons: modLessons };
        }),
      );

      const allLessonIds = curriculum.flatMap((m) => m.lessons.map((l) => l.id));
      const totalLessons = allLessonIds.length;

      let completedCount = 0;
      let nextLesson: { id: string; title: string } | null = null;

      if (totalLessons > 0) {
        const completedRows = await db
          .select({ lessonId: lessonProgress.lessonId })
          .from(lessonProgress)
          .where(
            and(
              eq(lessonProgress.userId, userId),
              eq(lessonProgress.tenantId, enrollment.tenantId),
              eq(lessonProgress.completed, true),
              inArray(lessonProgress.lessonId, allLessonIds),
            ),
          );
        completedCount = completedRows.length;
        const completedSet = new Set(completedRows.map((r) => r.lessonId));
        nextLesson = findNextLesson(curriculum, completedSet);
      }

      const progressPercent =
        totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

      return {
        courseId: course.id,
        courseTitle: course.title,
        courseSlug: course.slug,
        thumbnailUrl: course.thumbnailUrl,
        tenantId: enrollment.tenantId,
        enrolledAt: enrollment.enrolledAt,
        totalLessons,
        completedCount,
        progressPercent,
        nextLesson,
      };
    }),
  );

  // Group by tenant
  const schoolMap = new Map<
    string,
    {
      tenantId: string;
      name: string;
      subdomain: string;
      logoUrl: string | null;
      role: string;
      url: string;
      courses: NonNullable<(typeof coursesWithProgress)[number]>[];
    }
  >();

  for (const course of coursesWithProgress) {
    if (!course) continue;
    const tenant = tenantMap.get(course.tenantId);
    if (!tenant) continue;

    if (!schoolMap.has(course.tenantId)) {
      schoolMap.set(course.tenantId, {
        tenantId: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        logoUrl: tenant.logoUrl,
        role: membershipMap.get(tenant.id) ?? "student",
        url: `https://${tenant.subdomain}.${PLATFORM_DOMAIN}`,
        courses: [],
      });
    }
    schoolMap.get(course.tenantId)!.courses.push(course);
  }

  return { schools: Array.from(schoolMap.values()) };
}

/**
 * Server function wrapper for getCrossSchoolDashboard.
 */
export const getCrossSchoolDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuth();
  return getCrossSchoolDashboard(user.id);
});
