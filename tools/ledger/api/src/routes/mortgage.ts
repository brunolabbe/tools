/**
 * `GET /api/mortgage` and `POST /api/mortgage` (lg-55): what the household says
 * about its mortgage, and what the stats and home screens read to close their
 * mortgage views. Any member may say it, as with a ratio.
 */

import { AppError, ROUTES, mortgageRecordRequestSchemaOn } from "@ledger/contract";
import type { MortgageResponse } from "@ledger/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { booksOf, personOf } from "../identity.ts";
import { mortgageStatus, recordMortgage } from "../mortgage.ts";
import { rateLimitsFor } from "../rate-limit.ts";

export function registerMortgageRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write } = rateLimitsFor(context);

  app.get(ROUTES.mortgage, { onRequest: read }, async (request) => {
    const today = context.now().toISOString().slice(0, 10);
    const body: MortgageResponse = mortgageStatus(booksOf(request), today);
    return body;
  });

  app.post(ROUTES.mortgage, { onRequest: write }, async (request) => {
    const now = context.now();
    const said = mortgageRecordRequestSchemaOn(now.toISOString().slice(0, 10)).safeParse(
      request.body,
    );
    if (!said.success) {
      throw new AppError(
        "BAD_REQUEST",
        "Say live, none, or ended with the day it ended, yyyy-mm-dd, no later than today.",
      );
    }
    const body: MortgageResponse = recordMortgage(
      booksOf(request),
      said.data,
      personOf(request).id,
      now,
    );
    return body;
  });
}
