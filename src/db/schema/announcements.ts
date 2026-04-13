import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";
import { courses } from "./courses.ts";

export const announcements = pgTable(
  "announcements",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text().notNull(),
    body: text().notNull(),
    emailSent: boolean("email_sent").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("announcements_tenant_id_idx").on(table.tenantId),
    index("announcements_course_id_idx").on(table.courseId),
  ],
);
