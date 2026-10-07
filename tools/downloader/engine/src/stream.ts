/**
 * Streaming a rendition to a reader as ffmpeg produces it (dl-53).
 *
 * **Nothing touches a disk.** One ffmpeg reads every input over the network —
 * the manifest or the file, a separate audio rendition, each subtitle track —
 * and writes one container to its stdout, which is handed back as a `Readable`.
 * No segment, no partial file, no subtitle file and no finished file is ever
 * written; the owner's reason, on 2026-09-14, was that nobody here knows what
 * the videos contain, so no copy of one should be kept anywhere.
 *
 * ## Why progressive sources go to ffmpeg as a URL too
 *
 * The brief offered two shapes for a progressive source: the fetch body piped
 * through ffmpeg, or straight to the response. Neither survives an ordinary
 * MP4 whose `moov` is at the end — which is what ffmpeg itself writes without
 * `+faststart`. Piped into ffmpeg's stdin, such a file cannot be demuxed,
 * because the index is at the end and a pipe cannot seek back to the samples;
 * measured on 2026-09-27, ffmpeg 6.1.1 logged `partial file`, **exited 0**, and
 * wrote a 1,293-byte output with no samples in it. Straight to the response,
 * it is not fragmented and a player cannot start it until the last byte. Given
 * the URL, ffmpeg's own HTTP client seeks with `Range` requests, through the
 * same egress proxy and with the same replayed headers as every manifest, so
 * both layouts work and there is one code path for every protocol.
 *
 * ## What can be retried
 *
 * Only what happens **before the first byte**. Mirror failover (dl-45) and the
 * subtitle fallback below both start a fresh ffmpeg; once a byte has gone to
 * the reader there is nothing to restart from — a new process would begin a
 * new file — so a later failure ends the stream and rejects `done`.
 *
 * A subtitle track that will not open fails ffmpeg as a whole, because every
 * input is opened before the first byte is written. A missing caption was never
 * worth failing a download over, so a failure with subtitles attached is tried
 * once more without them, and that is logged.
 */

import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { finished } from "node:stream/promises";
import { AppError, redactRequestContext, redactUrl } from "@downloader/contract";
import type {
  JobOptions,
  JobProgress,
  MediaVariant,
  RequestContext,
  SubtitleTrack,
} from "@downloader/contract";
import type { EngineConfig } from "./config.ts";
import { downloadCandidates, isHostFailure } from "./download/failover.ts";
import { assertWithinSizeLimit, estimateVariantBytes } from "./estimate.ts";
import { buildNetworkInputArgs, GLOBAL_ARGS, STREAM_PROGRESS_ARGS } from "./ffmpeg/args.ts";
import { durationFromInfoLine, RateTracker, toJobProgress } from "./ffmpeg/progress.ts";
import type { FfmpegStream } from "./ffmpeg/runner.ts";
import { isTlsVerificationFailure, streamFfmpeg } from "./ffmpeg/runner.ts";
import type { Logger } from "./logger.ts";
import type { OutputContainer, StreamMap, TranscodeNotice } from "./mux.ts";
import { buildOutputArgs, CONTAINER_EXTENSIONS } from "./mux.ts";
import { sanitizeFilename } from "./filename.ts";

export interface StreamRequest {
  /** For logs only. Nothing is named after it, because nothing is written. */
  jobId: string;
  /** From the re-probe performed immediately before the stream. */
  variant: MediaVariant;
  requestContext: RequestContext;
  /** Source title; sanitised into the filename. */
  title?: string | undefined;
  /** Probe-level duration, used when the variant carries none. */
  durationSec?: number | null;
  isLive?: boolean;
  subtitles?: readonly SubtitleTrack[];
  options?: JobOptions;
  /** Cancels before or after the first byte. The process tree is killed either way. */
  signal?: AbortSignal | undefined;
  /** Bytes handed to the reader, media time, and a percent only when the duration is known. */
  onProgress?: ((progress: JobProgress) => void) | undefined;
}

export interface StreamOutcome {
  /** Bytes handed to the reader. */
  bytes: number;
  /** Media time ffmpeg reported writing, or the probe's when it reported none. */
  durationSec: number | null;
}

