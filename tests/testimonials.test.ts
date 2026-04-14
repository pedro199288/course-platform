import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq, and, isNull, asc } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, testimonials } from "#/db/schema/index.ts";

describe("testimonials", () => {
  const subdomain = `testimonial-test-${Date.now()}`;
  const subdomain2 = `testimonial-test2-${Date.now()}`;
  let tenantId: string;
  let tenant2Id: string;
  let courseId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Testimonial School", subdomain })
      .returning();
    tenantId = tenant.id;

    const [tenant2] = await db
      .insert(tenants)
      .values({ name: "Other School", subdomain: subdomain2 })
      .returning();
    tenant2Id = tenant2.id;

    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Test Course",
        slug: `testimonial-course-${Date.now()}`,
        status: "published",
      })
      .returning();
    courseId = course.id;
  });

  afterAll(async () => {
    await db
      .delete(testimonials)
      .where(eq(testimonials.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(testimonials)
      .where(eq(testimonials.tenantId, tenant2Id))
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

  // ── CRUD ──────────────────────────────────────────────────────

  it("creates a tenant-level testimonial (courseId null)", async () => {
    const [t] = await db
      .insert(testimonials)
      .values({
        tenantId,
        authorName: "Alice",
        body: "Great platform!",
        rating: 5,
        position: 0,
      })
      .returning();

    expect(t.authorName).toBe("Alice");
    expect(t.body).toBe("Great platform!");
    expect(t.rating).toBe(5);
    expect(t.courseId).toBeNull();
    expect(t.position).toBe(0);
  });

  it("creates a course-level testimonial", async () => {
    const [t] = await db
      .insert(testimonials)
      .values({
        tenantId,
        courseId,
        authorName: "Bob",
        body: "Loved this course!",
        rating: 4,
        position: 0,
      })
      .returning();

    expect(t.authorName).toBe("Bob");
    expect(t.courseId).toBe(courseId);
  });

  it("updates a testimonial", async () => {
    const [created] = await db
      .insert(testimonials)
      .values({
        tenantId,
        authorName: "Carol",
        body: "Original text",
        position: 1,
      })
      .returning();

    const [updated] = await db
      .update(testimonials)
      .set({ body: "Updated text", rating: 3 })
      .where(eq(testimonials.id, created.id))
      .returning();

    expect(updated.body).toBe("Updated text");
    expect(updated.rating).toBe(3);
    expect(updated.authorName).toBe("Carol");
  });

  it("deletes a testimonial", async () => {
    const [created] = await db
      .insert(testimonials)
      .values({
        tenantId,
        authorName: "Dave",
        body: "Will be deleted",
        position: 99,
      })
      .returning();

    await db.delete(testimonials).where(eq(testimonials.id, created.id));

    const remaining = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.id, created.id));
    expect(remaining.length).toBe(0);
  });

  // ── Ordering ──────────────────────────────────────────────────

  it("returns testimonials ordered by position", async () => {
    // Clear existing
    await db.delete(testimonials).where(eq(testimonials.tenantId, tenantId));

    await db.insert(testimonials).values([
      { tenantId, authorName: "Third", body: "c", position: 2 },
      { tenantId, authorName: "First", body: "a", position: 0 },
      { tenantId, authorName: "Second", body: "b", position: 1 },
    ]);

    const rows = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.tenantId, tenantId))
      .orderBy(asc(testimonials.position));

    expect(rows.map((r) => r.authorName)).toEqual(["First", "Second", "Third"]);
  });

  // ── Tenant isolation ──────────────────────────────────────────

  it("testimonials are scoped to tenant", async () => {
    await db.insert(testimonials).values({
      tenantId: tenant2Id,
      authorName: "Other Tenant User",
      body: "Should not appear in tenant 1",
      position: 0,
    });

    const t1Rows = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.tenantId, tenantId));

    const leaked = t1Rows.filter((r) => r.tenantId === tenant2Id);
    expect(leaked.length).toBe(0);
  });

  // ── Storefront queries ────────────────────────────────────────

  it("filters tenant-level vs course-level testimonials", async () => {
    await db.delete(testimonials).where(eq(testimonials.tenantId, tenantId));

    await db.insert(testimonials).values([
      { tenantId, authorName: "Tenant Level", body: "On storefront", position: 0 },
      { tenantId, courseId, authorName: "Course Level", body: "On course page", position: 0 },
    ]);

    const tenantLevel = await db
      .select()
      .from(testimonials)
      .where(and(eq(testimonials.tenantId, tenantId), isNull(testimonials.courseId)));
    expect(tenantLevel.length).toBe(1);
    expect(tenantLevel[0].authorName).toBe("Tenant Level");

    const courseLevel = await db
      .select()
      .from(testimonials)
      .where(and(eq(testimonials.tenantId, tenantId), eq(testimonials.courseId, courseId)));
    expect(courseLevel.length).toBe(1);
    expect(courseLevel[0].authorName).toBe("Course Level");
  });

  // ── Cascade delete ────────────────────────────────────────────

  it("course-level testimonials are deleted when course is deleted (cascade)", async () => {
    const [tempCourse] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Temp Course",
        slug: `temp-testimonial-cascade-${Date.now()}`,
        status: "draft",
      })
      .returning();

    await db.insert(testimonials).values({
      tenantId,
      courseId: tempCourse.id,
      authorName: "Will Cascade",
      body: "This should be removed with the course.",
      position: 0,
    });

    await db.delete(courses).where(eq(courses.id, tempCourse.id));

    const remaining = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.courseId, tempCourse.id));
    expect(remaining.length).toBe(0);
  });
});
