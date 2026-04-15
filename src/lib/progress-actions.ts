import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, modules, lessons, lessonProgress, tenants } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";
import { checkCourseAccess } from "./lesson-actions.ts";
import { checkAndIssueCertificate } from "./certificate-actions.ts";

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
 * Require an authenticated user session. Returns user with id and tenantId.
 */
async function requireAuth() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");
  return session.user as { id: string };
}

/**
 * Mark a lesson as complete for the current user.
 * Upserts into lessonProgress — idempotent.
 */
export const markLessonCompleteFn = createServerFn({ method: "POST" })
  .inputValidator((d: { courseSlug: string; lessonId: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();
    const user = await requireAuth();

    // Load the course (must be published)
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.tenantId, tenant.id),
          eq(courses.slug, data.courseSlug),
          eq(courses.status, "published"),
        ),
      );
    if (!course) throw new Error("Course not found");

    // Verify enrollment/subscription
    const hasAccess = await checkCourseAccess(user.id, course.id, tenant.id);
    if (!hasAccess) throw new Error("Not enrolled");

    // Verify the lesson belongs to this course
    const [lesson] = await db
      .select({ id: lessons.id, moduleId: lessons.moduleId })
      .from(lessons)
      .where(eq(lessons.id, data.lessonId));
    if (!lesson) throw new Error("Lesson not found");

    const [mod] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, lesson.moduleId));
    if (!mod || mod.courseId !== course.id) throw new Error("Lesson not found");

    // Upsert lesson progress
    await db
      .insert(lessonProgress)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        lessonId: data.lessonId,
        completed: true,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: { completed: true, completedAt: new Date() },
      });

    // Check if course is now 100% complete and issue certificate
    const certResult = await checkAndIssueCertificate(user.id, course.id, tenant.id);

    return { success: true, certificateIssued: certResult.issued };
  });

/**
 * Get progress for all lessons in a course for the current user.
 * Returns a set of completed lesson IDs + overall course completion stats.
 */
export const getCourseProgressFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseSlug: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return { completedLessonIds: [] as string[], totalLessons: 0, completedCount: 0 };
    }

    const user = session.user as { id: string };

    // Load the course
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.tenantId, tenant.id),
          eq(courses.slug, data.courseSlug),
          eq(courses.status, "published"),
        ),
      );
    if (!course) {
      return { completedLessonIds: [] as string[], totalLessons: 0, completedCount: 0 };
    }

    // Get all lesson IDs for this course
    const courseModules = await db
      .select({ id: modules.id })
      .from(modules)
      .where(eq(modules.courseId, course.id));

    if (courseModules.length === 0) {
      return { completedLessonIds: [] as string[], totalLessons: 0, completedCount: 0 };
    }

    const moduleIds = courseModules.map((m) => m.id);
    const allLessons = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(inArray(lessons.moduleId, moduleIds));

    if (allLessons.length === 0) {
      return { completedLessonIds: [] as string[], totalLessons: 0, completedCount: 0 };
    }

    const lessonIds = allLessons.map((l) => l.id);

    // Get completed lessons for this user
    const completed = await db
      .select({ lessonId: lessonProgress.lessonId })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, user.id),
          eq(lessonProgress.tenantId, tenant.id),
          eq(lessonProgress.completed, true),
          inArray(lessonProgress.lessonId, lessonIds),
        ),
      );

    const completedLessonIds = completed.map((c) => c.lessonId);

    return {
      completedLessonIds,
      totalLessons: allLessons.length,
      completedCount: completedLessonIds.length,
    };
  });

/**
 * Compute course completion: derives module and course completion from lesson progress.
 * Pure function for testability — takes lesson IDs and completed set, returns stats.
 */
export function deriveCourseCompletion(
  curriculum: Array<{
    id: string;
    lessons: Array<{ id: string }>;
  }>,
  completedLessonIds: Set<string>,
) {
  const moduleStats = curriculum.map((mod) => {
    const total = mod.lessons.length;
    const completed = mod.lessons.filter((l) => completedLessonIds.has(l.id)).length;
    return {
      moduleId: mod.id,
      totalLessons: total,
      completedLessons: completed,
      isComplete: total > 0 && completed === total,
    };
  });

  const totalLessons = moduleStats.reduce((sum, m) => sum + m.totalLessons, 0);
  const completedLessons = moduleStats.reduce((sum, m) => sum + m.completedLessons, 0);
  const allModulesComplete = moduleStats.length > 0 && moduleStats.every((m) => m.isComplete);

  return {
    moduleStats,
    totalLessons,
    completedLessons,
    isCourseComplete: totalLessons > 0 && allModulesComplete,
    progressPercent: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
  };
}
