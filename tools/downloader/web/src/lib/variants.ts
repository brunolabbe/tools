/** Turns `MediaVariant[]` into rows the picker can render without further logic. */

import type { MediaVariant, StreamProtocol } from "@downloader/contract";
import { UNKNOWN, formatBitrate, formatBytes, formatResolution } from "./format.ts";

/**
 * What the picker knows about a rendition's sound. `"unverified"` is the tier
 * that never looked (dl-42) and must not be collapsed into `"absent"`, which is
 * the tier that looked and found nothing.
 */
export type RowAudio = "present" | "absent" | "unverified";

export interface VariantRow {
  id: string;
  label: string;
  protocol: StreamProtocol;
  resolution: string;
  /**
   * What the Quality column shows: the resolution when there is one, and the
   * variant's own label when there is not — a direct file has no dimensions but
   * does have `Direct MP4 · 2.0 MB`, and a radio with no visible name is not a
   * choice anyone can make (dl-42).
   */
  quality: string;
  fps: string;
  videoCodec: string;
  audioCodec: string;
  bitrate: string;
  size: string;
  /** Derived from bitrate × duration rather than measured — must be marked as such. */
  sizeIsEstimate: boolean;
  hasVideo: boolean;
  audio: RowAudio;
  /** Audio lives at a separate URL and will be muxed in. */
  needsMux: boolean;
  /**
   * BCP-47 tag of the audio this rendition carries, `""` when the manifest named
   * none. Rendered as a column only when two variants disagree on it — see
   * `toDisplayRows` (dl-40).
   */
  language: string;
  /**
   * The video codec exactly as the manifest declared it, e.g. `avc1.64001f`.
   * Not rendered: `videoCodec` above is the short family name a person reads.
   * It is carried so `toDisplayRows` can tell two rows apart that `shortCodec`
   * has flattened onto the same word (dl-40).
   */
  videoCodecFull: string;
  /**
   * How many hosts serve this rendition: `1` plus its `alternateUrls` (dl-45).
   *
   * **Availability, not quality**, and the table has to say so where it renders
   * this — see `VariantTable`. dl-40 removed rows that implied a difference
   * between renditions identical on every attribute but the hostname, and a
   * count that read as "better" would put that implication straight back. It is
   * a fact about *delivery* of one row, not a reason to prefer that row, and
   * nothing here or in `sortVariantRows` or `pickDefaultVariantId` may order by
   * it.
   *
   * It comes from the contract field the resolver populated, never from the
   * collapse below: by the time the picker runs, mirrors have already been
   * grouped into one variant, so counting what the picker merged would be
   * counting something else entirely (and would be zero on a mirrored manifest).
   */
  mirrors: number;
  height: number;
  bitrateBps: number;
}

function shortCodec(codec: string | undefined): string {
  if (!codec) return UNKNOWN;
  const family = codec.split(".")[0] ?? codec;
  const known: Record<string, string> = {
    avc1: "H.264",
    avc3: "H.264",
    hev1: "HEVC",
    hvc1: "HEVC",
    av01: "AV1",
    vp9: "VP9",
    vp09: "VP9",
    mp4a: "AAC",
    opus: "Opus",
    ec_3: "E-AC-3",
  };
  return known[family] ?? family;
}

function rowAudio(variant: MediaVariant, hasSeparateAudio: boolean): RowAudio {
  // A separate audio rendition is audio we can see, whatever the flag says.
  if (hasSeparateAudio || variant.hasAudio === true) return "present";
  return variant.hasAudio === false ? "absent" : "unverified";
}

