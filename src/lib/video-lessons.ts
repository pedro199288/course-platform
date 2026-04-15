import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, modules, lessons } from "#/db/schema/index.ts";
import { enrollments } from "#/db/schema/enrollments.ts";
import { userTenants } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { requireMembership } from "./authorization.ts";
import { getVideoProvider } from "./video/index.ts";
import { tenantIdStore } from "./tenant-context.ts";

/**
 * Verify access for enrolled students or admin/owner members.
 * Uses user_tenants membership to check role instead of global user.role.
 */
async function requireEnrolledStudentOrAdmin(courseId: string): Promise<void> {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const userId = session.user.id;
  const user = session.user as { id: string; role?: string };
  const tenantId = tenantIdStore.getStore()!;

  // platform_admin bypasses all checks
  if (user.role === "platform_admin") return;

  // Check membership in user_tenants
  const membership = await db.query.userTenants.findFirst({
    where: and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)),
  });

  // Admin/owner can access any course in their tenant
  if (membership && (membership.role === "tenant_owner" || membership.role === "tenant_admin")) {
    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)),
      columns: { id: true },
    });
    if (course) return;
  }

  // Students must be enrolled and not revoked
  const enrollment = await db.query.enrollments.findFirst({
    where: and(
      eq(enrollments.userId, userId),
      eq(enrollments.courseId, courseId),
      isNull(enrollments.revokedAt),
    ),
  });
  if (!enrollment) throw new Error("Forbidden: not enrolled in this course");
}

/**
 * Verify the ownership chain: lesson → module → course → tenant.
 * Returns the lesson and its parent courseId.
 */
async function verifyLessonOwnership(
  lessonId: string,
  tenantId: string,
): Promise<{ lessonId: string; courseId: string }> {
  const lesson = await db.query.lessons.findFirst({
    where: eq(lessons.id, lessonId),
  });
  if (!lesson) throw new Error("Lesson not found");

  const mod = await db.query.modules.findFirst({
    where: eq(modules.id, lesson.moduleId),
  });
  if (!mod) throw new Error("Lesson not found");

  const course = await db.query.courses.findFirst({
    where: and(eq(courses.id, mod.courseId), eq(courses.tenantId, tenantId)),
    columns: { id: true },
  });
  if (!course) throw new Error("Lesson not found");

  return { lessonId: lesson.id, courseId: course.id };
}

// ── Upload URL (instructor only) ────────────────────────────────────

export const getVideoUploadUrlFn = createServerFn({ method: "POST" })
  .inputValidator((input: { lessonId: string }) => input)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    const { lessonId } = await verifyLessonOwnership(data.lessonId, tenantId);

    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.id, lessonId),
      columns: { id: true, title: true, type: true },
    });
    if (!lesson) throw new Error("Lesson not found");
    if (lesson.type !== "video") throw new Error("Lesson is not a video lesson");

    const provider = getVideoProvider();
    const result = await provider.createUploadUrl({ title: lesson.title });

    // Store the video provider ID and set status to pending
    await db
      .update(lessons)
      .set({
        videoProviderId: result.videoId,
        videoUploadStatus: "pending",
      })
      .where(eq(lessons.id, lessonId));

    return {
      videoId: result.videoId,
      uploadUrl: result.uploadUrl,
      uploadHeaders: result.uploadHeaders,
    };
  });

// ── Playback URL (enrolled students + instructors) ──────────────────

export const getVideoPlaybackUrlFn = createServerFn({ method: "POST" })
  .inputValidator((input: { lessonId: string }) => input)
  .handler(async ({ data }) => {
    // Verify the lesson exists and get its courseId for enrollment check
    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.id, data.lessonId),
    });
    if (!lesson) throw new Error("Lesson not found");
    if (lesson.type !== "video") throw new Error("Lesson is not a video lesson");
    if (!lesson.videoProviderId) throw new Error("Video not uploaded yet");
    if (lesson.videoUploadStatus !== "ready") {
      throw new Error("Video is not ready for playback");
    }

    // Get courseId via module
    const mod = await db.query.modules.findFirst({
      where: eq(modules.id, lesson.moduleId),
      columns: { courseId: true },
    });
    if (!mod) throw new Error("Lesson not found");

    // This checks enrollment or instructor access
    await requireEnrolledStudentOrAdmin(mod.courseId);

    const provider = getVideoProvider();
    const playback = await provider.getPlaybackUrl(lesson.videoProviderId);

    return {
      url: playback.url,
      expiresAt: playback.expiresAt,
    };
  });

// ── Video status check (instructor only) ────────────────────────────

export const getVideoStatusFn = createServerFn({ method: "GET" })
  .inputValidator((input: { lessonId: string }) => input)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    await verifyLessonOwnership(data.lessonId, tenantId);

    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.id, data.lessonId),
      columns: { videoProviderId: true, videoUploadStatus: true },
    });
    if (!lesson) throw new Error("Lesson not found");
    if (!lesson.videoProviderId) throw new Error("No video uploaded");

    return {
      videoProviderId: lesson.videoProviderId,
      status: lesson.videoUploadStatus,
    };
  });
