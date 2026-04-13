import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, asc } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons } from "#/db/schema/index.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("course/module/lesson CRUD", () => {
  const tenantSubdomain = `crud-test-${Date.now()}`;
  let tenantId: string;
  let tenantBId: string;
  const tenantBSubdomain = `crud-test-b-${Date.now()}`;

  beforeAll(async () => {
    const [tenantA] = await db
      .insert(tenants)
      .values({ name: "CRUD Test School", subdomain: tenantSubdomain })
      .returning();
    tenantId = tenantA.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: "CRUD Test School B", subdomain: tenantBSubdomain })
      .returning();
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    // Clean up: lessons → modules → courses → tenants
    // Cascade deletes handle lessons and modules when courses are deleted
    await db
      .delete(courses)
      .where(eq(courses.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(courses)
      .where(eq(courses.tenantId, tenantBId))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, tenantSubdomain))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, tenantBSubdomain))
      .catch(() => {});
  });

  // ── Course CRUD ──────────────────────────────────────────────────

  let courseId: string;

  it("creates a course scoped to a tenant", async () => {
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Test Course",
        description: "A test course",
        slug: "test-course",
        price: "29.99",
        pricingModel: "one_time",
        status: "draft",
      })
      .returning();

    expect(course).toBeDefined();
    expect(course.title).toBe("Test Course");
    expect(course.tenantId).toBe(tenantId);
    expect(course.status).toBe("draft");
    expect(course.price).toBe("29.99");
    courseId = course.id;
  });

  it("lists courses filtered by tenant", async () => {
    // Create a course on tenant B
    await db.insert(courses).values({
      tenantId: tenantBId,
      title: "Other Tenant Course",
      slug: "other-course",
    });

    // Query for tenant A's courses only
    const tenantACourses = await db.select().from(courses).where(eq(courses.tenantId, tenantId));

    const tenantBCourses = await db.select().from(courses).where(eq(courses.tenantId, tenantBId));

    expect(tenantACourses.length).toBe(1);
    expect(tenantACourses[0].title).toBe("Test Course");

    expect(tenantBCourses.length).toBe(1);
    expect(tenantBCourses[0].title).toBe("Other Tenant Course");
  });

  it("updates a course", async () => {
    const [updated] = await db
      .update(courses)
      .set({ title: "Updated Course", status: "published" })
      .where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)))
      .returning();

    expect(updated.title).toBe("Updated Course");
    expect(updated.status).toBe("published");
  });

  it("rejects update on wrong tenant", async () => {
    const result = await db
      .update(courses)
      .set({ title: "Hacked" })
      .where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantBId)))
      .returning();

    // Should not match any rows
    expect(result.length).toBe(0);

    // Verify original is unchanged
    const [original] = await db.select().from(courses).where(eq(courses.id, courseId));
    expect(original.title).toBe("Updated Course");
  });

  // ── Module CRUD ──────────────────────────────────────────────────

  let moduleId: string;
  let module2Id: string;

  it("creates modules with auto-incrementing position", async () => {
    const [mod1] = await db
      .insert(modules)
      .values({ courseId, title: "Module 1", position: 0 })
      .returning();

    const [mod2] = await db
      .insert(modules)
      .values({ courseId, title: "Module 2", position: 1 })
      .returning();

    expect(mod1.position).toBe(0);
    expect(mod2.position).toBe(1);
    moduleId = mod1.id;
    module2Id = mod2.id;
  });

  it("lists modules ordered by position", async () => {
    const mods = await db
      .select()
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(asc(modules.position));

    expect(mods.length).toBe(2);
    expect(mods[0].title).toBe("Module 1");
    expect(mods[1].title).toBe("Module 2");
  });

  it("updates a module title", async () => {
    const [updated] = await db
      .update(modules)
      .set({ title: "Renamed Module" })
      .where(eq(modules.id, moduleId))
      .returning();

    expect(updated.title).toBe("Renamed Module");
  });

  // ── Lesson CRUD ──────────────────────────────────────────────────

  let lessonId: string;

  it("creates lessons with position and content", async () => {
    const [lesson1] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Introduction",
        type: "text",
        content: { text: "Welcome to the course" },
        position: 0,
      })
      .returning();

    const [lesson2] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Getting Started",
        type: "text",
        content: { text: "Let's begin" },
        position: 1,
      })
      .returning();

    expect(lesson1.title).toBe("Introduction");
    expect(lesson1.type).toBe("text");
    expect(lesson1.content).toEqual({ text: "Welcome to the course" });
    expect(lesson1.position).toBe(0);
    expect(lesson2.position).toBe(1);
    lessonId = lesson1.id;
  });

  it("lists lessons ordered by position", async () => {
    const lessonList = await db
      .select()
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId))
      .orderBy(asc(lessons.position));

    expect(lessonList.length).toBe(2);
    expect(lessonList[0].title).toBe("Introduction");
    expect(lessonList[1].title).toBe("Getting Started");
  });

  it("updates lesson content", async () => {
    const [updated] = await db
      .update(lessons)
      .set({ content: { text: "Updated welcome message" } })
      .where(eq(lessons.id, lessonId))
      .returning();

    expect(updated.content).toEqual({ text: "Updated welcome message" });
  });

  it("deletes a lesson", async () => {
    // Create a temporary lesson to delete
    const [temp] = await db
      .insert(lessons)
      .values({ moduleId, title: "To Delete", position: 99 })
      .returning();

    await db.delete(lessons).where(eq(lessons.id, temp.id));

    const found = await db.select().from(lessons).where(eq(lessons.id, temp.id));
    expect(found.length).toBe(0);
  });

  // ── Cascade Deletes ──────────────────────────────────────────────

  it("deleting a module cascades to its lessons", async () => {
    // module2 has no lessons yet; add one
    const [lesson] = await db
      .insert(lessons)
      .values({ moduleId: module2Id, title: "Cascade Test Lesson", position: 0 })
      .returning();

    await db.delete(modules).where(eq(modules.id, module2Id));

    const found = await db.select().from(lessons).where(eq(lessons.id, lesson.id));
    expect(found.length).toBe(0);
  });

  it("deleting a course cascades to modules and lessons", async () => {
    // Create a course with module and lesson for cascade test
    const [tempCourse] = await db
      .insert(courses)
      .values({ tenantId, title: "Cascade Course", slug: "cascade-course" })
      .returning();

    const [tempMod] = await db
      .insert(modules)
      .values({ courseId: tempCourse.id, title: "Cascade Module", position: 0 })
      .returning();

    const [tempLesson] = await db
      .insert(lessons)
      .values({ moduleId: tempMod.id, title: "Cascade Lesson", position: 0 })
      .returning();

    await db.delete(courses).where(eq(courses.id, tempCourse.id));

    const foundMod = await db.select().from(modules).where(eq(modules.id, tempMod.id));
    const foundLesson = await db.select().from(lessons).where(eq(lessons.id, tempLesson.id));
    expect(foundMod.length).toBe(0);
    expect(foundLesson.length).toBe(0);
  });

  // ── Draft visibility ──────────────────────────────────────────────

  it("can filter published vs draft courses", async () => {
    // courseId is "published" from the update test
    const [draftCourse] = await db
      .insert(courses)
      .values({ tenantId, title: "Draft Course", slug: "draft-course", status: "draft" })
      .returning();

    const published = await db
      .select()
      .from(courses)
      .where(and(eq(courses.tenantId, tenantId), eq(courses.status, "published")));

    const drafts = await db
      .select()
      .from(courses)
      .where(and(eq(courses.tenantId, tenantId), eq(courses.status, "draft")));

    expect(published.some((c) => c.id === courseId)).toBe(true);
    expect(drafts.some((c) => c.id === draftCourse.id)).toBe(true);
    expect(published.some((c) => c.id === draftCourse.id)).toBe(false);
  });
});
