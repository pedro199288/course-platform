import "@tanstack/react-start/server-only";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { userTenants } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { tenantIdStore } from "./tenant-context.ts";

export type TenantRole = "tenant_owner" | "tenant_admin" | "student";

const ROLE_HIERARCHY: Record<TenantRole, number> = {
  tenant_owner: 3,
  tenant_admin: 2,
  student: 1,
};

/**
 * Central authorization helper that checks the user's membership and role
 * in the current tenant context.
 *
 * - Gets user from session
 * - Gets tenant from middleware context (tenantIdStore)
 * - Looks up user_tenants for membership
 * - Checks hierarchical role: tenant_owner > tenant_admin > student
 * - platform_admin bypasses all tenant membership checks
 *
 * Returns { userId, tenantId, role } on success.
 */
export async function requireMembership(minRole: TenantRole): Promise<{
  userId: string;
  tenantId: string;
  role: TenantRole | "platform_admin";
}> {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as { id: string; role?: string };
  const tenantId = tenantIdStore.getStore();
  if (!tenantId) throw new Error("No tenant context");

  // platform_admin bypasses all membership checks
  if (user.role === "platform_admin") {
    return { userId: user.id, tenantId, role: "platform_admin" };
  }

  // Look up membership in user_tenants
  const membership = await db.query.userTenants.findFirst({
    where: and(
      eq(userTenants.userId, user.id),
      eq(userTenants.tenantId, tenantId),
    ),
  });

  if (!membership) {
    throw new Error("Forbidden: no membership in this tenant");
  }

  if (ROLE_HIERARCHY[membership.role] < ROLE_HIERARCHY[minRole]) {
    throw new Error("Forbidden: insufficient role");
  }

  return { userId: user.id, tenantId, role: membership.role };
}
