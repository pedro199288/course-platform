import { createFileRoute, Link } from "@tanstack/react-router";
import { listPublishedCoursesFn } from "#/lib/storefront-actions.ts";
import { getStorefrontTestimonialsFn } from "#/lib/testimonial-actions.ts";

export const Route = createFileRoute("/courses/")({
  loader: async () => {
    const [data, testimonials] = await Promise.all([
      listPublishedCoursesFn(),
      getStorefrontTestimonialsFn().catch(() => []),
    ]);
    return { ...data, testimonials };
  },
  component: StorefrontPage,
});

function StorefrontPage() {
  const { tenant, courses, testimonials } = Route.useLoaderData();

  return (
    <main className="page-wrap px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{tenant.name}</h1>
        <p className="mt-2 text-neutral-500 dark:text-neutral-400">Browse our available courses</p>
      </div>

      {courses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No courses available yet. Check back soon!
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Link
              key={course.id}
              to="/courses/$courseSlug"
              params={{ courseSlug: course.slug }}
              className="group block overflow-hidden rounded-xl border border-neutral-200 bg-white no-underline transition hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
            >
              {course.thumbnailUrl ? (
                <div className="aspect-video w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                  <img
                    src={course.thumbnailUrl}
                    alt={course.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </div>
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-neutral-100 dark:bg-neutral-800">
                  <span className="text-3xl text-neutral-300 dark:text-neutral-600">
                    {course.title.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="p-4">
                <h2 className="text-lg font-semibold text-neutral-900 group-hover:text-neutral-700 dark:text-neutral-100 dark:group-hover:text-neutral-300">
                  {course.title}
                </h2>
                {course.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">
                    {course.description}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  {course.price ? (
                    <span className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
                      ${course.price}
                    </span>
                  ) : (
                    <span className="text-sm font-medium text-green-600 dark:text-green-400">
                      Free
                    </span>
                  )}
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    {course.pricingModel === "subscription"
                      ? "Subscription"
                      : course.pricingModel === "both"
                        ? "One-time / Subscription"
                        : "One-time purchase"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Testimonials */}
      {testimonials.length > 0 && (
        <div className="mt-16">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            What our students say
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
              >
                {t.rating != null && (
                  <div className="mb-3 text-amber-500">
                    {"★".repeat(t.rating)}
                    {"☆".repeat(5 - t.rating)}
                  </div>
                )}
                <p className="text-sm leading-relaxed text-neutral-600 whitespace-pre-wrap dark:text-neutral-400">
                  {t.body}
                </p>
                <p className="mt-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {t.authorName}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
