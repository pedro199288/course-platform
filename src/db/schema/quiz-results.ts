import { index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";
import { users } from "./auth.ts";
import { lessons } from "./courses.ts";

export type QuizAnswer = {
  questionId: string;
  selectedOption: number;
  correct: boolean;
};

export const quizResults = pgTable(
  "quiz_results",
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
      .references(() => lessons.id, { onDelete: "cascade" }),
    score: integer().notNull(),
    totalQuestions: integer("total_questions").notNull(),
    answers: jsonb().$type<QuizAnswer[]>().notNull(),
    completedAt: timestamp("completed_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("quiz_results_tenant_id_idx").on(table.tenantId),
    uniqueIndex("quiz_results_user_lesson_idx").on(table.userId, table.lessonId),
  ],
);
