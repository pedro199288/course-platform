import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "#/db/index.ts";
import { tenants, courses, modules, lessons } from "#/db/schema/index.ts";
import { BunnyStreamProvider } from "#/lib/video/bunny-stream.ts";
import type { VideoProvider } from "#/lib/video/types.ts";

// ── BunnyStreamProvider unit tests ──────────────────────────────────

describe("BunnyStreamProvider", () => {
  const provider = new BunnyStreamProvider({
    libraryId: "test-library-123",
    apiKey: "test-api-key-456",
    cdnHostname: "vz-test.b-cdn.net",
    cdnTokenKey: "test-cdn-token-key",
  });

  describe("CDN token generation", () => {
    it("generates a deterministic token for the same inputs", () => {
      const token1 = provider.generateCdnToken(
        "my-secret-key",
        "/video-id/playlist.m3u8",
        1700000000,
      );
      const token2 = provider.generateCdnToken(
        "my-secret-key",
        "/video-id/playlist.m3u8",
        1700000000,
      );
      expect(token1).toBe(token2);
    });

    it("produces different tokens for different paths", () => {
      const token1 = provider.generateCdnToken("key", "/video-a/playlist.m3u8", 1700000000);
      const token2 = provider.generateCdnToken("key", "/video-b/playlist.m3u8", 1700000000);
      expect(token1).not.toBe(token2);
    });

    it("produces different tokens for different expiry times", () => {
      const token1 = provider.generateCdnToken("key", "/video/playlist.m3u8", 1700000000);
      const token2 = provider.generateCdnToken("key", "/video/playlist.m3u8", 1700003600);
      expect(token1).not.toBe(token2);
    });

    it("produces different tokens for different keys", () => {
      const token1 = provider.generateCdnToken("key-a", "/video/playlist.m3u8", 1700000000);
      const token2 = provider.generateCdnToken("key-b", "/video/playlist.m3u8", 1700000000);
      expect(token1).not.toBe(token2);
    });

    it("uses base64url encoding (no +, /, or = characters)", () => {
      for (let i = 0; i < 20; i++) {
        const token = provider.generateCdnToken(
          `key-${i}`,
          `/video-${i}/playlist.m3u8`,
          1700000000 + i,
        );
        expect(token).not.toMatch(/[+/=]/);
      }
    });

    it("matches expected SHA256 computation", () => {
      const securityKey = "test-secret";
      const urlPath = "/abc123/playlist.m3u8";
      const expires = 1700000000;

      const expected = createHash("sha256")
        .update(securityKey + urlPath + expires)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      const actual = provider.generateCdnToken(securityKey, urlPath, expires);
      expect(actual).toBe(expected);
    });
  });

  describe("provider interface compliance", () => {
    it("implements the VideoProvider interface", () => {
      const p: VideoProvider = provider;
      expect(p.name).toBe("bunny-stream");
      expect(typeof p.createUploadUrl).toBe("function");
      expect(typeof p.getPlaybackUrl).toBe("function");
      expect(typeof p.getVideoStatus).toBe("function");
      expect(typeof p.deleteVideo).toBe("function");
    });
  });

  describe("getPlaybackUrl", () => {
    it("returns a signed URL with token and expires params", async () => {
      const result = await provider.getPlaybackUrl("test-video-id-abc", {
        expiresInSeconds: 3600,
      });

      expect(result.url).toContain("https://vz-test.b-cdn.net/test-video-id-abc/playlist.m3u8");
      expect(result.url).toContain("token=");
      expect(result.url).toContain("expires=");
      expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("uses default 4-hour expiry when not specified", async () => {
      const before = Math.floor(Date.now() / 1000);
      const result = await provider.getPlaybackUrl("test-video-id-abc");
      const after = Math.floor(Date.now() / 1000);

      // Default is 14400 seconds (4 hours)
      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 14400);
      expect(result.expiresAt).toBeLessThanOrEqual(after + 14400);
    });
  });
});

// ── Video upload status in DB (integration) ─────────────────────────
// These tests require a running PostgreSQL database

const hasDatabase = !!process.env.DATABASE_URL;

describe.skipIf(!hasDatabase)("video upload status schema (integration)", () => {
  const ts = Date.now();
  let tenantId: string;
  let moduleId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `Video Test School ${ts}`, subdomain: `video-test-${ts}` })
      .returning();
    tenantId = tenant.id;

    const [course] = await db
      .insert(courses)
      .values({ tenantId, title: "Video Course", slug: `video-course-${ts}` })
      .returning();

    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, title: "Video Module", position: 0 })
      .returning();
    moduleId = mod.id;
  });

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it("creates a video lesson with null videoUploadStatus by default", async () => {
    const [lesson] = await db
      .insert(lessons)
      .values({ moduleId, title: "Intro Video", type: "video", position: 0 })
      .returning();

    expect(lesson.type).toBe("video");
    expect(lesson.videoProviderId).toBeNull();
    expect(lesson.videoUploadStatus).toBeNull();
  });

  it("updates videoUploadStatus to pending when upload starts", async () => {
    const [lesson] = await db
      .insert(lessons)
      .values({ moduleId, title: "Upload Test", type: "video", position: 1 })
      .returning();

    const [updated] = await db
      .update(lessons)
      .set({
        videoProviderId: "bunny-video-guid-123",
        videoUploadStatus: "pending",
      })
      .where(eq(lessons.id, lesson.id))
      .returning();

    expect(updated.videoProviderId).toBe("bunny-video-guid-123");
    expect(updated.videoUploadStatus).toBe("pending");
  });

  it("transitions through upload status lifecycle", async () => {
    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Lifecycle Test",
        type: "video",
        videoProviderId: "lifecycle-video-id",
        videoUploadStatus: "pending",
        position: 2,
      })
      .returning();

    const statuses = ["uploading", "processing", "ready"] as const;
    for (const status of statuses) {
      const [updated] = await db
        .update(lessons)
        .set({ videoUploadStatus: status })
        .where(eq(lessons.id, lesson.id))
        .returning();
      expect(updated.videoUploadStatus).toBe(status);
    }
  });

  it("can set videoUploadStatus to failed", async () => {
    const [lesson] = await db
      .insert(lessons)
      .values({
        moduleId,
        title: "Fail Test",
        type: "video",
        videoProviderId: "fail-video-id",
        videoUploadStatus: "processing",
        position: 3,
      })
      .returning();

    const [updated] = await db
      .update(lessons)
      .set({ videoUploadStatus: "failed" })
      .where(eq(lessons.id, lesson.id))
      .returning();

    expect(updated.videoUploadStatus).toBe("failed");
  });
});

