/**
 * The seam between the manifest parsers (dl-1) and everything that consumes
 * them (the direct resolver, the browser sniffer). Fixed up front so the two
 * can be built in parallel.
 *
 * Parsers are pure: text in, description out. No fetching, no I/O, no clock.
 * Anything that needs the network belongs in the resolver that calls them.
 */

import type { DrmInfo, MediaVariant, SubtitleTrack } from "@downloader/contract";

export interface ParsedManifest {
  /** Ordered best-first. Empty when the manifest describes no playable rendition. */
  variants: MediaVariant[];
  subtitles: SubtitleTrack[];
  /** Never a guess — `protected` is true only on positive evidence of EME DRM. */
  drm: DrmInfo;
  /** HLS: no `EXT-X-ENDLIST`. DASH: `type="dynamic"`. */
  isLive: boolean;
  durationSec?: number;
}

/**
 * Parses either an HLS master playlist or a single media playlist — callers
 * rarely know which they fetched, and the distinction is one tag away.
 *
 * @param text     raw playlist body
 * @param baseUrl  absolute URL the playlist was fetched from; relative URIs resolve against it
 */
export type HlsParser = (text: string, baseUrl: string) => ParsedManifest;

/**
 * Parses a DASH MPD.
 *
 * @param xml      raw MPD body
 * @param baseUrl  absolute URL the MPD was fetched from; `BaseURL` resolves against it
 */
export type DashParser = (xml: string, baseUrl: string) => ParsedManifest;
