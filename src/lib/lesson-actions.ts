import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, asc, isNull, or, inArray } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  courses,
  modules,
  lessons,
  enrollments,
  subscriptions,
  lessonProgress,
  tenants,
} from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";

/**
 * Resolve tenant from request headers (same as storefront-actions).
 */
async function requireTenant() {
  const request = getRequest();
  const host =
    request.headers.get("x-tenant") ?? request.headers.get("host") ?? "";
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
 * Check if a user has access to a course via enrollment or active subscription.
 */
export async function checkCourseAccess(
  userId: string,
  courseId: string,
  tenantId: string,
): Promise<boolean> {
  // Check active enrollment (not revoked)
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, courseId),
        eq(enrollments.tenantId, tenantId),
        isNull(enrollments.revokedAt),
      ),
    );
  if (enrollment) return true;

  // Check active subscription for the tenant
  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.tenantId, tenantId),
        eq(subscriptions.status, "active"),
      ),
    );
  if (sub) return true;

  return false;
}

/**
 * Get a lesson with full content for an enrolled student.
 * Returns lesson content + curriculum for navigation.
 * Throws if user is not enrolled/subscribed.
 */
export const getLessonFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseSlug: string; lessonId: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      throw new Error("Unauthorized");
    }

    const user = session.user as { id: string; tenantId: string };

    // Load the course by slug (must be published and belong to tenant)
    const [course] = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.tenantId, tenant.id),
          eq(courses.slug, data.courseSlug),
          eq(courses.status, "published"),
        ),
      );
    if (!course) throw new Error("Course not found");

    // Check access
    const hasAccess = await checkCourseAccess(user.id, course.id, tenant.id);
    if (!hasAccess) {
      throw new Error("Not enrolled");
    }

    // Load the lesson
    const [lesson] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, data.lessonId));
    if (!lesson) throw new Error("Lesson not found");

    // Verify the lesson belongs to this course
    const [mod] = await db
      .select({ id: modules.id, title: modules.title, courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, lesson.moduleId));
    if (!mod || mod.courseId !== course.id) {
      throw new Error("Lesson not found");
    }

    // Load full curriculum for navigation
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

    // Build flat lesson list for prev/next navigation
    const allLessons = curriculum.flatMap((m) => m.lessons);
    const currentIndex = allLessons.findIndex((l) => l.id === data.lessonId);
    const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
    const nextLesson =
      currentIndex < allLessons.length - 1
        ? allLessons[currentIndex + 1]
        : null;

    // Fetch progress data for sidebar completion indicators
    const allLessonIds = allLessons.map((l) => l.id);
    const completedRows = allLessonIds.length > 0
      ? await db
          .select({ lessonId: lessonProgress.lessonId })
          .from(lessonProgress)
          .where(
            and(
              eq(lessonProgress.userId, user.id),
              eq(lessonProgress.tenantId, tenant.id),
              eq(lessonProgress.completed, true),
              inArray(lessonProgress.lessonId, allLessonIds),
            ),
          )
      : [];
    const completedLessonIds = completedRows.map((r) => r.lessonId);

    return {
      tenant,
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
      },
      module: { id: mod.id, title: mod.title },
      lesson: lesson as any,
      curriculum,
      prevLesson,
      nextLesson,
      completedLessonIds,
    };
  });

/**
 * Check enrollment status for a course (used by course detail page).
 */
export const checkEnrollmentFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseSlug: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) return { enrolled: false };

    const user = session.user as { id: string };

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
    if (!course) return { enrolled: false };

    const hasAccess = await checkCourseAccess(user.id, course.id, tenant.id);
    return { enrolled: hasAccess };
  });