export function toVariantRow(variant: MediaVariant): VariantRow {
  const hasSeparateAudio = typeof variant.audioUrl === "string" && variant.audioUrl.length > 0;
  const audio = rowAudio(variant, hasSeparateAudio);
  const resolution = variant.hasVideo
    ? formatResolution(variant.width, variant.height)
    : "audio only";
  return {
    id: variant.id,
    label: variant.label,
    protocol: variant.protocol,
    resolution,
    // The label is the fallback, but an empty one is not an improvement on the
    // marker — a blank cell was the original complaint.
    quality: resolution === UNKNOWN && variant.label !== "" ? variant.label : resolution,
    fps: variant.fps ? `${Math.round(variant.fps)} fps` : UNKNOWN,
    videoCodec: variant.hasVideo ? shortCodec(variant.videoCodec) : UNKNOWN,
    // Only a confirmed-silent variant is forced to `—`; an unverified one falls
    // through to the codec it declared, which is itself usually unknown.
    audioCodec: audio === "absent" ? UNKNOWN : shortCodec(variant.audioCodec),
    bitrate: formatBitrate(variant.bitrateBps),
    size: formatBytes(variant.filesizeBytes),
    sizeIsEstimate: variant.filesizeIsEstimate === true,
    hasVideo: variant.hasVideo,
    audio,
    needsMux: hasSeparateAudio,
    language: variant.language ?? "",
    videoCodecFull: variant.hasVideo ? (variant.videoCodec ?? "") : "",
    mirrors: 1 + (variant.alternateUrls?.length ?? 0),
    height: variant.height ?? 0,
    bitrateBps: variant.bitrateBps ?? 0,
  };
}

export function toVariantRows(variants: readonly MediaVariant[]): VariantRow[] {
  return variants.map(toVariantRow);
}

/**
 * Best-quality-first ordering for the picker. Resolvers already return
 * best-first, but the UI is allowed to re-sort and users expect a stable order.
 */
export function sortVariantRows(rows: readonly VariantRow[]): VariantRow[] {
  return rows.toSorted((a, b) => {
    if (a.hasVideo !== b.hasVideo) return a.hasVideo ? -1 : 1;
    if (b.height !== a.height) return b.height - a.height;
    return b.bitrateBps - a.bitrateBps;
  });
}

/**
 * Everything the table renders, joined into one string. Two rows with the same
 * key are the same row as far as anyone looking at the screen is concerned —
 * which is the dl-40 defect when the variants behind them are not the same
 * rendition.
 *
 * It has to list the rendered columns rather than the underlying fields: the
 * point is what reaches the screen, so `1.3 Mbps` and `1.3 Mbps` are one key
 * even when the two `bitrateBps` differ by 400 bps.
 *
 * **`mirrors` is rendered and is deliberately not here** (dl-45). It is the one
 * exception to the sentence above, and it has to be: keying on it would give a
 * rendition served by three hosts its own row next to an identical rendition
 * served by one, which is the dl-40 defect exactly — two rows a person cannot
 * choose between, separated by something that is not a difference in the media.
 */
function displayKey(row: VariantRow, withLanguage: boolean): string {
  return [
    row.quality,
    row.fps,
    row.videoCodec,
    row.audioCodec,
    row.bitrate,
    row.size,
    String(row.sizeIsEstimate),
    row.protocol,
    row.audio,
    String(row.needsMux),
    withLanguage ? row.language : "",
  ].join("\u0000");
}

