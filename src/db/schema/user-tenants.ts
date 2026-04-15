import { pgEnum, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { tenants } from "./tenants.ts";

export const tenantRole = pgEnum("tenant_role", [
  "tenant_owner",
  "tenant_admin",
  "student",
]);

export const userTenants = pgTable(
  "user_tenants",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: tenantRole().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.tenantId] }),
  ],
);
