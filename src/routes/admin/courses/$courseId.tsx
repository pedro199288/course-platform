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

interface Module {
  id: string;
  courseId: string;
  title: string;
  position: number;
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
    return { course, modules: modulesWithLessons };
  },
  component: CourseDetailPage,
});

function CourseDetailPage() {
  const { course: initialCourse, modules: initialModules } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();

  const [title, setTitle] = useState(initialCourse.title);
  const [description, setDescription] = useState(initialCourse.description ?? "");
  const [slug, setSlug] = useState(initialCourse.slug);
  const [price, setPrice] = useState(initialCourse.price ?? "");
  const [pricingModel, setPricingModel] = useState(initialCourse.pricingModel);
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
          <label htmlFor="title" className="block text-sm font-medium">Title</label>
          <input id="title" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="slug" className="block text-sm font-medium">Slug</label>
          <input id="slug" type="text" required value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="description" className="block text-sm font-medium">Description</label>
          <textarea id="description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="price" className="block text-sm font-medium">Price</label>
            <input id="price" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pricingModel" className="block text-sm font-medium">Pricing model</label>
            <select id="pricingModel" value={pricingModel} onChange={(e) => setPricingModel(e.target.value as typeof pricingModel)} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
              <option value="one_time">One-time purchase</option>
              <option value="subscription">Subscription</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>

        <button type="submit" disabled={saving} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200">
          {saving ? "Saving..." : "Save changes"}
        </button>
      </form>

      {/* Modules and Lessons */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Curriculum</h2>
        <ModulesList courseId={initialCourse.id} initialModules={initialModules} />
      </div>
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
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [addingLesson, setAddingLesson] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    await updateModuleFn({ data: { moduleId: mod.id, title: title.trim() } });
    setEditing(false);
    void router.invalidate();
  }

  async function handleDelete() {
    if (!confirm("Delete this module and all its lessons?")) return;
    await deleteModuleFn({ data: { moduleId: mod.id } });
    void router.invalidate();
  }

  const [newLessonType, setNewLessonType] = useState<"text" | "quiz">("text");

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
          content: newLessonType === "quiz"
            ? { type: "quiz", questions: [] } as Record<string, unknown>
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
          <div className="flex flex-1 gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); if (e.key === "Escape") setEditing(false); }}
            />
            <button type="button" onClick={() => void handleSave()} className="text-xs text-neutral-600 hover:underline dark:text-neutral-400">Save</button>
            <button type="button" onClick={() => { setEditing(false); setTitle(mod.title); }} className="text-xs text-neutral-400 hover:underline">Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium hover:underline">
            {mod.title}
          </button>
        )}
        <button type="button" onClick={() => void handleDelete()} className="ml-2 text-xs text-red-500 hover:underline">Delete</button>
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
            onChange={(e) => setNewLessonType(e.target.value as "text" | "quiz")}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="text">Text</option>
            <option value="quiz">Quiz</option>
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
  const [content, setContent] = useState(
    lesson.content && typeof lesson.content === "object" && "text" in (lesson.content as Record<string, unknown>)
      ? String((lesson.content as Record<string, unknown>).text)
      : typeof lesson.content === "string" ? lesson.content : "",
  );

  // Quiz editing state
  const quizContent = isQuizContent(lesson.content) ? lesson.content : null;
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    quizContent?.questions ?? [],
  );

  async function handleSave() {
    if (lesson.type === "quiz") {
      await updateLessonFn({
        data: {
          lessonId: lesson.id,
          title: title.trim() || undefined,
          content: { type: "quiz", questions } as Record<string, unknown>,
        },
      });
    } else {
      await updateLessonFn({
        data: {
          lessonId: lesson.id,
          title: title.trim() || undefined,
          content: content ? { text: content } : undefined,
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
          <button type="button" onClick={() => void handleSave()} className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-neutral-400 hover:underline">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-400">{lesson.type}</span>
        <span className="text-sm">{lesson.title}</span>
        {lesson.type === "quiz" && quizContent && (
          <span className="text-xs text-neutral-400">
            ({quizContent.questions.length} question{quizContent.questions.length !== 1 ? "s" : ""})
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-neutral-500 hover:underline">Edit</button>
        <button type="button" onClick={() => void handleDelete()} className="text-xs text-red-500 hover:underline">Delete</button>
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
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-500 hover:underline"
        >
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
