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
 *  - **Fragmented MP4.** The output is a pipe (dl-53), so the index cannot be
 *    moved to the front after the fact; see `streamingContainerArgs`.
 *  - **`-bsf:a aac_adtstoasc`.** Required moving AAC out of MPEG-TS into MP4.
 *    Without it the audio plays in VLC and nowhere else. Modern ffmpeg's mov
 *    muxer inserts it automatically; passing it explicitly costs nothing and
 *    covers older builds.
 *  - **Subtitles are soft tracks, never burned in.** Burning in is destructive
 *    and irreversible; the user asked for a download, not a re-render.
 */

import { AppError, canMakeWebm } from "@downloader/contract";
import type { MediaVariant } from "@downloader/contract";
import { buildDurationLimitArgs } from "./ffmpeg/args.ts";

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
    // Sample-entry fourccs, which a header read (dl-99) hands over as they are
    // written: `ac-3` is AC-3, `mp4v` is MPEG-4 part 2. Unaliased, MP4 would
    // transcode both for being unrecognised.
    "ac-3": "ac3",
    mp4v: "mpeg4",
    // Dolby Vision's sample entries wrap an HEVC, AVC or AV1 stream the MP4
    // muxer copies as it does the plain ones (the owner's decision, 2026-10-08).
    dvh1: "hevc",
    dvhe: "hevc",
    dva1: "h264",
    dvav: "h264",
    dav1: "av1",
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

/**
 * Refuses, before ffmpeg starts, a WebM that ffmpeg would refuse after it did
 * (dl-99). An undeclared codec is copied (`containerSupports`), which is right
 * for MP4 and MKV and wrong for WebM: a source nothing describes is nearly
 * always H.264/AAC, and ffmpeg fails the mux with "Only VP8 or VP9 or AV1 video
 * ..." after the container's first bytes are already on the wire — a job that
 * reads as a flaky CDN. What the picker withholds (`canMakeWebm`) is what this
 * refuses, so the two agree.
 */
export function assertContainerCanHold(
  container: OutputContainer,
  variant: MediaVariant,
  options: { audioOnly: boolean; jobId: string },
): void {
  if (container !== "webm" || canMakeWebm(variant, { audioOnly: options.audioOnly })) return;
  throw new AppError("CONTAINER_UNSUPPORTED", undefined, {
    details: {
      jobId: options.jobId,
      variantId: variant.id,
      container,
      sourceContainer: variant.container ?? null,
    },
  });
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

/**
 * The muxer and its flags for an output that is written once, front to back.
 *
 * **Fragmented MP4, not fast-start.** `+faststart` moves `moov` ahead of `mdat`
 * by rewriting the finished file, and a pipe has no finished file to rewrite.
 * `empty_moov` writes the header first with no samples in it, and each fragment
 * carries its own index, so a player can start on the first fragment and a
 * cut-off transfer still plays up to the cut. The owner accepted what this
 * costs on 2026-09-14 — some players show the duration late or seek slowly in
 * a long file (dl-53).
 *
 * Fragments start at each video keyframe, and **at least once a second**
 * (dl-96). ffmpeg holds a whole fragment before writing any of it, so the
 * keyframe interval alone set how often the visitor received anything: a
 * source with a 6 s GOP behind a 20 KB/s origin went minutes between writes,
 * and the bytes-sent rate read 0 B/s for all of them. Capped at 1 s, a 60 s
 * fixture went from 8 fragments to 65 for 12 KB more on 45.7 MB, and decoded
 * the same. With no video there are no keyframes to cut at in any useful
 * sense — every audio packet is one, and a fragment per packet multiplies the
 * index — so audio-only output is cut by duration alone.
 *
 * Matroska and WebM need nothing: their muxer already writes front to back,
 * and on a pipe it simply omits the seek index it cannot go back for.
 */
export function streamingContainerArgs(container: OutputContainer, hasVideo: boolean): string[] {
  if (container === "mp4") {
    return hasVideo
      ? [
          "-movflags",
          "frag_keyframe+empty_moov+default_base_moof",
          "-frag_duration",
          "1000000",
          "-f",
          "mp4",
        ]
      : ["-movflags", "empty_moov+default_base_moof", "-frag_duration", "2000000", "-f", "mp4"];
  }
  return ["-f", container === "webm" ? "webm" : "matroska"];
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

  args.push(...streamingContainerArgs(options.container, hasVideo));

  if (options.title !== undefined && options.title.length > 0) {
    args.push("-metadata", `title=${options.title}`);
  }

  args.push(...buildDurationLimitArgs(options.durationLimitSec));
  return { args, transcodes };
}
