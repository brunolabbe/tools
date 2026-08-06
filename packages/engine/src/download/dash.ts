/**
 * DASH download.
 *
 * Same reasoning as HLS: ffmpeg reads the `.mpd`, resolves `SegmentTemplate`
 * substitution and byte-range indexes, and gets timestamps right.
 *
 * The DASH-specific part is that audio and video are almost always in separate
 * adaptation sets, so `MediaVariant.audioUrl` is usually populated. That becomes
 * a second `-i` with its own replayed headers and explicit `-map` for each — the
 * "silently lost the audio track" failure is exactly what omitting `-map` causes.
 *
 * `sourceMayBeMpegTs` is false for DASH: its segments are fragmented MP4, whose
 * AAC is already in ASC form, so the ADTS→ASC bitstream filter has nothing to do.
 */

import type { ManifestDownloadOptions, ManifestDownloadResult } from "./manifest.ts";
import { downloadViaFfmpeg } from "./manifest.ts";
import type { Clock, FetchLike } from "../config.ts";
import type { RetryPolicy } from "./retry.ts";
import { downloadViaSegments } from "./segments.ts";

export interface DashDownloadOptions extends Omit<ManifestDownloadOptions, "protocol"> {
  /** Forces the manual path; the caller supplies the expanded template URLs. */
  segmentUrls?: readonly string[] | undefined;
  workDir?: string | undefined;
  concurrency?: number | undefined;
  retryPolicy?: Partial<RetryPolicy> | undefined;
  fetchImpl?: FetchLike | undefined;
  clock?: Clock | undefined;
}

export async function downloadDash(options: DashDownloadOptions): Promise<ManifestDownloadResult> {
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
      sourceMayBeMpegTs: false,
    });
    return { ...result, args: [] };
  }

  return downloadViaFfmpeg({ ...options, protocol: "dash" });
}
