import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionFn } from "#/lib/auth-session.ts";
import type { User } from "#/lib/auth.ts";

export const Route = createFileRoute("/platform-admin")({
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) {
      throw redirect({ to: "/login" });
    }

    const user = session.user as User;
    if (user.role !== "platform_admin") {
      throw redirect({ to: "/" });
    }

    return { user, session: session.session };
  },
  component: PlatformAdminLayout,
});

function PlatformAdminLayout() {
  return (
    <main className="page-wrap py-8">
      <nav className="mb-6 flex flex-wrap gap-4 border-b border-neutral-200 pb-4 text-sm dark:border-neutral-800">
        <Link
          to="/platform-admin"
          activeOptions={{ exact: true }}
          activeProps={{ className: "font-semibold text-blue-600 dark:text-blue-400" }}
          className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Dashboard
        </Link>
        <Link
          to="/platform-admin/tenants"
          activeProps={{ className: "font-semibold text-blue-600 dark:text-blue-400" }}
          className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Tenants
        </Link>
        <Link
          to="/platform-admin/plans"
          activeProps={{ className: "font-semibold text-blue-600 dark:text-blue-400" }}
          className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Plans
        </Link>
      </nav>
      <Outlet />
    </main>
  );
}
