import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { deletePlanFn, listPlansFn } from "#/lib/plans.ts";

export const Route = createFileRoute("/platform-admin/plans/")({
  loader: () => listPlansFn(),
  component: PlanListPage,
});

function PlanListPage() {
  const plans = Route.useLoaderData();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(planId: string) {
    setDeletingId(planId);
    setMessage(null);
    const result = await deletePlanFn({ data: { planId } });
    setDeletingId(null);
    if (result.error) {
      setMessage(result.error);
    } else {
      void router.invalidate();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plan Tiers</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Configure plan tiers with feature caps and application fee percentages.
          </p>
        </div>
        <Link
          to="/platform-admin/plans/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New plan
        </Link>
      </div>

      {message && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {message}
        </div>
      )}

      {plans.length === 0 ? (
        <p className="text-neutral-500 dark:text-neutral-400">
          No plans configured yet. Create one to start enforcing limits.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium text-right">Max courses</th>
                <th className="px-4 py-3 font-medium text-right">Max students</th>
                <th className="px-4 py-3 font-medium text-right">Fee %</th>
                <th className="px-4 py-3 font-medium text-right">Tenants</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {plans.map((plan) => (
                <tr key={plan.id} className="bg-white dark:bg-neutral-950">
                  <td className="px-4 py-3">
                    <Link
                      to="/platform-admin/plans/$planId"
                      params={{ planId: plan.id }}
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {plan.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{plan.maxCourses ?? "∞"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{plan.maxStudents ?? "∞"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {plan.applicationFeePercent ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{plan.tenantCount}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleDelete(plan.id)}
                      disabled={deletingId === plan.id || plan.tenantCount > 0}
                      title={
                        plan.tenantCount > 0 ? "Reassign tenants before deleting" : "Delete plan"
                      }
                      className="text-sm text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                    >
                      {deletingId === plan.id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
