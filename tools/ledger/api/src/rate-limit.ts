/**
 * Per-person admission control on every API route but health (lg-4).
 *
 * The mechanism is `@webtools/core`'s token bucket, shared with the downloader
 * and the planner; what is here is what is the ledger's own: who the bucket is
 * kept for, and refusing with this tool's `AppError` through this tool's logger.
 *
 * **The key is the Access identity, not the address.** Behind the tunnel both
 * people can arrive from one address, and `request.ip` is only the client when
 * `TRUST_PROXY` is set right; the person Access vouched for is what the tool
 * already trusts to say who did something. The hook runs after the identity
 * check, so `personOf` is always there, and it fails closed if it is not.
 *
 * **Two buckets, because the routes cost differently.** A write takes the
 * database's one write lock, and a paste is parsed and proved over up to a
 * megabyte; a read is a query. Neither is expensive at two people's pace, which
 * is the point: the limits sit far above a person tapping and far below a loop.
 *
 * **It is attached to each route, not to the app.** A route registered without
 * `{ onRequest: ... }` is unlimited, and the test in `api/test/route-limits.test.ts`
 * walks every route in the contract so that a new one cannot be forgotten.
 * Health is the one exception: a probe must always be answered, and it reads
 * nothing but whether the database is open.
 */

import { AppError } from "@ledger/contract";
import type { RateLimiter } from "@webtools/core/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "./context.ts";
import { personOf } from "./identity.ts";
import type { AppLogger } from "./logger.ts";

export interface RateLimitHookOptions {
  limiter: RateLimiter;
  logger: AppLogger;
  /** Appears in the log line and in `details.scope`. Not sent to the client. */
  scope: string;
}

type Hook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Spends one request from the limiter for this person, or refuses it with
 * core's `RATE_LIMITED`. `RateLimit-*` are the IETF draft header names and
 * `Retry-After` is the one every HTTP client already understands.
 */
export function createRateLimitHook(options: RateLimitHookOptions): Hook {
  const { limiter, logger, scope } = options;
  return async function rateLimit(request, reply): Promise<void> {
    if (!limiter.enabled) return;

    // A person's id, which is the household's own name for them and no secret,
    // and so is safe in a log line where an address or a token is not.
    const key = personOf(request).id;
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

/** The two hooks a route takes as `{ onRequest }`: `read` for a `GET`, `write` for a `POST`. */
export function rateLimitsFor(context: AppContext): { read: Hook; write: Hook } {
  return {
    read: createRateLimitHook({
      limiter: context.rateLimits.reads,
      logger: context.logger,
      scope: "reads",
    }),
    write: createRateLimitHook({
      limiter: context.rateLimits.writes,
      logger: context.logger,
      scope: "writes",
    }),
  };
}
