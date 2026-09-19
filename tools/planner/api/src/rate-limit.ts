/**
 * Per-client admission control on starting a run.
 *
 * The mechanism is `@webtools/core`'s — the token bucket, the client key and the
 * /64 rule all moved there when this tool became its second real consumer
 * (pl-16), which is the moment the repo's rule says shared code is allowed to be
 * shared. What is here is the part that is genuinely ours: refusing with *this*
 * tool's `AppError` and logging through *this* tool's logger.
 *
 * **Why a plan run needs one at all.** A run is a roster of model calls plus a
 * critic pass — roughly an order of magnitude more than a single request — so an
 * unlimited `POST /api/plans` is an open form spending someone else's budget.
 * The architecture lists it under the security posture rather than under cost
 * for exactly that reason. It is the second of two controls and not a substitute
 * for the first: `RunBudget` bounds what one run may spend, this bounds how many
 * runs one client may start.
 */

import { AppError } from "@planner/contract";
import { clientKey, type RateLimiter } from "@webtools/core/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppLogger } from "./logger.ts";

export interface RateLimitHookOptions {
  limiter: RateLimiter;
  logger: AppLogger;
  /** Appears in the log line and in `details.scope`. Not sent to the client. */
  scope: string;
}

/**
 * Spend one request from `limiter` for this client, or refuse it.
 *
 * `RateLimit-*` are the IETF draft header names; `Retry-After` is the one every
 * HTTP client already understands, and is what the UI reads.
 *
 * **Factored out of the hook for pl-44**, and the hook below is now only this
 * called at `onRequest`. `POST /api/plans/:id/revisions` needs the same check
 * after its body is parsed, because the body's `kind` is what picks the bucket
 * — a re-plan spends from the runs bucket and an edit from the edits bucket —
 * and an `onRequest` hook runs before there is a body to read. One function,
 * so the two call sites cannot drift on a header, the code or the log line.
 */
export function enforceRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RateLimitHookOptions,
): void {
  const { limiter, logger, scope } = options;
  if (!limiter.enabled) return;

  const key = clientKey(request.ip);
  const decision = limiter.check(key);

  reply.header("RateLimit-Limit", String(decision.limit));
  reply.header("RateLimit-Remaining", String(decision.remaining));
  reply.header("RateLimit-Reset", String(decision.resetSec));

  if (decision.allowed) return;

  reply.header("Retry-After", String(decision.retryAfterSec));
  logger.warn("rate limited", { scope, key, retryAfterSec: decision.retryAfterSec });
  throw new AppError("RATE_LIMITED", undefined, {
    details: { scope, retryAfterSec: decision.retryAfterSec },
  });
}

/**
 * A Fastify `onRequest` hook. Runs before the body is parsed, so a refused
 * request costs almost nothing — which is the point when the thing being
 * refused is expensive.
 */
export function createRateLimitHook(
  options: RateLimitHookOptions,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    enforceRateLimit(request, reply, options);
  };
}
