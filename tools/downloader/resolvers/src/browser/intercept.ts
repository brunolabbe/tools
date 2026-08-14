/**
 * Network capture.
 *
 * Listeners are attached to the BrowserContext rather than the Page so that
 * iframes, popups and any page opened during the probe are covered by the same
 * collector — embedded players are extremely common and each one is a frame.
 */

import type { BrowserContext, Request, Response } from "playwright";
import { classifyMedia, isDeniedUrl, normaliseUrl } from "./media-match.ts";
import type { NetworkHit } from "./types.ts";

/** Manifests are small; anything larger than this is not a playlist worth keeping. */
const MAX_CAPTURED_BODY_BYTES = 4 * 1024 * 1024;

/** A page that fires thousands of media requests is not worth unbounded memory. */
const MAX_HITS = 400;

export class HitCollector {
  readonly #hits = new Map<string, NetworkHit>();
  readonly #bodies = new Map<string, string>();
  readonly #pending = new Set<Promise<unknown>>();
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

  /** Insertion-ordered, so `seq` and array order agree. */
  get hits(): NetworkHit[] {
    return [...this.#hits.values()];
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
    const parsedLength = Number(headers["content-length"]);
    const contentLength =
      Number.isFinite(parsedLength) && parsedLength >= 0 ? parsedLength : undefined;
    const kind = classifyMedia({ url, contentType, contentLength });
    if (!kind) return;

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
    if (kind === "hls" || kind === "dash") this.#captureBody(response, hit);
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
        existing.confirmed = true;
        existing.kind = kind;
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
      seq: this.#seq++,
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

  #captureBody(response: Response, hit: NetworkHit): void {
    if (hit.contentLength !== undefined && hit.contentLength > MAX_CAPTURED_BODY_BYTES) return;
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
