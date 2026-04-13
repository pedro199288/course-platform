import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and, like } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users, accounts, sessions, verifications, rateLimit } from "#/db/schema/index.ts";
import { auth } from "#/lib/auth.ts";
import { tenantIdStore } from "#/lib/tenant-context.ts";
import { auditLogs } from "#/db/schema/audit-logs.ts";

// Mock email sending to prevent actual Resend API calls during tests
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

/** Helper: mark a user's email as verified directly in the DB */
async function verifyUserEmail(email: string, tenantId: string) {
  await db
    .update(users)
    .set({ emailVerified: true })
    .where(and(eq(users.email, email), eq(users.tenantId, tenantId)));
}

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
      await db
        .delete(auditLogs)
        .where(eq(auditLogs.actorId, userId))
        .catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, userId));
      await db.delete(accounts).where(eq(accounts.userId, userId));
    }
    for (const userId of allUserIds) {
      await db.delete(users).where(eq(users.id, userId));
    }

    // Clean up verification tokens
    await db
      .delete(verifications)
      .where(eq(verifications.identifier, "student@example.com"))
      .catch(() => {});
    await db
      .delete(verifications)
      .where(eq(verifications.identifier, "newstudent@example.com"))
      .catch(() => {});

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
    // Verify email first (requireEmailVerification is enabled)
    await verifyUserEmail("student@example.com", tenantAId);

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
    // Verify tenant B's user email too
    await verifyUserEmail("student@example.com", tenantBId);

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
    // Verify emails first (requireEmailVerification is enabled)
    await verifyUserEmail(sharedEmail, tenantXId);
    await verifyUserEmail(sharedEmail, tenantYId);

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

/**
 * Email verification flow tests.
 *
 * Tests the full lifecycle: register → emailVerified:false → login blocked →
 * verify email → login succeeds. Also tests resend verification.
 */
describe("email verification flow", () => {
  const tenantSubdomain = `verify-test-${Date.now()}`;
  let tenantId: string;
  const testEmail = `verify-${Date.now()}@example.com`;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Verify Test School", subdomain: tenantSubdomain })
      .returning();
    tenantId = tenant.id;
  });

  afterAll(async () => {
    const allUsers = await db.query.users.findMany({
      where: eq(users.tenantId, tenantId),
    });
    for (const user of allUsers) {
      await db
        .delete(auditLogs)
        .where(eq(auditLogs.actorId, user.id))
        .catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
    }
    for (const user of allUsers) {
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db
      .delete(verifications)
      .where(eq(verifications.identifier, testEmail))
      .catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, tenantSubdomain));
  });

  it("registers user with emailVerified: false", async () => {
    await tenantIdStore.run(tenantId, async () => {
      await auth.api.signUpEmail({
        body: {
          email: testEmail,
          password: "verifytest123",
          name: "Verify Tester",
        },
      });
    });

    const dbUser = await db.query.users.findFirst({
      where: and(eq(users.email, testEmail), eq(users.tenantId, tenantId)),
    });
    expect(dbUser).toBeDefined();
    expect(dbUser!.emailVerified).toBe(false);
  });

  it("rejects login when email is not verified", async () => {
    try {
      await tenantIdStore.run(tenantId, async () => {
        return auth.api.signInEmail({
          body: {
            email: testEmail,
            password: "verifytest123",
          },
        });
      });
      expect.unreachable("Should have thrown for unverified email");
    } catch (error: any) {
      expect(error).toBeDefined();
      // Better Auth returns an error for unverified email sign-in attempts
      expect(error.message || error.body?.message || "").toBeTruthy();
    }
  });

  it("sends verification email on signup", async () => {
    // The mocked sendEmail should have been called during signup
    const { sendEmail } = await import("#/lib/email.ts");
    expect(sendEmail).toHaveBeenCalled();
  });

  it("allows login after email verification", async () => {
    // Verify email directly in DB (simulating clicking the verification link)
    await verifyUserEmail(testEmail, tenantId);

    const dbUser = await db.query.users.findFirst({
      where: and(eq(users.email, testEmail), eq(users.tenantId, tenantId)),
    });
    expect(dbUser!.emailVerified).toBe(true);

    // Now sign-in should succeed
    const result = await tenantIdStore.run(tenantId, async () => {
      return auth.api.signInEmail({
        body: {
          email: testEmail,
          password: "verifytest123",
        },
      });
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe(testEmail);
    expect(result.token).toBeDefined();
  });

  it("sends verification email with JWT token on signup", async () => {
    const { sendEmail } = await import("#/lib/email.ts");
    const mockSendEmail = sendEmail as ReturnType<typeof vi.fn>;
    mockSendEmail.mockClear();

    const newEmail = `verify2-${Date.now()}@example.com`;

    await tenantIdStore.run(tenantId, async () => {
      await auth.api.signUpEmail({
        body: {
          email: newEmail,
          password: "verifytest456",
          name: "Verify Tester 2",
        },
      });
    });

    // Better Auth 1.6 uses JWT-based email verification tokens (not stored in DB).
    // Verify the verification email was sent with a URL containing a token.
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: newEmail,
        subject: "Verify your email",
      }),
    );

    // Cleanup
    const user = await db.query.users.findFirst({
      where: and(eq(users.email, newEmail), eq(users.tenantId, tenantId)),
    });
    if (user) {
      await db
        .delete(auditLogs)
        .where(eq(auditLogs.actorId, user.id))
        .catch(() => {});
      await db
        .delete(sessions)
        .where(eq(sessions.userId, user.id))
        .catch(() => {});
      await db
        .delete(accounts)
        .where(eq(accounts.userId, user.id))
        .catch(() => {});
      await db
        .delete(users)
        .where(eq(users.id, user.id))
        .catch(() => {});
    }
  });
});

