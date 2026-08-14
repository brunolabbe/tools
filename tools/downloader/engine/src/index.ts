/**
 * `@downloader/engine` — the public surface.
 *
 * The engine's contract is one sentence: **a `MediaVariant` plus the
 * `RequestContext` captured with it, in; one finished file under `STORAGE_DIR`,
 * out; `JobProgress` along the way.** It owns ffmpeg, the filesystem layout and
 * the retention sweep, and it owns nothing else — it never resolves a URL,
 * never touches a database, and never decides job state. Those belong to
 * `apps/api` (dl-5), which is the only intended consumer of this module.
 *
 * ## The seam dl-5 consumes
 *
 * ```ts
 * const engine = createEngine({ storageDir, maxFileSizeBytes, logger });
 * await engine.init();
 *
 * const outcome = await engine.download({
 *   jobId,                     // becomes tmp/<jobId>/ and out/<jobId>/
 *   variant,                   // from the *re-probe*, never the original probe
 *   requestContext,            // replayed on the manifest and every segment
 *   title, durationSec, isLive, subtitles,
 *   options,                   // the JobOptions the client sent
 *   signal,                    // cancel -> JOB_CANCELED, process tree killed
 *   onProgress, onStage,       // feed straight into the SSE JobEvent union
 * });
 * // outcome.path is an absolute path inside STORAGE_DIR/out/<jobId>/.
 * // Map it to a capability token and build JobResult from the rest.
 *
 * setInterval(() => void engine.collectGarbage(), 15 * 60_000);
 * ```
 *
 * Notes for the caller:
 *  - `download()` throws `AppError` and nothing else. `JOB_CANCELED`,
 *    `VARIANT_GONE` (re-probe and retry), `SIZE_LIMIT_EXCEEDED`, `DISK_FULL`,
 *    `DOWNLOAD_FAILED`, `MUX_FAILED`, `TIMEOUT`, `LIVE_STREAM_UNSUPPORTED`.
 *  - `tmp/<jobId>/` is removed on every terminal state; on failure or cancel
 *    `out/<jobId>/` goes too, so a failed job leaves nothing behind.
 *  - The engine does not re-probe. Signed URLs expire in 30–300 s (analysis §5),
 *    so the orchestrator must hand in a *fresh* variant; passing a stale one is
 *    how `VARIANT_GONE` happens.
 *  - The engine does not enforce SSRF policy on `variant.url`. Resolver output
 *    is attacker-influenced, so dl-6's guard must run before this is called.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { AppError, redactRequestContext } from "@downloader/contract";
import type {
  JobOptions,
  JobProgress,
  JobStatus,
  MediaVariant,
  RequestContext,
  SubtitleTrack,
} from "@downloader/contract";
import type { EngineConfig, EngineConfigInput } from "./config.ts";
import { loadEngineConfig } from "./config.ts";
import { downloadDash } from "./download/dash.ts";
import { downloadHls } from "./download/hls.ts";
import { downloadViaFfmpeg } from "./download/manifest.ts";
import { downloadProgressive } from "./download/progressive.ts";
import { assertDiskSpace, assertWithinSizeLimit, estimateVariantBytes } from "./estimate.ts";
import type { Logger } from "./logger.ts";
import type { MuxInputFile, OutputContainer, TranscodeNotice } from "./mux.ts";
import { CONTAINER_EXTENSIONS, mux } from "./mux.ts";
import type { GcReport } from "./storage.ts";
import { assertRealPathInside, sanitizeFilename, Storage } from "./storage.ts";

export interface DownloadRequest {
  /** Names `tmp/<jobId>/` and `out/<jobId>/`. Sanitised before use as a path. */
  jobId: string;
  /** From the re-probe performed immediately before the download. */
  variant: MediaVariant;
  requestContext: RequestContext;
  /** Source title; sanitised into the output filename. */
  title?: string | undefined;
  /** Probe-level duration, used when the variant carries none. */
  durationSec?: number | null;
  isLive?: boolean;
  subtitles?: readonly SubtitleTrack[];
  options?: JobOptions;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: JobProgress) => void) | undefined;
  /** Fires on `downloading` and `muxing`; the orchestrator owns the FSM. */
  onStage?: ((stage: JobStatus) => void) | undefined;
  /**
   * Forces the manual segment-fetch path (bounded concurrency pool, then
   * ffmpeg's concat demuxer). Only for sources where ffmpeg demonstrably cannot
   * replay the required headers. URLs come from the dl-1 manifest parsers.
   */
  segmentUrls?: readonly string[] | undefined;
}

