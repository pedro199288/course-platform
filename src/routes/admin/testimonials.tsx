import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  listTestimonialsFn,
  createTestimonialFn,
  updateTestimonialFn,
  deleteTestimonialFn,
  reorderTestimonialsFn,
} from "#/lib/testimonial-actions.ts";

interface Testimonial {
  id: string;
  tenantId: string;
  courseId: string | null;
  authorName: string;
  body: string;
  rating: number | null;
  position: number;
  createdAt: Date;
}

export const Route = createFileRoute("/admin/testimonials")({
  loader: () => listTestimonialsFn(),
  component: TestimonialsPage,
});

function TestimonialsPage() {
  const testimonials = Route.useLoaderData() as Testimonial[];
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleMoveUp(index: number) {
    if (index === 0) return;
    const ids = testimonials.map((t) => t.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    await reorderTestimonialsFn({ data: { orderedIds: ids } });
    void router.invalidate();
  }

  async function handleMoveDown(index: number) {
    if (index === testimonials.length - 1) return;
    const ids = testimonials.map((t) => t.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    await reorderTestimonialsFn({ data: { orderedIds: ids } });
    void router.invalidate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this testimonial?")) return;
    await deleteTestimonialFn({ data: { testimonialId: id } });
    void router.invalidate();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Testimonials</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Manage testimonials displayed on your storefront
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
          }}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {showForm ? "Cancel" : "Add testimonial"}
        </button>
      </div>

      {showForm && (
        <TestimonialForm
          onDone={() => {
            setShowForm(false);
            void router.invalidate();
          }}
        />
      )}

      {testimonials.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400">
            No testimonials yet. Add one to display on your storefront.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {testimonials.map((t, idx) => (
            <div key={t.id}>
              {editingId === t.id ? (
                <TestimonialForm
                  initial={t}
                  onDone={() => {
                    setEditingId(null);
                    void router.invalidate();
                  }}
                />
              ) : (
                <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.authorName}</span>
                        {t.rating != null && (
                          <span className="text-sm text-amber-500">
                            {"★".repeat(t.rating)}
                            {"☆".repeat(5 - t.rating)}
                          </span>
                        )}
                        {t.courseId && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                            course-specific
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-neutral-600 whitespace-pre-wrap dark:text-neutral-400">
                        {t.body}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleMoveUp(idx)}
                        disabled={idx === 0}
                        className="rounded p-1 text-neutral-400 hover:text-neutral-600 disabled:opacity-30 dark:hover:text-neutral-300"
                        title="Move up"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveDown(idx)}
                        disabled={idx === testimonials.length - 1}
                        className="rounded p-1 text-neutral-400 hover:text-neutral-600 disabled:opacity-30 dark:hover:text-neutral-300"
                        title="Move down"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(t.id);
                          setShowForm(false);
                        }}
                        className="rounded p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                        title="Edit"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(t.id)}
                        className="rounded p-1 text-red-400 hover:text-red-600 dark:hover:text-red-300"
                        title="Delete"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TestimonialForm({
  initial,
  onDone,
}: {
  initial?: Testimonial;
  onDone: () => void;
}) {
  const [authorName, setAuthorName] = useState(initial?.authorName ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [rating, setRating] = useState<string>(
    initial?.rating != null ? String(initial.rating) : "",
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authorName.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const ratingNum = rating ? parseInt(rating, 10) : null;
      if (initial) {
        await updateTestimonialFn({
          data: {
            testimonialId: initial.id,
            authorName: authorName.trim(),
            body: body.trim(),
            rating: ratingNum,
            courseId: initial.courseId,
          },
        });
      } else {
        await createTestimonialFn({
          data: {
            authorName: authorName.trim(),
            body: body.trim(),
            rating: ratingNum,
            courseId: null,
          },
        });
      }
      onDone();
    } catch (err: any) {
      alert(err.message ?? "Failed to save testimonial");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="authorName" className="block text-sm font-medium">
            Author name
          </label>
          <input
            id="authorName"
            type="text"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            required
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Jane Doe"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rating" className="block text-sm font-medium">
            Rating (optional)
          </label>
          <select
            id="rating"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">No rating</option>
            <option value="5">5 stars</option>
            <option value="4">4 stars</option>
            <option value="3">3 stars</option>
            <option value="2">2 stars</option>
            <option value="1">1 star</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="body" className="block text-sm font-medium">
          Testimonial
        </label>
        <textarea
          id="body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          placeholder="What the student said about the course..."
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {saving ? "Saving..." : initial ? "Update" : "Add testimonial"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
