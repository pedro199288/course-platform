import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client.ts";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || "",
  }),
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    const result = await authClient.resetPassword({
      newPassword: password,
      token,
    });

    if (result.error) {
      setError(result.error.message ?? "Failed to reset password");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    // Redirect to login after a short delay
    setTimeout(() => {
      void navigate({ to: "/login" });
    }, 2000);
  }

  if (!token) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Invalid reset link</h1>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              This password reset link is invalid or has expired. Please request a new one.
            </p>
          </div>
          <Link
            to="/forgot-password"
            className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Request new reset link
          </Link>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Password reset successful</h1>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              Your password has been updated. Redirecting to sign in...
            </p>
          </div>
          <Link
            to="/login"
            className="inline-block font-medium text-neutral-900 hover:underline dark:text-neutral-100"
          >
            Sign in now
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Set new password</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Enter your new password below
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmPassword" className="block text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {loading ? "Resetting..." : "Reset password"}
          </button>
        </form>
      </div>
    </main>
  );
}