export interface DownloadOutcome {
  jobId: string;
  /** Absolute path inside `STORAGE_DIR/out/<jobId>/`. */
  path: string;
  filename: string;
  sizeBytes: number;
  /** `mp4` / `mkv` / `webm`, matching `JobResult.container`. */
  container: string;
  durationSec: number | null;
  /** Non-empty only when a container could not carry a codec. Worth surfacing. */
  transcodes: TranscodeNotice[];
}

export interface DownloadEngine {
  readonly config: EngineConfig;
  readonly storage: Storage;
  /** Creates `tmp/` and `out/`. Call once at boot. */
  init(): Promise<void>;
  download(request: DownloadRequest): Promise<DownloadOutcome>;
  /** Retention sweep: expired `out/` dirs and orphaned `tmp/` dirs. */
  collectGarbage(now?: number): Promise<GcReport>;
  /** Removes both directories for a job. For cancel and for post-serve cleanup. */
  removeJob(jobId: string): Promise<void>;
}

const SUBTITLE_FORMATS_FFMPEG_READS: ReadonlySet<string> = new Set(["vtt", "srt"]);

/** `source` keeps the origin container when we can hold it; otherwise MP4. */
export function resolveContainer(
  variant: MediaVariant,
  requested: JobOptions["container"],
): OutputContainer {
  if (requested === "mkv" || requested === "webm" || requested === "mp4") return requested;

  if (requested === "source") {
    const source = variant.container?.toLowerCase().replace(/^\./u, "");
    if (source === "mkv" || source === "matroska") return "mkv";
    if (source === "webm") return "webm";
  }
  // MP4 is the default because it is the one container every browser plays.
  return "mp4";
}

function outputExtension(container: OutputContainer, audioOnly: boolean): string {
  if (audioOnly && container === "mp4") return ".m4a";
  if (audioOnly && container === "webm") return ".webm";
  return CONTAINER_EXTENSIONS[container];
}

