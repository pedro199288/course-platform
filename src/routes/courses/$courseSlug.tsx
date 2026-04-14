import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getCourseBySlugFn } from "#/lib/storefront-actions.ts";
import { TrackingScripts } from "#/components/TrackingScripts.tsx";
import { StorefrontBranding } from "#/components/StorefrontBranding.tsx";
import { getSessionFn } from "#/lib/auth-session.ts";
import {
  createCheckoutSessionFn,
  createSubscriptionCheckoutFn,
  getSubscriptionStatusFn,
} from "#/lib/checkout-actions.ts";
import { validatePromotionCodeFn } from "#/lib/coupon-actions.ts";
import { checkEnrollmentFn } from "#/lib/lesson-actions.ts";
import { getCourseAnnouncementsFn } from "#/lib/announcement-actions.ts";
import { getCourseTestimonialsFn } from "#/lib/testimonial-actions.ts";

export const Route = createFileRoute("/courses/$courseSlug")({
  loader: async ({ params }) => {
    const [data, session] = await Promise.all([
      getCourseBySlugFn({ data: { slug: params.courseSlug } }),
      getSessionFn().catch(() => null),
    ]);
    const [enrollment, subscriptionStatus] = session
      ? await Promise.all([
          checkEnrollmentFn({ data: { courseSlug: params.courseSlug } }).catch(() => ({
            enrolled: false,
          })),
          getSubscriptionStatusFn().catch(() => ({ hasSubscription: false as const })),
        ])
      : [{ enrolled: false }, { hasSubscription: false as const }];
    const hasAccess =
      enrollment.enrolled ||
      (subscriptionStatus.hasSubscription &&
        "status" in subscriptionStatus &&
        subscriptionStatus.status === "active");
    const [courseAnnouncements, courseTestimonials] = await Promise.all([
      hasAccess
        ? getCourseAnnouncementsFn({ data: { courseSlug: params.courseSlug } }).catch(() => [])
        : Promise.resolve([]),
      getCourseTestimonialsFn({ data: { courseId: data.course.id } }).catch(() => []),
    ]);
    return {
      ...data,
      session,
      enrolled: enrollment.enrolled,
      subscriptionStatus,
      courseAnnouncements,
      courseTestimonials,
    };
  },
  component: CourseDetailPage,
});

