/**
 * The history's series (lg-9): one `GET` per chart on the stats screen, each
 * taking `?from=` and `?to=`. Every one is computed from rows already stored
 * (`stats.ts`) and writes nothing.
 */

import {
  AppError,
  ROUTES,
  DEFAULT_LARGE_DROP_CENTS,
  bufferStatsQuerySchema,
  statsRangeQuerySchema,
} from "@ledger/contract";
import type { StatsRange } from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";
import {
  bufferStats,
  contributionsStats,
  fixedItemsStats,
  mortgageOwnStats,
  mortgagePaymentsStats,
  salariesStats,
  settlementsStats,
  spendingStats,
} from "../stats.ts";

function rangeError(): AppError {
  return new AppError("BAD_REQUEST", "from and to are days, written yyyy-mm-dd, from first.");
}

/** `?from=&to=`, either missing; refused when either is not a day or `from` is after `to`. */
function rangeOf(request: FastifyRequest): StatsRange {
  const query = statsRangeQuerySchema.safeParse(request.query);
  if (!query.success) throw rangeError();
  return { from: query.data.from ?? null, to: query.data.to ?? null };
}

function todayOf(context: AppContext): string {
  return context.now().toISOString().slice(0, 10);
}

type Series = (request: FastifyRequest) => unknown;

export function registerStatsRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);
  const { db } = context;

  const series: [string, Series][] = [
    [ROUTES.statsMortgagePayments, (request) => mortgagePaymentsStats(db, rangeOf(request))],
    [ROUTES.statsSalaries, (request) => salariesStats(db, rangeOf(request))],
    [ROUTES.statsContributions, (request) => contributionsStats(db, rangeOf(request))],
    [ROUTES.statsMortgageOwn, (request) => mortgageOwnStats(db, rangeOf(request))],
    [
      ROUTES.statsBuffer,
      (request) => {
        const query = bufferStatsQuerySchema.safeParse(request.query);
        if (!query.success) throw rangeError();
        const range = { from: query.data.from ?? null, to: query.data.to ?? null };
        return bufferStats(db, range, query.data.minDropCents ?? DEFAULT_LARGE_DROP_CENTS);
      },
    ],
    [ROUTES.statsSpending, (request) => spendingStats(db, rangeOf(request), todayOf(context))],
    [ROUTES.statsFixedItems, (request) => fixedItemsStats(db, rangeOf(request), todayOf(context))],
    [ROUTES.statsSettlements, (request) => settlementsStats(db, rangeOf(request))],
  ];

  // The eight routes are registered at this one call, each taking `read`. CodeQL's
  // `js/missing-rate-limiting` models express-rate-limit and its kin, not
  // `@webtools/core`'s `RateLimiter`, so it reads the `read` hook as no limit at
  // all; every route is limited per person like every other (`rate-limit.ts`).
  // Excused under `docs/adr/005`, here in `api/src/routes/stats.ts`. Guarded by
  // `api/test/route-limits.test.ts`: taking `{ onRequest: read }` off this call
  // fails 8 of its 49 tests, the eight "stats… refuses the second request in a
  // minute, as RATE_LIMITED" rows of its table — those tests, not this comment,
  // are what hold it. Measured 2026-10-10 on lg-9, base 7709411e.
  // codeql[js/missing-rate-limiting]
  for (const [path, compute] of series) {
    app.get(path, { onRequest: read }, async (request) => compute(request));
  }
}
