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
 * ## An origin that ignores Range
 *
 * That holds only while the origin honours `Range`. One that answers every
 * request with `200` and the whole body leaves ffmpeg no way to reach an index
 * at the end, and a tail-`moov` MP4 from it used to finish as a clean response
 * of which no frame decodes (dl-102: about 1 MB in, 37,615 bytes out, 0 of
 * 100 frames, `done` resolved). ffmpeg's stderr does not say so reliably — its
 * `Stream ends prematurely` is followed by a reconnect from the same
 * connection, which clears `STREAM_ENDED_EARLY` — so the question is asked
 * before ffmpeg starts, of the **origin**: `download/seek-probe.ts` sends
 * `Range: bytes=1-1` to each progressive input's own URL, the candidate the
 * resolver produced, and never to whatever URL ffmpeg is then handed. A `206`
 * is fine. A `200` is walked for its top-level boxes: `moov` before `mdat` is a
 * fast-start file ffmpeg reads front to back, and it streams as before;
 * `mdat` first is refused with `SOURCE_NOT_SEEKABLE`, before the first byte,
 * and the next mirror is tried if there is one. Anything the probe cannot
 * decide lets ffmpeg run, so that ffmpeg's own failures keep their codes (the
 * owner's choice, 2026-10-08). That is **not** quite ffmpeg running as it did
 * before: the probe is now the first request the origin sees, so a fault that
 * hits only the first request — one `429` or `500`, one refused `CONNECT` —
 * is spent on the probe. From an origin that honours `Range` that heals; from
 * one that ignores it, it turns what was a `DOWNLOAD_FAILED` into the
 * undecodable file this section is about. That, and every other way a probe
 * can go unanswered (or be misled) while the origin still ignores `Range`, is
 * caught behind it by dl-103: ffmpeg says `partial file` when it cannot read a
 * sample, and when its connection then ends early at that same offset the
 * origin is the cause (`PARTIAL_FILE` below). That is the same
 * `SOURCE_NOT_SEEKABLE`, before the first byte when the verdict comes first
 * and as a cut stream when it does not; a `partial file` without it is a
 * short source, and `DOWNLOAD_FAILED`. Only an origin that declares where its
 * body ends logs that early end: one that ignores `Range` and sends a chunked
 * body cannot be told from a short source, and is `DOWNLOAD_FAILED` too.
 * The probe goes through ffmpeg's proxy, with the same `tlsVerify` and
 * `tlsCaFile`, and never around it.
 *
 * A small tail-`moov` file from such an origin is refused too, though ffmpeg
 * can read one whole without seeking (gate 1 measured 63,749 B decoding and
 * 91,053 B not, on ffmpeg 6.1.1): the threshold is ffmpeg's internal buffering,
 * not something to depend on, and a video that small is not worth the risk.
 *
 * ## A slow origin (dl-98)
 *
 * Some origins throttle each connection — the reported one served 27 KB/s to
 * one and about four times that to four — so a progressive file whose origin
 * answered the probe with a `206` is not handed to ffmpeg as its own URL:
 * ffmpeg reads it from `download/parallel-ranges.ts`'s loopback range server,
 * which relays one connection until it measures slower than the video plays,
 * then fetches the rest four ranges at a time and hands them over in order.
 * ffmpeg still seeks as it likes, so a tail `moov` is still a ranged read.
 * Everything that file's header says about egress holds for its fetches; the
 * errors keep naming the candidate (`context.url`), never the loopback; and
 * the feeder is closed from ffmpeg's `completion`, because a refusal before the
 * first byte leaves `attempt()` by a throw. Only an origin that ranges is put
 * behind it, so dl-102's and dl-103's verdicts on one that does not are
 * ffmpeg's reading of the origin itself, unchanged.
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
import { hostListed, RangeFeeder } from "./download/parallel-ranges.ts";
import type { SeekVerdict } from "./download/seek-probe.ts";
import { egressProxy, probeSeek, SeekProbeCanceled } from "./download/seek-probe.ts";
import { assertWithinSizeLimit, estimateVariantBytes } from "./estimate.ts";
import {
  buildLoopbackInputArgs,
  buildNetworkInputArgs,
  GLOBAL_ARGS,
  STREAM_PROGRESS_ARGS,
} from "./ffmpeg/args.ts";
import { durationFromInfoLine, RateTracker, toJobProgress } from "./ffmpeg/progress.ts";
import type { FfmpegStream } from "./ffmpeg/runner.ts";
import { isTlsVerificationFailure, streamFfmpeg } from "./ffmpeg/runner.ts";
import type { Logger } from "./logger.ts";
import type { OutputContainer, StreamMap, TranscodeNotice } from "./mux.ts";
import { assertContainerCanHold, buildOutputArgs, CONTAINER_EXTENSIONS } from "./mux.ts";
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
 * The line below is what the demuxer writes at `-loglevel warning`, which is
 * what the runner passes on from `GLOBAL_ARGS`' `level+info` (dl-96); the same
 * bind `isTlsVerificationFailure` is in.
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
 * The mov demuxer's word for a sample it could not read in full (dl-103), and
 * the offset of that sample.
 *
 * It says so for two different sources, and only one of them is unseekable:
 *
 *  - **an origin that ignores `Range`**, a tail-`moov` MP4, when dl-102's
 *    probe got no answer or a misleading one: ffmpeg seeks to the first sample,
 *    is handed byte 0 again, logs `partial file` at that sample's offset, and
 *    then **its connection ends early at the very same offset**
 *    (`Stream ends prematurely at 48`, beside `offset 0x30`). Left alone it
 *    finished as a clean response that decodes 0 of 100 frames.
 *  - **a source that is merely short**: a file stored truncated at its
 *    origin, a transfer cut and never served again, an origin that went away
 *    while ffmpeg read the index. `partial file` comes at the sample where the
 *    bytes ran out, and no early end at that offset follows it.
 *
 * So `partial file` alone decides nothing; `SAME_OFFSET_ENDS_EARLY` does.
 * Measured on ffmpeg 6.1.1 and 7.0.2 (dl-103's Log, with dl-103's gate 1's
 * harness): the early end at the same offset followed `partial file`, 0 to 2
 * ms later, in every unseekable run, and in none of the short ones — fast-start
 * files stored at 5 to 99.9%, a fragmented one at 60%, a chunked one, cuts at
 * the index and in the samples followed by every error code, a reset or the
 * origin going away. An unseekable source is `SOURCE_NOT_SEEKABLE`, before the
 * first byte when the verdict comes first (the next mirror is tried, and no
 * subtitle retry) and as a cut stream otherwise; a short one is
 * `DOWNLOAD_FAILED`, wherever it shows (the owner's answer of 2026-10-10).
 * Read for progressive sources only: an HLS or DASH segment is demuxed by
 * ffmpeg in its own right, and its holes have their codes already.
 *
 * **The early end comes only from an origin that declares where its body
 * ends**: by `Content-Length`, or by closing the connection (a close-delimited
 * body logged `Stream ends prematurely at 48, should be
 * 18446744073709551615`, measured by dl-103's gate 2 and its builder). An
 * origin that ignores `Range` **and** sends its body chunked logs
 * `partial file` and no early end at all, which is what a chunked short
 * source logs too; when its probe went unanswered it is `DOWNLOAD_FAILED`
 * (gate 2's G2-2, on 6.1.1 and 7.0.2). That fails closed, a failed download
 * rather than a file that does not decode, and the log holds nothing that
 * would tell the two apart.
 */
export const PARTIAL_FILE = /offset 0x([0-9a-f]+): partial file/iu;
/** An early end and the byte it ended at, to set against `PARTIAL_FILE`'s offset. */
export const SAME_OFFSET_ENDS_EARLY = /Stream ends prematurely at (\d+)/iu;

/**
 * How long a `partial file` waits for its early end before it is read as a
 * short source. Measured at 0 to 2 ms; the margin is for a loaded machine. The
 * first byte is held for this long at most, and only after `partial file`.
 */
const PARTIAL_VERDICT_MS = 2_000;

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
  /**
   * The loopback range server ffmpeg reads the main input from instead of
   * `url` (dl-98). The audio rendition and the subtitles still go to their own.
   */
  loopbackUrl?: string | undefined;
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
      ...(options.loopbackUrl === undefined
        ? buildNetworkInputArgs(options.url, {
            requestContext: options.requestContext,
            hlsAllowAllExtensions: hls,
            ...tls,
          })
        : buildLoopbackInputArgs(options.loopbackUrl)),
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
  /**
   * Hosts that refused parallel ranges, kept by the engine until restart
   * (dl-98, Decision 5). Absent, nothing is remembered between jobs.
   */
  refusedHosts?: Set<string> | undefined;
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

  assertContainerCanHold(container, variant, { audioOnly, jobId });

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

  // dl-102: every progressive input ffmpeg will open is asked, at its origin,
  // whether ffmpeg can reach the index. See "an origin that ignores Range" above.
  const progressive = variant.protocol === "progressive";
  const separateAudio = typeof variant.audioUrl === "string" && variant.audioUrl.length > 0;
  if (progressive && separateAudio) {
    await refuseUnseekable(variant.audioUrl as string, "audio", request, deps);
  }
  const opensVideo = !(audioOnly && separateAudio);
  let probedIndex = -1;
  // The probe's `206`: the origin ranges a request, so it can be split (dl-98).
  let seekable = false;

  for (;;) {
    const url = candidates[index] as string;
    try {
      if (progressive && opensVideo && probedIndex !== index) {
        probedIndex = index;
        seekable = false;
        // oxlint-disable-next-line no-await-in-loop
        const verdict = await refuseUnseekable(url, "video", request, deps);
        seekable = verdict.kind === "seekable";
      }
      // oxlint-disable-next-line no-await-in-loop
      const started = await attempt(request, deps, {
        url,
        container,
        audioOnly,
        subtitles,
        durationSec,
        liveDurationSec,
        seekable: seekable && probedIndex === index,
      });
      return { ...started, filename, container, contentType: contentTypeFor(container, audioOnly) };
    } catch (error: unknown) {
      const appError = AppError.from(error);
      if (appError.code === "JOB_CANCELED" || request.signal?.aborted === true) throw appError;

      // A refused origin is the probe's verdict, not ffmpeg's: no subtitle
      // track caused it, and a retry without them would skip the probe.
      const unseekable = appError.code === "SOURCE_NOT_SEEKABLE";
      if (subtitles.length > 0 && appError.code !== "SIZE_LIMIT_EXCEEDED" && !unseekable) {
        logger.warn("the stream would not open with subtitles attached; retrying without them", {
          jobId,
          code: appError.code,
          languages: subtitles.map((track) => track.language),
        });
        subtitles = [];
        continue;
      }

      const another = index + 1 < candidates.length;
      // `Range` is the host's behaviour, not the file's, so a mirror may well
      // honour it (dl-102). Kept out of `isHostFailure`, which reads ffmpeg's
      // failures; this one is decided before ffmpeg starts.
      if (!another || !(isHostFailure(appError) || unseekable)) throw appError;
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
 * Throws `SOURCE_NOT_SEEKABLE` when `url`'s origin ignores `Range` and the
 * file's index is at the end (dl-102); returns every other verdict, unknown
 * included, so that ffmpeg reports what it always has. `url` is the origin's —
 * the candidate itself, never a URL ffmpeg is handed in its place.
 */
async function refuseUnseekable(
  url: string,
  input: "video" | "audio",
  request: StreamRequest,
  deps: StreamDeps,
): Promise<SeekVerdict> {
  const { config, logger } = deps;
  let verdict: SeekVerdict;
  try {
    verdict = await probeSeek(url, {
      requestContext: request.requestContext,
      proxyUrl: config.proxyUrl,
      tlsVerify: config.tlsVerify,
      tlsCaFile: config.tlsCaFile,
      signal: request.signal,
    });
  } catch (error: unknown) {
    if (error instanceof SeekProbeCanceled) throw new AppError("JOB_CANCELED");
    throw error;
  }
  logger.debug("origin seek probe", {
    jobId: request.jobId,
    input,
    url: redactUrl(url),
    ...verdict,
  });
  if (verdict.kind !== "unseekable") return verdict;
  throw new AppError("SOURCE_NOT_SEEKABLE", undefined, {
    details: { jobId: request.jobId, variantId: request.variant.id, input, url: redactUrl(url) },
  });
}

/**
 * What the visitor's file should come to, when that is the source's own size
 * (dl-96).
 *
 * Only for a progressive file the probe measured, copied as it is: `-c copy`
 * moves every sample unchanged, so for a source of one video and one audio
 * track the output differs by its boxes alone — measured within 0.07% on a
 * 45.7 MB file whose index moved from the end to a fragmented front. **Only
 * the first of each is mapped**, so a source carrying more tracks comes out
 * smaller: 13.9% under on one with four audio tracks (dl-96's gate, F4). The
 * variant does not say how many tracks it has, so that case keeps the size,
 * shown as approximate. A transcode, an audio-only cut, a separate
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

interface AttemptContext {
  url: string;
  container: OutputContainer;
  audioOnly: boolean;
  subtitles: readonly SubtitleTrack[];
  durationSec: number | null;
  liveDurationSec: number | null;
  /** The seek probe answered `206` for this candidate. */
  seekable: boolean;
}

/**
 * Whether this attempt's input goes through a loopback range server that can
 * split it into parallel ranges once one connection measures slow (dl-98).
 *
 * Only a progressive file read as one input whose origin answered the seek
 * probe with a `206`: a file that cannot be ranged cannot be split, and
 * leaving it to ffmpeg keeps dl-102's and dl-103's verdicts on it exactly as
 * they were. Not a live capture, not a separate audio rendition (two inputs
 * would share a bitrate), not an opted-out host (Decision 4), not a host that
 * refused before (Decision 5), and not when ffmpeg would ignore the proxy and
 * go direct, where the feeder could not follow it.
 */
function splittable(request: StreamRequest, deps: StreamDeps, context: AttemptContext): boolean {
  const { variant } = request;
  if (deps.config.parallelRanges.connections < 2) return false;
  if (variant.protocol !== "progressive" || !context.seekable) return false;
  if (typeof variant.audioUrl === "string" && variant.audioUrl.length > 0) return false;
  if (context.liveDurationSec !== null) return false;
  let host: string;
  try {
    const parsed = new URL(context.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    host = parsed.hostname;
  } catch {
    return false;
  }
  if (hostListed(host, deps.config.singleConnectionHosts)) return false;
  if (deps.refusedHosts?.has(host.toLowerCase()) === true) return false;
  return egressProxy({ proxyUrl: deps.config.proxyUrl }).kind !== "unusable";
}

async function attempt(
  request: StreamRequest,
  deps: StreamDeps,
  context: AttemptContext,
): Promise<Pick<MediaStream, "body" | "transcodes" | "done">> {
  const { config, logger } = deps;

  // A live capture's duration is the caller's limit; a VOD's is the manifest's.
  const mediaDurationSec = context.liveDurationSec ?? context.durationSec;
  // When the probe could not time the source, ffmpeg can: it reads the
  // duration before its first output byte and says so at info level (dl-96).
  // Until then the percent stays null, as it must.
  let learnedDurationSec: number | null = null;

  let feeder: RangeFeeder | null = null;
  if (splittable(request, deps, context)) {
    const route = egressProxy({ proxyUrl: config.proxyUrl });
    feeder = await RangeFeeder.start({
      url: context.url,
      requestContext: request.requestContext,
      route: route.kind === "unusable" ? { kind: "direct" } : route,
      tlsVerify: config.tlsVerify,
      tlsCaFile: config.tlsCaFile,
      settings: config.parallelRanges,
      sizeHint:
        request.variant.filesizeIsEstimate === true
          ? null
          : (request.variant.filesizeBytes ?? null),
      durationSec: () => mediaDurationSec ?? learnedDurationSec,
      maxBytes: config.maxFileSizeBytes,
      signal: request.signal,
      logger,
      jobId: request.jobId,
      onRefused: (host) => deps.refusedHosts?.add(host.toLowerCase()),
      // Read only once ffmpeg asks the loopback for bytes, so after it exists.
      onFatal: (error) => ffmpeg.terminate(error),
    }).catch((error: unknown) => {
      // A loopback that will not listen, or a CA file that will not read, costs
      // the speed-up and nothing else: ffmpeg reads the origin as it always has.
      logger.warn("the parallel-range feeder did not start; reading on one connection", {
        jobId: request.jobId,
        code: (error as NodeJS.ErrnoException | undefined)?.code ?? "failed",
      });
      return null;
    });
  }

  const built = ((): ReturnType<typeof buildStreamArgs> => {
    try {
      return buildStreamArgs({
        url: context.url,
        loopbackUrl: feeder?.url,
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
    } catch (error: unknown) {
      feeder?.close();
      throw error;
    }
  })();
  const { args, transcodes } = built;

  for (const notice of transcodes) {
    logger.warn("transcoding a stream — this is slow and lossy", {
      kind: notice.kind,
      from: notice.from,
      to: notice.to,
      container: context.container,
      reason: notice.reason,
    });
  }

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
  // `PARTIAL_FILE`: the offset awaiting its verdict, the verdict once there
  // is one, and whether a byte had reached the reader yet.
  const progressive = request.variant.protocol === "progressive";
  let partialAt: number | null = null;
  let verdict: AppError | null = null;
  let verdictTimer: NodeJS.Timeout | undefined;
  let onVerdict: (() => void) | null = null;
  let handedOver = false;
  const partialDetails = (): Record<string, unknown> => ({
    jobId: request.jobId,
    variantId: request.variant.id,
    url: redactUrl(context.url),
    afterFirstByte: handedOver,
    stderr: stderrTail,
  });
  const shortSource = (): AppError =>
    new AppError("DOWNLOAD_FAILED", "The source ended before the whole video arrived.", {
      details: partialDetails(),
    });
  const decide = (error: AppError): void => {
    if (verdict !== null) return;
    verdict = error;
    partialAt = null;
    clearTimeout(verdictTimer);
    ffmpeg.terminate(error);
    onVerdict?.();
  };

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
      rate.record(sent, now, snapshot.outTimeUs);
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
      // The first line that parses. Inputs are described in order, so that is
      // the video's unless its input says `N/A`; a later input is a separate
      // audio rendition or a subtitle track, timed against the same video.
      learnedDurationSec = durationFromInfoLine(line);
    },
    onStderrLine: (line) => {
      logger.debug("ffmpeg", { line });
      stderrTail = `${stderrTail}${line}\n`.slice(-STDERR_TAIL_CHARS);
      if (!sawCertificateRejection) sawCertificateRejection = isTlsVerificationFailure(line);
      if (STREAM_ENDED_EARLY.test(line)) endedEarly.add(connectionOf(line) ?? line);
      else if (WILL_RECONNECT.test(line)) endedEarly.delete(connectionOf(line) ?? line);
      if (progressive && verdict === null) {
        const endedAt = SAME_OFFSET_ENDS_EARLY.exec(line)?.[1];
        const partial = PARTIAL_FILE.exec(line)?.[1];
        if (partialAt !== null && endedAt !== undefined && Number(endedAt) === partialAt) {
          decide(new AppError("SOURCE_NOT_SEEKABLE", undefined, { details: partialDetails() }));
        } else if (partialAt === null && partial !== undefined) {
          partialAt = Number.parseInt(partial, 16);
          verdictTimer = setTimeout(() => decide(shortSource()), PARTIAL_VERDICT_MS);
          verdictTimer.unref?.();
        }
      }
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
  const exited = ffmpeg.completion.then(
    () => undefined,
    () => undefined,
  );
  void exited.then(() => clearTimeout(verdictTimer));
  // Released from `completion`, not from the body: a refusal before the first
  // byte leaves this function by a throw, and no body ever exists (dl-103).
  void exited.then(() => feeder?.close());

  const first = await firstChunk(ffmpeg.stdout, ffmpeg.completion);
  if (first === null) {
    // Exit 0 with nothing written is not a success: it is exactly what an
    // undemuxable input looks like (the header of this file has the case).
    await ffmpeg.completion;
    throw new AppError("DOWNLOAD_FAILED", "The source produced no media.", {
      details: { jobId: request.jobId },
    });
  }
  if (partialAt !== null && verdict === null) {
    // `partial file` came before the first byte: hold it until the verdict,
    // which is a line or two away, so that an unseekable source is refused
    // before anything reaches the reader.
    await Promise.race([
      new Promise<void>((resolve) => {
        onVerdict = resolve;
      }),
      exited,
    ]);
    if (verdict === null && partialAt !== null) decide(shortSource());
  }
  if (verdict !== null) {
    // Decided while the first chunk was on its way: nothing has reached the
    // reader, so this is still a failure before the first byte. Drained so
    // the killed process can close.
    const decided: AppError = verdict;
    ffmpeg.stdout.resume();
    await exited;
    // Whatever ended ffmpeg first keeps its code (`terminate` is first-wins):
    // a cancel, a stage timeout or a crash inside the hold is not a short
    // source, and a verdict that ended it arrives the same way. Only a clean
    // exit leaves the verdict to say what happened (dl-103's gate 2, G2-1).
    throw await ffmpeg.completion.then(
      () => decided,
      (error: unknown) => AppError.from(error),
    );
  }
  handedOver = true;

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
      // A `partial file` with no early end at its offset by the time ffmpeg
      // finished: the source was short (`PARTIAL_FILE`).
      if (partialAt !== null) throw shortSource();
      body.end();
      // Every chunk through the counter, not merely out of ffmpeg: a slow
      // reader leaves the last few queued on the writable side. A reader that
      // leaves in that window is a cancel, and `finished` says so.
      await finished(body, { readable: false }).catch(() => {
        throw new AppError("JOB_CANCELED");
      });
      const observedUs = result.lastSnapshot?.outTimeUs ?? null;
      logger.info("engine stream complete", {
        jobId: request.jobId,
        bytes: sent,
        ...(feeder === null ? {} : { rangeFeeder: feeder.stats() }),
      });
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
