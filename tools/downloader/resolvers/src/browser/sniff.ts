/**
 * Recognising a manifest by what it says rather than what it is called (dl-79).
 *
 * `classifyMedia` knows a manifest by its type or its path. A player that pulls
 * its playlist from `/api/playlist?id=1` and gets `text/plain` back offers
 * neither, and its `.ts` segments are then recorded with nothing to say what
 * they belong to. The only evidence left is the body, which costs a read, so
 * this decides — from the headers alone — whether a response is worth reading
 * at all, and then what the first bytes say.
 */

import { isDeniedUrl } from "./media-match.ts";

/**
 * The largest response body read to look for a manifest.
 *
 * 1 MiB because that is where a real playlist stops and a data endpoint starts:
 * a three-hour VOD at six-second segments is ~1,800 entries, and with a signed
 * ~300-character URL on each that is ~590 KB. A smaller cap would refuse the
 * long, signed playlists this exists for. A bigger one buys nothing and makes
 * every untyped `fetch()` the page issues a megabyte-class read.
 */
export const MAX_SNIFF_BODY_BYTES = 1024 * 1024;

/**
 * The same limit for a compressed response, where the declared length is only
 * what crossed the wire. It is a filter and **not a bound**: Chromium inflates
 * the body before Playwright hands it over, so a few kilobytes can declare
 * gigabytes (1 GiB fits in ~1.8 KB of `br`). The only ceiling on what one read
 * moves into Node is Chromium's inspector cache, which evicts bodies above
 * roughly 12-20 MiB. What this module controls is how many such reads happen:
 * `MAX_ENCODED_SNIFFS_PER_PROBE`.
 */
export const MAX_SNIFF_ENCODED_BYTES = 32 * 1024;

/**
 * Compressed reads per probe, on a budget of their own and also counted against
 * `MAX_SNIFFS_PER_PROBE`. 2 because a gzip- or br-served untyped playlist is
 * what CDNs commonly send, so it is worth reading, and one probe needs one
 * manifest; and because each read can move up to the inspector cache's ceiling
 * into Node, so two bound that at roughly 30 MiB where 32 reads measured 384 MiB
 * moved and 598 MB peak RSS (dl-79 gate 1). The decode itself happens in
 * Chromium and is not bounded here at all.
 */
export const MAX_ENCODED_SNIFFS_PER_PROBE = 2;

/**
 * Reads per probe. Each is bounded by the cap above, but a page that polls an
 * untyped JSON endpoint hundreds of times would otherwise pay for every one.
 */
export const MAX_SNIFFS_PER_PROBE = 32;

/** The marker is at the very start; a prolog and a comment or two precede `<MPD`. */
export const SNIFF_HEAD_BYTES = 2048;

/** Only these say nothing about what the body is. `application/json` says it is not a manifest. */
const UNINFORMATIVE_TYPES: ReadonlySet<string> = new Set([
  "text/plain",
  "application/octet-stream",
]);

const SNIFFED_RESOURCE_TYPES: ReadonlySet<string> = new Set(["fetch", "xhr"]);

export interface SniffCandidate {
  url: string;
  status: number;
  /** Playwright's `request.resourceType()`: `fetch`, `xhr`, `media`, `script`... */
  resourceType: string;
  contentType?: string | undefined;
  contentLength?: number | undefined;
  contentEncoding?: string | undefined;
}

/**
 * Whether to read this response's body. Deliberately narrow: every `false`
 * here is a body that is never fetched from the browser.
 *
 * **No declared length means no read.** Playwright cannot stop a body part way
 * through, so a chunked response is unbounded and there is nothing to compare
 * to the cap.
 */
export function isSniffable(candidate: SniffCandidate): boolean {
  if (!SNIFFED_RESOURCE_TYPES.has(candidate.resourceType)) return false;
  if (candidate.status !== 200) return false;
  if (isDeniedUrl(candidate.url)) return false;

  const mediaType = candidate.contentType?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== undefined && mediaType !== "" && !UNINFORMATIVE_TYPES.has(mediaType)) {
    return false;
  }

  const length = candidate.contentLength;
  if (length === undefined || length <= 0) return false;
  return (
    length <=
    (isContentEncoded(candidate.contentEncoding) ? MAX_SNIFF_ENCODED_BYTES : MAX_SNIFF_BODY_BYTES)
  );
}

/** Whether the declared `Content-Encoding` means the body is inflated on its way in. */
export function isContentEncoded(contentEncoding: string | undefined): boolean {
  const encoding = contentEncoding?.trim().toLowerCase();
  return encoding !== undefined && encoding !== "" && encoding !== "identity";
}

const MPD_ELEMENT = /^<(?:[\w.-]+:)?MPD[\s>]/;

/**
 * Steps over an optional XML prolog and any comments with `indexOf`, never a
 * regex: `(?:<!--[\s\S]*?-->\s*)*` split each `--><!--` boundary two ways and
 * backtracked exponentially, so 211 bytes of the page's choosing froze the
 * event loop for a minute (dl-79 gate 1). This is linear in the head it is given.
 */
function skipPrologAndComments(head: string): string | undefined {
  let text = head;
  if (text.startsWith("<?xml")) {
    const end = text.indexOf("?>");
    if (end === -1) return undefined;
    text = text.slice(end + 2).trimStart();
  }
  while (text.startsWith("<!--")) {
    const end = text.indexOf("-->", 4);
    if (end === -1) return undefined;
    text = text.slice(end + 3).trimStart();
  }
  return text;
}

/** `undefined` means the start of the body is not a manifest. */
export function sniffManifestKind(head: string): "hls" | "dash" | undefined {
  const text = head.replace(/^\uFEFF/, "").trimStart();
  if (text.startsWith("#EXTM3U")) return "hls";
  const root = skipPrologAndComments(text);
  if (root !== undefined && MPD_ELEMENT.test(root)) return "dash";
  return undefined;
}
