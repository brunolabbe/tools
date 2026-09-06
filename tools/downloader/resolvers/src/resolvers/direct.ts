/**
 * Direct-URL resolver — priority 90, the last tier in the chain.
 *
 * The case where the URL the caller pasted *is* the media: a `.m3u8`, an `.mpd`
 * or a plain `.mp4`. No browser, no extractor, one HEAD and at most one GET.
 *
 * Two things here are load-bearing rather than incidental:
 *  - Content-Type is checked first but never trusted alone. Plenty of CDNs serve
 *    manifests as `application/octet-stream` or `text/plain`, so the path
 *    extension is a real fallback, not a nicety.
 *  - Every request carries the caller's `RequestContext` headers — cookies and
 *    Accept-Language included — because segments are gated the same way the
 *    manifest is (analysis §5).
 */

import { AppError } from "@downloader/contract";
import type {
  MediaVariant,
  ProbeResult,
  RequestContext,
  Resolver,
  ResolveOptions,
  StreamProtocol,
} from "@downloader/contract";
import { toAbortError } from "../abort.ts";
import { buildLabel, optional, urlExtension } from "../common.ts";
import { parseDash } from "../manifest/dash.ts";
import { parseHls } from "../manifest/hls.ts";
import type { DashParser, HlsParser, ParsedManifest } from "../manifest/types.ts";
import { createFetchSizeProbe } from "../size-probe.ts";
import { measureVariantSizes } from "../size-sample.ts";

/** Sent when the caller supplied nothing better; a bare fetch UA is refused by many CDNs. */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Manifest bodies are text; anything larger than this is not a playlist we should parse. */
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

const HLS_EXTENSIONS = new Set(["m3u8", "m3u"]);
const DASH_EXTENSIONS = new Set(["mpd"]);
const PROGRESSIVE_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "flv",
  "ts",
  "m4a",
  "mp3",
  "aac",
  "ogg",
  "opus",
  "wav",
]);

export interface DirectResolverOptions {
  /** Injected in tests so the suite never touches the network. */
  fetch?: typeof globalThis.fetch;
  parseHls?: HlsParser;
  parseDash?: DashParser;
  userAgent?: string;
}

export class DirectUrlResolver implements Resolver {
  readonly name = "direct";
  readonly priority = 90;

  readonly #fetch: typeof globalThis.fetch;
  readonly #parseHls: HlsParser;
  readonly #parseDash: DashParser;
  readonly #userAgent: string;

  constructor(options: DirectResolverOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#parseHls = options.parseHls ?? parseHls;
    this.#parseDash = options.parseDash ?? parseDash;
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  canHandle(url: URL): boolean {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  async resolve(url: URL, options: ResolveOptions): Promise<ProbeResult> {
    const headers = this.#buildHeaders(url, options);
    const head = await this.#head(url, headers, options.signal);
    const contentType = (head.headers.get("content-type") ?? "").toLowerCase();
    const extension = urlExtension(url.href);
    const protocol = classify(contentType, extension);

    const requestContext: RequestContext = {
      headers,
      ...optional({ proxyUrl: options.proxyUrl }),
    };

    if (protocol === "hls" || protocol === "dash") {
      return await this.#resolveManifest(url, protocol, requestContext, options);
    }
    if (protocol === "progressive") {
      return this.#resolveProgressive(url, head, contentType, extension, requestContext);
    }

    throw new AppError("NO_MEDIA_FOUND", undefined, {
      details: { url: url.href, contentType },
    });
  }

  #buildHeaders(url: URL, options: ResolveOptions): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": this.#userAgent,
      Accept: "*/*",
      // A signed manifest URL almost always requires the page it was embedded
      // on; its own origin is the closest thing we have when the caller pasted
      // the media URL directly.
      Referer: url.origin + "/",
    };
    if (options.locale !== undefined && options.locale !== "") {
      headers["Accept-Language"] = sanitiseHeaderValue(options.locale);
    }
    if (options.cookieHeader !== undefined && options.cookieHeader !== "") {
      headers["Cookie"] = sanitiseHeaderValue(options.cookieHeader);
    }
    return headers;
  }

  async #head(url: URL, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
    const head = await this.#request(url, { method: "HEAD", headers, signal, redirect: "follow" });
    if (head.ok) return head;

