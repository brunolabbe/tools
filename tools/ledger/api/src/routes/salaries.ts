/**
 * The salaries and the ratio (lg-5).
 *
 * `POST /api/salaries` files a year's salaries and answers with the ratio they
 * give, as a proposal; `POST /api/ratios` is the person confirming it, with the
 * day it takes effect. Both append, and who acted comes from `personOf`.
 */

import { AppError, ROUTES, confirmRatioRequestSchema, salaryEntrySchema } from "@ledger/contract";
import type {
  Ratio,
  RatiosResponse,
  SalariesResponse,
  SalaryEntryResponse,
} from "@ledger/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";
import { confirmRatio, currentSalaries, enterSalaries, ratiosAsOf } from "../salaries.ts";
import { asOfOf } from "./buckets.ts";
import { ruleContext } from "./rules.ts";

export function registerSalaryRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write } = rateLimitsFor(context);

  // CodeQL's `js/missing-rate-limiting` models express-rate-limit and its kin,
  // not `@webtools/core`'s `RateLimiter`, so it reads the `read` hook on this
  // route as no limit at all; the route is limited per person like every other
  // (`rate-limit.ts`). Excused under `docs/adr/005`, here in
  // `api/src/routes/salaries.ts`. Guarded by `api/test/route-limits.test.ts`:
  // taking `{ onRequest: read }` off this route fails 1 of its 22 tests, "GET
  // salaries refuses the second request in a minute too" — that test, not this
  // comment, is what holds it. Measured 2026-10-05 at 4a7647b.
  // codeql[js/missing-rate-limiting]
  app.get(ROUTES.salaries, { onRequest: read }, async () => {
    const body: SalariesResponse = { salaries: currentSalaries(context.db) };
    return body;
  });

  app.post(ROUTES.salaries, { onRequest: write }, async (request) => {
    const entry = salaryEntrySchema.safeParse(request.body);
    if (!entry.success) {
      throw new AppError(
        "BAD_REQUEST",
        "Send a year and, for each person, a salary in cents of zero or more.",
      );
    }
    const body: SalaryEntryResponse = enterSalaries(ruleContext(context, request), entry.data);
    return body;
  });

  app.get(ROUTES.ratios, { onRequest: read }, async (request) => {
    const asOf = asOfOf(context, request);
    const body: RatiosResponse = { asOf, ...ratiosAsOf(context.db, asOf) };
    return body;
  });

  app.post(ROUTES.ratios, { onRequest: write }, async (request) => {
    const confirmation = confirmRatioRequestSchema.safeParse(request.body);
    if (!confirmation.success) {
      throw new AppError(
        "BAD_REQUEST",
        "Send the day the ratio takes effect, yyyy-mm-dd, and the salaries it comes from.",
      );
    }
    const ratio: Ratio = confirmRatio(ruleContext(context, request), confirmation.data);
    return ratio;
  });
}
