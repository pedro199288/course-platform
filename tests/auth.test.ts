import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, like } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users, accounts, sessions, verifications, rateLimit, userTenants } from "#/db/schema/index.ts";
import { auth } from "#/lib/auth.ts";
import { tenantIdStore } from "#/lib/tenant-context.ts";
import { auditLogs } from "#/db/schema/audit-logs.ts";

// Mock email sending to prevent actual Resend API calls during tests
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

/** Helper: mark a user's email as verified directly in the DB */
async function verifyUserEmail(email: string) {
  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.email, email));
}

describe("auth: global registration and login", () => {
  const testEmail = `auth-global-${Date.now()}@example.com`;

  afterAll(async () => {
    const user = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });
    if (user) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, user.id)).catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db.delete(verifications).where(eq(verifications.identifier, testEmail)).catch(() => {});
  });

  it("registers a user on bare domain (no tenant context)", async () => {
    // No tenantIdStore context — simulates bare domain registration
    const result = await auth.api.signUpEmail({
      body: {
        email: testEmail,
        password: "password123",
        name: "Global User",
      },
    });

    expect(result).toBeDefined();
    expect(result.user).toBeDefined();
    expect(result.user.email).toBe(testEmail);
    expect(result.user.name).toBe("Global User");

    // Verify user is stored without tenantId and with role "user"
    const dbUser = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });
    expect(dbUser).toBeDefined();
    expect(dbUser!.tenantId).toBeNull();
    expect(dbUser!.role).toBe("user");
  });

  it("registers a user from subdomain (no membership created)", async () => {
    const tenantSubdomain = `auth-sub-${Date.now()}`;
    const [tenant] = await db.insert(tenants).values({ name: "Sub School", subdomain: tenantSubdomain }).returning();
    const subEmail = `auth-sub-${Date.now()}@example.com`;

    try {
      // Register within tenant context — should NOT create membership
      const result = await tenantIdStore.run(tenant.id, async () => {
        return auth.api.signUpEmail({
          body: {
            email: subEmail,
            password: "password123",
            name: "Subdomain User",
          },
        });
      });

      expect(result.user.email).toBe(subEmail);

      // Verify no membership was created
      const dbUser = await db.query.users.findFirst({
        where: eq(users.email, subEmail),
      });
      expect(dbUser).toBeDefined();
      expect(dbUser!.tenantId).toBeNull();
      expect(dbUser!.role).toBe("user");

      // No user_tenants record
      const membership = await db.query.userTenants.findFirst({
        where: and(
          eq(userTenants.userId, dbUser!.id),
          eq(userTenants.tenantId, tenant.id),
        ),
      });
      expect(membership).toBeUndefined();
    } finally {
      // Cleanup
      const user = await db.query.users.findFirst({ where: eq(users.email, subEmail) });
      if (user) {
        await db.delete(auditLogs).where(eq(auditLogs.actorId, user.id)).catch(() => {});
        await db.delete(sessions).where(eq(sessions.userId, user.id));
        await db.delete(accounts).where(eq(accounts.userId, user.id));
        await db.delete(users).where(eq(users.id, user.id));
      }
      await db.delete(verifications).where(eq(verifications.identifier, subEmail)).catch(() => {});
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
  });

  it("enforces global email uniqueness", async () => {
    try {
      await auth.api.signUpEmail({
        body: {
          email: testEmail, // Already registered above
          password: "anotherpassword",
          name: "Duplicate User",
        },
      });
      expect.unreachable("Should have thrown for duplicate email");
    } catch (error: any) {
      expect(error).toBeDefined();
    }
  });

  it("signs in with global email (no tenant context needed)", async () => {
    await verifyUserEmail(testEmail);

    const result = await auth.api.signInEmail({
      body: {
        email: testEmail,
        password: "password123",
      },
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe(testEmail);
    expect(result.token).toBeDefined();
  });

  it("signs in with global email from any subdomain context", async () => {
    const tenantSubdomain = `auth-cross-${Date.now()}`;
    const [tenant] = await db.insert(tenants).values({ name: "Cross School", subdomain: tenantSubdomain }).returning();

    try {
      // Sign in within a tenant context — should work because email is global
      const result = await tenantIdStore.run(tenant.id, async () => {
        return auth.api.signInEmail({
          body: {
            email: testEmail,
            password: "password123",
          },
        });
      });

      expect(result.user.email).toBe(testEmail);
      expect(result.token).toBeDefined();
    } finally {
      // Clean up audit logs that reference this tenant before deleting it
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenant.id)).catch(() => {});
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
  });

  it("assigns default 'user' role on registration", async () => {
    const dbUser = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });
    expect(dbUser).toBeDefined();
    expect(dbUser!.role).toBe("user");
  });
});

