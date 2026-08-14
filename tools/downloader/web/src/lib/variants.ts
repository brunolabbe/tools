/** Turns `MediaVariant[]` into rows the picker can render without further logic. */

import type { MediaVariant, StreamProtocol } from "@downloader/contract";
import { UNKNOWN, formatBitrate, formatBytes, formatResolution } from "./format.ts";

export interface VariantRow {
  id: string;
  label: string;
  protocol: StreamProtocol;
  resolution: string;
  fps: string;
  videoCodec: string;
  audioCodec: string;
  bitrate: string;
  size: string;
  /** Derived from bitrate × duration rather than measured — must be marked as such. */
  sizeIsEstimate: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Audio lives at a separate URL and will be muxed in. */
  needsMux: boolean;
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

export function toVariantRow(variant: MediaVariant): VariantRow {
  const hasSeparateAudio = typeof variant.audioUrl === "string" && variant.audioUrl.length > 0;
  return {
    id: variant.id,
    label: variant.label,
    protocol: variant.protocol,
    resolution: variant.hasVideo ? formatResolution(variant.width, variant.height) : "audio only",
    fps: variant.fps ? `${Math.round(variant.fps)} fps` : UNKNOWN,
    videoCodec: variant.hasVideo ? shortCodec(variant.videoCodec) : UNKNOWN,
    audioCodec: variant.hasAudio || hasSeparateAudio ? shortCodec(variant.audioCodec) : UNKNOWN,
    bitrate: formatBitrate(variant.bitrateBps),
    size: formatBytes(variant.filesizeBytes),
    sizeIsEstimate: variant.filesizeIsEstimate === true,
    hasVideo: variant.hasVideo,
    hasAudio: variant.hasAudio || hasSeparateAudio,
    needsMux: hasSeparateAudio,
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
 * Default selection: the highest-quality variant that already carries audio,
 * falling back to the highest-quality one overall.
 */
export function pickDefaultVariantId(variants: readonly MediaVariant[]): string | null {
  const rows = sortVariantRows(toVariantRows(variants));
  const withAudio = rows.find((row) => row.hasVideo && row.hasAudio && !row.needsMux);
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
