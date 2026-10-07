/**
 * Network capture.
 *
 * Listeners are attached to the BrowserContext rather than the Page so that
 * iframes, popups and any page opened during the probe are covered by the same
 * collector — embedded players are extremely common and each one is a frame.
 */

import type { BrowserContext, Request, Response } from "playwright";
import { classifyMedia, isDeniedUrl, normaliseUrl, responseFileSize } from "./media-match.ts";
import {
  isContentEncoded,
  isSniffable,
  MAX_ENCODED_SNIFFS_PER_PROBE,
  MAX_SNIFF_BODY_BYTES,
  MAX_SNIFFS_PER_PROBE,
  SNIFF_HEAD_BYTES,
  sniffManifestKind,
} from "./sniff.ts";
import type { NetworkHit } from "./types.ts";

/** Manifests are small; anything larger than this is not a playlist worth keeping. */
const MAX_CAPTURED_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Compressed typed manifests whose body is read at interception time, per probe
 * (dl-91). Chromium inflates a body before Playwright returns it, so the declared
 * length is the size on the wire and bounds nothing: 32 typed `.m3u8` responses of
 * ~12 KB each, inflating to 12 MiB, took the Node process from 269 MB to ~800 MB
 * peak RSS. Two because `#loadManifest` tries at most two manifests and *re-fetches*
 * each, so this read is only the fallback for a re-fetch that fails; two covers a
 * master and the variant it names, and a third is a body nothing is waiting on.
 * Its own budget, apart from the sniff's, because a probe can have both.
 */
export const MAX_ENCODED_CAPTURES_PER_PROBE = 2;

/** A page that fires thousands of media requests is not worth unbounded memory. */
const MAX_HITS = 400;

export class HitCollector {
  readonly #hits = new Map<string, NetworkHit>();
  readonly #bodies = new Map<string, string>();
  readonly #pending = new Set<Promise<unknown>>();
  /** Urls whose body was already read for a manifest (dl-79), so a poll reads once. */
  readonly #sniffed = new Set<string>();
  #encodedSniffs = 0;
  /** Urls whose compressed typed body was admitted to the read budget (dl-91). */
  readonly #encodedCaptured = new Set<string>();
  #seq = 0;
  #lastActivityAt = Date.now();
  #attached = false;

