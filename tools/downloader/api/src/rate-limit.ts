/**
 * Per-IP admission control.
 *
 * `/api/probe` runs a browser probe costing ~15 s and ~300 MB. Without a limit
 * that is a one-line denial of service, which is why the brief calls this out
 * separately from the SSRF work: the guard stops us reaching places we should
 * not, this stops anyone reaching *us* faster than we can serve.
 *
 * Two independent mechanisms, because they fail differently:
 *
 *  - **A token bucket per client**, below. Bounds one caller's rate.
 *  - **A global concurrency gate** (`ConcurrencyGate`). Bounds everyone's
 *    simultaneous cost. A distributed flood passes every per-IP bucket and
 *    still has to fit through this.
 *
 * ## Why a bucket rather than a fixed window
 *
 * A fixed window admits `2n` requests across a window boundary, which for an
 * endpoint this expensive is the difference between a limit and a suggestion.
 * A bucket refills continuously, so the worst case is exactly `capacity`.
 *
 * ## The key is not always the address
 *
 * A single IPv6 customer routinely holds a /64 — 2^64 addresses. Keying on the
 * full address would let one host rotate its way around the limit without
 * effort, so IPv6 is bucketed by its /64 prefix. IPv4-mapped forms
 * (`::ffff:1.2.3.4`) collapse to the v4 address so the same client cannot hold
 * two buckets by changing how it spells itself.
 */

import net from "node:net";
import { AppError } from "@downloader/contract";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppLogger } from "./logger.ts";

export interface RateLimitDecision {
  allowed: boolean;
  /** Bucket capacity, i.e. the burst a fully rested client may spend at once. */
  limit: number;
  /** Whole tokens left after this call. */
  remaining: number;
  /** Seconds until one token is available. Zero when the call was allowed. */
  retryAfterSec: number;
  /** Seconds until the bucket is full again. */
  resetSec: number;
}

export interface RateLimiterOptions {
  /** Sustained rate. Zero or less disables the limiter entirely. */
  perMinute: number;
  /**
   * Burst allowance. Defaults to a full minute's worth, so a client may spend
   * `perMinute` immediately and then proceeds at the sustained rate.
   */
  burst?: number;
  /**
   * Hard ceiling on tracked clients. The map is itself an attack surface: an
   * attacker with a large address space would otherwise grow it without bound.
   */
  maxKeys?: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

const DEFAULT_MAX_KEYS = 10_000;
/** Full buckets are swept every N checks; see `#maybePrune`. */
const PRUNE_INTERVAL_CHECKS = 512;

export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #capacity: number;
  readonly #ratePerSec: number;
  readonly #maxKeys: number;
  readonly #now: () => number;
  #checksSincePrune = 0;

  constructor(options: RateLimiterOptions) {
    const perMinute = Math.max(0, options.perMinute);
    this.#ratePerSec = perMinute / 60;
    this.#capacity = Math.max(1, Math.floor(options.burst ?? perMinute));
    this.#maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
    this.#now = options.now ?? Date.now;
  }

  /** False when `perMinute` was zero, in which case `check` always allows. */
  get enabled(): boolean {
    return this.#ratePerSec > 0;
  }

  get size(): number {
    return this.#buckets.size;
  }

  check(key: string): RateLimitDecision {
    if (!this.enabled) {
      return { allowed: true, limit: 0, remaining: 0, retryAfterSec: 0, resetSec: 0 };
    }

    const nowMs = this.#now();
    const existing = this.#buckets.get(key);
    const bucket: Bucket = existing ?? { tokens: this.#capacity, lastMs: nowMs };

    const elapsedSec = Math.max(0, (nowMs - bucket.lastMs) / 1000);
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + elapsedSec * this.#ratePerSec);
    bucket.lastMs = nowMs;

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;

    // Re-inserting refreshes recency, so the eviction below drops the least
    // recently seen client rather than an arbitrary one.
    this.#buckets.delete(key);
    this.#buckets.set(key, bucket);
    this.#evict();
    this.#maybePrune();

    return {
      allowed,
      limit: this.#capacity,
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((1 - bucket.tokens) / this.#ratePerSec)),
      resetSec: Math.ceil((this.#capacity - bucket.tokens) / this.#ratePerSec),
    };
  }

  reset(): void {
    this.#buckets.clear();
  }

  #evict(): void {
    while (this.#buckets.size > this.#maxKeys) {
      const oldest = this.#buckets.keys().next();
      if (oldest.done === true) return;
      this.#buckets.delete(oldest.value);
    }
  }

  /**
   * Drops buckets that have refilled completely.
   *
   * Such a bucket is indistinguishable from a client we have never seen, so
   * keeping it costs memory and buys nothing. Doing this on an interval rather
   * than on a timer keeps the limiter free of background work — it has no
   * lifecycle to shut down.
   */
  #maybePrune(): void {
    if (++this.#checksSincePrune < PRUNE_INTERVAL_CHECKS) return;
    this.#checksSincePrune = 0;
    const nowMs = this.#now();
    for (const [key, bucket] of this.#buckets) {
      const refilled = bucket.tokens + ((nowMs - bucket.lastMs) / 1000) * this.#ratePerSec;
      if (refilled >= this.#capacity) this.#buckets.delete(key);
    }
  }
}

/** Expands `::` into eight groups. Null when the literal will not parse. */
function v6Groups(address: string): number[] | null {
  const [head = "", tail] = address.split("::");
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === undefined || tail === "" ? [] : tail.split(":");
  const parts =
    tail === undefined
      ? headParts
      : [...headParts, ...Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts];
  if (parts.length !== 8) return null;
  const groups = parts.map((part) => Number.parseInt(part, 16));
  return groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)
    ? null
    : groups;
}

/**
 * The bucket key for a client address.
 *
 * Anything unparsable collapses to a single shared `unknown` bucket. That is
 * deliberately the strictest outcome available: a caller we cannot identify
 * shares its allowance with every other such caller.
 */
export function clientKey(ip: string | undefined): string {
  if (ip === undefined || ip === "") return "unknown";
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const zoneless = (bare.split("%")[0] ?? bare).toLowerCase();

  if (net.isIP(zoneless) === 4) return zoneless;
  if (net.isIP(zoneless) !== 6) return "unknown";

  const mapped = /^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/u.exec(zoneless);
  if (mapped?.[1] !== undefined && net.isIP(mapped[1]) === 4) return mapped[1];

  const groups = v6Groups(zoneless);
  if (groups === null) return "unknown";
  // One /64 is one customer, not 2^64 of them.
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

export interface RateLimitHookOptions {
  limiter: RateLimiter;
  logger: AppLogger;
  /** Appears in the log line and in `details.scope`. Not sent to the client. */
  scope: string;
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

/**
 * A counting semaphore that refuses rather than queues.
 *
 * Queueing is the wrong answer for an expensive endpoint: the client is already
 * holding a connection open, and adding an unbounded wait line converts a load
 * spike into a pile of requests that all time out at once. Saying "too busy,
 * come back" immediately is both cheaper and more honest.
 */
export class ConcurrencyGate {
  readonly limit: number;
  #inFlight = 0;

  constructor(limit: number) {
    this.limit = Math.max(1, limit);
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  /** A release function, or null when the gate is full. Release is idempotent. */
  tryAcquire(): (() => void) | null {
    if (this.#inFlight >= this.limit) return null;
    this.#inFlight++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#inFlight--;
    };
  }
}
