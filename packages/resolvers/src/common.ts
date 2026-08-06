/**
 * Small pure helpers shared by the manifest parsers and the resolvers.
 *
 * Kept in one place because a variant discovered by yt-dlp, by parsing an HLS
 * master playlist or by reading an MPD must present itself to the picker in the
 * same way — three subtly different label formats would read as three bugs.
 */

/**
 * Drops `undefined` entries so an object literal can be spread into a type
 * compiled with `exactOptionalPropertyTypes`, where `{ width: undefined }` is
 * not assignable to `width?: number`.
 */
export function optional<T extends Record<string, unknown>>(
  input: T,
): Partial<{ [K in keyof T]: Exclude<T[K], undefined> }> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;
}

/** Resolves a possibly-relative manifest URI. Returns the input unchanged when it cannot. */
export function resolveUrl(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return uri;
  }
}

/** Lower-cased path extension without the dot, or `undefined` for extensionless paths. */
export function urlExtension(url: string): string | undefined {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    const query = pathname.indexOf("?");
    if (query !== -1) pathname = pathname.slice(0, query);
  }
  const lastSlash = pathname.lastIndexOf("/");
  const name = lastSlash === -1 ? pathname : pathname.slice(lastSlash + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

const VIDEO_CODEC_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(avc[13]|h264|x264)/, "H.264"],
  [/^(hvc1|hev1|h265|x265)/, "H.265"],
  [/^(dvh[e1]|dva[13])/, "Dolby Vision"],
  [/^(vp0?9)/, "VP9"],
  [/^(vp0?8)/, "VP8"],
  [/^(av0?1)/, "AV1"],
  [/^mp4v/, "MPEG-4"],
  [/^theora/, "Theora"],
  [/^mpeg2video/, "MPEG-2"],
];

const AUDIO_CODEC_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(ac-3|mp4a\.a5)/, "AC-3"],
  [/^(ec-3|mp4a\.a6)/, "E-AC-3"],
  [/^mp4a\.(69|6b)/, "MP3"],
  [/^(mp3|mp4a\.40\.34)/, "MP3"],
  [/^mp4a/, "AAC"],
  [/^(aac|he-aac)/, "AAC"],
  [/^opus/, "Opus"],
  [/^vorbis/, "Vorbis"],
  [/^f?lac/i, "FLAC"],
  [/^alac/, "ALAC"],
  [/^dts/, "DTS"],
  [/^(ac-4)/, "AC-4"],
];

function lookup(
  codec: string,
  table: ReadonlyArray<readonly [RegExp, string]>,
): string | undefined {
  const normalised = codec.trim().toLowerCase();
  for (const [pattern, name] of table) {
    if (pattern.test(normalised)) return name;
  }
  return undefined;
}

export function isVideoCodec(codec: string): boolean {
  return lookup(codec, VIDEO_CODEC_NAMES) !== undefined;
}

export function isAudioCodec(codec: string): boolean {
  return lookup(codec, AUDIO_CODEC_NAMES) !== undefined;
}

/** "avc1.640028" → "H.264". Falls back to the raw string so unknown codecs still show. */
export function humanVideoCodec(codec: string | undefined): string | undefined {
  if (codec === undefined || codec === "") return undefined;
  return lookup(codec, VIDEO_CODEC_NAMES) ?? codec;
}

/** "mp4a.40.2" → "AAC". Falls back to the raw string so unknown codecs still show. */
export function humanAudioCodec(codec: string | undefined): string | undefined {
  if (codec === undefined || codec === "") return undefined;
  return lookup(codec, AUDIO_CODEC_NAMES) ?? codec;
}

/**
 * Splits an RFC 6381 `CODECS` list into one video and one audio entry.
 * Anything unrecognised is treated as video when no video codec is known yet,
 * because a lone unknown codec on a variant with a RESOLUTION is a video codec.
 */
