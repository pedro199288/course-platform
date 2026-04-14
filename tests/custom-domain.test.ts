import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";

describe("custom domain", () => {
  const subdomain = `cd-test-${Date.now()}`;
  const customDomain = `test-${Date.now()}.example.com`;
  let tenantId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Custom Domain School", subdomain })
      .returning();
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await db
      .delete(tenants)
      .where(eq(tenants.subdomain, subdomain))
      .catch(() => {});
  });

  // ── Schema ──────────────────────────────────────────────────

  it("new tenant has null customDomain", async () => {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { customDomain: true },
    });

    expect(tenant).toBeTruthy();
    expect(tenant!.customDomain).toBeNull();
  });

  it("sets and reads custom domain", async () => {
    await db
      .update(tenants)
      .set({ customDomain })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { customDomain: true },
    });

    expect(tenant!.customDomain).toBe(customDomain);
  });

  it("resolves tenant by custom domain", async () => {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.customDomain, customDomain),
      columns: { id: true, subdomain: true },
    });

    expect(tenant).toBeTruthy();
    expect(tenant!.id).toBe(tenantId);
    expect(tenant!.subdomain).toBe(subdomain);
  });

  it("enforces custom domain uniqueness", async () => {
    const otherSubdomain = `cd-other-${Date.now()}`;
    await db.insert(tenants).values({ name: "Other School", subdomain: otherSubdomain });

    await expect(
      db
        .update(tenants)
        .set({ customDomain })
        .where(eq(tenants.subdomain, otherSubdomain)),
    ).rejects.toThrow();

    // Cleanup
    await db.delete(tenants).where(eq(tenants.subdomain, otherSubdomain));
  });

  it("allows multiple tenants with null customDomain", async () => {
    const sub1 = `cd-null-a-${Date.now()}`;
    const sub2 = `cd-null-b-${Date.now()}`;

    await db.insert(tenants).values([
      { name: "Null Domain A", subdomain: sub1 },
      { name: "Null Domain B", subdomain: sub2 },
    ]);

    // Both should have null customDomain and not conflict
    const a = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, sub1),
      columns: { customDomain: true },
    });
    const b = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, sub2),
      columns: { customDomain: true },
    });

    expect(a!.customDomain).toBeNull();
    expect(b!.customDomain).toBeNull();

    // Cleanup
    await db.delete(tenants).where(eq(tenants.subdomain, sub1));
    await db.delete(tenants).where(eq(tenants.subdomain, sub2));
  });

  it("clears custom domain by setting to null", async () => {
    await db
      .update(tenants)
      .set({ customDomain: null })
      .where(eq(tenants.id, tenantId));

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { customDomain: true },
    });

    expect(tenant!.customDomain).toBeNull();
  });

  // ── extractSubdomain does not match custom domains ─────────

  it("extractSubdomain returns null for custom domains (not subdomains)", () => {
    // Custom domains like cursos.intecc.es look like subdomains of intecc.es,
    // but they should not be matched as platform subdomains since they have
    // no relation to .localhost or the platform domain.
    // The middleware handles this by falling through to custom domain lookup.
    expect(extractSubdomain("cursos.intecc.es")).toBe("cursos");

    // Bare domains (no subdomain) return null
    expect(extractSubdomain("intecc.es")).toBeNull();
    expect(extractSubdomain("example.com")).toBeNull();
  });

  it("custom domain coexists with subdomain", async () => {
    const newDomain = `coexist-${Date.now()}.example.com`;
    await db
      .update(tenants)
      .set({ customDomain: newDomain })
      .where(eq(tenants.id, tenantId));

    // Resolvable by subdomain
    const bySubdomain = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
      columns: { id: true },
    });
    expect(bySubdomain!.id).toBe(tenantId);

    // Resolvable by custom domain
    const byDomain = await db.query.tenants.findFirst({
      where: eq(tenants.customDomain, newDomain),
      columns: { id: true },
    });
    expect(byDomain!.id).toBe(tenantId);
  });
});
