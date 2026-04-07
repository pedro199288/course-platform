import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";

describe("tenant resolution (integration)", () => {
  const testSubdomain = `test-${Date.now()}`;

  beforeAll(async () => {
    await db.insert(tenants).values({
      name: "Test School",
      subdomain: testSubdomain,
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.subdomain, testSubdomain));
  });

  it("resolves an existing tenant by subdomain", async () => {
    const result = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, testSubdomain),
    });

    expect(result).toBeDefined();
    expect(result!.name).toBe("Test School");
    expect(result!.subdomain).toBe(testSubdomain);
    expect(result!.status).toBe("active");
  });

  it("returns undefined for a non-existent subdomain", async () => {
    const result = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, "nonexistent-school-xyz"),
    });

    expect(result).toBeUndefined();
  });

  it("enforces subdomain uniqueness", async () => {
    await expect(
      db.insert(tenants).values({
        name: "Duplicate School",
        subdomain: testSubdomain,
      }),
    ).rejects.toThrow();
  });
});
