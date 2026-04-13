import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  lessonProgress,
} from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";
import { computeDripLockedLessonIds } from "#/lib/lesson-actions.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("drip content", () => {
  const subdomain = `drip-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let moduleId: string;
  let module2Id: string;
  let lesson1Id: string;
  let lesson2Id: string;
  let lesson3Id: string;
  let lesson4Id: string;
  const studentId = crypto.randomUUID();
  const enrolledAt = new Date("2026-01-01T00:00:00Z");

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Drip Test School", subdomain })
      .returning();
    tenantId = tenant.id;

    await db.insert(users).values({
      id: studentId,
      tenantId,
      name: "Drip Student",
      email: `drip-student-${Date.now()}@example.com`,
    });

    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Drip Course",
        slug: "drip-course",
        status: "published",
      })
      .returning();
    courseId = course.id;

    // Module 1: no drip
    const [mod1] = await db
      .insert(modules)
      .values({ courseId, title: "Module 1", position: 0 })
      .returning();
    moduleId = mod1.id;

    // Module 2: drip after 14 days
    const [mod2] = await db
      .insert(modules)
      .values({
        courseId,
        title: "Module 2",
        position: 1,
        availableAfterDays: 14,
      })
      .returning();
    module2Id = mod2.id;

    // Lesson 1: no drip (in module 1)
    const [l1] = await db
      .insert(lessons)
      .values({ moduleId, title: "Lesson 1", type: "text", position: 0 })
      .returning();
    lesson1Id = l1.id;

    // Lesson 2: drip after 7 days (in module 1)
    const [l2] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Lesson 2",
        type: "text",
        position: 1,
        availableAfterDays: 7,
      })
      .returning();
    lesson2Id = l2.id;

    // Lesson 3: fixed date drip (in module 1)
    const [l3] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Lesson 3",
        type: "text",
        position: 2,
        availableFromDate: new Date("2026-03-01T00:00:00Z"),
      })
      .returning();
    lesson3Id = l3.id;

    // Lesson 4: no lesson-level drip, but in drip module 2
    const [l4] = await db
      .insert(lessons)
      .values({ moduleId: module2Id, title: "Lesson 4", type: "text", position: 0 })
      .returning();
    lesson4Id = l4.id;

    await db.insert(enrollments).values({
      tenantId,
      userId: studentId,
      courseId,
      enrolledAt,
    });
  });

  afterAll(async () => {
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
      .where(eq(lessons.moduleId, moduleId))
      .catch(() => {});
    await db
      .delete(lessons)
      .where(eq(lessons.moduleId, module2Id))
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

  // ── Pure function tests ──────────────────────────

  it("lesson with no drip is never locked", () => {
    const result = computeDripLockedLessonIds(
      [{ id: "a", availableAfterDays: null, availableFromDate: null }],
      new Map([["a", "m1"]]),
      new Map([["m1", { availableAfterDays: null, availableFromDate: null }]]),
      new Date("2026-01-01"),
      new Date("2026-01-01"),
    );
    expect(result.lockedIds).toEqual([]);
  });

  it("lesson with availableAfterDays is locked before elapsed", () => {
    const enrolled = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-05T00:00:00Z"); // 4 days after enrollment
    const result = computeDripLockedLessonIds(
      [{ id: "a", availableAfterDays: 7, availableFromDate: null }],
      new Map([["a", "m1"]]),
      new Map([["m1", { availableAfterDays: null, availableFromDate: null }]]),
      enrolled,
      now,
    );
    expect(result.lockedIds).toContain("a");
    expect(result.unlockInfo.get("a")).toBe("Unlocks in 3 days");
  });

  it("lesson with availableAfterDays is unlocked after elapsed", () => {
    const enrolled = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-09T00:00:00Z"); // 8 days after enrollment
    const result = computeDripLockedLessonIds(
      [{ id: "a", availableAfterDays: 7, availableFromDate: null }],
      new Map([["a", "m1"]]),
      new Map([["m1", { availableAfterDays: null, availableFromDate: null }]]),
      enrolled,
      now,
    );
    expect(result.lockedIds).not.toContain("a");
  });

  it("lesson with availableFromDate is locked before date", () => {
    const now = new Date("2026-02-15T00:00:00Z");
    const result = computeDripLockedLessonIds(
      [{ id: "a", availableAfterDays: null, availableFromDate: new Date("2026-03-01") }],
      new Map([["a", "m1"]]),
      new Map([["m1", { availableAfterDays: null, availableFromDate: null }]]),
      null,
      now,
    );
    expect(result.lockedIds).toContain("a");
  });

  it("lesson with availableFromDate is unlocked after date", () => {
    const now = new Date("2026-03-02T00:00:00Z");
    const result = computeDripLockedLessonIds(
      [{ id: "a", availableAfterDays: null, availableFromDate: new Date("2026-03-01") }],
      new Map([["a", "m1"]]),
      new Map([["m1", { availableAfterDays: null, availableFromDate: null }]]),
      null,
      now,
    );
    expect(result.lockedIds).not.toContain("a");
  });

  it("module-level drip locks all lessons within module", () => {
    const enrolled = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-05T00:00:00Z");
    const result = computeDripLockedLessonIds(
      [
        { id: "a", availableAfterDays: null, availableFromDate: null },
        { id: "b", availableAfterDays: null, availableFromDate: null },
      ],
      new Map([
        ["a", "m1"],
        ["b", "m1"],
      ]),
      new Map([["m1", { availableAfterDays: 10, availableFromDate: null }]]),
      enrolled,
      now,
    );
    expect(result.lockedIds).toContain("a");
    expect(result.lockedIds).toContain("b");
  });

  it("stricter of module and lesson drip wins", () => {
    const enrolled = new Date("2026-01-01T00:00:00Z");
    // 8 days later: lesson drip (7 days) met, but module drip (14 days) not met
    const now = new Date("2026-01-09T00:00:00Z");
    const result = computeDripLockedLessonIds(
      [{ id: "a", availableAfterDays: 7, availableFromDate: null }],
      new Map([["a", "m1"]]),
      new Map([["m1", { availableAfterDays: 14, availableFromDate: null }]]),
      enrolled,
      now,
    );
    expect(result.lockedIds).toContain("a");
  });

  it("unlock info shows 'Unlocks tomorrow' for 1-day-away lessons", () => {
    const enrolled = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-07T12:00:00Z"); // ~6.5 days in, unlock at 7 → ceil(0.5) = 1
    const result = computeDripLockedLessonIds(
      [{ id: "a", availableAfterDays: 7, availableFromDate: null }],
      new Map([["a", "m1"]]),
      new Map([["m1", { availableAfterDays: null, availableFromDate: null }]]),
      enrolled,
      now,
    );
    expect(result.lockedIds).toContain("a");
    expect(result.unlockInfo.get("a")).toBe("Unlocks tomorrow");
  });

  // ── Database integration tests ──────────────────────────

  it("stores availableAfterDays on lessons", async () => {
    const [lesson] = await db
      .select({ availableAfterDays: lessons.availableAfterDays })
      .from(lessons)
      .where(eq(lessons.id, lesson2Id));
    expect(lesson.availableAfterDays).toBe(7);
  });

  it("stores availableFromDate on lessons", async () => {
    const [lesson] = await db
      .select({ availableFromDate: lessons.availableFromDate })
      .from(lessons)
      .where(eq(lessons.id, lesson3Id));
    expect(lesson.availableFromDate).toBeTruthy();
  });

  it("stores availableAfterDays on modules", async () => {
    const [mod] = await db
      .select({ availableAfterDays: modules.availableAfterDays })
      .from(modules)
      .where(eq(modules.id, module2Id));
    expect(mod.availableAfterDays).toBe(14);
  });

  it("lesson without drip is always available", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const result = computeDripLockedLessonIds(
      [{ id: lesson1Id, availableAfterDays: null, availableFromDate: null }],
      new Map([[lesson1Id, moduleId]]),
      new Map([[moduleId, { availableAfterDays: null, availableFromDate: null }]]),
      enrolledAt,
      now,
    );
    expect(result.lockedIds).not.toContain(lesson1Id);
  });

  it("drip lesson locked before days elapsed (real IDs)", () => {
    const now = new Date("2026-01-03T00:00:00Z"); // 2 days after enrollment
    const result = computeDripLockedLessonIds(
      [{ id: lesson2Id, availableAfterDays: 7, availableFromDate: null }],
      new Map([[lesson2Id, moduleId]]),
      new Map([[moduleId, { availableAfterDays: null, availableFromDate: null }]]),
      enrolledAt,
      now,
    );
    expect(result.lockedIds).toContain(lesson2Id);
  });

  it("drip lesson unlocked after days elapsed (real IDs)", () => {
    const now = new Date("2026-01-10T00:00:00Z"); // 9 days after enrollment
    const result = computeDripLockedLessonIds(
      [{ id: lesson2Id, availableAfterDays: 7, availableFromDate: null }],
      new Map([[lesson2Id, moduleId]]),
      new Map([[moduleId, { availableAfterDays: null, availableFromDate: null }]]),
      enrolledAt,
      now,
    );
    expect(result.lockedIds).not.toContain(lesson2Id);
  });

  it("module-level drip locks lesson in drip module (real IDs)", () => {
    const now = new Date("2026-01-10T00:00:00Z"); // 9 days — module needs 14
    const result = computeDripLockedLessonIds(
      [{ id: lesson4Id, availableAfterDays: null, availableFromDate: null }],
      new Map([[lesson4Id, module2Id]]),
      new Map([[module2Id, { availableAfterDays: 14, availableFromDate: null }]]),
      enrolledAt,
      now,
    );
    expect(result.lockedIds).toContain(lesson4Id);
  });

  it("module-level drip unlocks lesson after enough days (real IDs)", () => {
    const now = new Date("2026-01-20T00:00:00Z"); // 19 days — module needs 14
    const result = computeDripLockedLessonIds(
      [{ id: lesson4Id, availableAfterDays: null, availableFromDate: null }],
      new Map([[lesson4Id, module2Id]]),
      new Map([[module2Id, { availableAfterDays: 14, availableFromDate: null }]]),
      enrolledAt,
      now,
    );
    expect(result.lockedIds).not.toContain(lesson4Id);
  });

  it("date-based drip locks before date, unlocks after (real IDs)", () => {
    // Before
    const before = new Date("2026-02-15T00:00:00Z");
    const r1 = computeDripLockedLessonIds(
      [
        {
          id: lesson3Id,
          availableAfterDays: null,
          availableFromDate: new Date("2026-03-01T00:00:00Z"),
        },
      ],
      new Map([[lesson3Id, moduleId]]),
      new Map([[moduleId, { availableAfterDays: null, availableFromDate: null }]]),
      enrolledAt,
      before,
    );
    expect(r1.lockedIds).toContain(lesson3Id);

    // After
    const after = new Date("2026-03-02T00:00:00Z");
    const r2 = computeDripLockedLessonIds(
      [
        {
          id: lesson3Id,
          availableAfterDays: null,
          availableFromDate: new Date("2026-03-01T00:00:00Z"),
        },
      ],
      new Map([[lesson3Id, moduleId]]),
      new Map([[moduleId, { availableAfterDays: null, availableFromDate: null }]]),
      enrolledAt,
      after,
    );
    expect(r2.lockedIds).not.toContain(lesson3Id);
  });
});
