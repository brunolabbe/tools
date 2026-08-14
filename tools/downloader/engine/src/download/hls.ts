/**
 * HLS download.
 *
 * Default path: hand `master.m3u8` (or the variant playlist) to ffmpeg. It
 * follows the playlist, decrypts `EXT-X-KEY:METHOD=AES-128` using the in-manifest
 * key URI — ordinary transport encryption, fully in scope per analysis §3 — and
 * rebases timestamps across discontinuities.
 *
 * Fallback path: `segmentUrls`. Supplying it takes fetching away from ffmpeg
 * for the case where ffmpeg cannot replay what the origin demands (per-segment
 * rotating tokens, a cookie jar that changes mid-playlist). Assembly still goes
 * through ffmpeg's concat demuxer. The engine does not parse playlists — the
 * caller gets the URL list from the dl-1 parsers in `packages/resolvers`.
 */

import type { ManifestDownloadOptions, ManifestDownloadResult } from "./manifest.ts";
import { downloadViaFfmpeg } from "./manifest.ts";
import type { Clock, FetchLike } from "../config.ts";
import type { RetryPolicy } from "./retry.ts";
import { downloadViaSegments } from "./segments.ts";

export interface HlsDownloadOptions extends Omit<ManifestDownloadOptions, "protocol"> {
  /**
   * Forces the manual path. Absent (the normal case) means ffmpeg reads the
   * playlist itself, which is what you want unless it demonstrably cannot.
   */
  segmentUrls?: readonly string[] | undefined;
  /** Required with `segmentUrls`: where the segments land. */
  workDir?: string | undefined;
  concurrency?: number | undefined;
  retryPolicy?: Partial<RetryPolicy> | undefined;
  fetchImpl?: FetchLike | undefined;
  clock?: Clock | undefined;
}

export async function downloadHls(options: HlsDownloadOptions): Promise<ManifestDownloadResult> {
  if (options.segmentUrls !== undefined && options.workDir !== undefined) {
    const result = await downloadViaSegments({
      segmentUrls: options.segmentUrls,
      workDir: options.workDir,
      requestContext: options.requestContext,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      signal: options.signal,
      onProgress: options.onProgress,
      maxBytes: options.maxOutputBytes,
      retryPolicy: options.retryPolicy,
      fetchImpl: options.fetchImpl,
      clock: options.clock,
      logger: options.logger,
      destPath: options.destPath,
      container: options.container,
      ffmpegPath: options.ffmpegPath,
      hasVideo: options.hasVideo,
      hasAudio: options.hasAudio,
      videoCodec: options.videoCodec,
      audioCodec: options.audioCodec,
      ...(options.audioOnly === undefined ? {} : { audioOnly: options.audioOnly }),
      title: options.title,
      durationSec: options.durationSec ?? null,
      timeoutMs: options.timeoutMs,
      sourceMayBeMpegTs: true,
    });
    return { ...result, args: [] };
  }

  return downloadViaFfmpeg({ ...options, protocol: "hls" });
}
