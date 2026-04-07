import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionFn } from "#/lib/auth-session.ts";
import type { User } from "#/lib/auth.ts";

const ADMIN_ROLES: string[] = ["platform_admin", "tenant_owner", "tenant_admin"];

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) {
      throw redirect({ to: "/login" });
    }

    const user = session.user as User;
    if (!user.role || !ADMIN_ROLES.includes(user.role)) {
      throw redirect({ to: "/" });
    }

    return { user, session: session.session };
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <main className="page-wrap py-8">
      <Outlet />
    </main>
  );
}
