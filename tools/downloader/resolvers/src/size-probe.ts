/**
 * A `SizeProbe` over an ordinary `fetch`, for the resolvers whose network is
 * one — the direct tier's `GuardedFetch`, and the same guarded fetch handed to
 * the yt-dlp tier for this. The browser tier builds its own over Playwright's
 * request context instead, because its cookies live there.
 *
 * Everything here answers `undefined` rather than throwing. A size we could not
 * measure leaves the declared estimate in place, which is where we started; a
 * probe that fails the whole resolve because a CDN would not answer a HEAD is a
 * regression, and it would be one on the *common* path — dl-30's sampling runs
 * on every manifest probe.
 */

import { redactUrl } from "@downloader/contract";

/** Headers a caller has already built: the `RequestContext` replay, verbatim. */
export interface FetchSizeProbeOptions {
  fetch: typeof globalThis.fetch;
  headers: Record<string, string>;
  signal?: AbortSignal | undefined;
  /** Per-request, not for the whole sample. Kept short: this is the probe path. */
  timeoutMs?: number;
  /** A playlist larger than this is not one we should be reading. */
  maxTextBytes?: number;
  /** Called with an already-redacted URL. Nothing here logs on its own. */
  onSkip?: (reason: string, url: string) => void;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_TEXT_BYTES = 4 * 1024 * 1024;

/** `bytes 0-0/12345` → `12345`. The only trustworthy total on a 206. */
export function totalFromContentRange(value: string | null): number | undefined {
  if (value === null) return undefined;
  const slash = value.lastIndexOf("/");
  if (slash < 0) return undefined;
  const total = Number(value.slice(slash + 1).trim());
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

export function createFetchSizeProbe(options: FetchSizeProbeOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTextBytes = options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;

  function signalFor(): AbortSignal {
    const deadline = AbortSignal.timeout(timeoutMs);
    return options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
  }

  function skip(reason: string, url: string): undefined {
    options.onSkip?.(reason, redactUrl(url));
    return undefined;
  }

  return {
    async contentLength(url: string): Promise<number | undefined> {
      try {
        const head = await options.fetch(url, {
          method: "HEAD",
          headers: options.headers,
          signal: signalFor(),
          redirect: "follow",
        });
        await head.body?.cancel();
        if (head.ok) {
          const length = Number(head.headers.get("content-length"));
          if (Number.isFinite(length) && length > 0) return length;
        }

        // The same servers that reject a HEAD outright answer a one-byte ranged
        // GET, which `direct.ts` already relies on to read a Content-Type.
        const ranged = await options.fetch(url, {
          method: "GET",
          headers: { ...options.headers, Range: "bytes=0-0" },
          signal: signalFor(),
          redirect: "follow",
        });
        await ranged.body?.cancel();
        if (!ranged.ok) return skip(`status ${ranged.status}`, url);
        // On a 206 the Content-Length is the length of the *range*. Only
        // Content-Range names the resource.
        return (
          totalFromContentRange(ranged.headers.get("content-range")) ??
          skip("no content-range", url)
        );
      } catch (cause) {
        return skip(cause instanceof Error ? cause.name : "failed", url);
      }
    },

    async text(url: string): Promise<string | undefined> {
      try {
        const response = await options.fetch(url, {
          method: "GET",
          headers: options.headers,
          signal: signalFor(),
          redirect: "follow",
        });
        if (!response.ok) {
          await response.body?.cancel();
          return skip(`status ${response.status}`, url);
        }
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxTextBytes) {
          await response.body?.cancel();
          return skip("too large", url);
        }
        const body = await response.text();
        return body.length > maxTextBytes ? skip("too large", url) : body;
      } catch (cause) {
        return skip(cause instanceof Error ? cause.name : "failed", url);
      }
    },
  };
}
