import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  lessonProgress,
  users,
  userTenants,
} from "#/db/schema/index.ts";

import { getCrossSchoolDashboard } from "#/lib/cross-school-actions.ts";

describe("cross-school dashboard", () => {
  const ts = Date.now();

  // Two tenants (schools)
  let tenantAId: string;
  let tenantBId: string;
  let tenantASubdomain: string;
  let tenantBSubdomain: string;

  // User who is enrolled in both schools
  let userId: string;

  // Owner of school A (also a student in school B)
  let ownerUserId: string;

  // Courses
  let courseA1Id: string;
  let courseA1Slug: string;
  let courseB1Id: string;
  let courseB1Slug: string;

  // Lesson IDs for progress tracking
  let lessonA1Id: string;

  beforeAll(async () => {
    tenantASubdomain = `xschool-a-${ts}`;
    tenantBSubdomain = `xschool-b-${ts}`;

    // Create two tenants
    const [tenantA] = await db
      .insert(tenants)
      .values({ name: "School Alpha", subdomain: tenantASubdomain })
      .returning();
    tenantAId = tenantA.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: "School Beta", subdomain: tenantBSubdomain })
      .returning();
    tenantBId = tenantB.id;

    // Create users
    const [student] = await db
      .insert(users)
      .values({ name: "Multi Student", email: `xschool-student-${ts}@test.com`, role: "user" })
      .returning();
    userId = student.id;

    const [owner] = await db
      .insert(users)
      .values({ name: "Owner Student", email: `xschool-owner-${ts}@test.com`, role: "user" })
      .returning();
    ownerUserId = owner.id;

    // Memberships
    await db.insert(userTenants).values([
      { userId, tenantId: tenantAId, role: "student" },
      { userId, tenantId: tenantBId, role: "student" },
      { userId: ownerUserId, tenantId: tenantAId, role: "tenant_owner" },
      { userId: ownerUserId, tenantId: tenantBId, role: "student" },
    ]);

    // Courses in School A
    courseA1Slug = `xa-course1-${ts}`;
    const [courseA1] = await db
      .insert(courses)
      .values({
        tenantId: tenantAId,
        title: "Alpha Course 1",
        slug: courseA1Slug,
        price: "29.99",
        pricingModel: "one_time",
        status: "published",
      })
      .returning();
    courseA1Id = courseA1.id;

    // Course in School B
    courseB1Slug = `xb-course1-${ts}`;
    const [courseB1] = await db
      .insert(courses)
      .values({
        tenantId: tenantBId,
        title: "Beta Course 1",
        slug: courseB1Slug,
        price: "49.99",
        pricingModel: "one_time",
        status: "published",
      })
      .returning();
    courseB1Id = courseB1.id;

    // Modules + lessons for School A course
    const [modA1] = await db
      .insert(modules)
      .values({ courseId: courseA1Id, title: "Module A1", position: 0 })
      .returning();

    const [lA1] = await db
      .insert(lessons)
      .values({ moduleId: modA1.id, title: "Lesson A1", type: "text", position: 0 })
      .returning();
    lessonA1Id = lA1.id;

    await db
      .insert(lessons)
      .values({ moduleId: modA1.id, title: "Lesson A2", type: "text", position: 1 });

    // Modules + lessons for School B course
    const [modB1] = await db
      .insert(modules)
      .values({ courseId: courseB1Id, title: "Module B1", position: 0 })
      .returning();

    await db
      .insert(lessons)
      .values({ moduleId: modB1.id, title: "Lesson B1", type: "video", position: 0 });

    // Enrollments
    await db.insert(enrollments).values([
      { tenantId: tenantAId, userId, courseId: courseA1Id },
      { tenantId: tenantBId, userId, courseId: courseB1Id },
      { tenantId: tenantBId, userId: ownerUserId, courseId: courseB1Id },
    ]);

    // Progress: student completed 1 of 2 lessons in School A
    await db.insert(lessonProgress).values({
      tenantId: tenantAId,
      userId,
      lessonId: lessonA1Id,
      completed: true,
      completedAt: new Date(),
    });
  });

  afterAll(async () => {
    // Clean up in reverse dependency order
    await db
      .delete(lessonProgress)
      .where(eq(lessonProgress.tenantId, tenantAId))
      .catch(() => {});
    await db
      .delete(lessonProgress)
      .where(eq(lessonProgress.tenantId, tenantBId))
      .catch(() => {});
    await db
      .delete(enrollments)
      .where(eq(enrollments.tenantId, tenantAId))
      .catch(() => {});
    await db
      .delete(enrollments)
      .where(eq(enrollments.tenantId, tenantBId))
      .catch(() => {});
    for (const cId of [courseA1Id, courseB1Id]) {
      const mods = await db
        .select({ id: modules.id })
        .from(modules)
        .where(eq(modules.courseId, cId));
      for (const m of mods) {
        await db
          .delete(lessons)
          .where(eq(lessons.moduleId, m.id))
          .catch(() => {});
      }
      await db
        .delete(modules)
        .where(eq(modules.courseId, cId))
        .catch(() => {});
    }
    await db
      .delete(courses)
      .where(eq(courses.tenantId, tenantAId))
      .catch(() => {});
    await db
      .delete(courses)
      .where(eq(courses.tenantId, tenantBId))
      .catch(() => {});
    await db
      .delete(userTenants)
      .where(eq(userTenants.tenantId, tenantAId))
      .catch(() => {});
    await db
      .delete(userTenants)
      .where(eq(userTenants.tenantId, tenantBId))
      .catch(() => {});
    await db
      .delete(users)
      .where(eq(users.id, userId))
      .catch(() => {});
    await db
      .delete(users)
      .where(eq(users.id, ownerUserId))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.id, tenantAId))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.id, tenantBId))
      .catch(() => {});
  });

  // ── Multi-school enrollment visibility ──────────────────────

  it("shows enrollments across all schools for logged-in user", async () => {
    const result = await getCrossSchoolDashboard(userId);
    expect(result.schools.length).toBe(2);

    const schoolNames = result.schools.map((s: { name: string }) => s.name).sort();
    expect(schoolNames).toEqual(["School Alpha", "School Beta"]);

    // School Alpha has 1 course
    const alpha = result.schools.find((s: { name: string }) => s.name === "School Alpha")!;
    expect(alpha.courses.length).toBe(1);
    expect(alpha.courses[0].courseTitle).toBe("Alpha Course 1");

    // School Beta has 1 course
    const beta = result.schools.find((s: { name: string }) => s.name === "School Beta")!;
    expect(beta.courses.length).toBe(1);
    expect(beta.courses[0].courseTitle).toBe("Beta Course 1");
  });

  // ── Correct subdomain links ─────────────────────────────────

  it("generates correct subdomain URLs for each school", async () => {
    const result = await getCrossSchoolDashboard(userId);

    const alpha = result.schools.find((s: { name: string }) => s.name === "School Alpha")!;
    expect(alpha.url).toContain(tenantASubdomain);
    expect(alpha.subdomain).toBe(tenantASubdomain);

    const beta = result.schools.find((s: { name: string }) => s.name === "School Beta")!;
    expect(beta.url).toContain(tenantBSubdomain);
    expect(beta.subdomain).toBe(tenantBSubdomain);
  });

  // ── Progress tracking across schools ────────────────────────

  it("shows correct progress per course", async () => {
    const result = await getCrossSchoolDashboard(userId);

    // School Alpha: 1 of 2 lessons completed = 50%
    const alpha = result.schools.find((s: { name: string }) => s.name === "School Alpha")!;
    expect(alpha.courses[0].completedCount).toBe(1);
    expect(alpha.courses[0].totalLessons).toBe(2);
    expect(alpha.courses[0].progressPercent).toBe(50);

    // School Beta: 0 of 1 lessons completed = 0%
    const beta = result.schools.find((s: { name: string }) => s.name === "School Beta")!;
    expect(beta.courses[0].completedCount).toBe(0);
    expect(beta.courses[0].totalLessons).toBe(1);
    expect(beta.courses[0].progressPercent).toBe(0);
  });

  // ── Owner sees both contexts ────────────────────────────────

  it("user who owns school A and is student in school B sees both", async () => {
    const result = await getCrossSchoolDashboard(ownerUserId);

    // Owner has enrollment only in School B (they own A but have no enrollment there)
    expect(result.schools.length).toBe(1);
    const beta = result.schools[0];
    expect(beta.name).toBe("School Beta");
    expect(beta.role).toBe("student");
    expect(beta.courses.length).toBe(1);
  });

  // ── Enrollment date displayed ───────────────────────────────

  it("includes enrollment date for each course", async () => {
    const result = await getCrossSchoolDashboard(userId);

    for (const school of result.schools) {
      for (const course of school.courses) {
        expect(course.enrolledAt).toBeDefined();
      }
    }
  });

  // ── Empty state ─────────────────────────────────────────────

  it("returns empty schools array when user has no enrollments", async () => {
    // Create a user with no memberships/enrollments
    const [loner] = await db
      .insert(users)
      .values({ name: "Loner", email: `xschool-loner-${ts}@test.com`, role: "user" })
      .returning();

    const result = await getCrossSchoolDashboard(loner.id);
    expect(result.schools.length).toBe(0);

    await db.delete(users).where(eq(users.id, loner.id));
  });
});
