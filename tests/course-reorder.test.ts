import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { asc, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons } from "#/db/schema/index.ts";

// ── Pure reorder helpers (same logic used by reorderModulesFn / reorderLessonsFn) ──

/**
 * Persists a reordered list of modules within a course atomically.
 * Each module's position is set to its index in `orderedIds`.
 * Validates that `orderedIds` matches the complete set of module IDs in the course.
 */
async function persistModuleOrder(courseId: string, orderedIds: string[]): Promise<void> {
  const existing = await db.query.modules.findMany({
    where: eq(modules.courseId, courseId),
    columns: { id: true },
  });

  if (existing.length !== orderedIds.length) {
    throw new Error("Module list does not match course modules");
  }
  const existingSet = new Set(existing.map((m) => m.id));
  for (const id of orderedIds) {
    if (!existingSet.has(id)) {
      throw new Error("Module list does not match course modules");
    }
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(modules).set({ position: i }).where(eq(modules.id, orderedIds[i]));
    }
  });
}

/**
 * Persists a reordered list of lessons within a module atomically.
 */
async function persistLessonOrder(moduleId: string, orderedIds: string[]): Promise<void> {
  const existing = await db.query.lessons.findMany({
    where: eq(lessons.moduleId, moduleId),
    columns: { id: true },
  });

  if (existing.length !== orderedIds.length) {
    throw new Error("Lesson list does not match module lessons");
  }
  const existingSet = new Set(existing.map((l) => l.id));
  for (const id of orderedIds) {
    if (!existingSet.has(id)) {
      throw new Error("Lesson list does not match module lessons");
    }
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(lessons).set({ position: i }).where(eq(lessons.id, orderedIds[i]));
    }
  });
}

/**
 * Pure client-side "move up/down" logic: returns a new array with the item
 * at `index` swapped with its neighbor. Used by the admin UI to derive the
 * new ordering before sending it to the server.
 */
