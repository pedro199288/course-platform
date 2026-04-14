#!/usr/bin/env npx tsx
/**
 * Thinkific → Course Platform migration script (one-off).
 *
 * Usage:
 *   npx tsx scripts/migrate-thinkific.ts
 *
 * Required environment variables:
 *   DATABASE_URL          — PostgreSQL connection string
 *   THINKIFIC_API_KEY     — Thinkific API v1 key
 *   THINKIFIC_SUBDOMAIN   — Thinkific school subdomain (e.g. "intecc")
 *   TENANT_ID             — Target tenant UUID in the platform
 *   BUNNY_STREAM_LIBRARY_ID — Bunny Stream library ID
 *   BUNNY_STREAM_API_KEY    — Bunny Stream API key
 *
 * Optional:
 *   MIGRATION_STATE_FILE  — Path to JSON state file for idempotency
 *                           (default: ./migration-state.json)
 *   DRY_RUN=1             — Log what would be done without writing to DB
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import * as schema from "#/db/schema/index.ts";

// ── Config ────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return v;
}

const THINKIFIC_API_KEY = requireEnv("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = requireEnv("THINKIFIC_SUBDOMAIN");
const TENANT_ID = process.argv[2] || requireEnv("TENANT_ID");
const DATABASE_URL = requireEnv("DATABASE_URL");
const BUNNY_LIBRARY_ID = requireEnv("BUNNY_STREAM_LIBRARY_ID");
const BUNNY_API_KEY = requireEnv("BUNNY_STREAM_API_KEY");

const STATE_FILE = process.env.MIGRATION_STATE_FILE || "./migration-state.json";
const DRY_RUN = process.env.DRY_RUN === "1";

const THINKIFIC_API_BASE = `https://api.thinkific.com/api/public/v1`;

const db = drizzle(DATABASE_URL, { schema });

// ── Idempotency state ─────────────────────────────────────────────

interface MigrationState {
  /** Thinkific course ID → platform course ID */
  courses: Record<string, string>;
  /** Thinkific chapter ID → platform module ID */
  modules: Record<string, string>;
  /** Thinkific lesson ID → platform lesson ID */
  lessons: Record<string, string>;
  /** Thinkific user ID → platform user ID */
  users: Record<string, string>;
  /** "thinkificUserId:thinkificCourseId" → platform enrollment ID */
  enrollments: Record<string, string>;
  /** Thinkific lesson ID → Bunny video ID (for video re-upload tracking) */
  videos: Record<string, string>;
}

function loadState(): MigrationState {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  }
  return { courses: {}, modules: {}, lessons: {}, users: {}, enrollments: {}, videos: {} };
}

function saveState(state: MigrationState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Thinkific API helpers ─────────────────────────────────────────

interface ThinkificPaginatedResponse<T> {
  items: T[];
  meta: { pagination: { next_page: number | null; total_items: number } };
}

async function thinkificGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${THINKIFIC_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      "X-Auth-API-Key": THINKIFIC_API_KEY,
      "X-Auth-Subdomain": THINKIFIC_SUBDOMAIN,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Thinkific API ${path} failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

async function thinkificPaginate<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  let page = 1;

  while (true) {
    const data = await thinkificGet<ThinkificPaginatedResponse<T>>(path, {
      page: String(page),
      limit: "250",
    });
    all.push(...data.items);

    if (!data.meta.pagination.next_page) break;
    page = data.meta.pagination.next_page;
  }

  return all;
}

// ── Thinkific types ───────────────────────────────────────────────

interface ThinkificCourse {
  id: number;
  name: string;
  slug: string;
  description: string;
  course_card_image_url: string | null;
  chapter_ids: number[];
}

interface ThinkificChapter {
  id: number;
  name: string;
  position: number;
  content_ids: number[];
  course_id: number;
}

interface ThinkificContent {
  id: number;
  name: string;
  position: number;
  chapter_id: number;
  content_type: string; // "Video", "Text", "Quiz", "Download", etc.
  take_url: string | null;
  video_url: string | null;
  description: string | null;
}

interface ThinkificUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
}

interface ThinkificEnrollment {
  id: number;
  user_id: number;
  course_id: number;
  activated_at: string | null;
  completed_at: string | null;
  percentage_completed: number;
  expired: boolean;
  created_at: string;
}

// ── Bunny Stream direct upload ────────────────────────────────────

const BUNNY_API_BASE = "https://video.bunnycdn.com";

