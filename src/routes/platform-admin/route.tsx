import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
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
      <Outlet />
    </main>
  );
}
