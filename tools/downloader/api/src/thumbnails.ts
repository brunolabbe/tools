/**
 * Preview images: fetched at probe time, served by token, held in two places.
 *
 * ## Where the image comes from (dl-29, then dl-56)
 *
 * An image the source names, first and nearly always: an `og:image`, or
 * yt-dlp's `thumbnail`. **Only when the source names none at all**, a single
 * frame grabbed from the probe's own stream, through `grabFrame`. The stream is
 * the one source every successful probe has, and a page with no image markup
 * otherwise renders no preview however well the video resolved.
 *
 * dl-29 ruled frame grabbing out as "a different and much larger feature". What
 * would have made it larger is not what this does: it is one ffmpeg invocation
 * per probe, never one per rendition; in-line and bounded like the image fetch,
 * never an asynchronous grab that would need a contract change to announce a
 * preview later; never after a named image failed, which would stack two
 * bounded costs on one probe; never for a live stream; and never retried
 * against another rendition, since a frame from a stream the probe did not rank
 * is worse than no picture. The grab goes out through the **ffmpeg egress
 * proxy**, because every segment and key a manifest names is a URL no SSRF sweep
 * here has seen — see `createFrameGrabber`.
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
 * ## Why there are two copies, and which owns what (dl-44)
 *
 * The in-memory store below is the **probe-only** path: a probe that has not
 * become a job — or has not finished being one — has no file on disk to keep a
 * preview beside, and `/api/thumbnail/:token` has to answer for it anyway. It
 * keeps its ten minutes.
 *
 * A **completed** job gets `persistThumbnail`, which writes the same bytes into
 * that job's `out/<jobId>/` directory. That is the whole of the retention rule:
 * the image is in the directory the retention sweep already deletes at
 * `fileRetentionHours`, so it lives exactly as long as the file it depicts and
 * is unlinked on the same pass. Nothing new has to know when to delete it.
 *
 * The token does not change between the two. `thumbnailPath` still means
 * `/api/thumbnail/<token>` and nothing else, so a client — or a `localStorage`
 * record written before any of this — keeps working across the hand-off and
 * across a restart. The route decides which copy answers; see
 * `routes/thumbnail.ts`.
 *
 * Everything here is decorative and every failure is non-fatal. Nothing in this
 * file throws into the probe path, and `persistThumbnail`'s caller must treat a
 * failure the same way: a download that succeeded is not undone by a picture
 * that could not be written.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { AppError, ROUTES } from "@downloader/contract";
import type { ProbeResult, RequestContext } from "@downloader/contract";
import { assertRealPathInside, choosePreviewVariant, grabPreviewFrame } from "@downloader/engine";
import type { Storage } from "@downloader/engine";
import type { MediaVariant } from "@downloader/contract";
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
 * Well under `probeTimeoutMs` (45 s by default) on purpose. A decorative image
 * must never be able to add meaningfully to how long a probe takes, and the
 * probe's own budget has already been mostly spent by the time we get here.
 */
const THUMBNAIL_FETCH_TIMEOUT_MS = 4_000;

/**
 * The frame grab's ceiling, including the process-tree kill — past it the grab
 * is `null` and the probe answers without a preview.
 *
 * Measured, not chosen from the brief (dl-56's Log has the runs). Against a real
 * CDN's 634-second HLS title, a whole probe that grabbed through this wiring —
 * the terminating ffmpeg egress proxy included — took 0.38–0.50 s on the lowest
 * rung, the one `choosePreviewVariant` picks. Directly, with no proxy, the grab
 * took 0.23–0.27 s on that rung and 0.44–0.49 s on the 1080p one. Against the
 * generated fixture, under 0.11 s. Six seconds is twelve times the slowest of
 * those, for a CDN further away or colder than the one measured.
 *
 * Its relationship to `probeTimeoutMs` (45 s by default) is the same as
 * `THUMBNAIL_FETCH_TIMEOUT_MS`'s, and the two never stack: the grab runs only
 * when the source named no image, so no image fetch was attempted. A probe that
 * spent its whole resolution budget finishes at most this much later, and the
 * reproduction's own 22.8 s probe would have finished in under 29 s.
 */
const FRAME_GRAB_TIMEOUT_MS = 6_000;

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

/**
 * One captured preview: the bytes, the name they were filed under, and the path
 * that serves them.
 *
 * `captureThumbnail` used to return just the path. The bytes are returned too
 * because the job pipeline needs them *later* than it captures them — a probe
 * happens before a download and a download can outlast `THUMBNAIL_TTL_MS`, so
 * reading them back out of the store at completion would lose the preview of
 * exactly the long downloads most worth keeping one for.
 */
