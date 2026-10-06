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
 * what crossed the wire. Chromium hands back the inflated body, so a hostile
 * page could declare a few kilobytes that inflate a thousandfold; 32 KiB bounds
 * that at ~32 MB while still holding a playlist of several hundred kilobytes
 * (text compresses ~10:1).
 */
export const MAX_SNIFF_ENCODED_BYTES = 32 * 1024;

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
  const encoding = candidate.contentEncoding?.trim().toLowerCase();
  const encoded = encoding !== undefined && encoding !== "" && encoding !== "identity";
  return length <= (encoded ? MAX_SNIFF_ENCODED_BYTES : MAX_SNIFF_BODY_BYTES);
}

/** An optional prolog, then any comments, then the `MPD` element — a DASH root is nothing else. */
const DASH_ROOT = /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?MPD[\s>]/;

/** `undefined` means the start of the body is not a manifest. */
export function sniffManifestKind(head: string): "hls" | "dash" | undefined {
  const text = head.replace(/^\uFEFF/, "").trimStart();
  if (text.startsWith("#EXTM3U")) return "hls";
  if (DASH_ROOT.test(text)) return "dash";
  return undefined;
}
