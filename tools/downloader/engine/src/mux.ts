/**
 * Output container assembly.
 *
 * Rules, in decreasing order of how much time they save:
 *
 *  - **`-c copy` always.** Re-encoding is ~50x slower and lossy. Transcoding
 *    happens only when the chosen container genuinely cannot carry the codec,
 *    and when it does it is logged loudly, because a silent transcode is how a
 *    two-minute job becomes a two-hour one with nobody knowing why.
 *  - **Explicit `-map`.** Without it ffmpeg picks one stream per type by its own
 *    rules and silently drops the rest — the usual symptom is a DASH download
 *    with no audio.
 *  - **`-movflags +faststart`.** Moves `moov` ahead of `mdat` so the file plays
 *    while it downloads instead of after.
 *  - **`-bsf:a aac_adtstoasc`.** Required moving AAC out of MPEG-TS into MP4.
 *    Without it the audio plays in VLC and nowhere else. Modern ffmpeg's mov
 *    muxer inserts it automatically; passing it explicitly costs nothing and
 *    covers older builds.
 *  - **Subtitles are soft tracks, never burned in.** Burning in is destructive
 *    and irreversible; the user asked for a download, not a re-render.
 */

import fs from "node:fs/promises";
import { AppError } from "@downloader/contract";
import type { JobProgress } from "@downloader/contract";
import { buildDurationLimitArgs, GLOBAL_ARGS, PROGRESS_ARGS } from "./ffmpeg/args.ts";
import { buildLocalInputArgs } from "./ffmpeg/args.ts";
import type { FfmpegProgressSnapshot } from "./ffmpeg/progress.ts";
import { toJobProgress } from "./ffmpeg/progress.ts";
import { runFfmpeg } from "./ffmpeg/runner.ts";
import type { Logger } from "./logger.ts";
import { NOOP_LOGGER } from "./logger.ts";

export type OutputContainer = "mp4" | "mkv" | "webm";

export const CONTAINER_EXTENSIONS: Readonly<Record<OutputContainer, string>> = {
  mp4: ".mp4",
  mkv: ".mkv",
  webm: ".webm",
};

/**
 * Codec strings arrive as RFC 6381 identifiers (`avc1.640028`, `mp4a.40.2`) or
 * as ffmpeg names (`h264`, `aac`). Normalise to one vocabulary before deciding
 * anything, or `avc1.640028` looks unsupported and triggers a needless
 * transcode of a perfectly ordinary H.264 stream.
 */
export function normalizeCodecName(codec: string | undefined): string | null {
  if (codec === undefined) return null;
  const base = codec.trim().toLowerCase().split(".")[0]?.split(",")[0] ?? "";
  if (base.length === 0 || base === "none" || base === "unknown") return null;

  const aliases: Record<string, string> = {
    avc1: "h264",
    avc3: "h264",
    h264: "h264",
    x264: "h264",
    hev1: "hevc",
    hvc1: "hevc",
    h265: "hevc",
    hevc: "hevc",
    av01: "av1",
    av1: "av1",
    vp09: "vp9",
    vp9: "vp9",
    vp08: "vp8",
    vp8: "vp8",
    mp4a: "aac",
    aac: "aac",
    "mp4a-40-2": "aac",
    opus: "opus",
    vorbis: "vorbis",
    mp3: "mp3",
    "mp4a-40-34": "mp3",
    ac3: "ac3",
    "ec-3": "eac3",
    eac3: "eac3",
    flac: "flac",
    alac: "alac",
  };
  return aliases[base] ?? base;
}

interface ContainerCapability {
  video: ReadonlySet<string>;
  audio: ReadonlySet<string>;
  /** Codec ffmpeg should use for subtitle streams in this container. */
  subtitleCodec: string;
  transcodeVideoTo: string;
  transcodeAudioTo: string;
}

