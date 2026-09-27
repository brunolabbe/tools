/**
 * `GET /api/files/:token` — a job's single-use link. Opening it starts the job
 * and streams the file on the same response, as ffmpeg produces it (dl-53).
 *
 * Nothing is stored: no file sits behind this route, and there is nothing to
 * come back for. The path is the one it had when it served stored files, so
 * dl-23's per-token rate limit and the Access bypass dl-49 names still describe
 * the same route.
 *
 * In order, and each step is a decision the owner made or the ticket states:
 *
 *  1. **Unknown token → `404`; spent, expired, or its job no longer waiting →
 *     `410`** (`FILE_EXPIRED`). A link works once.
 *  2. **Admission before the link is spent.** The wait line and dl-51's
 *     per-client cap are checked first, so a refusal leaves the link usable.
 *  3. **The link is claimed atomically**; of two racing `GET`s one wins.
 *  4. **A bounded wait for a slot** (owner decision 6): long enough that the
 *     wait plus the probe's own timeout stays under 100 s, since Cloudflare
 *     answers `524` at 125 s with no response. Past it, the link is given back
 *     and the answer is `429` with `Retry-After`.
 *  5. **Headers at the first byte.** Until then an error is the usual JSON
 *     `AppError`; after it, the connection is cut and the job row keeps the
 *     code. A visitor who leaves is `canceled`, reason `disconnected` — not a
 *     failure (dl-57).
 *
 * `Content-Disposition: attachment` so a hostile filename cannot render inline
 * on this origin, and no `Content-Length`: the length is not known when the
 * headers go (the owner accepted that on 2026-09-14). No `Range` either — there
 * is no file to seek in.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { JobLink } from "@downloader/contract";
import type { MediaStream } from "@downloader/engine";
import { clientKey } from "@webtools/core/rate-limit";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { cancelError, maxLinkWaitMs, recordCanceled } from "../jobs/links.ts";
import { isWellFormedToken } from "../jobs/tokens.ts";
import { capabilityBucketKey, createRateLimitHook } from "../rate-limit.ts";

/** What we tell a client to wait when a cap or the wait line refused it. */
const CAP_RETRY_AFTER_SEC = 30;

