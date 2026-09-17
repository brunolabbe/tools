/**
 * One preview frame, grabbed from a stream, for a page that names no image
 * (dl-56).
 *
 * dl-29 kept previews to images the source names and called frame grabbing "a
 * different and much larger feature". What made it larger was everything this
 * file does *not* do: no per-rendition frames, no asynchronous grab announced
 * later, no retry against another rendition or another mirror. It is one ffmpeg
 * invocation with the same input options a download uses, bounded in time and
 * in bytes, returning the JPEG or `null`.
 *
 * **The egress is the caller's to get right, and it is the part that matters.**
 * ffmpeg opens every segment, init segment and key a manifest names, none of
 * which the probe's SSRF sweep ever saw. `proxyUrl` must be the ffmpeg egress
 * proxy — the same one the engine downloads through — or this reopens dl-11.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@downloader/contract";
import type { MediaVariant, RequestContext, StreamProtocol } from "@downloader/contract";
import type { Logger } from "../logger.ts";
import { NOOP_LOGGER } from "../logger.ts";
import { buildNetworkInputArgs, GLOBAL_ARGS, PROGRESS_ARGS } from "./args.ts";
import { runFfmpeg } from "./runner.ts";

/**
 * The longest edge of a grabbed frame, in pixels.
 *
 * The largest place a preview renders is `.preview--panel`, 8rem wide — 128
 * CSS pixels. Twice that covers a 2x display, and nothing renders it larger, so
 * every pixel past this is bytes nobody sees.
 */
export const PREVIEW_FRAME_MAX_EDGE_PX = 256;

/**
 * How far in to seek: a tenth of the duration, never past this.
 *
 * Opening frames are often black — a fade-in, a slate. A tenth in is past most
 * of those on a short clip, and the cap is what keeps the seek cheap. The seek
 * is output-side (see `buildPreviewFrameArgs`), so everything before the frame
 * is fetched and decoded. Measured on generated ladders: three seconds stays
 * inside the two segments ffmpeg fetches to probe the streams anyway on 6- and
 * 10-second segments, and costs one segment more than frame 0 on 2-second ones.
 */
export const PREVIEW_SEEK_FRACTION = 0.1;
export const PREVIEW_SEEK_CAP_SEC = 3;

/** The output-side `-ss`, in seconds. 0 when the duration is unknown. */
export function previewSeekSec(durationSec: number | null | undefined): number {
  if (durationSec === null || durationSec === undefined) return 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.min(PREVIEW_SEEK_CAP_SEC, durationSec * PREVIEW_SEEK_FRACTION);
}

/**
 * The rendition to grab from: the cheapest one that has video.
 *
 * Only among the probe's own variants, which after dl-55 are renditions of the
 * one video the tier chose — so the lowest rung shows the same picture as the
 * highest and costs the fewest bytes. When no variant declares a bitrate there
 * is nothing to compare, and the probe's own order stands: the first with
 * video. A variant without a bitrate is never picked over one with, because
 * "unknown" is not "cheap".
 *
 * Returns one variant and never a list. A grab that fails does not move on to
 * another rendition: a frame from a stream the probe did not rank is the one
 * outcome worse than no preview.
 */
export function choosePreviewVariant(variants: readonly MediaVariant[]): MediaVariant | null {
  const withVideo = variants.filter((variant) => variant.hasVideo);
  let cheapest: MediaVariant | null = null;
  for (const variant of withVideo) {
    const bitrate = variant.bitrateBps;
    if (bitrate === undefined || !Number.isFinite(bitrate) || bitrate <= 0) continue;
    if (cheapest === null || bitrate < (cheapest.bitrateBps as number)) cheapest = variant;
  }
  return cheapest ?? withVideo[0] ?? null;
}

export interface PreviewFrameOptions {
  /**
   * The rendition's own URL. For split DASH or HLS this is the video; the
   * variant's `audioUrl` is never opened, since a frame has no sound.
   */
  url: string;
  protocol: StreamProtocol;
  requestContext?: RequestContext | undefined;
  /** Drives the seek. See `previewSeekSec`. */
  durationSec?: number | null | undefined;
  ffmpegPath: string;
  /** The **ffmpeg egress proxy**. See the header. */
  proxyUrl?: string | undefined;
  /** Defaults to on, as for a download. */
  tlsVerify?: boolean | undefined;
  tlsCaFile?: string | undefined;
  /**
   * The storage `tmp/` root. The frame is written to a fresh directory under
   * it, removed before this returns; one left by a crash is the retention
   * sweep's, like any other orphaned working directory.
   */
  tmpRoot: string;
  /** Hard ceiling on the invocation. Past it, the process tree is killed. */
  timeoutMs: number;
  /** A frame larger than this is refused, however it got that large. */
  maxOutputBytes: number;
  signal?: AbortSignal | undefined;
  logger?: Logger | undefined;
}

/** JPEG's start-of-image marker. Anything else is not the frame we asked for. */
const JPEG_SOI = [0xff, 0xd8] as const;

/**
 * Outcomes that are the stream's fault and so mean "no preview". Anything else
 * — a canceled caller, a missing binary — is not a fact about this stream and
 * is thrown.
 */
