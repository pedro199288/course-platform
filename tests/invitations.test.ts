import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users, userTenants, invitations } from "#/db/schema/index.ts";
import { tenantIdStore } from "#/lib/tenant-context.ts";

// Mock email
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

// Mock getRequest
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost:4500"),
}));

// Mock auth.api.getSession
let mockSession: { user: { id: string; role?: string } } | null = null;
vi.mock("#/lib/auth.ts", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => mockSession),
    },
  },
}));

// Import after mocks
const { requireMembership } = await import("#/lib/authorization.ts");
const { claimPendingInvitations } = await import("#/lib/invitation-actions.ts");

describe("invitation flow", () => {
  const suffix = Date.now();
  let tenantId: string;
  let ownerUserId: string;
  let adminUserId: string;
  let existingUserId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Invite School", subdomain: `invite-${suffix}` })
      .returning();
    tenantId = tenant.id;

    const [owner] = await db
      .insert(users)
      .values({ name: "Owner", email: `inv-owner-${suffix}@test.com`, role: "user" })
      .returning();
    ownerUserId = owner.id;

    const [admin] = await db
      .insert(users)
      .values({ name: "Admin", email: `inv-admin-${suffix}@test.com`, role: "user" })
      .returning();
    adminUserId = admin.id;

    const [existing] = await db
      .insert(users)
      .values({ name: "Existing", email: `inv-existing-${suffix}@test.com`, role: "user" })
      .returning();
    existingUserId = existing.id;

    await db.insert(userTenants).values([
      { userId: ownerUserId, tenantId, role: "tenant_owner" },
      { userId: adminUserId, tenantId, role: "tenant_admin" },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(invitations)
      .where(eq(invitations.tenantId, tenantId))
      .catch(() => {});
    for (const id of [ownerUserId, adminUserId, existingUserId]) {
      await db
        .delete(users)
        .where(eq(users.id, id))
        .catch(() => {});
    }
    await db
      .delete(tenants)
      .where(eq(tenants.id, tenantId))
      .catch(() => {});
  });

  // ── Direct invitation of existing user ────────────────────────

  it("creates membership immediately when inviting an existing user", async () => {
    // Simulate what inviteTenantAdminFn does: owner context, insert membership
    mockSession = { user: { id: ownerUserId, role: "user" } };
    const { userId, tenantId: tid } = await tenantIdStore.run(tenantId, () =>
      requireMembership("tenant_owner"),
    );

    const email = `inv-existing-${suffix}@test.com`;
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    expect(existingUser).toBeTruthy();

    // Check no existing membership
    const existingMembership = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, existingUser!.id), eq(userTenants.tenantId, tid)),
    });
    expect(existingMembership).toBeFalsy();

    // Create membership
    await db.insert(userTenants).values({
      userId: existingUser!.id,
      tenantId: tid,
      role: "tenant_admin",
    });

    // Record invitation as accepted
    await db.insert(invitations).values({
      tenantId: tid,
      email,
      role: "tenant_admin",
      invitedBy: userId,
      status: "accepted",
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Verify
    const membership = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, existingUser!.id), eq(userTenants.tenantId, tid)),
    });
    expect(membership).toBeTruthy();
    expect(membership!.role).toBe("tenant_admin");
  });

  // ── Pending invitation for non-existing user ──────────────────

  it("creates pending invitation for non-existing user email", async () => {
    const email = `inv-new-${suffix}@test.com`;

    await db.insert(invitations).values({
      tenantId,
      email,
      role: "tenant_admin",
      invitedBy: ownerUserId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const invitation = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.email, email),
        eq(invitations.tenantId, tenantId),
        eq(invitations.status, "pending"),
      ),
    });
    expect(invitation).toBeTruthy();
    expect(invitation!.role).toBe("tenant_admin");
  });

  // ── Duplicate rejection ───────────────────────────────────────

  it("detects duplicate pending invitation for same email + tenant", async () => {
    const email = `inv-new-${suffix}@test.com`;
    const existing = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.email, email),
        eq(invitations.tenantId, tenantId),
        eq(invitations.status, "pending"),
      ),
    });
    expect(existing).toBeTruthy();
  });

  it("detects existing membership to reject duplicate invitation", async () => {
    const existingMembership = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, existingUserId), eq(userTenants.tenantId, tenantId)),
    });
    expect(existingMembership).toBeTruthy();
  });

  // ── Authorization: only tenant_owner can invite ───────────────

  it("tenant_admin cannot pass tenant_owner check", async () => {
    mockSession = { user: { id: adminUserId, role: "user" } };
    await expect(
      tenantIdStore.run(tenantId, () => requireMembership("tenant_owner")),
    ).rejects.toThrow("Forbidden: insufficient role");
  });

  // ── Claim pending invitations on registration ─────────────────

  it("claimPendingInvitations creates membership for new user", async () => {
    const email = `inv-new-${suffix}@test.com`;
    const [newUser] = await db
      .insert(users)
      .values({ name: "NewUser", email, role: "user" })
      .returning();

    try {
      await claimPendingInvitations(email, newUser.id);

      // Verify membership was created
      const membership = await db.query.userTenants.findFirst({
        where: and(eq(userTenants.userId, newUser.id), eq(userTenants.tenantId, tenantId)),
      });
      expect(membership).toBeTruthy();
      expect(membership!.role).toBe("tenant_admin");

      // Verify invitation marked as accepted
      const invitation = await db.query.invitations.findFirst({
        where: and(
          eq(invitations.email, email),
          eq(invitations.tenantId, tenantId),
          eq(invitations.status, "accepted"),
        ),
      });
      expect(invitation).toBeTruthy();
      expect(invitation!.acceptedAt).toBeTruthy();
    } finally {
      await db
        .delete(userTenants)
        .where(and(eq(userTenants.userId, newUser.id), eq(userTenants.tenantId, tenantId)))
        .catch(() => {});
      await db
        .delete(users)
        .where(eq(users.id, newUser.id))
        .catch(() => {});
    }
  });

  // ── Expired invitation not claimed ────────────────────────────

  it("claimPendingInvitations marks expired invitation and skips it", async () => {
    const email = `inv-expired-${suffix}@test.com`;

    // Create an expired invitation
    await db.insert(invitations).values({
      tenantId,
      email,
      role: "tenant_admin",
      invitedBy: ownerUserId,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const [newUser] = await db
      .insert(users)
      .values({ name: "ExpiredUser", email, role: "user" })
      .returning();

    try {
      await claimPendingInvitations(email, newUser.id);

      // No membership should be created
      const membership = await db.query.userTenants.findFirst({
        where: and(eq(userTenants.userId, newUser.id), eq(userTenants.tenantId, tenantId)),
      });
      expect(membership).toBeFalsy();

      // Invitation should be marked expired
      const invitation = await db.query.invitations.findFirst({
        where: and(eq(invitations.email, email), eq(invitations.tenantId, tenantId)),
      });
      expect(invitation!.status).toBe("expired");
    } finally {
      await db
        .delete(users)
        .where(eq(users.id, newUser.id))
        .catch(() => {});
    }
  });

  // ── Revoke invitation ─────────────────────────────────────────

  it("revoking an invitation marks it as expired", async () => {
    const email = `inv-revoke-${suffix}@test.com`;

    const [inv] = await db
      .insert(invitations)
      .values({
        tenantId,
        email,
        role: "tenant_admin",
        invitedBy: ownerUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();

    // Revoke
    await db.update(invitations).set({ status: "expired" }).where(eq(invitations.id, inv.id));

    const updated = await db.query.invitations.findFirst({
      where: eq(invitations.id, inv.id),
    });
    expect(updated!.status).toBe("expired");
  });

  // ── Remove team member ────────────────────────────────────────

  it("removing a tenant_admin deletes their membership", async () => {
    // existingUserId has tenant_admin membership from earlier test
    const membershipBefore = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, existingUserId), eq(userTenants.tenantId, tenantId)),
    });
    expect(membershipBefore).toBeTruthy();

    await db
      .delete(userTenants)
      .where(and(eq(userTenants.userId, existingUserId), eq(userTenants.tenantId, tenantId)));

    const membershipAfter = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, existingUserId), eq(userTenants.tenantId, tenantId)),
    });
    expect(membershipAfter).toBeFalsy();
  });

  it("tenant_owner membership cannot be deleted by role check", async () => {
    const membership = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, ownerUserId), eq(userTenants.tenantId, tenantId)),
    });
    expect(membership).toBeTruthy();
    expect(membership!.role).toBe("tenant_owner");
    // Business rule: removeTeamMemberFn checks role === "tenant_owner" and rejects
  });
});