export interface MediaStream {
  /**
   * The container, front to back. Ends when ffmpeg exits cleanly; is destroyed
   * with the `AppError` when anything fails after the first byte. Destroying it
   * from the reading side kills ffmpeg.
   */
  body: Readable;
  contentType: string;
  /** Sanitised from the title; safe for a `Content-Disposition`. */
  filename: string;
  container: OutputContainer;
  /** Non-empty only when a container could not carry a codec. */
  transcodes: TranscodeNotice[];
  /** Resolves once ffmpeg has exited 0 and every byte was handed over; rejects with `AppError`. */
  done: Promise<StreamOutcome>;
}

const SUBTITLE_DEMUXERS: Readonly<Record<string, string>> = { vtt: "webvtt", srt: "srt" };

/**
 * What ffmpeg's HLS demuxer says when it gives up on a segment and drops it.
 *
 * Left to its defaults it retries a segment it cannot fetch, logs this, and
 * carries on — and when the source stops answering for good it **exits 0**
 * having written only what it got. dl-53's second gate found it, and it is
 * reproduced in `stream.test.ts`: six 1 s segments, every connection from the
 * third on reset, and the stream ended as a clean response two seconds long
 * with no error anywhere. A stored file could be checked afterwards; a stream
 * is already on the visitor's disk, so the honest outcome is to cut the
 * connection and record `DOWNLOAD_FAILED` the moment data is lost.
 *
 * **Read off stderr, because no flag makes ffmpeg fail here.** The gate
 * proposed `-err_detect explode`, and it does not: on ffmpeg 6.1.1, on the
 * gate's own fixture, it exits 0 with 39,487 bytes as an input option, an
 * output option, both, and as `-f_err_detect`; so does `-xerror`. The gate's
 * exit 255 came from its command lacking `-bsf:a aac_adtstoasc`, which fails
 * the mux whatever else is set — measured, with the same bytes, on 2026-09-27.
 * The line below is what the demuxer writes at `-loglevel warning`, which
 * `GLOBAL_ARGS` asks for; the same bind `isTlsVerificationFailure` is in.
 *
 * **Not measured against real-world sources for false failures.** A source
 * whose segments ffmpeg used to skip over quietly now fails where it used to
 * finish short; that is the price the owner accepted on 2026-09-27 over a
 * silent truncation. A segment that fails and then loads on a retry is not a
 * loss and does not match: only the giving-up line does.
 */
export const SEGMENT_SKIPPED = /failed too many times, skipping/iu;

/** The evidence a `SEGMENT_SKIPPED` failure carries, like the runner's 4 KB tail. */
const STDERR_TAIL_CHARS = 4096;

/**
 * The DASH demuxer's word for a fragment it could not open. **It never
 * retries**: measured on ffmpeg 6.1.1 (dl-53's fourth gate, then the builder),
 * a fragment reset once and served on a second request is still lost, because
 * the second request is never made — so this line always means a hole. The
 * container still declares the full duration around it, which is why a
 * duration check could not have caught it.
 */
export const FRAGMENT_LOST = /Failed to open fragment of playlist/iu;

/**
 * A transfer that stopped short of its `Content-Length` — a segment, a
 * fragment or a progressive body cut mid-way, rather than refused (dl-53's
 * sixth gate). ffmpeg writes this for all three, and for a progressive body it
 * then reconnects and fetches the rest: `WILL_RECONNECT`, from the **same**
 * connection, immediately after. HLS and DASH never reconnect a segment, so
 * for them the line alone is a hole. The rule is therefore "an early end that
 * no reconnect of the same connection answered", decided when ffmpeg exits.
 *
 * Not `corrupt input packet`, which catches the same cuts: it is also what a
 * segment delivered whole but with damaged bytes produces, and that is not a
 * transfer this service failed to make (the owner's choice, 2026-09-27).
 */
export const STREAM_ENDED_EARLY = /Stream ends prematurely/iu;
export const WILL_RECONNECT = /Will reconnect at/iu;

/**
 * The connection a line came from: the address in ffmpeg's `[http @ …]` prefix,
 * `0x557cbe02b840` on Linux, `0000019e45be7ec0` on Windows (CI run 35404674345).
 * On ffmpeg 6.1.1 an early end and its reconnect carry the same address, and a
 * video and a separate audio input each get their own, so a reconnect on one
 * never answers for the other when the two inputs' threads interleave lines.
 */
const CONNECTION_OF = /^\[[^\]@]*@ (?:0x)?([0-9a-f]+)\]/iu;

export function connectionOf(line: string): string | null {
  return CONNECTION_OF.exec(line)?.[1] ?? null;
}