export interface CapturedThumbnail {
  /** The name the bytes are filed under, in memory and on disk alike. */
  token: string;
  /** `/api/thumbnail/<token>` — what `thumbnailPath` has always meant. */
  path: string;
  thumbnail: StoredThumbnail;
  /**
   * `page` for an image the source named, `frame` for one grabbed from the
   * stream (dl-56). Log-only: nothing a client receives carries it.
   */
  source: "page" | "frame";
}

/** What a frame grab is asked for. The variant is already chosen. */
export interface FrameGrabRequest {
  probe: ProbeResult;
  variant: MediaVariant;
  signal?: AbortSignal | undefined;
}

/**
 * Grabs one frame and returns JPEG bytes, or `null`. May throw; the caller
 * treats a throw exactly like `null`.
 */
export type FrameGrabber = (request: FrameGrabRequest) => Promise<Buffer | null>;

export interface CaptureThumbnailOptions {
  probe: ProbeResult;
  guard: SsrfGuard;
  fetchImpl: GuardedFetch;
  store: ThumbnailStore;
  logger: AppLogger;
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * The fallback for a probe whose source names no image (dl-56). Absent means
   * no fallback, which is what every caller had before it.
   */
  grabFrame?: FrameGrabber | undefined;
  /** The caller's cancellation, handed to `grabFrame`. */
  signal?: AbortSignal | undefined;
}

/**
 * Fetches the probe's preview image and returns it, or `null` if anything at
 * all went wrong. When the source names no image, grabs a frame instead, if a
 * `grabFrame` was given — see `captureFrame`.
 *
 * **Never throws.** Timeout, 404, oversized body, wrong content type, blocked
 * address, malformed URL — every one of them means "no preview", and the probe
 * carries on exactly as it does today. A user who cannot see a picture can
 * still download the video.
 */
