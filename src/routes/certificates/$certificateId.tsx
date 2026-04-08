import { createFileRoute, Link } from "@tanstack/react-router";
import { getCertificateFn } from "#/lib/certificate-actions.ts";

export const Route = createFileRoute("/certificates/$certificateId")({
  loader: async ({ params }) => {
    return getCertificateFn({ data: { certificateId: params.certificateId } });
  },
  component: CertificateView,
  errorComponent: CertificateError,
});

function CertificateView() {
  const cert = Route.useLoaderData();
  const generatedDate = new Date(cert.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 dark:bg-neutral-950">
      {/* Print button — hidden when printing */}
      <div className="mx-auto mb-6 max-w-3xl print:hidden">
        <div className="flex items-center justify-between">
          <Link
            to="/dashboard"
            className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            &larr; Back to dashboard
          </Link>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Certificate card */}
      <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border-2 border-neutral-300 bg-white shadow-lg print:border-neutral-400 print:shadow-none dark:border-neutral-700 dark:bg-neutral-900">
        <div className="px-12 py-16 text-center">
          {/* Header ornament */}
          <div className="mb-8 text-neutral-400 dark:text-neutral-500">
            <svg
              viewBox="0 0 24 24"
              className="mx-auto h-12 w-12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
            </svg>
          </div>

          <p className="text-sm uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
            Certificate of Completion
          </p>

          <h1 className="mt-6 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-100">
            {cert.studentName}
          </h1>

          <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-400">
            has successfully completed
          </p>

          <h2 className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {cert.courseTitle}
          </h2>

          <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
            Issued by <span className="font-medium">{cert.schoolName}</span> on{" "}
            {generatedDate}
          </p>

          {/* Divider */}
          <div className="mx-auto mt-8 h-px w-48 bg-neutral-300 dark:bg-neutral-700" />

          <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
            Certificate ID: {cert.id}
          </p>
        </div>
      </div>
    </main>
  );
}

function CertificateError() {
  return (
    <main className="page-wrap px-4 py-10">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-xl font-bold">Certificate not found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          This certificate does not exist or you don't have access to view it.
        </p>
        <Link
          to="/dashboard"
          className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
