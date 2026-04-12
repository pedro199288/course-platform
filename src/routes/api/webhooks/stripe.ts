import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";
import { getStripe } from "#/lib/stripe.ts";
import { dispatchWebhookEvent } from "#/lib/webhook-actions.ts";

export const Route = createFileRoute("/api/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const stripe = getStripe();
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
          return new Response("Webhook secret not configured", { status: 500 });
        }

        const body = await request.text();
        const signature = request.headers.get("stripe-signature");
        if (!signature) {
          return new Response("Missing stripe-signature header", { status: 400 });
        }

        let event;
        try {
          event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown verification error";
          return new Response(`Webhook signature verification failed: ${message}`, {
            status: 400,
          });
        }

        // Handle account.updated for Stripe Connect onboarding
        if (event.type === "account.updated") {
          const account = event.data.object;
          const accountId = account.id;
          const detailsSubmitted = account.details_submitted ?? false;

          await db
            .update(tenants)
            .set({
              stripeOnboardingComplete: detailsSubmitted ? "true" : "false",
            })
            .where(eq(tenants.stripeConnectAccountId, accountId));
        }

        // Dispatch to background job queue for async processing
        await dispatchWebhookEvent(event.type, event.data.object as unknown as Record<string, unknown>);

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