export function splitCodecs(codecs: string | undefined): {
  video: string | undefined;
  audio: string | undefined;
} {
  if (codecs === undefined || codecs.trim() === "") return { video: undefined, audio: undefined };
  let video: string | undefined;
  let audio: string | undefined;
  const unknown: string[] = [];
  for (const raw of codecs.split(",")) {
    const codec = raw.trim();
    if (codec === "") continue;
    if (isVideoCodec(codec)) video ??= codec;
    else if (isAudioCodec(codec)) audio ??= codec;
    else unknown.push(codec);
  }
  if (video === undefined && unknown.length > 0) video = unknown[0];
  return { video, audio };
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatSize(bytes: number, isEstimate: boolean): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${isEstimate ? "~" : ""}${rounded} ${SIZE_UNITS[unit] ?? "B"}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(secs).padStart(2, "0")}`;
}

export interface LabelInput {
  hasVideo?: boolean | undefined;
  height?: number | undefined;
  width?: number | undefined;
  fps?: number | undefined;
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
  bitrateBps?: number | undefined;
  filesizeBytes?: number | undefined;
  filesizeIsEstimate?: boolean | undefined;
  durationSec?: number | undefined;
  /** Used only when nothing else is known, e.g. "HLS stream". */
  fallback: string;
}

/**
 * Builds the picker string, e.g. `1080p60 · H.264 + AAC · ~420 MB`.
 * Parts that are genuinely unknown are omitted rather than guessed — a wrong
 * size in the picker is worse than a missing one.
 */
export function buildLabel(input: LabelInput): string {
  const parts: string[] = [];

  if (input.hasVideo === false) {
    parts.push("Audio only");
  } else if (input.height !== undefined && input.height > 0) {
    const fps = input.fps === undefined ? undefined : Math.round(input.fps);
    parts.push(`${input.height}p${fps !== undefined && fps > 30 ? String(fps) : ""}`);
  } else if (input.width !== undefined && input.width > 0) {
    parts.push(`${input.width}px wide`);
  }

  const video = humanVideoCodec(input.videoCodec);
  const audio = humanAudioCodec(input.audioCodec);
  const codecs = [video, audio].filter((value): value is string => value !== undefined).join(" + ");
  if (codecs !== "") parts.push(codecs);

  if (parts.length === 0 && input.durationSec !== undefined && input.durationSec > 0) {
    parts.push(formatDuration(input.durationSec));
  }

  if (input.filesizeBytes !== undefined && input.filesizeBytes > 0) {
    parts.push(formatSize(input.filesizeBytes, input.filesizeIsEstimate === true));
  } else if (parts.length === 0 && input.bitrateBps !== undefined && input.bitrateBps > 0) {
    parts.push(`${Math.round(input.bitrateBps / 1000)} kbps`);
  }

  return parts.length === 0 ? input.fallback : parts.join(" · ");
}

/** Bitrate × duration. Only ever an estimate — callers must set `filesizeIsEstimate`. */
export function estimateSizeBytes(
  bitrateBps: number | undefined,
  durationSec: number | undefined,
): number | undefined {
  if (bitrateBps === undefined || durationSec === undefined) return undefined;
  if (bitrateBps <= 0 || durationSec <= 0) return undefined;
  return Math.round((bitrateBps * durationSec) / 8);
}

/** Best-first: tallest, then highest bitrate. Used by every variant producer. */
export function compareVariantQuality(
  a: { height?: number | undefined; bitrateBps?: number | undefined },
  b: { height?: number | undefined; bitrateBps?: number | undefined },
): number {
  const heightDelta = (b.height ?? 0) - (a.height ?? 0);
  if (heightDelta !== 0) return heightDelta;
  return (b.bitrateBps ?? 0) - (a.bitrateBps ?? 0);
}

const SUBTITLE_FORMATS: ReadonlyArray<readonly [RegExp, "vtt" | "srt" | "ttml"]> = [
  [/(^|\W)(web)?vtt(\W|$)/i, "vtt"],
  [/(^|\W)srt(\W|$)|subrip/i, "srt"],
  [/ttml|dfxp|stpp|tt$/i, "ttml"],
];

/** Classifies a subtitle by mime type, codec or file extension. */
export function subtitleFormat(hint: string | undefined): "vtt" | "srt" | "ttml" | "unknown" {
  if (hint === undefined) return "unknown";
  for (const [pattern, format] of SUBTITLE_FORMATS) {
    if (pattern.test(hint)) return format;
  }
  return "unknown";
}
