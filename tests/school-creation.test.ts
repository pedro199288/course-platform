import { afterAll, describe, expect, it } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users, accounts, sessions, userTenants } from "#/db/schema/index.ts";

describe("school creation (integration)", () => {
  const timestamp = Date.now();

  // Subdomains created during tests, to clean up
  const createdSubdomains: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    // Clean up user_tenants, sessions, accounts, then users
    for (const userId of createdUserIds) {
      await db
        .delete(userTenants)
        .where(eq(userTenants.userId, userId))
        .catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, userId));
      await db.delete(accounts).where(eq(accounts.userId, userId));
    }
    for (const userId of createdUserIds) {
      await db.delete(users).where(eq(users.id, userId));
    }

    // Delete created tenants
    for (const sub of createdSubdomains) {
      await db.delete(tenants).where(eq(tenants.subdomain, sub));
    }
  });

  describe("tenant creation", () => {
    it("creates a new tenant with correct defaults", async () => {
      const subdomain = `school-${timestamp}-1`;
      createdSubdomains.push(subdomain);

      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Test School 1", subdomain })
        .returning();

      expect(tenant).toBeDefined();
      expect(tenant.name).toBe("Test School 1");
      expect(tenant.subdomain).toBe(subdomain);
      expect(tenant.status).toBe("active");
      expect(tenant.stripeConnectAccountId).toBeNull();
      expect(tenant.stripeOnboardingComplete).toBe("false");
      expect(tenant.planId).toBeNull();
    });

    it("sets the creator as tenant_owner via user_tenants membership", async () => {
      const subdomain = `school-${timestamp}-2`;
      createdSubdomains.push(subdomain);

      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Test School 2", subdomain })
        .returning();

      // Create a user (no tenantId — global identity)
      const [user] = await db
        .insert(users)
        .values({
          name: "Owner",
          email: `owner-${timestamp}@test.com`,
        })
        .returning();
      createdUserIds.push(user.id);

      // Create membership
      await db.insert(userTenants).values({
        userId: user.id,
        tenantId: tenant.id,
        role: "tenant_owner",
      });

      // Verify membership exists
      const membership = await db.query.userTenants.findFirst({
        where: and(eq(userTenants.userId, user.id), eq(userTenants.tenantId, tenant.id)),
      });
      expect(membership).toBeDefined();
      expect(membership!.role).toBe("tenant_owner");

      // User's global role should remain "user"
      const updatedUser = await db.query.users.findFirst({
        where: eq(users.id, user.id),
      });
      expect(updatedUser!.role).toBe("user");
    });
  });

  describe("subdomain uniqueness", () => {
    it("rejects duplicate subdomains", async () => {
      const subdomain = `unique-${timestamp}`;
      createdSubdomains.push(subdomain);

      await db.insert(tenants).values({ name: "First", subdomain });

      await expect(db.insert(tenants).values({ name: "Second", subdomain })).rejects.toThrow();
    });

    it("allows different subdomains", async () => {
      const sub1 = `diff-a-${timestamp}`;
      const sub2 = `diff-b-${timestamp}`;
      createdSubdomains.push(sub1, sub2);

      const [t1] = await db
        .insert(tenants)
        .values({ name: "School A", subdomain: sub1 })
        .returning();
      const [t2] = await db
        .insert(tenants)
        .values({ name: "School B", subdomain: sub2 })
        .returning();

      expect(t1.id).not.toBe(t2.id);
      expect(t1.subdomain).toBe(sub1);
      expect(t2.subdomain).toBe(sub2);
    });
  });

  describe("stripe onboarding fields", () => {
    it("updates stripe connect account id on tenant", async () => {
      const subdomain = `stripe-${timestamp}`;
      createdSubdomains.push(subdomain);

      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Stripe School", subdomain })
        .returning();

      expect(tenant.stripeConnectAccountId).toBeNull();

      await db
        .update(tenants)
        .set({ stripeConnectAccountId: "acct_test123" })
        .where(eq(tenants.id, tenant.id));

      const updated = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenant.id),
      });

      expect(updated!.stripeConnectAccountId).toBe("acct_test123");
    });

    it("updates stripe onboarding complete status", async () => {
      const subdomain = `stripe-onb-${timestamp}`;
      createdSubdomains.push(subdomain);

      const [tenant] = await db
        .insert(tenants)
        .values({ name: "Onboarding School", subdomain })
        .returning();

      expect(tenant.stripeOnboardingComplete).toBe("false");

      await db
        .update(tenants)
        .set({ stripeOnboardingComplete: "true" })
        .where(eq(tenants.id, tenant.id));

      const updated = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenant.id),
      });

      expect(updated!.stripeOnboardingComplete).toBe("true");
    });

    it("finds tenant by stripe account id for webhook processing", async () => {
      const subdomain = `stripe-wh-${timestamp}`;
      createdSubdomains.push(subdomain);

      const accountId = `acct_webhook_${timestamp}`;
      await db.insert(tenants).values({
        name: "Webhook School",
        subdomain,
        stripeConnectAccountId: accountId,
      });

      const result = await db
        .update(tenants)
        .set({ stripeOnboardingComplete: "true" })
        .where(eq(tenants.stripeConnectAccountId, accountId))
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].stripeOnboardingComplete).toBe("true");
    });
  });
});