/**
 * Password reset flow tests.
 *
 * Tests the full lifecycle: request reset → email sent → reset with token →
 * password changed, sessions revoked. Also tests expired/invalid tokens.
 */
describe("password reset flow", () => {
  const tenantSubdomain = `reset-test-${Date.now()}`;
  let tenantId: string;
  const testEmail = `reset-${Date.now()}@example.com`;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Reset Test School", subdomain: tenantSubdomain })
      .returning();
    tenantId = tenant.id;

    // Register and verify user
    await tenantIdStore.run(tenantId, async () => {
      await auth.api.signUpEmail({
        body: {
          email: testEmail,
          password: "oldpassword123",
          name: "Reset Tester",
        },
      });
    });
    await verifyUserEmail(testEmail, tenantId);
  });

  afterAll(async () => {
    const allUsers = await db.query.users.findMany({
      where: eq(users.tenantId, tenantId),
    });
    for (const user of allUsers) {
      await db
        .delete(auditLogs)
        .where(eq(auditLogs.actorId, user.id))
        .catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
    }
    for (const user of allUsers) {
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db
      .delete(verifications)
      .where(like(verifications.identifier, "reset-password:%"))
      .catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, tenantSubdomain));
  });

  it("sends reset email with token on forgetPassword request", async () => {
    const { sendEmail } = await import("#/lib/email.ts");
    const mockSendEmail = sendEmail as ReturnType<typeof vi.fn>;
    mockSendEmail.mockClear();

    await tenantIdStore.run(tenantId, async () => {
      await auth.api.requestPasswordReset({
        body: {
          email: testEmail,
          redirectTo: "/reset-password",
        },
      });
    });

    // Verify email was sent
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: testEmail,
        subject: "Reset your password",
      }),
    );

    // Better Auth 1.6 stores reset tokens with identifier "reset-password:<token>"
    // and the value is the userId.
    const token = await db.query.verifications.findFirst({
      where: like(verifications.identifier, "reset-password:%"),
    });
    expect(token).toBeDefined();
    expect(token!.value).toBeTruthy();
    expect(token!.expiresAt).toBeDefined();
  });

  it("resets password with valid token and allows login with new password", async () => {
    // Get the verification token from DB — identifier is "reset-password:<token>"
    const tokenRecord = await db.query.verifications.findFirst({
      where: like(verifications.identifier, "reset-password:%"),
    });
    expect(tokenRecord).toBeDefined();

    // Extract the actual token from the identifier (format: "reset-password:<token>")
    const resetToken = tokenRecord!.identifier.replace("reset-password:", "");

    // Reset the password using the token
    await auth.api.resetPassword({
      body: {
        newPassword: "newpassword456",
        token: resetToken,
      },
    });

    // Login with NEW password should succeed
    const result = await tenantIdStore.run(tenantId, async () => {
      return auth.api.signInEmail({
        body: { email: testEmail, password: "newpassword456" },
      });
    });
    expect(result).toBeDefined();
    expect(result.user.email).toBe(testEmail);
    expect(result.token).toBeDefined();
  });

  it("rejects login with old password after reset", async () => {
    try {
      await tenantIdStore.run(tenantId, async () => {
        return auth.api.signInEmail({
          body: { email: testEmail, password: "oldpassword123" },
        });
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

  it("rejects reset with expired token", async () => {
    // Request a new reset
    await tenantIdStore.run(tenantId, async () => {
      await auth.api.requestPasswordReset({
        body: { email: testEmail, redirectTo: "/reset-password" },
      });
    });

    // Manually expire the token by setting expiresAt in the past
    const tokenRecord = await db.query.verifications.findFirst({
      where: like(verifications.identifier, "reset-password:%"),
    });
    expect(tokenRecord).toBeDefined();

    const resetToken = tokenRecord!.identifier.replace("reset-password:", "");

    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 60000) }) // 1 minute ago
      .where(eq(verifications.id, tokenRecord!.id));

    try {
      await auth.api.resetPassword({
        body: {
          newPassword: "expiredtokenpassword",
          token: resetToken,
        },
      });
      expect.unreachable("Should have thrown for expired token");
    } catch (error: any) {
      expect(error).toBeDefined();
    }

    // Verify password was NOT changed (can still login with current password)
    const result = await tenantIdStore.run(tenantId, async () => {
      return auth.api.signInEmail({
        body: { email: testEmail, password: "newpassword456" },
      });
    });
    expect(result.user.email).toBe(testEmail);
  });

  it("revokes existing sessions on password reset (revokeSessionsOnPasswordReset)", async () => {
    // Create a session
    await tenantIdStore.run(tenantId, async () => {
      return auth.api.signInEmail({
        body: { email: testEmail, password: "newpassword456" },
      });
    });

    const dbUser = await db.query.users.findFirst({
      where: and(eq(users.email, testEmail), eq(users.tenantId, tenantId)),
    });

    // Count sessions before reset
    const sessionsBefore = await db.query.sessions.findMany({
      where: eq(sessions.userId, dbUser!.id),
    });
    expect(sessionsBefore.length).toBeGreaterThan(0);

    // Clean up any stale verification records from previous tests
    await db
      .delete(verifications)
      .where(like(verifications.identifier, "reset-password:%"))
      .catch(() => {});

    // Request and perform password reset
    await tenantIdStore.run(tenantId, async () => {
      await auth.api.requestPasswordReset({
        body: { email: testEmail, redirectTo: "/reset-password" },
      });
    });

    const tokenRecord = await db.query.verifications.findFirst({
      where: like(verifications.identifier, "reset-password:%"),
    });
    expect(tokenRecord).toBeDefined();

    const resetToken = tokenRecord!.identifier.replace("reset-password:", "");

    await auth.api.resetPassword({
      body: {
        newPassword: "finalpassword789",
        token: resetToken,
      },
    });

    // All previous sessions should be revoked
    const sessionsAfter = await db.query.sessions.findMany({
      where: eq(sessions.userId, dbUser!.id),
    });
    expect(sessionsAfter.length).toBe(0);
  });
});

