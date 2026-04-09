import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { asc, eq } from "drizzle-orm";
import { useState } from "react";
import { db } from "#/db/index.ts";
import { courses } from "#/db/schema/index.ts";
import { auth } from "#/lib/auth.ts";
import { createCourseFn, deleteCourseFn, updateCourseFn } from "#/lib/courses.ts";

const loadCoursesFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return [];

  const user = session.user as { tenantId: string };
  return db.query.courses.findMany({
    where: eq(courses.tenantId, user.tenantId),
    orderBy: [asc(courses.createdAt)],
  });
});

export const Route = createFileRoute("/admin/courses/")({
  loader: () => loadCoursesFn(),
  component: CoursesPage,
});

function CoursesPage() {
  const initialCourses = Route.useLoaderData();
  const [courseList, setCourseList] = useState(initialCourses);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const course = await createCourseFn({
        data: { title, description: description || undefined },
      });
      setCourseList((prev) => [...prev, course]);
      setTitle("");
      setDescription("");
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(courseId: string) {
    if (!confirm("Delete this course and all its modules and lessons?")) return;
    await deleteCourseFn({ data: { courseId } });
    setCourseList((prev) => prev.filter((c) => c.id !== courseId));
  }

  async function handleToggleStatus(courseId: string, current: string) {
    const newStatus = current === "draft" ? "published" : "draft";
    const updated = await updateCourseFn({
      data: { courseId, status: newStatus as "draft" | "published" },
    });
    setCourseList((prev) => prev.map((c) => (c.id === courseId ? updated : c)));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Courses</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Manage your courses, modules, and lessons.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {showForm ? "Cancel" : "New Course"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 space-y-3"
        >
          <div>
            <label htmlFor="title" className="block text-sm font-medium">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              placeholder="My Awesome Course"
            />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              placeholder="What is this course about?"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {creating ? "Creating…" : "Create Course"}
          </button>
        </form>
      )}

      {courseList.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No courses yet. Create your first course to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {courseList.map((course) => (
            <div
              key={course.id}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    to="/admin/courses/$courseId"
                    params={{ courseId: course.id }}
                    className="font-medium hover:underline"
                  >
                    {course.title}
                  </Link>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      course.status === "published"
                        ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                    }`}
                  >
                    {course.status}
                  </span>
                </div>
                {course.description && (
                  <p className="mt-1 truncate text-sm text-neutral-500 dark:text-neutral-400">
                    {course.description}
                  </p>
                )}
              </div>
              <div className="ml-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleStatus(course.id, course.status)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {course.status === "draft" ? "Publish" : "Unpublish"}
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
                  onClick={() => handleDelete(course.id)}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
