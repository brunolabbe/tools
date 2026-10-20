/**
 * Which of the mortgage's screens still stand (lg-55). The household says its
 * mortgage is live, ended on a day, or none (`GET /api/mortgage`); the API adds
 * the **close** — the later of the end date and the last joint payment out of
 * the bucket — and whether anything is left in the bucket. These are the
 * rules the stats and home screens follow, and nothing here does arithmetic: the
 * figures are the API's.
 *
 * A mortgage that could not be read is treated as live, so every screen is
 * what it was before the household could say anything; the cards beneath say
 * for themselves when the API is not answering.
 */

import { useEffect, useState } from "react";
import type { MortgageResponse, StatsRange } from "@ledger/contract";
import { fetchMortgage } from "./api/mortgage.ts";

export type MortgageLoad =
  | { state: "loading" }
  | { state: "ready"; mortgage: MortgageResponse | null };

/**
 * The mortgage as the household has said it, read once when a screen opens: the form
 * that changes it is on another tab. A failed read leaves `mortgage` null.
 */
export function useMortgage(): MortgageLoad {
  const [load, setLoad] = useState<MortgageLoad>({ state: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetchMortgage(controller.signal)
      .then((mortgage) => setLoad({ state: "ready", mortgage }))
      .catch(() => {
        if (controller.signal.aborted) return;
        // Not a state of its own: the screens read as they always did.
        setLoad({ state: "ready", mortgage: null });
      });
    return () => controller.abort();
  }, []);
  return load;
}

/** The range lies wholly after the close: it starts on a later day. */
function afterClose(range: StatsRange, closedOn: string): boolean {
  return range.from !== null && range.from > closedOn;
}

/** The range ends before the close, so the mortgage is still running throughout it. */
function beforeClose(range: StatsRange, closedOn: string): boolean {
  return range.to !== null && range.to < closedOn;
}

/** The range holds the close day, so a line that ends there ends inside it. */
export function spansClose(range: StatsRange, closedOn: string): boolean {
  return !afterClose(range, closedOn) && !beforeClose(range, closedOn);
}

/** Whether the Mortgage payment card is drawn over `range`. */
export function showsPaymentCard(mortgage: MortgageResponse | null, range: StatsRange): boolean {
  if (mortgage === null || mortgage.state === "live") return true;
  if (mortgage.state === "none") return false;
  return mortgage.closedOn === null || !afterClose(range, mortgage.closedOn);
}

/**
 * Whether the Own money card is drawn over `range`: while anything is left in the
 * bucket it stays, and once it is empty a range wholly after the close has
 * nothing to say.
 */
export function showsOwnCard(mortgage: MortgageResponse | null, range: StatsRange): boolean {
  if (mortgage === null || mortgage.state === "live") return true;
  if (mortgage.state === "none") return false;
  if (mortgage.left) return true;
  return mortgage.closedOn === null || !afterClose(range, mortgage.closedOn);
}

/** Whether the mortgage section on the home screen is drawn. */
export function showsHomeSection(mortgage: MortgageResponse | null): boolean {
  if (mortgage === null || mortgage.state === "live") return true;
  if (mortgage.state === "none") return false;
  return mortgage.left;
}

/** Whether the close, and so what is left, is something the range reaches. */
export function reachesClose(mortgage: MortgageResponse, range: StatsRange): boolean {
  return (
    mortgage.state === "ended" &&
    mortgage.closedOn !== null &&
    !beforeClose(range, mortgage.closedOn)
  );
}
