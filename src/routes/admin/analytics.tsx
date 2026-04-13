import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  getCourseCompletionRatesFn,
  getModuleCompletionRatesFn,
  getLessonDropOffFn,
  getAverageProgressFn,
  type ModuleCompletionRate,
  type LessonDropOff,
  type AverageProgress,
} from "#/lib/instructor-dashboard-actions.ts";

export const Route = createFileRoute("/admin/analytics")({
  loader: async () => {
    const courseRates = await getCourseCompletionRatesFn();
    return { courseRates };
  },
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { courseRates } = Route.useLoaderData();
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [moduleRates, setModuleRates] = useState<ModuleCompletionRate[] | null>(null);
  const [lessonDropOff, setLessonDropOff] = useState<LessonDropOff[] | null>(null);
  const [avgProgress, setAvgProgress] = useState<AverageProgress | null>(null);
  const [loading, setLoading] = useState(false);

  async function selectCourse(courseId: string) {
    if (courseId === selectedCourseId) return;
    setSelectedCourseId(courseId);
    setLoading(true);
    try {
      const [mods, drops, avg] = await Promise.all([
        getModuleCompletionRatesFn({ data: { courseId } }),
        getLessonDropOffFn({ data: { courseId } }),
        getAverageProgressFn({ data: { courseId } }),
      ]);
      setModuleRates(mods);
      setLessonDropOff(drops);
      setAvgProgress(avg);
    } catch {
      setModuleRates(null);
      setLessonDropOff(null);
      setAvgProgress(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Engagement Analytics</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Completion rates and drop-off points across your courses
        </p>
      </div>

      {/* Course Completion Rates */}
      {courseRates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400">
            No published courses with enrollments yet.
          </p>
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold">Course Completion Rates</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Click a course to see module and lesson details
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                  <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                    Course
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                    Enrolled
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                    Completed
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {courseRates.map((course) => (
                  <tr
                    key={course.courseId}
                    onClick={() => void selectCourse(course.courseId)}
                    className={`cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50 ${
                      course.courseId === selectedCourseId
                        ? "bg-neutral-50 dark:bg-neutral-800/50"
                        : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">{course.courseTitle}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {course.enrolledStudents}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {course.completedStudents}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPercent(course.completionRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Course Detail Analytics */}
      {selectedCourseId && (
        <div className="space-y-6">
          {loading ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
          ) : (
            <>
              {/* Average Progress */}
              {avgProgress && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <StatCard
                    title="Total Lessons"
                    value={String(avgProgress.totalLessons)}
                  />
                  <StatCard
                    title="Enrolled Students"
                    value={String(avgProgress.enrolledStudents)}
                  />
                  <StatCard
                    title="Average Progress"
                    value={formatPercent(avgProgress.averageProgress)}
                  />
                </div>
              )}

              {/* Module Completion */}
              {moduleRates && moduleRates.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold">Module Completion</h2>
                  <div className="mt-3 space-y-2">
                    {moduleRates.map((mod) => (
                      <div
                        key={mod.moduleId}
                        className="flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {mod.moduleTitle}
                        </span>
                        <div className="flex w-48 items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                            <div
                              className="h-full rounded-full bg-neutral-900 dark:bg-neutral-100"
                              style={{ width: `${Math.round(mod.completionRate * 100)}%` }}
                            />
                          </div>
                          <span className="w-12 text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                            {formatPercent(mod.completionRate)}
                          </span>
                        </div>
                        <span className="text-xs text-neutral-400 dark:text-neutral-500">
                          {mod.completedStudents}/{mod.enrolledStudents}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Lesson Drop-off */}
              {lessonDropOff && lessonDropOff.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold">Lesson Drop-off</h2>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Lessons sorted by completion rate (lowest first) to identify where students
                    stop
                  </p>
                  <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                          <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                            Lesson
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400">
                            Module
                          </th>
                          <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                            Completed
                          </th>
                          <th className="px-4 py-3 text-right font-medium text-neutral-500 dark:text-neutral-400">
                            Rate
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...lessonDropOff]
                          .sort((a, b) => a.completionRate - b.completionRate)
                          .map((lesson) => (
                            <tr
                              key={lesson.lessonId}
                              className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                            >
                              <td className="px-4 py-3 font-medium">{lesson.lessonTitle}</td>
                              <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                                {lesson.moduleTitle}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                {lesson.completedStudents}/{lesson.enrolledStudents}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                                    lesson.completionRate < 0.3
                                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                      : lesson.completionRate < 0.7
                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                        : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  }`}
                                >
                                  {formatPercent(lesson.completionRate)}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{title}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
