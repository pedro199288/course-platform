import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, count, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, plans, tenants, users } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";

// ── Plan shape helpers ───────────────────────────────────────────────

export type PlanInput = {
  name: string;
  maxCourses: number | null;
  maxStudents: number | null;
  applicationFeePercent: string | null;
};

function normalizePlanInput(input: {
  name: string;
  maxCourses?: number | null;
  maxStudents?: number | null;
  applicationFeePercent?: string | null;
}): PlanInput {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Plan name is required");
  }

  const maxCourses =
    input.maxCourses === null || input.maxCourses === undefined ? null : Number(input.maxCourses);
  if (maxCourses !== null && (!Number.isInteger(maxCourses) || maxCourses < 0)) {
    throw new Error("maxCourses must be a non-negative integer or null");
  }

  const maxStudents =
    input.maxStudents === null || input.maxStudents === undefined
      ? null
      : Number(input.maxStudents);
  if (maxStudents !== null && (!Number.isInteger(maxStudents) || maxStudents < 0)) {
    throw new Error("maxStudents must be a non-negative integer or null");
  }

  let applicationFeePercent: string | null = null;
  if (input.applicationFeePercent !== null && input.applicationFeePercent !== undefined) {
    const raw = String(input.applicationFeePercent).trim();
    if (raw !== "") {
      const parsed = Number(raw);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
        throw new Error("applicationFeePercent must be between 0 and 100");
      }
      applicationFeePercent = parsed.toFixed(2);
    }
  }

  return { name, maxCourses, maxStudents, applicationFeePercent };
}

// ── Access control ───────────────────────────────────────────────────

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

// ── Plan CRUD server functions ───────────────────────────────────────

export const listPlansFn = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();

  const allPlans = await db.query.plans.findMany({
    orderBy: (p, { asc }) => [asc(p.name)],
  });

  const tenantCounts = await db
    .select({ planId: tenants.planId, total: count() })
    .from(tenants)
    .groupBy(tenants.planId);

  const countMap = new Map(tenantCounts.map((c) => [c.planId ?? null, c.total]));

  return allPlans.map((plan) => ({
    ...plan,
    tenantCount: countMap.get(plan.id) ?? 0,
  }));
});

export const getPlanByIdFn = createServerFn({ method: "GET" })
  .inputValidator((input: { planId: string }) => input)
  .handler(async ({ data }) => {
    await requirePlatformAdmin();

    const plan = await db.query.plans.findFirst({
      where: eq(plans.id, data.planId),
    });

    if (!plan) {
      throw new Error("Plan not found");
    }

    return plan;
  });

export const createPlanFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      name: string;
      maxCourses?: number | null;
      maxStudents?: number | null;
      applicationFeePercent?: string | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin();

    const normalized = normalizePlanInput(data);

    const [created] = await db
      .insert(plans)
      .values({
        name: normalized.name,
        maxCourses: normalized.maxCourses,
        maxStudents: normalized.maxStudents,
        applicationFeePercent: normalized.applicationFeePercent,
      })
      .returning();

    return created;
  });

export const updatePlanFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      planId: string;
      name: string;
      maxCourses?: number | null;
      maxStudents?: number | null;
      applicationFeePercent?: string | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin();

    const existing = await db.query.plans.findFirst({
      where: eq(plans.id, data.planId),
      columns: { id: true },
    });
    if (!existing) {
      throw new Error("Plan not found");
    }

    const normalized = normalizePlanInput(data);

    const [updated] = await db
      .update(plans)
      .set({
        name: normalized.name,
        maxCourses: normalized.maxCourses,
        maxStudents: normalized.maxStudents,
        applicationFeePercent: normalized.applicationFeePercent,
      })
      .where(eq(plans.id, data.planId))
      .returning();

    return updated;
  });

export const deletePlanFn = createServerFn({ method: "POST" })
  .inputValidator((input: { planId: string }) => input)
  .handler(async ({ data }) => {
    await requirePlatformAdmin();

    const inUse = await db.query.tenants.findFirst({
      where: eq(tenants.planId, data.planId),
      columns: { id: true },
    });
    if (inUse) {
      return { error: "Plan is assigned to one or more tenants and cannot be deleted." };
    }

    await db.delete(plans).where(eq(plans.id, data.planId));
    return { error: null };
  });

// ── Enforcement helpers (pure, no auth) ──────────────────────────────

type PlanLimits = {
  maxCourses: number | null;
  maxStudents: number | null;
  applicationFeePercent: string | null;
};

async function loadTenantPlan(tenantId: string): Promise<PlanLimits | null> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { planId: true },
  });

  if (!tenant?.planId) return null;

  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, tenant.planId),
    columns: {
      maxCourses: true,
      maxStudents: true,
      applicationFeePercent: true,
    },
  });

  return plan ?? null;
}

/**
 * Throws if the tenant already has maxCourses courses for their plan.
 * Tenants without a plan are treated as unlimited.
 */
export async function assertCanCreateCourse(tenantId: string): Promise<void> {
  const plan = await loadTenantPlan(tenantId);
  if (!plan || plan.maxCourses === null) return;

  const [row] = await db
    .select({ total: count() })
    .from(courses)
    .where(eq(courses.tenantId, tenantId));
  const current = row?.total ?? 0;

  if (current >= plan.maxCourses) {
    throw new Error(
      `Plan limit reached: this school can have at most ${plan.maxCourses} course(s).`,
    );
  }
}

/**
 * Throws if the tenant already has maxStudents students for their plan.
 * Tenants without a plan are treated as unlimited.
 */
export async function assertCanAddStudent(tenantId: string): Promise<void> {
  const plan = await loadTenantPlan(tenantId);
  if (!plan || plan.maxStudents === null) return;

  const [row] = await db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "student")));
  const current = row?.total ?? 0;

  if (current >= plan.maxStudents) {
    throw new Error(
      `Plan limit reached: this school can have at most ${plan.maxStudents} student(s).`,
    );
  }
}

/**
 * Returns the application fee percent for a tenant's plan, or null if no plan
 * or no fee configured. Returned as a decimal string (e.g. "2.50").
 */
export async function getTenantApplicationFeePercent(tenantId: string): Promise<string | null> {
  const plan = await loadTenantPlan(tenantId);
  return plan?.applicationFeePercent ?? null;
}
