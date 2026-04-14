import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { plans } from "./plans.ts";
import type { RichTextDoc } from "#/lib/rich-text/types.ts";

export const tenantStatus = pgEnum("tenant_status", ["active", "suspended", "inactive"]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    subdomain: text().notNull().unique(),
    stripeConnectAccountId: text("stripe_connect_account_id"),
    stripeOnboardingComplete: text("stripe_onboarding_complete").notNull().default("false"),
    subscriptionPrice: numeric("subscription_price", { precision: 10, scale: 2 }),
    planId: uuid("plan_id").references(() => plans.id),
    status: tenantStatus().notNull().default("active"),
    logoUrl: text("logo_url"),
    faviconUrl: text("favicon_url"),
    primaryColor: text("primary_color"),
    accentColor: text("accent_color"),
    brandName: text("brand_name"),
    gaTrackingId: text("ga_tracking_id"),
    fbPixelId: text("fb_pixel_id"),
    aboutInstructor: jsonb("about_instructor").$type<RichTextDoc | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("tenants_subdomain_idx").on(table.subdomain)],
);
