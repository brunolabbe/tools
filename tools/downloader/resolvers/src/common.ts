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

/** A hint token that is an absolute URL — a scheme, then `://`. */
const URL_SHAPED = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Reduces every URL inside a hint to the part of it that can honestly claim a
 * format — its path extension and its query string — and leaves every other
 * whitespace-separated token (mime types, codecs, bare extensions) alone.
 *
 * This is dl-28, and it exists because a host and a path are not claims. Two
 * of the three callers concatenate a whole URL into the hint
 * (`dash.ts` builds `mimeType codecs fileUrl`, `ytdlp.ts` falls back to the
 * URL when yt-dlp omits `ext`), so `https://stpp.cdn.net/sub.mp4` and
 * `https://cdn.net/ttml/sub.mp4` used to answer `ttml` on the strength of a
 * CDN name. A tighter regex cannot settle that one: `stpp.ttml.im1t` is a real
 * DASH `codecs=` string whose dots separate a claim and `stpp.cdn.net` is a
 * hostname whose dots do not, so dl-25's `(?![\w./-])` rejects both together —
 * measured, it turns the `stpp.ttml.im1t` row of the table red. Cutting the
 * host and the path out before matching is what tells them apart.
 *
 * **The query string survives on purpose, and that is the side of the trade
 * that is paid.** yt-dlp subtitle URLs carry the format there routinely — a
 * YouTube timedtext URL ends `…&fmt=vtt` — so dropping it would answer
 * `unknown` where the format is stated plainly. The cost is that a signed URL
 * whose *query* happens to contain `vtt`, `srt` or `ttml` is still read as a
 * claim; that is pinned in the table so widening or narrowing it is a decision
 * rather than an accident.
 *
 * The fragment does not survive, and that is not the same trade: a `#` never
 * reaches the server, so nothing can have used it to state a format.
 *
 * **The invariant a fourth caller has to keep, found by gate 1 on dl-28.**
 * `URL_SHAPED` recognises an absolute URL and nothing else: of 43 URL shapes
 * probed at that gate it admits 17 and passes 26 through untouched —
 * protocol-relative `//host/…`, scheme-less, quoted, parenthesised, `blob:`,
 * `data:`, comma-joined and percent-encoded forms. That is safe today only
 * because **every caller normalises its URL before building the hint**:
 * `tools/downloader/resolvers/src/manifest/dash.ts` resolves every `BaseURL`
 * through `resolveUrl` (protocol-relative and root-relative values were driven
 * through `parseDash` at the gate and both came back `unknown`), and
 * `tools/downloader/resolvers/src/manifest/hls.ts` passes a bare extension.
 * Only `tools/downloader/resolvers/src/resolvers/ytdlp.ts` hands over a URL it
 * did not resolve. Build a hint from a raw, unresolved URL and none of this
 * holds.
 */
function claimsOnly(hint: string): string {
  if (!hint.includes("://")) return hint;
  return hint.replace(/\S+/g, (token) => {
    if (!URL_SHAPED.test(token)) return token;
    const hash = token.indexOf("#");
    const addressed = hash === -1 ? token : token.slice(0, hash);
    const query = addressed.indexOf("?");
    return `${urlExtension(addressed) ?? ""}${query === -1 ? "" : addressed.slice(query)}`;
  });
}

