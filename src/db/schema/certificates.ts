import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";
import { users } from "./auth.ts";
import { courses } from "./courses.ts";

export const certificates = pgTable(
  "certificates",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    fileUrl: text("file_url"),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => [index("certificates_tenant_id_idx").on(table.tenantId)],
);
