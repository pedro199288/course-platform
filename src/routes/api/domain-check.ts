import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";

/**
 * Caddy on-demand TLS "ask" endpoint.
 * Caddy calls GET /api/domain-check?domain=cursos.intecc.es before provisioning
 * a certificate. Returns 200 if the domain belongs to an active tenant, 404 otherwise.
 *
 * Caddy config example:
 *   tls {
 *     on_demand {
 *       ask http://localhost:4500/api/domain-check
 *     }
 *   }
 */
export const Route = createFileRoute("/api/domain-check")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const domain = url.searchParams.get("domain");

        if (!domain) {
          return new Response("Missing domain parameter", { status: 400 });
        }

        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.customDomain, domain),
          columns: { id: true, status: true },
        });

        if (!tenant || tenant.status !== "active") {
          return new Response("Domain not found", { status: 404 });
        }

        return new Response("OK", { status: 200 });
      },
    },
  },
});
