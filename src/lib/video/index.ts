import "@tanstack/react-start/server-only";
import type { VideoProvider } from "./types.ts";
import { BunnyStreamProvider } from "./bunny-stream.ts";

export type { VideoProvider } from "./types.ts";
export type { CreateVideoResult, PlaybackUrlResult, VideoStatus } from "./types.ts";

let cachedProvider: VideoProvider | null = null;

/**
 * Returns the configured video provider singleton.
 *
 * Currently only Bunny Stream is supported. The abstraction allows
 * swapping to another provider (e.g. Cloudflare Stream) in the future
 * by changing this factory function.
 */
export function getVideoProvider(): VideoProvider {
  if (cachedProvider) return cachedProvider;

  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  const cdnHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  const cdnTokenKey = process.env.BUNNY_STREAM_CDN_TOKEN_KEY;

  if (!libraryId || !apiKey || !cdnHostname || !cdnTokenKey) {
    throw new Error(
      "Missing Bunny Stream configuration. Set BUNNY_STREAM_LIBRARY_ID, " +
        "BUNNY_STREAM_API_KEY, BUNNY_STREAM_CDN_HOSTNAME, and " +
        "BUNNY_STREAM_CDN_TOKEN_KEY environment variables.",
    );
  }

  cachedProvider = new BunnyStreamProvider({
    libraryId,
    apiKey,
    cdnHostname,
    cdnTokenKey,
  });

  return cachedProvider;
}
