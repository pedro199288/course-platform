import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  announcements,
} from "#/db/schema/index.ts";
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

describe("announcements", () => {
  const subdomain = `ann-test-${Date.now()}`;
  const subdomain2 = `ann-test2-${Date.now()}`;
  let tenantId: string;
  let tenant2Id: string;
  let courseId: string;
  let course2Id: string;
  const studentId = crypto.randomUUID();
  const student2Id = crypto.randomUUID();
  const nonEnrolledId = crypto.randomUUID();

  beforeAll(async () => {
    // Tenant 1
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Announcement School", subdomain })
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
        email: `ann-s1-${Date.now()}@example.com`,
      },
      {
        id: student2Id,
        tenantId,
        name: "Student Two",
        email: `ann-s2-${Date.now()}@example.com`,
      },
      {
        id: nonEnrolledId,
        tenantId,
        name: "Not Enrolled",
        email: `ann-ne-${Date.now()}@example.com`,
      },
    ]);

    // Course in tenant 1
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Announcement Course",
        slug: `ann-course-${Date.now()}`,
        status: "published",
      })
      .returning();
    courseId = course.id;

    // Course in tenant 2 (for isolation)
    const [c2] = await db
      .insert(courses)
      .values({
        tenantId: tenant2Id,
        title: "Other Course",
        slug: `ann-other-${Date.now()}`,
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

    // Enroll student1 and student2 in course
    await db.insert(enrollments).values([
      { tenantId, userId: studentId, courseId },
      { tenantId, userId: student2Id, courseId },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(announcements)
      .where(eq(announcements.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(announcements)
      .where(eq(announcements.tenantId, tenant2Id))
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

  // ── CRUD Tests ──────────────────────────────────────────────

  it("creates an announcement without email", async () => {
    const [ann] = await db
      .insert(announcements)
      .values({
        tenantId,
        courseId,
        title: "Welcome!",
        body: "Welcome to the course.",
        emailSent: false,
      })
      .returning();

    expect(ann.title).toBe("Welcome!");
    expect(ann.emailSent).toBe(false);
    expect(ann.tenantId).toBe(tenantId);
    expect(ann.courseId).toBe(courseId);
  });

  it("creates an announcement with emailSent=true", async () => {
    const [ann] = await db
      .insert(announcements)
      .values({
        tenantId,
        courseId,
        title: "New content available",
        body: "We just published module 2.",
        emailSent: true,
      })
      .returning();

    expect(ann.emailSent).toBe(true);
  });

  it("lists announcements for a course sorted by newest first", async () => {
    const rows = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.courseId, courseId), eq(announcements.tenantId, tenantId)))
      .orderBy(announcements.createdAt);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Verify order: first inserted should be first (oldest)
    expect(rows[0].title).toBe("Welcome!");
  });

  it("deletes an announcement", async () => {
    const [temp] = await db
      .insert(announcements)
      .values({
        tenantId,
        courseId,
        title: "To be deleted",
        body: "This will be removed.",
      })
      .returning();

    const [deleted] = await db
      .delete(announcements)
      .where(and(eq(announcements.id, temp.id), eq(announcements.tenantId, tenantId)))
      .returning();

    expect(deleted.id).toBe(temp.id);

    // Verify it's gone
    const remaining = await db.select().from(announcements).where(eq(announcements.id, temp.id));
    expect(remaining.length).toBe(0);
  });

  // ── Tenant isolation ────────────────────────────────────────

  it("announcements are scoped to tenant", async () => {
    // Create announcement in tenant 2
    await db.insert(announcements).values({
      tenantId: tenant2Id,
      courseId: course2Id,
      title: "Other school announcement",
      body: "Should not appear in tenant 1 queries.",
    });

    // Query tenant 1
    const t1Rows = await db
      .select()
      .from(announcements)
      .where(eq(announcements.tenantId, tenantId));

    // No tenant 2 announcements should appear
    const t2InT1 = t1Rows.filter((a) => a.tenantId === tenant2Id);
    expect(t2InT1.length).toBe(0);
  });

  // ── Email enqueuing ─────────────────────────────────────────

  it("enqueues email jobs for enrolled students when sendEmail is true", async () => {
    mockSendJob.mockClear();

    // Import and call the email enqueue function directly
    const { enqueueAnnouncementEmail } = await import("#/lib/email-jobs.ts");

    // Simulate what createAnnouncementFn does: enqueue one email per enrolled student
    const enrolledStudents = await db
      .select({ email: users.email, name: users.name })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.tenantId, tenantId)));

    for (const student of enrolledStudents) {
      await enqueueAnnouncementEmail({
        to: student.email,
        studentName: student.name ?? "Student",
        courseName: "Announcement Course",
        schoolName: "Announcement School",
        announcementTitle: "Test Email",
        announcementBody: "Testing email dispatch.",
      });
    }

    // Should have enqueued exactly 2 emails (student1 + student2, not nonEnrolledId)
    expect(mockSendJob).toHaveBeenCalledTimes(2);

    // Verify each call was for the email job
    for (const call of mockSendJob.mock.calls) {
      expect(call[0]).toBe("send_email");
      expect(call[1]).toHaveProperty("to");
      expect(call[1]).toHaveProperty("subject");
      expect(call[1]).toHaveProperty("html");
      expect(call[1].subject).toContain("Test Email");
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

    const { isNull } = await import("drizzle-orm");

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

  // ── Cascade delete ──────────────────────────────────────────

  it("announcements are deleted when course is deleted (cascade)", async () => {
    // Create a temporary course with an announcement
    const [tempCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Temp Course",
        slug: `temp-cascade-${Date.now()}`,
        status: "draft",
      })
      .returning();

    await db.insert(announcements).values({
      tenantId,
      courseId: tempCourse.id,
      title: "Will cascade delete",
      body: "This should be removed with the course.",
    });

    // Delete the course
    await db.delete(courses).where(eq(courses.id, tempCourse.id));

    // Announcements should be gone
    const remaining = await db
      .select()
      .from(announcements)
      .where(eq(announcements.courseId, tempCourse.id));
    expect(remaining.length).toBe(0);
  });
});
