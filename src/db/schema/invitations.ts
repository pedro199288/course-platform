import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { tenants } from "./tenants.ts";
import { tenantRole } from "./user-tenants.ts";

export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "expired"]);

export const invitations = pgTable("invitations", {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: text().notNull(),
  role: tenantRole().notNull(),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: invitationStatus().notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