/**
 * user_tenants schema tests.
 *
 * Verifies the user_tenants table constraints: composite PK,
 * FK cascades, and enum values.
 */
describe("user_tenants schema constraints", () => {
  const tenantSubdomain = `ut-schema-${Date.now()}`;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: "UT Schema School", subdomain: tenantSubdomain }).returning();
    tenantId = tenant.id;
    const [user] = await db.insert(users).values({ name: "UT User", email: `ut-schema-${Date.now()}@test.com` }).returning();
    userId = user.id;
  });

  afterAll(async () => {
    await db.delete(userTenants).where(eq(userTenants.userId, userId)).catch(() => {});
    await db.delete(auditLogs).where(eq(auditLogs.actorId, userId)).catch(() => {});
    await db.delete(sessions).where(eq(sessions.userId, userId)).catch(() => {});
    await db.delete(accounts).where(eq(accounts.userId, userId)).catch(() => {});
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it("creates a membership with valid role", async () => {
    await db.insert(userTenants).values({ userId, tenantId, role: "student" });

    const membership = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)),
    });
    expect(membership).toBeDefined();
    expect(membership!.role).toBe("student");
  });

  it("rejects duplicate membership (composite PK)", async () => {
    await expect(
      db.insert(userTenants).values({ userId, tenantId, role: "tenant_admin" }),
    ).rejects.toThrow();
  });

  it("supports all tenant_role enum values", async () => {
    // Clean up existing membership
    await db.delete(userTenants).where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)));

    for (const role of ["tenant_owner", "tenant_admin", "student"] as const) {
      await db.insert(userTenants).values({ userId, tenantId, role });
      const m = await db.query.userTenants.findFirst({
        where: and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)),
      });
      expect(m!.role).toBe(role);
      await db.delete(userTenants).where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tenantId)));
    }
  });

  it("cascades delete when user is deleted", async () => {
    // Create a temporary user with membership
    const [tempUser] = await db.insert(users).values({ name: "Temp", email: `cascade-user-${Date.now()}@test.com` }).returning();
    await db.insert(userTenants).values({ userId: tempUser.id, tenantId, role: "student" });

    // Delete user — membership should cascade
    await db.delete(users).where(eq(users.id, tempUser.id));

    const membership = await db.query.userTenants.findFirst({
      where: eq(userTenants.userId, tempUser.id),
    });
    expect(membership).toBeUndefined();
  });

  it("cascades delete when tenant is deleted", async () => {
    // Create a temporary tenant with membership
    const [tempTenant] = await db.insert(tenants).values({ name: "Temp Tenant", subdomain: `cascade-tenant-${Date.now()}` }).returning();
    await db.insert(userTenants).values({ userId, tenantId: tempTenant.id, role: "student" });

    // Delete tenant — membership should cascade
    await db.delete(tenants).where(eq(tenants.id, tempTenant.id));

    const membership = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, userId), eq(userTenants.tenantId, tempTenant.id)),
    });
    expect(membership).toBeUndefined();
  });
});

/**
 * Global email uniqueness tests.
 */
describe("global email uniqueness", () => {
  it("rejects duplicate email across the platform", async () => {
    const email = `unique-${Date.now()}@test.com`;

    const [user1] = await db.insert(users).values({ name: "User 1", email }).returning();

    await expect(
      db.insert(users).values({ name: "User 2", email }),
    ).rejects.toThrow();

    // Cleanup
    await db.delete(users).where(eq(users.id, user1.id));
  });
});

/**
 * Email verification flow tests.
 */
describe("email verification flow", () => {
  const testEmail = `verify-${Date.now()}@example.com`;

  afterAll(async () => {
    const user = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });
    if (user) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, user.id)).catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db.delete(verifications).where(eq(verifications.identifier, testEmail)).catch(() => {});
  });

  it("registers user with emailVerified: false", async () => {
    await auth.api.signUpEmail({
      body: {
        email: testEmail,
        password: "verifytest123",
        name: "Verify Tester",
      },
    });

    const dbUser = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });
    expect(dbUser).toBeDefined();
    expect(dbUser!.emailVerified).toBe(false);
  });

  it("rejects login when email is not verified", async () => {
    try {
      await auth.api.signInEmail({
        body: {
          email: testEmail,
          password: "verifytest123",
        },
      });
      expect.unreachable("Should have thrown for unverified email");
    } catch (error: any) {
      expect(error).toBeDefined();
      expect(error.message || error.body?.message || "").toBeTruthy();
    }
  });

  it("sends verification email on signup", async () => {
    const { sendEmail } = await import("#/lib/email.ts");
    expect(sendEmail).toHaveBeenCalled();
  });

  it("allows login after email verification", async () => {
    await verifyUserEmail(testEmail);

    const dbUser = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });
    expect(dbUser!.emailVerified).toBe(true);

    const result = await auth.api.signInEmail({
      body: {
        email: testEmail,
        password: "verifytest123",
      },
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe(testEmail);
    expect(result.token).toBeDefined();
  });
});

