import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, modules, lessons } from "#/db/schema/index.ts";
import type { LessonContent } from "#/lib/rich-text/types.ts";
import { auth } from "./auth.ts";

type SessionUser = { id: string; role: string; tenantId: string };

async function requireInstructor(): Promise<SessionUser> {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as SessionUser;
  if (!user.role || !["tenant_owner", "tenant_admin"].includes(user.role)) {
    throw new Error("Forbidden");
  }

  return user;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Courses ──────────────────────────────────────────────────────────

export const listCoursesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireInstructor();

  return db.query.courses.findMany({
    where: eq(courses.tenantId, user.tenantId),
    orderBy: [asc(courses.createdAt)],
  });
});

export const getCourseByIdFn = createServerFn({ method: "GET" })
  .inputValidator((input: { courseId: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)),
    });

    if (!course) throw new Error("Course not found");
    return course;
  });

export const createCourseFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      title: string;
      description?: string;
      slug?: string;
      thumbnailUrl?: string;
      price?: string;
      pricingModel?: "one_time" | "subscription" | "both";
    }) => input,
  )
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    const title = data.title.trim();
    if (!title) throw new Error("Title is required");

    const slug = data.slug?.trim() || slugify(title);
    if (!slug) throw new Error("Slug is required");

    // Check slug uniqueness within tenant
    const existing = await db.query.courses.findFirst({
      where: and(eq(courses.slug, slug), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (existing) throw new Error("A course with this slug already exists");

    const [course] = await db
      .insert(courses)
      .values({
        tenantId: user.tenantId,
        title,
        description: data.description?.trim() || null,
        slug,
        thumbnailUrl: data.thumbnailUrl?.trim() || null,
        price: data.price || null,
        pricingModel: data.pricingModel || "one_time",
        status: "draft",
      })
      .returning();

    return course;
  });

export const updateCourseFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      courseId: string;
      title?: string;
      description?: string;
      slug?: string;
      thumbnailUrl?: string;
      price?: string;
      pricingModel?: "one_time" | "subscription" | "both";
      status?: "draft" | "published";
    }) => input,
  )
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    // Verify ownership
    const existing = await db.query.courses.findFirst({
      where: and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!existing) throw new Error("Course not found");

    // If slug is changing, check uniqueness
    if (data.slug) {
      const slugConflict = await db.query.courses.findFirst({
        where: and(eq(courses.slug, data.slug), eq(courses.tenantId, user.tenantId)),
        columns: { id: true },
      });
      if (slugConflict && slugConflict.id !== data.courseId) {
        throw new Error("A course with this slug already exists");
      }
    }

    const updates: Record<string, unknown> = {};
    if (data.title !== undefined) updates.title = data.title.trim();
    if (data.description !== undefined) updates.description = data.description.trim() || null;
    if (data.slug !== undefined) updates.slug = data.slug.trim();
    if (data.thumbnailUrl !== undefined) updates.thumbnailUrl = data.thumbnailUrl.trim() || null;
    if (data.price !== undefined) updates.price = data.price || null;
    if (data.pricingModel !== undefined) updates.pricingModel = data.pricingModel;
    if (data.status !== undefined) updates.status = data.status;

    const [updated] = await db
      .update(courses)
      .set(updates)
      .where(eq(courses.id, data.courseId))
      .returning();

    return updated;
  });

export const deleteCourseFn = createServerFn({ method: "POST" })
  .inputValidator((input: { courseId: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    const existing = await db.query.courses.findFirst({
      where: and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!existing) throw new Error("Course not found");

    await db.delete(courses).where(eq(courses.id, data.courseId));
    return { success: true };
  });

// ── Modules ──────────────────────────────────────────────────────────

export const listModulesFn = createServerFn({ method: "GET" })
  .inputValidator((input: { courseId: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    // Verify course ownership
    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!course) throw new Error("Course not found");

    return db.query.modules.findMany({
      where: eq(modules.courseId, data.courseId),
      orderBy: [asc(modules.position)],
    });
  });

export const createModuleFn = createServerFn({ method: "POST" })
  .inputValidator((input: { courseId: string; title: string; position?: number }) => input)
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    // Verify course ownership
    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!course) throw new Error("Course not found");

    const title = data.title.trim();
    if (!title) throw new Error("Title is required");

    // Auto-position: put at end if not specified
    let position = data.position;
    if (position === undefined) {
      const existing = await db.query.modules.findMany({
        where: eq(modules.courseId, data.courseId),
        columns: { position: true },
      });
      position = existing.length > 0 ? Math.max(...existing.map((m) => m.position)) + 1 : 0;
    }

    const [mod] = await db
      .insert(modules)
      .values({
        courseId: data.courseId,
        title,
        position,
      })
      .returning();

    return mod;
  });