async function createBunnyVideo(title: string): Promise<string> {
  const res = await fetch(`${BUNNY_API_BASE}/library/${BUNNY_LIBRARY_ID}/videos`, {
    method: "POST",
    headers: {
      AccessKey: BUNNY_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bunny: failed to create video (${res.status}): ${body}`);
  }

  const video = (await res.json()) as { guid: string };
  return video.guid;
}

async function uploadVideoToBunny(videoId: string, videoUrl: string): Promise<void> {
  // Download video from Thinkific
  log(`    Downloading video from ${videoUrl.substring(0, 80)}...`);
  const downloadRes = await fetch(videoUrl);
  if (!downloadRes.ok) {
    throw new Error(`Failed to download video (${downloadRes.status})`);
  }

  const videoBuffer = Buffer.from(await downloadRes.arrayBuffer());
  log(`    Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Upload to Bunny via PUT
  log(`    Uploading to Bunny Stream (video ID: ${videoId})...`);
  const uploadRes = await fetch(
    `${BUNNY_API_BASE}/library/${BUNNY_LIBRARY_ID}/videos/${videoId}`,
    {
      method: "PUT",
      headers: {
        AccessKey: BUNNY_API_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: videoBuffer,
    },
  );

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`Bunny: failed to upload video (${uploadRes.status}): ${body}`);
  }

  log(`    Upload complete for video ${videoId}`);
}

// ── Helpers ───────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[migrate] ${msg}`);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapLessonType(contentType: string): "video" | "text" | "quiz" | "file" {
  switch (contentType.toLowerCase()) {
    case "video":
    case "brillium_exam":
      return "video";
    case "quiz":
    case "survey":
      return "quiz";
    case "download":
    case "pdf_embed":
      return "file";
    default:
      return "text";
  }
}

// ── Migration steps ───────────────────────────────────────────────

async function migrateCourses(state: MigrationState): Promise<void> {
  log("Fetching courses from Thinkific...");
  const tkCourses = await thinkificPaginate<ThinkificCourse>("/courses");
  log(`Found ${tkCourses.length} courses`);

  for (const tkCourse of tkCourses) {
    const extId = String(tkCourse.id);
    if (state.courses[extId]) {
      log(`  ✓ Course "${tkCourse.name}" already migrated (${state.courses[extId]})`);
      continue;
    }

    if (DRY_RUN) {
      log(`  [DRY RUN] Would create course: ${tkCourse.name}`);
      continue;
    }

    const slug = slugify(tkCourse.name);

    const [course] = await db
      .insert(schema.courses)
      .values({
        tenantId: TENANT_ID,
        title: tkCourse.name,
        description: tkCourse.description || null,
        slug,
        thumbnailUrl: tkCourse.course_card_image_url || null,
        status: "published",
        pricingModel: "one_time",
      })
      .returning();

    state.courses[extId] = course.id;
    saveState(state);
    log(`  + Course "${tkCourse.name}" → ${course.id}`);
  }
}

async function migrateChaptersAndLessons(state: MigrationState): Promise<void> {
  log("Fetching chapters and lessons from Thinkific...");

  // Get all courses to iterate their chapters
  const tkCourses = await thinkificPaginate<ThinkificCourse>("/courses");

  for (const tkCourse of tkCourses) {
    const courseId = state.courses[String(tkCourse.id)];
    if (!courseId) {
      log(`  ⚠ Course "${tkCourse.name}" not in state, skipping chapters`);
      continue;
    }

    // Fetch chapters for this course
    for (let i = 0; i < tkCourse.chapter_ids.length; i++) {
      const chapterId = tkCourse.chapter_ids[i];
      const extChapterId = String(chapterId);

      let moduleId: string;

      if (state.modules[extChapterId]) {
        moduleId = state.modules[extChapterId];
        log(`  ✓ Chapter ${chapterId} already migrated (${moduleId})`);
      } else {
        // Fetch chapter details
        const tkChapter = await thinkificGet<ThinkificChapter>(`/chapters/${chapterId}`);

        if (DRY_RUN) {
          log(`  [DRY RUN] Would create module: ${tkChapter.name}`);
          continue;
        }

        const [mod] = await db
          .insert(schema.modules)
          .values({
            courseId,
            title: tkChapter.name,
            position: tkChapter.position ?? i,
          })
          .returning();

        moduleId = mod.id;
        state.modules[extChapterId] = moduleId;
        saveState(state);
        log(`  + Module "${tkChapter.name}" → ${moduleId}`);
      }

      // Fetch lessons (contents) for this chapter
      const tkChapter = await thinkificGet<ThinkificChapter>(`/chapters/${chapterId}`);

      for (let j = 0; j < tkChapter.content_ids.length; j++) {
        const contentId = tkChapter.content_ids[j];
        const extContentId = String(contentId);

        if (state.lessons[extContentId]) {
          log(`    ✓ Lesson ${contentId} already migrated`);
          continue;
        }

        const tkContent = await thinkificGet<ThinkificContent>(
          `/course_contents/${contentId}`,
        );

        if (DRY_RUN) {
          log(`    [DRY RUN] Would create lesson: ${tkContent.name}`);
          continue;
        }

        const lessonType = mapLessonType(tkContent.content_type);

        const [lesson] = await db
          .insert(schema.lessons)
          .values({
            moduleId,
            title: tkContent.name,
            type: lessonType,
            position: tkContent.position ?? j,
            content:
              lessonType === "text" && tkContent.description
                ? {
                    type: "doc",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: tkContent.description }],
                      },
                    ],
                  }
                : null,
          })
          .returning();

        state.lessons[extContentId] = lesson.id;
        saveState(state);
        log(`    + Lesson "${tkContent.name}" (${lessonType}) → ${lesson.id}`);

        // Handle video upload
        if (lessonType === "video" && tkContent.video_url) {
          await migrateVideo(state, extContentId, lesson.id, tkContent);
        }
      }
    }
  }
}

