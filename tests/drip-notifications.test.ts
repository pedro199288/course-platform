import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons, enrollments } from "#/db/schema/index.ts";
import { users } from "#/db/schema/auth.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock job-queue to capture enqueued jobs without PgBoss
const sentJobs: { name: string; data: unknown }[] = [];
vi.mock("#/lib/job-queue.ts", () => ({
  registerHandler: vi.fn(),
  sendJob: vi.fn(async (name: string, data: unknown) => {
    sentJobs.push({ name, data });
    return "mock-job-id";
  }),
  getBoss: vi.fn(() => ({
    schedule: vi.fn(),
  })),
}));

describe("drip content email notifications", () => {
  const subdomain = `drip-notif-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let moduleId: string;
  let module2Id: string;
  const student1Id = crypto.randomUUID();
  const student2Id = crypto.randomUUID();

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Drip Notif School", subdomain })
      .returning();
    tenantId = tenant.id;

    await db.insert(users).values([
      {
        id: student1Id,
        tenantId,
        name: "Alice",
        email: `alice-drip-${Date.now()}@example.com`,
      },
      {
        id: student2Id,
        tenantId,
        name: "Bob",
        email: `bob-drip-${Date.now()}@example.com`,
      },
    ]);

    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Drip Notif Course",
        slug: `drip-notif-course-${Date.now()}`,
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

    // Module 2: drip after 7 days
    const [mod2] = await db
      .insert(modules)
      .values({ courseId, title: "Module 2", position: 1, availableAfterDays: 7 })
      .returning();
    module2Id = mod2.id;

    // Lesson 1: no drip (module 1)
    await db.insert(lessons).values({ moduleId, title: "Lesson 1", type: "text", position: 0 });

    // Lesson 2: drip after 3 days (module 1)
    await db.insert(lessons).values({
      moduleId,
      title: "Lesson 2",
      type: "text",
      position: 1,
      availableAfterDays: 3,
    });

    // Lesson 3: fixed date drip 2026-02-01 (module 1)
    await db.insert(lessons).values({
      moduleId,
      title: "Lesson 3",
      type: "text",
      position: 2,
      availableFromDate: new Date("2026-02-01T00:00:00Z"),
    });

    // Lesson 4: no lesson drip, but in drip module 2
    await db
      .insert(lessons)
      .values({ moduleId: module2Id, title: "Lesson 4", type: "text", position: 0 });
  });

  afterAll(async () => {
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

  // Clear captured jobs before each test
  function clearJobs() {
    sentJobs.length = 0;
  }

  it("sends no emails when no drip content unlocks today", async () => {
    clearJobs();

    // Student enrolled 1 day ago — lesson2 needs 3 days, not unlocked yet
    const enrolledAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(enrollments).values({
      tenantId,
      userId: student1Id,
      courseId,
      enrolledAt,
    });

    const { checkDripUnlocks } = await import("#/lib/drip-notification-jobs.ts");
    const now = new Date("2026-01-02T08:00:00Z"); // 1 day after enrollment
    const count = await checkDripUnlocks(now);

    expect(count).toBe(0);
    expect(sentJobs.length).toBe(0);

    // Clean up enrollment for next tests
    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId));
  });

  it("sends email when lesson-level drip unlocks within last 24h", async () => {
    clearJobs();

    // Student enrolled 3 days ago — lesson2 (availableAfterDays=3) should unlock
    const enrolledAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(enrollments).values({
      tenantId,
      userId: student1Id,
      courseId,
      enrolledAt,
    });

    const { checkDripUnlocks } = await import("#/lib/drip-notification-jobs.ts");
    // Run at 3.5 days — lesson unlocked at exactly 3 days = within last 24h
    const now = new Date("2026-01-04T12:00:00Z");
    const count = await checkDripUnlocks(now);

    expect(count).toBe(1);
    expect(sentJobs.length).toBe(1);
    const emailData = sentJobs[0].data as { subject: string; to: string };
    expect(emailData.subject).toContain("New content unlocked");

    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId));
  });

  it("sends email when date-based drip unlocks within last 24h", async () => {
    clearJobs();

    // lesson3 has availableFromDate = 2026-02-01
    const enrolledAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(enrollments).values({
      tenantId,
      userId: student1Id,
      courseId,
      enrolledAt,
    });

    const { checkDripUnlocks } = await import("#/lib/drip-notification-jobs.ts");
    // Run 12 hours after the date — within 24h window
    const now = new Date("2026-02-01T12:00:00Z");
    const count = await checkDripUnlocks(now);

    // Should include lesson3 (date-based) and possibly lesson2 (3 days, enrolled 31 days ago)
    // lesson2 unlocked at Jan 4 — not within 24h of Feb 1
    // lesson4 via module2 (7 days) unlocked at Jan 8 — not within 24h of Feb 1
    // Only lesson3 should be in the notification
    expect(count).toBe(1);

    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId));
  });

  it("sends email when module-level drip unlocks within last 24h", async () => {
    clearJobs();

    // module2 has availableAfterDays=7, lesson4 is in module2
    const enrolledAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(enrollments).values({
      tenantId,
      userId: student1Id,
      courseId,
      enrolledAt,
    });

    const { checkDripUnlocks } = await import("#/lib/drip-notification-jobs.ts");
    // Run at 7.5 days — module unlocked at exactly 7 days
    const now = new Date("2026-01-08T12:00:00Z");
    const count = await checkDripUnlocks(now);

    // lesson4 (in module2) should unlock
    expect(count).toBe(1);

    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId));
  });

  it("groups multiple lessons into one email per student per course", async () => {
    clearJobs();

    // Both lesson2 (3 days) and lesson4 (module 7 days) unlock at similar times
    // Let's set enrollment so both unlock within the same 24h window:
    // lesson2 unlocks at enrolledAt + 3 days
    // lesson4 unlocks at enrolledAt + 7 days (module-level)
    // We can't make both unlock in 24h with one enrollment unless they have same threshold
    // Instead, let's test with date-based drip where multiple lessons have same date

    // Add a lesson with same date as lesson3
    const [lessonExtra] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Lesson 3b",
        type: "text",
        position: 3,
        availableFromDate: new Date("2026-02-01T00:00:00Z"),
      })
      .returning();

    const enrolledAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(enrollments).values({
      tenantId,
      userId: student1Id,
      courseId,
      enrolledAt,
    });

    const { checkDripUnlocks } = await import("#/lib/drip-notification-jobs.ts");
    const now = new Date("2026-02-01T12:00:00Z");
    const count = await checkDripUnlocks(now);

    // One email with multiple unlocked items
    expect(count).toBe(1);
    // Only 1 send_email job (grouped)
    expect(sentJobs.length).toBe(1);

    await db.delete(lessons).where(eq(lessons.id, lessonExtra.id));
    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId));
  });

  it("sends separate emails to different students", async () => {
    clearJobs();

    // Both students enrolled at same time
    const enrolledAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(enrollments).values([
      { tenantId, userId: student1Id, courseId, enrolledAt },
      { tenantId, userId: student2Id, courseId, enrolledAt },
    ]);

    const { checkDripUnlocks } = await import("#/lib/drip-notification-jobs.ts");
    // lesson2 (3 days) unlocks for both
    const now = new Date("2026-01-04T12:00:00Z");
    const count = await checkDripUnlocks(now);

    expect(count).toBe(2);
    expect(sentJobs.length).toBe(2);

    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId));
  });

  it("does not send email for revoked enrollments", async () => {
    clearJobs();

    const enrolledAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(enrollments).values({
      tenantId,
      userId: student1Id,
      courseId,
      enrolledAt,
      revokedAt: new Date("2026-01-02T00:00:00Z"),
    });

    const { checkDripUnlocks } = await import("#/lib/drip-notification-jobs.ts");
    const now = new Date("2026-01-04T12:00:00Z");
    const count = await checkDripUnlocks(now);

    expect(count).toBe(0);
    expect(sentJobs.length).toBe(0);

    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId));
  });

  it("does not send for content that unlocked more than 24h ago", async () => {
    clearJobs();

    const enrolledAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(enrollments).values({
      tenantId,
      userId: student1Id,
      courseId,
      enrolledAt,
    });

    const { checkDripUnlocks } = await import("#/lib/drip-notification-jobs.ts");
    // lesson2 unlocked at day 3 (Jan 4), run at Jan 6 — more than 24h later
    const now = new Date("2026-01-06T00:00:00Z");
    const count = await checkDripUnlocks(now);

    // lesson2 unlocked Jan 4 — outside 24h window from Jan 6
    // lesson3 unlocks Feb 1 — not yet
    // lesson4 unlocks Jan 8 — not yet
    expect(count).toBe(0);

    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId));
  });
});
