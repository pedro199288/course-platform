import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { createStripeConnectLinkFn, getStripeConnectStatusFn } from "#/lib/stripe-connect.ts";

type StripeStatus = {
  connected: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  accountId: string | null;
};

export const Route = createFileRoute("/admin/onboarding")({
  component: OnboardingPage,
  validateSearch: (search: Record<string, unknown>): { stripe?: string } => ({
    stripe: (search.stripe as string) || undefined,
  }),
});

function OnboardingPage() {
  const { stripe: stripeParam } = Route.useSearch();
  const navigate = useNavigate();

  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connectingStripe, setConnectingStripe] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStripeStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const status = await getStripeConnectStatusFn();
      setStripeStatus(status);
    } catch {
      setError("Failed to fetch Stripe status.");
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void fetchStripeStatus();
  }, [fetchStripeStatus]);

  // Re-fetch status if returning from Stripe
  useEffect(() => {
    if (stripeParam === "return") {
      void fetchStripeStatus();
    }
  }, [stripeParam, fetchStripeStatus]);

  async function handleConnectStripe() {
    setConnectingStripe(true);
    setError(null);

    const result = await createStripeConnectLinkFn();

    if (result.error || !result.url) {
      setError(result.error || "Failed to create Stripe link.");
      setConnectingStripe(false);
      return;
    }

    window.location.href = result.url;
  }

  const schoolReady = true; // User arrived here, so school exists
  const stripeReady = stripeStatus?.detailsSubmitted && stripeStatus?.chargesEnabled;
  const allComplete = schoolReady && stripeReady;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">School setup</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Complete these steps to start selling courses
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {stripeParam === "return" && !stripeReady && !loadingStatus && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
          Stripe onboarding is not yet complete. Please finish all required steps in Stripe.
        </div>
      )}

      <div className="space-y-4">
        {/* Step 1: School created */}
        <OnboardingStep
          step={1}
          title="Create your school"
          description="Your school has been created successfully."
          complete={schoolReady}
        />

        {/* Step 2: Connect Stripe */}
        <OnboardingStep
          step={2}
          title="Connect Stripe"
          description={
            stripeReady
              ? "Stripe is connected and ready to accept payments."
              : stripeStatus?.connected && stripeStatus?.detailsSubmitted
                ? "Stripe details submitted. Waiting for charges to be enabled."
                : stripeStatus?.connected
                  ? "Stripe account created but onboarding is incomplete."
                  : "Connect your Stripe account to receive payments from students."
          }
          complete={!!stripeReady}
        >
          {!stripeReady && (
            <button
              type="button"
              onClick={() => void handleConnectStripe()}
              disabled={connectingStripe || loadingStatus}
              className="mt-3 rounded-md bg-[#635bff] px-4 py-2 text-sm font-medium text-white hover:bg-[#5249e6] disabled:opacity-50"
            >
              {connectingStripe
                ? "Redirecting to Stripe..."
                : stripeStatus?.connected
                  ? "Continue Stripe setup"
                  : "Connect with Stripe"}
            </button>
          )}
        </OnboardingStep>

        {/* Step 3: Ready */}
        <OnboardingStep
          step={3}
          title="Start creating courses"
          description={
            allComplete
              ? "You're all set! Head to the dashboard to create your first course."
              : "Complete the steps above to unlock course creation."
          }
          complete={!!allComplete}
        >
          {allComplete && (
            <button
              type="button"
              onClick={() => void navigate({ to: "/admin" })}
              className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Go to dashboard
            </button>
          )}
        </OnboardingStep>
      </div>
    </div>
  );
}

function OnboardingStep({
  step,
  title,
  description,
  complete,
  children,
}: {
  step: number;
  title: string;
  description: string;
  complete: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start gap-4">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            complete
              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          }`}
        >
          {complete ? "\u2713" : step}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
