/**
 * A workbook the reader does not know (lg-66): described by a model when the
 * person asks, then imported on confirmation. What each request may do is in
 * `workbook-describe.ts`.
 *
 * Both take JSON carrying the file as base64, so the description travels
 * beside it on Confirm. Their body cap is the encoded size of
 * `MAX_WORKBOOK_BYTES` with room for the rest: a body over it is refused before
 * it is read, and a file under it but over the bound is refused, with the same
 * sentence, before it is decoded. Describe, the one that costs money, has a
 * rate-limit bucket of its own, as a receipt read has.
 */

import { MAX_WORKBOOK_BYTES, ROUTES } from "@ledger/contract";
import type { ConfirmWorkbookResponse, DescribeWorkbookResponse } from "@ledger/contract";
import { RateLimiter } from "@webtools/core/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { booksOf, personOf } from "../identity.ts";
import { createRateLimitHook, rateLimitsFor } from "../rate-limit.ts";
import { WORKBOOK_BYTES_MESSAGE, confirmWorkbook, describeWorkbook } from "../workbook-describe.ts";
import type { WorkbookCaller, WorkbookImportDeps } from "../workbook-describe.ts";

/** Base64 is four characters for every three bytes; the rest is the description and the JSON. */
const WORKBOOK_BODY_LIMIT = Math.ceil(MAX_WORKBOOK_BYTES / 3) * 4 + 256 * 1024;

function callerOf(context: AppContext, request: FastifyRequest): WorkbookCaller {
  const person = personOf(request);
  return {
    db: booksOf(request),
    personId: person.id,
    // The household as it stands, as an import from the host enrols it.
    members: context.directory.people(person.household),
    now: context.now,
  };
}

export function registerWorkbookRoutes(
  app: FastifyInstance,
  context: AppContext,
  deps: WorkbookImportDeps,
): void {
  const { write } = rateLimitsFor(context);
  const describing = createRateLimitHook({
    limiter: new RateLimiter({ perMinute: context.config.rateLimitWorkbookDescribesPerMinute }),
    logger: context.logger,
    scope: "workbook-describes",
  });
  const limits = {
    bodyLimit: WORKBOOK_BODY_LIMIT,
    config: { tooLargeMessage: WORKBOOK_BYTES_MESSAGE },
  };

  // The one request that reaches a model, and only when the person asks.
  app.post(
    ROUTES.workbookDescribe,
    { onRequest: describing, ...limits },
    async (request, reply) => {
      // A caller who hangs up before the answer stops the model's call too.
      const hungUp = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) hungUp.abort();
      });
      const body: DescribeWorkbookResponse = await describeWorkbook(
        callerOf(context, request),
        request.body,
        deps,
        hungUp.signal,
      );
      // Counts only: never a sheet's name, a cell, or the key.
      context.logger.info("a workbook was described", {
        inputTokens: body.usage.inputTokens,
        outputTokens: body.usage.outputTokens,
        ok: body.ok,
      });
      return body;
    },
  );

  // The confirmation: nothing is imported without it.
  app.post(ROUTES.workbookConfirm, { onRequest: write, ...limits }, async (request) => {
    const body: ConfirmWorkbookResponse = await confirmWorkbook(
      callerOf(context, request),
      request.body,
      deps,
    );
    context.logger.info("a described workbook was imported");
    return body;
  });
}
