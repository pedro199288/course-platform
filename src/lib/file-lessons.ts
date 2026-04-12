import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, modules, lessons } from "#/db/schema/index.ts";
import { enrollments } from "#/db/schema/enrollments.ts";
import { auth } from "./auth.ts";
import {
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
} from "./storage/s3.ts";
import type { FileContent } from "./rich-text/types.ts";

type SessionUser = { id: string; role: string; tenantId: string };

async function requireInstructor(): Promise<SessionUser> {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as SessionUser;
  if (!user.role || !["tenant_owner", "tenant_admin"].includes(user.role)) {
    throw new Error("Forbidden");
  }

  return user;
}

async function requireEnrolledStudent(courseId: string): Promise<SessionUser> {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as SessionUser;

  // Instructors always have access to their own courses
  if (user.role && ["tenant_owner", "tenant_admin"].includes(user.role)) {
    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (course) return user;
  }

  // Students must be enrolled and not revoked
  const enrollment = await db.query.enrollments.findFirst({
    where: and(
      eq(enrollments.userId, user.id),
      eq(enrollments.courseId, courseId),
      isNull(enrollments.revokedAt),
    ),
  });

  if (!enrollment) throw new Error("Forbidden: not enrolled in this course");

  return user;
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
  .inputValidator(
    (input: { lessonId: string; filename: string; contentType: string }) =>
      input,
  )
  .handler(async ({ data }) => {
    const user = await requireInstructor();
    const { lessonId } = await verifyLessonOwnership(
      data.lessonId,
      user.tenantId,
    );

    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.id, lessonId),
      columns: { id: true, type: true },
    });
    if (!lesson) throw new Error("Lesson not found");
    if (lesson.type !== "file") throw new Error("Lesson is not a file lesson");

    // S3 key: tenants/{tenantId}/files/{lessonId}/{filename}
    const key = `tenants/${user.tenantId}/files/${lessonId}/${data.filename}`;

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
    await requireEnrolledStudent(mod.courseId);

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
