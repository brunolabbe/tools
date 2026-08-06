/**
 * Manual segment fetching — the fallback, not the default.
 *
 * ffmpeg reading the manifest directly is correct in ways a hand-rolled
 * downloader is not: it decrypts AES-128, honours discontinuities, and rebases
 * timestamps. So this path exists only for the case the brief carves out —
 * ffmpeg cannot replay the required headers — and even then it hands the fetched
 * segments *back* to ffmpeg's concat demuxer for assembly rather than
 * concatenating bytes itself.
 *
 * The engine deliberately does not parse playlists: that lives in
 * `packages/resolvers` (WP-1) and duplicating it here would give the project two
 * HLS parsers that drift apart. The caller supplies the segment URL list.
 */

import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { AppError } from "@downloader/shared";
import type { JobProgress, JobStatus, RequestContext } from "@downloader/shared";
import type { Clock, FetchLike } from "../config.ts";
import { SYSTEM_CLOCK } from "../config.ts";
import { buildLocalInputArgs, GLOBAL_ARGS, PROGRESS_ARGS } from "../ffmpeg/args.ts";
import { RateTracker } from "../ffmpeg/progress.ts";
import { runFfmpeg } from "../ffmpeg/runner.ts";
import type { Logger } from "../logger.ts";
import { NOOP_LOGGER } from "../logger.ts";
import type { OutputContainer, StreamMap, TranscodeNotice } from "../mux.ts";
import { buildOutputArgs } from "../mux.ts";
import { redactUrl } from "../redact.ts";
import { assertPathInside } from "../storage.ts";
import { httpRequest } from "./http.ts";
import { mapWithConcurrency } from "./pool.ts";
import type { RetryPolicy } from "./retry.ts";
import { withRetry } from "./retry.ts";

export interface SegmentDownloadOptions {
  segmentUrls: readonly string[];
  /** Directory the segments are written into. Must already be confined. */
  workDir: string;
  requestContext?: RequestContext | undefined;
  concurrency?: number;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: JobProgress) => void) | undefined;
  stage?: JobStatus;
  maxBytes?: number | undefined;
  retryPolicy?: Partial<RetryPolicy> | undefined;
  fetchImpl?: FetchLike | undefined;
  clock?: Clock | undefined;
  logger?: Logger | undefined;
}

export interface SegmentDownloadResult {
  /** Absolute paths, in playlist order. */
  files: string[];
  bytes: number;
}

/** Zero-padded so the on-disk order matches the playlist order. */
function segmentFilename(index: number, url: string): string {
  const extension = path.extname(new URL(url, "http://placeholder.invalid").pathname);
  const safeExtension = /^\.[a-z0-9]{1,5}$/iu.test(extension) ? extension.toLowerCase() : ".seg";
  return `${String(index).padStart(6, "0")}${safeExtension}`;
}

export async function downloadSegments(
  options: SegmentDownloadOptions,
): Promise<SegmentDownloadResult> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const logger = options.logger ?? NOOP_LOGGER;
  const stage: JobStatus = options.stage ?? "downloading";
  const total = options.segmentUrls.length;

  await fs.mkdir(options.workDir, { recursive: true });

  const rate = new RateTracker();
  let downloadedBytes = 0;

  const emit = (segmentsDone: number): void => {
    if (options.onProgress === undefined) return;
    const now = clock.now();
    rate.record(downloadedBytes, now);
    const speedBps = rate.bytesPerSecond();
    const percent = total > 0 ? (segmentsDone / total) * 100 : null;
    options.onProgress({
      stage,
      percent,
      downloadedBytes,
      // Segment counts are known; total *bytes* are not until the last one lands.
      totalBytes: null,
      segmentsDone,
      segmentsTotal: total,
      speedBps,
      etaSec:
        percent !== null && percent > 0 && speedBps !== null && speedBps > 0
          ? ((total - segmentsDone) * (downloadedBytes / Math.max(1, segmentsDone))) / speedBps
          : null,
      processedSec: null,
    });
  };

  const fetchOne = async (url: string, index: number): Promise<string> => {
    const destPath = assertPathInside(options.workDir, segmentFilename(index, url));

    await withRetry(
      async () => {
        const response = await httpRequest({
          url,
          requestContext: options.requestContext,
          signal: options.signal,
          fetchImpl: options.fetchImpl,
        });
        if (response.body === null) {
          throw new AppError("DOWNLOAD_FAILED", "Segment response had no body.", {
            retryable: true,
            details: { url: redactUrl(url), index },
          });
        }
        const source = Readable.fromWeb(
          response.body as unknown as NodeWebReadableStream<Uint8Array>,
        );
        const sink = createWriteStream(destPath);
        await (options.signal === undefined
          ? pipeline(source, sink)
          : pipeline(source, sink, { signal: options.signal }));
      },
      {
        ...(options.retryPolicy === undefined ? {} : { policy: options.retryPolicy }),
        signal: options.signal,
        sleep: (ms, signal) => clock.sleep(ms, signal),
        onRetry: ({ attempt, delayMs, error }) => {
          logger.warn("retrying segment", {
            index,
            attempt,
            delayMs,
            code: error instanceof AppError ? error.code : "unknown",
          });
        },
      },
    );

    const stat = await fs.stat(destPath);
    downloadedBytes += stat.size;
    if (options.maxBytes !== undefined && downloadedBytes > options.maxBytes) {
      throw new AppError("SIZE_LIMIT_EXCEEDED", undefined, {
        details: { downloadedBytes, limitBytes: options.maxBytes },
      });
    }
    return destPath;
  };

  const files = await mapWithConcurrency(options.segmentUrls, fetchOne, {
    concurrency: options.concurrency ?? 6,
    signal: options.signal,
    onSettled: (done) => {
      emit(done);
    },
  });

  return { files, bytes: downloadedBytes };
}

