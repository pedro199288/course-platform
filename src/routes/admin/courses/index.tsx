import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { listCoursesFn, deleteCourseFn, updateCourseFn } from "#/lib/course-actions.ts";

export const Route = createFileRoute("/admin/courses/")({
  loader: () => listCoursesFn(),
  component: CoursesListPage,
});

function CoursesListPage() {
  const courses = Route.useLoaderData();
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(courseId: string) {
    if (!confirm("Delete this course? This will also delete all its modules and lessons.")) return;
    setDeleting(courseId);
    try {
      await deleteCourseFn({ data: { courseId } });
      void router.invalidate();
    } catch {
      alert("Failed to delete course");
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggleStatus(courseId: string, currentStatus: string) {
    const newStatus = currentStatus === "draft" ? "published" : "draft";
    try {
      await updateCourseFn({ data: { courseId, status: newStatus as "draft" | "published" } });
      void router.invalidate();
    } catch {
      alert("Failed to update status");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Courses</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Manage your courses, modules, and lessons
          </p>
        </div>
        <Link
          to="/admin/courses/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Create course
        </Link>
      </div>

      {courses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No courses yet. Create your first course to get started.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {courses.map((course) => (
            <div key={course.id} className="flex items-center justify-between p-4">
              <div className="min-w-0 flex-1">
                <Link
                  to="/admin/courses/$courseId"
                  params={{ courseId: course.id }}
                  className="font-medium hover:underline"
                >
                  {course.title}
                </Link>
                <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>/{course.slug}</span>
                  {course.price && <span>${course.price}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggleStatus(course.id, course.status)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    course.status === "published"
                      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}
                >
                  {course.status}
                </button>
                <Link
                  to="/admin/courses/$courseId"
                  params={{ courseId: course.id }}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  disabled={deleting === course.id}
                  onClick={() => void handleDelete(course.id)}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                >
                  {deleting === course.id ? "..." : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
