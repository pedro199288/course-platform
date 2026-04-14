import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getInstructorDashboardFn } from "#/lib/instructor-dashboard-actions.ts";
import { getSubscriptionPriceFn, setSubscriptionPriceFn } from "#/lib/checkout-actions.ts";

export const Route = createFileRoute("/admin/")({
  loader: async () => {
    const [metrics, subscriptionPricing] = await Promise.all([
      getInstructorDashboardFn(),
      getSubscriptionPriceFn(),
    ]);
    return { ...metrics, subscriptionPricing };
  },
  component: AdminDashboard,
});

function AdminDashboard() {
  const { user } = Route.useRouteContext();
  const { subscriptionPricing, ...metrics } = Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Welcome back, {user.name}
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/admin/courses" className="block">
          <DashboardCard
            title="Total Courses"
            value={String(metrics.totalCourses)}
            description={`${metrics.publishedCourses} published, ${metrics.draftCourses} draft`}
          />
        </Link>
        <DashboardCard
          title="Students"
          value={String(metrics.totalStudents)}
          description={
            metrics.totalStudents === 1
              ? "1 enrolled student"
              : `${metrics.totalStudents} enrolled students`
          }
        />
        <DashboardCard
          title="Revenue"
          value={formatCurrency(metrics.totalRevenue)}
          description="Total earnings"
        />
        <DashboardCard
          title="Published"
          value={String(metrics.publishedCourses)}
          description={
            metrics.publishedCourses === 1
              ? "1 live course"
              : `${metrics.publishedCourses} live courses`
          }
        />
      </div>

      {/* Per-Course Stats */}
      {metrics.perCourseStats.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">Course Performance</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                  <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                    Course
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                    Students
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.perCourseStats.map((course) => (
                  <tr
                    key={course.courseId}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                  >
                    <td className="px-4 py-3 font-medium">{course.courseTitle}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          course.status === "published"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                        }`}
                      >
                        {course.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{course.enrolledStudents}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(course.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Enrollments */}
      {metrics.recentEnrollments.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">Recent Enrollments</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                  <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                    Student
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                    Course
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.recentEnrollments.map((enrollment) => (
                  <tr
                    key={enrollment.id}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{enrollment.userName ?? "Unknown"}</div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">
                        {enrollment.userEmail}
                      </div>
                    </td>
                    <td className="px-4 py-3">{enrollment.courseTitle}</td>
                    <td className="px-4 py-3 text-right text-neutral-500 dark:text-neutral-400">
                      {new Date(enrollment.enrolledAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-3">
        {metrics.totalCourses > 0 && (
          <Link
            to="/admin/analytics"
            className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
          >
            View Engagement Analytics
          </Link>
        )}
        <Link
          to="/admin/testimonials"
          className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
        >
          Manage Testimonials
        </Link>
        <Link
          to="/admin/settings"
          className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
        >
          School Settings
        </Link>
      </div>

      {/* Subscription Pricing */}
      <SubscriptionPricing currentPrice={subscriptionPricing.subscriptionPrice} />

      {/* Empty state */}
      {metrics.totalCourses === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400">
            No courses yet.{" "}
            <Link
              to="/admin/courses/new"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Create your first course
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

function SubscriptionPricing({ currentPrice }: { currentPrice: string | null }) {
  const router = useRouter();
  const [price, setPrice] = useState(currentPrice ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await setSubscriptionPriceFn({
        data: { price: price.trim() || null },
      });
      setSaved(true);
      void router.invalidate();
    } catch {
      alert("Failed to save subscription price");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Subscription Pricing</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Set a monthly price for students to access all your courses. Leave empty to disable
        subscriptions.
      </p>
      <form onSubmit={(e) => void handleSave(e)} className="mt-3 flex items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="subscriptionPrice" className="block text-sm font-medium">
            Monthly price (USD)
          </label>
          <div className="flex items-center">
            <span className="mr-1 text-sm text-neutral-500">$</span>
            <input
              id="subscriptionPrice"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="w-32 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
      </form>
    </div>
  );
}

function DashboardCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{title}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{description}</p>
    </div>
  );
}

function formatCurrency(amount: string): string {
  const num = parseFloat(amount);
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
