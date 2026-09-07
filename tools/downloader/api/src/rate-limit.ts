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

import { createHash } from "node:crypto";
import { AppError } from "@downloader/contract";
import { clientKey, type RateLimiter } from "@webtools/core/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isWellFormedToken } from "./jobs/tokens.ts";
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
   * The file and thumbnail routes protect one *artefact* instead, and key on
   * the capability token that names it — `capabilityBucketKey` below. Whatever
   * this returns reaches a log line, so a key derived from a secret has to be
   * reduced first.
   */
  key?: (request: FastifyRequest) => string;
}

/**
 * The bucket key for a route whose path carries a capability token.
 *
 * **The token, not the address.** The endpoints that protect *the service* key
 * on `clientKey(request.ip)`; on `/api/files/:token` and
 * `/api/thumbnail/:token` the thing being protected is one file or one image,
 * and the token is what both names it and bounds who may ask for it. Keying on
 * the token means a leaked link cannot outrun its own bucket by being fetched
 * from many addresses at once — the pair `(token, ip)` would hand each of those
 * addresses a fresh allowance, which is precisely the case worth stopping. It
 * also means the limit survives CGNAT and a reverse proxy, neither of which an
 * address key does; `trustProxy` is off by default and cannot be turned on
 * safely without knowing the deployment.
 *
 * The token is hashed because this key reaches a log line, and one of these
 * tokens is a live credential — the same reason `redactUrl` exists. A prefix of
 * the digest is a stable bucket name that leaks nothing.
 *
 * A token that is not even well formed cannot name anything, so it falls back
 * to the address. Be precise about what that buys: `isWellFormedToken` checks
 * length and charset, not existence, so a scanner guessing *well-formed* tokens
 * — the realistic case — still mints a bucket per guess. What bounds that is
 * `RateLimiter`'s `maxKeys` (10,000, evicted least-recently-seen), not this
 * branch. The fallback buys the two things it can: obviously-malformed junk
 * shares one allowance rather than getting a fresh one per request, and no
 * amount of guessing lands in a real artefact's bucket.
 *
 * Each route passes its own `RateLimiter`, so two routes holding the same
 * string cannot spend each other's allowance — and no route mints tokens the
 * other would recognise anyway.
 */
export function capabilityBucketKey(request: FastifyRequest): string {
  const token = (request.params as { token?: unknown }).token;
  if (typeof token !== "string" || !isWellFormedToken(token)) {
    return `ip:${clientKey(request.ip)}`;
  }
  return `token:${createHash("sha256").update(token).digest("base64url").slice(0, 16)}`;
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
