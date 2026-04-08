import { createFileRoute, Link } from "@tanstack/react-router";
import { getLessonFn } from "#/lib/lesson-actions.ts";

export const Route = createFileRoute(
  "/courses/$courseSlug/lessons/$lessonId",
)({
  loader: async ({ params }) => {
    return getLessonFn({
      data: { courseSlug: params.courseSlug, lessonId: params.lessonId },
    });
  },
  component: LessonViewerPage,
  errorComponent: LessonError,
});

function LessonError({ error }: { error: Error }) {
  const isNotEnrolled = error.message === "Not enrolled";
  const isUnauthorized = error.message === "Unauthorized";

  if (isUnauthorized) {
    return (
      <main className="page-wrap px-4 py-10">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="text-2xl font-bold">Sign in required</h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400">
            You need to sign in to access this lesson.
          </p>
          <Link
            to="/login"
            className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (isNotEnrolled) {
    return (
      <main className="page-wrap px-4 py-10">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="text-2xl font-bold">Enrollment required</h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400">
            You need to enroll in this course to access the lessons.
          </p>
          <Link
            to="/courses"
            className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Browse courses
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page-wrap px-4 py-10">
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {error.message}
        </p>
      </div>
    </main>
  );
}

function LessonViewerPage() {
  const { course, module, lesson, curriculum, prevLesson, nextLesson } =
    Route.useLoaderData();

  const content = lesson.content as { text?: string } | null;

  return (
    <main className="page-wrap px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-4">
        {/* Sidebar: curriculum navigation */}
        <aside className="order-2 lg:order-1 lg:col-span-1">
          <div className="sticky top-20 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <Link
                to="/courses/$courseSlug"
                params={{ courseSlug: course.slug }}
                className="text-sm font-medium hover:underline"
              >
                {course.title}
              </Link>
            </div>
            <nav className="max-h-[60vh] overflow-y-auto">
              {curriculum.map((mod) => (
                <div key={mod.id}>
                  <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    {mod.title}
                  </div>
                  <ul>
                    {mod.lessons.map((l) => {
                      const isCurrent = l.id === lesson.id;
                      return (
                        <li key={l.id}>
                          <Link
                            to="/courses/$courseSlug/lessons/$lessonId"
                            params={{
                              courseSlug: course.slug,
                              lessonId: l.id,
                            }}
                            className={`block px-4 py-2 text-sm ${
                              isCurrent
                                ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                                : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                            }`}
                          >
                            {l.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <div className="order-1 lg:order-2 lg:col-span-3">
          <div className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
            {module.title}
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {lesson.title}
          </h1>

          {/* Text content */}
          <div className="prose dark:prose-invert mt-6 max-w-none">
            {content?.text ? (
              content.text.split("\n").map((paragraph, i) =>
                paragraph.trim() ? (
                  <p key={i}>{paragraph}</p>
                ) : (
                  <br key={i} />
                ),
              )
            ) : (
              <p className="text-neutral-500 dark:text-neutral-400 italic">
                No content yet.
              </p>
            )}
          </div>

          {/* Prev / Next navigation */}
          <div className="mt-10 flex items-center justify-between border-t border-neutral-200 pt-6 dark:border-neutral-800">
            {prevLesson ? (
              <Link
                to="/courses/$courseSlug/lessons/$lessonId"
                params={{
                  courseSlug: course.slug,
                  lessonId: prevLesson.id,
                }}
                className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                &larr; {prevLesson.title}
              </Link>
            ) : (
              <span />
            )}
            {nextLesson ? (
              <Link
                to="/courses/$courseSlug/lessons/$lessonId"
                params={{
                  courseSlug: course.slug,
                  lessonId: nextLesson.id,
                }}
                className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                {nextLesson.title} &rarr;
              </Link>
            ) : (
              <Link
                to="/courses/$courseSlug"
                params={{ courseSlug: course.slug }}
                className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                Back to course &rarr;
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