async function migrateVideo(
  state: MigrationState,
  extContentId: string,
  lessonId: string,
  tkContent: ThinkificContent,
): Promise<void> {
  if (state.videos[extContentId]) {
    log(`    ✓ Video for lesson ${extContentId} already uploaded (${state.videos[extContentId]})`);
    return;
  }

  if (!tkContent.video_url) return;

  try {
    const bunnyVideoId = await createBunnyVideo(tkContent.name);

    await uploadVideoToBunny(bunnyVideoId, tkContent.video_url);

    // Update lesson with video provider ID
    await db
      .update(schema.lessons)
      .set({
        videoProviderId: bunnyVideoId,
        videoUploadStatus: "processing", // Bunny will process after upload
      })
      .where(eq(schema.lessons.id, lessonId));

    state.videos[extContentId] = bunnyVideoId;
    saveState(state);
    log(`    + Video uploaded → Bunny ID ${bunnyVideoId}`);
  } catch (err) {
    log(`    ✖ Video upload failed for "${tkContent.name}": ${(err as Error).message}`);
    // Non-fatal: continue with other lessons
  }
}

async function migrateUsers(state: MigrationState): Promise<void> {
  log("Fetching users from Thinkific...");
  const tkUsers = await thinkificPaginate<ThinkificUser>("/users");
  log(`Found ${tkUsers.length} users`);

  for (const tkUser of tkUsers) {
    const extId = String(tkUser.id);
    if (state.users[extId]) {
      log(`  ✓ User "${tkUser.email}" already migrated`);
      continue;
    }

    if (DRY_RUN) {
      log(`  [DRY RUN] Would create user: ${tkUser.email}`);
      continue;
    }

    const name = [tkUser.first_name, tkUser.last_name].filter(Boolean).join(" ") || tkUser.email;

    // Check if user already exists in this tenant (by email)
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(eq(schema.users.tenantId, TENANT_ID), eq(schema.users.email, tkUser.email)),
      )
      .limit(1);

    if (existing.length > 0) {
      state.users[extId] = existing[0].id;
      saveState(state);
      log(`  ✓ User "${tkUser.email}" already exists in tenant (${existing[0].id})`);
      continue;
    }

    const [user] = await db
      .insert(schema.users)
      .values({
        tenantId: TENANT_ID,
        name,
        email: tkUser.email,
        role: "student",
        createdAt: new Date(tkUser.created_at),
      })
      .returning();

    state.users[extId] = user.id;
    saveState(state);
    log(`  + User "${tkUser.email}" → ${user.id}`);
  }
}

