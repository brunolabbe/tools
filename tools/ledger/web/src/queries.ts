/**
 * Every read a screen makes, as a query the cache keeps (lg-98).
 *
 * **A key is the route, then what the request asks for**, so a write marks a
 * route stale by its first element whatever was asked of it (`writes.ts`), and
 * two screens asking the same thing share one answer and one request.
 *
 * **One key, one shape.** A query key is not typed against what it holds, so
 * two callers that wanted different shapes from one route under one key would be
 * handed each other's data with nothing to catch it. Every key is built here, by
 * one function, from one `queryFn`; and where two callers want different shapes
 * from one route — people, and who is signed in — the key holds the route's
 * whole answer and each caller takes its part with `select`.
 */

import { queryOptions } from "@tanstack/react-query";
import type { QueryClient, QueryKey, QueryState } from "@tanstack/react-query";
import { AppError, ROUTES } from "@ledger/contract";
import type {
  PeopleResponse,
  PeriodLinesResponse,
  RowsQuery,
  RowsResponse,
  StatsRange,
} from "@ledger/contract";
import { fetchBuckets } from "./api/buckets.ts";
import { fetchAdminHouseholds, fetchHousehold } from "./api/households.ts";
import { fetchAutoFiled, fetchInbox } from "./api/inbox.ts";
import { fetchMe } from "./api/me.ts";
import { fetchMortgageSplits } from "./api/mortgage-splits.ts";
import { fetchMortgage } from "./api/mortgage.ts";
import { fetchPeople } from "./api/people.ts";
import { fetchOpenPeriod, fetchPeriods, fetchRecurring } from "./api/periods.ts";
import { fetchRows } from "./api/rows.ts";
import { fetchRules } from "./api/rules.ts";
import { fetchRatios, fetchSalaries } from "./api/salaries.ts";
import {
  fetchSpendingCategories,
  fetchSpendingLines,
  fetchSpendingMap,
  fetchSpendingRows,
  fetchUncategorisedRows,
} from "./api/spending.ts";
import type { SeriesFetch } from "./api/stats.ts";
import { byShownName } from "./people.tsx";

export const meQuery = queryOptions({
  queryKey: [ROUTES.me],
  queryFn: ({ signal }) => fetchMe(signal),
});

export const peopleQuery = queryOptions({
  queryKey: [ROUTES.people],
  queryFn: ({ signal }) => fetchPeople(signal),
});

/** Who is in from the open period on: what a screen offers to pick. */
export function peopleIn(answer: PeopleResponse): string[] {
  return answer.people;
}

/**
 * Those, and everyone retired at a close besides (lg-35), for a screen about the
 * past. Each list comes by shown name (lg-76); the two together are put back in that order.
 */
export function everyone(answer: PeopleResponse): string[] {
  return [...answer.people, ...answer.retired].toSorted(byShownName(answer.names));
}

/** Person id to shown name (lg-33). */
export function shownNames(answer: PeopleResponse): PeopleResponse["names"] {
  return answer.names;
}

export const categoriesQuery = queryOptions({
  queryKey: [ROUTES.spendingCategories],
  queryFn: ({ signal }) => fetchSpendingCategories(signal),
});

export const spendingMapQuery = queryOptions({
  queryKey: [ROUTES.spendingCategoryMap],
  queryFn: ({ signal }) => fetchSpendingMap(signal),
});

export const uncategorisedQuery = queryOptions({
  queryKey: [ROUTES.rows, { list: "uncategorised" }],
  queryFn: ({ signal }) => fetchUncategorisedRows(signal),
});

export const inboxQuery = queryOptions({
  queryKey: [ROUTES.inbox],
  queryFn: ({ signal }) => fetchInbox(signal),
});

export const autoFiledQuery = queryOptions({
  queryKey: [ROUTES.autoFiled],
  queryFn: ({ signal }) => fetchAutoFiled(signal),
});

export const rulesQuery = queryOptions({
  queryKey: [ROUTES.rules],
  queryFn: ({ signal }) => fetchRules(signal),
});

export const bucketsQuery = queryOptions({
  queryKey: [ROUTES.buckets],
  queryFn: ({ signal }) => fetchBuckets(signal),
});

export const mortgageQuery = queryOptions({
  queryKey: [ROUTES.mortgage],
  queryFn: ({ signal }) => fetchMortgage(signal),
});

export const mortgageSplitsQuery = queryOptions({
  queryKey: [ROUTES.mortgageSplits],
  queryFn: ({ signal }) => fetchMortgageSplits(signal),
});

export const salariesQuery = queryOptions({
  queryKey: [ROUTES.salaries],
  queryFn: ({ signal }) => fetchSalaries(signal),
});

export const ratiosQuery = queryOptions({
  queryKey: [ROUTES.ratios],
  queryFn: ({ signal }) => fetchRatios(signal),
});

