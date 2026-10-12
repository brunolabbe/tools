import { useEffect, useState } from "react";
import { AppError } from "@ledger/contract";
import type { StatsRange } from "@ledger/contract";
import type { SeriesFetch } from "../api/stats.ts";

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
 * One series over one range. While the next range loads, the previous answer is
 * kept and marked stale, so a chart dims instead of vanishing and the page does
 * not jump; the first load, and a failure with nothing to hold, are their own
 * states. A request superseded by a newer range is cancelled and never lands.
 * A failed `reload` keeps this range's answer on screen with the failure beside
 * it, so what is open under a chart is not unmounted by one bad read (lg-18 F5).
 */
export function useSeries<T>(
  fetcher: SeriesFetch<T>,
  range: StatsRange,
  /** Changing it reads the series again over the same range, after a write beneath it. */
  reload = 0,
): Series<T> {
  const [held, setHeld] = useState<{ range: StatsRange; data: T } | null>(null);
  const [settled, setSettled] = useState<{ range: StatsRange; failure: string | null } | null>(
    null,
  );
  const { from, to } = range;

  useEffect(() => {
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        const data = await fetcher({ from, to }, controller.signal);
        setHeld({ range: { from, to }, data });
        setSettled({ range: { from, to }, failure: null });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setSettled({ range: { from, to }, failure: AppError.from(error).message });
      }
    })();
    return () => controller.abort();
  }, [fetcher, from, to, reload]);

  const answered = settled !== null && settled.range.from === from && settled.range.to === to;
  const heldHere = held !== null && held.range.from === from && held.range.to === to;
  if (answered && settled.failure !== null) {
    if (held !== null && heldHere) {
      return { state: "ready", data: held.data, stale: false, failure: settled.failure };
    }
    return { state: "failed", message: settled.failure };
  }
  if (held === null) return { state: "loading" };
  return { state: "ready", data: held.data, stale: !answered, failure: null };
}
