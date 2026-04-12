import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getLessonFn } from "#/lib/lesson-actions.ts";
import { markLessonCompleteFn } from "#/lib/progress-actions.ts";
import { submitQuizFn, getQuizResultFn } from "#/lib/quiz-actions.ts";
import { isQuizContent } from "#/lib/rich-text/types.ts";
import type { QuizContent } from "#/lib/rich-text/types.ts";
import type { QuizAnswer } from "#/db/schema/quiz-results.ts";

export const Route = createFileRoute(
  "/courses/$courseSlug/lessons/$lessonId",
)({
  loader: async ({ params }) => {
    const lessonData = await getLessonFn({
      data: { courseSlug: params.courseSlug, lessonId: params.lessonId },
    });
    // Fetch quiz result if this is a quiz lesson
    let quizResult: { score: number; totalQuestions: number; answers: QuizAnswer[] } | null = null;
    if (lessonData.lesson.type === "quiz") {
      try {
        quizResult = await getQuizResultFn({ data: { lessonId: params.lessonId } });
      } catch {
        // No result yet
      }
    }
    return { ...lessonData, quizResult };
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
    quizResult: initialQuizResult,
  } = Route.useLoaderData();

  const content = lesson.content as { text?: string } | null;
  const completedSet = new Set(completedLessonIds);
  const isQuiz = lesson.type === "quiz" && isQuizContent(lesson.content);

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

          {isQuiz ? (
            <QuizViewer
              quizContent={lesson.content as QuizContent}
              courseSlug={course.slug}
              lessonId={lesson.id}
              initialResult={initialQuizResult}
              onComplete={() => setIsCompleted(true)}
            />
          ) : (
            <>
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
            </>
          )}

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

function QuizViewer({
  quizContent,
  courseSlug,
  lessonId,
  initialResult,
  onComplete,
}: {
  quizContent: QuizContent;
  courseSlug: string;
  lessonId: string;
  initialResult: { score: number; totalQuestions: number; answers: QuizAnswer[] } | null;
  onComplete: () => void;
}) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    score: number;
    totalQuestions: number;
    answers: QuizAnswer[];
  } | null>(initialResult);

  const questions = quizContent.questions ?? [];

  if (questions.length === 0) {
    return (
      <div className="mt-6">
        <p className="text-neutral-500 dark:text-neutral-400 italic">
          This quiz has no questions yet.
        </p>
      </div>
    );
  }

  async function handleSubmit() {
    const answers = questions.map((q) => ({
      questionId: q.id,
      selectedOption: selectedAnswers[q.id] ?? -1,
    }));

    // Check all questions answered
    if (answers.some((a) => a.selectedOption === -1)) {
      alert("Please answer all questions before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitQuizFn({
        data: { courseSlug, lessonId, answers },
      });
      setResult({
        score: res.score,
        totalQuestions: res.totalQuestions,
        answers: res.answers,
      });
      onComplete();
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetake() {
    setResult(null);
    setSelectedAnswers({});
  }

  // Show results
  if (result) {
    const answerMap = new Map(result.answers.map((a) => [a.questionId, a]));
    return (
      <div className="mt-6 space-y-6">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-lg font-semibold">
            Score: {result.score}/{result.totalQuestions}
          </div>
          <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {result.score === result.totalQuestions
              ? "Perfect score!"
              : `${Math.round((result.score / result.totalQuestions) * 100)}% correct`}
          </div>
        </div>

        {questions.map((q, qi) => {
          const answer = answerMap.get(q.id);
          return (
            <div key={q.id} className="space-y-2">
              <div className="text-sm font-medium">
                {qi + 1}. {q.question}
              </div>
              <div className="space-y-1 pl-4">
                {q.options.map((opt, oi) => {
                  const isSelected = answer?.selectedOption === oi;
                  const isCorrect = q.correctOption === oi;
                  let className = "flex items-center gap-2 rounded-md px-2 py-1 text-sm";
                  if (isCorrect) {
                    className += " bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400";
                  } else if (isSelected && !answer?.correct) {
                    className += " bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400";
                  }
                  return (
                    <div key={oi} className={className}>
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-[10px] dark:border-neutral-600">
                        {isCorrect ? "\u2713" : isSelected ? "\u2717" : ""}
                      </span>
                      {opt}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={handleRetake}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Retake quiz
        </button>
      </div>
    );
  }

  // Show quiz form
  return (
    <div className="mt-6 space-y-6">
      {questions.map((q, qi) => (
        <div key={q.id} className="space-y-2">
          <div className="text-sm font-medium">
            {qi + 1}. {q.question}
          </div>
          <div className="space-y-1 pl-4">
            {q.options.map((opt, oi) => (
              <label
                key={oi}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              >
                <input
                  type="radio"
                  name={`quiz-${q.id}`}
                  checked={selectedAnswers[q.id] === oi}
                  onChange={() =>
                    setSelectedAnswers((prev) => ({ ...prev, [q.id]: oi }))
                  }
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={submitting}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {submitting ? "Submitting..." : "Submit quiz"}
      </button>
    </div>
  );
}
