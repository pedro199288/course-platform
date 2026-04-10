export interface CreateVideoResult {
  /** Provider-specific video ID */
  videoId: string;
  /** TUS or direct upload endpoint for the browser */
  uploadUrl: string;
  /** Additional headers the browser must send with the upload */
  uploadHeaders: Record<string, string>;
}

export interface PlaybackUrlResult {
  /** Signed playback URL (HLS manifest) */
  url: string;
  /** When the URL expires (epoch seconds) */
  expiresAt: number;
}

export interface VideoStatus {
  videoId: string;
  status: "pending" | "uploading" | "processing" | "ready" | "failed";
}

export interface VideoProvider {
  readonly name: string;

  /**
   * Create a new video entry and return a signed upload URL
   * so the browser can upload directly to the provider.
   */
  createUploadUrl(options: {
    title: string;
    /** Expiry for the upload URL in seconds (default: provider-specific) */
    expiresInSeconds?: number;
  }): Promise<CreateVideoResult>;

  /**
   * Generate a short-lived signed playback URL (HLS).
   */
  getPlaybackUrl(
    videoId: string,
    options?: { expiresInSeconds?: number },
  ): Promise<PlaybackUrlResult>;

  /**
   * Query the provider for the current video processing status.
   */
  getVideoStatus(videoId: string): Promise<VideoStatus>;

  /**
   * Delete a video from the provider.
   */
  deleteVideo(videoId: string): Promise<void>;
}