/** `rename` first; a storage dir spanning devices is unusual but not impossible. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}

class Engine implements DownloadEngine {
  readonly config: EngineConfig;
  readonly storage: Storage;
  readonly #logger: Logger;

  constructor(input: EngineConfigInput = {}) {
    this.config = loadEngineConfig(input);
    this.#logger = this.config.logger;
    this.storage = new Storage({
      storageDir: this.config.storageDir,
      fileRetentionHours: this.config.fileRetentionHours,
      tmpRetentionHours: this.config.tmpRetentionHours,
      logger: this.#logger,
    });

    if (this.config.proxyUrl !== undefined && this.config.fetchImpl === globalThis.fetch) {
      // Node's global fetch has no proxy support. ffmpeg still gets the proxy via
      // http_proxy, so manifest downloads are covered; direct fetches are not.
      this.#logger.warn(
        "PROXY_URL is set but no proxy-aware fetch was injected; direct fetches will bypass it",
      );
    }
  }

  async init(): Promise<void> {
    await this.storage.init();
  }

  async collectGarbage(now?: number): Promise<GcReport> {
    return this.storage.collectGarbage(now);
  }

  async removeJob(jobId: string): Promise<void> {
    await this.storage.removeJob(jobId);
  }

  async download(request: DownloadRequest): Promise<DownloadOutcome> {
    const { variant, jobId } = request;
    const options: JobOptions = request.options ?? {};
    const audioOnly = options.audioOnly === true;
    const container = resolveContainer(variant, options.container);
    const extension = outputExtension(container, audioOnly);
    const durationSec = request.durationSec ?? variant.durationSec ?? null;

    if (request.isLive === true && (options.liveDurationSec ?? 0) <= 0) {
      throw new AppError("LIVE_STREAM_UNSUPPORTED", undefined, {
        details: { jobId, variantId: variant.id },
      });
    }

    this.#logger.debug("engine download starting", {
      jobId,
      variantId: variant.id,
      protocol: variant.protocol,
      container,
      requestContext: redactRequestContext(request.requestContext),
    });

    // Refuse the four-hour 4K file before a byte moves, not after.
    const estimate = estimateVariantBytes(variant, {
      durationSec,
      liveDurationSec: options.liveDurationSec ?? null,
    });
    assertWithinSizeLimit(estimate, this.config.maxFileSizeBytes, {
      jobId,
      variantId: variant.id,
    });
    await this.storage.init();
    await this.#assertStorageQuota(estimate.bytes, { jobId, variantId: variant.id });
    await assertDiskSpace(this.storage.root, { requiredBytes: estimate.bytes });

    const workDir = await this.storage.createTmpDir(jobId);

    try {
      request.onStage?.("downloading");
      const downloaded = await this.#downloadMedia(request, {
        container,
        extension,
        audioOnly,
        durationSec,
        workDir,
      });

      request.onStage?.("muxing");
      const assembled = await this.#assemble(request, {
        container,
        extension,
        audioOnly,
        media: downloaded,
        workDir,
      });

      await this.storage.createOutDir(jobId);
      const filename = sanitizeFilename(`${request.title ?? "video"}${extension}`, {
        fallback: `download${extension}`,
      });
      const outPath = this.storage.outPath(jobId, filename);
      await assertRealPathInside(this.storage.root, outPath);
      await moveFile(assembled.path, outPath);

      const stat = await fs.stat(outPath);
      this.#logger.info("engine download complete", {
        jobId,
        sizeBytes: stat.size,
        container,
        durationSec: assembled.durationSec,
      });

      return {
        jobId,
        path: outPath,
        filename: path.basename(outPath),
        sizeBytes: stat.size,
        container,
        durationSec: assembled.durationSec,
        transcodes: assembled.transcodes,
      };
    } catch (error: unknown) {
      const appError = AppError.from(error);
      this.#logger.warn("engine download failed", { jobId, code: appError.code });
      // A failed or canceled job must not leave a half-written artifact behind
      // that the retention sweep would later serve as if it were complete.
      await this.storage.removeJob(jobId);
      throw appError;
    } finally {
      await this.storage.cleanupJob(jobId);
    }
  }

  /**
   * The global storage quota, checked before a byte moves.
   *
   * Sweeps first and re-measures rather than refusing straight away: everything
   * the sweep removes was already past its retention window, so it was going to
   * go on the next tick anyway, and failing a download while holding files we
   * had promised to delete would be a self-inflicted outage. If the space is
   * still not there, the answer is honest — this is over the *configured* cap,
   * so `SIZE_LIMIT_EXCEEDED` rather than `DISK_FULL`, which means the volume.
   */
  async #assertStorageQuota(
    estimatedBytes: number | null,
    context: { jobId: string; variantId: string },
  ): Promise<void> {
    const quota = this.config.maxTotalStorageBytes;
    if (quota <= 0) return;

    const wanted = Math.max(0, estimatedBytes ?? 0);
    let used = await this.storage.usedBytes();
    if (used + wanted <= quota) return;

    await this.collectGarbage();
    used = await this.storage.usedBytes();
    if (used + wanted <= quota) return;

    throw new AppError(
      "SIZE_LIMIT_EXCEEDED",
      "The server has reached its storage quota. Try again once earlier downloads expire.",
      {
        details: {
          ...context,
          usedBytes: used,
          limitBytes: quota,
          ...(estimatedBytes === null ? {} : { estimatedBytes }),
        },
      },
    );
  }

  async #downloadMedia(
    request: DownloadRequest,
    context: {
      container: OutputContainer;
      extension: string;
      audioOnly: boolean;
      durationSec: number | null;
      workDir: string;
    },
  ): Promise<{
    videoPath: string;
    audioPath: string | null;
    durationSec: number | null;
    transcodes: TranscodeNotice[];
    alreadyInTargetContainer: boolean;
  }> {
    const { variant, jobId } = request;
    const options: JobOptions = request.options ?? {};
    const liveDurationSec = options.liveDurationSec ?? null;

    if (variant.protocol === "hls" || variant.protocol === "dash" || variant.protocol === "other") {
      // One ffmpeg pass fetches, decrypts, concatenates and writes the final
      // container. There is nothing left to remux afterwards.
      const destPath = this.storage.tmpPath(jobId, `media${context.extension}`);
      const shared = {
        url: variant.url,
        audioUrl: variant.audioUrl,
        destPath,
        container: context.container,
        requestContext: request.requestContext,
        hasVideo: variant.hasVideo,
        hasAudio: variant.hasAudio,
        videoCodec: variant.videoCodec,
        audioCodec: variant.audioCodec,
        audioOnly: context.audioOnly,
        title: request.title,
        durationSec: context.durationSec,
        liveDurationSec,
        ffmpegPath: this.config.ffmpegPath,
        proxyUrl: this.config.proxyUrl,
        signal: request.signal,
        timeoutMs: this.config.stageTimeoutMs,
        maxOutputBytes: this.config.maxFileSizeBytes,
        onProgress: request.onProgress,
        logger: this.#logger,
      };

      const fallback = {
        segmentUrls: request.segmentUrls,
        workDir: context.workDir,
        concurrency: this.config.segmentConcurrency,
        fetchImpl: this.config.fetchImpl,
        clock: this.config.clock,
      };

      let result;
      if (variant.protocol === "dash") {
        result = await downloadDash({ ...shared, ...fallback });
      } else if (variant.protocol === "hls") {
        result = await downloadHls({ ...shared, ...fallback });
      } else {
        // Long-tail transports (Smooth Streaming, RTMP): hand the URL to ffmpeg
        // as-is. No HLS-specific options, no manual segment path.
        result = await downloadViaFfmpeg({ ...shared, protocol: "other" });
      }

      return {
        videoPath: result.path,
        audioPath: null,
        durationSec: result.durationSec,
        transcodes: result.transcodes,
        alreadyInTargetContainer: true,
      };
    }

    // Progressive: plain ranged GETs, one per URL.
    const sourceExtension = path.extname(new URL(variant.url).pathname) || context.extension;
    const videoPath = this.storage.tmpPath(jobId, `media${sourceExtension}`);
    const video = await downloadProgressive({
      url: variant.url,
      destPath: videoPath,
      requestContext: request.requestContext,
      signal: request.signal,
      onProgress: request.onProgress,
      maxBytes: this.config.maxFileSizeBytes,
      fetchImpl: this.config.fetchImpl,
      clock: this.config.clock,
      logger: this.#logger,
      retryPolicy: {
        maxAttempts: this.config.maxAttempts,
        baseMs: this.config.baseBackoffMs,
        maxMs: this.config.maxBackoffMs,
      },
    });

    let audioPath: string | null = null;
    if (typeof variant.audioUrl === "string" && variant.audioUrl.length > 0) {
      audioPath = this.storage.tmpPath(jobId, "audio.bin");
      await downloadProgressive({
        url: variant.audioUrl,
        destPath: audioPath,
        // Replayed here too: a separate rendition is a separate gated request.
        requestContext: request.requestContext,
        signal: request.signal,
        maxBytes: this.config.maxFileSizeBytes,
        fetchImpl: this.config.fetchImpl,
        clock: this.config.clock,
        logger: this.#logger,
      });
    }

    return {
      videoPath: video.path,
      audioPath,
      durationSec: context.durationSec,
      transcodes: [],
      alreadyInTargetContainer:
        audioPath === null && sourceExtension.toLowerCase() === context.extension.toLowerCase(),
    };
  }

  async #assemble(
    request: DownloadRequest,
    context: {
      container: OutputContainer;
      extension: string;
      audioOnly: boolean;
      workDir: string;
      media: {
        videoPath: string;
        audioPath: string | null;
        durationSec: number | null;
        transcodes: TranscodeNotice[];
        alreadyInTargetContainer: boolean;
      };
    },
  ): Promise<{ path: string; durationSec: number | null; transcodes: TranscodeNotice[] }> {
    const { variant, jobId } = request;
    const subtitleFiles = await this.#fetchSubtitles(request, context.workDir);

    const needsMux =
      subtitleFiles.length > 0 ||
      context.media.audioPath !== null ||
      !context.media.alreadyInTargetContainer;

    if (!needsMux) {
      return {
        path: context.media.videoPath,
        durationSec: context.media.durationSec,
        transcodes: context.media.transcodes,
      };
    }

    const inputs: MuxInputFile[] = [];
    if (context.media.audioPath === null) {
      const take: ("video" | "audio")[] = [];
      if (variant.hasVideo && !context.audioOnly) take.push("video");
      if (variant.hasAudio) take.push("audio");
      inputs.push({ path: context.media.videoPath, take: take.length > 0 ? take : ["audio"] });
    } else {
      if (variant.hasVideo && !context.audioOnly) {
        inputs.push({ path: context.media.videoPath, take: ["video"] });
      }
      inputs.push({ path: context.media.audioPath, take: ["audio"] });
    }
    for (const subtitle of subtitleFiles) {
      inputs.push({ path: subtitle.path, take: ["subtitle"], language: subtitle.language });
    }

    const destPath = this.storage.tmpPath(jobId, `assembled${context.extension}`);
    const result = await mux({
      inputs,
      destPath,
      container: context.container,
      videoCodec: variant.videoCodec,
      audioCodec: variant.audioCodec,
      audioOnly: context.audioOnly,
      sourceMayBeMpegTs: variant.protocol === "hls",
      title: request.title,
      durationSec: context.media.durationSec,
      ffmpegPath: this.config.ffmpegPath,
      signal: request.signal,
      timeoutMs: this.config.stageTimeoutMs,
      maxOutputBytes: this.config.maxFileSizeBytes,
      onProgress: request.onProgress,
      logger: this.#logger,
    });

    return {
      path: result.path,
      durationSec: result.durationSec ?? context.media.durationSec,
      transcodes: [...context.media.transcodes, ...result.transcodes],
    };
  }

  async #fetchSubtitles(
    request: DownloadRequest,
    workDir: string,
  ): Promise<{ path: string; language: string }[]> {
    const options: JobOptions = request.options ?? {};
    if (options.embedSubtitles !== true) return [];

    const wanted = new Set(options.subtitleLanguages ?? []);
    const tracks = (request.subtitles ?? []).filter((track) =>
      wanted.size === 0 ? false : wanted.has(track.language),
    );

    const fetched: { path: string; language: string }[] = [];
    for (const [index, track] of tracks.entries()) {
      if (!SUBTITLE_FORMATS_FFMPEG_READS.has(track.format)) {
        this.#logger.warn("skipping a subtitle track in an unsupported format", {
          jobId: request.jobId,
          language: track.language,
          format: track.format,
        });
        continue;
      }
      const destPath = path.join(workDir, `sub-${index}-${track.language}.${track.format}`);
      try {
        await downloadProgressive({
          url: track.url,
          destPath,
          // Subtitles sit behind the same gate as the media.
          requestContext: request.requestContext,
          signal: request.signal,
          fetchImpl: this.config.fetchImpl,
          clock: this.config.clock,
          logger: this.#logger,
        });
        fetched.push({ path: destPath, language: track.language });
      } catch (error: unknown) {
        // A missing caption is not worth failing an otherwise good download.
        this.#logger.warn("subtitle track could not be fetched; continuing without it", {
          jobId: request.jobId,
          language: track.language,
          code: error instanceof AppError ? error.code : "unknown",
        });
      }
    }
    return fetched;
  }
}