  attach(context: BrowserContext): void {
    if (this.#attached) return;
    this.#attached = true;
    context.on("request", (request) => {
      this.#onRequest(request);
    });
    context.on("response", (response) => {
      this.#onResponse(response);
    });
    context.on("requestfinished", (request) => {
      this.#touch(request.url());
    });
    context.on("requestfailed", (request) => {
      this.#touch(request.url());
    });
  }

  /** Timestamp of the last non-beacon network event; drives the quiet wait. */
  get lastActivityAt(): number {
    return this.#lastActivityAt;
  }

  /**
   * In the order hits were recorded. `seq` is the order they arrived, which
   * differs for a sniffed manifest, whose number is taken when its response
   * arrives and whose hit is recorded once its body has been read (dl-79).
   */
  get hits(): NetworkHit[] {
    return [...this.#hits.values()];
  }

  /**
   * Whether the collector has captured any playable (non-segment) media.
   * Used by dl-80 to extend the quiet floor when a page has nothing yet.
   */
  hasPlayableHit(): boolean {
    for (const hit of this.#hits.values()) {
      if (hit.kind !== "segment") return true;
    }
    return false;
  }

  /** Response body captured at interception time, if it was small enough to keep. */
  bodyFor(key: string): string | undefined {
    return this.#bodies.get(key);
  }

  /**
   * Header and body reads are async, so ranking must wait for them.
   *
   * Bounded, because some of them never finish: when a player calls `fetch()`
   * and abandons the response without reading it, Chromium leaves the body
   * unread and `response.text()` waits forever. Whatever has not arrived by the
   * cap is simply not used.
   */
  async settle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    // Sequential by nature: draining one batch can enqueue the next, because a
    // body read can still be in flight when the header read resolves.
    while (this.#pending.size > 0) {
      const left = deadline - Date.now();
      if (left <= 0) return;
      const batch = [...this.#pending];
      this.#pending.clear();
      // oxlint-disable-next-line no-await-in-loop
      await Promise.race([Promise.allSettled(batch), expire(left)]);
    }
  }

  #touch(url: string): void {
    // Analytics beacons fire on a timer forever; letting them count as activity
    // would mean network quiet never arrives.
    if (!isDeniedUrl(url)) this.#lastActivityAt = Date.now();
  }

  #onRequest(request: Request): void {
    const url = request.url();
    this.#touch(url);
    const kind = classifyMedia({ url });
    if (!kind) return;
    const hit = this.#record(url, kind, request.headers(), {
      frameUrl: safeFrameUrl(request),
    });
    if (hit) this.#enrichHeaders(request, hit);
  }

  #onResponse(response: Response): void {
    const url = response.url();
    this.#touch(url);
    const headers = response.headers();
    const contentType = headers["content-type"];
    // The file's size, not the response's: a 206 is one chunk of it (dl-78).
    const contentLength = responseFileSize(headers, response.status());
    const kind = classifyMedia({ url, contentType, contentLength });
    if (!kind) {
      this.#sniffBody(response, contentType, contentLength, headers["content-encoding"]);
      return;
    }

    const request = response.request();
    const hit = this.#record(url, kind, request.headers(), {
      ...(contentType === undefined ? {} : { contentType }),
      ...(contentLength === undefined ? {} : { contentLength }),
      status: response.status(),
      confirmed: true,
      frameUrl: safeFrameUrl(request),
    });
    if (!hit) return;
    this.#enrichHeaders(request, hit);
    if (kind === "hls" || kind === "dash") {
      this.#captureBody(response, hit, headers["content-encoding"]);
    }
  }

  #record(
    url: string,
    kind: MediaKindPatch,
    headers: Record<string, string>,
    patch: HitPatch,
  ): NetworkHit | undefined {
    const key = normaliseUrl(url);
    const existing = this.#hits.get(key);
    if (existing) {
      // A response refines what the request could only guess at.
      if (patch.confirmed) {
        // A file already confirmed whole stays whole (dl-78): a later response
        // for the same URL that reads small is a chunk of it, not a verdict.
        const keep = existing.confirmed && existing.kind === "progressive" && kind === "segment";
        existing.confirmed = true;
        if (!keep) existing.kind = kind;
      }
      if (patch.contentType !== undefined) existing.contentType = patch.contentType;
      if (patch.contentLength !== undefined) existing.contentLength = patch.contentLength;
      if (patch.status !== undefined) existing.status = patch.status;
      return existing;
    }
    if (this.#hits.size >= MAX_HITS) return undefined;

    const hit: NetworkHit = {
      url,
      key,
      kind,
      headers: { ...headers },
      seq: patch.seq ?? this.#seq++,
      confirmed: patch.confirmed ?? false,
      ...(patch.contentType === undefined ? {} : { contentType: patch.contentType }),
      ...(patch.contentLength === undefined ? {} : { contentLength: patch.contentLength }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.frameUrl === undefined ? {} : { frameUrl: patch.frameUrl }),
    };
    this.#hits.set(key, hit);
    return hit;
  }

  /**
   * `request.headers()` omits security-sensitive headers — including `Cookie`,
   * which the CDN will demand on replay. `allHeaders()` has them but is async.
   */
  #enrichHeaders(request: Request, hit: NetworkHit): void {
    this.#pending.add(
      (async () => {
        try {
          const all = await request.allHeaders();
          hit.headers = { ...hit.headers, ...all };
        } catch {
          // Context torn down mid-read: the sync headers we already have stand.
        }
      })(),
    );
  }

  /**
   * dl-79: a response the type and the path could not place may still be a
   * manifest, if it is small and says nothing about itself. The read joins
   * `#pending`, so `settle()` bounds it exactly as it bounds a typed manifest's
   * body — it never holds up network quiet, which `#touch` alone drives.
   */
  #sniffBody(
    response: Response,
    contentType: string | undefined,
    contentLength: number | undefined,
    contentEncoding: string | undefined,
  ): void {
    const url = response.url();
    const request = response.request();
    const sniffable = isSniffable({
      url,
      status: response.status(),
      resourceType: request.resourceType(),
      contentType,
      contentLength,
      contentEncoding,
    });
    if (!sniffable) return;
    const key = normaliseUrl(url);
    if (this.#sniffed.has(key) || this.#sniffed.size >= MAX_SNIFFS_PER_PROBE) return;
    // A compressed body is inflated by Chromium before it reaches us, so its
    // declared length bounds nothing; only the number of such reads is ours to cap.
    const encoded = isContentEncoded(contentEncoding);
    if (encoded && this.#encodedSniffs >= MAX_ENCODED_SNIFFS_PER_PROBE) return;
    this.#sniffed.add(key);
    if (encoded) this.#encodedSniffs += 1;
    // Reserved now, not when the read returns: a master that is read slowly
    // would otherwise be numbered after the variant playlists it names, and
    // rank below them.
    const seq = this.#seq++;

    this.#pending.add(
      (async () => {
        try {
          const body = await response.body();
          // The declared length was a promise, not a measurement.
          if (body.byteLength > MAX_SNIFF_BODY_BYTES) return;
          const sniffed = sniffManifestKind(body.subarray(0, SNIFF_HEAD_BYTES).toString("utf8"));
          if (!sniffed) return;
          const hit = this.#record(url, sniffed, request.headers(), {
            ...(contentType === undefined ? {} : { contentType }),
            ...(contentLength === undefined ? {} : { contentLength }),
            status: response.status(),
            confirmed: true,
            frameUrl: safeFrameUrl(request),
            seq,
          });
          if (!hit) return;
          this.#enrichHeaders(request, hit);
          this.#bodies.set(hit.key, body.toString("utf8"));
        } catch {
          // Body discarded, or the context went away mid-read: not a manifest we can use.
        }
      })(),
    );
  }

  #captureBody(response: Response, hit: NetworkHit, contentEncoding: string | undefined): void {
    if (hit.contentLength !== undefined && hit.contentLength > MAX_CAPTURED_BODY_BYTES) return;
    // A compressed body is inflated before we see it (dl-91), so only the number
    // of such reads is ours to cap. A url is charged once: a poll of the same
    // manifest must not spend the budget again, nor read a bomb twice.
    if (isContentEncoded(contentEncoding)) {
      if (this.#encodedCaptured.has(hit.key)) return;
      if (this.#encodedCaptured.size >= MAX_ENCODED_CAPTURES_PER_PROBE) return;
      this.#encodedCaptured.add(hit.key);
    }
    this.#pending.add(
      (async () => {
        try {
          const text = await response.text();
          if (text.length <= MAX_CAPTURED_BODY_BYTES) this.#bodies.set(hit.key, text);
        } catch {
          // Body already discarded or navigation raced us — we re-fetch instead.
        }
      })(),
    );
  }
}

/** Local alias so `#record` reads well without importing the union twice. */
type MediaKindPatch = NetworkHit["kind"];

/** Explicitly `| undefined` so callers can pass an unknown frame URL through. */
interface HitPatch {
  contentType?: string | undefined;
  contentLength?: number | undefined;
  status?: number | undefined;
  confirmed?: boolean | undefined;
  frameUrl?: string | undefined;
  /** Arrival order already taken by the caller, when recording happens later (dl-79). */
  seq?: number | undefined;
}

/** Resolves after `ms`, without holding the event loop open on its own. */
async function expire(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

function safeFrameUrl(request: Request): string | undefined {
  try {
    return request.frame().url();
  } catch {
    return undefined;
  }
}