function groupByKey(rows: readonly VariantRow[], withLanguage: boolean): Map<string, VariantRow[]> {
  const groups = new Map<string, VariantRow[]>();
  for (const row of rows) {
    const key = displayKey(row, withLanguage);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  return groups;
}

/** What the picker should put on screen, and what it had to do to get there. */
export interface DisplayRows {
  rows: VariantRow[];
  /**
   * Render the Language column? Only true when at least two variants disagree,
   * because a single-language video would otherwise grow a column of identical
   * cells (dl-40).
   */
  showLanguage: boolean;
  /** How many rows were dropped as redundant paths. See `toDisplayRows`. */
  collapsed: number;
}

/**
 * The rows the picker shows, with rows that differ only in something it cannot
 * render either made distinguishable or removed (dl-40).
 *
 * A manifest is free to declare a rung many times over and have this table
 * render every one of them as the same line, and it happens for three unrelated
 * reasons. Which one is in front of the user is read off the variants rather
 * than assumed, because the answers pull in opposite directions:
 *
 *  - **the audio language differs** → surface it, as a column, for this probe
 *    only;
 *  - **the codec profiles differ** → stop shortening `avc1.4d401f` and
 *    `avc1.64001f` onto the same `H.264`, but only for the rows that collide.
 *    `H.264` is the right answer nearly always, which is why `shortCodec`
 *    exists;
 *  - **nothing renderable differs** → collapse, see the note below.
 */
export function toDisplayRows(variants: readonly MediaVariant[]): DisplayRows {
  const rows = sortVariantRows(toVariantRows(variants));
  const showLanguage = new Set(rows.map((row) => row.language)).size > 1;

  for (const group of groupByKey(rows, showLanguage).values()) {
    if (group.length < 2) continue;
    const declared = new Set(group.map((row) => row.videoCodecFull));
    if (declared.size < 2 || declared.has("")) continue;
    for (const row of group) row.videoCodec = row.videoCodecFull;
  }

  // Collapse-and-drop, and what is dropped is a real capability: rows still
  // identical here differ only in their `url`, and in HLS a rendition declared
  // more than once at more than one host is a failover path — the next server a
  // player would try when the first one fails (RFC 8216 §6.2.4). That is what
  // the reported video turned out to be, established by probing it: within a
  // rung the entries agreed on every attribute, on the scheme, on every path
  // segment and on the query, and differed in the hostname alone.
  //
  // They are discarded rather than kept because there is nowhere to keep them:
  // `MediaVariant` carries a single `url` and the engine downloads from exactly
  // that, so an alternate would be a field nothing reads. **dl-45 is the ticket
  // for keeping them** — alternates on the variant and the engine failing over —
  // and dl-40 deliberately did not wait for it. The survivor is the first the
  // manifest declared for that rung, which is its primary rather than a mirror.
  //
  // Nothing here assumes how many. The reported manifest mirrored every rung
  // exactly twice; the fixture varies it from one to three precisely so that
  // number cannot creep into this code.
  //
  // This is the *picker's* half. Exact duplicates — the same URL twice, which is
  // what the reported video's other doubling was — are dropped a layer earlier,
  // in the yt-dlp tier, because those are noise for every consumer and not just
  // for the table.
  const kept = new Map<string, VariantRow>();
  for (const row of rows) {
    const key = displayKey(row, showLanguage);
    if (!kept.has(key)) kept.set(key, row);
  }

  return { rows: [...kept.values()], showLanguage, collapsed: rows.length - kept.size };
}

/**
 * Default selection: the highest-quality variant that already carries audio,
 * falling back to the highest-quality one overall.
 *
 * `"present"` only — a variant nobody inspected is not *preferred* as the
 * default, but it is still reached by the `anyVideo` fallback below, which is
 * what a lone direct file takes (dl-42).
 *
 * Chosen from `toDisplayRows`, not from `variants`, so it can never name a row
 * the picker collapsed away — that would leave the radio group with nothing
 * checked and the download button pointed at an invisible rendition (dl-40).
 */
export function pickDefaultVariantId(variants: readonly MediaVariant[]): string | null {
  const { rows } = toDisplayRows(variants);
  const withAudio = rows.find((row) => row.hasVideo && row.audio === "present" && !row.needsMux);
  const anyVideo = rows.find((row) => row.hasVideo);
  return withAudio?.id ?? anyVideo?.id ?? rows[0]?.id ?? null;
}

export function findVariant(
  variants: readonly MediaVariant[],
  id: string | null,
): MediaVariant | null {
  if (!id) return null;
  return variants.find((variant) => variant.id === id) ?? null;
}
