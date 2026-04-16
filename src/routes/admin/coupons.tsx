import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  listCouponsFn,
  createCouponFn,
  deactivateCouponFn,
  activateCouponFn,
} from "#/lib/coupon-actions.ts";
import { listCoursesFn } from "#/lib/course-actions.ts";

export const Route = createFileRoute("/admin/coupons")({
  loader: async () => {
    const [coupons, courses] = await Promise.all([listCouponsFn(), listCoursesFn()]);
    return { coupons, courses };
  },
  component: CouponsPage,
});

function CouponsPage() {
  const { coupons, courses } = Route.useLoaderData();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  async function handleToggle(promoId: string, currentlyActive: boolean) {
    try {
      if (currentlyActive) {
        await deactivateCouponFn({ data: { promotionCodeId: promoId } });
      } else {
        await activateCouponFn({ data: { promotionCodeId: promoId } });
      }
      void router.invalidate();
    } catch (err: any) {
      alert(err.message ?? "Failed to update coupon");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Coupons</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Create discount codes for your courses
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {showForm ? "Cancel" : "Create coupon"}
        </button>
      </div>

      {showForm && (
        <CouponForm
          courses={courses}
          onDone={() => {
            setShowForm(false);
            void router.invalidate();
          }}
        />
      )}

      {coupons.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400">
            No coupons yet. Create one to offer discounts to your students.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                  Code
                </th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                  Discount
                </th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                  Usage
                </th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                  Expires
                </th>
                <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => {
                const courseName = c.courseId
                  ? courses.find((course) => course.id === c.courseId)?.title
                  : null;
                return (
                  <tr
                    key={c.id}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono font-medium">{c.code}</span>
                      {courseName && (
                        <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                          {courseName}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.type === "percent"
                        ? `${c.value}% off`
                        : `$${(c.value / 100).toFixed(2)} off`}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.timesRedeemed}
                      {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.active
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                        }`}
                      >
                        {c.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleToggle(c.id, c.active)}
                        className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
                      >
                        {c.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CouponForm({
  courses,
  onDone,
}: {
  courses: Array<{ id: string; title: string }>;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [courseId, setCourseId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !value) return;
    setSaving(true);
    setError(null);
    try {
      const numValue = type === "percent" ? parseFloat(value) : Math.round(parseFloat(value) * 100); // Convert dollars to cents for fixed
      await createCouponFn({
        data: {
          code: code.trim(),
          type,
          value: numValue,
          maxRedemptions: maxRedemptions ? parseInt(maxRedemptions, 10) : null,
          expiresAt: expiresAt || null,
          courseId: courseId || null,
        },
      });
      onDone();
    } catch (err: any) {
      setError(err.message ?? "Failed to create coupon");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="couponCode" className="block text-sm font-medium">
            Coupon code
          </label>
          <input
            id="couponCode"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            placeholder="SUMMER20"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm uppercase outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="discountType" className="block text-sm font-medium">
            Discount type
          </label>
          <select
            id="discountType"
            value={type}
            onChange={(e) => setType(e.target.value as "percent" | "fixed")}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="percent">Percentage off</option>
            <option value="fixed">Fixed amount off</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="discountValue" className="block text-sm font-medium">
            {type === "percent" ? "Percentage (1-100)" : "Amount (USD)"}
          </label>
          <div className="flex items-center">
            {type === "fixed" && <span className="mr-1 text-sm text-neutral-500">$</span>}
            <input
              id="discountValue"
              type="number"
              step={type === "percent" ? "1" : "0.01"}
              min={type === "percent" ? "1" : "0.01"}
              max={type === "percent" ? "100" : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              placeholder={type === "percent" ? "20" : "10.00"}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {type === "percent" && <span className="ml-1 text-sm text-neutral-500">%</span>}
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="maxRedemptions" className="block text-sm font-medium">
            Max uses (optional)
          </label>
          <input
            id="maxRedemptions"
            type="number"
            min="1"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder="Unlimited"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="expiresAt" className="block text-sm font-medium">
            Expiration date (optional)
          </label>
          <input
            id="expiresAt"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="courseRestriction" className="block text-sm font-medium">
          Restrict to course (optional)
        </label>
        <select
          id="courseRestriction"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {saving ? "Creating..." : "Create coupon"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