async function migrateEnrollments(state: MigrationState): Promise<void> {
  log("Fetching enrollments from Thinkific...");
  const tkEnrollments = await thinkificPaginate<ThinkificEnrollment>("/enrollments");
  log(`Found ${tkEnrollments.length} enrollments`);

  for (const tkEnr of tkEnrollments) {
    const userId = state.users[String(tkEnr.user_id)];
    const courseId = state.courses[String(tkEnr.course_id)];

    if (!userId || !courseId) {
      log(
        `  ⚠ Enrollment ${tkEnr.id}: missing user (${tkEnr.user_id}) or course (${tkEnr.course_id}), skipping`,
      );
      continue;
    }

    const enrollKey = `${tkEnr.user_id}:${tkEnr.course_id}`;
    if (state.enrollments[enrollKey]) {
      log(`  ✓ Enrollment ${enrollKey} already migrated`);
      continue;
    }

    if (DRY_RUN) {
      log(`  [DRY RUN] Would create enrollment for user ${tkEnr.user_id} in course ${tkEnr.course_id}`);
      continue;
    }

    // Check for existing enrollment (user+course unique constraint)
    const existing = await db
      .select({ id: schema.enrollments.id })
      .from(schema.enrollments)
      .where(
        and(
          eq(schema.enrollments.userId, userId),
          eq(schema.enrollments.courseId, courseId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      state.enrollments[enrollKey] = existing[0].id;
      saveState(state);
      log(`  ✓ Enrollment already exists for ${enrollKey}`);
      continue;
    }

    const enrolledAt = tkEnr.activated_at
      ? new Date(tkEnr.activated_at)
      : new Date(tkEnr.created_at);

    const [enrollment] = await db
      .insert(schema.enrollments)
      .values({
        tenantId: TENANT_ID,
        userId,
        courseId,
        enrolledAt,
        revokedAt: tkEnr.expired ? new Date() : null,
      })
      .returning();

    state.enrollments[enrollKey] = enrollment.id;
    saveState(state);
    log(`  + Enrollment user:${tkEnr.user_id} → course:${tkEnr.course_id} (${enrollment.id})`);
  }
}

async function migrateProgress(state: MigrationState): Promise<void> {
  log("Migrating lesson progress...");

  // For each enrollment, check completion data
  const tkEnrollments = await thinkificPaginate<ThinkificEnrollment>("/enrollments");
  let progressCount = 0;

  for (const tkEnr of tkEnrollments) {
    if (tkEnr.percentage_completed === 0) continue;

    const userId = state.users[String(tkEnr.user_id)];
    const courseId = state.courses[String(tkEnr.course_id)];
    if (!userId || !courseId) continue;

    // If fully completed, mark all lessons in the course as completed
    if (tkEnr.completed_at || tkEnr.percentage_completed === 100) {
      const courseLessons = await db
        .select({ id: schema.lessons.id })
        .from(schema.lessons)
        .innerJoin(schema.modules, eq(schema.modules.id, schema.lessons.moduleId))
        .where(eq(schema.modules.courseId, courseId));

      for (const lesson of courseLessons) {
        if (DRY_RUN) continue;

        try {
          await db
            .insert(schema.lessonProgress)
            .values({
              tenantId: TENANT_ID,
              userId,
              lessonId: lesson.id,
              completed: true,
              completedAt: tkEnr.completed_at ? new Date(tkEnr.completed_at) : new Date(),
            })
            .onConflictDoNothing();
          progressCount++;
        } catch {
          // Already exists — fine
        }
      }
    } else if (tkEnr.percentage_completed > 0) {
      // Partial completion: mark proportional number of lessons
      const courseLessons = await db
        .select({ id: schema.lessons.id })
        .from(schema.lessons)
        .innerJoin(schema.modules, eq(schema.modules.id, schema.lessons.moduleId))
        .where(eq(schema.modules.courseId, courseId))
        .orderBy(schema.modules.position, schema.lessons.position);

      const completedCount = Math.round(
        (tkEnr.percentage_completed / 100) * courseLessons.length,
      );

      for (let i = 0; i < completedCount && i < courseLessons.length; i++) {
        if (DRY_RUN) continue;

        try {
          await db
            .insert(schema.lessonProgress)
            .values({
              tenantId: TENANT_ID,
              userId,
              lessonId: courseLessons[i].id,
              completed: true,
              completedAt: new Date(),
            })
            .onConflictDoNothing();
          progressCount++;
        } catch {
          // Already exists — fine
        }
      }
    }
  }

  log(`  Inserted ${progressCount} lesson progress records`);
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("=== Thinkific → Course Platform Migration ===");
  log(`Thinkific subdomain: ${THINKIFIC_SUBDOMAIN}`);
  log(`Target tenant ID: ${TENANT_ID}`);
  log(`State file: ${STATE_FILE}`);
  if (DRY_RUN) log("*** DRY RUN MODE — no writes ***");
  log("");

  // Verify tenant exists
  const [tenant] = await db
    .select({ id: schema.tenants.id, name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, TENANT_ID))
    .limit(1);

  if (!tenant) {
    console.error(`Tenant ${TENANT_ID} not found in database`);
    process.exit(1);
  }
  log(`Target tenant: "${tenant.name}" (${tenant.id})`);
  log("");

  const state = loadState();

  // Step 1: Courses
  await migrateCourses(state);
  log("");

  // Step 2: Chapters → modules, Content → lessons (+ video uploads)
  await migrateChaptersAndLessons(state);
  log("");

  // Step 3: Users → students
  await migrateUsers(state);
  log("");

  // Step 4: Enrollments
  await migrateEnrollments(state);
  log("");

  // Step 5: Progress
  await migrateProgress(state);
  log("");

  // Summary
  log("=== Migration Summary ===");
  log(`  Courses:     ${Object.keys(state.courses).length}`);
  log(`  Modules:     ${Object.keys(state.modules).length}`);
  log(`  Lessons:     ${Object.keys(state.lessons).length}`);
  log(`  Videos:      ${Object.keys(state.videos).length}`);
  log(`  Users:       ${Object.keys(state.users).length}`);
  log(`  Enrollments: ${Object.keys(state.enrollments).length}`);
  log("");
  log("Migration complete!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