const STREAM_SIDE_FAILURES: ReadonlySet<string> = new Set([
  "TIMEOUT",
  "SIZE_LIMIT_EXCEEDED",
  "DOWNLOAD_FAILED",
  "TLS_VERIFICATION_FAILED",
]);

/** Exported for tests: the full argv, without spawning anything. */
export function buildPreviewFrameArgs(
  options: Pick<
    PreviewFrameOptions,
    "url" | "protocol" | "requestContext" | "durationSec" | "tlsVerify" | "tlsCaFile"
  >,
  destPath: string,
): string[] {
  const seek = previewSeekSec(options.durationSec);
  const edge = String(PREVIEW_FRAME_MAX_EDGE_PX);
  return [
    ...GLOBAL_ARGS,
    // Not optional: `runFfmpeg` reads the output size off the progress stream,
    // and that is what enforces `maxOutputBytes` while ffmpeg is still running.
    ...PROGRESS_ARGS,
    ...buildNetworkInputArgs(options.url, {
      requestContext: options.requestContext,
      ...(options.tlsVerify === undefined ? {} : { tlsVerify: options.tlsVerify }),
      ...(options.tlsCaFile === undefined ? {} : { tlsCaFile: options.tlsCaFile }),
      hlsAllowAllExtensions: options.protocol === "hls",
      // A decorative grab gets one try. Reconnecting would spend the budget on
      // a stream that already dropped the connection once.
      reconnect: false,
      // No `readTimeoutMs` of its own: a stall timeout does nothing against a
      // stream that trickles a byte a second, so the bound is `runFfmpeg`'s
      // timer and its process-tree kill, and nothing else pretends to be.
    }),
    // **Output-side, measured against input-side** (dl-56's Log has the table).
    // The HLS demuxer reads the first two segments while it probes the streams,
    // and an input-side seek then reopens the segment holding the seek point and
    // fetches it again: 1.3x the bytes of this form on 2-second segments and 2x
    // on 6- and 10-second ones. An output-side seek decodes forward from what
    // probing already fetched. It lost only on 1 s segments, by 1.25x, and not on every fixture.
    ...(seek > 0 ? ["-ss", seek.toFixed(3)] : []),
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn",
    "-frames:v",
    "1",
    "-vf",
    // Down to fit, never up: a 160x120 rendition stays 160x120. The quotes are
    // filtergraph quoting, not shell quoting — there is no shell here.
    `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    "-pix_fmt",
    "yuvj420p",
    "-c:v",
    "mjpeg",
    "-q:v",
    "4",
    // The raw MJPEG muxer writes exactly one JPEG for one frame. Not stdout:
    // `PROGRESS_ARGS` already claims `pipe:1`.
    "-f",
    "mjpeg",
    destPath,
  ];
}

/**
 * Grabs one frame and returns it as JPEG bytes, or `null`.
 *
 * **Never throws for a stream-side failure**: a timeout, a refused or failed
 * fetch, a certificate the proxy would not accept, an output past the cap, a
 * stream with no video, or bytes that are not a JPEG all return `null`, logged
 * at `debug`. It throws for `JOB_CANCELED` and for a binary that will not start,
 * which say nothing about the stream.
 *
 * A timeout kills the process tree, through `runFfmpeg`, before this returns.
 */
export async function grabPreviewFrame(options: PreviewFrameOptions): Promise<Buffer | null> {
  const logger = options.logger ?? NOOP_LOGGER;
  const workDir = path.join(options.tmpRoot, `preview-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  const destPath = path.join(workDir, "frame.jpg");

  try {
    const args = buildPreviewFrameArgs(options, destPath);
    try {
      await runFfmpeg({
        ffmpegPath: options.ffmpegPath,
        args,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        proxyUrl: options.proxyUrl,
        failureCode: "DOWNLOAD_FAILED",
        logger,
        // Already through `redactUrlsInText`: ffmpeg echoes input URLs, and a
        // signed URL's query string is a credential.
        onStderrLine: (line) => {
          logger.debug("ffmpeg (preview frame)", { line });
        },
      });
    } catch (error: unknown) {
      const appError = AppError.from(error);
      if (!STREAM_SIDE_FAILURES.has(appError.code)) throw appError;
      logger.debug("no preview frame: ffmpeg did not produce one", {
        code: appError.code,
        // `runFfmpeg` builds `stderr` from the redacted tail.
        ...(typeof appError.details?.["stderr"] === "string"
          ? { stderr: appError.details["stderr"] }
          : {}),
      });
      return null;
    }

    let bytes: Buffer;
    try {
      // Checked again here rather than trusted to the progress stream: a single
      // frame can be written and flushed between two progress reports.
      const stat = await fs.stat(destPath);
      if (stat.size > options.maxOutputBytes) {
        logger.debug("no preview frame: larger than the cap", {
          bytes: stat.size,
          maxBytes: options.maxOutputBytes,
        });
        return null;
      }
      bytes = await fs.readFile(destPath);
    } catch {
      // Exit 0 with no file: a stream whose video never decoded a frame.
      logger.debug("no preview frame: ffmpeg exited without writing one");
      return null;
    }

    if (bytes.length < JPEG_SOI.length || bytes[0] !== JPEG_SOI[0] || bytes[1] !== JPEG_SOI[1]) {
      logger.debug("no preview frame: the output is not a JPEG", { bytes: bytes.length });
      return null;
    }
    return bytes;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
