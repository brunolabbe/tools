/**
 * `GET /api/buckets` — each person's own money in the mortgage bucket, and the
 * buffer's balance and contributions, as of a date (lg-5). The home screen.
 */

import { AppError, ROUTES, asOfQuerySchema } from "@ledger/contract";
import type { BucketsResponse } from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { bucketsAsOf } from "../buckets.ts";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";

/** `?asOf=yyyy-mm-dd`, or today by the API's clock. */
export function asOfOf(context: AppContext, request: FastifyRequest): string {
  const query = asOfQuerySchema.safeParse(request.query);
  if (!query.success) {
    throw new AppError("BAD_REQUEST", "asOf is a day, written yyyy-mm-dd.");
  }
  return query.data.asOf ?? context.now().toISOString().slice(0, 10);
}

export function registerBucketRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);

  app.get(ROUTES.buckets, { onRequest: read }, async (request) => {
    const body: BucketsResponse = bucketsAsOf(context.db, asOfOf(context, request));
    return body;
  });
}