/**
 * Writes an ffmpeg concat-demuxer list.
 *
 * Forward slashes even on Windows (ffmpeg's own parser, not the OS), and the
 * documented `'\''` escape so a quote in a path cannot terminate the entry.
 */
export function buildConcatList(files: readonly string[]): string {
  return (
    files
      .map((file) => `file '${file.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`)
      .join("\n") + "\n"
  );
}

export async function writeConcatList(files: readonly string[], listPath: string): Promise<string> {
  await fs.writeFile(listPath, buildConcatList(files), "utf8");
  return listPath;
}

export interface SegmentAssemblyOptions extends SegmentDownloadOptions {
  destPath: string;
  container: OutputContainer;
  ffmpegPath: string;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
  audioOnly?: boolean;
  title?: string | undefined;
  durationSec?: number | null;
  timeoutMs?: number | undefined;
  sourceMayBeMpegTs?: boolean;
}

export interface SegmentAssemblyResult {
  path: string;
  bytes: number;
  durationSec: number | null;
  transcodes: TranscodeNotice[];
}

/**
 * The complete fallback: fetch every segment ourselves, then let ffmpeg's concat
 * demuxer assemble them. We take over the *fetching* only — assembly stays with
 * ffmpeg, because that is the part hand-rolling gets wrong.
 */
export async function downloadViaSegments(
  options: SegmentAssemblyOptions,
): Promise<SegmentAssemblyResult> {
  const logger = options.logger ?? NOOP_LOGGER;
  const { files } = await downloadSegments(options);

  if (files.length === 0) {
    throw new AppError("DOWNLOAD_FAILED", "The playlist contained no segments.", {
      details: { workDir: options.workDir },
    });
  }

  const listPath = assertPathInside(options.workDir, "concat.txt");
  await writeConcatList(files, listPath);

  const maps: StreamMap[] = [];
  if (options.hasVideo && options.audioOnly !== true) {
    maps.push({ inputIndex: 0, kind: "video", streamIndex: 0, optional: true });
  }
  if (options.hasAudio) {
    maps.push({ inputIndex: 0, kind: "audio", streamIndex: 0, optional: true });
  }

  const output = buildOutputArgs({
    container: options.container,
    maps,
    videoCodec: options.videoCodec,
    audioCodec: options.audioCodec,
    ...(options.audioOnly === undefined ? {} : { audioOnly: options.audioOnly }),
    sourceMayBeMpegTs: options.sourceMayBeMpegTs ?? true,
    title: options.title,
  });

  for (const notice of output.transcodes) {
    logger.warn("transcoding a stream — this is slow and lossy", {
      kind: notice.kind,
      from: notice.from,
      to: notice.to,
      container: options.container,
      reason: notice.reason,
    });
  }

  const args = [
    ...GLOBAL_ARGS,
    ...PROGRESS_ARGS,
    ...buildLocalInputArgs(listPath, ["-f", "concat", "-safe", "0"]),
    ...output.args,
    options.destPath,
  ];

  await runFfmpeg({
    ffmpegPath: options.ffmpegPath,
    args,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxBytes,
    // The bytes are already local; a failure now is an assembly failure.
    failureCode: "MUX_FAILED",
    logger,
  });

  const stat = await fs.stat(options.destPath);
  return {
    path: options.destPath,
    bytes: stat.size,
    durationSec: options.durationSec ?? null,
    transcodes: output.transcodes,
  };
}
