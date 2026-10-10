/**
 * Telling a numbered chunk of a segmented stream from a numbered whole file by
 * what its own first bytes say (dl-90).
 *
 * `rankHits` drops a numbered `.mp4` (`00003.mp4`) when the capture holds a
 * manifest or a chunk-named neighbour. A stream whose playlist was never
 * captured as a manifest has neither, and its chunks would be offered as
 * downloads: one fMP4 fragment with no `moov`, labelled as a whole video. The
 * evidence the capture cannot give is in the file, so this reads it.
 *
 * **Only positive evidence drops a file.** A candidate is dropped when its head
 * shows a `moof` (a media segment) or a `moov` holding an `mvex` (an init
 * segment: the movie declares that its samples live in fragments). A head that
 * shows anything else, cannot be read, is not an MP4, or ends before either box
 * appears is **offered**, so a failed or inconclusive sniff never costs the user
 * a file. In particular a whole file written without faststart has its `moov`
 * after `mdat`, past any head, and is read as "unknown", never as "chunk".
 *
 * **Why `mvex` and not "no `moof`".** An init segment has a `moov` and no `moof`,
 * so a rule that looked only for `moof` would leave `00000.mp4` offered. `mvex`
 * is the box a muxer writes to say the movie is fragmented, so it is evidence of
 * the same thing a `moof` is, not an inference from an absence.
 *
 * **Bounded.** A capture can hold hundreds of numbered chunks. One proven
 * fragment makes its directory a segmented stream, so every other numbered
 * candidate beside it is dropped unread; and reads are capped in count, in time
 * and in bytes whatever the capture holds.
 */

import { childrenOf, HEAD_WINDOW_BYTES, isPrintable } from "../mp4-header.ts";
import type { NetworkHit } from "./types.ts";
import { isNumberedName } from "./media-match.ts";

/** Bytes asked for per candidate. Holds `styp`, `sidx` and `moof`, or `ftyp` and a whole init `moov`. */
export const SNIFF_HEAD_BYTES = HEAD_WINDOW_BYTES;
/** Candidates read per probe. Past it, an unproven candidate is offered, as it was before the sniff. */
export const MAX_SNIFF_READS = 8;
/** Longest the sniff may spend in all, so it cannot eat the probe's reserve for the engine. */
export const SNIFF_TOTAL_BUDGET_MS = 6000;
/** Longest one read may take. */
export const SNIFF_READ_BUDGET_MS = 3000;
/** Below this there is not enough of the budget left to be worth a request. */
const MIN_USEFUL_BUDGET_MS = 500;

const MP4_FAMILY = /\.(?:mp4|m4v|m4a)$/i;

export type HeadVerdict = "fragment" | "unknown";

/** What the first bytes of a file say, and nothing the file does not say. */
export function sniffHead(head: Uint8Array): HeadVerdict {
  for (const box of childrenOf(head, 0, head.length)) {
    // Past the first non-box, nothing here is a layout we know how to read.
    if (!isPrintable(box.type)) return "unknown";
    if (box.type === "moof") return "fragment";
    if (box.type === "mdat") return "unknown";
    if (box.type === "moov") {
      const inside = childrenOf(head, box.body, box.end);
      return inside.some((child) => child.type === "mvex") ? "fragment" : "unknown";
    }
  }
  return "unknown";
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}

function directoryOf(raw: string): string {
  const path = pathOf(raw);
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/** Whether the sniff has anything to say about this hit at all. */
export function isSniffCandidate(hit: NetworkHit): boolean {
  return hit.kind === "progressive" && isNumberedName(hit.url) && MP4_FAMILY.test(pathOf(hit.url));
}

/**
 * The first bytes of one candidate, or `undefined` when they could not be read.
 * `timeoutMs` is the longest this call may take.
 */
export type HeadReader = (hit: NetworkHit, timeoutMs: number) => Promise<Uint8Array | undefined>;

/**
 * `files` without the numbered ones proven to be fragments, in their order.
 * `deadline` is the probe's; the sniff spends at most `SNIFF_TOTAL_BUDGET_MS` of
 * it and never reads past it.
 */
export async function withoutFragments(
  files: readonly NetworkHit[],
  readHead: HeadReader,
  deadline: number,
): Promise<NetworkHit[]> {
  const sniffEnd = Math.min(deadline, Date.now() + SNIFF_TOTAL_BUDGET_MS);
  const segmented = new Set<string>();
  let reads = 0;

  for (const hit of files) {
    if (!isSniffCandidate(hit) || segmented.has(directoryOf(hit.url))) continue;
    const left = sniffEnd - Date.now();
    if (reads >= MAX_SNIFF_READS || left <= MIN_USEFUL_BUDGET_MS) break;
    reads += 1;
    try {
      // Sequential on purpose: each read can settle the directory, and the rest of
      // its candidates are then not requested at all.
      // oxlint-disable-next-line no-await-in-loop
      const head = await readHead(hit, Math.min(SNIFF_READ_BUDGET_MS, left));
      if (head !== undefined && sniffHead(head) === "fragment") segmented.add(directoryOf(hit.url));
    } catch {
      // Unreadable: offered, as it was before the sniff.
    }
  }

  return files.filter((hit) => !(isSniffCandidate(hit) && segmented.has(directoryOf(hit.url))));
}
