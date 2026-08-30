/**
 * A `SizeProbe` over the browser's own request context.
 *
 * Separate from the `fetch`-backed one in `../size-probe.ts` for the reason
 * `#loadManifest` uses `context.request` in the first place: the session cookies
 * that gate a segment live in that context and not in this process.
 *
 * It is typed against `ApiRequestLike` rather than Playwright's
 * `APIRequestContext` on purpose. The two are structurally identical for the
 * three calls used here, and the narrower type is what lets the suite drive
 * this with a stub — without it the only way to observe the browser tier's
 * probe would be to launch a browser, which is why it went untested when it
 * lived inline in `browser.ts` (dl-30 gate 1, finding B).
 */

import { budget } from "./abort.ts";
import type { SizeProbe } from "../size-sample.ts";
import { totalFromContentRange } from "../size-probe.ts";

/** What Playwright's `APIResponse` gives us, and all we ask of it. */
export interface ApiResponseLike {
  ok(): boolean;
  headers(): Record<string, string>;
  text(): Promise<string>;
}

export interface ApiRequestOptions {
  headers: Record<string, string>;
  timeout: number;
  failOnStatusCode: boolean;
}

/** The `APIRequestContext` surface this file uses, and nothing more. */
export interface ApiRequestLike {
  head(url: string, options: ApiRequestOptions): Promise<ApiResponseLike>;
  get(url: string, options: ApiRequestOptions): Promise<ApiResponseLike>;
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
  request: ApiRequestLike,
  headers: Record<string, string>,
  deadline: number,
): SizeProbe {
  return {
    async contentLength(url: string): Promise<number | undefined> {
      const timeout = budget(deadline, LENGTH_BUDGET_MS);
      if (timeout <= MIN_USEFUL_BUDGET_MS) return undefined;
      try {
        const head = await request.head(url, { headers, timeout, failOnStatusCode: false });
        if (head.ok()) {
          const length = Number(head.headers()["content-length"]);
          if (Number.isFinite(length) && length > 0) return length;
        }

        // The servers that reject a HEAD outright answer a one-byte ranged GET,
        // which `direct.ts` already relies on to read a Content-Type.
        const ranged = await request.get(url, {
          headers: { ...headers, Range: "bytes=0-0" },
          timeout,
          failOnStatusCode: false,
        });
        if (!ranged.ok()) return undefined;
        // A 206's Content-Length describes the range, not the resource.
        return totalFromContentRange(ranged.headers()["content-range"] ?? null);
      } catch {
        return undefined;
      }
    },

    async text(url: string): Promise<string | undefined> {
      const timeout = budget(deadline, TEXT_BUDGET_MS);
      if (timeout <= MIN_USEFUL_BUDGET_MS) return undefined;
      try {
        const response = await request.get(url, { headers, timeout, failOnStatusCode: false });
        return response.ok() ? await response.text() : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
