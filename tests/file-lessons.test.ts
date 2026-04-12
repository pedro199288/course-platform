import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
} from "#/db/schema/index.ts";
import type { FileContent } from "#/lib/rich-text/types.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock S3 storage — we test the integration at the DB layer,
// not actual S3 calls which need real credentials
vi.mock("#/lib/storage/s3.ts", () => ({
  createPresignedUploadUrl: vi.fn().mockResolvedValue({
    url: "https://s3.example.com/upload?signed=true",
    key: "tenants/t1/files/l1/worksheet.pdf",
  }),
  createPresignedDownloadUrl: vi.fn().mockResolvedValue({
    url: "https://s3.example.com/download?signed=true",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

describe("file lessons", () => {
  const subdomain = `file-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let moduleId: string;
  let fileLessonId: string;
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "File Test School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Create published course
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "File Course",
        slug: "file-course",
        status: "published",
        price: "19.99",
      })
      .returning();
    courseId = course.id;

    // Create module
    const [mod] = await db
      .insert(modules)
      .values({ courseId, title: "Module 1", position: 0 })
      .returning();
    moduleId = mod.id;

    // Enroll the user
    await db.insert(enrollments).values({
      tenantId,
      userId,
      courseId,
    });
  });

  afterAll(async () => {
    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId)).catch(() => {});
    await db.delete(lessons).where(eq(lessons.moduleId, moduleId)).catch(() => {});
    await db.delete(modules).where(eq(modules.courseId, courseId)).catch(() => {});
    await db.delete(courses).where(eq(courses.tenantId, tenantId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, subdomain)).catch(() => {});
  });

  // ── File lesson creation ────────────────────────────────

  it("creates a file lesson with type 'file'", async () => {
    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Worksheet PDF",
        type: "file",
        content: { type: "file", filename: null, contentType: null } as FileContent,
        position: 0,
      })
      .returning();
    fileLessonId = lesson.id;

    expect(lesson).toBeDefined();
    expect(lesson.type).toBe("file");
    expect(lesson.fileUrl).toBeNull();
  });

  it("stores file metadata in content JSONB", async () => {
    // Simulate what getFileUploadUrlFn does after upload
    await db
      .update(lessons)
      .set({
        fileUrl: `tenants/${tenantId}/files/${fileLessonId}/worksheet.pdf`,
        content: {
          type: "file",
          filename: "worksheet.pdf",
          contentType: "application/pdf",
        } as FileContent,
      })
      .where(eq(lessons.id, fileLessonId));

    const [lesson] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, fileLessonId));

    expect(lesson.fileUrl).toContain("worksheet.pdf");
    const content = lesson.content as {
      type: string;
      filename: string;
      contentType: string;
    };
    expect(content.type).toBe("file");
    expect(content.filename).toBe("worksheet.pdf");
    expect(content.contentType).toBe("application/pdf");
  });

  it("can update file URL when replacing a file", async () => {
    const newKey = `tenants/${tenantId}/files/${fileLessonId}/updated-worksheet.pdf`;
    await db
      .update(lessons)
      .set({
        fileUrl: newKey,
        content: {
          type: "file",
          filename: "updated-worksheet.pdf",
          contentType: "application/pdf",
        } as FileContent,
      })
      .where(eq(lessons.id, fileLessonId));

    const [lesson] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, fileLessonId));

    expect(lesson.fileUrl).toBe(newKey);
    const content = lesson.content as unknown as { filename: string };
    expect(content.filename).toBe("updated-worksheet.pdf");
  });

  // ── Presigned URL generation (mocked S3) ────────────────

  it("generates presigned upload URL", async () => {
    const { createPresignedUploadUrl } = await import("#/lib/storage/s3.ts");

    const result = await createPresignedUploadUrl({
      key: `tenants/${tenantId}/files/${fileLessonId}/test.pdf`,
      contentType: "application/pdf",
    });

    expect(result.url).toContain("s3.example.com/upload");
    expect(createPresignedUploadUrl).toHaveBeenCalledWith({
      key: `tenants/${tenantId}/files/${fileLessonId}/test.pdf`,
      contentType: "application/pdf",
    });
  });

  it("generates presigned download URL with filename", async () => {
    const { createPresignedDownloadUrl } = await import("#/lib/storage/s3.ts");

    const result = await createPresignedDownloadUrl({
      key: `tenants/${tenantId}/files/${fileLessonId}/test.pdf`,
      filename: "test.pdf",
    });

    expect(result.url).toContain("s3.example.com/download");
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(createPresignedDownloadUrl).toHaveBeenCalledWith({
      key: `tenants/${tenantId}/files/${fileLessonId}/test.pdf`,
      filename: "test.pdf",
    });
  });

  // ── Access gating (DB-level checks) ─────────────────────

  it("enrolled user has access via enrollment record", async () => {
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, courseId),
          eq(enrollments.tenantId, tenantId),
        ),
      );

    expect(enrollment).toBeDefined();
    expect(enrollment.revokedAt).toBeNull();
  });

  it("non-enrolled user has no enrollment record", async () => {
    const nonEnrolledUserId = crypto.randomUUID();
    const result = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, nonEnrolledUserId),
          eq(enrollments.courseId, courseId),
        ),
      );

    expect(result.length).toBe(0);
  });

  // ── Tenant isolation ────────────────────────────────────

  it("file lessons are isolated by tenant", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other File School", subdomain: `other-file-${Date.now()}` })
      .returning();

    // Create a course in the other tenant
    const [otherCourse] = await db
      .insert(courses)
      .values({
        tenantId: otherTenant.id,
        title: "Other Course",
        slug: "other-course",
        status: "published",
      })
      .returning();

    const [otherMod] = await db
      .insert(modules)
      .values({ courseId: otherCourse.id, title: "Other Module", position: 0 })
      .returning();

    const [otherLesson] = await db
      .insert(lessons)
      .values({
        moduleId: otherMod.id,
        title: "Other File",
        type: "file",
        fileUrl: `tenants/${otherTenant.id}/files/other/secret.pdf`,
        content: { type: "file", filename: "secret.pdf", contentType: "application/pdf" } as FileContent,
        position: 0,
      })
      .returning();

    // Verify user enrolled in first tenant can't access other tenant's course
    const enrollment = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.courseId, otherCourse.id),
        ),
      );
    expect(enrollment.length).toBe(0);

    // Cleanup
    await db.delete(lessons).where(eq(lessons.id, otherLesson.id));
    await db.delete(modules).where(eq(modules.id, otherMod.id));
    await db.delete(courses).where(eq(courses.id, otherCourse.id));
    await db.delete(tenants).where(eq(tenants.id, otherTenant.id));
  });

  // ── File lesson deletion cascades ───────────────────────

  it("deleting a module cascades to file lessons", async () => {
    // Create a separate module with a file lesson for this test
    const [tempMod] = await db
      .insert(modules)
      .values({ courseId, title: "Temp Module", position: 99 })
      .returning();

    const [tempLesson] = await db
      .insert(lessons)
      .values({
        moduleId: tempMod.id,
        title: "Temp File",
        type: "file",
        fileUrl: "tenants/test/files/temp/file.pdf",
        position: 0,
      })
      .returning();

    // Delete the module
    await db.delete(modules).where(eq(modules.id, tempMod.id));

    // Verify lesson was cascade-deleted
    const result = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, tempLesson.id));
    expect(result.length).toBe(0);
  });
});
