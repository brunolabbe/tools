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

import type { RangedBytes } from "./size-sample.ts";

/** Headers a caller has already built: the `RequestContext` replay, verbatim. */
export interface FetchSizeProbeOptions {
  fetch: typeof globalThis.fetch;
  headers: Record<string, string>;
  signal?: AbortSignal | undefined;
  /** Per-request, not for the whole sample. Kept short: this is the probe path. */
  timeoutMs?: number;
  /** A playlist larger than this is not one we should be reading. */
  maxTextBytes?: number;
  /**
   * The most one `bytes()` call will ask for or keep. A request above it is
   * refused before anything is sent, and a body from a server that ignores
   * `Range` is read no further than this — a whole-file answer to a header read
   * is gigabytes.
   */
  maxRangeBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_TEXT_BYTES = 4 * 1024 * 1024;
/** One MP4 `moov` at `mp4-header.ts`'s own cap; nothing else asks for a range. */
const DEFAULT_MAX_RANGE_BYTES = 16 * 1024 * 1024;

/** `bytes 0-0/12345` → `12345`. The only trustworthy total on a 206. */
export function totalFromContentRange(value: string | null): number | undefined {
  if (value === null) return undefined;
  const slash = value.lastIndexOf("/");
  if (slash < 0) return undefined;
  const total = Number(value.slice(slash + 1).trim());
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/** `bytes 40-99/1234` → `40`, or `undefined` for anything not shaped like that. */
function rangeStartOf(value: string | null): number | undefined {
  if (value === null) return undefined;
  const start = /^\s*bytes\s+(\d+)-\d+\/(?:\d+|\*)\s*$/iu.exec(value)?.[1];
  return start === undefined ? undefined : Number(start);
}

/**
 * Reads at most `limit` bytes of a body and abandons the rest.
 *
 * `response.arrayBuffer()` would read whatever the server chose to send, and a
 * server that ignores `Range` sends the whole file.
 */
async function readAtMost(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array(0);
  const out = new Uint8Array(limit);
  const reader = body.getReader();
  let filled = 0;
  try {
    while (filled < limit) {
      // oxlint-disable-next-line no-await-in-loop -- a stream is read in order
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, limit - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.subarray(0, filled);
}

export function createFetchSizeProbe(options: FetchSizeProbeOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTextBytes = options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;
  const maxRangeBytes = options.maxRangeBytes ?? DEFAULT_MAX_RANGE_BYTES;

  function signalFor(): AbortSignal {
    const deadline = AbortSignal.timeout(timeoutMs);
    return options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
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
        if (!ranged.ok) return undefined;
        // On a 206 the Content-Length is the length of the *range*. Only
        // Content-Range names the resource.
        return totalFromContentRange(ranged.headers.get("content-range"));
      } catch {
        return undefined;
      }
    },

    /**
     * Bytes `start` to `endInclusive` of a resource, through the same fetch,
     * headers and per-request timeout as everything else here (dl-64).
     *
     * A short answer is returned short rather than refused — the file may end
     * inside the range — and the caller checks the length it needs.
     */
    async bytes(
      url: string,
      start: number,
      endInclusive: number,
    ): Promise<RangedBytes | undefined> {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(endInclusive) ||
        start < 0 ||
        endInclusive < start
      ) {
        return undefined;
      }
      const wanted = endInclusive - start + 1;
      if (wanted > maxRangeBytes) return undefined;
      try {
        const response = await options.fetch(url, {
          method: "GET",
          headers: { ...options.headers, Range: `bytes=${String(start)}-${String(endInclusive)}` },
          signal: signalFor(),
          redirect: "follow",
        });

        let totalBytes: number | undefined;
        if (response.status === 206) {
          // A 206 for some other range is bytes from somewhere else in the file,
          // and a box header read at the wrong offset is a wrong answer.
          const contentRange = response.headers.get("content-range");
          if (rangeStartOf(contentRange) !== start) {
            await response.body?.cancel();
            return undefined;
          }
          totalBytes = totalFromContentRange(contentRange);
        } else if (response.status === 200 && start === 0) {
          // The server ignored `Range` and is sending the whole file. From byte
          // zero that is still the prefix we asked for, provided we stop reading.
          const length = Number(response.headers.get("content-length"));
          totalBytes = Number.isFinite(length) && length > 0 ? length : undefined;
        } else {
          // Including a 200 for a range that does not start at zero: that body
          // is the file from its first byte, not from `start`.
          await response.body?.cancel();
          return undefined;
        }

        return { bytes: await readAtMost(response.body, wanted), totalBytes };
      } catch {
        return undefined;
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
          return undefined;
        }
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxTextBytes) {
          await response.body?.cancel();
          return undefined;
        }
        const body = await response.text();
        return body.length > maxTextBytes ? undefined : body;
      } catch {
        return undefined;
      }
    },
  };
}
