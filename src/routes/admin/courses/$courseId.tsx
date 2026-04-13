import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { QuizQuestion } from "#/lib/rich-text/types.ts";
import { isQuizContent } from "#/lib/rich-text/types.ts";
import {
  getCourseByIdFn,
  updateCourseFn,
  deleteCourseFn,
  listModulesFn,
  createModuleFn,
  updateModuleFn,
  deleteModuleFn,
  listLessonsFn,
  createLessonFn,
  updateLessonFn,
  deleteLessonFn,
} from "#/lib/course-actions.ts";
import { getFileUploadUrlFn } from "#/lib/file-lessons.ts";
import {
  listAnnouncementsFn,
  createAnnouncementFn,
  deleteAnnouncementFn,
} from "#/lib/announcement-actions.ts";

interface Module {
  id: string;
  courseId: string;
  title: string;
  position: number;
  availableAfterDays: number | null;
  availableFromDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Lesson {
  id: string;
  moduleId: string;
  title: string;
  type: "video" | "text" | "quiz" | "file";
  content: unknown;
  position: number;
  availableAfterDays: number | null;
  availableFromDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const Route = createFileRoute("/admin/courses/$courseId")({
  loader: async ({ params }) => {
    const course = await getCourseByIdFn({ data: { courseId: params.courseId } });
    const mods = await listModulesFn({ data: { courseId: params.courseId } });
    // Load lessons for each module
    const modulesWithLessons: (Module & { lessons: Lesson[] })[] = await Promise.all(
      mods.map(async (mod: Module) => {
        const modLessons: Lesson[] = await listLessonsFn({ data: { moduleId: mod.id } });
        return { ...mod, lessons: modLessons };
      }),
    );
    const courseAnnouncements = await listAnnouncementsFn({ data: { courseId: params.courseId } });
    return { course, modules: modulesWithLessons, announcements: courseAnnouncements };
  },
  component: CourseDetailPage,
});

function CourseDetailPage() {
  const { course: initialCourse, modules: initialModules, announcements: initialAnnouncements } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();

  const [title, setTitle] = useState(initialCourse.title);
  const [description, setDescription] = useState(initialCourse.description ?? "");
  const [slug, setSlug] = useState(initialCourse.slug);
  const [price, setPrice] = useState(initialCourse.price ?? "");
  const [pricingModel, setPricingModel] = useState(initialCourse.pricingModel);
  const [sequentialProgress, setSequentialProgress] = useState(
    initialCourse.sequentialProgress ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await updateCourseFn({
        data: {
          courseId: initialCourse.id,
          title,
          description: description || undefined,
          slug,
          price: price || undefined,
          pricingModel,
          sequentialProgress,
        },
      });
      setSuccess(true);
      void router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this course and all its content?")) return;
    await deleteCourseFn({ data: { courseId: initialCourse.id } });
    void navigate({ to: "/admin/courses" });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit course</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {initialCourse.status === "published" ? "Published" : "Draft"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          Delete course
        </button>
      </div>

      {/* Course details form */}
      <form onSubmit={(e) => void handleSave(e)} className="max-w-2xl space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            Course saved successfully
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="slug" className="block text-sm font-medium">
            Slug
          </label>
          <input
            id="slug"
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="description" className="block text-sm font-medium">
            Description
          </label>
          <textarea
            id="description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="price" className="block text-sm font-medium">
              Price
            </label>
            <input
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pricingModel" className="block text-sm font-medium">
              Pricing model
            </label>
            <select
              id="pricingModel"
              value={pricingModel}
              onChange={(e) => setPricingModel(e.target.value as typeof pricingModel)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="one_time">One-time purchase</option>
              <option value="subscription">Subscription</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="sequentialProgress" className="relative inline-flex cursor-pointer items-center">
            <input
              id="sequentialProgress"
              type="checkbox"
              checked={sequentialProgress}
              onChange={(e) => setSequentialProgress(e.target.checked)}
              className="peer sr-only"
            />
            <div className="peer h-5 w-9 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-neutral-900 peer-checked:after:translate-x-full dark:bg-neutral-700 dark:peer-checked:bg-neutral-100" />
          </label>
          <div>
            <span className="text-sm font-medium">Sequential progression</span>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Students must complete lessons in order
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </form>

      {/* Modules and Lessons */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Curriculum</h2>
        <ModulesList courseId={initialCourse.id} initialModules={initialModules} />
      </div>

      {/* Announcements */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Announcements</h2>
        <AnnouncementsSection courseId={initialCourse.id} announcements={initialAnnouncements} />
      </div>
    </div>
  );
}

interface Announcement {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  body: string;
  emailSent: boolean;
  createdAt: Date;
}

function AnnouncementsSection({
  courseId,
  announcements,
}: {
  courseId: string;
  announcements: Announcement[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [posting, setPosting] = useState(false);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    if (sendEmail && !confirm("This will send an email to all enrolled students. Continue?")) return;
    setPosting(true);
    try {
      await createAnnouncementFn({
        data: { courseId, title: title.trim(), body: body.trim(), sendEmail },
      });
      setTitle("");
      setBody("");
      setSendEmail(false);
      setShowForm(false);
      void router.invalidate();
    } catch {
      alert("Failed to post announcement");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(announcementId: string) {
    if (!confirm("Delete this announcement?")) return;
    await deleteAnnouncementFn({ data: { announcementId } });
    void router.invalidate();
  }

  return (
    <div className="space-y-3">
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          + New announcement
        </button>
      )}

      {showForm && (
        <form
          onSubmit={(e) => void handlePost(e)}
          className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <div className="space-y-1.5">
            <label htmlFor="ann-title" className="block text-sm font-medium">
              Title
            </label>
            <input
              id="ann-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Announcement title"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ann-body" className="block text-sm font-medium">
              Body
            </label>
            <textarea
              id="ann-body"
              rows={4}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your announcement..."
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="ann-email"
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="rounded border-neutral-300"
            />
            <label htmlFor="ann-email" className="text-sm text-neutral-600 dark:text-neutral-400">
              Also send by email to all enrolled students
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={posting || !title.trim() || !body.trim()}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {posting ? "Posting..." : "Post announcement"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setTitle("");
                setBody("");
                setSendEmail(false);
              }}
              className="text-sm text-neutral-400 hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {announcements.length === 0 && !showForm && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No announcements yet.</p>
      )}

      {announcements.map((ann) => (
        <div
          key={ann.id}
          className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold">{ann.title}</h3>
              <p className="mt-1 text-sm text-neutral-600 whitespace-pre-wrap dark:text-neutral-400">
                {ann.body}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleDelete(ann.id)}
              className="ml-4 text-xs text-red-500 hover:underline"
            >
              Delete
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-neutral-400">
            <span>{new Date(ann.createdAt).toLocaleDateString()}</span>
            {ann.emailSent && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                Emailed
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModulesList({
  courseId,
  initialModules,
}: {
  courseId: string;
  initialModules: (Module & { lessons: Lesson[] })[];
}) {
  const router = useRouter();
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAddModule(e: React.FormEvent) {
    e.preventDefault();
    if (!newModuleTitle.trim()) return;
    setAdding(true);
    try {
      await createModuleFn({ data: { courseId, title: newModuleTitle.trim() } });
      setNewModuleTitle("");
      void router.invalidate();
    } catch {
      alert("Failed to add module");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-3">
      {initialModules.map((mod) => (
        <ModuleItem key={mod.id} module={mod} />
      ))}

      <form onSubmit={(e) => void handleAddModule(e)} className="flex gap-2">
        <input
          type="text"
          placeholder="New module title..."
          value={newModuleTitle}
          onChange={(e) => setNewModuleTitle(e.target.value)}
          className="flex-1 rounded-md border border-dashed border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={adding || !newModuleTitle.trim()}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {adding ? "..." : "Add module"}
        </button>
      </form>
    </div>
  );
}

function ModuleItem({ module: mod }: { module: Module & { lessons: Lesson[] } }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(mod.title);
  const [availableAfterDays, setAvailableAfterDays] = useState(
    mod.availableAfterDays?.toString() ?? "",
  );
  const [availableFromDate, setAvailableFromDate] = useState(
    mod.availableFromDate ? new Date(mod.availableFromDate).toISOString().slice(0, 10) : "",
  );
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [addingLesson, setAddingLesson] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    await updateModuleFn({
      data: {
        moduleId: mod.id,
        title: title.trim(),
        availableAfterDays: availableAfterDays ? parseInt(availableAfterDays, 10) : null,
        availableFromDate: availableFromDate || null,
      },
    });
    setEditing(false);
    void router.invalidate();
  }

  async function handleDelete() {
    if (!confirm("Delete this module and all its lessons?")) return;
    await deleteModuleFn({ data: { moduleId: mod.id } });
    void router.invalidate();
  }

  const [newLessonType, setNewLessonType] = useState<"text" | "quiz" | "file">("text");

  async function handleAddLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!newLessonTitle.trim()) return;
    setAddingLesson(true);
    try {
      await createLessonFn({
        data: {
          moduleId: mod.id,
          title: newLessonTitle.trim(),
          type: newLessonType,
          content:
            newLessonType === "quiz"
              ? ({ type: "quiz", questions: [] } as Record<string, unknown>)
              : newLessonType === "file"
                ? ({ type: "file", filename: null, contentType: null } as Record<string, unknown>)
                : undefined,
        },
      });
      setNewLessonTitle("");
      setNewLessonType("text");
      void router.invalidate();
    } catch {
      alert("Failed to add lesson");
    } finally {
      setAddingLesson(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
        {editing ? (
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSave();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <button
                type="button"
                onClick={() => void handleSave()}
                className="text-xs text-neutral-600 hover:underline dark:text-neutral-400"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setTitle(mod.title);
                }}
                className="text-xs text-neutral-400 hover:underline"
              >
                Cancel
              </button>
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-1">
                <label className="text-xs text-neutral-500">Drip (days):</label>
                <input
                  type="number"
                  min="0"
                  value={availableAfterDays}
                  onChange={(e) => setAvailableAfterDays(e.target.value)}
                  placeholder="—"
                  className="w-16 rounded-md border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-neutral-500">Available from:</label>
                <input
                  type="date"
                  value={availableFromDate}
                  onChange={(e) => setAvailableFromDate(e.target.value)}
                  className="rounded-md border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-sm font-medium hover:underline"
            >
              {mod.title}
            </button>
            {(mod.availableAfterDays != null || mod.availableFromDate != null) && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Drip
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="ml-2 text-xs text-red-500 hover:underline"
        >
          Delete
        </button>
      </div>

      <div className="p-3 space-y-2">
        {mod.lessons.map((lesson) => (
          <LessonItem key={lesson.id} lesson={lesson} />
        ))}

        <form onSubmit={(e) => void handleAddLesson(e)} className="flex gap-2">
          <input
            type="text"
            placeholder="New lesson title..."
            value={newLessonTitle}
            onChange={(e) => setNewLessonTitle(e.target.value)}
            className="flex-1 rounded-md border border-dashed border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <select
            value={newLessonType}
            onChange={(e) => setNewLessonType(e.target.value as "text" | "quiz" | "file")}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="text">Text</option>
            <option value="quiz">Quiz</option>
            <option value="file">File</option>
          </select>
          <button
            type="submit"
            disabled={addingLesson || !newLessonTitle.trim()}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {addingLesson ? "..." : "Add lesson"}
          </button>
        </form>
      </div>
    </div>
  );
}

function LessonItem({ lesson }: { lesson: Lesson }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [lessonAvailableAfterDays, setLessonAvailableAfterDays] = useState(
    lesson.availableAfterDays?.toString() ?? "",
  );
  const [lessonAvailableFromDate, setLessonAvailableFromDate] = useState(
    lesson.availableFromDate
      ? new Date(lesson.availableFromDate).toISOString().slice(0, 10)
      : "",
  );
  const [content, setContent] = useState(
    lesson.content &&
      typeof lesson.content === "object" &&
      "text" in (lesson.content as Record<string, unknown>)
      ? String((lesson.content as Record<string, unknown>).text)
      : typeof lesson.content === "string"
        ? lesson.content
        : "",
  );

  // Quiz editing state
  const quizContent = isQuizContent(lesson.content) ? lesson.content : null;
  const [questions, setQuestions] = useState<QuizQuestion[]>(quizContent?.questions ?? []);

  // File upload state
  const fileContent =
    lesson.type === "file" &&
    lesson.content &&
    typeof lesson.content === "object" &&
    "filename" in (lesson.content as Record<string, unknown>)
      ? (lesson.content as { filename: string | null; contentType: string | null })
      : null;
  const [uploading, setUploading] = useState(false);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(
    fileContent?.filename ?? null,
  );

  async function handleFileUpload(file: File) {
    setUploading(true);
    try {
      const { uploadUrl } = await getFileUploadUrlFn({
        data: {
          lessonId: lesson.id,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
        },
      });

      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });

      setUploadedFilename(file.name);
      void router.invalidate();
    } catch {
      alert("Failed to upload file");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    const dripData = {
      availableAfterDays: lessonAvailableAfterDays
        ? parseInt(lessonAvailableAfterDays, 10)
        : null,
      availableFromDate: lessonAvailableFromDate || null,
    };
    if (lesson.type === "quiz") {
      await updateLessonFn({
        data: {
          lessonId: lesson.id,
          title: title.trim() || undefined,
          content: { type: "quiz", questions } as Record<string, unknown>,
          ...dripData,
        },
      });
    } else {
      await updateLessonFn({
        data: {
          lessonId: lesson.id,
          title: title.trim() || undefined,
          content: content ? { text: content } : undefined,
          ...dripData,
        },
      });
    }
    setEditing(false);
    void router.invalidate();
  }

  async function handleDelete() {
    if (!confirm("Delete this lesson?")) return;
    await deleteLessonFn({ data: { lessonId: lesson.id } });
    void router.invalidate();
  }

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        question: "",
        options: ["", ""],
        correctOption: 0,
      },
    ]);
  }

  function updateQuestion(index: number, updated: QuizQuestion) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? updated : q)));
  }

  function removeQuestion(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          placeholder="Lesson title"
        />

        {lesson.type === "quiz" ? (
          <div className="space-y-3">
            {questions.map((q, qi) => (
              <QuizQuestionEditor
                key={q.id}
                question={q}
                index={qi}
                onChange={(updated) => updateQuestion(qi, updated)}
                onRemove={() => removeQuestion(qi)}
              />
            ))}
            <button
              type="button"
              onClick={addQuestion}
              className="rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              + Add question
            </button>
          </div>
        ) : lesson.type === "file" ? (
          <div className="space-y-2">
            {uploadedFilename && (
              <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path
                    fillRule="evenodd"
                    d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.241 4.243h.001l.497-.5a.75.75 0 011.064 1.057l-.498.501a4.5 4.5 0 01-6.364-6.364l7-7a4.5 4.5 0 016.368 6.36l-3.455 3.553A2.625 2.625 0 119.52 9.52l3.45-3.451a.75.75 0 111.061 1.06l-3.45 3.451a1.125 1.125 0 001.587 1.595l3.454-3.553a3 3 0 000-4.242z"
                    clipRule="evenodd"
                  />
                </svg>
                {uploadedFilename}
              </div>
            )}
            <label
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-3 py-3 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 ${uploading ? "opacity-50 pointer-events-none" : ""}`}
            >
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileUpload(file);
                }}
                disabled={uploading}
              />
              {uploading ? "Uploading..." : uploadedFilename ? "Replace file" : "Upload file"}
            </label>
          </div>
        ) : (
          <textarea
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Lesson content (plain text for now)"
          />
        )}

        <div className="flex gap-2">
          <div className="flex items-center gap-1">
            <label className="text-xs text-neutral-500">Drip (days):</label>
            <input
              type="number"
              min="0"
              value={lessonAvailableAfterDays}
              onChange={(e) => setLessonAvailableAfterDays(e.target.value)}
              placeholder="—"
              className="w-16 rounded-md border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-neutral-500">Available from:</label>
            <input
              type="date"
              value={lessonAvailableFromDate}
              onChange={(e) => setLessonAvailableFromDate(e.target.value)}
              className="rounded-md border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-neutral-400 hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-400">{lesson.type}</span>
        <span className="text-sm">{lesson.title}</span>
        {(lesson.availableAfterDays != null || lesson.availableFromDate != null) && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Drip
          </span>
        )}
        {lesson.type === "quiz" && quizContent && (
          <span className="text-xs text-neutral-400">
            ({quizContent.questions.length} question{quizContent.questions.length !== 1 ? "s" : ""})
          </span>
        )}
        {lesson.type === "file" && uploadedFilename && (
          <span className="text-xs text-neutral-400">({uploadedFilename})</span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-neutral-500 hover:underline"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="text-xs text-red-500 hover:underline"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function QuizQuestionEditor({
  question,
  index,
  onChange,
  onRemove,
}: {
  question: QuizQuestion;
  index: number;
  onChange: (q: QuizQuestion) => void;
  onRemove: () => void;
}) {
  function updateOption(optionIndex: number, value: string) {
    const newOptions = [...question.options];
    newOptions[optionIndex] = value;
    onChange({ ...question, options: newOptions });
  }

  function addOption() {
    onChange({ ...question, options: [...question.options, ""] });
  }

  function removeOption(optionIndex: number) {
    if (question.options.length <= 2) return;
    const newOptions = question.options.filter((_, i) => i !== optionIndex);
    const newCorrect =
      question.correctOption === optionIndex
        ? 0
        : question.correctOption > optionIndex
          ? question.correctOption - 1
          : question.correctOption;
    onChange({ ...question, options: newOptions, correctOption: newCorrect });
  }

  return (
    <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-500">Question {index + 1}</span>
        <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:underline">
          Remove
        </button>
      </div>
      <input
        type="text"
        value={question.question}
        onChange={(e) => onChange({ ...question, question: e.target.value })}
        className="mb-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        placeholder="Question text"
      />
      <div className="space-y-1">
        {question.options.map((opt, oi) => (
          <div key={oi} className="flex items-center gap-2">
            <input
              type="radio"
              name={`correct-${question.id}`}
              checked={question.correctOption === oi}
              onChange={() => onChange({ ...question, correctOption: oi })}
              title="Mark as correct answer"
            />
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(oi, e.target.value)}
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              placeholder={`Option ${oi + 1}`}
            />
            {question.options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(oi)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addOption}
        className="mt-1 text-xs text-neutral-500 hover:underline"
      >
        + Add option
      </button>
    </div>
  );
}