function CourseDetailPage() {
  const {
    tenant,
    course,
    curriculum,
    session,
    enrolled,
    subscriptionStatus,
    courseAnnouncements,
    courseTestimonials,
  } = Route.useLoaderData();
  const hasActiveSubscription =
    subscriptionStatus.hasSubscription &&
    "status" in subscriptionStatus &&
    subscriptionStatus.status === "active";
  const hasAccess = enrolled || hasActiveSubscription;
  const totalLessons = curriculum.reduce((sum, mod) => sum + mod.lessons.length, 0);

  return (
    <main className="page-wrap px-4 py-10">
      <TrackingScripts gaTrackingId={tenant.gaTrackingId} fbPixelId={tenant.fbPixelId} />
      <StorefrontBranding
        primaryColor={tenant.primaryColor}
        accentColor={tenant.accentColor}
        faviconUrl={tenant.faviconUrl}
        hidesPlatformBranding={!!(tenant.logoUrl || tenant.brandName || tenant.primaryColor)}
      />
      <div className="mb-6">
        <Link
          to="/courses"
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
        >
          &larr; Back to courses
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Course info */}
        <div className="lg:col-span-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{course.title}</h1>

          <div className="mt-2 flex items-center gap-3 text-sm text-neutral-500 dark:text-neutral-400">
            <span>{tenant.brandName ?? tenant.name}</span>
            <span>&middot;</span>
            <span>
              {curriculum.length} {curriculum.length === 1 ? "module" : "modules"}
            </span>
            <span>&middot;</span>
            <span>
              {totalLessons} {totalLessons === 1 ? "lesson" : "lessons"}
            </span>
          </div>

          {course.description && (
            <p className="mt-6 text-neutral-700 leading-relaxed dark:text-neutral-300">
              {course.description}
            </p>
          )}

          {/* Curriculum outline */}
          <div className="mt-8">
            <h2 className="text-xl font-semibold">Curriculum</h2>
            {curriculum.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                Curriculum coming soon.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {curriculum.map((mod, modIdx) => (
                  <div
                    key={mod.id}
                    className="rounded-lg border border-neutral-200 dark:border-neutral-800"
                  >
                    <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                        {modIdx + 1}
                      </span>
                      <h3 className="font-medium">{mod.title}</h3>
                      <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">
                        {mod.lessons.length} {mod.lessons.length === 1 ? "lesson" : "lessons"}
                      </span>
                    </div>
                    {mod.lessons.length > 0 && (
                      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {mod.lessons.map((lesson) => (
                          <li
                            key={lesson.id}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm"
                          >
                            <LessonIcon type={lesson.type} />
                            {hasAccess ? (
                              <Link
                                to="/courses/$courseSlug/lessons/$lessonId"
                                params={{
                                  courseSlug: course.slug,
                                  lessonId: lesson.id,
                                }}
                                className="text-neutral-700 hover:text-neutral-900 hover:underline dark:text-neutral-300 dark:hover:text-neutral-100"
                              >
                                {lesson.title}
                              </Link>
                            ) : (
                              <span className="text-neutral-700 dark:text-neutral-300">
                                {lesson.title}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Announcements (enrolled students only) */}
          {courseAnnouncements.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-semibold">Announcements</h2>
              <div className="mt-4 space-y-4">
                {courseAnnouncements.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{a.title}</h3>
                      <span className="text-xs text-neutral-400 dark:text-neutral-500">
                        {new Date(a.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-neutral-600 whitespace-pre-wrap dark:text-neutral-400">
                      {a.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Testimonials */}
          {courseTestimonials.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-semibold">What students say</h2>
              <div className="mt-4 space-y-4">
                {courseTestimonials.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.authorName}</span>
                      {t.rating != null && (
                        <span className="text-sm text-amber-500">
                          {"★".repeat(t.rating)}
                          {"☆".repeat(5 - t.rating)}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-neutral-600 whitespace-pre-wrap dark:text-neutral-400">
                      {t.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: pricing + CTA */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            {course.thumbnailUrl ? (
              <img
                src={course.thumbnailUrl}
                alt={course.title}
                className="mb-4 w-full rounded-lg object-cover"
              />
            ) : (
              <div className="mb-4 flex aspect-video w-full items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <span className="text-4xl text-neutral-300 dark:text-neutral-600">
                  {course.title.charAt(0).toUpperCase()}
                </span>
              </div>
            )}

            <div className="mb-4">
              {course.price ? (
                <div className="text-3xl font-bold">${course.price}</div>
              ) : (
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">Free</div>
              )}
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {course.pricingModel === "subscription"
                  ? "Monthly subscription"
                  : course.pricingModel === "both"
                    ? "One-time purchase or subscription"
                    : "One-time purchase"}
              </p>
              {(course.pricingModel === "subscription" || course.pricingModel === "both") &&
                tenant.subscriptionPrice && (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    ${tenant.subscriptionPrice}/mo for all courses
                  </p>
                )}
            </div>

            {hasAccess ? (
              <Link
                to="/courses/$courseSlug/lessons/$lessonId"
                params={{
                  courseSlug: course.slug,
                  lessonId: curriculum[0]?.lessons[0]?.id ?? "",
                }}
                className="block w-full rounded-md bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white no-underline hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Start learning
              </Link>
            ) : session ? (
              <CheckoutSection
                courseId={course.id}
                pricingModel={course.pricingModel}
                hasPrice={!!course.price}
                subscriptionPrice={tenant.subscriptionPrice}
              />
            ) : (
              <Link
                to="/login"
                className="block w-full rounded-md bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white no-underline hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Sign in to {course.price ? "purchase" : "enroll"}
              </Link>
            )}

            <div className="mt-4 space-y-2 text-xs text-neutral-500 dark:text-neutral-400">
              <div className="flex justify-between">
                <span>Modules</span>
                <span>{curriculum.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Lessons</span>
                <span>{totalLessons}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function CheckoutSection({
  courseId,
  pricingModel,
  hasPrice,
  subscriptionPrice,
}: {
  courseId: string;
  pricingModel: string;
  hasPrice: boolean;
  subscriptionPrice: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponOpen, setCouponOpen] = useState(false);
  const [validating, setValidating] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{
    id: string;
    discount: string;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    setValidating(true);
    setCouponError(null);
    try {
      const result = await validatePromotionCodeFn({
        data: { code: couponCode.trim(), courseId },
      });
      if (result.valid) {
        setAppliedPromo({ id: result.promotionCodeId, discount: result.discount });
        setCouponError(null);
      } else {
        setAppliedPromo(null);
        setCouponError(result.error);
      }
    } catch (e: any) {
      setCouponError(e.message ?? "Failed to validate coupon");
      setAppliedPromo(null);
    } finally {
      setValidating(false);
    }
  }

  function handleRemoveCoupon() {
    setAppliedPromo(null);
    setCouponCode("");
    setCouponError(null);
  }

  async function handleBuy() {
    setLoading(true);
    setError(null);
    try {
      const result = await createCheckoutSessionFn({
        data: {
          courseId,
          promotionCodeId: appliedPromo?.id,
        },
      });
      if (result.url) window.location.href = result.url;
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
      setLoading(false);
    }
  }

  async function handleSubscribe() {
    setLoading(true);
    setError(null);
    try {
      const result = await createSubscriptionCheckoutFn({
        data: { promotionCodeId: appliedPromo?.id },
      });
      if (result.url) window.location.href = result.url;
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Coupon input */}
      {hasPrice && (
        <div>
          {!couponOpen && !appliedPromo ? (
            <button
              type="button"
              onClick={() => setCouponOpen(true)}
              className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
            >
              Have a coupon?
            </button>
          ) : appliedPromo ? (
            <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-900/20">
              <div className="text-sm">
                <span className="font-mono font-medium">{couponCode}</span>
                <span className="ml-2 text-green-700 dark:text-green-400">
                  {appliedPromo.discount}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRemoveCoupon}
                className="text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Enter code"
                  className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm uppercase outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleApplyCoupon();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleApplyCoupon()}
                  disabled={validating || !couponCode.trim()}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {validating ? "..." : "Apply"}
                </button>
              </div>
              {couponError && (
                <p className="text-xs text-red-600 dark:text-red-400">{couponError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Purchase buttons */}
      {(pricingModel === "one_time" || pricingModel === "both") && (
        <button
          type="button"
          onClick={() => void handleBuy()}
          disabled={loading}
          className="w-full rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {loading ? "Redirecting..." : hasPrice ? "Buy now" : "Enroll for free"}
        </button>
      )}
      {(pricingModel === "subscription" || pricingModel === "both") && subscriptionPrice && (
        <button
          type="button"
          onClick={() => void handleSubscribe()}
          disabled={loading}
          className="w-full rounded-md border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {loading ? "Redirecting..." : `Subscribe — $${subscriptionPrice}/mo`}
        </button>
      )}

      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function LessonIcon({ type }: { type: string }) {
  const className = "h-4 w-4 flex-shrink-0 text-neutral-400 dark:text-neutral-500";
  switch (type) {
    case "video":
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
          />
        </svg>
      );
    case "quiz":
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
          />
        </svg>
      );
    case "file":
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          />
        </svg>
      );
    default:
      // text
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          />
        </svg>
      );
  }
}
