import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, desc, isNull, inArray } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { announcements, courses, enrollments, tenants } from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";
import { auth } from "./auth.ts";
import { enqueueAnnouncementEmail } from "./email-jobs.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";

// ── Admin helpers ───────────────────────────────────────────────────

async function requireAdmin() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as { id: string; role: string; tenantId: string };
  if (!["platform_admin", "tenant_owner", "tenant_admin"].includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
}

// ── Student helpers ─────────────────────────────────────────────────

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

async function requireAuth() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");
  return session.user as { id: string; tenantId: string };
}

// ── Admin: CRUD ─────────────────────────────────────────────────────

export const listAnnouncementsFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return db
      .select()
      .from(announcements)
      .where(
        and(eq(announcements.courseId, data.courseId), eq(announcements.tenantId, user.tenantId)),
      )
      .orderBy(desc(announcements.createdAt));
  });

export const createAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { courseId: string; title: string; body: string; sendEmail: boolean }) => d,
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();

    // Verify course belongs to tenant
    const [course] = await db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Course not found");

    const [announcement] = await db
      .insert(announcements)
      .values({
        tenantId: user.tenantId,
        courseId: data.courseId,
        title: data.title,
        body: data.body,
        emailSent: data.sendEmail,
      })
      .returning();

    // Enqueue emails if requested
    if (data.sendEmail) {
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
            eq(enrollments.tenantId, user.tenantId),
            isNull(enrollments.revokedAt),
          ),
        );

      // Get tenant name for email
      const [tenant] = await db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, user.tenantId));

      for (const student of enrolledStudents) {
        await enqueueAnnouncementEmail({
          to: student.email,
          studentName: student.name ?? "Student",
          courseName: course.title,
          schoolName: tenant?.name ?? "School",
          announcementTitle: data.title,
          announcementBody: data.body,
        });
      }
    }

    return announcement;
  });

export const deleteAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator((d: { announcementId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [deleted] = await db
      .delete(announcements)
      .where(
        and(eq(announcements.id, data.announcementId), eq(announcements.tenantId, user.tenantId)),
      )
      .returning();
    if (!deleted) throw new Error("Announcement not found");
    return deleted;
  });

// ── Student: Read ───────────────────────────────────────────────────

/**
 * Get announcements for a course. Only visible to enrolled students.
 */
export const getCourseAnnouncementsFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseSlug: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();
    const user = await requireAuth();

    // Find the course
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.slug, data.courseSlug),
          eq(courses.tenantId, tenant.id),
          eq(courses.status, "published"),
        ),
      );
    if (!course) return [];

    // Check enrollment
    const [enrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, user.id),
          eq(enrollments.courseId, course.id),
          eq(enrollments.tenantId, tenant.id),
          isNull(enrollments.revokedAt),
        ),
      );
    if (!enrollment) return [];

    return db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        createdAt: announcements.createdAt,
      })
      .from(announcements)
      .where(and(eq(announcements.courseId, course.id), eq(announcements.tenantId, tenant.id)))
      .orderBy(desc(announcements.createdAt));
  });

/**
 * Get recent announcements across all enrolled courses for the student dashboard.
 */
export const getRecentAnnouncementsFn = createServerFn({ method: "GET" }).handler(async () => {
  const tenant = await requireTenant();
  const user = await requireAuth();

  // Get enrolled course IDs
  const enrolledCourses = await db
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, user.id),
        eq(enrollments.tenantId, tenant.id),
        isNull(enrollments.revokedAt),
      ),
    );

  if (enrolledCourses.length === 0) return [];

  const courseIds = enrolledCourses.map((e) => e.courseId);

  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      createdAt: announcements.createdAt,
      courseId: announcements.courseId,
      courseTitle: courses.title,
    })
    .from(announcements)
    .innerJoin(courses, eq(courses.id, announcements.courseId))
    .where(
      and(eq(announcements.tenantId, tenant.id), inArray(announcements.courseId, courseIds)),
    )
    .orderBy(desc(announcements.createdAt))
    .limit(10);

  return rows;
});
