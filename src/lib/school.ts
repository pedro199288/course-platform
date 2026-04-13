import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";

const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "mail",
  "ftp",
  "blog",
  "shop",
  "store",
  "help",
  "support",
  "status",
  "docs",
  "cdn",
  "assets",
  "static",
  "media",
]);

export const checkSubdomainFn = createServerFn({ method: "GET" })
  .inputValidator((input: { subdomain: string }) => input)
  .handler(async ({ data }) => {
    const subdomain = data.subdomain.toLowerCase().trim();

    if (!SUBDOMAIN_REGEX.test(subdomain)) {
      return {
        available: false as const,
        reason: "Invalid subdomain format. Use lowercase letters, numbers, and hyphens.",
      };
    }

    if (subdomain.length < 3) {
      return { available: false as const, reason: "Subdomain must be at least 3 characters." };
    }

    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      return { available: false as const, reason: "This subdomain is reserved." };
    }

    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
      columns: { id: true },
    });

    if (existing) {
      return { available: false as const, reason: "This subdomain is already taken." };
    }

    return { available: true as const, reason: null };
  });

export const createSchoolFn = createServerFn({ method: "POST" })
  .inputValidator((input: { name: string; subdomain: string }) => input)
  .handler(async ({ data }) => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return { error: "You must be logged in to create a school." };
    }

    const name = data.name.trim();
    const subdomain = data.subdomain.toLowerCase().trim();

    if (!name || name.length < 2) {
      return { error: "School name must be at least 2 characters." };
    }

    if (!SUBDOMAIN_REGEX.test(subdomain) || subdomain.length < 3) {
      return { error: "Invalid subdomain." };
    }

    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      return { error: "This subdomain is reserved." };
    }

    const userRecord = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { role: true },
    });

    if (userRecord?.role === "tenant_owner") {
      return { error: "You already own a school." };
    }

    // Check subdomain availability
    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
      columns: { id: true },
    });

    if (existing) {
      return { error: "This subdomain is already taken." };
    }

    // Create tenant
    const [tenant] = await db.insert(tenants).values({ name, subdomain }).returning();

    // Update user to tenant_owner and assign to new tenant
    await db
      .update(users)
      .set({ role: "tenant_owner", tenantId: tenant.id })
      .where(eq(users.id, session.user.id));

    return { error: null, tenant: { id: tenant.id, subdomain: tenant.subdomain } };
  });
