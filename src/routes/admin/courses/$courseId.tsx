import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, asc, eq } from "drizzle-orm";
import { useState } from "react";
import { RichTextEditor } from "#/components/RichTextEditor.tsx";
import { RichTextViewer } from "#/components/RichTextViewer.tsx";
import { db } from "#/db/index.ts";
import { courses, modules, lessons } from "#/db/schema/index.ts";
import { auth } from "#/lib/auth.ts";
import {
  updateCourseFn,
  createModuleFn,
  deleteModuleFn,
  reorderModulesFn,
  createLessonFn,
  updateLessonFn,
  deleteLessonFn,
  reorderLessonsFn,
} from "#/lib/courses.ts";
import { emptyRichTextDoc, isRichTextDoc, type RichTextDoc } from "#/lib/rich-text/types.ts";

type Module = typeof modules.$inferSelect;
type Lesson = typeof lessons.$inferSelect;

const loadCourseDetailFn = createServerFn({ method: "GET" })
  .inputValidator((input: { courseId: string }) => input)
  .handler(async ({ data }) => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new Error("Unauthorized");

    const user = session.user as { tenantId: string };
    const course = await db.query.courses.findFirst({
      where: and(eq(courses.id, data.courseId), eq(courses.tenantId, user.tenantId)),
    });
    if (!course) throw new Error("Course not found");

    const courseModules = await db.query.modules.findMany({
      where: eq(modules.courseId, course.id),
      orderBy: [asc(modules.position)],
    });

    const moduleLessons: Record<string, Lesson[]> = {};
    for (const mod of courseModules) {
      moduleLessons[mod.id] = await db.query.lessons.findMany({
        where: eq(lessons.moduleId, mod.id),
        orderBy: [asc(lessons.position)],
      });
    }

    return { course, modules: courseModules, lessons: moduleLessons };
  });

export const Route = createFileRoute("/admin/courses/$courseId")({
  loader: ({ params }) => loadCourseDetailFn({ data: { courseId: params.courseId } }),
  component: CourseDetailPage,
});

