import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
  courses,
  modules,
  lessons,
  lessonProgress,
  tenants,
  quizResults,
} from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";
import { checkCourseAccess } from "./lesson-actions.ts";
import { checkAndIssueCertificate } from "./certificate-actions.ts";
import type { QuizContent } from "./rich-text/types.ts";
import { isQuizContent } from "./rich-text/types.ts";

async function requireTenant() {
  const request = getRequest();
  const host =
    request.headers.get("x-tenant") ?? request.headers.get("host") ?? "";
  const subdomain = extractSubdomain(host);
  if (!subdomain) throw new Error("No tenant");

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.subdomain, subdomain),
    columns: { id: true, name: true, subdomain: true },
  });
  if (!tenant) throw new Error("Tenant not found");
  return tenant;
}

async function requireAuth() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");
  return session.user as { id: string; tenantId: string };
}

/**
 * Submit quiz answers. Scores them server-side, stores the result,
 * marks the lesson as complete, and checks for certificate issuance.
 */
export const submitQuizFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      courseSlug: string;
      lessonId: string;
      answers: Array<{ questionId: string; selectedOption: number }>;
    }) => d,
  )
  .handler(async ({ data }) => {
    const tenant = await requireTenant();
    const user = await requireAuth();

    // Load the course (must be published)
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.tenantId, tenant.id),
          eq(courses.slug, data.courseSlug),
          eq(courses.status, "published"),
        ),
      );
    if (!course) throw new Error("Course not found");

    // Verify enrollment/subscription
    const hasAccess = await checkCourseAccess(user.id, course.id, tenant.id);
    if (!hasAccess) throw new Error("Not enrolled");

    // Load the lesson and verify it's a quiz
    const [lesson] = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, data.lessonId));
    if (!lesson) throw new Error("Lesson not found");
    if (lesson.type !== "quiz") throw new Error("Not a quiz lesson");

    // Verify the lesson belongs to this course
    const [mod] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, lesson.moduleId));
    if (!mod || mod.courseId !== course.id) throw new Error("Lesson not found");

    // Score the quiz
    const quizContent = lesson.content as QuizContent;
    if (!isQuizContent(quizContent) || !quizContent.questions?.length) {
      throw new Error("Invalid quiz content");
    }

    const questionMap = new Map(
      quizContent.questions.map((q) => [q.id, q]),
    );

    const scoredAnswers = data.answers.map((a) => {
      const question = questionMap.get(a.questionId);
      const correct = question ? a.selectedOption === question.correctOption : false;
      return {
        questionId: a.questionId,
        selectedOption: a.selectedOption,
        correct,
      };
    });

    const score = scoredAnswers.filter((a) => a.correct).length;

    // Store quiz result (upsert — allow retakes)
    await db
      .insert(quizResults)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        lessonId: data.lessonId,
        score,
        totalQuestions: quizContent.questions.length,
        answers: scoredAnswers,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [quizResults.userId, quizResults.lessonId],
        set: {
          score,
          totalQuestions: quizContent.questions.length,
          answers: scoredAnswers,
          completedAt: new Date(),
        },
      });

    // Mark lesson as complete (upsert)
    await db
      .insert(lessonProgress)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        lessonId: data.lessonId,
        completed: true,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: { completed: true, completedAt: new Date() },
      });

    // Check if course is now 100% complete
    const certResult = await checkAndIssueCertificate(
      user.id,
      course.id,
      tenant.id,
    );

    return {
      score,
      totalQuestions: quizContent.questions.length,
      answers: scoredAnswers,
      certificateIssued: certResult.issued,
    };
  });

/**
 * Get the quiz result for a lesson (if the user has already taken it).
 */
export const getQuizResultFn = createServerFn({ method: "GET" })
  .inputValidator((d: { lessonId: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();
    const user = await requireAuth();

    const [result] = await db
      .select()
      .from(quizResults)
      .where(
        and(
          eq(quizResults.userId, user.id),
          eq(quizResults.lessonId, data.lessonId),
          eq(quizResults.tenantId, tenant.id),
        ),
      );

    return result ?? null;
  });
