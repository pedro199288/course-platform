import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { VideoProvider, CreateVideoResult, PlaybackUrlResult, VideoStatus } from "./types.ts";

export interface BunnyStreamConfig {
  /** Bunny Stream library ID */
  libraryId: string;
  /** Bunny Stream API key (for library management) */
  apiKey: string;
  /** CDN hostname for playback (e.g. "vz-abc123-456.b-cdn.net") */
  cdnHostname: string;
  /** CDN token authentication key (for signed playback URLs) */
  cdnTokenKey: string;
}

const BUNNY_API_BASE = "https://video.bunnycdn.com";
const TUS_UPLOAD_BASE = "https://video.bunnycdn.com/tusupload";

/** Default upload URL expiry: 1 hour */
const DEFAULT_UPLOAD_EXPIRY_SECONDS = 3600;
/** Default playback URL expiry: 4 hours */
const DEFAULT_PLAYBACK_EXPIRY_SECONDS = 14400;

/**
 * Map Bunny Stream's numeric status to our VideoStatus.
 * Bunny statuses: 0=created, 1=uploaded, 2=processing, 3=transcoding,
 *                 4=finished, 5=error, 6=upload_failed
 */
function mapBunnyStatus(bunnyStatus: number): VideoStatus["status"] {
  switch (bunnyStatus) {
    case 0:
      return "pending";
    case 1:
      return "uploading";
    case 2:
    case 3:
      return "processing";
    case 4:
      return "ready";
    default:
      return "failed";
  }
}

export class BunnyStreamProvider implements VideoProvider {
  readonly name = "bunny-stream";
  private config: BunnyStreamConfig;

  constructor(config: BunnyStreamConfig) {
    this.config = config;
  }

  async createUploadUrl(options: {
    title: string;
    expiresInSeconds?: number;
  }): Promise<CreateVideoResult> {
    const { libraryId, apiKey } = this.config;

    // Step 1: Create a video entry in Bunny Stream
    const createRes = await fetch(`${BUNNY_API_BASE}/library/${libraryId}/videos`, {
      method: "POST",
      headers: {
        AccessKey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: options.title }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Bunny Stream: failed to create video (${createRes.status}): ${body}`);
    }

    const video = (await createRes.json()) as { guid: string };
    const videoId = video.guid;

    // Step 2: Generate TUS upload authorization
    const expiresIn = options.expiresInSeconds ?? DEFAULT_UPLOAD_EXPIRY_SECONDS;
    const expirationTime = Math.floor(Date.now() / 1000) + expiresIn;

    const signature = createHash("sha256")
      .update(libraryId + apiKey + expirationTime + videoId)
      .digest("hex");

    return {
      videoId,
      uploadUrl: TUS_UPLOAD_BASE,
      uploadHeaders: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expirationTime),
        VideoId: videoId,
        LibraryId: libraryId,
      },
    };
  }

  async getPlaybackUrl(
    videoId: string,
    options?: { expiresInSeconds?: number },
  ): Promise<PlaybackUrlResult> {
    const { cdnHostname, cdnTokenKey } = this.config;
    const expiresIn = options?.expiresInSeconds ?? DEFAULT_PLAYBACK_EXPIRY_SECONDS;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    const urlPath = `/${videoId}/playlist.m3u8`;
    const token = this.generateCdnToken(cdnTokenKey, urlPath, expiresAt);

    const url = `https://${cdnHostname}${urlPath}?token=${token}&expires=${expiresAt}`;

    return { url, expiresAt };
  }

  async getVideoStatus(videoId: string): Promise<VideoStatus> {
    const { libraryId, apiKey } = this.config;

    const res = await fetch(`${BUNNY_API_BASE}/library/${libraryId}/videos/${videoId}`, {
      headers: { AccessKey: apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bunny Stream: failed to get video status (${res.status}): ${body}`);
    }

    const video = (await res.json()) as { guid: string; status: number };

    return {
      videoId: video.guid,
      status: mapBunnyStatus(video.status),
    };
  }

  async deleteVideo(videoId: string): Promise<void> {
    const { libraryId, apiKey } = this.config;

    const res = await fetch(`${BUNNY_API_BASE}/library/${libraryId}/videos/${videoId}`, {
      method: "DELETE",
      headers: { AccessKey: apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bunny Stream: failed to delete video (${res.status}): ${body}`);
    }
  }

  /**
   * Generate a Bunny CDN token authentication hash.
   * Format: base64url(sha256(securityKey + pathToSign + expirationTimestamp))
   */
  generateCdnToken(securityKey: string, urlPath: string, expirationTimestamp: number): string {
    const hash = createHash("sha256")
      .update(securityKey + urlPath + expirationTimestamp)
      .digest("base64");

    // Bunny CDN requires base64url encoding (replace +, /, =)
    return hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
}
