/**
 * Manifest download by handing the manifest straight to ffmpeg.
 *
 * This is the default path for HLS and DASH, and the reason is in analysis §6:
 * hand-rolled segment concatenation produces timestamp drift, broken seeking and
 * A/V desync on any stream with a discontinuity. ffmpeg also decrypts HLS
 * AES-128 natively, which keeps transport encryption firmly in scope without a
 * line of crypto code here.
 *
 * The whole download is therefore a single ffmpeg invocation that also produces
 * the final container — one pass, no intermediate file to remux.
 */

import fs from "node:fs/promises";
import type { JobProgress, RequestContext } from "@downloader/shared";
import { buildNetworkInputArgs, GLOBAL_ARGS, PROGRESS_ARGS } from "../ffmpeg/args.ts";
import { RateTracker, toJobProgress } from "../ffmpeg/progress.ts";
import { runFfmpeg } from "../ffmpeg/runner.ts";
import type { Logger } from "../logger.ts";
import { NOOP_LOGGER } from "../logger.ts";
import type { OutputContainer, StreamMap, TranscodeNotice } from "../mux.ts";
import { buildOutputArgs } from "../mux.ts";

export interface ManifestDownloadOptions {
  url: string;
  /** Separate audio rendition (DASH always, HLS with `EXT-X-MEDIA` groups). */
  audioUrl?: string | undefined;
  destPath: string;
  container: OutputContainer;
  /** Drives `-allowed_extensions` and the ADTS→ASC decision. */
  protocol: "hls" | "dash" | "other";
  requestContext?: RequestContext | undefined;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
  audioOnly?: boolean;
  title?: string | undefined;
  /** Known media duration; the only source of a real percentage. */
  durationSec?: number | null;
  /** Live sources have no end, so a caller-supplied limit becomes `-t`. */
  liveDurationSec?: number | null | undefined;
  ffmpegPath: string;
  proxyUrl?: string | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  maxOutputBytes?: number | undefined;
  onProgress?: ((progress: JobProgress) => void) | undefined;
  logger?: Logger | undefined;
}

export interface ManifestDownloadResult {
  path: string;
  bytes: number;
  durationSec: number | null;
  transcodes: TranscodeNotice[];
  args: string[];
}

/** Exported for tests: the full argv, without spawning anything. */
export function buildManifestDownloadArgs(options: ManifestDownloadOptions): {
  args: string[];
  transcodes: TranscodeNotice[];
} {
  const args: string[] = [...GLOBAL_ARGS, ...PROGRESS_ARGS];
  const maps: StreamMap[] = [];

  const audioOnly = options.audioOnly === true;
  const separateAudio = typeof options.audioUrl === "string" && options.audioUrl.length > 0;

  // With `audioOnly` and a separate audio rendition there is no reason to open
  // the video manifest at all — opening it would download video we then discard.
  const skipPrimaryInput = audioOnly && separateAudio;

  let inputIndex = 0;
  if (!skipPrimaryInput) {
    args.push(
      ...buildNetworkInputArgs(options.url, {
        requestContext: options.requestContext,
        hlsAllowAllExtensions: options.protocol === "hls",
      }),
    );
    if (options.hasVideo && !audioOnly) {
      maps.push({ inputIndex, kind: "video", streamIndex: 0, optional: true });
    }
    if (options.hasAudio && !separateAudio) {
      maps.push({ inputIndex, kind: "audio", streamIndex: 0, optional: true });
    }
    inputIndex += 1;
  }

  if (separateAudio) {
    args.push(
      // Replayed again on purpose: the audio rendition is a separate origin
      // request and is gated by exactly the same checks.
      ...buildNetworkInputArgs(options.audioUrl as string, {
        requestContext: options.requestContext,
        hlsAllowAllExtensions: options.protocol === "hls",
      }),
    );
    maps.push({ inputIndex, kind: "audio", streamIndex: 0, optional: true });
  }

  const output = buildOutputArgs({
    container: options.container,
    maps,
    videoCodec: options.videoCodec,
    audioCodec: options.audioCodec,
    ...(options.audioOnly === undefined ? {} : { audioOnly: options.audioOnly }),
    durationLimitSec: options.liveDurationSec,
    sourceMayBeMpegTs: options.protocol === "hls",
    title: options.title,
  });

  args.push(...output.args, options.destPath);
  return { args, transcodes: output.transcodes };
}

export async function downloadViaFfmpeg(
  options: ManifestDownloadOptions,
): Promise<ManifestDownloadResult> {
  const logger = options.logger ?? NOOP_LOGGER;
  const { args, transcodes } = buildManifestDownloadArgs(options);

  for (const notice of transcodes) {
    logger.warn("transcoding a stream — this is slow and lossy", {
      kind: notice.kind,
      from: notice.from,
      to: notice.to,
      container: options.container,
      reason: notice.reason,
    });
  }

  // A live capture's duration is the caller's limit; a VOD's is the manifest's.
  const durationSec = options.liveDurationSec ?? options.durationSec ?? null;
  const rate = new RateTracker();

  const result = await runFfmpeg({
    ffmpegPath: options.ffmpegPath,
    args,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    proxyUrl: options.proxyUrl,
    // ffmpeg is doing the fetching here, so a failure is a download failure.
    failureCode: "DOWNLOAD_FAILED",
    logger,
    onProgress: (snapshot) => {
      if (options.onProgress === undefined) return;
      const now = Date.now();
      if (snapshot.totalSize !== null) rate.record(snapshot.totalSize, now);
      options.onProgress(
        toJobProgress(snapshot, {
          stage: "downloading",
          durationSec,
          // Manifest downloads have no announced byte total; percent comes from
          // media time instead, and stays null when the duration is unknown.
          totalBytes: null,
          speedBps: rate.bytesPerSecond(),
        }),
      );
    },
    onStderrLine: (line) => {
      logger.debug("ffmpeg", { line });
    },
  });

  const stat = await fs.stat(options.destPath);
  const observedSec = result.lastSnapshot?.outTimeUs ?? null;

  return {
    path: options.destPath,
    bytes: stat.size,
    durationSec: observedSec === null ? durationSec : observedSec / 1_000_000,
    transcodes,
    args,
  };
}
