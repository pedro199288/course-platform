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
  subscriptions,
  tenants,
} from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";

/**
 * Resolve tenant from request headers.
 */
async function requireTenant() {
  const request = getRequest();
  const host = request.headers.get("x-tenant") ?? request.headers.get("host") ?? "";
  const subdomain = extractSubdomain(host);
  if (!subdomain) throw new Error("No tenant");

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.subdomain, subdomain),
    columns: { id: true, name: true, subdomain: true },
  });
  if (!tenant) throw new Error("Tenant not found");
  return tenant;
}

/**
 * Require an authenticated user session.
 */
async function requireAuth() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");
  return session.user as { id: string; tenantId: string };
}

/**
 * Find the next incomplete lesson for a course given the curriculum and completed set.
 * Returns the first lesson (in module/position order) that is not in completedLessonIds.
 */
export function findNextLesson(
  curriculum: Array<{
    id: string;
    lessons: Array<{ id: string; title: string; type: string }>;
  }>,
  completedLessonIds: Set<string>,
): { id: string; title: string } | null {
  for (const mod of curriculum) {
    for (const lesson of mod.lessons) {
      if (!completedLessonIds.has(lesson.id)) {
        return { id: lesson.id, title: lesson.title };
      }
    }
  }
  // All lessons complete — return the last lesson
  const lastMod = curriculum[curriculum.length - 1];
  if (lastMod && lastMod.lessons.length > 0) {
    const last = lastMod.lessons[lastMod.lessons.length - 1];
    return { id: last.id, title: last.title };
  }
  return null;
}

/**
 * Get all enrolled courses for the current student with progress data.
 * Returns courses with progress percentage and next-lesson link.
 */
export const getStudentDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  const tenant = await requireTenant();
  const user = await requireAuth();

  // Get all active enrollments for this user+tenant
  const userEnrollments = await db
    .select({
      courseId: enrollments.courseId,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, user.id),
        eq(enrollments.tenantId, tenant.id),
        isNull(enrollments.revokedAt),
      ),
    );

  // Also check for active subscription (grants access to all courses)
  const [activeSub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, user.id),
        eq(subscriptions.tenantId, tenant.id),
        eq(subscriptions.status, "active"),
      ),
    );

  // Determine which courses the user has access to
  let accessibleCourseIds: string[];
  let enrollmentDates: Map<string, Date>;

  if (activeSub) {
    // Subscriber: access to all published courses
    const allPublished = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.tenantId, tenant.id), eq(courses.status, "published")));
    accessibleCourseIds = allPublished.map((c) => c.id);
    enrollmentDates = new Map(userEnrollments.map((e) => [e.courseId, e.enrolledAt]));
  } else {
    accessibleCourseIds = userEnrollments.map((e) => e.courseId);
    enrollmentDates = new Map(userEnrollments.map((e) => [e.courseId, e.enrolledAt]));
  }

  if (accessibleCourseIds.length === 0) {
    return { courses: [], hasSubscription: !!activeSub };
  }

  // Load course details
  const enrolledCourses = await db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      thumbnailUrl: courses.thumbnailUrl,
      description: courses.description,
    })
    .from(courses)
    .where(
      and(
        eq(courses.tenantId, tenant.id),
        eq(courses.status, "published"),
        inArray(courses.id, accessibleCourseIds),
      ),
    );

  // For each course, load curriculum + progress
  const result = await Promise.all(
    enrolledCourses.map(async (course) => {
      // Load curriculum (modules + lessons, ordered)
      const courseModules = await db
        .select({
          id: modules.id,
          title: modules.title,
          position: modules.position,
        })
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

      // Count total lessons
      const allLessonIds = curriculum.flatMap((m) => m.lessons.map((l) => l.id));
      const totalLessons = allLessonIds.length;

      // Get completed lessons
      let completedLessonIds: string[] = [];
      if (totalLessons > 0) {
        const completedRows = await db
          .select({ lessonId: lessonProgress.lessonId })
          .from(lessonProgress)
          .where(
            and(
              eq(lessonProgress.userId, user.id),
              eq(lessonProgress.tenantId, tenant.id),
              eq(lessonProgress.completed, true),
              inArray(lessonProgress.lessonId, allLessonIds),
            ),
          );
        completedLessonIds = completedRows.map((r) => r.lessonId);
      }

      const completedCount = completedLessonIds.length;
      const progressPercent =
        totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

      // Find next incomplete lesson
      const completedSet = new Set(completedLessonIds);
      const nextLesson = findNextLesson(curriculum, completedSet);

      return {
        id: course.id,
        title: course.title,
        slug: course.slug,
        thumbnailUrl: course.thumbnailUrl,
        description: course.description,
        enrolledAt: enrollmentDates.get(course.id) ?? null,
        totalLessons,
        completedCount,
        progressPercent,
        nextLesson,
      };
    }),
  );

  return { courses: result, hasSubscription: !!activeSub };
});