/**
 * Scanned in order, against `claimsOnly(hint)` rather than the raw hint. Under
 * these boundaries no token any row names is a substring of another, so `tt$`
 * no longer decides `text/vtt` the way it did before dl-24. Dropping a
 * `(^|\W)` is the change that is never safe, and that is what dl-24 was.
 *
 * Rows 1 and 2 also carry `(?![\w./-])` — dl-25, and the boundary to copy if
 * you need another. It says the token has to _end_ a claim rather than run on
 * into a further path segment or a suffix, so `sub.srt`, `sub.srt?token=…`,
 * `text/srt`, `text/vtt; charset=utf-8`, `codecs="wvtt"` and a bare `srt`
 * match while `srt-edge` and `srt.cdn` do not. Since dl-28 the host of a
 * *scheme-bearing* URL never reaches these patterns at all, so `claimsOnly`
 * rather than the boundary is what stops `https://srt.cdn.net/sub.mp4`. The
 * boundary is kept because it is the one that still works on a hint that
 * carries a bare host with no scheme: `srt.cdn.net/sub.mp4` is not URL-shaped,
 * so `claimsOnly` passes it straight through and the lookahead is all there is.
 *
 * **dl-25's boundary is a trade, and here is the side that was paid.** The
 * lookahead admits every character except `[A-Za-z0-9_]`, `.`, `/` and `-`, so
 * a real track whose extension runs on into one of those is `unknown` —
 * `sub.srt-v2` is the case that still reaches it, since `urlExtension` reads
 * that whole tail as the extension. (`.../sub.srt/download` and `sub.srt.gz`
 * are `unknown` before the boundary is consulted at all: their extensions are
 * nothing and `gz`.) All three are only reachable from a hint carrying no mime
 * type and no codec — they answer `srt` again the moment anything precedes the
 * URL — so `dash.ts` (always prefixes mime and codecs) and `hls.ts` (bare
 * extension) cannot hit them, and only `ytdlp.ts` can, and only when yt-dlp
 * omits `ext`. Pinned in the table so re-widening the boundary is a decision
 * rather than an accident.
 *
 * **The order is still load-bearing**, and what it now decides is a hint
 * carrying two genuine competing claims rather than a hostname: an earlier row
 * wins. `application/x-subrip https://cdn.net/s/sub.ttml` is a `subrip` mime
 * type against a `.ttml` extension and answers `srt` only because row 2
 * precedes row 3 — swap them and a real SubRip track classifies `ttml`, falls
 * outside the engine's `SUBTITLE_FORMATS_FFMPEG_READS` and is silently
 * dropped. That one is pinned by a test as of dl-28; the same shape across
 * rows 1 and 2 (`text/vtt` against a `.srt` extension) is not.
 *
 * Row 3 is unanchored on purpose and stays that way: `stpp.ttml.im1t` needs
 * the dots a boundary would reject. **It is the row with no defence of its
 * own**, so it over-matches wherever `claimsOnly` does not reach — the query
 * string the trade above accounts for, and a host in a token with no scheme,
 * where `stpp.cdn.net/sub.mp4` still answers `ttml`. Rows 1 and 2 survive that
 * second case on dl-25's lookahead alone, which is why the two scheme-less
 * rows in the table exist and why deleting that lookahead has to stay red.
 * Row 3 has nothing equivalent; it is unfixed, and no caller can reach it
 * while the invariant above holds.
 *
 * `wvtt` and `stpp` are the ISO-BMFF sample-entry codes for WebVTT and TTML in
 * fragmented mp4 — what a DASH `codecs=` carries when the mime type is only
 * `application/mp4`. The trailing `tt` gets a row of its own rather than an
 * alternative inside the ttml row, because a bare `tt$` there both read as an
 * anchor over the whole alternation and matched the last two letters of
 * `wvtt`.
 */
const SUBTITLE_FORMATS: ReadonlyArray<readonly [RegExp, "vtt" | "srt" | "ttml"]> = [
  [/(^|\W)(web|w)?vtt(?![\w./-])/i, "vtt"],
  [/(^|\W)srt(?![\w./-])|subrip/i, "srt"],
  [/ttml|dfxp|stpp/i, "ttml"],
  [/(^|\W)tt$/i, "ttml"],
];

/**
 * Classifies a subtitle by mime type, codec or file extension. A hint may
 * contain whole URLs; only their extension and query string are consulted —
 * see `claimsOnly`.
 */
export function subtitleFormat(hint: string | undefined): "vtt" | "srt" | "ttml" | "unknown" {
  if (hint === undefined) return "unknown";
  const claims = claimsOnly(hint);
  for (const [pattern, format] of SUBTITLE_FORMATS) {
    if (pattern.test(claims)) return format;
  }
  return "unknown";
}
