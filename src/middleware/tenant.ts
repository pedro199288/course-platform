import { createMiddleware } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";
import { tenantIdStore } from "#/lib/tenant-context.ts";

export type TenantContext = {
  tenant: {
    id: string;
    name: string;
    subdomain: string;
    planId: string | null;
    stripeConnectAccountId: string | null;
  };
};

/**
 * Extracts the subdomain from a Host header.
 * Supports: tenant.localhost, tenant.platform.com, tenant.platform.com:3000
 * Returns null for bare domains (localhost, platform.com) or www.
 */
export function extractSubdomain(host: string): string | null {
  const hostname = host.split(":")[0];

  if (hostname.endsWith(".localhost")) {
    const sub = hostname.slice(0, -".localhost".length);
    return sub && sub !== "www" ? sub : null;
  }

  const parts = hostname.split(".");
  if (parts.length >= 3) {
    const sub = parts[0];
    return sub !== "www" ? sub : null;
  }

  return null;
}

/**
 * Request-level middleware that resolves the tenant from the subdomain.
 * Runs on ALL server requests (SSR, server routes, server functions).
 *
 * - Requests to the main platform domain (no subdomain) pass through without tenant context.
 * - Requests to a valid tenant subdomain get tenant context injected.
 * - Requests to an unknown subdomain get a 404 response.
 *
 * Also sets the tenant ID in AsyncLocalStorage so the auth adapter
 * can scope user lookups to the current tenant.
 *
 * For local dev, use `tenant.localhost:3000` or set the `X-Tenant` header
 * (e.g., `myschool.localhost:3000`).
 */
export const tenantMiddleware = createMiddleware().server(async ({ next, request }) => {
  const host = request.headers.get("x-tenant") ?? request.headers.get("host") ?? "";

  const subdomain = extractSubdomain(host);

  if (!subdomain) {
    return tenantIdStore.run(null, () => next());
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.subdomain, subdomain),
    columns: {
      id: true,
      name: true,
      subdomain: true,
      planId: true,
      stripeConnectAccountId: true,
    },
  });

  if (!tenant) {
    return new Response("Tenant not found", { status: 404 });
  }

  return tenantIdStore.run(tenant.id, () => next({ context: { tenant } }));
});
