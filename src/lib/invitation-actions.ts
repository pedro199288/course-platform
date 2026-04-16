import "@tanstack/react-start/server-only";
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { invitations, users, userTenants, tenants } from "#/db/schema/index.ts";
import { requireMembership } from "./authorization.ts";
import { sendEmail } from "./email.ts";
import { renderAdminInvitation } from "./email-templates/admin-invitation.tsx";

const INVITATION_EXPIRY_DAYS = 7;

/**
 * Invite a user as tenant_admin. Only tenant_owner can invite.
 * If the user already exists, creates the membership immediately.
 * If not, stores a pending invitation to be claimed on registration.
 */
export const inviteTenantAdminFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const { userId, tenantId } = await requireMembership("tenant_owner");

    const email = data.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Invalid email address");
    }

    // Check for existing membership
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true, name: true },
    });

    if (existingUser) {
      const existingMembership = await db.query.userTenants.findFirst({
        where: and(eq(userTenants.userId, existingUser.id), eq(userTenants.tenantId, tenantId)),
      });
      if (existingMembership) {
        throw new Error("This user is already a member of this school");
      }
    }

    // Check for existing pending invitation
    const existingInvitation = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.email, email),
        eq(invitations.tenantId, tenantId),
        eq(invitations.status, "pending"),
      ),
    });
    if (existingInvitation) {
      throw new Error("An invitation has already been sent to this email");
    }

    // Get tenant + inviter info for the email
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { name: true, subdomain: true },
    });
    const inviter = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { name: true },
    });

    if (existingUser) {
      // User exists — create membership immediately
      await db.insert(userTenants).values({
        userId: existingUser.id,
        tenantId,
        role: "tenant_admin",
      });

      // Mark as accepted invitation record for audit trail
      await db.insert(invitations).values({
        tenantId,
        email,
        role: "tenant_admin",
        invitedBy: userId,
        status: "accepted",
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      });

      return { status: "membership_created" as const };
    }

    // User doesn't exist — create pending invitation
    const [invitation] = await db
      .insert(invitations)
      .values({
        tenantId,
        email,
        role: "tenant_admin",
        invitedBy: userId,
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      })
      .returning();

    // Send invitation email
    const schoolName = tenant?.name ?? "the school";
    const inviterName = inviter?.name ?? "A school owner";
    // Link to the school's subdomain so they register in the right context
    const acceptUrl = tenant?.subdomain
      ? `http://${tenant.subdomain}.localhost:4500/register?invitation=${invitation.id}`
      : `http://localhost:4500/register?invitation=${invitation.id}`;

    try {
      const html = await renderAdminInvitation({ schoolName, inviterName, acceptUrl });
      await sendEmail({
        to: email,
        subject: `You're invited to manage ${schoolName}`,
        html,
      });
    } catch {
      // Email failure shouldn't roll back the invitation
    }

    return { status: "invitation_sent" as const };
  });

/**
 * List current team members and pending invitations for the tenant.
 */
export const listTeamMembersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { tenantId } = await requireMembership("tenant_owner");

  const members = await db
    .select({
      userId: userTenants.userId,
      role: userTenants.role,
      createdAt: userTenants.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(userTenants)
    .innerJoin(users, eq(users.id, userTenants.userId))
    .where(eq(userTenants.tenantId, tenantId));

  const pendingInvitations = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.status, "pending")));

  return { members, pendingInvitations };
});

/**
 * Revoke a pending invitation. Only tenant_owner can revoke.
 */
export const revokeInvitationFn = createServerFn({ method: "POST" })
  .inputValidator((d: { invitationId: string }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_owner");

    const invitation = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.id, data.invitationId),
        eq(invitations.tenantId, tenantId),
        eq(invitations.status, "pending"),
      ),
    });

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    await db
      .update(invitations)
      .set({ status: "expired" })
      .where(eq(invitations.id, data.invitationId));

    return { ok: true };
  });

/**
 * Remove a team member (tenant_admin or student). Only tenant_owner can remove.
 * Cannot remove the tenant_owner themselves.
 */
export const removeTeamMemberFn = createServerFn({ method: "POST" })
  .inputValidator((d: { memberUserId: string }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_owner");

    const membership = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, data.memberUserId), eq(userTenants.tenantId, tenantId)),
    });

    if (!membership) {
      throw new Error("Member not found");
    }

    if (membership.role === "tenant_owner") {
      throw new Error("Cannot remove the school owner");
    }

    await db
      .delete(userTenants)
      .where(and(eq(userTenants.userId, data.memberUserId), eq(userTenants.tenantId, tenantId)));

    return { ok: true };
  });

/**
 * Claim all pending invitations for a user (called after registration).
 * Creates user_tenants memberships for each valid pending invitation.
 */
export async function claimPendingInvitations(userEmail: string, userId: string) {
  const pending = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.email, userEmail.toLowerCase()), eq(invitations.status, "pending")));

  for (const invitation of pending) {
    if (invitation.expiresAt < new Date()) {
      // Mark expired
      await db
        .update(invitations)
        .set({ status: "expired" })
        .where(eq(invitations.id, invitation.id));
      continue;
    }

    // Check if membership already exists (shouldn't, but be safe)
    const existing = await db.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, userId), eq(userTenants.tenantId, invitation.tenantId)),
    });

    if (!existing) {
      await db.insert(userTenants).values({
        userId,
        tenantId: invitation.tenantId,
        role: invitation.role,
      });
    }

    await db
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));
  }
}
