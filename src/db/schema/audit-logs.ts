import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";
import { users } from "./auth.ts";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    event: text().notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_actor_id_idx").on(table.actorId),
    index("audit_logs_tenant_id_idx").on(table.tenantId),
    index("audit_logs_event_idx").on(table.event),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);
