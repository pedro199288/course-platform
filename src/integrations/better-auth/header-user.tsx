import { authClient } from "#/lib/auth-client";
import { Link } from "@tanstack/react-router";

export default function BetterAuthHeader() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <span className="text-sm text-neutral-500">…</span>;
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-neutral-700">{session.user.name || session.user.email}</span>
        <button
          type="button"
          onClick={() => {
            void authClient.signOut();
          }}
          className="rounded border border-neutral-300 bg-white px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <Link
      to="/login"
      className="rounded border border-neutral-300 bg-white px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
    >
      Sign in
    </Link>
  );
}