/**
 * Password reset flow tests.
 */
describe("password reset flow", () => {
  const testEmail = `reset-${Date.now()}@example.com`;

  beforeAll(async () => {
    await auth.api.signUpEmail({
      body: {
        email: testEmail,
        password: "oldpassword123",
        name: "Reset Tester",
      },
    });
    await verifyUserEmail(testEmail);
  });

  afterAll(async () => {
    const user = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });
    if (user) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, user.id)).catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db.delete(verifications).where(like(verifications.identifier, "reset-password:%")).catch(() => {});
  });

  it("sends reset email with token on forgetPassword request", async () => {
    await db.delete(verifications).where(like(verifications.identifier, "reset-password:%")).catch(() => {});

    const { sendEmail } = await import("#/lib/email.ts");
    const mockSendEmail = sendEmail as ReturnType<typeof vi.fn>;
    mockSendEmail.mockClear();

    await auth.api.requestPasswordReset({
      body: {
        email: testEmail,
        redirectTo: "/reset-password",
      },
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: testEmail,
        subject: "Reset your password",
      }),
    );

    const token = await db.query.verifications.findFirst({
      where: like(verifications.identifier, "reset-password:%"),
    });
    expect(token).toBeDefined();
    expect(token!.value).toBeTruthy();
  });

  it("resets password with valid token and allows login with new password", async () => {
    const tokenRecord = await db.query.verifications.findFirst({
      where: like(verifications.identifier, "reset-password:%"),
    });
    expect(tokenRecord).toBeDefined();

    const resetToken = tokenRecord!.identifier.replace("reset-password:", "");

    await auth.api.resetPassword({
      body: {
        newPassword: "newpassword456",
        token: resetToken,
      },
    });

    const result = await auth.api.signInEmail({
      body: { email: testEmail, password: "newpassword456" },
    });
    expect(result).toBeDefined();
    expect(result.user.email).toBe(testEmail);
    expect(result.token).toBeDefined();
  });

  it("rejects login with old password after reset", async () => {
    try {
      await auth.api.signInEmail({
        body: { email: testEmail, password: "oldpassword123" },
      });
      expect.unreachable("Should have thrown for wrong password");
    } catch (error: any) {
      expect(error).toBeDefined();
    }
  });

  it("rejects reset with invalid token", async () => {
    try {
      await auth.api.resetPassword({
        body: {
          newPassword: "hackerpassword",
          token: "invalid-token-12345",
        },
      });
      expect.unreachable("Should have thrown for invalid token");
    } catch (error: any) {
      expect(error).toBeDefined();
    }
  });
});

/**
 * Rate limiting tests.
 */
describe("rate limiting", () => {
  const testEmail = `ratelimit-${Date.now()}@example.com`;

  beforeAll(async () => {
    await db.delete(rateLimit);

    await auth.api.signUpEmail({
      body: {
        email: testEmail,
        password: "ratelimit123",
        name: "Rate Limit Tester",
      },
    });
    await verifyUserEmail(testEmail);
  });

  afterAll(async () => {
    await db.delete(rateLimit);
    const user = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });
    if (user) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, user.id)).catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db.delete(verifications).where(eq(verifications.identifier, testEmail)).catch(() => {});
  });

  it("returns 429 when sign-in rate limit is exceeded", async () => {
    const testIp = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

    const makeSignInRequest = () => {
      const request = new Request("http://localhost:4500/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": testIp,
        },
        body: JSON.stringify({
          email: testEmail,
          password: "wrongpassword",
        }),
      });
      return auth.handler(request);
    };

    const responses: Response[] = [];
    for (let i = 0; i < 6; i++) {
      responses.push(await makeSignInRequest());
    }

    for (let i = 0; i < 5; i++) {
      expect(responses[i].status).not.toBe(429);
    }

    expect(responses[5].status).toBe(429);

    const body = await responses[5].json();
    expect(body.message).toContain("Too many requests");
  });
});