describe.skipIf(!hasDatabase)("webhook status update (integration)", () => {
  const ts = Date.now();
  let tenantId: string;
  let moduleId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `Webhook School ${ts}`, subdomain: `webhook-test-${ts}` })
      .returning();
    tenantId = tenant.id;

    const [course] = await db
      .insert(courses)
      .values({ tenantId, title: "Webhook Course", slug: `webhook-course-${ts}` })
      .returning();

    const [mod] = await db
      .insert(modules)
      .values({ courseId: course.id, title: "Webhook Module", position: 0 })
      .returning();
    moduleId = mod.id;
  });

  afterAll(async () => {
    await db.delete(courses).where(eq(courses.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it("updates lesson status when matching by videoProviderId", async () => {
    const videoGuid = `webhook-video-${ts}`;
    await db.insert(lessons).values({
      moduleId,
      title: "Webhook Lesson",
      type: "video",
      videoProviderId: videoGuid,
      videoUploadStatus: "processing",
      position: 0,
    });

    // Simulate what the webhook handler does
    await db
      .update(lessons)
      .set({ videoUploadStatus: "ready" })
      .where(eq(lessons.videoProviderId, videoGuid));

    const lesson = await db.query.lessons.findFirst({
      where: eq(lessons.videoProviderId, videoGuid),
    });

    expect(lesson).toBeDefined();
    expect(lesson!.videoUploadStatus).toBe("ready");
  });
});
