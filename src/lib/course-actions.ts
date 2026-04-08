import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, asc, desc } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, modules, lessons } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";

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

// ── Courses ──────────────────────────────────────────────────────────

export const listCoursesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  return db
    .select()
    .from(courses)
    .where(eq(courses.tenantId, user.tenantId))
    .orderBy(desc(courses.createdAt));
});

export const getCourseByIdFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Course not found");
    return course;
  });

export const createCourseFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { title: string; description?: string; slug: string; price?: string; pricingModel?: "one_time" | "subscription" | "both" }) => d,
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [course] = await db
      .insert(courses)
      .values({
        tenantId: user.tenantId,
        title: data.title,
        description: data.description ?? null,
        slug: data.slug,
        price: data.price ?? null,
        pricingModel: data.pricingModel ?? "one_time",
        status: "draft",
      })
      .returning();
    return course;
  });

export const updateCourseFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      courseId: string;
      title?: string;
      description?: string;
      slug?: string;
      price?: string;
      pricingModel?: "one_time" | "subscription" | "both";
      status?: "draft" | "published";
    }) => d,
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const { courseId, ...updates } = data;

    // Only include defined fields
    const setValues: Record<string, unknown> = {};
    if (updates.title !== undefined) setValues.title = updates.title;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.slug !== undefined) setValues.slug = updates.slug;
    if (updates.price !== undefined) setValues.price = updates.price;
    if (updates.pricingModel !== undefined) setValues.pricingModel = updates.pricingModel;
    if (updates.status !== undefined) setValues.status = updates.status;

    const [course] = await db
      .update(courses)
      .set(setValues)
      .where(and(eq(courses.id, courseId), eq(courses.tenantId, user.tenantId)))
      .returning();
    if (!course) throw new Error("Course not found");
    return course;
  });

export const deleteCourseFn = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [deleted] = await db
      .delete(courses)
      .where(and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)))
      .returning({ id: courses.id });
    if (!deleted) throw new Error("Course not found");
    return { success: true };
  });

// ── Modules ──────────────────────────────────────────────────────────

export const listModulesFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    // Verify course belongs to tenant
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Course not found");

    return db
      .select()
      .from(modules)
      .where(eq(modules.courseId, data.courseId))
      .orderBy(asc(modules.position));
  });

export const createModuleFn = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string; title: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    // Verify course belongs to tenant
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Course not found");

    // Get next position
    const existing = await db
      .select({ position: modules.position })
      .from(modules)
      .where(eq(modules.courseId, data.courseId))
      .orderBy(desc(modules.position))
      .limit(1);
    const nextPosition = existing.length > 0 ? existing[0].position + 1 : 0;

    const [mod] = await db
      .insert(modules)
      .values({
        courseId: data.courseId,
        title: data.title,
        position: nextPosition,
      })
      .returning();
    return mod;
  });

export const updateModuleFn = createServerFn({ method: "POST" })
  .inputValidator((d: { moduleId: string; title?: string; position?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    // Verify module's course belongs to tenant
    const [existing] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, data.moduleId));
    if (!existing) throw new Error("Module not found");

    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, existing.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Forbidden");

    const setValues: Record<string, unknown> = {};
    if (data.title !== undefined) setValues.title = data.title;
    if (data.position !== undefined) setValues.position = data.position;

    const [mod] = await db
      .update(modules)
      .set(setValues)
      .where(eq(modules.id, data.moduleId))
      .returning();
    return mod;
  });

export const deleteModuleFn = createServerFn({ method: "POST" })
  .inputValidator((d: { moduleId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [existing] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, data.moduleId));
    if (!existing) throw new Error("Module not found");

    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, existing.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Forbidden");

    await db.delete(modules).where(eq(modules.id, data.moduleId));
    return { success: true };
  });

// ── Lessons ──────────────────────────────────────────────────────────

export const listLessonsFn = createServerFn({ method: "GET" })
  .inputValidator((d: { moduleId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    // Verify module's course belongs to tenant
    const [mod] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, data.moduleId));
    if (!mod) throw new Error("Module not found");

    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Forbidden");

    return db
      .select()
      .from(lessons)
      .where(eq(lessons.moduleId, data.moduleId))
      .orderBy(asc(lessons.position)) as any;
  });

export const createLessonFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { moduleId: string; title: string; type?: "video" | "text" | "quiz" | "file"; content?: Record<string, unknown> | null }) => d,
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [mod] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, data.moduleId));
    if (!mod) throw new Error("Module not found");

    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Forbidden");

    // Get next position
    const existing = await db
      .select({ position: lessons.position })
      .from(lessons)
      .where(eq(lessons.moduleId, data.moduleId))
      .orderBy(desc(lessons.position))
      .limit(1);
    const nextPosition = existing.length > 0 ? existing[0].position + 1 : 0;

    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId: data.moduleId,
        title: data.title,
        type: data.type ?? "text",
        content: data.content ?? null,
        position: nextPosition,
      })
      .returning();
    return lesson as any;
  });

export const updateLessonFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { lessonId: string; title?: string; content?: Record<string, unknown> | null; type?: "video" | "text" | "quiz" | "file"; position?: number }) => d,
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [existing] = await db
      .select({ moduleId: lessons.moduleId })
      .from(lessons)
      .where(eq(lessons.id, data.lessonId));
    if (!existing) throw new Error("Lesson not found");

    const [mod] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, existing.moduleId));
    if (!mod) throw new Error("Module not found");

    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Forbidden");

    const setValues: Record<string, unknown> = {};
    if (data.title !== undefined) setValues.title = data.title;
    if (data.content !== undefined) setValues.content = data.content;
    if (data.type !== undefined) setValues.type = data.type;
    if (data.position !== undefined) setValues.position = data.position;

    const [lesson] = await db
      .update(lessons)
      .set(setValues)
      .where(eq(lessons.id, data.lessonId))
      .returning();
    return lesson as any;
  });

export const deleteLessonFn = createServerFn({ method: "POST" })
  .inputValidator((d: { lessonId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [existing] = await db
      .select({ moduleId: lessons.moduleId })
      .from(lessons)
      .where(eq(lessons.id, data.lessonId));
    if (!existing) throw new Error("Lesson not found");

    const [mod] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, existing.moduleId));
    if (!mod) throw new Error("Module not found");

    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)));
    if (!course) throw new Error("Forbidden");

    await db.delete(lessons).where(eq(lessons.id, data.lessonId));
    return { success: true };
  });
