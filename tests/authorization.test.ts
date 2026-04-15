import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users, userTenants } from "#/db/schema/index.ts";
import { tenantIdStore } from "#/lib/tenant-context.ts";

// Mock email (required by auth module)
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock getRequest (server-only API)
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost:4500"),
}));

// Mock auth.api.getSession — will be controlled per-test via mockSession
let mockSession: { user: { id: string; role?: string } } | null = null;
vi.mock("#/lib/auth.ts", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => mockSession),
    },
  },
}));

// Import after mocks are set up
const { requireMembership } = await import("#/lib/authorization.ts");

describe("requireMembership", () => {
  const suffix = Date.now();
  let tenantAId: string;
  let tenantBId: string;
  let ownerUserId: string;
  let adminUserId: string;
  let studentUserId: string;
  let noMembershipUserId: string;
  let platformAdminUserId: string;

  beforeAll(async () => {
    // Create two tenants
    const [tenantA] = await db
      .insert(tenants)
      .values({ name: "Auth Tenant A", subdomain: `auth-a-${suffix}` })
      .returning();
    tenantAId = tenantA.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: "Auth Tenant B", subdomain: `auth-b-${suffix}` })
      .returning();
    tenantBId = tenantB.id;

    // Create users
    const [owner] = await db
      .insert(users)
      .values({ name: "Owner", email: `auth-owner-${suffix}@test.com`, role: "user" })
      .returning();
    ownerUserId = owner.id;

    const [admin] = await db
      .insert(users)
      .values({ name: "Admin", email: `auth-admin-${suffix}@test.com`, role: "user" })
      .returning();
    adminUserId = admin.id;

    const [student] = await db
      .insert(users)
      .values({ name: "Student", email: `auth-student-${suffix}@test.com`, role: "user" })
      .returning();
    studentUserId = student.id;

    const [noMember] = await db
      .insert(users)
      .values({ name: "NoMember", email: `auth-nomember-${suffix}@test.com`, role: "user" })
      .returning();
    noMembershipUserId = noMember.id;

    const [platformAdmin] = await db
      .insert(users)
      .values({ name: "PlatformAdmin", email: `auth-padmin-${suffix}@test.com`, role: "platform_admin" })
      .returning();
    platformAdminUserId = platformAdmin.id;

    // Create memberships in tenant A
    await db.insert(userTenants).values([
      { userId: ownerUserId, tenantId: tenantAId, role: "tenant_owner" },
      { userId: adminUserId, tenantId: tenantAId, role: "tenant_admin" },
      { userId: studentUserId, tenantId: tenantAId, role: "student" },
    ]);
  });

  afterAll(async () => {
    // Clean up in correct order (memberships cascade from user/tenant deletes)
    const userIds = [ownerUserId, adminUserId, studentUserId, noMembershipUserId, platformAdminUserId];
    for (const id of userIds) {
      await db.delete(users).where(eq(users.id, id)).catch(() => {});
    }
    await db.delete(tenants).where(eq(tenants.id, tenantAId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantBId)).catch(() => {});
  });

  // ── Role hierarchy tests ──────────────────────────────────────────

  it("tenant_owner passes tenant_owner check", async () => {
    mockSession = { user: { id: ownerUserId, role: "user" } };
    const result = await tenantIdStore.run(tenantAId, () =>
      requireMembership("tenant_owner"),
    );
    expect(result.role).toBe("tenant_owner");
    expect(result.tenantId).toBe(tenantAId);
    expect(result.userId).toBe(ownerUserId);
  });

  it("tenant_owner passes tenant_admin check", async () => {
    mockSession = { user: { id: ownerUserId, role: "user" } };
    const result = await tenantIdStore.run(tenantAId, () =>
      requireMembership("tenant_admin"),
    );
    expect(result.role).toBe("tenant_owner");
  });

  it("tenant_owner passes student check", async () => {
    mockSession = { user: { id: ownerUserId, role: "user" } };
    const result = await tenantIdStore.run(tenantAId, () =>
      requireMembership("student"),
    );
    expect(result.role).toBe("tenant_owner");
  });

  it("tenant_admin passes tenant_admin check", async () => {
    mockSession = { user: { id: adminUserId, role: "user" } };
    const result = await tenantIdStore.run(tenantAId, () =>
      requireMembership("tenant_admin"),
    );
    expect(result.role).toBe("tenant_admin");
  });

  it("tenant_admin passes student check", async () => {
    mockSession = { user: { id: adminUserId, role: "user" } };
    const result = await tenantIdStore.run(tenantAId, () =>
      requireMembership("student"),
    );
    expect(result.role).toBe("tenant_admin");
  });

  it("tenant_admin fails tenant_owner check", async () => {
    mockSession = { user: { id: adminUserId, role: "user" } };
    await expect(
      tenantIdStore.run(tenantAId, () => requireMembership("tenant_owner")),
    ).rejects.toThrow("Forbidden: insufficient role");
  });

  it("student passes student check", async () => {
    mockSession = { user: { id: studentUserId, role: "user" } };
    const result = await tenantIdStore.run(tenantAId, () =>
      requireMembership("student"),
    );
    expect(result.role).toBe("student");
  });

  it("student fails tenant_admin check", async () => {
    mockSession = { user: { id: studentUserId, role: "user" } };
    await expect(
      tenantIdStore.run(tenantAId, () => requireMembership("tenant_admin")),
    ).rejects.toThrow("Forbidden: insufficient role");
  });

  // ── No membership ─────────────────────────────────────────────────

  it("rejects user with no membership in tenant", async () => {
    mockSession = { user: { id: noMembershipUserId, role: "user" } };
    await expect(
      tenantIdStore.run(tenantAId, () => requireMembership("student")),
    ).rejects.toThrow("Forbidden: no membership");
  });

  // ── No session ────────────────────────────────────────────────────

  it("rejects unauthenticated request", async () => {
    mockSession = null;
    await expect(
      tenantIdStore.run(tenantAId, () => requireMembership("student")),
    ).rejects.toThrow("Unauthorized");
  });

  // ── No tenant context ─────────────────────────────────────────────

  it("rejects when no tenant context is set", async () => {
    mockSession = { user: { id: ownerUserId, role: "user" } };
    await expect(requireMembership("student")).rejects.toThrow("No tenant context");
  });

  // ── platform_admin bypass ─────────────────────────────────────────

  it("platform_admin bypasses membership check for any tenant", async () => {
    mockSession = { user: { id: platformAdminUserId, role: "platform_admin" } };

    // Passes tenant_owner check in tenant A (no membership row needed)
    const resultA = await tenantIdStore.run(tenantAId, () =>
      requireMembership("tenant_owner"),
    );
    expect(resultA.role).toBe("platform_admin");
    expect(resultA.tenantId).toBe(tenantAId);

    // Passes in tenant B too (no membership there either)
    const resultB = await tenantIdStore.run(tenantBId, () =>
      requireMembership("tenant_owner"),
    );
    expect(resultB.role).toBe("platform_admin");
    expect(resultB.tenantId).toBe(tenantBId);
  });

  // ── Cross-tenant isolation ────────────────────────────────────────

  it("membership in tenant A does not grant access to tenant B", async () => {
    mockSession = { user: { id: ownerUserId, role: "user" } };
    // Owner of tenant A has no membership in tenant B
    await expect(
      tenantIdStore.run(tenantBId, () => requireMembership("student")),
    ).rejects.toThrow("Forbidden: no membership");
  });
});
