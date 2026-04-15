import crypto from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { webhookEndpoints, webhookDeliveries } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { WEBHOOK_EVENTS, type WebhookEvent } from "./webhook-events.ts";
import { tenantIdStore } from "./tenant-context.ts";

export { WEBHOOK_EVENTS, type WebhookEvent };

// ── Admin helpers ──────────────────────────────────────────────────

async function requireAdmin() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as { id: string; role: string };
  if (!["platform_admin", "tenant_owner", "tenant_admin"].includes(user.role)) {
    throw new Error("Forbidden");
  }
  const tenantId = tenantIdStore.getStore()!;
  return { ...user, tenantId };
}

// ── CRUD ───────────────────────────────────────────────────────────

export const listWebhookEndpointsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  return db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, user.tenantId))
    .orderBy(desc(webhookEndpoints.createdAt));
});

export const createWebhookEndpointFn = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string; events: string[] }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();

    // Validate URL
    try {
      const parsed = new URL(data.url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("URL must use HTTP or HTTPS");
      }
    } catch {
      throw new Error("Invalid URL");
    }

    // Validate events
    for (const event of data.events) {
      if (!WEBHOOK_EVENTS.includes(event as WebhookEvent)) {
        throw new Error(`Invalid event: ${event}`);
      }
    }
    if (data.events.length === 0) {
      throw new Error("At least one event must be selected");
    }

    // Generate HMAC secret
    const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;

    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        tenantId: user.tenantId,
        url: data.url,
        secret,
        events: data.events,
      })
      .returning();

    return endpoint;
  });

export const updateWebhookEndpointFn = createServerFn({ method: "POST" })
  .inputValidator((d: { endpointId: string; url: string; events: string[]; active: boolean }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();

    // Validate URL
    try {
      const parsed = new URL(data.url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("URL must use HTTP or HTTPS");
      }
    } catch {
      throw new Error("Invalid URL");
    }

    // Validate events
    for (const event of data.events) {
      if (!WEBHOOK_EVENTS.includes(event as WebhookEvent)) {
        throw new Error(`Invalid event: ${event}`);
      }
    }

    const [updated] = await db
      .update(webhookEndpoints)
      .set({
        url: data.url,
        events: data.events,
        active: data.active,
      })
      .where(
        and(eq(webhookEndpoints.id, data.endpointId), eq(webhookEndpoints.tenantId, user.tenantId)),
      )
      .returning();
    if (!updated) throw new Error("Endpoint not found");
    return updated;
  });

export const deleteWebhookEndpointFn = createServerFn({ method: "POST" })
  .inputValidator((d: { endpointId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [deleted] = await db
      .delete(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.id, data.endpointId), eq(webhookEndpoints.tenantId, user.tenantId)),
      )
      .returning();
    if (!deleted) throw new Error("Endpoint not found");
    return deleted;
  });

export const toggleWebhookEndpointFn = createServerFn({ method: "POST" })
  .inputValidator((d: { endpointId: string; active: boolean }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const [updated] = await db
      .update(webhookEndpoints)
      .set({ active: data.active })
      .where(
        and(eq(webhookEndpoints.id, data.endpointId), eq(webhookEndpoints.tenantId, user.tenantId)),
      )
      .returning();
    if (!updated) throw new Error("Endpoint not found");
    return updated;
  });

// ── Delivery log ───────────────────────────────────────────────────

export const listWebhookDeliveriesFn = createServerFn({ method: "GET" })
  .inputValidator((d: { endpointId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();

    // Verify endpoint belongs to tenant
    const [endpoint] = await db
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.id, data.endpointId), eq(webhookEndpoints.tenantId, user.tenantId)),
      );
    if (!endpoint) throw new Error("Endpoint not found");

    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, data.endpointId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);

    // Map to JSON-serializable format for TanStack server fns
    return rows.map((r) => ({
      ...r,
      payload: r.payload as Record<string, string>,
    }));
  });
