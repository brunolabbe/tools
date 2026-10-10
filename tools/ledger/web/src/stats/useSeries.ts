import { useEffect, useState } from "react";
import { AppError } from "@ledger/contract";
import type { StatsRange } from "@ledger/contract";
import type { SeriesFetch } from "../api/stats.ts";

export type Series<T> =
  | { state: "loading" }
  | { state: "failed"; message: string }
  /** `stale`: this is the previous range's answer, held while the new one loads. */
  | { state: "ready"; data: T; stale: boolean };

/**
 * One series over one range. While the next range loads, the previous answer is
 * kept and marked stale, so a chart dims instead of vanishing and the page does
 * not jump; the first load, and a failure with nothing to hold, are their own
 * states. A request superseded by a newer range is cancelled and never lands.
 */
export function useSeries<T>(fetcher: SeriesFetch<T>, range: StatsRange): Series<T> {
  const [held, setHeld] = useState<{ data: T } | null>(null);
  const [settled, setSettled] = useState<{ range: StatsRange; failure: string | null } | null>(
    null,
  );
  const { from, to } = range;

  useEffect(() => {
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        const data = await fetcher({ from, to }, controller.signal);
        setHeld({ data });
        setSettled({ range: { from, to }, failure: null });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setSettled({ range: { from, to }, failure: AppError.from(error).message });
      }
    })();
    return () => controller.abort();
  }, [fetcher, from, to]);

  const answered = settled !== null && settled.range.from === from && settled.range.to === to;
  if (answered && settled.failure !== null) {
    return { state: "failed", message: settled.failure };
  }
  if (held === null) return { state: "loading" };
  return { state: "ready", data: held.data, stale: !answered };
}
