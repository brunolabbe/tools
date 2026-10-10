/**
 * A `SizeProbe` over the browser tier's own HTTP client.
 *
 * Separate from the `fetch`-backed one in `../size-probe.ts` because the session
 * cookies that gate a segment live in the browser context and not in this
 * process, and because the tier's egress proxy may terminate TLS under a root
 * only the tier is handed.
 *
 * It used to weigh renditions with Playwright's `context.request`, which has two
 * defects the manifest re-fetch had until dl-97 (and this file, until dl-101):
 * it returns only once the whole body is in **and inflated** (a 255 KB gzip
 * playlist inflating to 256 MiB held 772 MB), and it verifies TLS with Node's own
 * store, so behind the terminating proxy every HTTPS probe failed its handshake
 * and every variant kept its declared size. So the two calls it made are now the
 * client in `./manifest-fetch.ts`:
 *
 * - `HEAD`, and the one-byte ranged `GET`, ask for **headers only**. The response
 *   is closed as soon as they are in, so a server that ignores `Range` and answers
 *   the "one-byte" read with the whole segment is never read.
 * - a playlist's `text()` is read as a stream, inflated as a stream, and refused
 *   once it passes the cap.
 *
 * It is typed against {@link SizeRequestLike} rather than against that client, on
 * purpose: the suite drives this with a stub, which is how the call shape is
 * checked without a server (dl-30 gate 1, finding B).
 */

import { budget } from "./abort.ts";
import { fetchHeaders, fetchManifest } from "./manifest-fetch.ts";
import type {
  HeadersFetchResult,
  ManifestFetchOptions,
  ManifestFetchResult,
} from "./manifest-fetch.ts";
import type { SizeProbe } from "../size-sample.ts";
import { totalFromContentRange } from "../size-probe.ts";

/** Inflated bytes past which a media playlist is not one worth reading. */
export const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;

export interface HeadersRequest {
  method: "HEAD" | "GET";
  headers: Record<string, string>;
  /** For the whole call, redirects included. */
  timeoutMs: number;
}

export interface BodyRequest {
  headers: Record<string, string>;
  timeoutMs: number;
  /** Inflated bytes past which the body is refused. */
  maxBodyBytes: number;
}

/** The two requests this file makes, and nothing more. */
export interface SizeRequestLike {
  /** The final response's headers, its body unread. */
  headers(url: string, request: HeadersRequest): Promise<HeadersFetchResult>;
  /** The final response's body, capped. */
  body(url: string, request: BodyRequest): Promise<ManifestFetchResult>;
}

/** What the client needs that is not per request: the proxy, the jar, the trust. */
export type SizeClientOptions = Omit<
  ManifestFetchOptions,
  "headers" | "maxBodyBytes" | "timeoutMs"
>;

/** {@link SizeRequestLike} over the real client. */
export function createSizeRequest(client: SizeClientOptions): SizeRequestLike {
  return {
    headers: async (url, request) =>
      await fetchHeaders(url, {
        ...client,
        method: request.method,
        headers: request.headers,
        timeoutMs: request.timeoutMs,
      }),
    body: async (url, request) =>
      await fetchManifest(url, {
        ...client,
        headers: request.headers,
        timeoutMs: request.timeoutMs,
        maxBodyBytes: request.maxBodyBytes,
      }),
  };
}

/** Below this there is not enough of the caller's deadline left to be worth spending. */
const MIN_USEFUL_BUDGET_MS = 500;
const LENGTH_BUDGET_MS = 4000;
const TEXT_BUDGET_MS = 8000;

/**
 * Answers `undefined` on every failure. A sample is an improvement on a
 * declared size, never a precondition for returning one.
 */
export function createRequestSizeProbe(
  request: SizeRequestLike,
  headers: Record<string, string>,
  deadline: number,
): SizeProbe {
  return {
    async contentLength(url: string): Promise<number | undefined> {
      const timeoutMs = budget(deadline, LENGTH_BUDGET_MS);
      if (timeoutMs <= MIN_USEFUL_BUDGET_MS) return undefined;
      try {
        const head = await request.headers(url, { method: "HEAD", headers, timeoutMs });
        if (head.outcome === "headers") {
          const length = Number(head.headers["content-length"]);
          if (Number.isFinite(length) && length > 0) return length;
        }

        // The servers that reject a HEAD outright answer a one-byte ranged GET,
        // which `direct.ts` already relies on to read a Content-Type. Only its
        // headers are read: one that ignores the Range sends the whole file.
        const ranged = await request.headers(url, {
          method: "GET",
          headers: { ...headers, Range: "bytes=0-0" },
          timeoutMs,
        });
        if (ranged.outcome !== "headers") return undefined;
        // A 206's Content-Length describes the range, not the resource.
        return totalFromContentRange(ranged.headers["content-range"] ?? null);
      } catch {
        return undefined;
      }
    },

    async text(url: string): Promise<string | undefined> {
      const timeoutMs = budget(deadline, TEXT_BUDGET_MS);
      if (timeoutMs <= MIN_USEFUL_BUDGET_MS) return undefined;
      try {
        const response = await request.body(url, {
          headers,
          timeoutMs,
          maxBodyBytes: MAX_PLAYLIST_BYTES,
        });
        return response.outcome === "ok" ? response.text : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
