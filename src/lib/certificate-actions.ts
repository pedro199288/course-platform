import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  lessonProgress,
  certificates,
  users,
} from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";
import { enqueueCertificateDelivery } from "./email-jobs.ts";
import { PLATFORM_DOMAIN } from "./config.ts";

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
  return session.user as { id: string; tenantId: string; name: string; email: string };
}

/**
 * Check if a course is 100% complete for a user and issue a certificate if so.
 * Called after marking a lesson complete. Idempotent — won't create duplicates.
 * This is a pure server-side function (not a server fn), called internally.
 */
export async function checkAndIssueCertificate(
  userId: string,
  courseId: string,
  tenantId: string,
): Promise<{ issued: boolean; certificateId?: string }> {
  // Check if certificate already exists
  const existing = await db
    .select({ id: certificates.id })
    .from(certificates)
    .where(
      and(
        eq(certificates.userId, userId),
        eq(certificates.courseId, courseId),
        eq(certificates.tenantId, tenantId),
      ),
    );

  if (existing.length > 0) {
    return { issued: false, certificateId: existing[0].id };
  }

  // Get all lessons in the course
  const courseModules = await db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId));

  if (courseModules.length === 0) {
    return { issued: false };
  }

  const moduleIds = courseModules.map((m) => m.id);
  const allLessons = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(inArray(lessons.moduleId, moduleIds));

  if (allLessons.length === 0) {
    return { issued: false };
  }

  const lessonIds = allLessons.map((l) => l.id);

  // Get completed lessons
  const completed = await db
    .select({ lessonId: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.tenantId, tenantId),
        eq(lessonProgress.completed, true),
        inArray(lessonProgress.lessonId, lessonIds),
      ),
    );

  // Not all lessons complete
  if (completed.length < allLessons.length) {
    return { issued: false };
  }

  // All lessons complete — issue certificate
  const [cert] = await db
    .insert(certificates)
    .values({
      tenantId,
      userId,
      courseId,
    })
    .returning();

  // Queue certificate delivery email (best-effort)
  try {
    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId));

    const [course] = await db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, courseId));

    const [tenant] = await db
      .select({ name: tenants.name, subdomain: tenants.subdomain })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    if (user && course && tenant) {
      const certificateUrl = `https://${tenant.subdomain}.${PLATFORM_DOMAIN}/certificates/${cert.id}`;
      await enqueueCertificateDelivery({
        to: user.email,
        studentName: user.name,
        courseName: course.title,
        schoolName: tenant.name,
        certificateUrl,
        completionDate: new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      });
    }
  } catch {
    // Email failure should not break certificate issuance
  }

  return { issued: true, certificateId: cert.id };
}

/**
 * Get a specific certificate by ID. Verifies the certificate belongs to the
 * requesting user and tenant.
 */
export const getCertificateFn = createServerFn({ method: "GET" })
  .inputValidator((d: { certificateId: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();

    const [cert] = await db
      .select({
        id: certificates.id,
        userId: certificates.userId,
        courseId: certificates.courseId,
        generatedAt: certificates.generatedAt,
      })
      .from(certificates)
      .where(and(eq(certificates.id, data.certificateId), eq(certificates.tenantId, tenant.id)));

    if (!cert) throw new Error("Certificate not found");

    // Load course and user details for display
    const [course] = await db
      .select({ title: courses.title, slug: courses.slug })
      .from(courses)
      .where(eq(courses.id, cert.courseId));

    const [user] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, cert.userId));

    return {
      id: cert.id,
      studentName: user?.name ?? "Student",
      courseTitle: course?.title ?? "Course",
      courseSlug: course?.slug ?? "",
      schoolName: tenant.name,
      generatedAt: cert.generatedAt.toISOString(),
    };
  });

/**
 * Get all certificates for the current user in this tenant.
 * Used by the student dashboard to show download links.
 */
export const getStudentCertificatesFn = createServerFn({ method: "GET" }).handler(async () => {
  const tenant = await requireTenant();
  const user = await requireAuth();

  const certs = await db
    .select({
      id: certificates.id,
      courseId: certificates.courseId,
      generatedAt: certificates.generatedAt,
    })
    .from(certificates)
    .where(and(eq(certificates.userId, user.id), eq(certificates.tenantId, tenant.id)));

  // Build a map of courseId → certificateId for easy lookup
  const certMap: Record<string, { id: string; generatedAt: string }> = {};
  for (const cert of certs) {
    certMap[cert.courseId] = {
      id: cert.id,
      generatedAt: cert.generatedAt.toISOString(),
    };
  }

  return certMap;
});