/** True for a line that says the source lost data this stream will not get. */
export function losesSourceData(line: string): boolean {
  return SEGMENT_SKIPPED.test(line) || FRAGMENT_LOST.test(line);
}

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

export function outputExtension(container: OutputContainer, audioOnly: boolean): string {
  if (audioOnly && container === "mp4") return ".m4a";
  if (audioOnly && container === "webm") return ".webm";
  return CONTAINER_EXTENSIONS[container];
}

export function contentTypeFor(container: OutputContainer, audioOnly: boolean): string {
  if (container === "mp4") return audioOnly ? "audio/mp4" : "video/mp4";
  if (container === "webm") return audioOnly ? "audio/webm" : "video/webm";
  return "video/x-matroska";
}

/** The subtitle tracks the caller asked for, in a format ffmpeg reads. */
export function selectSubtitles(
  request: Pick<StreamRequest, "options" | "subtitles" | "jobId">,
  logger: Logger,
): SubtitleTrack[] {
  const options: JobOptions = request.options ?? {};
  if (options.embedSubtitles !== true) return [];
  const wanted = new Set(options.subtitleLanguages ?? []);
  if (wanted.size === 0) return [];

  const selected: SubtitleTrack[] = [];
  for (const track of request.subtitles ?? []) {
    if (!wanted.has(track.language)) continue;
    if (SUBTITLE_DEMUXERS[track.format] === undefined) {
      logger.warn("skipping a subtitle track in an unsupported format", {
        jobId: request.jobId,
        language: track.language,
        format: track.format,
      });
      continue;
    }
    selected.push(track);
  }
  return selected;
}

export interface StreamArgsOptions {
  url: string;
  variant: MediaVariant;
  requestContext: RequestContext;
  container: OutputContainer;
  audioOnly: boolean;
  subtitles: readonly SubtitleTrack[];
  title?: string | undefined;
  liveDurationSec?: number | null | undefined;
  tlsVerify?: boolean | undefined;
  tlsCaFile?: string | undefined;
}

/** Exported for tests: the full argv for one attempt, without spawning anything. */
export function buildStreamArgs(options: StreamArgsOptions): {
  args: string[];
  transcodes: TranscodeNotice[];
} {
  const { variant } = options;
  const tls = {
    ...(options.tlsVerify === undefined ? {} : { tlsVerify: options.tlsVerify }),
    ...(options.tlsCaFile === undefined ? {} : { tlsCaFile: options.tlsCaFile }),
  };
  const args: string[] = [...GLOBAL_ARGS, ...STREAM_PROGRESS_ARGS];
  const maps: StreamMap[] = [];
  const hls = variant.protocol === "hls";
  const separateAudio = typeof variant.audioUrl === "string" && variant.audioUrl.length > 0;
  // Unverified (`undefined`) is "try for it" (dl-42): every map below is
  // optional, so an absent track costs nothing and a present one is kept.
  const wantAudio = variant.hasAudio !== false;

  let inputIndex = 0;
  // With `audioOnly` and a separate audio rendition there is no reason to open
  // the video at all — it would be fetched only to be discarded.
  if (!(options.audioOnly && separateAudio)) {
    args.push(
      ...buildNetworkInputArgs(options.url, {
        requestContext: options.requestContext,
        hlsAllowAllExtensions: hls,
        ...tls,
      }),
    );
    if (variant.hasVideo && !options.audioOnly) {
      maps.push({ inputIndex, kind: "video", streamIndex: 0, optional: true });
    }
    if (wantAudio && !separateAudio) {
      maps.push({ inputIndex, kind: "audio", streamIndex: 0, optional: true });
    }
    inputIndex += 1;
  }

  if (separateAudio) {
    // Replayed again: the audio rendition is a separate, equally gated request.
    args.push(
      ...buildNetworkInputArgs(variant.audioUrl as string, {
        requestContext: options.requestContext,
        hlsAllowAllExtensions: hls,
        ...tls,
      }),
    );
    maps.push({ inputIndex, kind: "audio", streamIndex: 0, optional: true });
    inputIndex += 1;
  }

  const subtitleLanguages: string[] = [];
  for (const track of options.subtitles) {
    // Named rather than probed: a `.vtt` behind a signed URL often has no
    // extension ffmpeg would recognise, and a text demuxer guessed wrong
    // produces a track of garbage rather than an error.
    const demuxer = SUBTITLE_DEMUXERS[track.format] ?? "webvtt";
    args.push(
      ...buildNetworkInputArgs(track.url, {
        requestContext: options.requestContext,
        extraArgs: ["-f", demuxer],
        ...tls,
      }),
    );
    maps.push({ inputIndex, kind: "subtitle", streamIndex: 0, optional: true });
    subtitleLanguages.push(track.language);
    inputIndex += 1;
  }

  const output = buildOutputArgs({
    container: options.container,
    maps,
    videoCodec: variant.videoCodec,
    audioCodec: variant.audioCodec,
    audioOnly: options.audioOnly,
    subtitleLanguages,
    durationLimitSec: options.liveDurationSec,
    // HLS segments are MPEG-TS far more often than not; DASH and progressive
    // MP4 already carry AAC in the form MP4 wants.
    sourceMayBeMpegTs: hls,
    title: options.title,
  });

  args.push(...output.args, "pipe:1");
  return { args, transcodes: output.transcodes };
}

