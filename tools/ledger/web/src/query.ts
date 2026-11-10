/**
 * The one cache every screen reads through (lg-98).
 *
 * The ledger is behind Cloudflare's rate limiting rule on `/api/`, 20 requests
 * per 10 seconds per address and shared with every tool in the zone (lg-97). A
 * screen that asked for its data afresh every time it opened, and a shell that
 * asked again for the inbox count and the names on every tab, spent that budget
 * in a few taps. So:
 *
 * - **`staleTime` is 30 s.** Two people keep these books, and a change the other
 *   person made shows within that window; a tab opened again inside it asks
 *   for nothing. A write of this person's own marks what it changed stale at
 *   once (`writes.ts`), so their own change never waits on the window.
 * - **No refetch on window focus, or on reconnect.** A phone switching apps
 *   would otherwise ask for every screen's data again each time it came back.
 * - **A `RATE_LIMITED` read is tried once more**, after the wait the refusal
 *   names (`details.retryAfterSec`, lg-92 and lg-97), capped at 15 s. Nothing
 *   else is retried, `UNREACHABLE` and `TIMEOUT` included, though the taxonomy
 *   calls them retryable: a screen says what went wrong at once, as it did
 *   before the cache, and a retry would spend the budget the cache saves.
 */

import { QueryClient } from "@tanstack/react-query";
import { AppError } from "@ledger/contract";

/** How long an answer is fresh: a tab opened again within it asks for nothing. */
export const STALE_MS = 30_000;

/** The longest a rate-limited read waits before its one retry. */
export const RATE_LIMIT_WAIT_MAX_SEC = 15;

/** The wait when the refusal names none: the edge rule's own window. */
export const RATE_LIMIT_WAIT_DEFAULT_SEC = 10;

/** Whether a failed read is tried again: a `RATE_LIMITED` one, once. */
export function retryRead(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && error instanceof AppError && error.code === "RATE_LIMITED";
}

/** How long before that retry, in milliseconds: the refusal's own wait, capped. */
export function retryReadDelay(_failureCount: number, error: unknown): number {
  const sec = error instanceof AppError ? error.details?.["retryAfterSec"] : undefined;
  const wait =
    typeof sec === "number" && Number.isFinite(sec) && sec > 0
      ? Math.min(sec, RATE_LIMIT_WAIT_MAX_SEC)
      : RATE_LIMIT_WAIT_DEFAULT_SEC;
  return wait * 1_000;
}

/** The client the app runs on, with the defaults above. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: retryRead,
        retryDelay: retryReadDelay,
      },
      // A write is never sent twice on its own: it appends, and a second copy is a second record.
      mutations: { retry: false },
    },
  });
}
