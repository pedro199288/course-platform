import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createCourseFn } from "#/lib/course-actions.ts";

export const Route = createFileRoute("/admin/courses/new")({
  component: NewCoursePage,
});

function NewCoursePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [price, setPrice] = useState("");
  const [pricingModel, setPricingModel] = useState<"one_time" | "subscription" | "both">("one_time");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleTitleChange(value: string) {
    setTitle(value);
    // Auto-generate slug from title
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const course = await createCourseFn({
        data: {
          title,
          description: description || undefined,
          slug,
          price: price || undefined,
          pricingModel,
        },
      });
      void navigate({ to: "/admin/courses/$courseId", params: { courseId: course.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create course");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create course</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Set up your new course details
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
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
            onChange={(e) => handleTitleChange(e.target.value)}
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

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {saving ? "Creating..." : "Create course"}
          </button>
          <button
            type="button"
            onClick={() => void navigate({ to: "/admin/courses" })}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
