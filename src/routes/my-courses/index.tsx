import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionFn } from "#/lib/auth-session.ts";
import { getCrossSchoolDashboardFn } from "#/lib/cross-school-actions.ts";

export const Route = createFileRoute("/my-courses/")({
  beforeLoad: async () => {
    const session = await getSessionFn();
    if (!session) {
      throw redirect({ to: "/login" });
    }
  },
  loader: async () => {
    return getCrossSchoolDashboardFn();
  },
  component: CrossSchoolDashboard,
});

function CrossSchoolDashboard() {
  const { schools } = Route.useLoaderData();

  return (
    <main className="page-wrap px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My Schools</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          All your enrollments across different schools
        </p>

        {schools.length === 0 ? (
          <div className="mt-12 text-center">
            <p className="text-neutral-500 dark:text-neutral-400">
              You haven't enrolled in any courses yet.
            </p>
            <p className="mt-2 text-sm text-neutral-400 dark:text-neutral-500">
              Browse a school's storefront to find courses.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {schools.map((school) => (
              <SchoolSection key={school.tenantId} school={school} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function SchoolSection({
  school,
}: {
  school: {
    tenantId: string;
    name: string;
    subdomain: string;
    logoUrl: string | null;
    role: string;
    url: string;
    courses: Array<{
      courseId: string;
      courseTitle: string;
      courseSlug: string;
      thumbnailUrl: string | null;
      enrolledAt: Date;
      totalLessons: number;
      completedCount: number;
      progressPercent: number;
      nextLesson: { id: string; title: string } | null;
    }>;
  };
}) {
  const roleLabel =
    school.role === "tenant_owner" ? "Owner" : school.role === "tenant_admin" ? "Admin" : "Student";

  return (
    <section>
      <div className="flex items-center gap-3">
        {school.logoUrl ? (
          <img
            src={school.logoUrl}
            alt={school.name}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
            {school.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h2 className="text-lg font-semibold">
            <a
              href={school.url}
              className="hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {school.name}
            </a>
          </h2>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{roleLabel}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {school.courses.map((course) => (
          <CrossSchoolCourseCard key={course.courseId} course={course} schoolUrl={school.url} />
        ))}
      </div>
    </section>
  );
}

function CrossSchoolCourseCard({
  course,
  schoolUrl,
}: {
  course: {
    courseId: string;
    courseTitle: string;
    courseSlug: string;
    thumbnailUrl: string | null;
    enrolledAt: Date;
    totalLessons: number;
    completedCount: number;
    progressPercent: number;
    nextLesson: { id: string; title: string } | null;
  };
  schoolUrl: string;
}) {
  const isComplete = course.progressPercent === 100;
  const courseUrl = `${schoolUrl}/courses/${course.courseSlug}`;
  const continueUrl = course.nextLesson
    ? `${schoolUrl}/courses/${course.courseSlug}/lessons/${course.nextLesson.id}`
    : courseUrl;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      {course.thumbnailUrl ? (
        <div className="aspect-video bg-neutral-100 dark:bg-neutral-800">
          <img
            src={course.thumbnailUrl}
            alt={course.courseTitle}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="aspect-video bg-neutral-100 dark:bg-neutral-800" />
      )}

      <div className="p-4">
        <a href={courseUrl} className="text-lg font-semibold hover:underline">
          {course.courseTitle}
        </a>

        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Enrolled {new Date(course.enrolledAt).toLocaleDateString()}
        </p>

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
                isComplete ? "bg-green-500" : "bg-neutral-900 dark:bg-neutral-100"
              }`}
              style={{ width: `${course.progressPercent}%` }}
            />
          </div>
        </div>

        {/* CTA */}
        <div className="mt-4">
          {isComplete ? (
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
          ) : (
            <a
              href={continueUrl}
              className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {course.completedCount === 0 ? "Start learning" : "Continue learning"}
              <span aria-hidden="true">&rarr;</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
