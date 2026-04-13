import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  lessonProgress,
  certificates,
} from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";
import { checkAndIssueCertificate } from "#/lib/certificate-actions.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock job queue to prevent pg-boss calls
vi.mock("#/lib/job-queue.ts", () => ({
  getBoss: vi.fn(),
  sendJob: vi.fn().mockResolvedValue("mock-job-id"),
  registerHandler: vi.fn(),
  startJobQueue: vi.fn(),
  startWorkers: vi.fn(),
  stopJobQueue: vi.fn(),
}));

describe("certificates", () => {
  const subdomain = `cert-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let module1Id: string;
  let lesson1Id: string;
  let lesson2Id: string;
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Cert Test School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Create published course
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Certificate Course",
        slug: `cert-course-${Date.now()}`,
        status: "published",
        price: "29.99",
      })
      .returning();
    courseId = course.id;

    // Create module with two lessons
    const [mod1] = await db
      .insert(modules)
      .values({ courseId, title: "Module 1", position: 0 })
      .returning();
    module1Id = mod1.id;

    const [l1] = await db
      .insert(lessons)
      .values({
        moduleId: module1Id,
        title: "Lesson 1",
        type: "text",
        content: { text: "Content 1" },
        position: 0,
      })
      .returning();
    lesson1Id = l1.id;

    const [l2] = await db
      .insert(lessons)
      .values({
        moduleId: module1Id,
        title: "Lesson 2",
        type: "text",
        content: { text: "Content 2" },
        position: 1,
      })
      .returning();
    lesson2Id = l2.id;

    // Create test user
    await db.insert(users).values({
      id: userId,
      tenantId,
      name: "Cert Test User",
      email: `cert-test-${Date.now()}@example.com`,
    });

    // Enroll the user
    await db.insert(enrollments).values({
      tenantId,
      userId,
      courseId,
    });
  });

  afterAll(async () => {
    await db
      .delete(certificates)
      .where(eq(certificates.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(lessonProgress)
      .where(eq(lessonProgress.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(enrollments)
      .where(eq(enrollments.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(lessons)
      .where(eq(lessons.moduleId, module1Id))
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
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain))
      .catch(() => {});
  });

  // ── Certificate issuance ──────────────────────────

  it("does not issue certificate when course is incomplete", async () => {
    // Only complete one of two lessons
    await db.insert(lessonProgress).values({
      tenantId,
      userId,
      lessonId: lesson1Id,
      completed: true,
      completedAt: new Date(),
    });

    const result = await checkAndIssueCertificate(userId, courseId, tenantId);
    expect(result.issued).toBe(false);
    expect(result.certificateId).toBeUndefined();
  });

  it("issues certificate when all lessons are complete", async () => {
    // Complete the second lesson
    await db.insert(lessonProgress).values({
      tenantId,
      userId,
      lessonId: lesson2Id,
      completed: true,
      completedAt: new Date(),
    });

    const result = await checkAndIssueCertificate(userId, courseId, tenantId);
    expect(result.issued).toBe(true);
    expect(result.certificateId).toBeDefined();

    // Verify certificate record in DB
    const [cert] = await db
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.userId, userId),
          eq(certificates.courseId, courseId),
          eq(certificates.tenantId, tenantId),
        ),
      );
    expect(cert).toBeDefined();
    expect(cert.id).toBe(result.certificateId);
    expect(cert.generatedAt).toBeTruthy();
  });

  it("is idempotent — does not create duplicate certificates", async () => {
    const result = await checkAndIssueCertificate(userId, courseId, tenantId);
    expect(result.issued).toBe(false);
    expect(result.certificateId).toBeDefined();

    // Verify only one certificate exists
    const certs = await db
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.userId, userId),
          eq(certificates.courseId, courseId),
          eq(certificates.tenantId, tenantId),
        ),
      );
    expect(certs.length).toBe(1);
  });

  it("does not issue certificate for course with no lessons", async () => {
    // Create an empty course
    const [emptyCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Empty Course",
        slug: `empty-course-${Date.now()}`,
        status: "published",
        price: "0",
      })
      .returning();

    // Create a module with no lessons
    await db.insert(modules).values({
      courseId: emptyCourse.id,
      title: "Empty Module",
      position: 0,
    });

    const result = await checkAndIssueCertificate(userId, emptyCourse.id, tenantId);
    expect(result.issued).toBe(false);

    // Cleanup
    await db.delete(modules).where(eq(modules.courseId, emptyCourse.id));
    await db.delete(courses).where(eq(courses.id, emptyCourse.id));
  });

  // ── Tenant isolation ──────────────────────────

  it("isolates certificates by tenant", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({
        name: "Other School",
        subdomain: `other-cert-${Date.now()}`,
      })
      .returning();

    // No certificates should exist for this tenant
    const certs = await db
      .select()
      .from(certificates)
      .where(eq(certificates.tenantId, otherTenant.id));

    expect(certs.length).toBe(0);

    await db.delete(tenants).where(eq(tenants.id, otherTenant.id));
  });

  it("does not issue certificate for course with no modules", async () => {
    const [noModCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "No Module Course",
        slug: `no-mod-course-${Date.now()}`,
        status: "published",
        price: "0",
      })
      .returning();

    const result = await checkAndIssueCertificate(userId, noModCourse.id, tenantId);
    expect(result.issued).toBe(false);

    // Cleanup
    await db.delete(courses).where(eq(courses.id, noModCourse.id));
  });

  // ── Certificate record storage ──────────────────────────

  it("stores certificate with correct tenant, user, and course references", async () => {
    const [cert] = await db
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.userId, userId),
          eq(certificates.courseId, courseId),
          eq(certificates.tenantId, tenantId),
        ),
      );

    expect(cert.tenantId).toBe(tenantId);
    expect(cert.userId).toBe(userId);
    expect(cert.courseId).toBe(courseId);
  });
});
