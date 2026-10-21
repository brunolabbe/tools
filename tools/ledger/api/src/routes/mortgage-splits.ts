/**
 * `GET /api/mortgage-splits` and `POST /api/mortgage-splits` (lg-63): how the
 * mortgage's joint rows split from a date — by shares, equally, or at the ratio.
 * Any member may file one, as with a ratio, and filing one for a day that has
 * one supersedes it.
 */

import { AppError, ROUTES, mortgageSplitRequestSchemaOn } from "@ledger/contract";
import type { MortgageSplit, MortgageSplitsResponse } from "@ledger/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { booksOf, personOf } from "../identity.ts";
import { fileSplit, splitsAsOf } from "../mortgage-splits.ts";
import { rateLimitsFor } from "../rate-limit.ts";
import { asOfOf } from "./buckets.ts";

export function registerMortgageSplitRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write } = rateLimitsFor(context);

  app.get(ROUTES.mortgageSplits, { onRequest: read }, async (request) => {
    const body: MortgageSplitsResponse = splitsAsOf(booksOf(request), asOfOf(context, request));
    return body;
  });

  app.post(ROUTES.mortgageSplits, { onRequest: write }, async (request) => {
    const now = context.now();
    const filed = mortgageSplitRequestSchemaOn(now.toISOString().slice(0, 10)).safeParse(
      request.body,
    );
    if (!filed.success) {
      throw new AppError(
        "BAD_REQUEST",
        "Send the day the split takes effect, yyyy-mm-dd, no later than today, and its mode: shares, equal or ratio. Shares name each person once, in parts per million summing to 1 000 000.",
      );
    }
    const body: MortgageSplit = fileSplit(booksOf(request), filed.data, personOf(request).id, now);
    return body;
  });
}
