import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { lessons } from "#/db/schema/index.ts";

/**
 * Bunny Stream webhook handler.
 *
 * Bunny sends a POST when a video's encoding status changes.
 * We use this to update the lesson's videoUploadStatus.
 *
 * Webhook payload shape (relevant fields):
 * {
 *   VideoGuid: string,
 *   VideoLibraryId: number,
 *   Status: number  // 0=created, 1=uploaded, 2=processing, 3=transcoding, 4=finished, 5=error, 6=upload_failed
 * }
 *
 * Security: Bunny does not sign webhooks. We verify the webhook secret
 * via a query parameter (?secret=...) that must match BUNNY_WEBHOOK_SECRET.
 */
export const Route = createFileRoute("/api/webhooks/bunny")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const webhookSecret = process.env.BUNNY_WEBHOOK_SECRET;
        if (!webhookSecret) {
          console.error("BUNNY_WEBHOOK_SECRET is not configured");
          return new Response("Webhook secret not configured", { status: 500 });
        }

        // Verify the secret from query parameter
        const url = new URL(request.url);
        const secret = url.searchParams.get("secret");
        if (secret !== webhookSecret) {
          return new Response("Invalid webhook secret", { status: 403 });
        }

        let payload: { VideoGuid?: string; Status?: number };
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const videoGuid = payload.VideoGuid;
        const bunnyStatus = payload.Status;

        if (!videoGuid || bunnyStatus === undefined) {
          return new Response("Missing VideoGuid or Status", { status: 400 });
        }

        const status = mapBunnyStatusToUploadStatus(bunnyStatus);

        // Update all lessons that reference this video ID
        await db
          .update(lessons)
          .set({ videoUploadStatus: status })
          .where(eq(lessons.videoProviderId, videoGuid));

        return new Response("ok", { status: 200 });
      },
    },
  },
});

function mapBunnyStatusToUploadStatus(
  bunnyStatus: number,
): "pending" | "uploading" | "processing" | "ready" | "failed" {
  switch (bunnyStatus) {
    case 0:
      return "pending";
    case 1:
      return "uploading";
    case 2:
    case 3:
      return "processing";
    case 4:
      return "ready";
    default:
      return "failed";
  }
}
