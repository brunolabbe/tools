/**
 * Preview images: fetched at probe time, held in memory, served by token.
 *
 * ## Why the bytes come through this service at all
 *
 * `ProbeResult.thumbnailUrl` is a `<meta property="og:image">` on a page a user
 * pasted, or a `thumbnail` field from yt-dlp's view of one. It is resolver
 * output, which `probe.ts` already calls attacker-influenced when it sweeps
 * every other URL in a probe. Putting it in an `<img src>` would make the
 * *user's own browser* issue a `GET` at an address the page chose, including
 * addresses only that browser can reach:
 *
 * ```html
 * <meta property="og:image" content="http://192.168.1.1/admin?action=reboot" />
 * ```
 *
 * No server-side guard sees that request — `ssrf.ts`, `dispatcher.ts` and
 * `egress-proxy.ts` are all upstream of a request the browser makes on its own.
 * Fetching here instead puts the guard back in front of it, and incidentally
 * keeps the user's address and `Referer` off the source, and lets a thumbnail
 * behind the same credential gate as the manifest render at all.
 *
 * ## Why the client never names a URL
 *
 * A route taking `?url=` would be an open proxy with a guard bolted on: any
 * caller could use this service to fetch from its address. So the capability is
 * the token, exactly as it is for `/api/files/:token` — the client asks for an
 * image this service already decided to fetch, by a name only this service
 * could have minted.
 *
 * ## Why eagerly, at probe time
 *
 * Replaying the source's credentials needs `probe.requestContext.headers`, and
 * `Job` carries no `requestContext`. At probe time those headers are in hand;
 * an hour later, when some browser asks a job for its preview, they are not.
 * Fetching where the credentials already are is the only shape that serves the
 * probe panel and the downloads list from one code path.
 *
 * Everything here is decorative and every failure is non-fatal. Nothing in this
 * file throws into the probe path.
 */

import { randomBytes } from "node:crypto";
import { AppError, ROUTES } from "@downloader/contract";
import type { ProbeResult, RequestContext } from "@downloader/contract";
import type { GuardedFetch } from "./guarded-fetch.ts";
import type { AppLogger } from "./logger.ts";
import type { SsrfGuard } from "./ssrf.ts";
import { urlsInProbeResult } from "./ssrf.ts";

/**
 * What we are willing to serve back.
 *
 * An allowlist rather than "whatever the origin said", because the value ends
 * up in a `Content-Type` header on *our* origin. `image/svg+xml` is absent on
 * purpose: an SVG is a document that can carry script, and serving one from
 * this origin would be a stored XSS with extra steps.
 */
const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Hard ceiling on a preview, enforced while reading rather than by trusting
 * `Content-Length` — a lying header is free, and a chunked response has none at
 * all. 512 KB is generous for an `og:image`; the point is that the number
 * exists, not where it sits.
 */
const MAX_THUMBNAIL_BYTES = 512 * 1024;

/**
 * Well under `probeTimeoutMs` (30 s by default) on purpose. A decorative image
 * must never be able to add meaningfully to how long a probe takes, and the
 * probe's own budget has already been mostly spent by the time we get here.
 */
const THUMBNAIL_FETCH_TIMEOUT_MS = 4_000;

/**
 * Comfortably above `PROBE_CACHE_TTL_CEILING_MS` (60 s).
 *
 * The relationship is load-bearing, which is why it is stated rather than
 * chosen: `probe.ts` mints the token *before* it caches the probe, so a cache
 * hit inside the next 60 s hands out a token minted up to 60 s ago. If entries
 * here expired first, a repeat view would reference a token this store had
 * already dropped and the preview would silently vanish. Ten minutes also
 * covers a user reading the rendition list before deciding.
 */
const THUMBNAIL_TTL_MS = 10 * 60 * 1000;

/**
 * Bounds memory the same way `ProbeCache` does. Images are tens of kilobytes,
 * so this is about refusing to grow without limit rather than about size —
 * at the cap and the byte ceiling together, the worst case is 200 MB, and in
 * practice two orders of magnitude less.
 */
const MAX_THUMBNAIL_ENTRIES = 400;

export interface StoredThumbnail {
  contentType: string;
  bytes: Buffer;
}

interface Entry extends StoredThumbnail {
  storedAtMs: number;
}

export interface ThumbnailStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * A bounded, TTL'd, in-memory store, modelled on `ProbeCache`.
 *
 * Deliberately **not** `STORAGE_DIR`: that directory has a retention sweep and
 * a token table built for multi-gigabyte media, and a preview image that
 * outlives the process is worth nothing.
 */
