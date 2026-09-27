/**
 * `@downloader/engine` — the public surface.
 *
 * The engine's contract is one sentence: **a `MediaVariant` plus the
 * `RequestContext` captured with it, in; the file, as a readable body, out, as
 * ffmpeg produces it; `JobProgress` along the way.** It owns ffmpeg and nothing
 * else — it never resolves a URL, never touches a database, never decides job
 * state and, since dl-53, never writes to disk: no segment, no working file and
 * no finished file. The owner's reason, on 2026-09-14, was that nobody here
 * knows what the videos contain, so no copy of one is kept anywhere.
 *
 * ## The seam the API consumes
 *
 * ```ts
 * const engine = createEngine({ maxFileSizeBytes, stageTimeoutMs, proxyUrl, logger });
 *
 * const media = await engine.stream({
 *   jobId,                     // for logs only; nothing is named after it
 *   variant,                   // from the *re-probe*, never the original probe
 *   requestContext,            // replayed on the manifest and every segment
 *   title, durationSec, isLive, subtitles,
 *   options,                   // the JobOptions the client sent
 *   signal,                    // cancel -> JOB_CANCELED, process tree killed
 *   onProgress,                // bytes sent, media time; totals are never known
 * });
 * // Resolved at the first byte: send headers now, then pipe `media.body`.
 * // `media.done` resolves when the last byte went out, or rejects with the
 * // AppError that cut the stream short.
 * ```
 *
 * Notes for the caller:
 *  - `stream()` throws `AppError` and nothing else, before the first byte:
 *    `JOB_CANCELED`, `DOWNLOAD_FAILED` (re-probe and retry), `SIZE_LIMIT_EXCEEDED`,
 *    `TIMEOUT`, `TLS_VERIFICATION_FAILED`, `LIVE_STREAM_UNSUPPORTED`. After it,
 *    the same codes arrive on `done`, and a retry is no longer possible.
 *  - The engine does not re-probe. Signed URLs expire in 30–300 s (analysis §5),
 *    so the caller must hand in a *fresh* variant.
 *  - The engine does not enforce SSRF policy on `variant.url`, nor on
 *    `variant.alternateUrls`, which it will open on a failover (dl-45). Resolver
 *    output is attacker-influenced, so the guard must run before this is called
 *    — `urlsInProbeResult` covers both — and ffmpeg's egress must be the
 *    guarded proxy, which is the only check that sees each segment.
 */

import type { EngineConfig, EngineConfigInput } from "./config.ts";
import { loadEngineConfig } from "./config.ts";
import type { MediaStream, StreamRequest } from "./stream.ts";
import { openStream } from "./stream.ts";

export interface DownloadEngine {
  readonly config: EngineConfig;
  /**
   * The rendition as a readable body, resolved at its first byte (dl-53).
   * Writes nothing to disk. See `stream.ts`.
   */
  stream(request: StreamRequest): Promise<MediaStream>;
}

class Engine implements DownloadEngine {
  readonly config: EngineConfig;

  constructor(input: EngineConfigInput = {}) {
    this.config = loadEngineConfig(input);
  }

  async stream(request: StreamRequest): Promise<MediaStream> {
    return openStream(request, { config: this.config, logger: this.config.logger });
  }
}

export function createEngine(config: EngineConfigInput = {}): DownloadEngine {
  return new Engine(config);
}

export type { EngineConfig, EngineConfigInput } from "./config.ts";
export {
  bundledFfmpegPath,
  ENGINE_DEFAULTS,
  loadEngineConfig,
  resolveFfmpegPath,
} from "./config.ts";
export type { Logger } from "./logger.ts";
export { NOOP_LOGGER } from "./logger.ts";
export type { MediaStream, StreamArgsOptions, StreamOutcome, StreamRequest } from "./stream.ts";
export {
  buildStreamArgs,
  contentTypeFor,
  outputExtension,
  resolveContainer,
  selectSubtitles,
} from "./stream.ts";
export { sanitizeFilename } from "./filename.ts";

export {
  buildDurationLimitArgs,
  buildNetworkInputArgs,
  GLOBAL_ARGS,
  PROGRESS_ARGS,
  STREAM_PROGRESS_ARGS,
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
export type { FfmpegRunOptions, FfmpegRunResult, FfmpegStream } from "./ffmpeg/runner.ts";
export {
  isTlsVerificationFailure,
  redactUrlsInText,
  runFfmpeg,
  streamFfmpeg,
} from "./ffmpeg/runner.ts";
export type { PreviewFrameOptions } from "./ffmpeg/preview-frame.ts";
export {
  buildPreviewFrameArgs,
  choosePreviewVariant,
  grabPreviewFrame,
  PREVIEW_FRAME_MAX_EDGE_PX,
  PREVIEW_SEEK_CAP_SEC,
  PREVIEW_SEEK_FRACTION,
  previewSeekSec,
} from "./ffmpeg/preview-frame.ts";

export { downloadCandidates, isHostFailure } from "./download/failover.ts";

export type { EstimateBasis, EstimateOptions, SizeEstimate } from "./estimate.ts";
export { assertWithinSizeLimit, estimateVariantBytes } from "./estimate.ts";
export type { OutputArgsOptions, OutputContainer, StreamMap, TranscodeNotice } from "./mux.ts";
export {
  buildOutputArgs,
  CONTAINER_EXTENSIONS,
  containerSupports,
  formatMapArg,
  normalizeCodecName,
  streamingContainerArgs,
} from "./mux.ts";