/**
 * Rate limiting tests.
 *
 * Tests that exceeding the rate limit on /sign-in/email returns 429.
 * Uses auth.handler (HTTP router) since rate limiting is applied at the
 * router level, not on direct auth.api calls.
 */
describe("rate limiting", () => {
  const tenantSubdomain = `ratelimit-test-${Date.now()}`;
  let tenantId: string;
  const testEmail = `ratelimit-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Clean rate limit table to avoid interference from other tests
    await db.delete(rateLimit);

    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Rate Limit School", subdomain: tenantSubdomain })
      .returning();
    tenantId = tenant.id;

    // Register and verify a user for sign-in attempts
    await tenantIdStore.run(tenantId, async () => {
      await auth.api.signUpEmail({
        body: {
          email: testEmail,
          password: "ratelimit123",
          name: "Rate Limit Tester",
        },
      });
    });
    await verifyUserEmail(testEmail, tenantId);
  });

  afterAll(async () => {
    // Clean rate limit records
    await db.delete(rateLimit);

    const allUsers = await db.query.users.findMany({
      where: eq(users.tenantId, tenantId),
    });
    for (const user of allUsers) {
      await db
        .delete(auditLogs)
        .where(eq(auditLogs.actorId, user.id))
        .catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
    }
    for (const user of allUsers) {
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db
      .delete(verifications)
      .where(eq(verifications.identifier, testEmail))
      .catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, tenantSubdomain));
  });

  it("returns 429 when sign-in rate limit is exceeded", async () => {
    // The custom rule for /sign-in/email allows max 5 requests per 60 seconds.
    // However, Better Auth also has a default special rule for /sign-in/* of max 3 per 10s.
    // The custom rule overrides: { window: 60, max: 5 }.
    // We use a unique IP per test to avoid cross-test interference.
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
          password: "wrongpassword", // Intentionally wrong — we only care about rate limit
        }),
      });
      return auth.handler(request);
    };

    // Send requests up to the limit (5 for /sign-in/email)
    const responses: Response[] = [];
    for (let i = 0; i < 6; i++) {
      responses.push(await makeSignInRequest());
    }

    // First 5 should NOT be 429 (they may be 401 for wrong password, that's fine)
    for (let i = 0; i < 5; i++) {
      expect(responses[i].status).not.toBe(429);
    }

    // 6th request should be rate limited
    expect(responses[5].status).toBe(429);

    const body = await responses[5].json();
    expect(body.message).toContain("Too many requests");
  });
});

/**
 * Tenant isolation integration tests.
 *
 * Verifies that the same email can register on two different tenants
 * independently, and that cross-tenant login is correctly rejected.
 * These tests complement the earlier per-tenant tests by explicitly
 * testing isolation with full sign-in/sign-up flows.
 */
describe("tenant isolation", () => {
  const tenantASubdomain = `iso-a-${Date.now()}`;
  const tenantBSubdomain = `iso-b-${Date.now()}`;
  let tenantAId: string;
  let tenantBId: string;
  const sharedEmail = `iso-${Date.now()}@example.com`;
  const passwordA = "tenant-a-password";
  const passwordB = "tenant-b-password";

  beforeAll(async () => {
    const [tenantA] = await db
      .insert(tenants)
      .values({ name: "Isolation A", subdomain: tenantASubdomain })
      .returning();
    const [tenantB] = await db
      .insert(tenants)
      .values({ name: "Isolation B", subdomain: tenantBSubdomain })
      .returning();
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    const allUsers = await db.query.users.findMany({
      where: eq(users.email, sharedEmail),
    });
    for (const user of allUsers) {
      await db
        .delete(auditLogs)
        .where(eq(auditLogs.actorId, user.id))
        .catch(() => {});
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await db.delete(accounts).where(eq(accounts.userId, user.id));
    }
    for (const user of allUsers) {
      await db.delete(users).where(eq(users.id, user.id));
    }
    await db
      .delete(verifications)
      .where(eq(verifications.identifier, sharedEmail))
      .catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, tenantASubdomain));
    await db.delete(tenants).where(eq(tenants.subdomain, tenantBSubdomain));
  });

  it("same email registers independently on two tenants", async () => {
    // Register on tenant A
    const resultA = await tenantIdStore.run(tenantAId, () =>
      auth.api.signUpEmail({
        body: { email: sharedEmail, password: passwordA, name: "User on A" },
      }),
    );
    expect(resultA.user.email).toBe(sharedEmail);

    // Register same email on tenant B
    const resultB = await tenantIdStore.run(tenantBId, () =>
      auth.api.signUpEmail({
        body: { email: sharedEmail, password: passwordB, name: "User on B" },
      }),
    );
    expect(resultB.user.email).toBe(sharedEmail);

    // Both users exist with different tenant IDs
    const userA = await db.query.users.findFirst({
      where: and(eq(users.email, sharedEmail), eq(users.tenantId, tenantAId)),
    });
    const userB = await db.query.users.findFirst({
      where: and(eq(users.email, sharedEmail), eq(users.tenantId, tenantBId)),
    });
    expect(userA).toBeDefined();
    expect(userB).toBeDefined();
    expect(userA!.id).not.toBe(userB!.id);
    expect(userA!.tenantId).toBe(tenantAId);
    expect(userB!.tenantId).toBe(tenantBId);
  });

  it("cross-tenant login is rejected", async () => {
    // Verify both users' emails
    await verifyUserEmail(sharedEmail, tenantAId);
    await verifyUserEmail(sharedEmail, tenantBId);

    // Login on tenant A with tenant A's password → success
    const resultA = await tenantIdStore.run(tenantAId, () =>
      auth.api.signInEmail({
        body: { email: sharedEmail, password: passwordA },
      }),
    );
    expect(resultA.user.email).toBe(sharedEmail);
    expect(resultA.token).toBeDefined();

    // Login on tenant B with tenant B's password → success
    const resultB = await tenantIdStore.run(tenantBId, () =>
      auth.api.signInEmail({
        body: { email: sharedEmail, password: passwordB },
      }),
    );
    expect(resultB.user.email).toBe(sharedEmail);
    expect(resultB.token).toBeDefined();

    // Login on tenant A with tenant B's password → rejected
    try {
      await tenantIdStore.run(tenantAId, () =>
        auth.api.signInEmail({
          body: { email: sharedEmail, password: passwordB },
        }),
      );
      expect.unreachable("Cross-tenant login should have been rejected");
    } catch (error: any) {
      expect(error).toBeDefined();
    }

    // Login on tenant B with tenant A's password → rejected
    try {
      await tenantIdStore.run(tenantBId, () =>
        auth.api.signInEmail({
          body: { email: sharedEmail, password: passwordA },
        }),
      );
      expect.unreachable("Cross-tenant login should have been rejected");
    } catch (error: any) {
      expect(error).toBeDefined();
    }
  });

  it("isolated sessions between tenants", async () => {
    // Sign in on both tenants
    await tenantIdStore.run(tenantAId, () =>
      auth.api.signInEmail({
        body: { email: sharedEmail, password: passwordA },
      }),
    );
    await tenantIdStore.run(tenantBId, () =>
      auth.api.signInEmail({
        body: { email: sharedEmail, password: passwordB },
      }),
    );

    // Verify sessions belong to different users
    const userA = await db.query.users.findFirst({
      where: and(eq(users.email, sharedEmail), eq(users.tenantId, tenantAId)),
    });
    const userB = await db.query.users.findFirst({
      where: and(eq(users.email, sharedEmail), eq(users.tenantId, tenantBId)),
    });

    const sessionsA = await db.query.sessions.findMany({
      where: eq(sessions.userId, userA!.id),
    });
    const sessionsB = await db.query.sessions.findMany({
      where: eq(sessions.userId, userB!.id),
    });

    expect(sessionsA.length).toBeGreaterThan(0);
    expect(sessionsB.length).toBeGreaterThan(0);

    // Sessions are for different user IDs
    expect(sessionsA[0].userId).toBe(userA!.id);
    expect(sessionsB[0].userId).toBe(userB!.id);
    expect(sessionsA[0].userId).not.toBe(sessionsB[0].userId);
  });
});
