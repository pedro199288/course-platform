import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createPlanFn } from "#/lib/plans.ts";

export const Route = createFileRoute("/platform-admin/plans/new")({
  component: NewPlanPage,
});

function NewPlanPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [maxCourses, setMaxCourses] = useState("");
  const [maxStudents, setMaxStudents] = useState("");
  const [fee, setFee] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createPlanFn({
        data: {
          name,
          maxCourses: maxCourses === "" ? null : Number(maxCourses),
          maxStudents: maxStudents === "" ? null : Number(maxStudents),
          applicationFeePercent: fee === "" ? null : fee,
        },
      });
      navigate({ to: "/platform-admin/plans" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
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
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New Plan</h1>
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

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create plan"}
          </button>
          <Link
            to="/platform-admin/plans"
            className="text-sm text-neutral-600 hover:underline dark:text-neutral-400"
          >
            Cancel
          </Link>
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
