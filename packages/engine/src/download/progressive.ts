/**
 * Progressive (single-file) download: ranged, resumable, retrying.
 *
 * The easy delivery shape, with three details that are not:
 *
 *  - **Resume from the partial file.** After a mid-download failure we already
 *    have most of the bytes; re-fetching them wastes the user's time and the
 *    origin's bandwidth, and on a 4 GB file it is the difference between a
 *    retry succeeding and the job timing out.
 *  - **`200` in response to a `Range` request.** Plenty of origins ignore the
 *    header. That is not an error, but appending to the partial file would
 *    corrupt it — the partial has to be truncated first.
 *  - **No `Content-Length`.** Chunked responses have no total, so `totalBytes`
 *    and `percent` are null and the UI shows an indeterminate state. There is
 *    no honest number to put there.
 */

import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { AppError, redactUrl } from "@downloader/shared";
import type { JobProgress, JobStatus, RequestContext } from "@downloader/shared";
import type { Clock, FetchLike } from "../config.ts";
import { SYSTEM_CLOCK } from "../config.ts";
import { RateTracker } from "../ffmpeg/progress.ts";
import type { Logger } from "../logger.ts";
import { NOOP_LOGGER } from "../logger.ts";
import { httpRequest, parseContentLength, parseContentRangeTotal } from "./http.ts";
import type { RetryPolicy } from "./retry.ts";
import { withRetry } from "./retry.ts";

export interface ProgressiveDownloadOptions {
  url: string;
  /** Absolute path. Callers get this from `Storage.tmpPath()`, which confines it. */
  destPath: string;
  requestContext?: RequestContext | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: JobProgress) => void) | undefined;
  /** Runtime cap. Exceeding it aborts with `SIZE_LIMIT_EXCEEDED`. */
  maxBytes?: number | undefined;
  stage?: JobStatus;
  retryPolicy?: Partial<RetryPolicy> | undefined;
  fetchImpl?: FetchLike | undefined;
  clock?: Clock | undefined;
  logger?: Logger | undefined;
  /** Progress callback throttle. */
  progressIntervalMs?: number;
}

export interface ProgressiveDownloadResult {
  path: string;
  bytes: number;
  totalBytes: number | null;
  resumed: boolean;
}

const DEFAULT_PROGRESS_INTERVAL_MS = 250;

async function fileSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath).catch(() => null);
  return stat?.isFile() === true ? stat.size : 0;
}

export async function downloadProgressive(
  options: ProgressiveDownloadOptions,
): Promise<ProgressiveDownloadResult> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const logger = options.logger ?? NOOP_LOGGER;
  const stage: JobStatus = options.stage ?? "downloading";
  const progressIntervalMs = options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;

  await fs.mkdir(path.dirname(options.destPath), { recursive: true });

  const rate = new RateTracker();
  let knownTotal: number | null = null;
  let resumed = false;
  let lastEmit = 0;

  const emit = (downloaded: number, force: boolean): void => {
    if (options.onProgress === undefined) return;
    const now = clock.now();
    if (!force && now - lastEmit < progressIntervalMs) return;
    lastEmit = now;
    rate.record(downloaded, now);

    const speedBps = rate.bytesPerSecond();
    const total = knownTotal;
    const progress: JobProgress = {
      stage,
      percent: total !== null && total > 0 ? Math.min(100, (downloaded / total) * 100) : null,
      downloadedBytes: downloaded,
      totalBytes: total,
      segmentsDone: null,
      segmentsTotal: null,
      speedBps,
      etaSec:
        total !== null && speedBps !== null && speedBps > 0
          ? Math.max(0, (total - downloaded) / speedBps)
          : null,
      processedSec: null,
    };
    options.onProgress(progress);
  };

  const attempt = async (): Promise<void> => {
    let start = await fileSize(options.destPath);
    if (knownTotal !== null && start >= knownTotal && knownTotal > 0) return;

    const response = await httpRequest({
      url: options.url,
      requestContext: options.requestContext,
      ...(start > 0 ? { extraHeaders: { range: `bytes=${start}-` } } : {}),
      signal: options.signal,
      fetchImpl: options.fetchImpl,
    });

    if (response.status === 416) {
      // Our offset is past the end. Either the file is already complete or the
      // partial is from a different (longer) resource; truncating is the only
      // way to find out, and correctness beats saving one re-download.
      await response.body?.cancel().catch(() => undefined);
      const total = parseContentRangeTotal(response.headers.get("content-range"));
      if (total !== null && start === total) {
        knownTotal = total;
        return;
      }
      await fs.rm(options.destPath, { force: true });
      throw new AppError("DOWNLOAD_FAILED", "Partial file did not match the source; restarting.", {
        retryable: true,
        details: { url: redactUrl(options.url), offset: start },
      });
    }

    let append = false;
    if (response.status === 206) {
      append = start > 0;
      resumed ||= append;
      knownTotal = parseContentRangeTotal(response.headers.get("content-range")) ?? knownTotal;
    } else {
      if (start > 0) {
        logger.debug("origin ignored Range; restarting download", {
          url: redactUrl(options.url),
          discardedBytes: start,
        });
      }
      start = 0;
      const length = parseContentLength(response.headers.get("content-length"));
      knownTotal = length;
    }

    if (options.maxBytes !== undefined && knownTotal !== null && knownTotal > options.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new AppError("SIZE_LIMIT_EXCEEDED", undefined, {
        details: { totalBytes: knownTotal, limitBytes: options.maxBytes },
      });
    }

    if (response.body === null) {
      throw new AppError("DOWNLOAD_FAILED", "The origin returned no response body.", {
        retryable: true,
        details: { url: redactUrl(options.url), status: response.status },
      });
    }

    let downloaded = start;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback): void {
        downloaded += chunk.length;
        if (options.maxBytes !== undefined && downloaded > options.maxBytes) {
          callback(
            new AppError("SIZE_LIMIT_EXCEEDED", undefined, {
              details: { downloadedBytes: downloaded, limitBytes: options.maxBytes },
            }),
          );
          return;
        }
        emit(downloaded, false);
        callback(null, chunk);
      },
    });

    const source = Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>);
    const sink = createWriteStream(options.destPath, { flags: append ? "a" : "w" });

    try {
      await (options.signal === undefined
        ? pipeline(source, counter, sink)
        : pipeline(source, counter, sink, { signal: options.signal }));
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("JOB_CANCELED");
      }
      throw new AppError("DOWNLOAD_FAILED", "The transfer was interrupted.", {
        cause: error,
        retryable: true,
        details: { url: redactUrl(options.url), downloadedBytes: downloaded },
      });
    }

    emit(downloaded, true);

    if (knownTotal !== null && downloaded < knownTotal) {
      throw new AppError("DOWNLOAD_FAILED", "The transfer ended early.", {
        retryable: true,
        details: { downloadedBytes: downloaded, totalBytes: knownTotal },
      });
    }
  };

  await withRetry(attempt, {
    ...(options.retryPolicy === undefined ? {} : { policy: options.retryPolicy }),
    signal: options.signal,
    sleep: (ms, signal) => clock.sleep(ms, signal),
    onRetry: ({ attempt: n, delayMs, error }) => {
      logger.warn("retrying progressive download", {
        url: redactUrl(options.url),
        attempt: n,
        delayMs,
        code: error instanceof AppError ? error.code : "unknown",
      });
    },
  });

  const bytes = await fileSize(options.destPath);
  return { path: options.destPath, bytes, totalBytes: knownTotal, resumed };
}
