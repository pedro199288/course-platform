import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";
import type { RichTextDoc } from "#/lib/rich-text/types.ts";

describe("tenant settings (tracking + about)", () => {
  const subdomain = `settings-test-${Date.now()}`;
  let tenantId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Settings School", subdomain })
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

  it("new tenant has null tracking IDs and about section", async () => {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        gaTrackingId: true,
        fbPixelId: true,
        aboutInstructor: true,
      },
    });

    expect(tenant).toBeTruthy();
    expect(tenant!.gaTrackingId).toBeNull();
    expect(tenant!.fbPixelId).toBeNull();
    expect(tenant!.aboutInstructor).toBeNull();
  });

  // ── Tracking IDs ─────────────────────────────────────────────

  it("sets Google Analytics tracking ID", async () => {
    await db
      .update(tenants)
      .set({ gaTrackingId: "G-ABC123DEF" })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { gaTrackingId: true },
    });

    expect(tenant!.gaTrackingId).toBe("G-ABC123DEF");
  });

  it("sets Facebook Pixel ID", async () => {
    await db
      .update(tenants)
      .set({ fbPixelId: "1234567890" })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { fbPixelId: true },
    });

    expect(tenant!.fbPixelId).toBe("1234567890");
  });

  it("clears tracking IDs by setting to null", async () => {
    await db
      .update(tenants)
      .set({ gaTrackingId: null, fbPixelId: null })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { gaTrackingId: true, fbPixelId: true },
    });

    expect(tenant!.gaTrackingId).toBeNull();
    expect(tenant!.fbPixelId).toBeNull();
  });

  // ── About Instructor ─────────────────────────────────────────

  it("sets about instructor as rich text JSON", async () => {
    const richText: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "I am an experienced instructor." }],
        },
      ],
    };

    await db
      .update(tenants)
      .set({ aboutInstructor: richText })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { aboutInstructor: true },
    });

    expect(tenant!.aboutInstructor).toEqual(richText);
  });

  it("stores complex rich text with formatting", async () => {
    const richText: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "My Background" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "I have " },
            { type: "text", marks: [{ type: "bold" }], text: "10 years" },
            { type: "text", text: " of experience." },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "PhD in Computer Science" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Published author" }],
                },
              ],
            },
          ],
        },
      ],
    };

    await db
      .update(tenants)
      .set({ aboutInstructor: richText })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { aboutInstructor: true },
    });

    expect(tenant!.aboutInstructor).toEqual(richText);
  });

  it("clears about instructor by setting to null", async () => {
    await db
      .update(tenants)
      .set({ aboutInstructor: null })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { aboutInstructor: true },
    });

    expect(tenant!.aboutInstructor).toBeNull();
  });

  // ── Both fields together ──────────────────────────────────────

  it("updates tracking IDs and about section independently", async () => {
    await db
      .update(tenants)
      .set({ gaTrackingId: "G-TRACK123" })
      .where(eq(tenants.id, tenantId));

    const aboutContent: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Bio text" }],
        },
      ],
    };

    await db
      .update(tenants)
      .set({ aboutInstructor: aboutContent })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        gaTrackingId: true,
        fbPixelId: true,
        aboutInstructor: true,
      },
    });

    expect(tenant!.gaTrackingId).toBe("G-TRACK123");
    expect(tenant!.fbPixelId).toBeNull();
    expect(tenant!.aboutInstructor).toEqual(aboutContent);
  });
});
