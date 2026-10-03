/**
 * The inbox, and classifying a row (lg-4).
 *
 * `GET /api/inbox` is the rows no rule claimed, each with its nearest rule as a
 * suggestion. `POST /api/classifications` appends an answer — a suggested rule
 * taken, or a person and a bucket — for any stored row, so the same call is how a
 * row is classified again. What was said before is never changed.
 */

import { AppError, ROUTES, classifyRequestSchema } from "@ledger/contract";
import type { ClassificationRecord, InboxResponse } from "@ledger/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { classifyRow, inbox } from "../classifications.ts";
import { rateLimitsFor } from "../rate-limit.ts";
import { ruleContext } from "./rules.ts";

export function registerInboxRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write } = rateLimitsFor(context);

  app.get(ROUTES.inbox, { onRequest: read }, async () => {
    const body: InboxResponse = { rows: inbox(context.db) };
    return body;
  });

  app.post(ROUTES.classifications, { onRequest: write }, async (request) => {
    const body = classifyRequestSchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(
        "BAD_REQUEST",
        "Send a row with either a rule to accept, or a person and a bucket.",
      );
    }
    const record: ClassificationRecord = classifyRow(ruleContext(context, request), body.data);
    return record;
  });
}