export function createEngine(config: EngineConfigInput = {}): DownloadEngine {
  return new Engine(config);
}

/**
 * One-shot convenience matching the brief's shape:
 * `download(variant, requestContext, options) -> file on disk`.
 *
 * `apps/api` should hold a long-lived engine via `createEngine()` instead, so
 * the retention sweep and configuration are shared across jobs.
 */
export async function download(
  variant: MediaVariant,
  requestContext: RequestContext,
  options: Omit<DownloadRequest, "variant" | "requestContext" | "jobId"> & {
    jobId?: string;
    config?: EngineConfigInput;
  } = {},
): Promise<DownloadOutcome> {
  const { config, jobId, ...rest } = options;
  const engine = createEngine(config ?? {});
  await engine.init();
  return engine.download({
    ...rest,
    jobId: jobId ?? `oneshot-${Date.now().toString(36)}`,
    variant,
    requestContext,
  });
}

export type { Clock, EngineConfig, EngineConfigInput, FetchLike } from "./config.ts";
export {
  bundledFfmpegPath,
  ENGINE_DEFAULTS,
  loadEngineConfig,
  resolveFfmpegPath,
  SYSTEM_CLOCK,
} from "./config.ts";
export type { Logger } from "./logger.ts";
export { NOOP_LOGGER } from "./logger.ts";

