import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getPlanByIdFn, updatePlanFn } from "#/lib/plans.ts";

export const Route = createFileRoute("/platform-admin/plans/$planId")({
  loader: ({ params }) => getPlanByIdFn({ data: { planId: params.planId } }),
  component: EditPlanPage,
});

function EditPlanPage() {
  const plan = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [name, setName] = useState(plan.name);
  const [maxCourses, setMaxCourses] = useState(
    plan.maxCourses === null ? "" : String(plan.maxCourses),
  );
  const [maxStudents, setMaxStudents] = useState(
    plan.maxStudents === null ? "" : String(plan.maxStudents),
  );
  const [fee, setFee] = useState(plan.applicationFeePercent ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      await updatePlanFn({
        data: {
          planId: plan.id,
          name,
          maxCourses: maxCourses === "" ? null : Number(maxCourses),
          maxStudents: maxStudents === "" ? null : Number(maxStudents),
          applicationFeePercent: fee === "" ? null : fee,
        },
      });
      setMessage("Plan updated successfully.");
      void router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/platform-admin/plans"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          &larr; Back to plans
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Edit Plan: {plan.name}</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="max-w-xl space-y-4 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <Field label="Name" htmlFor="plan-name">
          <input
            id="plan-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
        </Field>

        <Field label="Max courses (blank = unlimited)" htmlFor="plan-max-courses">
          <input
            id="plan-max-courses"
            type="number"
            min="0"
            value={maxCourses}
            onChange={(e) => setMaxCourses(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
        </Field>

        <Field label="Max students (blank = unlimited)" htmlFor="plan-max-students">
          <input
            id="plan-max-students"
            type="number"
            min="0"
            value={maxStudents}
            onChange={(e) => setMaxStudents(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
        </Field>

        <Field label="Application fee % (blank = none)" htmlFor="plan-fee">
          <input
            id="plan-fee"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
        </Field>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {message && <p className="text-sm text-green-600 dark:text-green-400">{message}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: "/platform-admin/plans" })}
            className="text-sm text-neutral-600 hover:underline dark:text-neutral-400"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
