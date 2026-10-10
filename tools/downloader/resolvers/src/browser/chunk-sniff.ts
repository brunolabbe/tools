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
 * **Only positive evidence drops a file you read.** A file is dropped when its
 * own head shows
 *
 * - a `moof` with no `moov` before it: a media segment; or
 * - a `moov` holding an `mvex` and then no `moof`, the head ending on a box
 *   boundary: an init segment. The movie declares that its samples live in
 *   fragments and carries none.
 *
 * A head that shows anything else is offered, and so is a file that could not be
 * read: not an MP4, all zeros, a `moov` after `mdat` (a whole file written
 * without faststart has it past any head), or a head that ends before either
 * box. A `moov` holding an `mvex` **followed by a `moof`** is a whole movie
 * written as fragmented MP4 (`ffmpeg -movflags frag_keyframe+empty_moov`) and is
 * offered too (owner, 2026-10-10; the Decision section of the ticket). The cost
 * the owner accepted: a single-file DASH rendition has the same head.
 *
 * **Why `mvex` and not "no `moof`".** An init segment has a `moov` and no `moof`,
 * so a rule that looked only for `moof` would leave `00000.mp4` offered. `mvex`
 * is the box a muxer writes to say the movie is fragmented, so it is evidence of
 * the same thing a `moof` is, not an inference from an absence.
 *
 * **Bounded.** A capture can hold hundreds of numbered chunks. One proven
 * fragment makes its directory a segmented stream, so the numbered files beside
 * it **that were never read** are dropped without a request. A file that was
 * read and found whole is kept whatever its neighbours turned out to be, so what
 * survives depends on the order the reads happened in: the cost of bounding them.
 * Reads are capped in count, in time and in bytes whatever the capture holds, and
 * stop when the probe is cancelled.
 *
 * A directory is a host **and** a path: a fragment on one host proves nothing
 * about numbered files under the same path on another.
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
  const boxes = childrenOf(head, 0, head.length);
  for (const [index, box] of boxes.entries()) {
    // Past the first non-box, nothing here is a layout we know how to read.
    if (!isPrintable(box.type)) return "unknown";
    if (box.type === "moof") return "fragment";
    if (box.type === "mdat") return "unknown";
    if (box.type === "moov") {
      const inside = childrenOf(head, box.body, box.end);
      if (!inside.some((child) => child.type === "mvex")) return "unknown";
      // A movie that goes on to carry fragments is a whole file.
      if (boxes.slice(index + 1).some((later) => later.type === "moof")) return "unknown";
      // An init segment holds no `moof`, and every byte of it is a box. Bytes the
      // walk could not read as one after the `moov` may be a fragment too big for
      // the head: not proof.
      const lastEnd = boxes.at(-1)?.end ?? 0;
      return lastEnd === head.length ? "fragment" : "unknown";
    }
  }
  return "unknown";
}

/** `origin + directory`: the same path on another host is another directory. */
function directoryOf(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)}`;
  } catch {
    return raw.slice(0, raw.lastIndexOf("/") + 1);
  }
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
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

/** Settles with `work`, or with `undefined` the moment `signal` aborts; the read is abandoned. */
async function unlessAborted<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | undefined> {
  if (signal === undefined) return await work;
  if (signal.aborted) return undefined;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * `files` without the numbered ones proven to be fragments, and without the
 * numbered ones beside a proven fragment that were never read, in their order.
 * `deadline` is the probe's; the sniff spends at most `SNIFF_TOTAL_BUDGET_MS` of
 * it and never reads past it. Once `signal` aborts no further read is started
 * and the one in flight is abandoned; the caller then throws the abort, so what
 * this returns after one does not matter.
 */
export async function withoutFragments(
  files: readonly NetworkHit[],
  readHead: HeadReader,
  deadline: number,
  signal?: AbortSignal,
): Promise<NetworkHit[]> {
  const sniffEnd = Math.min(deadline, Date.now() + SNIFF_TOTAL_BUDGET_MS);
  const segmented = new Set<string>();
  const read = new Set<NetworkHit>();
  const fragments = new Set<NetworkHit>();
  let reads = 0;

  for (const hit of files) {
    if (signal?.aborted === true) break;
    if (!isSniffCandidate(hit) || segmented.has(directoryOf(hit.url))) continue;
    const left = sniffEnd - Date.now();
    if (reads >= MAX_SNIFF_READS || left <= MIN_USEFUL_BUDGET_MS) break;
    reads += 1;
    read.add(hit);
    try {
      // Sequential on purpose: each read can settle the directory, and the rest of
      // its candidates are then not requested at all.
      // oxlint-disable-next-line no-await-in-loop
      const head = await unlessAborted(readHead(hit, Math.min(SNIFF_READ_BUDGET_MS, left)), signal);
      if (head !== undefined && sniffHead(head) === "fragment") {
        fragments.add(hit);
        segmented.add(directoryOf(hit.url));
      }
    } catch {
      // Unreadable: offered, as it was before the sniff.
    }
  }

  return files.filter((hit) => {
    if (fragments.has(hit)) return false;
    // A candidate that was read and found whole stays; one never read, beside a
    // proven fragment, is taken to be one of its chunks.
    return !(isSniffCandidate(hit) && !read.has(hit) && segmented.has(directoryOf(hit.url)));
  });
}
