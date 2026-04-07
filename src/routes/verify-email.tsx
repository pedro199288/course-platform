import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client.ts";

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    setResending(true);
    setError(null);
    setResent(false);

    const result = await authClient.sendVerificationEmail({
      email: "", // Better Auth uses the current session's email
      callbackURL: "/",
    });

    if (result.error) {
      setError(result.error.message ?? "Failed to resend verification email");
    } else {
      setResent(true);
    }
    setResending(false);
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Check your inbox
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            We sent a verification link to your email address. Click the link to
            activate your account.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {resent && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            Verification email resent. Check your inbox.
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={resending}
          className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {resending ? "Resending..." : "Resend verification email"}
        </button>

        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Already verified?{" "}
          <Link
            to="/login"
            className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
