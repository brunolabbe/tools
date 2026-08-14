/**
 * Turning a captured `RequestContext` into something safe to replay.
 *
 * The headers in a `RequestContext` came out of a browser or a resolver, which
 * makes them attacker-influenced input. Two problems follow:
 *
 *  1. ffmpeg's `-headers` option takes one CRLF-joined blob, so a value
 *     containing a CR or LF injects arbitrary extra headers into every request.
 *  2. A browser capture includes headers that are meaningless or actively
 *     harmful when replayed by a different client — HTTP/2 pseudo-headers
 *     (`:authority`), hop-by-hop headers, and above all `Range`, which an MSE
 *     player sets on every segment and which would silently truncate our
 *     download to the player's last chunk.
 *
 * Everything here is pure so it can be asserted on directly in tests.
 */

import type { RequestContext } from "@downloader/contract";
import { stripControlChars } from "../text.ts";

/** RFC 7230 token characters. Anything else is not a legal header name. */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Dropped before replay. Hop-by-hop headers belong to a connection we are not
 * reusing; conditional and range headers change what bytes we get back; HTTP/2
 * pseudo-headers are not headers at all.
 */
const DROPPED_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "content-length",
  "host",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "keep-alive",
  "proxy-connection",
  "range",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface NormalizedHeaders {
  /** Header name (lower-cased) to value, safe to serialise. */
  headers: Record<string, string>;
  /** Extracted separately because ffmpeg has a dedicated `-user_agent` option. */
  userAgent: string | undefined;
}

/** Strips control characters (CR and LF above all), then trims. */
export function sanitizeHeaderValue(value: string): string | null {
  const cleaned = stripControlChars(value).trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): NormalizedHeaders {
  const out: Record<string, string> = {};
  let userAgent: string | undefined;

  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = rawName.trim().toLowerCase();
    // Pseudo-headers start with ":" and fail the token test, so this is covered.
    if (!HEADER_NAME_RE.test(name)) continue;
    if (DROPPED_HEADERS.has(name)) continue;

    const value = sanitizeHeaderValue(rawValue);
    if (value === null) continue;

    if (name === "user-agent") {
      userAgent = value;
      continue;
    }
    out[name] = value;
  }

  return { headers: out, userAgent };
}

/**
 * ffmpeg wants one blob, `Name: value` per line, CRLF-terminated including the
 * last line. Omitting the trailing CRLF makes some builds fold the next
 * internally-generated header onto ours.
 */
export function joinHeaderBlob(headers: Readonly<Record<string, string>>): string {
  const entries = Object.entries(headers);
  if (entries.length === 0) return "";
  return entries.map(([name, value]) => `${name}: ${value}`).join("\r\n") + "\r\n";
}

/**
 * Per-input ffmpeg options carrying the replayed context. These are input
 * options: they must appear *before* the `-i` they apply to, and must be
 * repeated for a second input (segments are gated too, and so is the separate
 * audio rendition).
 */
export function buildRequestContextArgs(context: RequestContext | undefined): string[] {
  const { headers, userAgent } = normalizeHeaders(context?.headers);
  const args: string[] = [];

  const blob = joinHeaderBlob(headers);
  if (blob.length > 0) args.push("-headers", blob);
  if (userAgent !== undefined) args.push("-user_agent", userAgent);

  return args;
}

/** Header map for `fetch`, with the same normalisation applied. */
export function buildFetchHeaders(context: RequestContext | undefined): Record<string, string> {
  const { headers, userAgent } = normalizeHeaders(context?.headers);
  return userAgent === undefined ? headers : { ...headers, "user-agent": userAgent };
}
