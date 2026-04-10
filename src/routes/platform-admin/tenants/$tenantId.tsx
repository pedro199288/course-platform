import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  getTenantDetailFn,
  updateTenantPlanFn,
  updateTenantStatusFn,
} from "#/lib/platform-admin.ts";
import { listPlansFn } from "#/lib/plans.ts";

export const Route = createFileRoute("/platform-admin/tenants/$tenantId")({
  loader: async ({ params }) => {
    const [tenant, plans] = await Promise.all([
      getTenantDetailFn({ data: { tenantId: params.tenantId } }),
      listPlansFn(),
    ]);
    return { tenant, plans };
  },
  component: TenantDetailPage,
});

const STATUS_OPTIONS = ["active", "suspended", "inactive"] as const;

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  suspended: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  inactive: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function TenantDetailPage() {
  const { tenant, plans } = Route.useLoaderData();
  const router = useRouter();
  const [status, setStatus] = useState(tenant.status);
  const [planId, setPlanId] = useState<string | "">(tenant.planId ?? "");
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const statusChanged = status !== tenant.status;
  const planChanged = (tenant.planId ?? "") !== planId;

  async function handleSaveStatus() {
    setSavingStatus(true);
    setMessage(null);
    const result = await updateTenantStatusFn({
      data: { tenantId: tenant.id, status },
    });
    setSavingStatus(false);

    if (result.error) {
      setMessage(result.error);
    } else {
      setMessage("Status updated successfully.");
      void router.invalidate();
    }
  }

  async function handleSavePlan() {
    setSavingPlan(true);
    setMessage(null);
    const result = await updateTenantPlanFn({
      data: { tenantId: tenant.id, planId: planId === "" ? null : planId },
    });
    setSavingPlan(false);

    if (result.error) {
      setMessage(result.error);
    } else {
      setMessage("Plan updated successfully.");
      void router.invalidate();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/platform-admin/tenants"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          &larr; Back to tenants
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{tenant.name}</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{tenant.subdomain}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Status">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[tenant.status] ?? ""}`}
          >
            {tenant.status}
          </span>
        </InfoCard>
        <InfoCard label="Plan">{tenant.plan?.name ?? "None"}</InfoCard>
        <InfoCard label="Users">{tenant.userCount}</InfoCard>
        <InfoCard label="Created">{new Date(tenant.createdAt).toLocaleDateString()}</InfoCard>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <InfoCard label="Stripe Connect">
          {tenant.stripeConnectAccountId ?? "Not connected"}
        </InfoCard>
        <InfoCard label="Stripe Onboarding">
          {tenant.stripeOnboardingComplete === "true" ? "Complete" : "Incomplete"}
        </InfoCard>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">Modify Status</h2>
        <div className="mt-4 flex items-end gap-4">
          <div>
            <label
              htmlFor="status-select"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Status
            </label>
            <select
              id="status-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="mt-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleSaveStatus}
            disabled={!statusChanged || savingStatus}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingStatus ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">Modify Plan</h2>
        <div className="mt-4 flex items-end gap-4">
          <div>
            <label
              htmlFor="plan-select"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Plan
            </label>
            <select
              id="plan-select"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="mt-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            >
              <option value="">No plan (unlimited)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleSavePlan}
            disabled={!planChanged || savingPlan}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingPlan ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {message && <p className="text-sm text-neutral-600 dark:text-neutral-400">{message}</p>}
    </div>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
      <div className="mt-1 text-sm font-semibold">{children}</div>
    </div>
  );
}
