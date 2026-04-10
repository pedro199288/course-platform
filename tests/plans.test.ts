import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { db } from "#/db/index.ts";
import { courses, payments, plans, tenants, users } from "#/db/schema/index.ts";
import {
  assertCanAddStudent,
  assertCanCreateCourse,
  getTenantApplicationFeePercent,
} from "#/lib/plans.ts";

vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("plans: configuration, enforcement, and metrics", () => {
  const ts = Date.now();
  const smallPlanName = `Starter-${ts}`;
  const unlimitedPlanName = `Unlimited-${ts}`;
  let smallPlanId: string;
  let unlimitedPlanId: string;
  let tenantSmallId: string;
  let tenantUnlimitedId: string;
  let tenantNoPlanId: string;

  beforeAll(async () => {
    const [small] = await db
      .insert(plans)
      .values({
        name: smallPlanName,
        maxCourses: 2,
        maxStudents: 2,
        applicationFeePercent: "5.00",
      })
      .returning();
    smallPlanId = small.id;

    const [unlimited] = await db
      .insert(plans)
      .values({
        name: unlimitedPlanName,
        maxCourses: null,
        maxStudents: null,
        applicationFeePercent: "1.50",
      })
      .returning();
    unlimitedPlanId = unlimited.id;

    const [tSmall] = await db
      .insert(tenants)
      .values({
        name: `Small School ${ts}`,
        subdomain: `plan-small-${ts}`,
        planId: smallPlanId,
      })
      .returning();
    tenantSmallId = tSmall.id;

    const [tUnlimited] = await db
      .insert(tenants)
      .values({
        name: `Unlimited School ${ts}`,
        subdomain: `plan-unlimited-${ts}`,
        planId: unlimitedPlanId,
      })
      .returning();
    tenantUnlimitedId = tUnlimited.id;

    const [tNoPlan] = await db
      .insert(tenants)
      .values({
        name: `No Plan School ${ts}`,
        subdomain: `plan-none-${ts}`,
      })
      .returning();
    tenantNoPlanId = tNoPlan.id;
  });

  afterAll(async () => {
    const allTenantIds = [tenantSmallId, tenantUnlimitedId, tenantNoPlanId];
    for (const tid of allTenantIds) {
      await db.delete(payments).where(eq(payments.tenantId, tid));
      await db.delete(courses).where(eq(courses.tenantId, tid));
      await db.delete(users).where(eq(users.tenantId, tid));
      await db.delete(tenants).where(eq(tenants.id, tid));
    }
    await db.delete(plans).where(eq(plans.id, smallPlanId));
    await db.delete(plans).where(eq(plans.id, unlimitedPlanId));
  });

  describe("plan configuration", () => {
    it("stores name, maxCourses, maxStudents, and applicationFeePercent", async () => {
      const plan = await db.query.plans.findFirst({
        where: eq(plans.id, smallPlanId),
      });
      expect(plan).toBeDefined();
      expect(plan!.name).toBe(smallPlanName);
      expect(plan!.maxCourses).toBe(2);
      expect(plan!.maxStudents).toBe(2);
      expect(plan!.applicationFeePercent).toBe("5.00");
    });

    it("treats null caps as unlimited", async () => {
      const plan = await db.query.plans.findFirst({
        where: eq(plans.id, unlimitedPlanId),
      });
      expect(plan).toBeDefined();
      expect(plan!.maxCourses).toBeNull();
      expect(plan!.maxStudents).toBeNull();
    });

    it("assigns a plan to a tenant via planId FK", async () => {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantSmallId),
      });
      expect(tenant).toBeDefined();
      expect(tenant!.planId).toBe(smallPlanId);
    });

    it("updates plan fields", async () => {
      const [temp] = await db
        .insert(plans)
        .values({
          name: `UpdateMe-${ts}`,
          maxCourses: 5,
          maxStudents: 10,
          applicationFeePercent: "3.00",
        })
        .returning();

      await db
        .update(plans)
        .set({ maxCourses: 100, applicationFeePercent: "2.50" })
        .where(eq(plans.id, temp.id));

      const updated = await db.query.plans.findFirst({
        where: eq(plans.id, temp.id),
      });
      expect(updated!.maxCourses).toBe(100);
      expect(updated!.applicationFeePercent).toBe("2.50");
      expect(updated!.maxStudents).toBe(10);
      expect(updated!.name).toBe(`UpdateMe-${ts}`);

      await db.delete(plans).where(eq(plans.id, temp.id));
    });
  });

  describe("course creation constraint validation", () => {
    it("allows creating courses under the plan cap", async () => {
      await db
        .insert(courses)
        .values({ tenantId: tenantSmallId, title: "Course 1", slug: `c1-${ts}` });

      await expect(assertCanCreateCourse(tenantSmallId)).resolves.toBeUndefined();

      // Clean up
      await db
        .delete(courses)
        .where(and(eq(courses.tenantId, tenantSmallId), eq(courses.slug, `c1-${ts}`)));
    });

    it("blocks creating courses once the plan cap is reached", async () => {
      await db
        .insert(courses)
        .values({ tenantId: tenantSmallId, title: "Course 1", slug: `c1b-${ts}` });
      await db
        .insert(courses)
        .values({ tenantId: tenantSmallId, title: "Course 2", slug: `c2b-${ts}` });

      await expect(assertCanCreateCourse(tenantSmallId)).rejects.toThrow(/Plan limit reached/);

      // Clean up
      await db.delete(courses).where(eq(courses.tenantId, tenantSmallId));
    });

    it("treats tenants without a plan as unlimited", async () => {
      for (let i = 0; i < 5; i++) {
        await db
          .insert(courses)
          .values({ tenantId: tenantNoPlanId, title: `C${i}`, slug: `np-${ts}-${i}` });
      }
      await expect(assertCanCreateCourse(tenantNoPlanId)).resolves.toBeUndefined();

      // Clean up
      await db.delete(courses).where(eq(courses.tenantId, tenantNoPlanId));
    });

    it("treats plans with null maxCourses as unlimited", async () => {
      for (let i = 0; i < 5; i++) {
        await db
          .insert(courses)
          .values({ tenantId: tenantUnlimitedId, title: `U${i}`, slug: `u-${ts}-${i}` });
      }
      await expect(assertCanCreateCourse(tenantUnlimitedId)).resolves.toBeUndefined();

      // Clean up
      await db.delete(courses).where(eq(courses.tenantId, tenantUnlimitedId));
    });
  });

  describe("student signup constraint validation", () => {
    it("allows adding students under the plan cap", async () => {
      await db.insert(users).values({
        name: "Student 1",
        email: `ps1-${ts}@test.com`,
        tenantId: tenantSmallId,
        role: "student",
      });
      await expect(assertCanAddStudent(tenantSmallId)).resolves.toBeUndefined();

      await db
        .delete(users)
        .where(and(eq(users.tenantId, tenantSmallId), eq(users.role, "student")));
    });

    it("blocks adding students once the plan cap is reached", async () => {
      await db.insert(users).values({
        name: "S1",
        email: `psblock1-${ts}@test.com`,
        tenantId: tenantSmallId,
        role: "student",
      });
      await db.insert(users).values({
        name: "S2",
        email: `psblock2-${ts}@test.com`,
        tenantId: tenantSmallId,
        role: "student",
      });

      await expect(assertCanAddStudent(tenantSmallId)).rejects.toThrow(/Plan limit reached/);

      await db
        .delete(users)
        .where(and(eq(users.tenantId, tenantSmallId), eq(users.role, "student")));
    });

    it("only counts users with role=student toward the cap", async () => {
      await db.insert(users).values({
        name: "Owner",
        email: `owner-${ts}@test.com`,
        tenantId: tenantSmallId,
        role: "tenant_owner",
      });
      await db.insert(users).values({
        name: "Admin",
        email: `admin-${ts}@test.com`,
        tenantId: tenantSmallId,
        role: "tenant_admin",
      });

      // Two non-student users shouldn't consume student slots
      await expect(assertCanAddStudent(tenantSmallId)).resolves.toBeUndefined();

      await db.delete(users).where(eq(users.tenantId, tenantSmallId));
    });

    it("treats tenants without a plan as unlimited", async () => {
      for (let i = 0; i < 10; i++) {
        await db.insert(users).values({
          name: `Np${i}`,
          email: `np-${ts}-${i}@test.com`,
          tenantId: tenantNoPlanId,
          role: "student",
        });
      }
      await expect(assertCanAddStudent(tenantNoPlanId)).resolves.toBeUndefined();

      await db.delete(users).where(eq(users.tenantId, tenantNoPlanId));
    });
  });

  describe("application fee percentage lookup", () => {
    it("returns the plan's fee percent for the tenant", async () => {
      const fee = await getTenantApplicationFeePercent(tenantSmallId);
      expect(fee).toBe("5.00");
    });

    it("returns null when the tenant has no plan", async () => {
      const fee = await getTenantApplicationFeePercent(tenantNoPlanId);
      expect(fee).toBeNull();
    });
  });

  describe("plan modification", () => {
    it("reassigns a tenant from one plan to another", async () => {
      const [temp] = await db
        .insert(tenants)
        .values({
          name: `Reassign ${ts}`,
          subdomain: `reassign-${ts}`,
          planId: smallPlanId,
        })
        .returning();

      expect(temp.planId).toBe(smallPlanId);

      await db.update(tenants).set({ planId: unlimitedPlanId }).where(eq(tenants.id, temp.id));

      const reassigned = await db.query.tenants.findFirst({
        where: eq(tenants.id, temp.id),
      });
      expect(reassigned!.planId).toBe(unlimitedPlanId);

      await db.delete(tenants).where(eq(tenants.id, temp.id));
    });

    it("removes a tenant's plan by setting planId to null", async () => {
      const [temp] = await db
        .insert(tenants)
        .values({
          name: `Unassign ${ts}`,
          subdomain: `unassign-${ts}`,
          planId: smallPlanId,
        })
        .returning();

      await db.update(tenants).set({ planId: null }).where(eq(tenants.id, temp.id));

      const unassigned = await db.query.tenants.findFirst({
        where: eq(tenants.id, temp.id),
      });
      expect(unassigned!.planId).toBeNull();

      await db.delete(tenants).where(eq(tenants.id, temp.id));
    });

    it("enforcement picks up the new plan after reassignment", async () => {
      const [temp] = await db
        .insert(tenants)
        .values({
          name: `Enforce ${ts}`,
          subdomain: `enforce-${ts}`,
          planId: smallPlanId,
        })
        .returning();

      // Fill the small plan's cap of 2 courses
      await db.insert(courses).values({ tenantId: temp.id, title: "A", slug: `a-${ts}` });
      await db.insert(courses).values({ tenantId: temp.id, title: "B", slug: `b-${ts}` });

      await expect(assertCanCreateCourse(temp.id)).rejects.toThrow(/Plan limit reached/);

      // Reassign to the unlimited plan — constraint should no longer block
      await db.update(tenants).set({ planId: unlimitedPlanId }).where(eq(tenants.id, temp.id));
      await expect(assertCanCreateCourse(temp.id)).resolves.toBeUndefined();

      await db.delete(courses).where(eq(courses.tenantId, temp.id));
      await db.delete(tenants).where(eq(tenants.id, temp.id));
    });
  });

  describe("platform metrics aggregation", () => {
    it("counts all tenants in the database", async () => {
      const [row] = await db.select({ total: count() }).from(tenants);
      expect(row.total).toBeGreaterThanOrEqual(3); // at least our 3 tenants
    });

    it("counts students across all tenants", async () => {
      await db.insert(users).values({
        name: "Metrics S",
        email: `ms-${ts}@test.com`,
        tenantId: tenantNoPlanId,
        role: "student",
      });

      const [row] = await db
        .select({ total: count() })
        .from(users)
        .where(eq(users.role, "student"));
      expect(row.total).toBeGreaterThanOrEqual(1);

      await db.delete(users).where(eq(users.tenantId, tenantNoPlanId));
    });

    it("sums revenue across all payments", async () => {
      const [u] = await db
        .insert(users)
        .values({
          name: "Payer",
          email: `payer-${ts}@test.com`,
          tenantId: tenantNoPlanId,
          role: "student",
        })
        .returning();

      await db.insert(payments).values({
        tenantId: tenantNoPlanId,
        userId: u.id,
        amount: "49.99",
      });
      await db.insert(payments).values({
        tenantId: tenantNoPlanId,
        userId: u.id,
        amount: "10.01",
      });

      const [row] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(eq(payments.tenantId, tenantNoPlanId));
      expect(Number(row.total)).toBeCloseTo(60.0, 2);

      await db.delete(payments).where(eq(payments.tenantId, tenantNoPlanId));
      await db.delete(users).where(eq(users.id, u.id));
    });

    it("groups tenants by status", async () => {
      const rows = await db
        .select({ status: tenants.status, total: count() })
        .from(tenants)
        .groupBy(tenants.status);

      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.total]));
      expect(byStatus.active ?? 0).toBeGreaterThanOrEqual(3);
    });
  });
});
