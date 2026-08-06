/**
 * Bounded-concurrency map.
 *
 * Segment fetching without a bound opens one socket per segment — a few hundred
 * for a normal VOD playlist — which most origins answer with 429 and some
 * answer with a ban. The bound is the whole point; results stay in input order
 * so the caller can concatenate them.
 */

import { AppError } from "@downloader/shared";

export interface PoolOptions {
  concurrency: number;
  signal?: AbortSignal | undefined;
  /** Called after each item settles, for progress reporting. */
  onSettled?: ((done: number, total: number) => void) | undefined;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: PoolOptions,
): Promise<R[]> {
  const total = items.length;
  const results = Array.from<R>({ length: total });
  if (total === 0) return results;

  const limit = Math.max(1, Math.floor(options.concurrency));
  let next = 0;
  let done = 0;
  let failure: unknown;

  const runOne = async (): Promise<void> => {
    for (;;) {
      // Re-read each iteration: a sibling worker may have failed since the last.
      if (failure !== undefined) return;
      if (options.signal?.aborted === true) throw new AppError("JOB_CANCELED");
      const index = next;
      next += 1;
      if (index >= total) return;

      const item = items[index] as T;
      results[index] = await worker(item, index);
      done += 1;
      options.onSettled?.(done, total);
    }
  };

  const workers = Array.from({ length: Math.min(limit, total) }, async () => {
    try {
      await runOne();
    } catch (error: unknown) {
      // First failure wins and stops the others from starting new work.
      failure ??= error;
    }
  });

  await Promise.all(workers);
  if (failure !== undefined) throw AppError.from(failure);
  return results;
}