const CONTAINER_CAPABILITIES: Readonly<Record<OutputContainer, ContainerCapability>> = {
  mp4: {
    video: new Set(["h264", "hevc", "av1", "vp9", "mpeg4", "mjpeg"]),
    audio: new Set(["aac", "mp3", "ac3", "eac3", "alac", "opus", "flac"]),
    // MP4 has no native WebVTT; mov_text is the standard soft track for it.
    subtitleCodec: "mov_text",
    transcodeVideoTo: "libx264",
    transcodeAudioTo: "aac",
  },
  webm: {
    video: new Set(["vp8", "vp9", "av1"]),
    audio: new Set(["opus", "vorbis"]),
    subtitleCodec: "webvtt",
    transcodeVideoTo: "libvpx-vp9",
    transcodeAudioTo: "libopus",
  },
  mkv: {
    // Matroska carries essentially anything; the empty sets are never consulted
    // because `containerSupports` short-circuits on mkv.
    video: new Set(),
    audio: new Set(),
    subtitleCodec: "srt",
    transcodeVideoTo: "libx264",
    transcodeAudioTo: "aac",
  },
};

/** Unknown codecs return true: assume copy works and let ffmpeg object if not. */
export function containerSupports(
  container: OutputContainer,
  kind: "video" | "audio",
  codec: string | undefined,
): boolean {
  if (container === "mkv") return true;
  const normalized = normalizeCodecName(codec);
  if (normalized === null) return true;
  return CONTAINER_CAPABILITIES[container][kind].has(normalized);
}

export interface StreamMap {
  inputIndex: number;
  kind: "video" | "audio" | "subtitle";
  /** Nth stream of that kind within the input. Omit to take all of them. */
  streamIndex?: number;
  /** Appends `?` so ffmpeg tolerates the stream being absent. */
  optional?: boolean;
}

export function formatMapArg(map: StreamMap): string {
  const kindLetter = { video: "v", audio: "a", subtitle: "s" }[map.kind];
  const selector =
    map.streamIndex === undefined
      ? `${map.inputIndex}:${kindLetter}`
      : `${map.inputIndex}:${kindLetter}:${map.streamIndex}`;
  return map.optional === true ? `${selector}?` : selector;
}

export interface TranscodeNotice {
  kind: "video" | "audio" | "subtitle";
  from: string | null;
  to: string;
  reason: string;
}

export interface OutputArgsOptions {
  container: OutputContainer;
  maps: readonly StreamMap[];
  /** Source codecs, used only to decide whether the container can hold them. */
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
  /** Drop video entirely. */
  audioOnly?: boolean;
  /** Number of subtitle inputs, with their BCP-47 tags in output order. */
  subtitleLanguages?: readonly string[];
  /** Bound a live capture. */
  durationLimitSec?: number | null | undefined;
  /**
   * The source is (or may be) MPEG-TS. Controls `-bsf:a aac_adtstoasc`; set
   * false for a known fragmented-MP4 source, where the filter has no input to
   * convert.
   */
  sourceMayBeMpegTs?: boolean;
  title?: string | undefined;
}

export interface OutputArgsResult {
  args: string[];
  transcodes: TranscodeNotice[];
}

/**
 * Everything between the last `-i` and the output path.
 *
 * Returns the transcode decisions alongside the args so the caller can log them
 * rather than this module needing a logger.
 */
export function buildOutputArgs(options: OutputArgsOptions): OutputArgsResult {
  const capability = CONTAINER_CAPABILITIES[options.container];
  const transcodes: TranscodeNotice[] = [];
  const args: string[] = [];

  const maps =
    options.audioOnly === true ? options.maps.filter((map) => map.kind !== "video") : options.maps;
  for (const map of maps) {
    args.push("-map", formatMapArg(map));
  }

  const hasVideo = maps.some((map) => map.kind === "video");
  const hasAudio = maps.some((map) => map.kind === "audio");
  const hasSubtitles = maps.some((map) => map.kind === "subtitle");

  // Stream copy is the baseline; the per-stream overrides below only fire when
  // the container cannot carry what we have.
  args.push("-c", "copy");

  if (hasVideo && !containerSupports(options.container, "video", options.videoCodec)) {
    args.push("-c:v", capability.transcodeVideoTo);
    transcodes.push({
      kind: "video",
      from: normalizeCodecName(options.videoCodec),
      to: capability.transcodeVideoTo,
      reason: `${options.container} cannot carry this video codec`,
    });
  }

  if (hasAudio && !containerSupports(options.container, "audio", options.audioCodec)) {
    args.push("-c:a", capability.transcodeAudioTo);
    transcodes.push({
      kind: "audio",
      from: normalizeCodecName(options.audioCodec),
      to: capability.transcodeAudioTo,
      reason: `${options.container} cannot carry this audio codec`,
    });
  }

  if (hasSubtitles) {
    // A subtitle *format* conversion, not a burn-in: the track stays selectable.
    args.push("-c:s", capability.subtitleCodec);
    const languages = options.subtitleLanguages ?? [];
    for (const [index, language] of languages.entries()) {
      if (language.length === 0) continue;
      args.push(`-metadata:s:s:${index}`, `language=${language}`);
    }
  }

  if (
    options.container === "mp4" &&
    hasAudio &&
    options.sourceMayBeMpegTs !== false &&
    containerSupports(options.container, "audio", options.audioCodec)
  ) {
    args.push("-bsf:a", "aac_adtstoasc");
  }

  if (options.container === "mp4") {
    args.push("-movflags", "+faststart");
  }

  if (options.title !== undefined && options.title.length > 0) {
    args.push("-metadata", `title=${options.title}`);
  }

  args.push(...buildDurationLimitArgs(options.durationLimitSec));
  return { args, transcodes };
}

