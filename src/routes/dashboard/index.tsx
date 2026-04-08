import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getStudentDashboardFn } from "#/lib/dashboard-actions.ts";
import { getStudentCertificatesFn } from "#/lib/certificate-actions.ts";
import { getSessionFn } from "#/lib/auth-session.ts";

export const Route = createFileRoute("/dashboard/")({
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) {
      throw redirect({ to: "/login" });
    }
  },
  loader: async () => {
    const [dashboard, certMap] = await Promise.all([
      getStudentDashboardFn(),
      getStudentCertificatesFn(),
    ]);
    return { ...dashboard, certMap };
  },
  component: StudentDashboard,
});

function StudentDashboard() {
  const { courses, hasSubscription, certMap } = Route.useLoaderData();

  return (
    <main className="page-wrap px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          My Learning
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {hasSubscription
            ? "You have an active subscription — all courses are available."
            : `${courses.length} enrolled course${courses.length !== 1 ? "s" : ""}`}
        </p>

        {courses.length === 0 ? (
          <div className="mt-12 text-center">
            <p className="text-neutral-500 dark:text-neutral-400">
              You haven't enrolled in any courses yet.
            </p>
            <Link
              to="/courses"
              className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Browse courses
            </Link>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {courses.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                certificateId={certMap[course.id]?.id}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function CourseCard({
  course,
  certificateId,
}: {
  course: {
    id: string;
    title: string;
    slug: string;
    thumbnailUrl: string | null;
    description: string | null;
    totalLessons: number;
    completedCount: number;
    progressPercent: number;
    nextLesson: { id: string; title: string } | null;
  };
  certificateId?: string;
}) {
  const isComplete = course.progressPercent === 100;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      {/* Thumbnail */}
      {course.thumbnailUrl ? (
        <div className="aspect-video bg-neutral-100 dark:bg-neutral-800">
          <img
            src={course.thumbnailUrl}
            alt={course.title}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="aspect-video bg-neutral-100 dark:bg-neutral-800" />
      )}

      <div className="p-4">
        {/* Title */}
        <Link
          to="/courses/$courseSlug"
          params={{ courseSlug: course.slug }}
          className="text-lg font-semibold hover:underline"
        >
          {course.title}
        </Link>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span>
              {course.completedCount} / {course.totalLessons} lessons
            </span>
            <span>{course.progressPercent}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div
              className={`h-full rounded-full transition-all ${
                isComplete
                  ? "bg-green-500"
                  : "bg-neutral-900 dark:bg-neutral-100"
              }`}
              style={{ width: `${course.progressPercent}%` }}
            />
          </div>
        </div>

        {/* Continue / Completed CTA */}
        <div className="mt-4">
          {isComplete ? (
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
                <svg
                  viewBox="0 0 12 12"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M2 6l3 3 5-5" />
                </svg>
                Course completed
              </div>
              {certificateId && (
                <Link
                  to="/certificates/$certificateId"
                  params={{ certificateId }}
                  className="text-sm font-medium text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  View certificate
                </Link>
              )}
            </div>
          ) : course.nextLesson ? (
            <Link
              to="/courses/$courseSlug/lessons/$lessonId"
              params={{
                courseSlug: course.slug,
                lessonId: course.nextLesson.id,
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {course.completedCount === 0
                ? "Start learning"
                : "Continue learning"}
              <span aria-hidden="true">&rarr;</span>
            </Link>
          ) : (
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              No lessons available
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