/**
 * Resolves with the first chunk ffmpeg writes, or null when stdout ended with
 * none. Rejects with ffmpeg's own failure when it exits first.
 */
function firstChunk(stdout: Readable, completion: Promise<unknown>): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      settled = true;
      stdout.off("readable", onReadable);
      stdout.off("end", onEnd);
    };
    function onReadable(): void {
      if (settled) return;
      const chunk = stdout.read() as Buffer | null;
      if (chunk === null) return;
      cleanup();
      resolve(chunk);
    }
    function onEnd(): void {
      if (settled) return;
      cleanup();
      resolve(null);
    }
    stdout.on("readable", onReadable);
    stdout.once("end", onEnd);
    completion.then(
      () => undefined,
      (error: unknown) => {
        if (settled) return;
        cleanup();
        reject(error);
      },
    );
  });
}

export interface StreamDeps {
  config: EngineConfig;
  logger: Logger;
}

/**
 * Starts the stream and resolves **at its first byte** — the moment a caller
 * can send response headers — or rejects with the `AppError` that stopped it
 * before then.
 */
export async function openStream(request: StreamRequest, deps: StreamDeps): Promise<MediaStream> {
  const { config, logger } = deps;
  const { variant, jobId } = request;
  const options: JobOptions = request.options ?? {};
  const audioOnly = options.audioOnly === true;
  const container = resolveContainer(variant, options.container);
  const extension = outputExtension(container, audioOnly);
  const durationSec = request.durationSec ?? variant.durationSec ?? null;
  const liveDurationSec = options.liveDurationSec ?? null;

  if (request.isLive === true && (liveDurationSec ?? 0) <= 0) {
    throw new AppError("LIVE_STREAM_UNSUPPORTED", undefined, {
      details: { jobId, variantId: variant.id },
    });
  }

  // Refuse the four-hour 4K file before a byte moves. The runtime cap below
  // catches the one whose bitrate was unknown or wrong.
  const estimate = estimateVariantBytes(variant, { durationSec, liveDurationSec });
  assertWithinSizeLimit(estimate, config.maxFileSizeBytes, { jobId, variantId: variant.id });

  logger.debug("engine stream starting", {
    jobId,
    variantId: variant.id,
    protocol: variant.protocol,
    container,
    requestContext: redactRequestContext(request.requestContext),
  });

  const filename = sanitizeFilename(`${request.title ?? "video"}${extension}`, {
    fallback: `download${extension}`,
  });
  const candidates = downloadCandidates(variant);
  let subtitles = selectSubtitles(request, logger);
  let index = 0;

  for (;;) {
    const url = candidates[index] as string;
    try {
      // oxlint-disable-next-line no-await-in-loop
      const started = await attempt(request, deps, {
        url,
        container,
        audioOnly,
        subtitles,
        durationSec,
        liveDurationSec,
      });
      return { ...started, filename, container, contentType: contentTypeFor(container, audioOnly) };
    } catch (error: unknown) {
      const appError = AppError.from(error);
      if (appError.code === "JOB_CANCELED" || request.signal?.aborted === true) throw appError;

      if (subtitles.length > 0 && appError.code !== "SIZE_LIMIT_EXCEEDED") {
        logger.warn("the stream would not open with subtitles attached; retrying without them", {
          jobId,
          code: appError.code,
          languages: subtitles.map((track) => track.language),
        });
        subtitles = [];
        continue;
      }

      const another = index + 1 < candidates.length;
      if (!another || !isHostFailure(appError)) throw appError;
      logger.warn("the host would not serve this rendition; trying the next mirror", {
        jobId,
        variantId: variant.id,
        code: appError.code,
        failed: redactUrl(url),
        next: redactUrl(candidates[index + 1] as string),
        remaining: candidates.length - index - 1,
      });
      index += 1;
    }
  }
}

