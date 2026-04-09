import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { count, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users, accounts, sessions, plans } from "#/db/schema/index.ts";

vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("platform admin: tenant management", () => {
  const timestamp = Date.now();
  const platformTenantSubdomain = `pa-platform-${timestamp}`;
  const tenantASubdomain = `pa-school-a-${timestamp}`;
  const tenantBSubdomain = `pa-school-b-${timestamp}`;
  let platformTenantId: string;
  let tenantAId: string;
  let tenantBId: string;
  let platformAdminId: string;
  let studentUserId: string;
  let tenantOwnerUserId: string;
  let testPlanId: string;

  beforeAll(async () => {
    // Create a plan for testing
    const [plan] = await db
      .insert(plans)
      .values({ name: "Pro Plan", maxCourses: 10, maxStudents: 100 })
      .returning();
    testPlanId = plan.id;

    // Create platform tenant (where the platform admin user lives)
    const [platformTenant] = await db
      .insert(tenants)
      .values({ name: "Platform", subdomain: platformTenantSubdomain })
      .returning();
    platformTenantId = platformTenant.id;

    // Create school tenants
    const [tenantA] = await db
      .insert(tenants)
      .values({ name: "School Alpha", subdomain: tenantASubdomain, planId: testPlanId })
      .returning();
    tenantAId = tenantA.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: "School Beta", subdomain: tenantBSubdomain, status: "suspended" })
      .returning();
    tenantBId = tenantB.id;

    // Create a platform_admin user
    const [adminUser] = await db
      .insert(users)
      .values({
        name: "Platform Admin",
        email: `padmin-${timestamp}@test.com`,
        tenantId: platformTenantId,
        role: "platform_admin",
      })
      .returning();
    platformAdminId = adminUser.id;

    // Create a student user on tenant A
    const [student] = await db
      .insert(users)
      .values({
        name: "Student One",
        email: `student1-${timestamp}@test.com`,
        tenantId: tenantAId,
        role: "student",
      })
      .returning();
    studentUserId = student.id;

    // Create a tenant_owner on tenant A
    const [owner] = await db
      .insert(users)
      .values({
        name: "Owner One",
        email: `owner1-${timestamp}@test.com`,
        tenantId: tenantAId,
        role: "tenant_owner",
      })
      .returning();
    tenantOwnerUserId = owner.id;

    // Create another student on tenant A for count testing
    await db.insert(users).values({
      name: "Student Two",
      email: `student2-${timestamp}@test.com`,
      tenantId: tenantAId,
      role: "student",
    });
  });

  afterAll(async () => {
    // Clean up users and their sessions/accounts
    const allTenantIds = [platformTenantId, tenantAId, tenantBId];
    const allUsers: { id: string }[] = [];

    for (const tid of allTenantIds) {
      const tusers = await db.query.users.findMany({
        where: eq(users.tenantId, tid),
        columns: { id: true },
      });
      allUsers.push(...tusers);
    }

    for (const u of allUsers) {
      await db.delete(sessions).where(eq(sessions.userId, u.id));
      await db.delete(accounts).where(eq(accounts.userId, u.id));
    }
    for (const u of allUsers) {
      await db.delete(users).where(eq(users.id, u.id));
    }

    // Delete tenants
    await db.delete(tenants).where(eq(tenants.id, tenantAId));
    await db.delete(tenants).where(eq(tenants.id, tenantBId));
    await db.delete(tenants).where(eq(tenants.id, platformTenantId));

    // Delete plan
    await db.delete(plans).where(eq(plans.id, testPlanId));
  });

  describe("access control", () => {
    it("platform_admin role exists and is distinct from tenant roles", async () => {
      const admin = await db.query.users.findFirst({
        where: eq(users.id, platformAdminId),
      });
      expect(admin).toBeDefined();
      expect(admin!.role).toBe("platform_admin");
    });

    it("student users do not have platform_admin role", async () => {
      const student = await db.query.users.findFirst({
        where: eq(users.id, studentUserId),
      });
      expect(student).toBeDefined();
      expect(student!.role).toBe("student");
      expect(student!.role).not.toBe("platform_admin");
    });

    it("tenant_owner users do not have platform_admin role", async () => {
      const owner = await db.query.users.findFirst({
        where: eq(users.id, tenantOwnerUserId),
      });
      expect(owner).toBeDefined();
      expect(owner!.role).toBe("tenant_owner");
      expect(owner!.role).not.toBe("platform_admin");
    });

    it("platform_admin role check correctly identifies authorized users", () => {
      const isAdmin = (role: string) => role === "platform_admin";

      expect(isAdmin("platform_admin")).toBe(true);
      expect(isAdmin("tenant_owner")).toBe(false);
      expect(isAdmin("tenant_admin")).toBe(false);
      expect(isAdmin("student")).toBe(false);
    });
  });

  describe("tenant listing", () => {
    it("lists all tenants with their status", async () => {
      const result = await db
        .select({
          id: tenants.id,
          name: tenants.name,
          subdomain: tenants.subdomain,
          status: tenants.status,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .orderBy(tenants.createdAt);

      // Our test tenants should be in the results
      const ourTenants = result.filter((t) =>
        [platformTenantId, tenantAId, tenantBId].includes(t.id),
      );
      expect(ourTenants.length).toBe(3);

      const schoolA = ourTenants.find((t) => t.id === tenantAId);
      expect(schoolA).toBeDefined();
      expect(schoolA!.name).toBe("School Alpha");
      expect(schoolA!.status).toBe("active");

      const schoolB = ourTenants.find((t) => t.id === tenantBId);
      expect(schoolB).toBeDefined();
      expect(schoolB!.name).toBe("School Beta");
      expect(schoolB!.status).toBe("suspended");
    });

    it("includes plan information via join", async () => {
      const result = await db
        .select({
          id: tenants.id,
          name: tenants.name,
          planName: plans.name,
        })
        .from(tenants)
        .leftJoin(plans, eq(tenants.planId, plans.id));

      const schoolA = result.find((t) => t.id === tenantAId);
      expect(schoolA).toBeDefined();
      expect(schoolA!.planName).toBe("Pro Plan");

      const schoolB = result.find((t) => t.id === tenantBId);
      expect(schoolB).toBeDefined();
      expect(schoolB!.planName).toBeNull();
    });

    it("computes student count per tenant", async () => {
      const studentCounts = await db
        .select({
          tenantId: users.tenantId,
          count: count(),
        })
        .from(users)
        .where(eq(users.role, "student"))
        .groupBy(users.tenantId);

      const tenantACount = studentCounts.find((sc) => sc.tenantId === tenantAId);
      expect(tenantACount).toBeDefined();
      expect(tenantACount!.count).toBe(2);

      // Tenant B has no students
      const tenantBCount = studentCounts.find((sc) => sc.tenantId === tenantBId);
      expect(tenantBCount).toBeUndefined();
    });

    it("includes creation date for each tenant", async () => {
      const result = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantAId),
      });
      expect(result).toBeDefined();
      expect(result!.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("tenant status modification", () => {
    it("updates tenant status from active to suspended", async () => {
      // Create a temporary tenant for modification testing
      const subdomain = `pa-mod-${timestamp}`;
      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Mod School", subdomain })
        .returning();

      expect(tenant.status).toBe("active");

      await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenant.id));

      const updated = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenant.id),
      });
      expect(updated!.status).toBe("suspended");

      // Clean up
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    });

    it("updates tenant status from suspended to inactive", async () => {
      const subdomain = `pa-mod2-${timestamp}`;
      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Mod School 2", subdomain, status: "suspended" })
        .returning();

      expect(tenant.status).toBe("suspended");

      await db.update(tenants).set({ status: "inactive" }).where(eq(tenants.id, tenant.id));

      const updated = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenant.id),
      });
      expect(updated!.status).toBe("inactive");

      // Clean up
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    });

    it("updates tenant status from inactive back to active", async () => {
      const subdomain = `pa-mod3-${timestamp}`;
      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Mod School 3", subdomain, status: "inactive" })
        .returning();

      expect(tenant.status).toBe("inactive");

      await db.update(tenants).set({ status: "active" }).where(eq(tenants.id, tenant.id));

      const updated = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenant.id),
      });
      expect(updated!.status).toBe("active");

      // Clean up
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    });

    it("does not modify other tenant fields when updating status", async () => {
      const subdomain = `pa-mod4-${timestamp}`;
      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Keep Fields School", subdomain, planId: testPlanId })
        .returning();

      await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenant.id));

      const updated = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenant.id),
      });
      expect(updated!.name).toBe("Keep Fields School");
      expect(updated!.subdomain).toBe(subdomain);
      expect(updated!.planId).toBe(testPlanId);
      expect(updated!.status).toBe("suspended");

      // Clean up
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    });
  });
});
