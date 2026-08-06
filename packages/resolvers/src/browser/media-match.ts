/**
 * Deciding whether a request is media, and what kind.
 *
 * Content-Type is checked first and the file extension second, because plenty
 * of CDNs serve manifests from extensionless, signed, query-only URLs — an
 * extension-only matcher silently misses them (analysis §4).
 */

import type { MediaKind } from "./types.ts";

const HLS_CONTENT_TYPE =
  /(?:application|audio|video|text)\/(?:x-mpegurl|vnd\.apple\.mpegurl|mpegurl)/i;
const DASH_CONTENT_TYPE = /application\/dash\+xml/i;
const PROGRESSIVE_CONTENT_TYPE =
  /^(?:video\/(?:mp4|webm|ogg|quicktime|x-matroska|x-msvideo|x-flv)|audio\/(?:mp4|mpeg|webm|aac|ogg|x-m4a))\b/i;
const SEGMENT_CONTENT_TYPE = /^(?:video|audio)\/(?:mp2t|iso\.segment)\b/i;

const HLS_PATH = /\.m3u8?$/i;
const DASH_PATH = /\.mpd$/i;
const PROGRESSIVE_PATH = /\.(?:mp4|m4v|webm|mkv|mov|ogv|m4a|mp3|flv)$/i;
const SEGMENT_PATH = /\.(?:ts|m4s|cmfv|cmfa|cmft|aac|dash|vtt|key)$/i;

/**
 * fMP4 segments are served as `.mp4` too. Treating `init.mp4` as a downloadable
 * rendition would hand the engine two seconds of video, so a `.mp4` whose name
 * or size says "chunk" is demoted.
 */
const SEGMENT_NAME = /(?:^|[/_-])(?:init|seg|segment|chunk|frag|fragment)[^/]*$/i;
const NUMBERED_SEGMENT = /[-_/]\d{1,7}\.(?:mp4|m4v|webm|m4a)$/i;
const SMALL_FILE_BYTES = 512 * 1024;

/** Ad networks, analytics and beacon hosts. Their `.mp4`s are pre-roll, not content. */
const DENIED_HOST_SUFFIXES: readonly string[] = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "googletagmanager.com",
  "googletagservices.com",
  "google-analytics.com",
  "analytics.google.com",
  "imasdk.googleapis.com",
  "2mdn.net",
  "adnxs.com",
  "adsrvr.org",
  "adform.net",
  "adsafeprotected.com",
  "amazon-adsystem.com",
  "casalemedia.com",
  "criteo.com",
  "criteo.net",
  "freewheel.tv",
  "fwmrm.net",
  "innovid.com",
  "moatads.com",
  "openx.net",
  "outbrain.com",
  "pubmatic.com",
  "rubiconproject.com",
  "scorecardresearch.com",
  "serving-sys.com",
  "smartadserver.com",
  "springserve.com",
  "spotxchange.com",
  "taboola.com",
  "teads.tv",
  "yieldmo.com",
  "quantserve.com",
  "chartbeat.com",
  "demdex.net",
  "omtrdc.net",
  "hotjar.com",
  "mixpanel.com",
  "amplitude.com",
  "segment.io",
  "segment.com",
  "nr-data.net",
  "newrelic.com",
  "sentry.io",
];

const DENIED_PATH =
  /\/(?:pagead|adserver|adservice|advert|adsystem|vast|vmap|doubleclick|ads)(?:\/|$)/i;

export function isDeniedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  const host = url.hostname.toLowerCase();
  for (const suffix of DENIED_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return true;
  }
  return DENIED_PATH.test(url.pathname);
}

/**
 * Dedupe key only. The query string is kept — signed parameters are part of the
 * identity of a media URL, and two different signatures are two different URLs.
 */
export function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return raw.split("?")[0] ?? raw;
  }
}

function demoteChunks(path: string, contentLength: number | undefined): MediaKind {
  if (SEGMENT_NAME.test(path) || NUMBERED_SEGMENT.test(path)) return "segment";
  if (contentLength !== undefined && contentLength > 0 && contentLength < SMALL_FILE_BYTES) {
    return "segment";
  }
  return "progressive";
}

export interface MediaCandidate {
  url: string;
  contentType?: string | undefined;
  contentLength?: number | undefined;
}

/** `undefined` means "not media as far as we can tell". */
export function classifyMedia(candidate: MediaCandidate): MediaKind | undefined {
  const { url, contentType, contentLength } = candidate;
  if (isDeniedUrl(url)) return undefined;
  const path = pathOf(url);

  if (contentType) {
    if (HLS_CONTENT_TYPE.test(contentType)) return "hls";
    if (DASH_CONTENT_TYPE.test(contentType)) return "dash";
    if (SEGMENT_CONTENT_TYPE.test(contentType)) return "segment";
    if (PROGRESSIVE_CONTENT_TYPE.test(contentType)) return demoteChunks(path, contentLength);
    // Anything else falls through: `application/octet-stream` on a .m3u8 is
    // common enough that the extension still deserves a look.
  }

  if (HLS_PATH.test(path)) return "hls";
  if (DASH_PATH.test(path)) return "dash";
  if (SEGMENT_PATH.test(path)) return "segment";
  if (PROGRESSIVE_PATH.test(path)) return demoteChunks(path, contentLength);
  return undefined;
}

const EXPIRY_PARAMS: ReadonlySet<string> = new Set([
  "expires",
  "expire",
  "exp",
  "oe",
  "token_expiry",
  "valid_until",
  "x-amz-expires",
]);

/**
 * Signed media URLs commonly live 30–300 s (analysis §5). Surfacing the expiry
 * when the CDN spells it out lets the orchestrator re-probe instead of guessing
 * why a download 403'd.
 */
export function expiresAtFromUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }

  const amzDate = url.searchParams.get("X-Amz-Date");
  const amzExpires = url.searchParams.get("X-Amz-Expires");
  if (amzDate && amzExpires) {
    // ISO-8601 basic format: 20260805T120000Z
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
    const seconds = Number(amzExpires);
    if (match && Number.isFinite(seconds)) {
      const signed = Date.parse(
        `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
      );
      if (Number.isFinite(signed)) return new Date(signed + seconds * 1000).toISOString();
    }
  }

  for (const [name, value] of url.searchParams) {
    if (!EXPIRY_PARAMS.has(name.toLowerCase())) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    // Heuristic: 10-digit values are unix seconds, 13-digit are milliseconds.
    const ms = numeric > 1e11 ? numeric : numeric * 1000;
    const date = new Date(ms);
    const year = date.getUTCFullYear();
    if (year >= 2000 && year <= 2100) return date.toISOString();
  }
  return undefined;
}
