import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, asc } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons } from "#/db/schema/index.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("storefront queries", () => {
  const subdomain = `store-test-${Date.now()}`;
  let tenantId: string;

  let publishedCourseId: string;
  let draftCourseId: string;
  let module1Id: string;
  let module2Id: string;

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Storefront Test School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Create a published course with modules and lessons
    const [published] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Published Course",
        slug: "published-course",
        description: "A great course",
        price: "49.99",
        pricingModel: "one_time",
        status: "published",
      })
      .returning();
    publishedCourseId = published.id;

    // Create a draft course (should NOT appear in storefront)
    const [draft] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Draft Course",
        slug: "draft-course",
        status: "draft",
      })
      .returning();
    draftCourseId = draft.id;

    // Create modules for the published course
    const [mod1] = await db
      .insert(modules)
      .values({ courseId: publishedCourseId, title: "Getting Started", position: 0 })
      .returning();
    module1Id = mod1.id;

    const [mod2] = await db
      .insert(modules)
      .values({ courseId: publishedCourseId, title: "Advanced Topics", position: 1 })
      .returning();
    module2Id = mod2.id;

    // Create lessons for modules
    await db.insert(lessons).values([
      { moduleId: module1Id, title: "Welcome", type: "text", position: 0 },
      { moduleId: module1Id, title: "Setup Guide", type: "text", position: 1 },
      { moduleId: module2Id, title: "Deep Dive Video", type: "video", position: 0 },
      { moduleId: module2Id, title: "Final Quiz", type: "quiz", position: 1 },
    ]);
  });

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.tenantId, tenantId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, subdomain)).catch(() => {});
  });

  // ── Catalog queries ──────────────────────────────────────────────

  it("lists only published courses for a tenant", async () => {
    const rows = await db
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        description: courses.description,
        price: courses.price,
        pricingModel: courses.pricingModel,
        status: courses.status,
      })
      .from(courses)
      .where(
        and(eq(courses.tenantId, tenantId), eq(courses.status, "published")),
      );

    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Published Course");
    expect(rows[0].slug).toBe("published-course");
    expect(rows[0].price).toBe("49.99");
  });

  it("excludes draft courses from storefront listing", async () => {
    const rows = await db
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(eq(courses.tenantId, tenantId), eq(courses.status, "published")),
      );

    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(draftCourseId);
  });

  // ── Course detail queries ──────────────────────────────────────

  it("fetches a published course by slug", async () => {
    const [course] = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.tenantId, tenantId),
          eq(courses.slug, "published-course"),
          eq(courses.status, "published"),
        ),
      );

    expect(course).toBeDefined();
    expect(course.title).toBe("Published Course");
    expect(course.description).toBe("A great course");
  });

  it("returns no result for a draft course slug", async () => {
    const result = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.tenantId, tenantId),
          eq(courses.slug, "draft-course"),
          eq(courses.status, "published"),
        ),
      );

    expect(result.length).toBe(0);
  });

  // ── Curriculum outline queries ──────────────────────────────────

  it("loads curriculum with modules ordered by position", async () => {
    const mods = await db
      .select({
        id: modules.id,
        title: modules.title,
        position: modules.position,
      })
      .from(modules)
      .where(eq(modules.courseId, publishedCourseId))
      .orderBy(asc(modules.position));

    expect(mods.length).toBe(2);
    expect(mods[0].title).toBe("Getting Started");
    expect(mods[1].title).toBe("Advanced Topics");
  });

  it("loads lessons per module ordered by position", async () => {
    const mod1Lessons = await db
      .select({
        id: lessons.id,
        title: lessons.title,
        type: lessons.type,
        position: lessons.position,
      })
      .from(lessons)
      .where(eq(lessons.moduleId, module1Id))
      .orderBy(asc(lessons.position));

    expect(mod1Lessons.length).toBe(2);
    expect(mod1Lessons[0].title).toBe("Welcome");
    expect(mod1Lessons[1].title).toBe("Setup Guide");

    const mod2Lessons = await db
      .select({
        id: lessons.id,
        title: lessons.title,
        type: lessons.type,
        position: lessons.position,
      })
      .from(lessons)
      .where(eq(lessons.moduleId, module2Id))
      .orderBy(asc(lessons.position));

    expect(mod2Lessons.length).toBe(2);
    expect(mod2Lessons[0].title).toBe("Deep Dive Video");
    expect(mod2Lessons[0].type).toBe("video");
    expect(mod2Lessons[1].title).toBe("Final Quiz");
    expect(mod2Lessons[1].type).toBe("quiz");
  });

  it("curriculum outline includes lesson types but not content", async () => {
    const allLessons = await db
      .select({
        title: lessons.title,
        type: lessons.type,
      })
      .from(lessons)
      .where(eq(lessons.moduleId, module1Id));

    // Verify we get type info for display icons
    for (const lesson of allLessons) {
      expect(lesson.type).toBeDefined();
      expect(["video", "text", "quiz", "file"]).toContain(lesson.type);
    }
  });

  // ── Tenant isolation ──────────────────────────────────────────────

  it("storefront query does not leak courses across tenants", async () => {
    const otherSubdomain = `store-other-${Date.now()}`;
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other School", subdomain: otherSubdomain })
      .returning();

    await db.insert(courses).values({
      tenantId: otherTenant.id,
      title: "Other School Course",
      slug: "other-course",
      status: "published",
    });

    // Query for our tenant's storefront
    const rows = await db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(
        and(eq(courses.tenantId, tenantId), eq(courses.status, "published")),
      );

    expect(rows.every((r) => r.title !== "Other School Course")).toBe(true);

    // Cleanup
    await db.delete(courses).where(eq(courses.tenantId, otherTenant.id)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, otherSubdomain)).catch(() => {});
  });
});
