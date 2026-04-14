import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { webhookEndpoints, webhookDeliveries } from "#/db/schema/index.ts";
import { registerHandler, sendJob } from "./job-queue.ts";
import type { WebhookEvent } from "./webhook-endpoint-actions.ts";

// ── Job constants ──────────────────────────────────────────────────

export const DELIVER_WEBHOOK_JOB = "deliver_webhook";

export interface DeliverWebhookJobData {
  deliveryId: string;
  endpointId: string;
}

// ── HMAC signing ───────────────────────────────────────────────────

export function signPayload(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// ── Handler registration ───────────────────────────────────────────

export function registerWebhookDeliveryHandler(): void {
  registerHandler<DeliverWebhookJobData>(DELIVER_WEBHOOK_JOB, async (data) => {
    await executeWebhookDelivery(data.deliveryId, data.endpointId);
  });
}

// ── Delivery execution ─────────────────────────────────────────────

async function executeWebhookDelivery(deliveryId: string, endpointId: string): Promise<void> {
  const [endpoint] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, endpointId));
  if (!endpoint || !endpoint.active) return;

  const [delivery] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!delivery) return;

  const body = JSON.stringify(delivery.payload);
  const signature = signPayload(body, endpoint.secret);
  const timestamp = Date.now().toString();

  let statusCode: number | null = null;
  let responseBody: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Event": delivery.event,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    statusCode = response.status;
    responseBody = await response.text().catch(() => null);

    await db
      .update(webhookDeliveries)
      .set({
        statusCode,
        responseBody: responseBody?.slice(0, 2000) ?? null,
        deliveredAt: response.ok ? new Date() : null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    // If not successful, throw to trigger PgBoss retry
    if (!response.ok) {
      throw new Error(`Webhook delivery failed with status ${response.status}`);
    }
  } catch (err) {
    // Update delivery with error info
    await db
      .update(webhookDeliveries)
      .set({
        statusCode,
        responseBody:
          responseBody?.slice(0, 2000) ?? (err instanceof Error ? err.message : "Unknown error"),
        attemptNumber: delivery.attemptNumber + 1,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    // Re-throw to let PgBoss handle retry with exponential backoff
    throw err;
  }
}

// ── Event dispatch ─────────────────────────────────────────────────

/**
 * Dispatch a webhook event to all active endpoints for a tenant that
 * subscribe to the given event type. Creates a delivery record and
 * enqueues a PgBoss job for each matching endpoint.
 */
export async function dispatchTenantWebhookEvent(
  tenantId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  // Find all active endpoints for this tenant that listen to this event
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.active, true)));

  const matchingEndpoints = endpoints.filter((ep) => {
    const events = ep.events as string[];
    return events.includes(event);
  });

  for (const endpoint of matchingEndpoints) {
    // Create delivery record
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        endpointId: endpoint.id,
        tenantId,
        event,
        payload: { event, data: payload, timestamp: new Date().toISOString() },
      })
      .returning();

    // Enqueue delivery job with retry
    await sendJob<DeliverWebhookJobData>(
      DELIVER_WEBHOOK_JOB,
      { deliveryId: delivery.id, endpointId: endpoint.id },
      { retryLimit: 3, retryBackoff: true },
    );
  }
}
