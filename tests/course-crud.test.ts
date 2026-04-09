import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons } from "#/db/schema/index.ts";

describe("course/module/lesson CRUD (integration)", () => {
  const ts = Date.now();
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    const [tA] = await db
      .insert(tenants)
      .values({ name: "School A", subdomain: `school-a-${ts}` })
      .returning();
    tenantAId = tA.id;

    const [tB] = await db
      .insert(tenants)
      .values({ name: "School B", subdomain: `school-b-${ts}` })
      .returning();
    tenantBId = tB.id;
  });

  afterAll(async () => {
    // Cascade: deleting courses removes modules and lessons
    await db.delete(courses).where(eq(courses.tenantId, tenantAId));
    await db.delete(courses).where(eq(courses.tenantId, tenantBId));
    await db.delete(tenants).where(eq(tenants.id, tenantAId));
    await db.delete(tenants).where(eq(tenants.id, tenantBId));
  });

  // ── Course CRUD ────────────────────────────────────────────────────

  describe("course CRUD", () => {
    let courseId: string;

    it("creates a course with correct defaults", async () => {
      const [course] = await db
        .insert(courses)
        .values({
          tenantId: tenantAId,
          title: "Intro to Testing",
          slug: `intro-testing-${ts}`,
          description: "Learn testing basics",
        })
        .returning();

      courseId = course.id;
      expect(course.title).toBe("Intro to Testing");
      expect(course.slug).toBe(`intro-testing-${ts}`);
      expect(course.description).toBe("Learn testing basics");
      expect(course.status).toBe("draft");
      expect(course.pricingModel).toBe("one_time");
      expect(course.price).toBeNull();
      expect(course.tenantId).toBe(tenantAId);
    });

    it("reads a course by id and tenant", async () => {
      const course = await db.query.courses.findFirst({
        where: and(eq(courses.id, courseId), eq(courses.tenantId, tenantAId)),
      });

      expect(course).toBeDefined();
      expect(course!.title).toBe("Intro to Testing");
    });

    it("updates course title and description", async () => {
      const [updated] = await db
        .update(courses)
        .set({ title: "Advanced Testing", description: "Deep dive into testing" })
        .where(eq(courses.id, courseId))
        .returning();

      expect(updated.title).toBe("Advanced Testing");
      expect(updated.description).toBe("Deep dive into testing");
    });

    it("updates course price and pricing model", async () => {
      const [updated] = await db
        .update(courses)
        .set({ price: "29.99", pricingModel: "subscription" })
        .where(eq(courses.id, courseId))
        .returning();

      expect(updated.price).toBe("29.99");
      expect(updated.pricingModel).toBe("subscription");
    });

    it("deletes a course", async () => {
      const [temp] = await db
        .insert(courses)
        .values({
          tenantId: tenantAId,
          title: "To Delete",
          slug: `delete-me-${ts}`,
        })
        .returning();

      await db.delete(courses).where(eq(courses.id, temp.id));

      const deleted = await db.query.courses.findFirst({
        where: eq(courses.id, temp.id),
      });
      expect(deleted).toBeUndefined();
    });
  });

  // ── Draft / Published ──────────────────────────────────────────────

  describe("draft/published status toggle", () => {
    let courseId: string;

    beforeAll(async () => {
      const [course] = await db
        .insert(courses)
        .values({
          tenantId: tenantAId,
          title: "Status Course",
          slug: `status-course-${ts}`,
        })
        .returning();
      courseId = course.id;
    });

    it("starts as draft", async () => {
      const course = await db.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });
      expect(course!.status).toBe("draft");
    });

    it("toggles to published", async () => {
      const [updated] = await db
        .update(courses)
        .set({ status: "published" })
        .where(eq(courses.id, courseId))
        .returning();

      expect(updated.status).toBe("published");
    });

    it("toggles back to draft", async () => {
      const [updated] = await db
        .update(courses)
        .set({ status: "draft" })
        .where(eq(courses.id, courseId))
        .returning();

      expect(updated.status).toBe("draft");
    });

    it("filters courses by status", async () => {
      // Make sure course is published
      await db.update(courses).set({ status: "published" }).where(eq(courses.id, courseId));

      const published = await db.query.courses.findMany({
        where: and(eq(courses.tenantId, tenantAId), eq(courses.status, "published")),
      });
      expect(published.some((c) => c.id === courseId)).toBe(true);

      const drafts = await db.query.courses.findMany({
        where: and(eq(courses.tenantId, tenantAId), eq(courses.status, "draft")),
      });
      expect(drafts.some((c) => c.id === courseId)).toBe(false);
    });
  });

  // ── Tenant Isolation ───────────────────────────────────────────────

  describe("tenant isolation", () => {
    let courseAId: string;

    beforeAll(async () => {
      const [courseA] = await db
        .insert(courses)
        .values({
          tenantId: tenantAId,
          title: "Tenant A Course",
          slug: `tenant-a-course-${ts}`,
        })
        .returning();
      courseAId = courseA.id;

      await db.insert(courses).values({
        tenantId: tenantBId,
        title: "Tenant B Course",
        slug: `tenant-b-course-${ts}`,
      });
    });

    it("tenant A cannot see tenant B courses", async () => {
      const tenantACourses = await db.query.courses.findMany({
        where: eq(courses.tenantId, tenantAId),
      });

      expect(tenantACourses.every((c) => c.tenantId === tenantAId)).toBe(true);
      expect(tenantACourses.some((c) => c.title === "Tenant B Course")).toBe(false);
    });

    it("tenant B cannot see tenant A courses", async () => {
      const tenantBCourses = await db.query.courses.findMany({
        where: eq(courses.tenantId, tenantBId),
      });

      expect(tenantBCourses.every((c) => c.tenantId === tenantBId)).toBe(true);
      expect(tenantBCourses.some((c) => c.title === "Tenant A Course")).toBe(false);
    });

    it("cross-tenant course access returns nothing", async () => {
      const crossAccess = await db.query.courses.findFirst({
        where: and(eq(courses.id, courseAId), eq(courses.tenantId, tenantBId)),
      });

      expect(crossAccess).toBeUndefined();
    });
  });

  // ── Module CRUD ────────────────────────────────────────────────────

  describe("module CRUD", () => {
    let courseId: string;
    let moduleId: string;

    beforeAll(async () => {
      const [course] = await db
        .insert(courses)
        .values({
          tenantId: tenantAId,
          title: "Module Test Course",
          slug: `module-test-${ts}`,
        })
        .returning();
      courseId = course.id;
    });

    it("creates a module with title and position", async () => {
      const [mod] = await db
        .insert(modules)
        .values({ courseId, title: "Getting Started", position: 0 })
        .returning();

      moduleId = mod.id;
      expect(mod.title).toBe("Getting Started");
      expect(mod.position).toBe(0);
      expect(mod.courseId).toBe(courseId);
    });

    it("creates multiple modules with ordering", async () => {
      await db.insert(modules).values({ courseId, title: "Intermediate", position: 1 });
      await db.insert(modules).values({ courseId, title: "Advanced", position: 2 });

      const mods = await db.query.modules.findMany({
        where: eq(modules.courseId, courseId),
        orderBy: (m, { asc }) => [asc(m.position)],
      });

      expect(mods).toHaveLength(3);
      expect(mods[0].title).toBe("Getting Started");
      expect(mods[1].title).toBe("Intermediate");
      expect(mods[2].title).toBe("Advanced");
    });

    it("updates a module title", async () => {
      const [updated] = await db
        .update(modules)
        .set({ title: "Quick Start" })
        .where(eq(modules.id, moduleId))
        .returning();

      expect(updated.title).toBe("Quick Start");
    });

    it("updates module position", async () => {
      const [updated] = await db
        .update(modules)
        .set({ position: 5 })
        .where(eq(modules.id, moduleId))
        .returning();

      expect(updated.position).toBe(5);
    });

    it("deletes a module", async () => {
      const [temp] = await db
        .insert(modules)
        .values({ courseId, title: "Temp Module", position: 99 })
        .returning();

      await db.delete(modules).where(eq(modules.id, temp.id));

      const deleted = await db.query.modules.findFirst({
        where: eq(modules.id, temp.id),
      });
      expect(deleted).toBeUndefined();
    });
  });

  // ── Lesson CRUD ────────────────────────────────────────────────────

  describe("lesson CRUD", () => {
    let courseId: string;
    let moduleId: string;
    let lessonId: string;

    beforeAll(async () => {
      const [course] = await db
        .insert(courses)
        .values({
          tenantId: tenantAId,
          title: "Lesson Test Course",
          slug: `lesson-test-${ts}`,
        })
        .returning();
      courseId = course.id;

      const [mod] = await db
        .insert(modules)
        .values({ courseId, title: "Module 1", position: 0 })
        .returning();
      moduleId = mod.id;
    });

    it("creates a text lesson with content", async () => {
      const [lesson] = await db
        .insert(lessons)
        .values({
          moduleId,
          title: "Welcome",
          type: "text",
          content: { text: "Hello students!" },
          position: 0,
        })
        .returning();

      lessonId = lesson.id;
      expect(lesson.title).toBe("Welcome");
      expect(lesson.type).toBe("text");
      expect(lesson.content).toEqual({ text: "Hello students!" });
      expect(lesson.position).toBe(0);
      expect(lesson.moduleId).toBe(moduleId);
    });

    it("creates lessons with different types", async () => {
      await db.insert(lessons).values({
        moduleId,
        title: "Video Lesson",
        type: "video",
        position: 1,
      });

      const all = await db.query.lessons.findMany({
        where: eq(lessons.moduleId, moduleId),
        orderBy: (l, { asc }) => [asc(l.position)],
      });

      expect(all).toHaveLength(2);
      expect(all[0].type).toBe("text");
      expect(all[1].type).toBe("video");
    });

    it("updates lesson title and content", async () => {
      const [updated] = await db
        .update(lessons)
        .set({
          title: "Welcome Updated",
          content: { text: "Updated content!" },
        })
        .where(eq(lessons.id, lessonId))
        .returning();

      expect(updated.title).toBe("Welcome Updated");
      expect(updated.content).toEqual({ text: "Updated content!" });
    });

    it("updates lesson position", async () => {
      const [updated] = await db
        .update(lessons)
        .set({ position: 10 })
        .where(eq(lessons.id, lessonId))
        .returning();

      expect(updated.position).toBe(10);
    });

    it("deletes a lesson", async () => {
      const [temp] = await db
        .insert(lessons)
        .values({ moduleId, title: "Temp", type: "text", position: 99 })
        .returning();

      await db.delete(lessons).where(eq(lessons.id, temp.id));

      const deleted = await db.query.lessons.findFirst({
        where: eq(lessons.id, temp.id),
      });
      expect(deleted).toBeUndefined();
    });
  });

  // ── Cascading Deletes ──────────────────────────────────────────────

  describe("cascading deletes", () => {
    it("deleting a module cascades to its lessons", async () => {
      const [course] = await db
        .insert(courses)
        .values({
          tenantId: tenantAId,
          title: "Cascade Module Test",
          slug: `cascade-mod-${ts}`,
        })
        .returning();

      const [mod] = await db
        .insert(modules)
        .values({ courseId: course.id, title: "Cascade Module", position: 0 })
        .returning();

      const [lesson1] = await db
        .insert(lessons)
        .values({ moduleId: mod.id, title: "Lesson 1", type: "text", position: 0 })
        .returning();

      const [lesson2] = await db
        .insert(lessons)
        .values({ moduleId: mod.id, title: "Lesson 2", type: "text", position: 1 })
        .returning();

      // Delete the module
      await db.delete(modules).where(eq(modules.id, mod.id));

      // Lessons should be gone
      const l1 = await db.query.lessons.findFirst({ where: eq(lessons.id, lesson1.id) });
      const l2 = await db.query.lessons.findFirst({ where: eq(lessons.id, lesson2.id) });
      expect(l1).toBeUndefined();
      expect(l2).toBeUndefined();
    });

    it("deleting a course cascades to modules and lessons", async () => {
      const [course] = await db
        .insert(courses)
        .values({
          tenantId: tenantAId,
          title: "Cascade Course Test",
          slug: `cascade-course-${ts}`,
        })
        .returning();

      const [mod1] = await db
        .insert(modules)
        .values({ courseId: course.id, title: "Mod A", position: 0 })
        .returning();

      const [mod2] = await db
        .insert(modules)
        .values({ courseId: course.id, title: "Mod B", position: 1 })
        .returning();

      const [lesson] = await db
        .insert(lessons)
        .values({ moduleId: mod1.id, title: "Lesson in Mod A", type: "text", position: 0 })
        .returning();

      // Delete the course
      await db.delete(courses).where(eq(courses.id, course.id));

      // Modules and lessons should be gone
      const m1 = await db.query.modules.findFirst({ where: eq(modules.id, mod1.id) });
      const m2 = await db.query.modules.findFirst({ where: eq(modules.id, mod2.id) });
      const l = await db.query.lessons.findFirst({ where: eq(lessons.id, lesson.id) });
      expect(m1).toBeUndefined();
      expect(m2).toBeUndefined();
      expect(l).toBeUndefined();
    });
  });
});
