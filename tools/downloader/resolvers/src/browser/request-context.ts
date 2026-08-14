/**
 * Turning captured browser headers into something the engine can replay.
 *
 * More capture attempts fail here than anywhere else in the pipeline: a URL
 * that worked in the browser and 403s from the downloader is almost always
 * missing `Referer` (analysis §5). So the headers the player actually sent are
 * preserved verbatim, minus the ones that describe *that* connection.
 */

import type { RequestContext } from "@downloader/contract";
import { expiresAtFromUrl } from "./media-match.ts";
import type { NetworkHit } from "./types.ts";

/**
 * Connection-scoped headers. Replaying these would describe the browser's
 * socket, not ours, and `Accept-Encoding` in particular makes ffmpeg receive a
 * body it did not ask to decode.
 */
const CONNECTION_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "content-length",
  "accept-encoding",
  "if-none-match",
  "if-modified-since",
  "range",
]);

function canonicalHeaderName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

export interface RequestContextInput {
  hit: NetworkHit;
  pageUrl: string;
  userAgent: string;
  acceptLanguage: string;
  proxyUrl?: string | undefined;
}

export function buildRequestContext(input: RequestContextInput): RequestContext {
  const headers: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input.hit.headers)) {
    const name = rawName.toLowerCase();
    // HTTP/2 pseudo-headers describe the frame, not the request.
    if (name.startsWith(":")) continue;
    if (CONNECTION_HEADERS.has(name)) continue;
    if (value === "") continue;
    headers[canonicalHeaderName(name)] = value;
  }

  // Fill the three the CDN is most likely to check but the capture may have
  // dropped — a same-origin navigation request carries no Referer of its own.
  headers["User-Agent"] ??= input.userAgent;
  headers["Accept-Language"] ??= input.acceptLanguage;
  headers["Referer"] ??= input.pageUrl;
  const pageOrigin = originOf(input.pageUrl);
  if (pageOrigin !== undefined && originOf(input.hit.url) !== pageOrigin) {
    headers["Origin"] ??= pageOrigin;
  }

  const expiresAt = expiresAtFromUrl(input.hit.url);
  return {
    headers,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(input.proxyUrl === undefined ? {} : { proxyUrl: input.proxyUrl }),
  };
}

function originOf(raw: string): string | undefined {
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}
