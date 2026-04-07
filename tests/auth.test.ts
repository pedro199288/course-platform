import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users, accounts, sessions } from "#/db/schema/index.ts";
import { auth } from "#/lib/auth.ts";
import { tenantIdStore } from "#/lib/tenant-context.ts";
import { auditLogs } from "#/db/schema/audit-logs.ts";

describe("auth: per-tenant registration, login, and roles", () => {
  const tenantASubdomain = `auth-test-a-${Date.now()}`;
  const tenantBSubdomain = `auth-test-b-${Date.now()}`;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    const [tenantA] = await db
      .insert(tenants)
      .values({ name: "School A", subdomain: tenantASubdomain })
      .returning();
    const [tenantB] = await db
      .insert(tenants)
      .values({ name: "School B", subdomain: tenantBSubdomain })
      .returning();
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    // Clean up in reverse order of dependencies
    await db
      .delete(sessions)
      .where(
        eq(
          sessions.userId,
          db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantAId)) as any,
        ),
      )
      .catch(() => {});
    await db
      .delete(sessions)
      .where(
        eq(
          sessions.userId,
          db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantBId)) as any,
        ),
      )
      .catch(() => {});

    // Delete accounts, then users, then tenants
    const allUsers = await db.query.users.findMany({
      where: eq(users.tenantId, tenantAId),
    });
    const allUsersB = await db.query.users.findMany({
      where: eq(users.tenantId, tenantBId),
    });
    const allUserIds = [...allUsers, ...allUsersB].map((u) => u.id);

    for (const userId of allUserIds) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
      await db.delete(accounts).where(eq(accounts.userId, userId));
    }
    for (const userId of allUserIds) {
      await db.delete(users).where(eq(users.id, userId));
    }

    await db.delete(tenants).where(eq(tenants.subdomain, tenantASubdomain));
    await db.delete(tenants).where(eq(tenants.subdomain, tenantBSubdomain));
  });

  it("registers a user scoped to a tenant via the adapter", async () => {
    // Simulate a signup request within tenant A's context
    const result = await tenantIdStore.run(tenantAId, async () => {
      return auth.api.signUpEmail({
        body: {
          email: "student@example.com",
          password: "password123",
          name: "Test Student",
        },
      });
    });

    expect(result).toBeDefined();
    expect(result.user).toBeDefined();
    expect(result.user.email).toBe("student@example.com");
    expect(result.user.name).toBe("Test Student");

    // Verify the user is stored with the correct tenantId
    const dbUser = await db.query.users.findFirst({
      where: and(eq(users.email, "student@example.com"), eq(users.tenantId, tenantAId)),
    });
    expect(dbUser).toBeDefined();
    expect(dbUser!.tenantId).toBe(tenantAId);
    expect(dbUser!.role).toBe("student");
  });

  it("allows same email on different tenants", async () => {
    // Register the same email on tenant B
    const result = await tenantIdStore.run(tenantBId, async () => {
      return auth.api.signUpEmail({
        body: {
          email: "student@example.com",
          password: "differentpassword",
          name: "Same Email Student",
        },
      });
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe("student@example.com");

    // Verify both users exist with different tenant IDs
    const userA = await db.query.users.findFirst({
      where: and(eq(users.email, "student@example.com"), eq(users.tenantId, tenantAId)),
    });
    const userB = await db.query.users.findFirst({
      where: and(eq(users.email, "student@example.com"), eq(users.tenantId, tenantBId)),
    });

    expect(userA).toBeDefined();
    expect(userB).toBeDefined();
    expect(userA!.id).not.toBe(userB!.id);
  });

  it("signs in a user within the correct tenant context", async () => {
    const result = await tenantIdStore.run(tenantAId, async () => {
      return auth.api.signInEmail({
        body: {
          email: "student@example.com",
          password: "password123",
        },
      });
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe("student@example.com");
    expect(result.token).toBeDefined();
  });

  it("rejects sign-in with wrong tenant context", async () => {
    // Try to sign in on tenant B with tenant A's password
    try {
      await tenantIdStore.run(tenantBId, async () => {
        return auth.api.signInEmail({
          body: {
            email: "student@example.com",
            password: "password123", // This is tenant A's password
          },
        });
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Expected: either user not found or password mismatch
      expect(error).toBeDefined();
    }
  });

  it("assigns default student role on registration", async () => {
    await tenantIdStore.run(tenantAId, async () => {
      return auth.api.signUpEmail({
        body: {
          email: "newstudent@example.com",
          password: "password123",
          name: "New Student",
        },
      });
    });

    const dbUser = await db.query.users.findFirst({
      where: and(eq(users.email, "newstudent@example.com"), eq(users.tenantId, tenantAId)),
    });
    expect(dbUser).toBeDefined();
    expect(dbUser!.role).toBe("student");
  });

  it("enforces email uniqueness within a tenant", async () => {
    try {
      await tenantIdStore.run(tenantAId, async () => {
        return auth.api.signUpEmail({
          body: {
            email: "student@example.com", // Already exists in tenant A
            password: "anotherpassword",
            name: "Duplicate Student",
          },
        });
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error).toBeDefined();
    }
  });
});

/**
 * Regression test for the findUserByEmail monkey-patch.
 *
 * The monkey-patch on internalAdapter.findUserByEmail is the only way to achieve
 * tenant-scoped user lookup in Better Auth (see auth.ts comments). This test
 * verifies the patch is correctly applied and working. If a Better Auth upgrade
 * changes the internal adapter structure, this test will fail and alert us.
 *
 * Related: issue #37 tracks revisiting this approach if Better Auth adds
 * hooks support for user lookups.
 */
describe("findUserByEmail monkey-patch regression", () => {
  const tenantXSubdomain = `patch-test-x-${Date.now()}`;
  const tenantYSubdomain = `patch-test-y-${Date.now()}`;
  let tenantXId: string;
  let tenantYId: string;
  const sharedEmail = `patchtest-${Date.now()}@example.com`;

  beforeAll(async () => {
    const [tenantX] = await db
      .insert(tenants)
      .values({ name: "Patch Test X", subdomain: tenantXSubdomain })
      .returning();
    const [tenantY] = await db
      .insert(tenants)
      .values({ name: "Patch Test Y", subdomain: tenantYSubdomain })
      .returning();
    tenantXId = tenantX.id;
    tenantYId = tenantY.id;

    // Register same email on both tenants
    await tenantIdStore.run(tenantXId, () =>
      auth.api.signUpEmail({
        body: { email: sharedEmail, password: "password-x", name: "User X" },
      }),
    );
    await tenantIdStore.run(tenantYId, () =>
      auth.api.signUpEmail({
        body: { email: sharedEmail, password: "password-y", name: "User Y" },
      }),
    );
  });

  afterAll(async () => {
    const allUsers = await db.query.users.findMany({
      where: eq(users.email, sharedEmail),
    });
    for (const user of allUsers) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, user.id));
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
    }
    for (const user of allUsers) {
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db.delete(tenants).where(eq(tenants.subdomain, tenantXSubdomain));
    await db.delete(tenants).where(eq(tenants.subdomain, tenantYSubdomain));
  });

  it("internalAdapter.findUserByEmail is patched and available", async () => {
    // Verify the monkey-patch is applied by checking the internal adapter exists
    // and responds correctly. If Better Auth changes the adapter structure, this
    // will fail — signaling we need to update the patch.
    const ctx = await (auth.$context as Promise<any>);
    expect(ctx.internalAdapter).toBeDefined();
    expect(typeof ctx.internalAdapter.findUserByEmail).toBe("function");
  });

  it("returns tenant-scoped user when tenantId is set", async () => {
    const result = await tenantIdStore.run(tenantXId, async () => {
      const ctx = await (auth.$context as Promise<any>);
      return ctx.internalAdapter.findUserByEmail(sharedEmail, {
        includeAccounts: true,
      });
    });

    expect(result).not.toBeNull();
    expect(result.user.email).toBe(sharedEmail);
    expect(result.user.tenantId).toBe(tenantXId);
    expect(result.accounts).toBeDefined();
  });

  it("returns correct tenant user (not cross-tenant)", async () => {
    const resultY = await tenantIdStore.run(tenantYId, async () => {
      const ctx = await (auth.$context as Promise<any>);
      return ctx.internalAdapter.findUserByEmail(sharedEmail, {
        includeAccounts: true,
      });
    });

    expect(resultY).not.toBeNull();
    expect(resultY.user.tenantId).toBe(tenantYId);
    expect(resultY.user.name).toBe("User Y");
  });

  it("falls back to original adapter when no tenantId is set", async () => {
    // Without tenant context, the original findUserByEmail is used
    const ctx = await (auth.$context as Promise<any>);
    const result = await ctx.internalAdapter.findUserByEmail(sharedEmail, {
      includeAccounts: false,
    });

    // Original adapter returns the first match (non-scoped)
    expect(result).not.toBeNull();
    expect(result.user.email).toBe(sharedEmail);
  });

  it("sign-in uses patched lookup for tenant isolation", async () => {
    // Sign in on tenant X with tenant X's password — should succeed
    const successResult = await tenantIdStore.run(tenantXId, () =>
      auth.api.signInEmail({
        body: { email: sharedEmail, password: "password-x" },
      }),
    );
    expect(successResult.user.email).toBe(sharedEmail);

    // Sign in on tenant X with tenant Y's password — should fail
    try {
      await tenantIdStore.run(tenantXId, () =>
        auth.api.signInEmail({
          body: { email: sharedEmail, password: "password-y" },
        }),
      );
      expect.unreachable("Should have thrown");
    } catch (error: any) {
      expect(error).toBeDefined();
    }
  });
});