export const periodsQuery = queryOptions({
  queryKey: [ROUTES.periods],
  queryFn: ({ signal }) => fetchPeriods(signal),
});

export const recurringQuery = queryOptions({
  queryKey: [ROUTES.recurring],
  queryFn: ({ signal }) => fetchRecurring(signal),
});

/** The open period as if it ended on `range.end`; `{}` is as of today. */
export function openPeriodQuery(range: { start?: string | null; end?: string }) {
  return queryOptions({
    queryKey: [ROUTES.periodOpen, range],
    queryFn: ({ signal }) => fetchOpenPeriod(range, signal),
  });
}

export function householdQuery(id: string) {
  return queryOptions({
    queryKey: [ROUTES.household, id],
    queryFn: ({ signal }) => fetchHousehold(id, signal),
  });
}

export const adminHouseholdsQuery = queryOptions({
  queryKey: [ROUTES.adminHouseholds],
  queryFn: ({ signal }) => fetchAdminHouseholds(signal),
});

/** One of the history's series (lg-9) over one range; `route` is the one `fetcher` reads. */
export function seriesQuery<T>(route: string, fetcher: SeriesFetch<T>, range: StatsRange) {
  return queryOptions({
    queryKey: [route, { from: range.from, to: range.to }],
    queryFn: ({ signal }) => fetcher({ from: range.from, to: range.to }, signal),
  });
}

/** How many rows or lines one read brings, and one tap of "Show more". */
export const PAGE = 25;

/**
 * How many a read from the top asks for: a page, or as many as the list already
 * shows, so a list read again after a write does not send the person back to the
 * first page. "Show more" puts its page into the same entry (`setQueryData`).
 */
function shownSoFar(length: number | undefined, page = PAGE): number {
  return Math.max(page, length ?? 0);
}

/** The whole account's rows under the history's filters (lg-41), `page` at a time. */
export function historyRowsQuery(query: RowsQuery, page: number) {
  const queryKey = [ROUTES.rows, { list: "history", ...query }] as const;
  return queryOptions<RowsResponse, Error, RowsResponse, QueryKey>({
    queryKey,
    queryFn: ({ client, signal }) =>
      fetchRows(
        {
          ...query,
          offset: 0,
          limit: shownSoFar(client.getQueryData<RowsResponse>(queryKey)?.rows.length, page),
        },
        signal,
      ),
  });
}

/** What the rows and lines behind one period of the spending chart are narrowed by. */
export interface SpendingSlice {
  from: string | null;
  to: string;
  category: number | "none" | null;
}

/** The bank rows the spending chart counted in a period (lg-18), paged. */
export function spendingRowsQuery(slice: SpendingSlice) {
  const queryKey = [ROUTES.rows, { list: "spending", ...slice }] as const;
  return queryOptions<RowsResponse, Error, RowsResponse, QueryKey>({
    queryKey,
    queryFn: ({ client, signal }) =>
      fetchSpendingRows(
        {
          ...slice,
          offset: 0,
          limit: shownSoFar(client.getQueryData<RowsResponse>(queryKey)?.rows.length),
        },
        signal,
      ),
  });
}

/** The card lines the spending chart counted in a period (lg-19), paged. */
export function spendingLinesQuery(slice: SpendingSlice) {
  const queryKey = [ROUTES.periodLines, slice] as const;
  return queryOptions<PeriodLinesResponse, Error, PeriodLinesResponse, QueryKey>({
    queryKey,
    queryFn: ({ client, signal }) =>
      fetchSpendingLines(
        {
          ...slice,
          offset: 0,
          limit: shownSoFar(client.getQueryData<PeriodLinesResponse>(queryKey)?.lines.length),
        },
        signal,
      ),
  });
}

/**
 * The state of the query under `queryKey` once the read in flight, if any, has
 * settled: how a screen learns whether the read a write started succeeded,
 * without asking a second time. `undefined` when nothing is cached under it.
 */
export async function settledRead(
  client: QueryClient,
  queryKey: QueryKey,
): Promise<QueryState | undefined> {
  const cache = client.getQueryCache();
  const query = cache.find({ queryKey, exact: true });
  if (query === undefined || query.state.fetchStatus === "idle") return query?.state;
  return await new Promise((resolve) => {
    const stop = cache.subscribe((event) => {
      if (event.query !== query || query.state.fetchStatus !== "idle") return;
      stop();
      resolve(query.state);
    });
  });
}

/**
 * What a screen with several reads says went wrong: the first that failed with no
 * answer to show. A read again that fails keeps the answer it had on screen.
 */
export function failureOf(...results: readonly { error: unknown; data: unknown }[]): string | null {
  const failed = results.find((result) => result.error !== null && result.data === undefined);
  return failed === undefined ? null : AppError.from(failed.error).message;
}