function CourseDetailPage() {
  const initial = Route.useLoaderData();
  const [course, setCourse] = useState(initial.course);
  const [moduleList, setModuleList] = useState<Module[]>(initial.modules);
  const [lessonMap, setLessonMap] = useState<Record<string, Lesson[]>>(initial.lessons);

  // Course edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(course.title);
  const [editDesc, setEditDesc] = useState(course.description || "");
  const [editSlug, setEditSlug] = useState(course.slug);

  // Module creation
  const [newModuleTitle, setNewModuleTitle] = useState("");

  // Lesson creation per module
  const [addingLessonFor, setAddingLessonFor] = useState<string | null>(null);
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [newLessonContent, setNewLessonContent] = useState<RichTextDoc>(emptyRichTextDoc());

  // Lesson edit state (by lesson id)
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editLessonTitle, setEditLessonTitle] = useState("");
  const [editLessonContent, setEditLessonContent] = useState<RichTextDoc>(emptyRichTextDoc());

  // Preview expansion (by lesson id)
  const [expandedLessonIds, setExpandedLessonIds] = useState<Set<string>>(new Set());

  async function handleUpdateCourse() {
    const updated = await updateCourseFn({
      data: {
        courseId: course.id,
        title: editTitle,
        description: editDesc || undefined,
        slug: editSlug,
      },
    });
    setCourse(updated);
    setEditing(false);
  }

  async function handleToggleStatus() {
    const newStatus = course.status === "draft" ? "published" : "draft";
    const updated = await updateCourseFn({
      data: { courseId: course.id, status: newStatus as "draft" | "published" },
    });
    setCourse(updated);
  }

  async function handleAddModule(e: React.FormEvent) {
    e.preventDefault();
    if (!newModuleTitle.trim()) return;
    const mod = await createModuleFn({ data: { courseId: course.id, title: newModuleTitle } });
    setModuleList((prev) => [...prev, mod]);
    setLessonMap((prev) => ({ ...prev, [mod.id]: [] }));
    setNewModuleTitle("");
  }

  async function handleDeleteModule(moduleId: string) {
    if (!confirm("Delete this module and all its lessons?")) return;
    await deleteModuleFn({ data: { moduleId } });
    setModuleList((prev) => prev.filter((m) => m.id !== moduleId));
    setLessonMap((prev) => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });
  }

  function openLessonForm(moduleId: string) {
    setAddingLessonFor(moduleId);
    setNewLessonTitle("");
    setNewLessonContent(emptyRichTextDoc());
  }

  async function handleAddLesson(moduleId: string, e: React.FormEvent) {
    e.preventDefault();
    if (!newLessonTitle.trim()) return;
    const lesson = await createLessonFn({
      data: {
        moduleId,
        title: newLessonTitle,
        type: "text",
        content: newLessonContent,
      },
    });
    setLessonMap((prev) => ({
      ...prev,
      [moduleId]: [...(prev[moduleId] || []), lesson],
    }));
    setNewLessonTitle("");
    setNewLessonContent(emptyRichTextDoc());
    setAddingLessonFor(null);
  }

  function openLessonEditor(lesson: Lesson) {
    setEditingLessonId(lesson.id);
    setEditLessonTitle(lesson.title);
    setEditLessonContent(isRichTextDoc(lesson.content) ? lesson.content : emptyRichTextDoc());
  }

  async function handleSaveLessonEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLessonId) return;
    const updated = await updateLessonFn({
      data: {
        lessonId: editingLessonId,
        title: editLessonTitle,
        content: editLessonContent,
      },
    });
    setLessonMap((prev) => {
      const next: Record<string, Lesson[]> = {};
      for (const [mid, list] of Object.entries(prev)) {
        next[mid] = list.map((l) => (l.id === updated.id ? updated : l));
      }
      return next;
    });
    setEditingLessonId(null);
  }

  async function handleDeleteLesson(lessonId: string, moduleId: string) {
    if (!confirm("Delete this lesson?")) return;
    await deleteLessonFn({ data: { lessonId } });
    setLessonMap((prev) => ({
      ...prev,
      [moduleId]: (prev[moduleId] || []).filter((l) => l.id !== lessonId),
    }));
  }

  function toggleLessonPreview(lessonId: string) {
    setExpandedLessonIds((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  }

  async function handleMoveModule(moduleId: string, direction: "up" | "down") {
    const currentIndex = moduleList.findIndex((m) => m.id === moduleId);
    if (currentIndex === -1) return;
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= moduleList.length) return;

    const reordered = [...moduleList];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];

    // Optimistic update
    setModuleList(reordered);
    try {
      const updated = await reorderModulesFn({
        data: { courseId: course.id, moduleIds: reordered.map((m) => m.id) },
      });
      setModuleList(updated);
    } catch (err) {
      // Revert on error
      setModuleList(moduleList);
      alert(err instanceof Error ? err.message : "Failed to reorder modules");
    }
  }

  async function handleMoveLesson(moduleId: string, lessonId: string, direction: "up" | "down") {
    const current = lessonMap[moduleId] || [];
    const currentIndex = current.findIndex((l) => l.id === lessonId);
    if (currentIndex === -1) return;
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;

    const reordered = [...current];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];

    // Optimistic update
    setLessonMap((prev) => ({ ...prev, [moduleId]: reordered }));
    try {
      const updated = await reorderLessonsFn({
        data: { moduleId, lessonIds: reordered.map((l) => l.id) },
      });
      setLessonMap((prev) => ({ ...prev, [moduleId]: updated }));
    } catch (err) {
      // Revert on error
      setLessonMap((prev) => ({ ...prev, [moduleId]: current }));
      alert(err instanceof Error ? err.message : "Failed to reorder lessons");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <Link to="/admin/courses" className="hover:underline">
          Courses
        </Link>
        <span>/</span>
        <span>{course.title}</span>
      </div>

      {/* Course Header */}
      <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="editTitle" className="block text-sm font-medium">
                Title
              </label>
              <input
                id="editTitle"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              />
            </div>
            <div>
              <label htmlFor="editSlug" className="block text-sm font-medium">
                Slug
              </label>
              <input
                id="editSlug"
                type="text"
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              />
            </div>
            <div>
              <label htmlFor="editDesc" className="block text-sm font-medium">
                Description
              </label>
              <textarea
                id="editDesc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleUpdateCourse}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{course.title}</h1>
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
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">/{course.slug}</p>
              {course.description && <p className="mt-2 text-sm">{course.description}</p>}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleToggleStatus}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {course.status === "draft" ? "Publish" : "Unpublish"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Edit
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modules & Lessons */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Modules</h2>

        {moduleList.map((mod, modIndex) => (
          <div
            key={mod.id}
            className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={`Move module ${mod.title} up`}
                    onClick={() => handleMoveModule(mod.id, "up")}
                    disabled={modIndex === 0}
                    className="px-1 text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-30 disabled:hover:text-neutral-500 dark:hover:text-neutral-100"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Move module ${mod.title} down`}
                    onClick={() => handleMoveModule(mod.id, "down")}
                    disabled={modIndex === moduleList.length - 1}
                    className="px-1 text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-30 disabled:hover:text-neutral-500 dark:hover:text-neutral-100"
                  >
                    ▼
                  </button>
                </div>
                <h3 className="font-medium">{mod.title}</h3>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    addingLessonFor === mod.id ? setAddingLessonFor(null) : openLessonForm(mod.id)
                  }
                  className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  Add Lesson
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteModule(mod.id)}
                  className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="p-4">
              {(lessonMap[mod.id] || []).length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">No lessons yet.</p>
              ) : (
                <ul className="space-y-2">
                  {(lessonMap[mod.id] || []).map((lesson, lessonIndex) => {
                    const lessonsForMod = lessonMap[mod.id] || [];
                    const isEditing = editingLessonId === lesson.id;
                    const isExpanded = expandedLessonIds.has(lesson.id);
                    return (
                      <li
                        key={lesson.id}
                        className="rounded-md border border-neutral-100 p-3 dark:border-neutral-800"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                              <button
                                type="button"
                                aria-label={`Move lesson ${lesson.title} up`}
                                onClick={() => handleMoveLesson(mod.id, lesson.id, "up")}
                                disabled={lessonIndex === 0}
                                className="px-1 text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-30 disabled:hover:text-neutral-500 dark:hover:text-neutral-100"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                aria-label={`Move lesson ${lesson.title} down`}
                                onClick={() => handleMoveLesson(mod.id, lesson.id, "down")}
                                disabled={lessonIndex === lessonsForMod.length - 1}
                                className="px-1 text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-30 disabled:hover:text-neutral-500 dark:hover:text-neutral-100"
                              >
                                ▼
                              </button>
                            </div>
                            <div>
                              <span className="text-sm font-medium">{lesson.title}</span>
                              <span className="ml-2 text-xs text-neutral-400">{lesson.type}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 text-xs">
                            {lesson.type === "text" && !isEditing && (
                              <button
                                type="button"
                                onClick={() => toggleLessonPreview(lesson.id)}
                                className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                              >
                                {isExpanded ? "Hide" : "Preview"}
                              </button>
                            )}
                            {lesson.type === "text" && !isEditing && (
                              <button
                                type="button"
                                onClick={() => openLessonEditor(lesson)}
                                className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                              >
                                Edit
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteLesson(lesson.id, mod.id)}
                              className="text-red-500 hover:text-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {isEditing ? (
                          <form onSubmit={handleSaveLessonEdit} className="mt-3 space-y-2">
                            <input
                              type="text"
                              value={editLessonTitle}
                              onChange={(e) => setEditLessonTitle(e.target.value)}
                              placeholder="Lesson title"
                              required
                              className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
                            />
                            <RichTextEditor
                              value={editLessonContent}
                              onChange={setEditLessonContent}
                              ariaLabel="Lesson content"
                              placeholder="Write the lesson content…"
                            />
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingLessonId(null)}
                                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          isExpanded &&
                          lesson.type === "text" && (
                            <div className="mt-3 rounded-md border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
                              <RichTextViewer content={lesson.content} />
                            </div>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {addingLessonFor === mod.id && (
                <form onSubmit={(e) => handleAddLesson(mod.id, e)} className="mt-3 space-y-2">
                  <input
                    type="text"
                    value={newLessonTitle}
                    onChange={(e) => setNewLessonTitle(e.target.value)}
                    placeholder="Lesson title"
                    required
                    className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
                  />
                  <RichTextEditor
                    value={newLessonContent}
                    onChange={setNewLessonContent}
                    ariaLabel="Lesson content"
                    placeholder="Write the lesson content…"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
                    >
                      Add Lesson
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingLessonFor(null)}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ))}

        {/* Add Module Form */}
        <form onSubmit={handleAddModule} className="flex gap-2">
          <input
            type="text"
            value={newModuleTitle}
            onChange={(e) => setNewModuleTitle(e.target.value)}
            placeholder="New module title"
            className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          />
          <button
            type="submit"
            disabled={!newModuleTitle.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            Add Module
          </button>
        </form>
      </div>
    </div>
  );
}
