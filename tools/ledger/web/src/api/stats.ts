/** The history's series (lg-9): one read per chart, each over a date range. */

import { ROUTES } from "@ledger/contract";
import type {
  BufferStatsResponse,
  ContributionsResponse,
  FixedItemsResponse,
  MortgageOwnResponse,
  MortgagePaymentsResponse,
  SalariesStatsResponse,
  SettlementsStatsResponse,
  SpendingStatsResponse,
  StatsRange,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

/** `?from=&to=` for whichever ends are set; nothing at all for the whole history. */
function withRange(route: string, range: StatsRange): string {
  const query = new URLSearchParams();
  if (range.from !== null) query.set("from", range.from);
  if (range.to !== null) query.set("to", range.to);
  const text = query.toString();
  return text === "" ? route : `${route}?${text}`;
}

export type SeriesFetch<T> = (range: StatsRange, signal?: AbortSignal) => Promise<T>;

function series<T>(route: string): SeriesFetch<T> {
  return async (range, signal) => await requestJson<T>(withRange(route, range), { signal });
}

export const fetchMortgagePayments = series<MortgagePaymentsResponse>(ROUTES.statsMortgagePayments);
export const fetchSalariesStats = series<SalariesStatsResponse>(ROUTES.statsSalaries);
export const fetchContributions = series<ContributionsResponse>(ROUTES.statsContributions);
export const fetchMortgageOwn = series<MortgageOwnResponse>(ROUTES.statsMortgageOwn);
export const fetchBufferStats = series<BufferStatsResponse>(ROUTES.statsBuffer);
export const fetchSpendingStats = series<SpendingStatsResponse>(ROUTES.statsSpending);
export const fetchFixedItems = series<FixedItemsResponse>(ROUTES.statsFixedItems);
export const fetchSettlementsStats = series<SettlementsStatsResponse>(ROUTES.statsSettlements);