    // Servers that reject HEAD outright (405/501, and a surprising number of
    // 403s) still answer a one-byte ranged GET, which is enough to read the
    // Content-Type without pulling the file.
    if (head.status === 405 || head.status === 501 || head.status === 403) {
      const probe = await this.#request(url, {
        method: "GET",
        headers: { ...headers, Range: "bytes=0-0" },
        signal,
        redirect: "follow",
      });
      await probe.body?.cancel();
      if (probe.ok) return probe;
      throwForStatus(url, probe.status);
    }
    throwForStatus(url, head.status);
  }

  async #request(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url.href, init);
    } catch (cause) {
      if (isAbort(cause)) {
        // `fetch` reports every abort as a bare `AbortError`, so the reason has
        // to come from the signal we handed it, not from the error it threw.
        const signal = init.signal;
        if (signal?.aborted === true) throw toAbortError(signal, ABORT_MESSAGE);
        throw new AppError("TIMEOUT", ABORT_MESSAGE);
      }
      // **An already-classified failure passes through unchanged**, and the
      // absence of this line is what made dl-31's misdiagnosis reach a client.
      // `fetchImpl` here is `guardedFetch`, which raises `BLOCKED_TARGET` for a
      // rebound DNS answer and `TLS_VERIFICATION_FAILED` for a refused
      // certificate; re-wrapping either as `UNREACHABLE` replaces the copy at
      // the raise site, which is the repo's own tell for the wrong code, and
      // turns a permanent misconfiguration into a retryable one. The browser
      // tier had this from the start — `browser/classify.ts`'s
      // `classifyNavigationError` opens with the same check.
      if (cause instanceof AppError) throw cause;
      throw new AppError("UNREACHABLE", undefined, {
        cause,
        details: { url: url.href },
      });
    }
  }

  async #resolveManifest(
    url: URL,
    protocol: "hls" | "dash",
    requestContext: RequestContext,
    options: ResolveOptions,
  ): Promise<ProbeResult> {
    const response = await this.#request(url, {
      method: "GET",
      headers: requestContext.headers,
      signal: options.signal,
      redirect: "follow",
    });
    if (!response.ok) throwForStatus(url, response.status);

    const body = await readTextCapped(response, url);
    const parsed: ParsedManifest =
      protocol === "hls"
        ? this.#parseHls(body, response.url === "" ? url.href : response.url)
        : this.#parseDash(body, response.url === "" ? url.href : response.url);

    if (parsed.drm.protected) {
      throw new AppError("DRM_PROTECTED", undefined, {
        details: {
          url: url.href,
          systems: parsed.drm.systems,
          ...optional({ evidence: parsed.drm.evidence }),
        },
      });
    }
    if (parsed.variants.length === 0) {
      throw new AppError("NO_MEDIA_FOUND", undefined, { details: { url: url.href } });
    }

    // Declared bitrates overstate VBR content by up to 2x (dl-30), so the sizes
    // the parser derived from them are corrected against a rendition we weigh
    // ourselves. Fails open: an unmeasurable manifest keeps what it declared.
    const variants = await measureVariantSizes(
      parsed.variants,
      createFetchSizeProbe({
        fetch: this.#fetch,
        headers: requestContext.headers,
        signal: options.signal,
      }),
      {
        isLive: parsed.isLive,
        signal: options.signal,
        ...optional({ durationSec: parsed.durationSec }),
      },
    );

    return {
      sourceUrl: url.href,
      resolver: this.name,
      title: titleFromUrl(url),
      variants,
      subtitles: parsed.subtitles,
      requestContext,
      drm: parsed.drm,
      isLive: parsed.isLive,
      probedAt: new Date().toISOString(),
      ...optional({ durationSec: parsed.durationSec }),
    };
  }

  #resolveProgressive(
    url: URL,
    head: Response,
    contentType: string,
    extension: string | undefined,
    requestContext: RequestContext,
  ): ProbeResult {
    const filesizeBytes = contentLength(head);
    const container = extension ?? subtypeOf(contentType);
    const hasVideo =
      !contentType.startsWith("audio/") &&
      !(extension !== undefined && AUDIO_ONLY_EXTENSIONS.has(extension));

    const variant: MediaVariant = {
      id: "direct-0",
      protocol: "progressive",
      url: head.url === "" ? url.href : head.url,
      hasVideo,
      // `hasAudio` is deliberately absent: one HEAD says nothing about streams,
      // so there is no honest value here and `undefined` is the contract's
      // "we did not look" (dl-42). Claiming `true` sent ffmpeg after a track
      // that may not exist; claiming `false` would be the same lie inverted.
      label: buildLabel({
        hasVideo,
        filesizeBytes,
        filesizeIsEstimate: false,
        fallback: container === undefined ? "Direct file" : `Direct ${container.toUpperCase()}`,
      }),
      ...optional({
        container,
        filesizeBytes,
        filesizeIsEstimate: filesizeBytes === undefined ? undefined : false,
      }),
    };

    return {
      sourceUrl: url.href,
      resolver: this.name,
      title: titleFromUrl(url),
      variants: [variant],
      subtitles: [],
      requestContext,
      drm: { protected: false, systems: [] },
      isLive: false,
      probedAt: new Date().toISOString(),
    };
  }
}

