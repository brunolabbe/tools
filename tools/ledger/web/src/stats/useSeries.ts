import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AppError } from "@ledger/contract";
import type { StatsRange } from "@ledger/contract";
import type { SeriesFetch } from "../api/stats.ts";
import { seriesQuery } from "../queries.ts";

export type Series<T> =
  | { state: "loading" }
  | { state: "failed"; message: string }
  /**
   * `stale`: this is the previous range's answer, held while the new one loads.
   * `failure`: a read again over this same range failed, and `data` is the answer
   * from before it.
   */
  | { state: "ready"; data: T; stale: boolean; failure: string | null };

/**
 * One series over one range, from the cache (lg-98). While the next range loads,
 * the previous answer is kept and marked stale, so a chart dims instead of
 * vanishing and the page does not jump; the first load, and a failure with
 * nothing to hold, are their own states. A request superseded by a newer range is
 * cancelled and never lands. A write beneath a chart marks its series stale
 * (`writes.ts`), and a read again that fails keeps this range's answer on screen
 * with the failure beside it, so what is open under a chart is not unmounted by
 * one bad read (lg-18 F5). Only a read the held answer predates: any other
 * failure fails the card, as a card that never reloads has no way to say its
 * figures are old.
 */
export function useSeries<T>(
  /** The route `fetcher` reads, which keys its answers in the cache. */
  route: string,
  fetcher: SeriesFetch<T>,
  range: StatsRange,
): Series<T> {
  const read = useQuery({
    ...seriesQuery(route, fetcher, range),
    placeholderData: keepPreviousData,
  });
  if (read.data === undefined) {
    return read.error === null
      ? { state: "loading" }
      : { state: "failed", message: AppError.from(read.error).message };
  }
  return {
    state: "ready",
    data: read.data,
    stale: read.isPlaceholderData,
    failure: read.error === null ? null : AppError.from(read.error).message,
  };
}
