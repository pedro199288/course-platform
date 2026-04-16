import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";

describe("white-label branding", () => {
  const subdomain = `wl-test-${Date.now()}`;
  let tenantId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Branding School", subdomain })
      .returning();
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain))
      .catch(() => {});
  });

  // ── Default values ───────────────────────────────────────────

  it("new tenant has null branding fields", async () => {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        logoUrl: true,
        faviconUrl: true,
        primaryColor: true,
        accentColor: true,
        brandName: true,
      },
    });

    expect(tenant).toBeTruthy();
    expect(tenant!.logoUrl).toBeNull();
    expect(tenant!.faviconUrl).toBeNull();
    expect(tenant!.primaryColor).toBeNull();
    expect(tenant!.accentColor).toBeNull();
    expect(tenant!.brandName).toBeNull();
  });

  // ── Brand name ──────────────────────────────────────────────

  it("sets and reads brand name", async () => {
    await db.update(tenants).set({ brandName: "Intecc Academy" }).where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { brandName: true },
    });

    expect(tenant!.brandName).toBe("Intecc Academy");
  });

  // ── Colors ──────────────────────────────────────────────────

  it("sets primary and accent colors", async () => {
    await db
      .update(tenants)
      .set({ primaryColor: "#1a2b3c", accentColor: "#ff6600" })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { primaryColor: true, accentColor: true },
    });

    expect(tenant!.primaryColor).toBe("#1a2b3c");
    expect(tenant!.accentColor).toBe("#ff6600");
  });

  // ── Image URLs ──────────────────────────────────────────────

  it("sets logo URL (S3 key)", async () => {
    const key = `tenants/${tenantId}/branding/logo.png`;
    await db.update(tenants).set({ logoUrl: key }).where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { logoUrl: true },
    });

    expect(tenant!.logoUrl).toBe(key);
  });

  it("sets favicon URL (S3 key)", async () => {
    const key = `tenants/${tenantId}/branding/favicon.ico`;
    await db.update(tenants).set({ faviconUrl: key }).where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { faviconUrl: true },
    });

    expect(tenant!.faviconUrl).toBe(key);
  });

  // ── Clear fields ────────────────────────────────────────────

  it("clears all branding fields by setting to null", async () => {
    await db
      .update(tenants)
      .set({
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        accentColor: null,
        brandName: null,
      })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        logoUrl: true,
        faviconUrl: true,
        primaryColor: true,
        accentColor: true,
        brandName: true,
      },
    });

    expect(tenant!.logoUrl).toBeNull();
    expect(tenant!.faviconUrl).toBeNull();
    expect(tenant!.primaryColor).toBeNull();
    expect(tenant!.accentColor).toBeNull();
    expect(tenant!.brandName).toBeNull();
  });

  // ── Branding coexists with other tenant fields ──────────────

  it("branding fields are independent of tracking and about fields", async () => {
    await db
      .update(tenants)
      .set({
        brandName: "My School",
        primaryColor: "#000000",
        gaTrackingId: "G-TESTBRAND",
      })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        brandName: true,
        primaryColor: true,
        gaTrackingId: true,
        aboutInstructor: true,
      },
    });

    expect(tenant!.brandName).toBe("My School");
    expect(tenant!.primaryColor).toBe("#000000");
    expect(tenant!.gaTrackingId).toBe("G-TESTBRAND");
    expect(tenant!.aboutInstructor).toBeNull();
  });

  it("updating branding does not affect other fields", async () => {
    // First set tracking
    await db
      .update(tenants)
      .set({ gaTrackingId: "G-KEEP123", brandName: "Keep" })
      .where(eq(tenants.id, tenantId));

    // Then update only branding color
    await db.update(tenants).set({ accentColor: "#aabbcc" }).where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        gaTrackingId: true,
        brandName: true,
        accentColor: true,
      },
    });

    expect(tenant!.gaTrackingId).toBe("G-KEEP123");
    expect(tenant!.brandName).toBe("Keep");
    expect(tenant!.accentColor).toBe("#aabbcc");
  });
});
