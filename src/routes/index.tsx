import { createFileRoute, Link } from "@tanstack/react-router";
import { authClient } from "#/lib/auth-client.ts";

export const Route = createFileRoute("/")({ component: Home });

const ADMIN_ROLES = new Set(["platform_admin", "tenant_owner", "tenant_admin"]);

const sectionClass = "rounded border border-neutral-200 bg-white p-4";
const headingClass = "mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500";
const listClass = "flex flex-col gap-1 text-sm";
const linkClass = "text-blue-600 hover:underline";

function Home() {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user as { email?: string; name?: string; role?: string } | undefined;
  const role = user?.role;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900">Course Platform</h1>

      <section className={sectionClass}>
        <h2 className={headingClass}>Public</h2>
        <ul className={listClass}>
          <li>
            <Link to="/courses" className={linkClass}>
              Browse courses
            </Link>
          </li>
        </ul>
      </section>

      {isPending ? (
        <p className="text-sm text-neutral-500">Loading session…</p>
      ) : user ? (
        <section className={sectionClass}>
          <h2 className={headingClass}>Signed in as {user.email ?? user.name ?? "user"}</h2>
          <ul className={listClass}>
            <li>
              <Link to="/my-courses" className={linkClass}>
                My courses (all schools)
              </Link>
            </li>
            <li>
              <Link to="/dashboard" className={linkClass}>
                Student dashboard
              </Link>
            </li>
            <li>
              <Link to="/create-school" className={linkClass}>
                Create a school
              </Link>
            </li>
            {role && ADMIN_ROLES.has(role) ? (
              <li>
                <Link to="/admin" className={linkClass}>
                  Admin panel
                </Link>
              </li>
            ) : null}
            {role === "platform_admin" ? (
              <li>
                <Link to="/platform-admin" className={linkClass}>
                  Platform admin
                </Link>
              </li>
            ) : null}
          </ul>
          <button
            type="button"
            onClick={() => {
              void authClient.signOut();
            }}
            className="mt-3 rounded border border-neutral-300 bg-white px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Sign out
          </button>
        </section>
      ) : (
        <section className={sectionClass}>
          <h2 className={headingClass}>Not signed in</h2>
          <ul className={listClass}>
            <li>
              <Link to="/login" className={linkClass}>
                Log in
              </Link>
            </li>
            <li>
              <Link to="/register" className={linkClass}>
                Register
              </Link>
            </li>
          </ul>
        </section>
      )}
    </main>
  );
}
