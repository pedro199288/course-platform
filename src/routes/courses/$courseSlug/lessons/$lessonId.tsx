import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getLessonFn } from "#/lib/lesson-actions.ts";
import { markLessonCompleteFn } from "#/lib/progress-actions.ts";

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
  const {
    course,
    module,
    lesson,
    curriculum,
    prevLesson,
    nextLesson,
    completedLessonIds,
  } = Route.useLoaderData();

  const content = lesson.content as { text?: string } | null;
  const completedSet = new Set(completedLessonIds);

  const [isCompleted, setIsCompleted] = useState(
    completedSet.has(lesson.id),
  );
  const [isMarking, setIsMarking] = useState(false);

  async function handleMarkComplete() {
    setIsMarking(true);
    try {
      await markLessonCompleteFn({
        data: { courseSlug: course.slug, lessonId: lesson.id },
      });
      setIsCompleted(true);
    } finally {
      setIsMarking(false);
    }
  }

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
                      const isDone =
                        isCurrent ? isCompleted : completedSet.has(l.id);
                      return (
                        <li key={l.id}>
                          <Link
                            to="/courses/$courseSlug/lessons/$lessonId"
                            params={{
                              courseSlug: course.slug,
                              lessonId: l.id,
                            }}
                            className={`flex items-center gap-2 px-4 py-2 text-sm ${
                              isCurrent
                                ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                                : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                            }`}
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                isDone
                                  ? "border-green-500 bg-green-500 text-white"
                                  : "border-neutral-300 dark:border-neutral-600"
                              }`}
                            >
                              {isDone && (
                                <svg
                                  viewBox="0 0 12 12"
                                  className="h-2.5 w-2.5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M2 6l3 3 5-5" />
                                </svg>
                              )}
                            </span>
                            <span className="truncate">{l.title}</span>
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

          {/* Mark as complete */}
          <div className="mt-8">
            {isCompleted ? (
              <div className="inline-flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                <svg
                  viewBox="0 0 12 12"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M2 6l3 3 5-5" />
                </svg>
                Lesson completed
              </div>
            ) : (
              <button
                type="button"
                onClick={handleMarkComplete}
                disabled={isMarking}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {isMarking ? "Marking..." : "Mark as complete"}
              </button>
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