/**
 * What the visitor's file should come to, when that is the source's own size
 * (dl-96).
 *
 * Only for a progressive file the probe measured, copied as it is: `-c copy`
 * moves every sample unchanged, so the output differs from the source by its
 * boxes alone — measured within 0.07% on a 45.7 MB file whose index moved from
 * the end to a fragmented front. A transcode, an audio-only cut, a separate
 * audio input and a live capture each make the source's size a different
 * file's, and HLS and DASH are left out because a segment sum counts MPEG-TS
 * packet overhead the MP4 does not carry. It is an expectation, never a
 * percent: the bar still moves only on media time.
 */
export function expectedOutputBytes(
  variant: MediaVariant,
  context: { audioOnly: boolean; transcoded: boolean; live: boolean },
): number | null {
  if (variant.protocol !== "progressive" || variant.audioUrl !== undefined) return null;
  if (context.audioOnly || context.transcoded || context.live) return null;
  if (variant.filesizeIsEstimate === true) return null;
  const bytes = variant.filesizeBytes;
  return bytes !== undefined && Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

async function attempt(
  request: StreamRequest,
  deps: StreamDeps,
  context: {
    url: string;
    container: OutputContainer;
    audioOnly: boolean;
    subtitles: readonly SubtitleTrack[];
    durationSec: number | null;
    liveDurationSec: number | null;
  },
): Promise<Pick<MediaStream, "body" | "transcodes" | "done">> {
  const { config, logger } = deps;
  const { args, transcodes } = buildStreamArgs({
    url: context.url,
    variant: request.variant,
    requestContext: request.requestContext,
    container: context.container,
    audioOnly: context.audioOnly,
    subtitles: context.subtitles,
    title: request.title,
    liveDurationSec: context.liveDurationSec,
    tlsVerify: config.tlsVerify,
    tlsCaFile: config.tlsCaFile,
  });

  for (const notice of transcodes) {
    logger.warn("transcoding a stream — this is slow and lossy", {
      kind: notice.kind,
      from: notice.from,
      to: notice.to,
      container: context.container,
      reason: notice.reason,
    });
  }

  // A live capture's duration is the caller's limit; a VOD's is the manifest's.
  const mediaDurationSec = context.liveDurationSec ?? context.durationSec;
  // When the probe could not time the source, ffmpeg can: it reads the
  // duration before its first output byte and says so at info level (dl-96).
  // Until then the percent stays null, as it must.
  let learnedDurationSec: number | null = null;
  const totalBytes = expectedOutputBytes(request.variant, {
    audioOnly: context.audioOnly,
    transcoded: transcodes.length > 0,
    live: context.liveDurationSec !== null,
  });
  const rate = new RateTracker();
  let sent = 0;
  // For `SEGMENT_SKIPPED`: what ffmpeg said before it gave up on a segment.
  let stderrTail = "";
  let sawCertificateRejection = false;
  // Connections that ended early and have not reconnected since. See
  // `STREAM_ENDED_EARLY`; anything left here when ffmpeg exits is a hole.
  const endedEarly = new Set<string>();

  const ffmpeg: FfmpegStream = streamFfmpeg({
    ffmpegPath: config.ffmpegPath,
    args,
    signal: request.signal,
    timeoutMs: config.stageTimeoutMs,
    maxOutputBytes: config.maxFileSizeBytes,
    proxyUrl: config.proxyUrl,
    failureCode: "DOWNLOAD_FAILED",
    logger,
    onProgress: (snapshot) => {
      if (request.onProgress === undefined) return;
      const now = Date.now();
      rate.record(sent, now);
      // Bytes *sent*, not ffmpeg's `total_size`: what the visitor has is what
      // went through the pipe (dl-53).
      request.onProgress({
        ...toJobProgress(snapshot, {
          stage: "downloading",
          durationSec: mediaDurationSec ?? learnedDurationSec,
          totalBytes,
          speedBps: rate.bytesPerSecond(),
        }),
        downloadedBytes: sent,
      });
    },
    onInfoLine: (line) => {
      if (mediaDurationSec !== null || learnedDurationSec !== null) return;
      // The first input's line: a second input is a separate audio rendition
      // or a subtitle track, timed against the same video.
      learnedDurationSec = durationFromInfoLine(line);
    },
    onStderrLine: (line) => {
      logger.debug("ffmpeg", { line });
      stderrTail = `${stderrTail}${line}\n`.slice(-STDERR_TAIL_CHARS);
      if (!sawCertificateRejection) sawCertificateRejection = isTlsVerificationFailure(line);
      if (STREAM_ENDED_EARLY.test(line)) endedEarly.add(connectionOf(line) ?? line);
      else if (WILL_RECONNECT.test(line)) endedEarly.delete(connectionOf(line) ?? line);
      if (losesSourceData(line)) {
        // A segment refused on its certificate is skipped the same way, and
        // says so first: that is a certificate failure, which is not retried
        // and must not read as a dead link (dl-27). Anything else is lost data.
        ffmpeg.terminate(
          sawCertificateRejection
            ? new AppError("TLS_VERIFICATION_FAILED", undefined, {
                details: { stderr: stderrTail },
              })
            : new AppError("DOWNLOAD_FAILED", "The source stopped serving part of the video.", {
                details: { stderr: stderrTail },
              }),
        );
      }
    },
  });
  // Observed here so a rejection before anyone awaits `done` is never unhandled.
  ffmpeg.completion.catch(() => undefined);

  const first = await firstChunk(ffmpeg.stdout, ffmpeg.completion);
  if (first === null) {
    // Exit 0 with nothing written is not a success: it is exactly what an
    // undemuxable input looks like (the header of this file has the case).
    await ffmpeg.completion;
    throw new AppError("DOWNLOAD_FAILED", "The source produced no media.", {
      details: { jobId: request.jobId },
    });
  }

  const limit = config.maxFileSizeBytes;
  let ended = false;
  const body = new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      sent += chunk.length;
      if (limit > 0 && sent > limit) {
        // Cut where the cap is passed, not where ffmpeg's next progress block
        // happens to notice: the bytes past it would already be the visitor's.
        const error = new AppError("SIZE_LIMIT_EXCEEDED", undefined, {
          details: { sentBytes: sent, limitBytes: limit },
        });
        ffmpeg.terminate(error);
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  body.once("end", () => {
    ended = true;
  });
  // `done` is the error channel. A reader that only pipes the body attaches no
  // listener, and an `error` event with none is an uncaught exception that
  // takes the whole process down with one visitor's failed download.
  body.on("error", () => undefined);
  // A reader that goes away must not leave ffmpeg blocked on a full pipe.
  body.once("close", () => {
    if (!ended) ffmpeg.terminate(new AppError("JOB_CANCELED"));
  });

  body.write(first);
  // `end: false`, and it is the difference between a failure and a truncated
  // file that looks whole. A killed ffmpeg's stdout *ends* like any other, so
  // letting the pipe end the body would close the response cleanly on a
  // timeout, a size cut or a crash. The body ends only on exit 0, below.
  ffmpeg.stdout.pipe(body, { end: false });

  const done = ffmpeg.completion
    .then(async (result): Promise<StreamOutcome> => {
      if (endedEarly.size > 0) {
        // Before `body.end()`: the visitor must see a cut connection, not a
        // complete response carrying a file with a hole in it.
        throw new AppError("DOWNLOAD_FAILED", "The source cut part of the video short.", {
          details: { stderr: stderrTail, connections: endedEarly.size },
        });
      }
      body.end();
      // Every chunk through the counter, not merely out of ffmpeg: a slow
      // reader leaves the last few queued on the writable side. A reader that
      // leaves in that window is a cancel, and `finished` says so.
      await finished(body, { readable: false }).catch(() => {
        throw new AppError("JOB_CANCELED");
      });
      const observedUs = result.lastSnapshot?.outTimeUs ?? null;
      logger.info("engine stream complete", { jobId: request.jobId, bytes: sent });
      return {
        bytes: sent,
        durationSec:
          observedUs === null ? (mediaDurationSec ?? learnedDurationSec) : observedUs / 1_000_000,
      };
    })
    .catch((error: unknown) => {
      const appError = AppError.from(error);
      logger.warn("engine stream failed after its first byte", {
        jobId: request.jobId,
        code: appError.code,
        sentBytes: sent,
      });
      body.destroy(appError);
      throw appError;
    });
  done.catch(() => undefined);

  return { body, transcodes, done };
}
