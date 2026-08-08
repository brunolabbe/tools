/**
 * Abort plumbing shared by the pool, the provocation loop and the quiet wait.
 */

import type { AppError } from "@downloader/shared";
import { toAbortError as classifyAbort } from "../abort.ts";

/** Package-wide mapping, with the copy this resolver wants for a timeout. */
export function toAbortError(signal: AbortSignal): AppError {
  return classifyAbort(signal, "The page analysis was stopped before it finished.");
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw toAbortError(signal);
}

/** Sleep that wakes early on abort instead of holding the probe open. */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(toAbortError(signal as AbortSignal));
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Hard wall-clock cap on a piece of browser work.
 *
 * Several Playwright calls have no timeout of their own — `response.text()` on a
 * body the page fetched and then abandoned never settles, for instance — and one
 * of those is enough to pin a concurrency slot until the process dies.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => AppError,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            reject(onTimeout());
          },
          Math.max(0, ms),
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Milliseconds left before `deadline`, never negative. */
export function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

/** Budget for a single step: what is left, capped so one step cannot eat it all. */
export function budget(deadline: number, cap: number): number {
  return Math.min(cap, remaining(deadline));
}
