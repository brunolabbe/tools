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
 * A Fastify `onRequest` hook. Runs before the body is parsed, so a refused
 * request costs almost nothing — which is the point when the thing being
 * refused is expensive.
 *
 * `RateLimit-*` are the IETF draft header names; `Retry-After` is the one every
 * HTTP client already understands, and is what the UI reads.
 */
export function createRateLimitHook(
  options: RateLimitHookOptions,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { limiter, logger, scope } = options;

  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
  };
}
