import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { count, eq, sql } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, payments, tenants, users, userTenants, plans } from "#/db/schema/index.ts";
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

  // Get student counts per tenant from user_tenants
  const studentCounts = await db
    .select({
      tenantId: userTenants.tenantId,
      count: count(),
    })
    .from(userTenants)
    .where(eq(userTenants.role, "student"))
    .groupBy(userTenants.tenantId);

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
      .from(userTenants)
      .where(eq(userTenants.tenantId, tenant.id));

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

export const updateTenantPlanFn = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId: string; planId: string | null }) => input)
  .handler(async ({ data }) => {
    await requirePlatformAdmin();

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, data.tenantId),
      columns: { id: true },
    });
    if (!tenant) {
      return { error: "Tenant not found" };
    }

    if (data.planId !== null) {
      const plan = await db.query.plans.findFirst({
        where: eq(plans.id, data.planId),
        columns: { id: true },
      });
      if (!plan) {
        return { error: "Plan not found" };
      }
    }

    await db.update(tenants).set({ planId: data.planId }).where(eq(tenants.id, data.tenantId));

    return { error: null };
  });

export const getPlatformMetricsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();

  const [tenantCountRow] = await db.select({ total: count() }).from(tenants);
  const [studentCountRow] = await db
    .select({ total: count() })
    .from(users)
    .where(eq(users.role, "student"));
  const [courseCountRow] = await db.select({ total: count() }).from(courses);
  const [revenueRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
    .from(payments);

  const tenantsByStatus = await db
    .select({ status: tenants.status, total: count() })
    .from(tenants)
    .groupBy(tenants.status);

  const statusBreakdown: Record<"active" | "suspended" | "inactive", number> = {
    active: 0,
    suspended: 0,
    inactive: 0,
  };
  for (const row of tenantsByStatus) {
    statusBreakdown[row.status] = row.total;
  }

  return {
    tenantCount: tenantCountRow?.total ?? 0,
    studentCount: studentCountRow?.total ?? 0,
    courseCount: courseCountRow?.total ?? 0,
    totalRevenue: revenueRow?.total ?? "0",
    tenantsByStatus: statusBreakdown,
  };
});