export {
  buildDurationLimitArgs,
  buildLocalInputArgs,
  buildNetworkInputArgs,
  GLOBAL_ARGS,
  PROGRESS_ARGS,
} from "./ffmpeg/args.ts";
export {
  buildFetchHeaders,
  buildRequestContextArgs,
  joinHeaderBlob,
  normalizeHeaders,
} from "./ffmpeg/headers.ts";
export { buildTaskkillArgs, killProcessTree } from "./ffmpeg/kill.ts";
export type { FfmpegProgressSnapshot, JobProgressContext } from "./ffmpeg/progress.ts";
export { FfmpegProgressParser, RateTracker, toJobProgress } from "./ffmpeg/progress.ts";
export type { FfmpegRunOptions, FfmpegRunResult } from "./ffmpeg/runner.ts";
export { runFfmpeg } from "./ffmpeg/runner.ts";

export type { DashDownloadOptions } from "./download/dash.ts";
export { downloadDash } from "./download/dash.ts";
export type { HlsDownloadOptions } from "./download/hls.ts";
export { downloadHls } from "./download/hls.ts";
export { classifyHttpStatus, httpRequest } from "./download/http.ts";
export type { ManifestDownloadOptions, ManifestDownloadResult } from "./download/manifest.ts";
export { buildManifestDownloadArgs, downloadViaFfmpeg } from "./download/manifest.ts";
export { mapWithConcurrency } from "./download/pool.ts";
export type {
  ProgressiveDownloadOptions,
  ProgressiveDownloadResult,
} from "./download/progressive.ts";
export { downloadProgressive } from "./download/progressive.ts";
export type { RetryPolicy } from "./download/retry.ts";
export {
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
  parseRetryAfter,
  withRetry,
} from "./download/retry.ts";
export type { SegmentDownloadOptions, SegmentDownloadResult } from "./download/segments.ts";
export { buildConcatList, downloadSegments, downloadViaSegments } from "./download/segments.ts";

export type { EstimateBasis, EstimateOptions, SizeEstimate } from "./estimate.ts";
export { assertDiskSpace, assertWithinSizeLimit, estimateVariantBytes } from "./estimate.ts";
export type {
  MuxInputFile,
  MuxOptions,
  MuxResult,
  OutputArgsOptions,
  OutputContainer,
  StreamMap,
  TranscodeNotice,
} from "./mux.ts";
export {
  buildOutputArgs,
  CONTAINER_EXTENSIONS,
  containerSupports,
  formatMapArg,
  mux,
  normalizeCodecName,
} from "./mux.ts";
export type { GcReport, StorageOptions } from "./storage.ts";
export {
  assertPathInside,
  assertRealPathInside,
  freeDiskBytes,
  OUT_SUBDIR,
  sanitizeFilename,
  Storage,
  TMP_SUBDIR,
} from "./storage.ts";
