import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { LessonContent } from "#/lib/rich-text/types.ts";
import { tenants } from "./tenants.ts";

export const courseStatus = pgEnum("course_status", ["draft", "published"]);

export const pricingModel = pgEnum("pricing_model", ["one_time", "subscription", "both"]);

export const lessonType = pgEnum("lesson_type", ["video", "text", "quiz", "file"]);

export const videoUploadStatus = pgEnum("video_upload_status", [
  "pending",
  "uploading",
  "processing",
  "ready",
  "failed",
]);

export const courses = pgTable(
  "courses",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    title: text().notNull(),
    description: text(),
    slug: text().notNull(),
    thumbnailUrl: text("thumbnail_url"),
    price: numeric({ precision: 10, scale: 2 }),
    pricingModel: pricingModel("pricing_model").notNull().default("one_time"),
    status: courseStatus().notNull().default("draft"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    sequentialProgress: boolean("sequential_progress").notNull().default(false),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("courses_tenant_id_idx").on(table.tenantId),
    index("courses_slug_tenant_idx").on(table.slug, table.tenantId),
  ],
);

export const modules = pgTable(
  "modules",
  {
    id: uuid().primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text().notNull(),
    position: integer().notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("modules_course_id_idx").on(table.courseId)],
);

export const lessons = pgTable(
  "lessons",
  {
    id: uuid().primaryKey().defaultRandom(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    title: text().notNull(),
    type: lessonType().notNull().default("text"),
    content: jsonb().$type<LessonContent>(),
    videoProviderId: text("video_provider_id"),
    videoUploadStatus: videoUploadStatus("video_upload_status"),
    fileUrl: text("file_url"),
    position: integer().notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("lessons_module_id_idx").on(table.moduleId)],
);
