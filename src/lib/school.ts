import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, userTenants } from "#/db/schema/index.ts";
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

    // Check if user already owns a school via user_tenants membership
    const existingOwnership = await db.query.userTenants.findFirst({
      where: and(
        eq(userTenants.userId, session.user.id),
        eq(userTenants.role, "tenant_owner"),
      ),
    });

    if (existingOwnership) {
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

    // Create tenant + owner membership in a transaction
    const [tenant] = await db.insert(tenants).values({ name, subdomain }).returning();

    await db.insert(userTenants).values({
      userId: session.user.id,
      tenantId: tenant.id,
      role: "tenant_owner",
    });

    return { error: null, tenant: { id: tenant.id, subdomain: tenant.subdomain } };
  });