export class ThumbnailStore {
  readonly #entries = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: ThumbnailStoreOptions = {}) {
    this.#ttlMs = Math.max(0, options.ttlMs ?? THUMBNAIL_TTL_MS);
    this.#maxEntries = Math.max(1, options.maxEntries ?? MAX_THUMBNAIL_ENTRIES);
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Mints the token as it stores, so a caller cannot supply one. */
  put(thumbnail: StoredThumbnail): string {
    // 32 CSPRNG bytes, base64url — the same shape and the same reasoning as
    // `createFileToken`. Never derived from the job id or the source URL.
    const token = randomBytes(32).toString("base64url");
    this.#entries.set(token, { ...thumbnail, storedAtMs: this.#now() });
    while (this.#entries.size > this.#maxEntries) {
      // Map iteration is insertion-ordered, so the first key is the oldest.
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
    return token;
  }

  get(token: string): StoredThumbnail | null {
    const entry = this.#entries.get(token);
    if (entry === undefined) return null;
    if (this.#now() - entry.storedAtMs >= this.#ttlMs) {
      this.#entries.delete(token);
      return null;
    }
    return { contentType: entry.contentType, bytes: entry.bytes };
  }

  clear(): void {
    this.#entries.clear();
  }
}

export interface CaptureThumbnailOptions {
  probe: ProbeResult;
  guard: SsrfGuard;
  fetchImpl: GuardedFetch;
  store: ThumbnailStore;
  logger: AppLogger;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetches the probe's preview image and returns the path that serves it, or
 * `null` if anything at all went wrong.
 *
 * **Never throws.** Timeout, 404, oversized body, wrong content type, blocked
 * address, malformed URL — every one of them means "no preview", and the probe
 * carries on exactly as it does today. A user who cannot see a picture can
 * still download the video.
 */
export async function captureThumbnail(options: CaptureThumbnailOptions): Promise<string | null> {
  const { probe, guard, fetchImpl, store, logger } = options;
  const maxBytes = options.maxBytes ?? MAX_THUMBNAIL_BYTES;
  const timeoutMs = options.timeoutMs ?? THUMBNAIL_FETCH_TIMEOUT_MS;

  // Read off the same inventory the media sweep uses, rather than off
  // `probe.thumbnailUrl` directly, so `ssrf.ts` stays the one place that knows
  // which URLs a probe causes us to fetch.
  const [url] = urlsInProbeResult(probe).bestEffort;
  if (url === undefined) return null;

  try {
    // Belt and braces with `guardedFetch`, which runs this same check on hop 0.
    // Kept because it is what makes the refusal land *here*, where dropping the
    // preview is the defined outcome, rather than being inferred from an error
    // code thrown out of a fetch — and because it is the line that pairs with
    // `bestEffort` being in the inventory at all.
    await guard.assertAllowed(url);

    const response = await fetchImpl(url, {
      // Replayed for the same reason the engine replays them: a CDN routinely
      // gates an image behind the `Referer` and `Cookie` the player sent, and
      // an unauthenticated fetch of it simply 403s.
      headers: headersFor(probe.requestContext),
      // `guardedFetch` re-checks every hop and owns `redirect`; this only
      // bounds how many seconds a decorative fetch may cost the probe.
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      logger.debug("no preview image: the source refused it", { status: response.status });
      return null;
    }

    const contentType = normalizeContentType(response.headers.get("content-type"));
    if (contentType === null) {
      logger.debug("no preview image: content type not an allowed image", {
        contentType: response.headers.get("content-type") ?? "",
      });
      return null;
    }

    const bytes = await readBounded(response, maxBytes);
    if (bytes === null) {
      logger.debug("no preview image: larger than the cap", { maxBytes });
      return null;
    }

    return ROUTES.thumbnail(store.put({ contentType, bytes }));
  } catch (error) {
    // Deliberately swallowed, at `debug`: a blocked address here is a page
    // being hostile about its *preview*, which says nothing about whether the
    // video is downloadable, and a warn per probe would be noise.
    logger.debug("no preview image: the fetch failed", {
      reason: error instanceof AppError ? error.code : String(error),
    });
    return null;
  }
}

/**
 * The client-facing shape of a probe: the origin URL removed, our path in.
 *
 * Applied on **both** ways out — `POST /api/probe`'s body and the orchestrator's
 * `probed` SSE frame, which carries a whole `ProbeResult` to the client too.
 * Rewriting only the first would have left the origin URL reaching the browser
 * by the other door.
 *
 * Composes with `withoutEgressProxy` rather than replacing it: that one strips
 * this process's loopback proxy port, which is a different secret.
 */
export function withThumbnailPath(probe: ProbeResult, path: string | null): ProbeResult {
  const { thumbnailUrl: _origin, ...rest } = probe;
  return { ...rest, ...(path === null ? {} : { thumbnailPath: path }) };
}

/** Only what a client may see back. */
export function isServableContentType(value: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(value);
}

function headersFor(requestContext: RequestContext): Record<string, string> {
  return { ...requestContext.headers, Accept: "image/*" };
}

/** Strips parameters and case, then checks the allowlist. `null` means refuse. */
function normalizeContentType(raw: string | null): string | null {
  if (raw === null) return null;
  const bare = (raw.split(";")[0] ?? "").trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(bare) ? bare : null;
}

/**
 * Reads the body, giving up the moment it exceeds the cap.
 *
 * `Content-Length` is not consulted: it is the origin's claim about its own
 * body, it is absent on a chunked response, and a hostile origin sending a
 * gigabyte with a `Content-Length: 1000` is free. Counting what actually
 * arrives is the only version that bounds anything.
 */
async function readBounded(response: Response, maxBytes: number): Promise<Buffer | null> {
  const body = response.body;
  if (body === null) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    // Stops the transfer on the oversize path instead of draining a body we
    // have already decided to throw away.
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}
