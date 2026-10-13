/**
 * Per-person admission control on every API route but health (lg-4), a person
 * being a name in a household (lg-21).
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
 *
 * **An admin route is keyed on the admin's address** (lg-22), since an admin
 * may be in no household and so have no person (lg-20). Its hook asks
 * `adminOf`, so it refuses anyone else before it spends anything, and it never
 * writes the address into a log line.
 */

import { AppError } from "@ledger/contract";
import type { RateLimiter } from "@webtools/core/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "./context.ts";
import { adminOf, personOf } from "./identity.ts";
import type { AppLogger } from "./logger.ts";

export interface RateLimitHookOptions {
  limiter: RateLimiter;
  logger: AppLogger;
  /** Appears in the log line and in `details.scope`. Not sent to the client. */
  scope: string;
  /**
   * Who the bucket is kept for, and what of that the log line may carry: the
   * household and the person unless a route says otherwise (`personKey`).
   */
  keyOf?: (request: FastifyRequest) => BucketKey;
}

export interface BucketKey {
  key: string;
  /** What the log line says the bucket is; nothing when the key holds an address. */
  logged: string | undefined;
}

/**
 * A person's id, which is the household's own name for them and no secret,
 * and so is safe in a log line where an address or a token is not — behind
 * their household's id, so two households' people with the same name do not
 * share a bucket (lg-21). An id is one lowercase word, so the first colon is
 * always the one written here.
 */
function personKey(request: FastifyRequest): BucketKey {
  const person = personOf(request);
  const key = `${person.household}:${person.id}`;
  return { key, logged: key };
}

/**
 * An admin's address (lg-22), which no log line carries. Behind an `@`, which
 * no household id can hold (`[a-z]+`), so no person's key — a household called
 * `admin` with a member named like the admin's address included — is ever an
 * admin's (lg-22's gate 1, F4).
 */
function adminKey(request: FastifyRequest): BucketKey {
  return { key: `@admin:${adminOf(request)}`, logged: undefined };
}

type Hook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Spends one request from the limiter for this person, or refuses it with
 * core's `RATE_LIMITED`. `RateLimit-*` are the IETF draft header names and
 * `Retry-After` is the one every HTTP client already understands.
 */
export function createRateLimitHook(options: RateLimitHookOptions): Hook {
  const { limiter, logger, scope, keyOf = personKey } = options;
  return async function rateLimit(request, reply): Promise<void> {
    // Before the limiter says whether it is on, so an admin hook refuses a
    // non-admin with the limits off as well.
    const { key, logged } = keyOf(request);
    if (!limiter.enabled) return;
    const decision = limiter.check(key);

    reply.header("RateLimit-Limit", String(decision.limit));
    reply.header("RateLimit-Remaining", String(decision.remaining));
    reply.header("RateLimit-Reset", String(decision.resetSec));

    if (decision.allowed) return;

    reply.header("Retry-After", String(decision.retryAfterSec));
    logger.warn("rate limited", {
      scope,
      ...(logged === undefined ? {} : { key: logged }),
      retryAfterSec: decision.retryAfterSec,
    });
    throw new AppError("RATE_LIMITED", undefined, {
      details: { scope, retryAfterSec: decision.retryAfterSec },
    });
  };
}

/**
 * The hooks a route takes as `{ onRequest }`: `read` for a `GET`, `write` for a
 * `POST`, and their admin twins for a route under `/api/admin/` (lg-22).
 */
export function rateLimitsFor(context: AppContext): {
  read: Hook;
  write: Hook;
  adminRead: Hook;
  adminWrite: Hook;
} {
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
    adminRead: createRateLimitHook({
      limiter: context.rateLimits.reads,
      logger: context.logger,
      scope: "reads",
      keyOf: adminKey,
    }),
    adminWrite: createRateLimitHook({
      limiter: context.rateLimits.writes,
      logger: context.logger,
      scope: "writes",
      keyOf: adminKey,
    }),
  };
}
