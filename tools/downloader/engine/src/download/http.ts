/**
 * HTTP fetching with the captured `RequestContext` replayed.
 *
 * Every request that leaves the engine goes through here, because "replay the
 * context on the manifest but not the segments" is the single most common way
 * this pipeline fails — the segments are gated too, and a missing `Referer`
 * produces a 403 that looks like anything but a missing `Referer`.
 *
 * Status classification is the other reason this is centralised. `404`/`410`
 * mid-download means the signed URL died, which is `VARIANT_GONE` and tells the
 * orchestrator to re-probe. Reporting it as `DOWNLOAD_FAILED` sends it down a
 * retry path that will fail identically five more times.
 */

import { AppError, redactUrl } from "@downloader/contract";
import type { RequestContext } from "@downloader/contract";
import type { FetchLike } from "../config.ts";
import { buildFetchHeaders } from "../ffmpeg/headers.ts";
import { parseRetryAfter } from "./retry.ts";

export interface HttpRequestOptions {
  url: string;
  requestContext?: RequestContext | undefined;
  /** Merged over the replayed context — this is where `Range` comes from. */
  extraHeaders?: Record<string, string> | undefined;
  method?: "GET" | "HEAD";
  signal?: AbortSignal | undefined;
  fetchImpl?: FetchLike | undefined;
}

/**
 * Maps a response status onto the error taxonomy.
 *
 * `403` joins `404`/`410` under `VARIANT_GONE`: per analysis §5 signed media
 * URLs are short-lived and frequently IP-bound, so a 403 on a URL a resolver
 * just handed us overwhelmingly means "expired", and the correct response is
 * re-probe rather than retry-in-place. Both codes are retryable, so the
 * orchestrator gets its chance either way.
 */
export function classifyHttpStatus(
  status: number,
  headers: Headers,
  url: string,
  nowMs: number = Date.now(),
): AppError {
  const details: Record<string, unknown> = { status, url: redactUrl(url) };

  const retryAfterMs = parseRetryAfter(headers.get("retry-after"), nowMs);
  if (retryAfterMs !== null) details["retryAfterMs"] = retryAfterMs;

  if (status === 401) {
    return new AppError("AUTH_REQUIRED", undefined, { details });
  }
  if (status === 403 || status === 404 || status === 410) {
    return new AppError("VARIANT_GONE", undefined, { details });
  }
  if (status === 429) {
    return new AppError("RATE_LIMITED", undefined, { details, retryable: true });
  }
  if (status >= 500) {
    return new AppError("DOWNLOAD_FAILED", undefined, { details, retryable: true });
  }
  // Any other 4xx is a request we got wrong; repeating it verbatim will not help.
  return new AppError("DOWNLOAD_FAILED", undefined, { details, retryable: false });
}

/** Wraps a transport-level failure. Retryable — DNS and TCP both flap. */
export function classifyFetchError(error: unknown, url: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new AppError("JOB_CANCELED");
  }
  return new AppError("UNREACHABLE", undefined, {
    cause: error,
    details: {
      url: redactUrl(url),
      reason: error instanceof Error ? error.message : String(error),
    },
  });
}

/**
 * Performs one request. Non-2xx becomes a typed `AppError`; the caller decides
 * whether to retry. `206` and `416` reach the caller as successes because the
 * resumable downloader has to interpret them itself.
 */
export async function httpRequest(options: HttpRequestOptions): Promise<Response> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const headers = { ...buildFetchHeaders(options.requestContext), ...options.extraHeaders };

  let response: Response;
  try {
    response = await doFetch(options.url, {
      method: options.method ?? "GET",
      headers,
      redirect: "follow",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error: unknown) {
    throw classifyFetchError(error, options.url);
  }

  // 416 means our resume offset is past the end; the caller reconciles that.
  if (!response.ok && response.status !== 416) {
    // Drain so the connection can be reused rather than left half-read.
    await response.body?.cancel().catch(() => undefined);
    throw classifyHttpStatus(response.status, response.headers, options.url);
  }

  return response;
}

/** `Content-Range: bytes 100-199/1234` → 1234. Null for `*` or a malformed value. */
export function parseContentRangeTotal(header: string | null): number | null {
  if (header === null) return null;
  const match = /^\s*bytes\s+(?:\d+-\d+|\*)\/(\d+|\*)\s*$/iu.exec(header);
  const total = match?.[1];
  if (total === undefined || total === "*") return null;
  const value = Number(total);
  return Number.isFinite(value) ? value : null;
}

export function parseContentLength(header: string | null): number | null {
  if (header === null) return null;
  const value = Number(header.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}