export interface MuxInputFile {
  path: string;
  /** Which streams to take. Order across inputs defines output stream order. */
  take: readonly ("video" | "audio" | "subtitle")[];
  /** BCP-47 tag applied when `take` includes a subtitle. */
  language?: string;
}

export interface MuxOptions {
  inputs: readonly MuxInputFile[];
  destPath: string;
  container: OutputContainer;
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
  audioOnly?: boolean;
  sourceMayBeMpegTs?: boolean;
  title?: string | undefined;
  durationSec?: number | null;
  ffmpegPath: string;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  maxOutputBytes?: number | undefined;
  onProgress?: ((progress: JobProgress) => void) | undefined;
  logger?: Logger | undefined;
}

export interface MuxResult {
  path: string;
  bytes: number;
  durationSec: number | null;
  transcodes: TranscodeNotice[];
}

/** Joins local files into one container. Inputs must already be on disk. */
export async function mux(options: MuxOptions): Promise<MuxResult> {
  const logger = options.logger ?? NOOP_LOGGER;

  if (options.inputs.length === 0) {
    throw new AppError("MUX_FAILED", "Nothing to assemble.", { details: { inputs: 0 } });
  }

  const args: string[] = [...GLOBAL_ARGS, ...PROGRESS_ARGS];
  const maps: StreamMap[] = [];
  const subtitleLanguages: string[] = [];

  for (const [inputIndex, input] of options.inputs.entries()) {
    args.push(...buildLocalInputArgs(input.path));
    for (const kind of input.take) {
      maps.push({ inputIndex, kind, streamIndex: 0, optional: kind === "subtitle" });
      if (kind === "subtitle") subtitleLanguages.push(input.language ?? "");
    }
  }

  const output = buildOutputArgs({
    container: options.container,
    maps,
    videoCodec: options.videoCodec,
    audioCodec: options.audioCodec,
    ...(options.audioOnly === undefined ? {} : { audioOnly: options.audioOnly }),
    subtitleLanguages,
    ...(options.sourceMayBeMpegTs === undefined
      ? {}
      : { sourceMayBeMpegTs: options.sourceMayBeMpegTs }),
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

  args.push(...output.args, options.destPath);

  const durationSec = options.durationSec ?? null;
  const result = await runFfmpeg({
    ffmpegPath: options.ffmpegPath,
    args,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    failureCode: "MUX_FAILED",
    logger,
    onProgress: (snapshot: FfmpegProgressSnapshot) => {
      options.onProgress?.(
        toJobProgress(snapshot, {
          stage: "muxing",
          durationSec,
          totalBytes: null,
          speedBps: null,
        }),
      );
    },
  });

  const stat = await fs.stat(options.destPath);
  const observedSec =
    result.lastSnapshot?.outTimeUs === null || result.lastSnapshot?.outTimeUs === undefined
      ? null
      : result.lastSnapshot.outTimeUs / 1_000_000;

  return {
    path: options.destPath,
    bytes: stat.size,
    durationSec: observedSec ?? durationSec,
    transcodes: output.transcodes,
  };
}
