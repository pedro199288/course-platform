import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";
import { courses } from "./courses.ts";

export const testimonials = pgTable(
  "testimonials",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    body: text().notNull(),
    rating: integer(),
    position: integer().notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("testimonials_tenant_id_idx").on(table.tenantId),
    index("testimonials_course_id_idx").on(table.courseId),
  ],
);
