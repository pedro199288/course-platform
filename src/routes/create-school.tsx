import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSessionFn } from "#/lib/auth-session.ts";
import { checkSubdomainFn, createSchoolFn } from "#/lib/school.ts";

export const Route = createFileRoute("/create-school")({
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) {
      throw redirect({ to: "/login" });
    }
    return { user: session.user };
  },
  component: CreateSchoolPage,
});

function CreateSchoolPage() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [subdomainStatus, setSubdomainStatus] = useState<{
    available: boolean;
    reason: string | null;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const checkSubdomain = useCallback(async (value: string) => {
    if (value.length < 3) {
      setSubdomainStatus(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const result = await checkSubdomainFn({ data: { subdomain: value } });
      setSubdomainStatus(result);
    } catch {
      setSubdomainStatus(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!subdomain) {
      setSubdomainStatus(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void checkSubdomain(subdomain);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subdomain, checkSubdomain]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await createSchoolFn({ data: { name, subdomain } });

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    void navigate({ to: "/admin/onboarding" });
  }

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create your school</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Set up your online school and start teaching
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="school-name" className="block text-sm font-medium">
              School name
            </label>
            <input
              id="school-name"
              type="text"
              required
              minLength={2}
              maxLength={100}
              placeholder="My Awesome School"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="subdomain" className="block text-sm font-medium">
              Subdomain
            </label>
            <div className="flex items-center gap-0">
              <input
                id="subdomain"
                type="text"
                required
                minLength={3}
                maxLength={63}
                pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                placeholder="my-school"
                value={subdomain}
                onChange={(e) =>
                  setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
                className="w-full rounded-l-md border border-r-0 border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <span className="rounded-r-md border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                .localhost
              </span>
            </div>
            {checking && <p className="text-xs text-neutral-500">Checking availability...</p>}
            {!checking && subdomainStatus && (
              <p
                className={`text-xs ${subdomainStatus.available ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
              >
                {subdomainStatus.available ? "Available!" : subdomainStatus.reason}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={
              loading || checking || (subdomainStatus !== null && !subdomainStatus.available)
            }
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {loading ? "Creating school..." : "Create school"}
          </button>
        </form>
      </div>
    </main>
  );
}