const AUDIO_ONLY_EXTENSIONS = new Set(["m4a", "mp3", "aac", "ogg", "opus", "wav", "flac"]);

/**
 * Content-Type first, path extension second. Returns `undefined` when neither
 * says anything useful, which the caller turns into `NO_MEDIA_FOUND` so the
 * chain can fall through.
 */
export function classify(
  contentType: string,
  extension: string | undefined,
): StreamProtocol | undefined {
  // `application/x-mpegURL` is spelled a dozen different ways in the wild.
  const type = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (type.includes("mpegurl")) return "hls";
  if (type.includes("dash+xml")) return "dash";
  if (type.startsWith("video/") || type.startsWith("audio/")) return "progressive";

  const suffix = extension?.toLowerCase();
  if (suffix !== undefined) {
    if (HLS_EXTENSIONS.has(suffix)) return "hls";
    if (DASH_EXTENSIONS.has(suffix)) return "dash";
    if (PROGRESSIVE_EXTENSIONS.has(suffix)) return "progressive";
  }
  return undefined;
}

function subtypeOf(contentType: string): string | undefined {
  const type = contentType.split(";")[0]?.trim() ?? "";
  const slash = type.indexOf("/");
  return slash === -1 ? undefined : type.slice(slash + 1);
}

function contentLength(response: Response): number | undefined {
  // A ranged probe answers with the range length, so only the total from
  // Content-Range is trustworthy there.
  const range = response.headers.get("content-range");
  if (range !== null) {
    const total = /\/(\d+)\s*$/.exec(range)?.[1];
    if (total !== undefined) return Number(total);
  }
  const raw = response.headers.get("content-length");
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function readTextCapped(response: Response, url: URL): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_MANIFEST_BYTES) {
    throw new AppError("NO_MEDIA_FOUND", "That manifest is implausibly large.", {
      details: { url: url.href, bytes: declared },
    });
  }
  const text = await response.text();
  if (text.length > MAX_MANIFEST_BYTES) {
    throw new AppError("NO_MEDIA_FOUND", "That manifest is implausibly large.", {
      details: { url: url.href, bytes: text.length },
    });
  }
  return text;
}

function titleFromUrl(url: URL): string {
  const segments = url.pathname.split("/").filter((part) => part !== "");
  const last = segments.at(-1);
  if (last === undefined) return url.hostname;
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // A malformed percent-escape is not worth failing a probe over.
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const cleaned = stem.replaceAll(/[_+]+/g, " ").trim();
  return cleaned === "" ? url.hostname : cleaned;
}

/** Header values reach a network layer verbatim; CR/LF in them is request splitting. */
function sanitiseHeaderValue(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}

const ABORT_MESSAGE = "Fetching that address took too long.";

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function throwForStatus(url: URL, status: number): never {
  const details = { url: url.href, status };
  if (status === 401 || status === 407) throw new AppError("AUTH_REQUIRED", undefined, { details });
  if (status === 429) throw new AppError("RATE_LIMITED", undefined, { details });
  if (status === 451) throw new AppError("GEO_BLOCKED", undefined, { details });
  // Everything else — 403, 404, 5xx — falls through to the next tier: a browser
  // with a real session may well succeed where a bare fetch was refused.
  throw new AppError("NO_MEDIA_FOUND", undefined, { details });
}
