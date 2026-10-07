/**
 * Turning a pile of observed requests into "this is the one".
 *
 * The ordering rules, in the order they matter:
 *   1. adaptive manifests beat a progressive file — they carry every rendition;
 *   2. among manifests, the first one requested wins — a player fetches the
 *      master before the variants it names; the name only breaks a tie (dl-92);
 *   3. among progressive files, bigger is the real content and smaller is the
 *      trailer, the bumper or an ad slate.
 */

import { isChunkName, isNumberedName } from "./media-match.ts";
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
    // Arrival order is not scored: `rankHits` puts it ahead of every term here.
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

function directoryOf(raw: string): string {
  const path = pathOf(raw);
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/**
 * A numbered `.mp4` (`00003.mp4`) is a chunk only next to proof that playback is
 * segmented: a manifest anywhere in the capture, or a chunk-named neighbour in
 * its own directory (`init.mp4`, `seg-1.m4s`). Alone it is a numeric id or a
 * resolution suffix — `839201.mp4`, `clip-720.mp4` — and a whole file (dl-78).
 *
 * Two numbered names side by side are deliberately not evidence: `clip-720.mp4`
 * and `clip-1080.mp4` are two whole files, and calling both chunks would offer
 * neither.
 */
function isChunkOfSegmentedPlayback(hit: NetworkHit, hits: readonly NetworkHit[]): boolean {
  if (hit.kind !== "progressive" || !isNumberedName(hit.url)) return false;
  if (hits.some((other) => other.kind === "hls" || other.kind === "dash")) return true;
  const directory = directoryOf(hit.url);
  return hits.some(
    (other) => other !== hit && isChunkName(other.url) && directoryOf(other.url) === directory,
  );
}

/** An adaptive manifest that did not come back as an error: the candidates that order by arrival. */
function isAnsweredManifest(hit: NetworkHit): boolean {
  return (
    (hit.kind === "hls" || hit.kind === "dash") && !(hit.status !== undefined && hit.status >= 400)
  );
}

/**
 * Playable candidates, best first. Segments are dropped, never offered.
 *
 * Among manifests that were not refused, **arrival order decides and the name
 * only breaks a tie** (dl-92). The first manifest a page requests is the root of
 * the tree it plays, whatever it is called: `/hls?token=…` and `/abc.m3u8` are
 * masters no name rule can tell from a variant. The cost is a page that requests
 * an ad or a preview manifest before the real `master.m3u8`: the ad is offered,
 * and the real one is the next candidate if the ad fails to parse. A name that
 * outweighed arrival order cannot be right for both pages, and the owner chose
 * this one on 2026-10-07. An answered response outranks an unanswered request
 * (the player abandoned it) before order is looked at.
 */
export function rankHits(hits: readonly NetworkHit[], pageUrl: string): NetworkHit[] {
  return hits
    .filter((hit) => hit.kind !== "segment" && !isChunkOfSegmentedPlayback(hit, hits))
    .map((hit, index) => ({ hit, index, score: scoreHit(hit, pageUrl) }))
    .filter((entry) => Number.isFinite(entry.score))
    .toSorted((a, b) => {
      const aManifest = isAnsweredManifest(a.hit);
      const bManifest = isAnsweredManifest(b.hit);
      // One sort key, compared lexicographically, so the order stays transitive:
      // answered manifests above everything else, then by answered, arrival, score.
      if (aManifest !== bManifest) return aManifest ? -1 : 1;
      if (aManifest) {
        return (
          Number(b.hit.confirmed) - Number(a.hit.confirmed) ||
          a.hit.seq - b.hit.seq ||
          b.score - a.score ||
          a.index - b.index
        );
      }
      return b.score - a.score || a.index - b.index;
    })
    .map((entry) => entry.hit);
}
