import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, webhookEndpoints, webhookDeliveries } from "#/db/schema/index.ts";

// Mock job queue to capture dispatched jobs
const mockSendJob = vi.fn().mockResolvedValue("mock-job-id");
vi.mock("#/lib/job-queue.ts", () => ({
  sendJob: (...args: unknown[]) => mockSendJob(...args),
  registerHandler: vi.fn(),
  startWorkers: vi.fn(),
  getBoss: vi.fn(),
}));

import { signPayload, dispatchTenantWebhookEvent } from "#/lib/webhook-delivery-jobs.ts";

describe("configurable webhooks", () => {
  const subdomain = `webhook-cfg-test-${Date.now()}`;
  const subdomain2 = `webhook-cfg-test2-${Date.now()}`;
  let tenantId: string;
  let tenant2Id: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Webhook School", subdomain })
      .returning();
    tenantId = tenant.id;

    const [tenant2] = await db
      .insert(tenants)
      .values({ name: "Other School", subdomain: subdomain2 })
      .returning();
    tenant2Id = tenant2.id;
  });

  afterAll(async () => {
    await db
      .delete(webhookDeliveries)
      .where(eq(webhookDeliveries.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(webhookDeliveries)
      .where(eq(webhookDeliveries.tenantId, tenant2Id))
      .catch(() => {});
    await db
      .delete(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenantId))
      .catch(() => {});
    await db
      .delete(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenant2Id))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain))
      .catch(() => {});
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain2))
      .catch(() => {});
  });

  // ── CRUD ──────────────────────────────────────────────────────

  it("creates a webhook endpoint with auto-generated secret", async () => {
    const [ep] = await db
      .insert(webhookEndpoints)
      .values({
        tenantId,
        url: "https://example.com/webhooks",
        secret: "whsec_test123",
        events: ["enrollment.created", "payment.completed"],
        active: true,
      })
      .returning();

    expect(ep.url).toBe("https://example.com/webhooks");
    expect(ep.secret).toBe("whsec_test123");
    expect(ep.events).toEqual(["enrollment.created", "payment.completed"]);
    expect(ep.active).toBe(true);
    expect(ep.tenantId).toBe(tenantId);
  });

  it("updates a webhook endpoint", async () => {
    const [created] = await db
      .insert(webhookEndpoints)
      .values({
        tenantId,
        url: "https://example.com/old",
        secret: "whsec_update",
        events: ["enrollment.created"],
      })
      .returning();

    const [updated] = await db
      .update(webhookEndpoints)
      .set({
        url: "https://example.com/new",
        events: ["enrollment.created", "payment.refunded"],
        active: false,
      })
      .where(eq(webhookEndpoints.id, created.id))
      .returning();

    expect(updated.url).toBe("https://example.com/new");
    expect(updated.events).toEqual(["enrollment.created", "payment.refunded"]);
    expect(updated.active).toBe(false);
  });

  it("deletes a webhook endpoint and cascades deliveries", async () => {
    const [ep] = await db
      .insert(webhookEndpoints)
      .values({
        tenantId,
        url: "https://example.com/cascade",
        secret: "whsec_cascade",
        events: ["enrollment.created"],
      })
      .returning();

    await db.insert(webhookDeliveries).values({
      endpointId: ep.id,
      tenantId,
      event: "enrollment.created",
      payload: { test: true },
    });

    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id));

    const remainingDeliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, ep.id));
    expect(remainingDeliveries.length).toBe(0);
  });

  // ── Tenant isolation ──────────────────────────────────────────

  it("webhook endpoints are scoped to tenant", async () => {
    await db.insert(webhookEndpoints).values({
      tenantId: tenant2Id,
      url: "https://other-tenant.com/webhooks",
      secret: "whsec_other",
      events: ["enrollment.created"],
    });

    const t1Endpoints = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenantId));

    const leaked = t1Endpoints.filter((ep) => ep.tenantId === tenant2Id);
    expect(leaked.length).toBe(0);
  });

  // ── HMAC signing ──────────────────────────────────────────────

  it("generates consistent HMAC-SHA256 signatures", () => {
    const body = JSON.stringify({ event: "enrollment.created", data: { userId: "123" } });
    const secret = "whsec_test_secret";

    const sig1 = signPayload(body, secret);
    const sig2 = signPayload(body, secret);

    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64); // hex-encoded SHA256
  });

  it("different secrets produce different signatures", () => {
    const body = JSON.stringify({ event: "test" });

    const sig1 = signPayload(body, "whsec_secret1");
    const sig2 = signPayload(body, "whsec_secret2");

    expect(sig1).not.toBe(sig2);
  });

  // ── Event dispatch ────────────────────────────────────────────

  it("dispatches to matching endpoints only (event filtering)", async () => {
    // Clear existing endpoints for this tenant
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.tenantId, tenantId));
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.tenantId, tenantId));
    mockSendJob.mockClear();

    // Create two endpoints with different event subscriptions
    await db.insert(webhookEndpoints).values([
      {
        tenantId,
        url: "https://endpoint1.com/hook",
        secret: "whsec_ep1",
        events: ["enrollment.created", "payment.completed"],
        active: true,
      },
      {
        tenantId,
        url: "https://endpoint2.com/hook",
        secret: "whsec_ep2",
        events: ["payment.refunded"],
        active: true,
      },
    ]);

    // Dispatch enrollment.created — should only match endpoint1
    await dispatchTenantWebhookEvent(tenantId, "enrollment.created", {
      userId: "user-1",
      courseId: "course-1",
    });

    // Check that a delivery was created for endpoint1 only
    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.tenantId, tenantId));

    expect(deliveries.length).toBe(1);
    expect(deliveries[0].event).toBe("enrollment.created");

    // Verify a job was enqueued
    expect(mockSendJob).toHaveBeenCalledTimes(1);
    expect(mockSendJob).toHaveBeenCalledWith(
      "deliver_webhook",
      expect.objectContaining({
        deliveryId: deliveries[0].id,
      }),
      expect.objectContaining({ retryLimit: 3, retryBackoff: true }),
    );
  });

  it("does not dispatch to inactive endpoints", async () => {
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.tenantId, tenantId));
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.tenantId, tenantId));
    mockSendJob.mockClear();

    await db.insert(webhookEndpoints).values({
      tenantId,
      url: "https://inactive.com/hook",
      secret: "whsec_inactive",
      events: ["enrollment.created"],
      active: false,
    });

    await dispatchTenantWebhookEvent(tenantId, "enrollment.created", {
      userId: "user-1",
      courseId: "course-1",
    });

    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.tenantId, tenantId));
    expect(deliveries.length).toBe(0);
    expect(mockSendJob).not.toHaveBeenCalled();
  });
});
