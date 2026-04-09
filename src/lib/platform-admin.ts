import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { count, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users, plans } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";

async function requirePlatformAdmin() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const user = session.user as { id: string; role?: string };
  if (user.role !== "platform_admin") {
    throw new Error("Forbidden");
  }

  return session;
}

export const listTenantsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();

  const allTenants = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      subdomain: tenants.subdomain,
      status: tenants.status,
      createdAt: tenants.createdAt,
      planName: plans.name,
    })
    .from(tenants)
    .leftJoin(plans, eq(tenants.planId, plans.id))
    .orderBy(tenants.createdAt);

  // Get student counts per tenant
  const studentCounts = await db
    .select({
      tenantId: users.tenantId,
      count: count(),
    })
    .from(users)
    .where(eq(users.role, "student"))
    .groupBy(users.tenantId);

  const countMap = new Map(studentCounts.map((sc) => [sc.tenantId, sc.count]));

  return allTenants.map((t) => ({
    ...t,
    studentCount: countMap.get(t.id) ?? 0,
  }));
});

export const getTenantDetailFn = createServerFn({ method: "GET" })
  .inputValidator((input: { tenantId: string }) => input)
  .handler(async ({ data }) => {
    await requirePlatformAdmin();

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, data.tenantId),
    });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    const plan = tenant.planId
      ? await db.query.plans.findFirst({ where: eq(plans.id, tenant.planId) })
      : null;

    const [studentCountResult] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.tenantId, tenant.id));

    return {
      ...tenant,
      plan,
      userCount: studentCountResult?.count ?? 0,
    };
  });

export const updateTenantStatusFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { tenantId: string; status: "active" | "suspended" | "inactive" }) => input,
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin();

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, data.tenantId),
      columns: { id: true },
    });

    if (!tenant) {
      return { error: "Tenant not found" };
    }

    await db.update(tenants).set({ status: data.status }).where(eq(tenants.id, data.tenantId));

    return { error: null };
  });
