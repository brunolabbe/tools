/**
 * Receipts (lg-8): upload a photo, read it when the person asks, offer the rows
 * it may document, and file it on confirmation. What each step may and may not
 * do is in `receipts.ts`.
 *
 * **The upload takes the photo's bytes as the body**, whatever the request says
 * it is: in a scope of its own, every content type is read as bytes, and the
 * bytes say whether it is an image (`imageTypeOf`). The routes outside the scope
 * keep their JSON. The photo's cap is its own (`MAX_RECEIPT_PHOTO_BYTES`), over
 * the app's 1 MiB for everything else, and is enforced before a byte is kept;
 * the identity check and the rate limit both run before the body is read at all.
 */

import {
  AppError,
  MAX_RECEIPT_PHOTO_BYTES,
  ROUTES,
  fileReceiptRequestSchema,
  receiptMatchesQuerySchema,
} from "@ledger/contract";
import type {
  ReadReceiptResponse,
  ReceiptFiling,
  ReceiptMatchesResponse,
  UploadedReceipt,
} from "@ledger/contract";
import type { ReceiptReader } from "@ledger/receipts";
import { RateLimiter } from "@webtools/core/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { booksOf, personOf } from "../identity.ts";
import { createRateLimitHook, rateLimitsFor } from "../rate-limit.ts";
import type { PhotoStore } from "../receipt-photos.ts";
import { fileReceipt, readReceipt, receiptMatches, uploadReceipt } from "../receipts.ts";
import { bodyOf, idOf } from "./periods.ts";
import { ruleContext } from "./rules.ts";

export interface ReceiptRouteOptions {
  /** `undefined` when no model is configured: a read is refused, and typing by hand still works. */
  reader: ReceiptReader | undefined;
  photos: PhotoStore;
}

/** The caller's household's books and photos, and nobody else's. */
function photosContext(request: FastifyRequest, photos: PhotoStore) {
  return { db: booksOf(request), photos, household: personOf(request).household };
}

export function registerReceiptRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: ReceiptRouteOptions,
): void {
  const { read, write } = rateLimitsFor(context);
  const { reader, photos } = options;
  // The paid route's own bucket (gate 1, F4), per person like the others.
  const reading = createRateLimitHook({
    limiter: new RateLimiter({ perMinute: context.config.rateLimitReceiptReadsPerMinute }),
    logger: context.logger,
    scope: "receipt-reads",
  });

  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    scope.post(
      ROUTES.receipts,
      {
        onRequest: write,
        bodyLimit: MAX_RECEIPT_PHOTO_BYTES,
        config: { tooLargeMessage: "A receipt photo is 7 MB at most. Take it again, closer." },
      },
      async (request) => {
        const receipt: UploadedReceipt = {
          ...(await uploadReceipt(
            { ...photosContext(request, photos), personId: personOf(request).id, now: context.now },
            request.body,
          )),
          reader: reader?.model ?? null,
        };
        return receipt;
      },
    );
  });

  // The one route that reaches a model, and only when the person asks.
  app.post(ROUTES.receiptRead, { onRequest: reading }, async (request, reply) => {
    // A caller who hangs up before the answer stops the model's call too.
    const hungUp = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) hungUp.abort();
    });
    const body: ReadReceiptResponse = await readReceipt(
      photosContext(request, photos),
      reader,
      idOf(request, "receipt"),
      hungUp.signal,
    );
    return body;
  });

  app.get(ROUTES.receiptMatches, { onRequest: read }, async (request) => {
    const query = receiptMatchesQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new AppError(
        "BAD_REQUEST",
        "amountCents is a whole number of cents that is not zero, and date is a day, written yyyy-mm-dd.",
      );
    }
    const body: ReceiptMatchesResponse = receiptMatches(
      booksOf(request),
      idOf(request, "receipt"),
      query.data,
    );
    return body;
  });

  // The confirmation: nothing is filed without it.
  app.post(ROUTES.receiptFile, { onRequest: write }, async (request) => {
    const filing: ReceiptFiling = fileReceipt(
      ruleContext(context, request),
      idOf(request, "receipt"),
      bodyOf(fileReceiptRequestSchema, request, "filing"),
      // The household as it stands, not every name its books hold (lg-30).
      context.directory.people(personOf(request).household),
    );
    return filing;
  });
}
