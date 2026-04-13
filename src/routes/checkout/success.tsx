import { createFileRoute, Link } from "@tanstack/react-router";
import { getCheckoutResultFn } from "#/lib/checkout-actions.ts";

export const Route = createFileRoute("/checkout/success")({
  validateSearch: (search: Record<string, unknown>) => ({
    session_id: (search.session_id as string) ?? "",
  }),
  loaderDeps: ({ search }) => ({ sessionId: search.session_id }),
  loader: async ({ deps }) => {
    if (!deps.sessionId) return { status: "pending" as const };
    return getCheckoutResultFn({ data: { sessionId: deps.sessionId } });
  },
  component: CheckoutSuccessPage,
});

function CheckoutSuccessPage() {
  const result = Route.useLoaderData();

  return (
    <main className="page-wrap flex items-center justify-center px-4 py-20">
      <div className="max-w-md text-center">
        {result.status === "complete" ? (
          <>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <svg
                className="h-8 w-8 text-green-600 dark:text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold">Purchase Complete!</h1>
            <p className="mt-2 text-neutral-600 dark:text-neutral-400">
              You're now enrolled in <span className="font-medium">{result.courseName}</span>.
            </p>
            {result.amount && (
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Charged ${result.amount} {result.currency?.toUpperCase()}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <Link
                to="/courses/$courseSlug"
                params={{ courseSlug: result.courseSlug }}
                className="rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white no-underline hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Go to course
              </Link>
              <Link
                to="/courses"
                className="text-sm text-neutral-500 no-underline hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
              >
                Browse more courses
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Processing your purchase...</h1>
            <p className="mt-2 text-neutral-600 dark:text-neutral-400">
              Your payment is being processed. You'll receive a confirmation email shortly.
            </p>
            <Link
              to="/courses"
              className="mt-6 inline-block text-sm text-neutral-500 no-underline hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
            >
              Back to courses
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
