import "@tanstack/react-start/server-only";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, lessons, modules } from "#/db/schema/courses.ts";
import { enrollments } from "#/db/schema/enrollments.ts";
import { tenants } from "#/db/schema/tenants.ts";
import { users } from "#/db/schema/auth.ts";
import { getBoss, registerHandler } from "./job-queue.ts";
import { enqueueDripUnlockEmail } from "./email-jobs.ts";
import { PLATFORM_DOMAIN } from "./config.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHECK_DRIP_UNLOCKS_JOB = "check_drip_unlocks";

// ---------------------------------------------------------------------------
// Handler registration — call once at startup before startWorkers()
// ---------------------------------------------------------------------------

export function registerDripNotificationHandler(): void {
  registerHandler(CHECK_DRIP_UNLOCKS_JOB, async () => {
    await checkDripUnlocks();
  });
}

/**
 * Schedule the daily cron job. Call after startJobQueue().
 * PgBoss schedule is idempotent — calling multiple times updates the schedule.
 */
export async function scheduleDripNotificationCron(): Promise<void> {
  const boss = getBoss();
  // Run daily at 08:00 UTC
  await boss.schedule(CHECK_DRIP_UNLOCKS_JOB, "0 8 * * *");
}

// ---------------------------------------------------------------------------
// Core logic — exported for testing
// ---------------------------------------------------------------------------

/**
 * For each active enrollment, find lessons/modules that unlock today
 * (became available within the last 24 hours) and send a single
 * notification email per student per course.
 */
export async function checkDripUnlocks(now?: Date): Promise<number> {
  const currentTime = now ?? new Date();
  const oneDayAgo = new Date(currentTime.getTime() - 86400000);

  // Find all lessons/modules with drip settings, joined with active enrollments
  const rows = await db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      lessonAvailableAfterDays: lessons.availableAfterDays,
      lessonAvailableFromDate: lessons.availableFromDate,
      moduleId: modules.id,
      moduleTitle: modules.title,
      moduleAvailableAfterDays: modules.availableAfterDays,
      moduleAvailableFromDate: modules.availableFromDate,
      enrolledAt: enrollments.enrolledAt,
      userId: enrollments.userId,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSubdomain: tenants.subdomain,
      userName: users.name,
      userEmail: users.email,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .innerJoin(tenants, eq(courses.tenantId, tenants.id))
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.courseId, courses.id),
        eq(enrollments.tenantId, tenants.id),
        isNull(enrollments.revokedAt),
      ),
    )
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(
      or(
        isNotNull(lessons.availableAfterDays),
        isNotNull(lessons.availableFromDate),
        isNotNull(modules.availableAfterDays),
        isNotNull(modules.availableFromDate),
      ),
    );

  // Group by (userId, courseId) → collect unlocked lesson titles
  const notifications = new Map<
    string,
    {
      userId: string;
      userEmail: string;
      userName: string;
      courseId: string;
      courseTitle: string;
      courseSlug: string;
      tenantName: string;
      tenantSubdomain: string;
      unlockedItems: string[];
    }
  >();

  for (const row of rows) {
    // Compute the unlock date for this lesson (same logic as computeDripLockedLessonIds)
    const unlockDates: Date[] = [];

    if (row.moduleAvailableAfterDays != null) {
      unlockDates.push(
        new Date(row.enrolledAt.getTime() + row.moduleAvailableAfterDays * 86400000),
      );
    }
    if (row.moduleAvailableFromDate != null) {
      unlockDates.push(row.moduleAvailableFromDate);
    }
    if (row.lessonAvailableAfterDays != null) {
      unlockDates.push(
        new Date(row.enrolledAt.getTime() + row.lessonAvailableAfterDays * 86400000),
      );
    }
    if (row.lessonAvailableFromDate != null) {
      unlockDates.push(row.lessonAvailableFromDate);
    }

    if (unlockDates.length === 0) continue;

    // The lesson unlocks at the latest of all its drip dates
    const unlockDate = new Date(Math.max(...unlockDates.map((d) => d.getTime())));

    // Check if it unlocked within the last 24 hours (between oneDayAgo and now)
    if (unlockDate > oneDayAgo && unlockDate <= currentTime) {
      const key = `${row.userId}:${row.courseId}`;
      if (!notifications.has(key)) {
        notifications.set(key, {
          userId: row.userId,
          userEmail: row.userEmail,
          userName: row.userName,
          courseId: row.courseId,
          courseTitle: row.courseTitle,
          courseSlug: row.courseSlug,
          tenantName: row.tenantName,
          tenantSubdomain: row.tenantSubdomain,
          unlockedItems: [],
        });
      }
      const entry = notifications.get(key)!;
      const itemTitle = `${row.lessonTitle} (${row.moduleTitle})`;
      if (!entry.unlockedItems.includes(itemTitle)) {
        entry.unlockedItems.push(itemTitle);
      }
    }
  }

  // Enqueue one email per student per course
  let emailCount = 0;
  for (const notif of notifications.values()) {
    const courseUrl = `https://${notif.tenantSubdomain}.${PLATFORM_DOMAIN}/courses/${notif.courseSlug}`;
    try {
      await enqueueDripUnlockEmail({
        to: notif.userEmail,
        studentName: notif.userName,
        courseName: notif.courseTitle,
        schoolName: notif.tenantName,
        courseUrl,
        unlockedItems: notif.unlockedItems,
      });
      emailCount++;
    } catch {
      // Best-effort — don't break the cron job for one failed enqueue
    }
  }

  return emailCount;
}
