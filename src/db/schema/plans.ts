import { integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const plans = pgTable("plans", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  maxCourses: integer("max_courses"),
  maxStudents: integer("max_students"),
  applicationFeePercent: numeric("application_fee_percent", {
    precision: 5,
    scale: 2,
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
