import { createServerFn } from "@tanstack/react-start";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { bulkEmails, courses, enrollments, tenants } from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";
import { requireMembership } from "./authorization.ts";
import { enqueueBulkEmail } from "./email-jobs.ts";

// ── Send bulk email ─────────────────────────────────────────────────

export const sendBulkEmailFn = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string; subject: string; body: string }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");

    // Verify course belongs to tenant
    const [course] = await db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(and(eq(courses.id, data.courseId), eq(courses.tenantId, tenantId)));
    if (!course) throw new Error("Course not found");

    // Get enrolled students (non-revoked)
    const enrolledStudents = await db
      .select({
        email: users.email,
        name: users.name,
      })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(
        and(
          eq(enrollments.courseId, data.courseId),
          eq(enrollments.tenantId, tenantId),
          isNull(enrollments.revokedAt),
        ),
      );

    // Get tenant name for email
    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    // Record the bulk email send
    const [record] = await db
      .insert(bulkEmails)
      .values({
        tenantId,
        courseId: data.courseId,
        subject: data.subject,
        body: data.body,
        totalRecipients: enrolledStudents.length,
      })
      .returning();

    // Enqueue one email per student
    for (const student of enrolledStudents) {
      await enqueueBulkEmail({
        to: student.email,
        studentName: student.name ?? "Student",
        courseName: course.title,
        schoolName: tenant?.name ?? "School",
        subject: data.subject,
        body: data.body,
      });
    }

    return record;
  });

// ── List bulk emails for a course ───────────────────────────────────

export const listBulkEmailsFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    return db
      .select()
      .from(bulkEmails)
      .where(and(eq(bulkEmails.courseId, data.courseId), eq(bulkEmails.tenantId, tenantId)))
      .orderBy(desc(bulkEmails.createdAt));
  });