export async function captureThumbnail(
  options: CaptureThumbnailOptions,
): Promise<CapturedThumbnail | null> {
  const { probe, guard, fetchImpl, store, logger } = options;
  const maxBytes = options.maxBytes ?? MAX_THUMBNAIL_BYTES;
  const timeoutMs = options.timeoutMs ?? THUMBNAIL_FETCH_TIMEOUT_MS;

  // Read off the same inventory the media sweep uses, rather than off
  // `probe.thumbnailUrl` directly, so `ssrf.ts` stays the one place that knows
  // which URLs a probe causes us to fetch.
  const [url] = urlsInProbeResult(probe).bestEffort;
  // Only when there is no image URL at all. A named image that then fails
  // below stays no preview: that page did name one, and a grab after a failed
  // fetch would stack two bounded costs on one probe.
  if (url === undefined) return await captureFrame(options, maxBytes);

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

    const thumbnail: StoredThumbnail = { contentType, bytes };
    const token = store.put(thumbnail);
    return { token, path: ROUTES.thumbnail(token), thumbnail, source: "page" };
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

/** JPEG's start-of-image marker, `FF D8 FF`. */
function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * The stream fallback: one frame from the probe's cheapest video rendition.
 *
 * Held to the same rules as a fetched image — the content-type allowlist
 * (`image/jpeg`, and the bytes must be one), the same byte cap, the same store —
 * and like every path in `captureThumbnail` it never throws: a grab that
 * returns `null`, throws, or hands back something that is not a JPEG is logged
 * at `debug` and is no preview.
 */
async function captureFrame(
  options: CaptureThumbnailOptions,
  maxBytes: number,
): Promise<CapturedThumbnail | null> {
  const { probe, store, logger, grabFrame } = options;
  if (grabFrame === undefined) return null;
  // A live variant can be a moving window with no stable frame, and a live
  // probe is already on its own path (`LIVE_STREAM_UNSUPPORTED`).
  if (probe.isLive) return null;
  const variant = choosePreviewVariant(probe.variants);
  if (variant === null) return null;

  try {
    const bytes = await grabFrame({
      probe,
      variant,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (bytes === null) {
      logger.debug("no preview frame: the grab produced none");
      return null;
    }
    const contentType = "image/jpeg";
    if (!ALLOWED_CONTENT_TYPES.has(contentType) || !isJpeg(bytes)) {
      logger.debug("no preview frame: not a JPEG", { bytes: bytes.length });
      return null;
    }
    if (bytes.length > maxBytes) {
      logger.debug("no preview frame: larger than the cap", { maxBytes });
      return null;
    }
    const thumbnail: StoredThumbnail = { contentType, bytes };
    const token = store.put(thumbnail);
    return { token, path: ROUTES.thumbnail(token), thumbnail, source: "frame" };
  } catch (error) {
    logger.debug("no preview frame: the grab failed", {
      reason: error instanceof AppError ? error.code : String(error),
    });
    return null;
  }
}

export interface FrameGrabberOptions {
  ffmpegPath: string;
  /**
   * **`ffmpegEgress.proxyUrl`, and nothing else.** The segments, init segments
   * and keys a manifest names were never in the probe's SSRF sweep; this proxy
   * is the only check that sees them. Leaving it unset passes every test that
   * does not look and reopens dl-11.
   */
  proxyUrl: string;
  /** `ffmpegEgress.tlsCaFile` — the other half of the same pair. */
  tlsCaFile?: string | undefined;
  tlsVerify: boolean;
  /** The storage `tmp/` root. */
  tmpRoot: string;
  logger: AppLogger;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * The production `FrameGrabber`: the engine's ffmpeg grab, given the same
 * egress, trust store and TLS verification a download gets, and the probe's
 * `RequestContext` replayed on every request.
 */
export function createFrameGrabber(options: FrameGrabberOptions): FrameGrabber {
  return async ({ probe, variant, signal }) =>
    await grabPreviewFrame({
      url: variant.url,
      protocol: variant.protocol,
      requestContext: probe.requestContext,
      durationSec: variant.durationSec ?? probe.durationSec ?? null,
      ffmpegPath: options.ffmpegPath,
      proxyUrl: options.proxyUrl,
      tlsVerify: options.tlsVerify,
      ...(options.tlsCaFile === undefined ? {} : { tlsCaFile: options.tlsCaFile }),
      tmpRoot: options.tmpRoot,
      timeoutMs: options.timeoutMs ?? FRAME_GRAB_TIMEOUT_MS,
      maxOutputBytes: options.maxBytes ?? MAX_THUMBNAIL_BYTES,
      signal,
      logger: options.logger,
    });
}

/**
 * Extension per allowed content type.
 *
 * The set is closed — it is `ALLOWED_CONTENT_TYPES` — so this is a total map and
 * not a guess about what an origin said. The extension is cosmetic: the served
 * `Content-Type` comes from the recorded row, never from the name on disk.
 */
const PERSISTED_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/**
 * The stem the persisted copy takes inside `out/<jobId>/`.
 *
 * It cannot collide with the media file the engine puts in the same directory:
 * that name always ends in a container extension (`.mp4`, `.mkv`, `.webm`,
 * `.m4a` — `outputExtension` in the engine), and none of those is in
 * `PERSISTED_EXTENSIONS`. A page titled "preview" produces `preview.mp4`.
 */
const PERSISTED_THUMBNAIL_STEM = "preview";

export interface PersistThumbnailOptions {
  /** The engine's storage, so the path is built and confined by its own rules. */
  storage: Storage;
  jobId: string;
  thumbnail: StoredThumbnail;
}

/**
 * Writes a captured preview into the job's own output directory, and returns
 * the absolute path it was written to.
 *
 * **Beside the file on purpose.** `out/<jobId>/` is what the retention sweep
 * deletes at `fileRetentionHours` — both through `Storage.removeJob`, which the
 * API calls for an expired token, and through `Storage.collectGarbage`, which
 * removes the whole directory by age. Putting the image there is the entire
 * implementation of "the image goes when the file goes"; there is no second
 * rule to keep in step with the first, which is the one thing a directory of
 * its own would have cost.
 *
 * Throws on an I/O failure rather than swallowing it — unlike `captureThumbnail`,
 * this one has a caller that knows what to do (log it, keep the download).
 */
export async function persistThumbnail(options: PersistThumbnailOptions): Promise<string> {
  const { storage, jobId, thumbnail } = options;
  const extension = PERSISTED_EXTENSIONS[thumbnail.contentType];
  if (extension === undefined) {
    // Unreachable: the type was checked against the allowlist before the bytes
    // were kept. Loud rather than a mystery file, if the two ever drift apart.
    throw new AppError("INTERNAL", "Refusing to persist a preview of an unknown type.", {
      details: { contentType: thumbnail.contentType },
    });
  }

  await storage.createOutDir(jobId);
  // `outPath` sanitises and confines textually; `assertRealPathInside` repeats
  // the check after symlinks, for the same reason `files.ts` does it at the
  // moment of use. The name is a constant, but the confinement is about the
  // *directory*, whose segment comes from a job id.
  const target = storage.outPath(jobId, `${PERSISTED_THUMBNAIL_STEM}${extension}`);
  await assertRealPathInside(storage.root, target);
  await fs.writeFile(target, thumbnail.bytes);
  return target;
}

/**
 * Reads a persisted preview back.
 *
 * Returns `null` when the bytes are not there — which is the ordinary case once
 * the retention sweep has run, and must read as "gone" rather than as an error.
 *
 * A path *outside* the storage root is not that case, and it throws: the row
 * was written by this process, so a row naming somewhere else is a bug or a
 * tampered database, and `/api/files/:token` treats its own equivalent the same
 * way rather than quietly answering "no".
 */
export async function readPersistedThumbnail(
  storage: Storage,
  filePath: string,
): Promise<Buffer | null> {
  await assertRealPathInside(storage.root, filePath);
  try {
    return await fs.readFile(filePath);
  } catch {
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
