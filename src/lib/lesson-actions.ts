import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, asc, isNull, inArray } from "drizzle-orm";
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

    const user = session.user as { id: string };

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
    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, data.lessonId));
    if (!lesson) throw new Error("Lesson not found");

    // Verify the lesson belongs to this course
    const [mod] = await db
      .select({ id: modules.id, title: modules.title, courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, lesson.moduleId));
    if (!mod || mod.courseId !== course.id) {
      throw new Error("Lesson not found");
    }

    // Load full curriculum for navigation (with drip fields)
    const courseModules = await db
      .select({
        id: modules.id,
        title: modules.title,
        position: modules.position,
        availableAfterDays: modules.availableAfterDays,
        availableFromDate: modules.availableFromDate,
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
            availableAfterDays: lessons.availableAfterDays,
            availableFromDate: lessons.availableFromDate,
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

    // Fetch progress data for sidebar completion indicators
    const allLessonIds = allLessons.map((l) => l.id);
    const completedRows =
      allLessonIds.length > 0
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
    const completedSet = new Set(completedLessonIds);

    // Sequential progression gating: check all previous lessons are completed
    const sequentialLockedIds = course.sequentialProgress
      ? computeLockedLessonIds(
          allLessons.map((l) => l.id),
          completedSet,
        )
      : [];

    // Drip content gating: check time-based availability
    // Fetch enrollment date for availableAfterDays calculations
    const [enrollment] = await db
      .select({ enrolledAt: enrollments.enrolledAt })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, user.id),
          eq(enrollments.courseId, course.id),
          eq(enrollments.tenantId, tenant.id),
          isNull(enrollments.revokedAt),
        ),
      );
    const enrolledAt = enrollment?.enrolledAt ?? null;

    // Build module drip map for inheritance
    const moduleDripMap = new Map(
      courseModules.map((m) => [
        m.id,
        {
          availableAfterDays: m.availableAfterDays,
          availableFromDate: m.availableFromDate,
        },
      ]),
    );

    // Build lesson-to-module mapping from curriculum
    const lessonModuleMap = new Map<string, string>();
    for (const m of curriculum) {
      for (const l of m.lessons) {
        lessonModuleMap.set(l.id, m.id);
      }
    }

    const now = new Date();
    const dripResult = computeDripLockedLessonIds(
      allLessons.map((l) => ({
        id: l.id,
        availableAfterDays: l.availableAfterDays,
        availableFromDate: l.availableFromDate,
      })),
      lessonModuleMap,
      moduleDripMap,
      enrolledAt,
      now,
    );

    // Merge both lock sets
    const sequentialSet = new Set(sequentialLockedIds);
    const lockedLessonIds = [...new Set([...sequentialLockedIds, ...dripResult.lockedIds])];

    // Block access if the requested lesson is locked
    if (sequentialSet.has(data.lessonId)) {
      throw new Error("Lesson locked");
    }
    if (dripResult.lockedIds.includes(data.lessonId)) {
      const info = dripResult.unlockInfo.get(data.lessonId);
      throw new Error(info ? `Lesson locked: ${info}` : "Lesson locked");
    }

    // Prev/next navigation — for sequential courses, "next" points to first incomplete
    const lockedSet = new Set(lockedLessonIds);
    const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
    let nextLesson: (typeof allLessons)[number] | null = null;
    if (course.sequentialProgress) {
      nextLesson =
        allLessons.find(
          (l, i) => i > currentIndex && !completedSet.has(l.id) && !lockedSet.has(l.id),
        ) ?? (currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null);
    } else {
      nextLesson =
        allLessons.find((l, i) => i > currentIndex && !lockedSet.has(l.id)) ??
        (currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null);
    }

    // Build unlock info map for UI (only for locked lessons)
    const unlockInfoRecord: Record<string, string> = {};
    for (const [id, info] of dripResult.unlockInfo) {
      unlockInfoRecord[id] = info;
    }

    return {
      tenant,
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        sequentialProgress: course.sequentialProgress,
      },
      module: { id: mod.id, title: mod.title },
      lesson: lesson as any,
      curriculum,
      prevLesson,
      nextLesson,
      completedLessonIds,
      lockedLessonIds,
      unlockInfo: unlockInfoRecord,
    };
  });

/**
 * Compute which lessons are locked by sequential progression.
 * A lesson is locked if any previous lesson (in flat order) is not completed.
 * First lesson is never locked.
 */
export function computeLockedLessonIds(
  allLessonIds: string[],
  completedLessonIds: Set<string>,
): string[] {
  for (let i = 1; i < allLessonIds.length; i++) {
    if (!completedLessonIds.has(allLessonIds[i - 1])) {
      return allLessonIds.slice(i);
    }
  }
  return [];
}

/**
 * Compute which lessons are locked by drip content rules.
 * A lesson is locked if:
 *   - Its own availableAfterDays hasn't elapsed since enrollment
 *   - Its own availableFromDate hasn't been reached
 *   - Its parent module's drip settings haven't been met
 * Module-level drip applies to all lessons within the module.
 */
export function computeDripLockedLessonIds(
  allLessons: { id: string; availableAfterDays: number | null; availableFromDate: Date | null }[],
  lessonModuleMap: Map<string, string>,
  moduleDripMap: Map<string, { availableAfterDays: number | null; availableFromDate: Date | null }>,
  enrolledAt: Date | null,
  now: Date,
): { lockedIds: string[]; unlockInfo: Map<string, string> } {
  const lockedIds: string[] = [];
  const unlockInfo = new Map<string, string>();

  for (const lesson of allLessons) {
    const moduleId = lessonModuleMap.get(lesson.id);
    const moduleDrip = moduleId ? moduleDripMap.get(moduleId) : undefined;

    // Collect all unlock dates that must be met
    const unlockDates: Date[] = [];

    // Module-level drip
    if (moduleDrip?.availableAfterDays != null && enrolledAt) {
      const unlockDate = new Date(enrolledAt.getTime() + moduleDrip.availableAfterDays * 86400000);
      unlockDates.push(unlockDate);
    }
    if (moduleDrip?.availableFromDate != null) {
      unlockDates.push(moduleDrip.availableFromDate);
    }

    // Lesson-level drip
    if (lesson.availableAfterDays != null && enrolledAt) {
      const unlockDate = new Date(enrolledAt.getTime() + lesson.availableAfterDays * 86400000);
      unlockDates.push(unlockDate);
    }
    if (lesson.availableFromDate != null) {
      unlockDates.push(lesson.availableFromDate);
    }

    if (unlockDates.length === 0) continue;

    // Lesson is locked if ANY unlock date is in the future
    const latestUnlock = new Date(Math.max(...unlockDates.map((d) => d.getTime())));
    if (latestUnlock > now) {
      lockedIds.push(lesson.id);
      const daysLeft = Math.ceil((latestUnlock.getTime() - now.getTime()) / 86400000);
      if (daysLeft <= 0) {
        unlockInfo.set(lesson.id, "Available soon");
      } else if (daysLeft === 1) {
        unlockInfo.set(lesson.id, "Unlocks tomorrow");
      } else {
        unlockInfo.set(lesson.id, `Unlocks in ${daysLeft} days`);
      }
    }
  }

  return { lockedIds, unlockInfo };
}

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
