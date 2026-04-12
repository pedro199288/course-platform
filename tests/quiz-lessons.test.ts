import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  tenants,
  courses,
  modules,
  lessons,
  enrollments,
  lessonProgress,
  quizResults,
} from "#/db/schema/index.ts";
import type { QuizContent } from "#/lib/rich-text/types.ts";

// Mock email to prevent Resend API calls
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

describe("quiz lessons", () => {
  const subdomain = `quiz-test-${Date.now()}`;
  let tenantId: string;
  let courseId: string;
  let moduleId: string;
  let quizLessonId: string;
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();

  const quizContent: QuizContent = {
    type: "quiz",
    questions: [
      {
        id: "q1",
        question: "What is 2+2?",
        options: ["3", "4", "5"],
        correctOption: 1,
      },
      {
        id: "q2",
        question: "What color is the sky?",
        options: ["Red", "Green", "Blue", "Yellow"],
        correctOption: 2,
      },
      {
        id: "q3",
        question: "Is TypeScript a superset of JavaScript?",
        options: ["Yes", "No"],
        correctOption: 0,
      },
    ],
  };

  beforeAll(async () => {
    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Quiz Test School", subdomain })
      .returning();
    tenantId = tenant.id;

    // Create published course
    const [course] = await db
      .insert(courses)
      .values({
        tenantId,
        title: "Quiz Course",
        slug: "quiz-course",
        status: "published",
        price: "9.99",
      })
      .returning();
    courseId = course.id;

    // Create module
    const [mod] = await db
      .insert(modules)
      .values({ courseId, title: "Module 1", position: 0 })
      .returning();
    moduleId = mod.id;

    // Create quiz lesson
    const [quizLesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Quiz Lesson",
        type: "quiz",
        content: quizContent,
        position: 0,
      })
      .returning();
    quizLessonId = quizLesson.id;

    // Create text lesson (for mixed content testing)
    await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Text Lesson",
        type: "text",
        content: { text: "Hello world" },
        position: 1,
      });

    // Enroll the user
    await db.insert(enrollments).values({
      tenantId,
      userId,
      courseId,
    });
  });

  afterAll(async () => {
    await db.delete(quizResults).where(eq(quizResults.tenantId, tenantId)).catch(() => {});
    await db.delete(lessonProgress).where(eq(lessonProgress.tenantId, tenantId)).catch(() => {});
    await db.delete(enrollments).where(eq(enrollments.tenantId, tenantId)).catch(() => {});
    await db.delete(lessons).where(eq(lessons.moduleId, moduleId)).catch(() => {});
    await db.delete(modules).where(eq(modules.courseId, courseId)).catch(() => {});
    await db.delete(courses).where(eq(courses.tenantId, tenantId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.subdomain, subdomain)).catch(() => {});
  });

  // ── Quiz creation ──────────────��───────────────────────

  it("stores quiz content as JSONB on lesson", async () => {
    const [lesson] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, quizLessonId));

    expect(lesson).toBeDefined();
    expect(lesson.type).toBe("quiz");

    const content = lesson.content as QuizContent;
    expect(content.type).toBe("quiz");
    expect(content.questions).toHaveLength(3);
    expect(content.questions[0].question).toBe("What is 2+2?");
    expect(content.questions[0].options).toEqual(["3", "4", "5"]);
    expect(content.questions[0].correctOption).toBe(1);
  });

  it("can update quiz content with new questions", async () => {
    const updatedContent: QuizContent = {
      type: "quiz",
      questions: [
        ...quizContent.questions,
        {
          id: "q4",
          question: "What is 3+3?",
          options: ["5", "6", "7"],
          correctOption: 1,
        },
      ],
    };

    await db
      .update(lessons)
      .set({ content: updatedContent })
      .where(eq(lessons.id, quizLessonId));

    const [lesson] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, quizLessonId));

    const content = lesson.content as QuizContent;
    expect(content.questions).toHaveLength(4);
    expect(content.questions[3].question).toBe("What is 3+3?");

    // Restore original content for subsequent tests
    await db
      .update(lessons)
      .set({ content: quizContent })
      .where(eq(lessons.id, quizLessonId));
  });

  // ── Quiz submission + result storage ────────────────────

  it("stores quiz result with correct scoring", async () => {
    // All correct answers
    const answers = [
      { questionId: "q1", selectedOption: 1, correct: true },
      { questionId: "q2", selectedOption: 2, correct: true },
      { questionId: "q3", selectedOption: 0, correct: true },
    ];

    await db.insert(quizResults).values({
      tenantId,
      userId,
      lessonId: quizLessonId,
      score: 3,
      totalQuestions: 3,
      answers,
      completedAt: new Date(),
    });

    const [result] = await db
      .select()
      .from(quizResults)
      .where(
        and(
          eq(quizResults.userId, userId),
          eq(quizResults.lessonId, quizLessonId),
        ),
      );

    expect(result).toBeDefined();
    expect(result.score).toBe(3);
    expect(result.totalQuestions).toBe(3);
    expect(result.answers).toHaveLength(3);
    expect(result.tenantId).toBe(tenantId);
  });

  it("stores partial score when some answers are wrong", async () => {
    // Use a different user to avoid unique constraint
    const answers = [
      { questionId: "q1", selectedOption: 1, correct: true },
      { questionId: "q2", selectedOption: 0, correct: false }, // wrong
      { questionId: "q3", selectedOption: 1, correct: false }, // wrong
    ];

    await db.insert(quizResults).values({
      tenantId,
      userId: otherUserId,
      lessonId: quizLessonId,
      score: 1,
      totalQuestions: 3,
      answers,
      completedAt: new Date(),
    });

    const [result] = await db
      .select()
      .from(quizResults)
      .where(
        and(
          eq(quizResults.userId, otherUserId),
          eq(quizResults.lessonId, quizLessonId),
        ),
      );

    expect(result.score).toBe(1);
    expect(result.totalQuestions).toBe(3);
    const storedAnswers = result.answers as Array<{
      questionId: string;
      selectedOption: number;
      correct: boolean;
    }>;
    expect(storedAnswers[0].correct).toBe(true);
    expect(storedAnswers[1].correct).toBe(false);
    expect(storedAnswers[2].correct).toBe(false);
  });

  it("enforces unique constraint on user + lesson for quiz results", async () => {
    // Inserting same user+lesson again should conflict
    await expect(
      db.insert(quizResults).values({
        tenantId,
        userId,
        lessonId: quizLessonId,
        score: 2,
        totalQuestions: 3,
        answers: [],
        completedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("supports upsert for quiz retakes", async () => {
    const newAnswers = [
      { questionId: "q1", selectedOption: 0, correct: false },
      { questionId: "q2", selectedOption: 2, correct: true },
      { questionId: "q3", selectedOption: 0, correct: true },
    ];

    await db
      .insert(quizResults)
      .values({
        tenantId,
        userId,
        lessonId: quizLessonId,
        score: 2,
        totalQuestions: 3,
        answers: newAnswers,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [quizResults.userId, quizResults.lessonId],
        set: {
          score: 2,
          totalQuestions: 3,
          answers: newAnswers,
          completedAt: new Date(),
        },
      });

    const [result] = await db
      .select()
      .from(quizResults)
      .where(
        and(
          eq(quizResults.userId, userId),
          eq(quizResults.lessonId, quizLessonId),
        ),
      );

    expect(result.score).toBe(2);
    expect(result.totalQuestions).toBe(3);
  });

  // ── Quiz completion counts toward progress ──────────────

  it("quiz completion marks lesson progress", async () => {
    // Simulate what submitQuizFn does: insert quiz result + mark lesson complete
    await db
      .insert(lessonProgress)
      .values({
        tenantId,
        userId,
        lessonId: quizLessonId,
        completed: true,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: { completed: true, completedAt: new Date() },
      });

    const [progress] = await db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.lessonId, quizLessonId),
        ),
      );

    expect(progress).toBeDefined();
    expect(progress.completed).toBe(true);
  });

  // ── Tenant isolation ──────────────────────────���─────────

  it("isolates quiz results by tenant", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other Quiz School", subdomain: `other-quiz-${Date.now()}` })
      .returning();

    const results = await db
      .select()
      .from(quizResults)
      .where(
        and(
          eq(quizResults.userId, userId),
          eq(quizResults.tenantId, otherTenant.id),
        ),
      );

    expect(results.length).toBe(0);

    await db.delete(tenants).where(eq(tenants.id, otherTenant.id));
  });
});