export const updateModuleFn = createServerFn({ method: "POST" })
  .inputValidator((input: { moduleId: string; title?: string; position?: number }) => input)
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    // Verify module belongs to a course owned by tenant
    const mod = await db.query.modules.findFirst({
      where: eq(modules.id, data.moduleId),
    });
    if (!mod) throw new Error("Module not found");

    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!course) throw new Error("Module not found");

    const updates: Record<string, unknown> = {};
    if (data.title !== undefined) updates.title = data.title.trim();
    if (data.position !== undefined) updates.position = data.position;

    const [updated] = await db
      .update(modules)
      .set(updates)
      .where(eq(modules.id, data.moduleId))
      .returning();

    return updated;
  });

export const deleteModuleFn = createServerFn({ method: "POST" })
  .inputValidator((input: { moduleId: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    const mod = await db.query.modules.findFirst({
      where: eq(modules.id, data.moduleId),
    });
    if (!mod) throw new Error("Module not found");

    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!course) throw new Error("Module not found");

    await db.delete(modules).where(eq(modules.id, data.moduleId));
    return { success: true };
  });

// ── Lessons ──────────────────────────────────────────────────────────

export const listLessonsFn = createServerFn({ method: "GET" })
  .inputValidator((input: { moduleId: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    // Verify module → course → tenant ownership chain
    const mod = await db.query.modules.findFirst({
      where: eq(modules.id, data.moduleId),
    });
    if (!mod) throw new Error("Module not found");

    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!course) throw new Error("Module not found");

    return db.query.lessons.findMany({
      where: eq(lessons.moduleId, data.moduleId),
      orderBy: [asc(lessons.position)],
    });
  });

export const createLessonFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      moduleId: string;
      title: string;
      type?: "video" | "text" | "quiz" | "file";
      content?: LessonContent;
      position?: number;
    }) => input,
  )
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    // Verify module → course → tenant chain
    const mod = await db.query.modules.findFirst({
      where: eq(modules.id, data.moduleId),
    });
    if (!mod) throw new Error("Module not found");

    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!course) throw new Error("Module not found");

    const title = data.title.trim();
    if (!title) throw new Error("Title is required");

    let position = data.position;
    if (position === undefined) {
      const existing = await db.query.lessons.findMany({
        where: eq(lessons.moduleId, data.moduleId),
        columns: { position: true },
      });
      position = existing.length > 0 ? Math.max(...existing.map((l) => l.position)) + 1 : 0;
    }

    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId: data.moduleId,
        title,
        type: data.type || "text",
        content: data.content ?? null,
        position,
      })
      .returning();

    return lesson;
  });

export const updateLessonFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      lessonId: string;
      title?: string;
      type?: "video" | "text" | "quiz" | "file";
      content?: LessonContent;
      position?: number;
    }) => input,
  )
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.id, data.lessonId),
    });
    if (!lesson) throw new Error("Lesson not found");

    const mod = await db.query.modules.findFirst({
      where: eq(modules.id, lesson.moduleId),
    });
    if (!mod) throw new Error("Lesson not found");

    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!course) throw new Error("Lesson not found");

    const updates: Record<string, unknown> = {};
    if (data.title !== undefined) updates.title = data.title.trim();
    if (data.type !== undefined) updates.type = data.type;
    if (data.content !== undefined) updates.content = data.content;
    if (data.position !== undefined) updates.position = data.position;

    const [updated] = await db
      .update(lessons)
      .set(updates)
      .where(eq(lessons.id, data.lessonId))
      .returning();

    return updated;
  });

export const deleteLessonFn = createServerFn({ method: "POST" })
  .inputValidator((input: { lessonId: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireInstructor();

    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.id, data.lessonId),
    });
    if (!lesson) throw new Error("Lesson not found");

    const mod = await db.query.modules.findFirst({
      where: eq(modules.id, lesson.moduleId),
    });
    if (!mod) throw new Error("Lesson not found");

    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, mod.courseId), eq(courses.tenantId, user.tenantId)),
      columns: { id: true },
    });
    if (!course) throw new Error("Lesson not found");

    await db.delete(lessons).where(eq(lessons.id, data.lessonId));
    return { success: true };
  });
