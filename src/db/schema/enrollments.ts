import { boolean, index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";
import { users } from "./auth.ts";
import { courses } from "./courses.ts";
import { lessons } from "./courses.ts";

export const enrollments = pgTable(
  "enrollments",
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
    enrolledAt: timestamp("enrolled_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    index("enrollments_tenant_id_idx").on(table.tenantId),
    uniqueIndex("enrollments_user_course_idx").on(table.userId, table.courseId),
  ],
);

export const lessonProgress = pgTable(
  "lesson_progress",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id),
    completed: boolean().notNull().default(false),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("lesson_progress_tenant_id_idx").on(table.tenantId),
    uniqueIndex("lesson_progress_user_lesson_idx").on(table.userId, table.lessonId),
  ],
);
