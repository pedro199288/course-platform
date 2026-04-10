import { createFileRoute, Link } from "@tanstack/react-router";
import { listTenantsFn } from "#/lib/platform-admin.ts";

export const Route = createFileRoute("/platform-admin/")({
  loader: () => listTenantsFn(),
  component: TenantListPage,
});

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  suspended: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  inactive: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function TenantListPage() {
  const tenants = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tenant Management</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          View and manage all tenants on the platform.
        </p>
      </div>

      {tenants.length === 0 ? (
        <p className="text-neutral-500 dark:text-neutral-400">No tenants found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Subdomain</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium text-right">Students</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="bg-white dark:bg-neutral-950">
                  <td className="px-4 py-3">
                    <Link
                      to="/platform-admin/tenants/$tenantId"
                      params={{ tenantId: tenant.id }}
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {tenant.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {tenant.subdomain}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[tenant.status] ?? ""}`}
                    >
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {tenant.planName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{tenant.studentCount}</td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {new Date(tenant.createdAt).toLocaleDateString()}
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
