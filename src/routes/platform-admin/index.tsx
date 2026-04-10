import { createFileRoute } from "@tanstack/react-router";
import { getPlatformMetricsFn } from "#/lib/platform-admin.ts";

export const Route = createFileRoute("/platform-admin/")({
  loader: () => getPlatformMetricsFn(),
  component: DashboardPage,
});

function formatCurrency(amount: string): string {
  const num = Number(amount);
  if (Number.isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

function DashboardPage() {
  const metrics = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Aggregate metrics across every school on the platform.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total tenants" value={metrics.tenantCount.toString()} />
        <MetricCard label="Total students" value={metrics.studentCount.toString()} />
        <MetricCard label="Total courses" value={metrics.courseCount.toString()} />
        <MetricCard label="Total revenue" value={formatCurrency(metrics.totalRevenue)} />
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">Tenants by status</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <StatusRow label="Active" value={metrics.tenantsByStatus.active} tone="green" />
          <StatusRow label="Suspended" value={metrics.tenantsByStatus.suspended} tone="yellow" />
          <StatusRow label="Inactive" value={metrics.tenantsByStatus.inactive} tone="red" />
        </dl>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

const TONE_STYLES = {
  green: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
} as const;

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: keyof typeof TONE_STYLES;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-neutral-100 px-4 py-3 dark:border-neutral-800">
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE_STYLES[tone]}`}
      >
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
