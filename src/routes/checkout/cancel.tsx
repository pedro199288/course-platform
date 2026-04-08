import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/checkout/cancel")({
  component: CheckoutCancelPage,
});

function CheckoutCancelPage() {
  return (
    <main className="page-wrap flex items-center justify-center px-4 py-20">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
          <svg
            className="h-8 w-8 text-neutral-400 dark:text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">Purchase Cancelled</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Your purchase was cancelled. No charges were made.
        </p>
        <Link
          to="/courses"
          className="mt-6 inline-block rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white no-underline hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Back to courses
        </Link>
      </div>
    </main>
  );
}
