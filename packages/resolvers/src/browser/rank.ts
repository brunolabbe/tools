/**
 * Turning a pile of observed requests into "this is the one".
 *
 * The ordering rules, in the order they matter:
 *   1. adaptive manifests beat a progressive file — they carry every rendition;
 *   2. a master playlist beats a variant playlist — a player fetches the master
 *      first and its name usually says so;
 *   3. among progressive files, bigger is the real content and smaller is the
 *      trailer, the bumper or an ad slate.
 */

import type { NetworkHit } from "./types.ts";

const MASTER_NAME = /(?:master|main|index|manifest|playlist|stream|video)[^/]*\.(?:m3u8?|mpd)$/i;
const VARIANT_NAME = /(?:chunklist|media[-_]?\d|\b\d{3,4}p\b|[-_]\d{3,5}k)[^/]*\.m3u8?$/i;

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}

function originOf(raw: string): string | undefined {
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

export function scoreHit(hit: NetworkHit, pageUrl: string): number {
  let score = 0;
  const path = pathOf(hit.url);

  switch (hit.kind) {
    case "hls":
    case "dash":
      score += 1000;
      break;
    case "progressive":
      score += 500;
      break;
    case "segment":
      return Number.NEGATIVE_INFINITY;
  }

  if (hit.kind === "hls" || hit.kind === "dash") {
    if (MASTER_NAME.test(path)) score += 120;
    if (VARIANT_NAME.test(path)) score -= 80;
    // The master is requested before the variants it names, so earlier wins.
    score += Math.max(0, 100 - hit.seq * 10);
  }

  if (hit.kind === "progressive" && hit.contentLength !== undefined && hit.contentLength > 0) {
    // Log scale: 10 MB should beat 1 MB, but not by 10× the whole ranking.
    score += Math.min(200, Math.log10(hit.contentLength) * 25);
  }

  // A response actually arrived, so this is not a request the player abandoned.
  if (hit.confirmed) score += 30;
  if (hit.status !== undefined && hit.status >= 400) score -= 400;

  const pageOrigin = originOf(pageUrl);
  if (pageOrigin !== undefined && originOf(hit.url) === pageOrigin) score += 20;

  return score;
}

/** Playable candidates, best first. Segments are dropped, never offered. */
export function rankHits(hits: readonly NetworkHit[], pageUrl: string): NetworkHit[] {
  return hits
    .filter((hit) => hit.kind !== "segment")
    .map((hit, index) => ({ hit, index, score: scoreHit(hit, pageUrl) }))
    .filter((entry) => Number.isFinite(entry.score))
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.hit);
}
