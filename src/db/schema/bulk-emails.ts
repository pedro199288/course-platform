import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";
import { courses } from "./courses.ts";

export const bulkEmails = pgTable(
  "bulk_emails",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    subject: text().notNull(),
    body: text().notNull(),
    totalRecipients: integer("total_recipients").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("bulk_emails_tenant_id_idx").on(table.tenantId),
    index("bulk_emails_course_id_idx").on(table.courseId),
  ],
);
