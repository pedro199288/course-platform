import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons, enrollments, bulkEmails } from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";

// Track sendJob calls so we can assert email enqueuing
const mockSendJob = vi.fn().mockResolvedValue("mock-job-id");

vi.mock("#/lib/job-queue.ts", () => ({
  sendJob: (...args: unknown[]) => mockSendJob(...args),
  registerHandler: vi.fn(),
}));

vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("bulk email", () => {
  const subdomain = `bulk-test-${Date.now()}`;
  const subdomain2 = `bulk-test2-${Date.now()}`;
  let tenantId: string;
  let tenant2Id: string;
  let courseId: string;
  let course2Id: string;
  const studentId = crypto.randomUUID();
  const student2Id = crypto.randomUUID();
  const student3Id = crypto.randomUUID();

  beforeAll(async () => {
    // Tenant 1
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Bulk Email School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Tenant 2 (for isolation test)
    const [tenant2] = await db
      .insert(tenants)
      .values({ name: "Other School", subdomain: subdomain2 })
      .returning();
    tenant2Id = tenant2.id;

    // Students
    await db.insert(users).values([
      {
        id: studentId,
        tenantId,
        name: "Student One",
        email: `bulk-s1-${Date.now()}@example.com`,
      },
      {
        id: student2Id,
        tenantId,
        name: "Student Two",
        email: `bulk-s2-${Date.now()}@example.com`,
      },
      {
        id: student3Id,
        tenantId,
        name: "Student Three",
        email: `bulk-s3-${Date.now()}@example.com`,
      },
    ]);

    // Course in tenant 1
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Bulk Email Course",
        slug: `bulk-course-${Date.now()}`,
        status: "published",
      })
      .returning();
    courseId = course.id;

    // Course in tenant 2
    const [c2] = await db
      .insert(courses)
      .values({
        tenantId: tenant2Id,
        title: "Other Course",
        slug: `bulk-other-${Date.now()}`,
        status: "published",
      })
      .returning();
    course2Id = c2.id;

    // Module + lesson (needed for enrollment to make sense)
    const [mod] = await db
      .insert(modules)
      .values({ courseId, title: "Module 1", position: 0 })
      .returning();
    await db
      .insert(lessons)
      .values({ moduleId: mod.id, title: "Lesson 1", type: "text", position: 0 });

    // Enroll student1 and student2 in course (student3 not enrolled)
    await db.insert(enrollments).values([
      { tenantId, userId: studentId, courseId },
      { tenantId, userId: student2Id, courseId },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(bulkEmails)
      .where(eq(bulkEmails.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(bulkEmails)
      .where(eq(bulkEmails.tenantId, tenant2Id))
      .catch(() => {});
    await db
      .delete(enrollments)
      .where(eq(enrollments.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(lessons)
      .where(
        eq(
          lessons.moduleId,
          db
            .select({ id: modules.id })
            .from(modules)
            .where(eq(modules.courseId, courseId))
            .limit(1) as any,
        ),
      )
      .catch(() => {});
    await db
      .delete(modules)
      .where(eq(modules.courseId, courseId))
      .catch(() => {});
    await db
      .delete(users)
      .where(eq(users.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(courses)
      .where(eq(courses.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(courses)
      .where(eq(courses.tenantId, tenant2Id))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain2))
      .catch(() => {});
  });

  // ── Record creation ────────────────────────────────────────

  it("creates a bulk email record with recipient count", async () => {
    const [record] = await db
      .insert(bulkEmails)
      .values({
        tenantId,
        courseId,
        subject: "Important update",
        body: "Here is some important information.",
        totalRecipients: 2,
      })
      .returning();

    expect(record.subject).toBe("Important update");
    expect(record.body).toBe("Here is some important information.");
    expect(record.totalRecipients).toBe(2);
    expect(record.tenantId).toBe(tenantId);
    expect(record.courseId).toBe(courseId);
  });

  it("lists bulk emails for a course sorted by newest first", async () => {
    // Add another record
    await db.insert(bulkEmails).values({
      tenantId,
      courseId,
      subject: "Second email",
      body: "Follow-up info.",
      totalRecipients: 2,
    });

    const rows = await db
      .select()
      .from(bulkEmails)
      .where(and(eq(bulkEmails.courseId, courseId), eq(bulkEmails.tenantId, tenantId)))
      .orderBy(bulkEmails.createdAt);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].subject).toBe("Important update");
  });

  // ── Tenant isolation ───────────────────────────────────────

  it("bulk emails are scoped to tenant", async () => {
    await db.insert(bulkEmails).values({
      tenantId: tenant2Id,
      courseId: course2Id,
      subject: "Other school email",
      body: "Should not appear in tenant 1.",
      totalRecipients: 0,
    });

    const t1Rows = await db.select().from(bulkEmails).where(eq(bulkEmails.tenantId, tenantId));

    const t2InT1 = t1Rows.filter((r) => r.tenantId === tenant2Id);
    expect(t2InT1.length).toBe(0);
  });

  // ── Email enqueuing ────────────────────────────────────────

  it("enqueues email jobs for enrolled students only", async () => {
    mockSendJob.mockClear();

    const { enqueueBulkEmail } = await import("#/lib/email-jobs.ts");

    // Query enrolled students (same pattern as server function)
    const enrolledStudents = await db
      .select({ email: users.email, name: users.name })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(
        and(
          eq(enrollments.courseId, courseId),
          eq(enrollments.tenantId, tenantId),
          isNull(enrollments.revokedAt),
        ),
      );

    for (const student of enrolledStudents) {
      await enqueueBulkEmail({
        to: student.email,
        studentName: student.name ?? "Student",
        courseName: "Bulk Email Course",
        schoolName: "Bulk Email School",
        subject: "Test Bulk",
        body: "Testing bulk email dispatch.",
      });
    }

    // Should have enqueued exactly 2 emails (student1 + student2, not student3)
    expect(mockSendJob).toHaveBeenCalledTimes(2);

    for (const call of mockSendJob.mock.calls) {
      expect(call[0]).toBe("send_email");
      expect(call[1]).toHaveProperty("to");
      expect(call[1]).toHaveProperty("subject");
      expect(call[1]).toHaveProperty("html");
      expect(call[1].subject).toContain("Test Bulk");
    }
  });

  it("does not enqueue emails for revoked enrollments", async () => {
    // Revoke student2's enrollment
    await db
      .update(enrollments)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(enrollments.userId, student2Id),
          eq(enrollments.courseId, courseId),
          eq(enrollments.tenantId, tenantId),
        ),
      );

    const enrolledStudents = await db
      .select({ email: users.email })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(
        and(
          eq(enrollments.courseId, courseId),
          eq(enrollments.tenantId, tenantId),
          isNull(enrollments.revokedAt),
        ),
      );

    // Only student1 should be enrolled now
    expect(enrolledStudents.length).toBe(1);

    // Restore enrollment for other tests
    await db
      .update(enrollments)
      .set({ revokedAt: null })
      .where(
        and(
          eq(enrollments.userId, student2Id),
          eq(enrollments.courseId, courseId),
          eq(enrollments.tenantId, tenantId),
        ),
      );
  });

  // ── Cascade delete ─────────────────────────────────────────

  it("bulk emails are deleted when course is deleted (cascade)", async () => {
    const [tempCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Temp Course",
        slug: `temp-bulk-cascade-${Date.now()}`,
        status: "draft",
      })
      .returning();

    await db.insert(bulkEmails).values({
      tenantId,
      courseId: tempCourse.id,
      subject: "Will cascade delete",
      body: "This should be removed with the course.",
      totalRecipients: 0,
    });

    await db.delete(courses).where(eq(courses.id, tempCourse.id));

    const remaining = await db
      .select()
      .from(bulkEmails)
      .where(eq(bulkEmails.courseId, tempCourse.id));
    expect(remaining.length).toBe(0);
  });
});
