import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, modules, lessons } from "#/db/schema/index.ts";
import { enrollments } from "#/db/schema/enrollments.ts";
import { userTenants } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { requireMembership } from "./authorization.ts";
import { createPresignedUploadUrl, createPresignedDownloadUrl } from "./storage/s3.ts";
import type { FileContent } from "./rich-text/types.ts";
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

export const getFileUploadUrlFn = createServerFn({ method: "POST" })
  .inputValidator((input: { lessonId: string; filename: string; contentType: string }) => input)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    const { lessonId } = await verifyLessonOwnership(data.lessonId, tenantId);

    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.id, lessonId),
      columns: { id: true, type: true },
    });
    if (!lesson) throw new Error("Lesson not found");
    if (lesson.type !== "file") throw new Error("Lesson is not a file lesson");

    // S3 key: tenants/{tenantId}/files/{lessonId}/{filename}
    const key = `tenants/${tenantId}/files/${lessonId}/${data.filename}`;

    const { url } = await createPresignedUploadUrl({
      key,
      contentType: data.contentType,
      expiresInSeconds: 3600,
    });

    // Store the S3 key and file metadata on the lesson
    const fileContent: FileContent = {
      type: "file",
      filename: data.filename,
      contentType: data.contentType,
    };
    await db
      .update(lessons)
      .set({
        fileUrl: key,
        content: fileContent,
      })
      .where(eq(lessons.id, lessonId));

    return { uploadUrl: url, key };
  });

// ── Download URL (enrolled students + instructors) ──────────────────

export const getFileDownloadUrlFn = createServerFn({ method: "POST" })
  .inputValidator((input: { lessonId: string }) => input)
  .handler(async ({ data }) => {
    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.id, data.lessonId),
    });
    if (!lesson) throw new Error("Lesson not found");
    if (lesson.type !== "file") throw new Error("Lesson is not a file lesson");
    if (!lesson.fileUrl) throw new Error("No file uploaded yet");

    // Get courseId via module
    const mod = await db.query.modules.findFirst({
      where: eq(modules.id, lesson.moduleId),
      columns: { courseId: true },
    });
    if (!mod) throw new Error("Lesson not found");

    // This checks enrollment or instructor access
    await requireEnrolledStudentOrAdmin(mod.courseId);

    const fileContent = lesson.content as {
      type: string;
      filename?: string;
      contentType?: string;
    } | null;

    const { url, expiresAt } = await createPresignedDownloadUrl({
      key: lesson.fileUrl,
      filename: fileContent?.filename,
      expiresInSeconds: 3600,
    });

    return {
      url,
      expiresAt,
      filename: fileContent?.filename ?? "download",
      contentType: fileContent?.contentType,
    };
  });
