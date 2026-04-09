import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";
import { getStripe } from "#/lib/stripe.ts";

export const Route = createFileRoute("/api/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripe = getStripe();
        const body = await request.text();
        const signature = request.headers.get("stripe-signature");

        if (!signature) {
          return new Response("Missing stripe-signature header", { status: 400 });
        }

        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
          console.error("STRIPE_WEBHOOK_SECRET is not configured");
          return new Response("Webhook secret not configured", { status: 500 });
        }

        let event;
        try {
          event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        } catch (err) {
          console.error("Webhook signature verification failed:", err);
          return new Response("Invalid signature", { status: 400 });
        }

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

        return new Response("ok", { status: 200 });
      },
    },
  },
});
