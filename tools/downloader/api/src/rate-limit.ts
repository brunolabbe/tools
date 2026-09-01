/**
 * Admission control, as this service refuses it.
 *
 * `/api/probe` runs a browser probe costing ~15 s and ~300 MB. Without a limit
 * that is a one-line denial of service, which is why the brief calls this out
 * separately from the SSRF work: the guard stops us reaching places we should
 * not, this stops anyone reaching *us* faster than we can serve.
 *
 * The mechanism — the token bucket, the client key and the concurrency gate —
 * moved to `@webtools/core` when the planner became its second real consumer
 * (pl-16); the reasoning is on that file. What stayed here is the only part that
 * is genuinely this tool's: turning a refusal into *this* tool's `AppError`,
 * with *this* tool's logger, in a Fastify hook.
 */

import { AppError } from "@downloader/contract";
import { clientKey, type RateLimiter } from "@webtools/core/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppLogger } from "./logger.ts";

export interface RateLimitHookOptions {
  limiter: RateLimiter;
  logger: AppLogger;
  /** Appears in the log line and in `details.scope`. Not sent to the client. */
  scope: string;
  /**
   * What to bucket on. Defaults to the caller's address, which is right when
   * the thing being protected is *the service*.
   *
   * The file route protects a *file* instead, and keys on its capability token
   * — the reasoning is on `registerFileRoutes`. Whatever this returns reaches a
   * log line, so a key derived from a secret has to be reduced first.
   */
  key?: (request: FastifyRequest) => string;
}

/**
 * A Fastify `onRequest` hook. Runs before the body is parsed, so a refused
 * request costs almost nothing.
 *
 * `RateLimit-*` are the IETF draft header names; `Retry-After` is the one every
 * HTTP client already understands, and is what the UI reads.
 */
export function createRateLimitHook(
  options: RateLimitHookOptions,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { limiter, logger, scope, key: keyOf = (request) => clientKey(request.ip) } = options;

  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!limiter.enabled) return;

    const key = keyOf(request);
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