function moveItem<T>(items: T[], index: number, direction: "up" | "down"): T[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items;
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ── Test fixtures ──────────────────────────────────────────────────────

describe("module/lesson reordering (integration)", () => {
  const ts = Date.now();
  let tenantId: string;
  let courseId: string;

  beforeAll(async () => {
    const [t] = await db
      .insert(tenants)
      .values({ name: "Reorder School", subdomain: `reorder-school-${ts}` })
      .returning();
    tenantId = t.id;

    const [c] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Reorder Course",
        slug: `reorder-course-${ts}`,
      })
      .returning();
    courseId = c.id;
  });

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  // ── Client-side move logic ─────────────────────────────────────────

  describe("moveItem helper (UI up/down logic)", () => {
    it("moves an item up by one position", () => {
      const result = moveItem(["a", "b", "c", "d"], 2, "up");
      expect(result).toEqual(["a", "c", "b", "d"]);
    });

    it("moves an item down by one position", () => {
      const result = moveItem(["a", "b", "c", "d"], 1, "down");
      expect(result).toEqual(["a", "c", "b", "d"]);
    });

    it("does not move the first item further up", () => {
      const result = moveItem(["a", "b", "c"], 0, "up");
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("does not move the last item further down", () => {
      const result = moveItem(["a", "b", "c"], 2, "down");
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("returns a new array without mutating the input", () => {
      const original = ["a", "b", "c"];
      const result = moveItem(original, 0, "down");
      expect(original).toEqual(["a", "b", "c"]);
      expect(result).not.toBe(original);
    });
  });

  // ── Module reordering persistence ──────────────────────────────────

  describe("persistModuleOrder", () => {
    let modAId: string;
    let modBId: string;
    let modCId: string;

    beforeAll(async () => {
      // Isolate this block by using its own course
      const [c] = await db
        .insert(courses)
        .values({ tenantId, title: "Mod Reorder", slug: `mod-reorder-${ts}` })
        .returning();

      const [a] = await db
        .insert(modules)
        .values({ courseId: c.id, title: "Alpha", position: 0 })
        .returning();
      const [b] = await db
        .insert(modules)
        .values({ courseId: c.id, title: "Beta", position: 1 })
        .returning();
      const [cc] = await db
        .insert(modules)
        .values({ courseId: c.id, title: "Gamma", position: 2 })
        .returning();

      modAId = a.id;
      modBId = b.id;
      modCId = cc.id;

      // Override the outer test's courseId for this describe block
      courseId = c.id;
    });

    it("reorders modules by swapping positions and persists", async () => {
      // Initial order: Alpha(0), Beta(1), Gamma(2)
      // Move Beta up → Beta(0), Alpha(1), Gamma(2)
      await persistModuleOrder(courseId, [modBId, modAId, modCId]);

      const result = await db.query.modules.findMany({
        where: eq(modules.courseId, courseId),
        orderBy: [asc(modules.position)],
      });

      expect(result.map((m) => m.id)).toEqual([modBId, modAId, modCId]);
      expect(result.map((m) => m.position)).toEqual([0, 1, 2]);
    });

    it("reorders to a completely new arrangement", async () => {
      // Reverse: Gamma, Beta, Alpha
      await persistModuleOrder(courseId, [modCId, modBId, modAId]);

      const result = await db.query.modules.findMany({
        where: eq(modules.courseId, courseId),
        orderBy: [asc(modules.position)],
      });

      expect(result.map((m) => m.id)).toEqual([modCId, modBId, modAId]);
      expect(result[0].position).toBe(0);
      expect(result[1].position).toBe(1);
      expect(result[2].position).toBe(2);
    });

    it("preserves positions after a reorder round-trip", async () => {
      await persistModuleOrder(courseId, [modAId, modBId, modCId]);

      // Re-query from a fresh DB read
      const fresh = await db.query.modules.findMany({
        where: eq(modules.courseId, courseId),
        orderBy: [asc(modules.position)],
      });

      expect(fresh.map((m) => m.title)).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(fresh.map((m) => m.position)).toEqual([0, 1, 2]);
    });

    it("rejects reorder if IDs do not match course modules", async () => {
      await expect(persistModuleOrder(courseId, [modAId, modBId])).rejects.toThrow(
        /does not match/,
      );
    });

    it("rejects reorder if a foreign ID is included", async () => {
      await expect(
        persistModuleOrder(courseId, [modAId, modBId, "00000000-0000-0000-0000-000000000000"]),
      ).rejects.toThrow(/does not match/);
    });

    it("leaves positions untouched when validation fails", async () => {
      // Ensure we start from a known order
      await persistModuleOrder(courseId, [modAId, modBId, modCId]);

      await expect(persistModuleOrder(courseId, [modAId, modBId])).rejects.toThrow();

      const after = await db.query.modules.findMany({
        where: eq(modules.courseId, courseId),
        orderBy: [asc(modules.position)],
      });
      expect(after.map((m) => m.id)).toEqual([modAId, modBId, modCId]);
    });
  });

  // ── Lesson reordering persistence ──────────────────────────────────

  describe("persistLessonOrder", () => {
    let moduleId: string;
    let lesson1Id: string;
    let lesson2Id: string;
    let lesson3Id: string;

    beforeAll(async () => {
      const [c] = await db
        .insert(courses)
        .values({ tenantId, title: "Lesson Reorder", slug: `lesson-reorder-${ts}` })
        .returning();

      const [mod] = await db
        .insert(modules)
        .values({ courseId: c.id, title: "Only Module", position: 0 })
        .returning();
      moduleId = mod.id;

      const [l1] = await db
        .insert(lessons)
        .values({ moduleId, title: "Intro", type: "text", position: 0 })
        .returning();
      const [l2] = await db
        .insert(lessons)
        .values({ moduleId, title: "Middle", type: "video", position: 1 })
        .returning();
      const [l3] = await db
        .insert(lessons)
        .values({ moduleId, title: "Wrap-up", type: "text", position: 2 })
        .returning();

      lesson1Id = l1.id;
      lesson2Id = l2.id;
      lesson3Id = l3.id;
    });

    it("reorders lessons within a module and persists", async () => {
      await persistLessonOrder(moduleId, [lesson3Id, lesson1Id, lesson2Id]);

      const result = await db.query.lessons.findMany({
        where: eq(lessons.moduleId, moduleId),
        orderBy: [asc(lessons.position)],
      });

      expect(result.map((l) => l.id)).toEqual([lesson3Id, lesson1Id, lesson2Id]);
      expect(result.map((l) => l.position)).toEqual([0, 1, 2]);
      expect(result.map((l) => l.title)).toEqual(["Wrap-up", "Intro", "Middle"]);
    });

    it("moves a lesson down via move-item + persist round-trip", async () => {
      // Start known: Intro(0), Middle(1), Wrap-up(2)
      await persistLessonOrder(moduleId, [lesson1Id, lesson2Id, lesson3Id]);

      // Simulate clicking "move down" on Intro
      const current = [lesson1Id, lesson2Id, lesson3Id];
      const next = moveItem(current, 0, "down");
      expect(next).toEqual([lesson2Id, lesson1Id, lesson3Id]);

      await persistLessonOrder(moduleId, next);

      const result = await db.query.lessons.findMany({
        where: eq(lessons.moduleId, moduleId),
        orderBy: [asc(lessons.position)],
      });
      expect(result.map((l) => l.id)).toEqual([lesson2Id, lesson1Id, lesson3Id]);
    });

    it("moves a lesson up via move-item + persist round-trip", async () => {
      await persistLessonOrder(moduleId, [lesson1Id, lesson2Id, lesson3Id]);

      // Simulate clicking "move up" on Wrap-up
      const current = [lesson1Id, lesson2Id, lesson3Id];
      const next = moveItem(current, 2, "up");
      expect(next).toEqual([lesson1Id, lesson3Id, lesson2Id]);

      await persistLessonOrder(moduleId, next);

      const result = await db.query.lessons.findMany({
        where: eq(lessons.moduleId, moduleId),
        orderBy: [asc(lessons.position)],
      });
      expect(result.map((l) => l.id)).toEqual([lesson1Id, lesson3Id, lesson2Id]);
    });

    it("rejects reorder if IDs do not match module lessons", async () => {
      await expect(persistLessonOrder(moduleId, [lesson1Id, lesson2Id])).rejects.toThrow(
        /does not match/,
      );
    });

    it("rejects reorder if a foreign lesson ID is included", async () => {
      await expect(
        persistLessonOrder(moduleId, [
          lesson1Id,
          lesson2Id,
          "00000000-0000-0000-0000-000000000000",
        ]),
      ).rejects.toThrow(/does not match/);
    });
  });

  // ── Isolation across sibling modules ───────────────────────────────

  describe("reorder isolation across siblings", () => {
    it("reordering lessons in one module does not affect another", async () => {
      const [c] = await db
        .insert(courses)
        .values({ tenantId, title: "Isolation", slug: `isolation-${ts}` })
        .returning();

      const [modA] = await db
        .insert(modules)
        .values({ courseId: c.id, title: "Mod A", position: 0 })
        .returning();
      const [modB] = await db
        .insert(modules)
        .values({ courseId: c.id, title: "Mod B", position: 1 })
        .returning();

      const [a1] = await db
        .insert(lessons)
        .values({ moduleId: modA.id, title: "A1", type: "text", position: 0 })
        .returning();
      const [a2] = await db
        .insert(lessons)
        .values({ moduleId: modA.id, title: "A2", type: "text", position: 1 })
        .returning();

      const [b1] = await db
        .insert(lessons)
        .values({ moduleId: modB.id, title: "B1", type: "text", position: 0 })
        .returning();
      const [b2] = await db
        .insert(lessons)
        .values({ moduleId: modB.id, title: "B2", type: "text", position: 1 })
        .returning();

      // Reorder module A lessons
      await persistLessonOrder(modA.id, [a2.id, a1.id]);

      // Module A is reordered
      const resultA = await db.query.lessons.findMany({
        where: eq(lessons.moduleId, modA.id),
        orderBy: [asc(lessons.position)],
      });
      expect(resultA.map((l) => l.id)).toEqual([a2.id, a1.id]);

      // Module B is untouched
      const resultB = await db.query.lessons.findMany({
        where: eq(lessons.moduleId, modB.id),
        orderBy: [asc(lessons.position)],
      });
      expect(resultB.map((l) => l.id)).toEqual([b1.id, b2.id]);
    });

    it("reordering modules in one course does not affect another", async () => {
      const [c1] = await db
        .insert(courses)
        .values({ tenantId, title: "Course X", slug: `course-x-${ts}` })
        .returning();
      const [c2] = await db
        .insert(courses)
        .values({ tenantId, title: "Course Y", slug: `course-y-${ts}` })
        .returning();

      const [x1] = await db
        .insert(modules)
        .values({ courseId: c1.id, title: "X1", position: 0 })
        .returning();
      const [x2] = await db
        .insert(modules)
        .values({ courseId: c1.id, title: "X2", position: 1 })
        .returning();

      const [y1] = await db
        .insert(modules)
        .values({ courseId: c2.id, title: "Y1", position: 0 })
        .returning();
      const [y2] = await db
        .insert(modules)
        .values({ courseId: c2.id, title: "Y2", position: 1 })
        .returning();

      await persistModuleOrder(c1.id, [x2.id, x1.id]);

      const result1 = await db.query.modules.findMany({
        where: eq(modules.courseId, c1.id),
        orderBy: [asc(modules.position)],
      });
      expect(result1.map((m) => m.id)).toEqual([x2.id, x1.id]);

      const result2 = await db.query.modules.findMany({
        where: eq(modules.courseId, c2.id),
        orderBy: [asc(modules.position)],
      });
      expect(result2.map((m) => m.id)).toEqual([y1.id, y2.id]);
    });
  });
});