/** RFC 6266: an ASCII fallback plus a UTF-8 form for everyone else. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replaceAll(/[^\x20-\x7e]/gu, "_").replaceAll('"', "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function invalidLink(): AppError {
  return new AppError("JOB_NOT_FOUND", "That download link is not valid.");
}

function rateLimited(message: string, scope: string): AppError {
  return new AppError("RATE_LIMITED", message, {
    details: { scope, retryAfterSec: CAP_RETRY_AFTER_SEC },
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  // Definitely assigned: the executor runs synchronously inside the constructor.
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // A rejection nobody awaits yet must not be an unhandled one.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export function registerFileRoutes(app: FastifyInstance, context: AppContext): void {
  const rateLimit = createRateLimitHook({
    limiter: context.rateLimits.files,
    logger: context.logger,
    scope: "files",
    // The token, not the address: what this protects is one link. The full
    // reasoning, and what the malformed-token fallback does and does not buy,
    // is on `capabilityBucketKey`.
    key: capabilityBucketKey,
  });

  app.get<{ Params: { token: string } }>(
    ROUTES.file(":token"),
    // No automatic `HEAD`: Fastify would run this handler for one, and a
    // `HEAD` would then spend the link and start a download nobody reads.
    { onRequest: rateLimit, exposeHeadRoute: false },
    async (request, reply) => {
      const { store, events, queue } = context;
      const { token } = request.params;
      const nowIso = (): string => context.now().toISOString();

      // Rejected on shape before a database round trip, so scanning for tokens
      // costs an attacker the same as any other 404.
      if (!isWellFormedToken(token)) throw invalidLink();
      const link = store.findLink(token);
      if (link === null) throw invalidLink();
      const job = store.find(link.jobId);
      if (job === null) throw invalidLink();

      if (link.usedAt !== null || job.status !== "queued") {
        throw new AppError("FILE_EXPIRED", undefined, { details: { jobId: job.id } });
      }
      if (Date.parse(link.expiresAt) <= context.now().getTime()) {
        // The sweep would get to it; answering now is the same outcome sooner.
        recordCanceled(store, events, job.id, cancelError("link-expired").toPayload(), nowIso());
        throw new AppError("FILE_EXPIRED", undefined, { details: { jobId: job.id } });
      }
      if (context.isShuttingDown()) {
        throw new AppError("INTERNAL", "The server is shutting down and is not starting new jobs.");
      }

      // --- admission, before the link is spent -----------------------------
      if (context.config.maxQueuedJobs > 0 && queue.waiting >= context.config.maxQueuedJobs) {
        reply.header("Retry-After", String(CAP_RETRY_AFTER_SEC));
        context.logger.warn("download refused: the wait line is full", {
          waiting: queue.waiting,
          limit: context.config.maxQueuedJobs,
        });
        throw rateLimited(
          "The server is already working through as many downloads as it can hold. Try again shortly.",
          "jobs-queue-full",
        );
      }
      // The key `rateLimits.jobs` buckets on, so `TRUST_PROXY` means the same
      // for both. Counts running and waiting together (dl-51).
      const key = clientKey(request.ip);
      const releaseSlot = context.jobClientGate.tryAcquire(key);
      if (releaseSlot === null) {
        reply.header("Retry-After", String(CAP_RETRY_AFTER_SEC));
        context.logger.warn("download refused: per-client cap reached", {
          key,
          limit: context.jobClientGate.limit,
        });
        throw rateLimited(
          "You already have as many downloads running or waiting as this server allows per client. Try again once one finishes.",
          "jobs-client-cap",
        );
      }

      const offered: JobLink | null = job.link ?? null;
      if (!store.claimLink(token, nowIso())) {
        releaseSlot();
        throw new AppError("FILE_EXPIRED", undefined, { details: { jobId: job.id } });
      }

      // --- the run ---------------------------------------------------------
      const started = deferred<MediaStream>();
      const delivered = deferred<undefined>();
      let media: MediaStream | null = null;

      const onClose = (): void => {
        delivered.resolve(undefined);
        if (reply.raw.writableEnded) return;
        // A stream that failed on its own destroys the response itself; that
        // is its code to record, not the visitor leaving.
        if (media !== null && media.body.errored !== null) return;
        const reason = cancelError("disconnected");
        if (queue.cancel(job.id, reason) !== "running") {
          const current = store.find(job.id);
          if (current !== null && current.status === "queued") {
            recordCanceled(store, events, job.id, reason.toPayload(), nowIso());
          }
        }
        started.reject(reason);
      };
      reply.raw.once("close", onClose);

      try {
        queue.enqueue({
          jobId: job.id,
          run: async (signal) => {
            await context.orchestrator.run(job.id, signal, {
              requestId: request.id,
              deliver: async (opened) => {
                media = opened;
                started.resolve(opened);
                await delivered.promise;
              },
            });
            // Never delivered: the run ended before a first byte, and the job
            // row has the reason, which is what this request answers with.
            if (media === null) started.reject(failureOf(context, job.id));
          },
          onSettle: releaseSlot,
        });
      } catch (error: unknown) {
        releaseSlot();
        if (offered !== null) store.releaseLink(token, offered, nowIso());
        throw error;
      }

      // --- the bounded wait for a slot -------------------------------------
      const waitMs = maxLinkWaitMs(context.config.probeTimeoutMs);
      const timer = setTimeout(() => {
        if (!queue.isWaiting(job.id)) return;
        // Taken out of line without a verdict: the job goes back to waiting
        // for its link, and the link to being usable.
        queue.cancel(job.id);
        if (offered !== null) store.releaseLink(token, offered, nowIso());
        reply.header("Retry-After", String(CAP_RETRY_AFTER_SEC));
        started.reject(
          rateLimited(
            "Every download slot is busy. Try the same link again in a moment.",
            "jobs-wait-timeout",
          ),
        );
      }, waitMs);
      timer.unref?.();

      let opened: MediaStream;
      try {
        opened = await started.promise;
      } finally {
        clearTimeout(timer);
      }

      // Failed between its first byte and here: no header has gone, so it is
      // still an ordinary JSON answer with the failure's own code.
      if (opened.body.errored !== null) throw AppError.from(opened.body.errored);

      reply.raw.once("finish", () => {
        delivered.resolve(undefined);
      });
      reply.header("Content-Type", opened.contentType);
      reply.header("Content-Disposition", contentDisposition(opened.filename));
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      return await reply.code(200).send(opened.body);
    },
  );
}

/** The job row's recorded error, as the `AppError` this request answers with. */
function failureOf(context: AppContext, jobId: string): AppError {
  const payload = context.store.find(jobId)?.error ?? null;
  if (payload === null) return new AppError("INTERNAL", "The download ended without a file.");
  return new AppError(payload.code, payload.message, {
    retryable: payload.retryable,
    ...(payload.details === undefined ? {} : { details: payload.details }),
  });
}
