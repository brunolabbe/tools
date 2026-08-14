/**
 * Retry policy.
 *
 * Exponential backoff **with jitter**. The jitter is not decoration: a manifest
 * with 400 segments that all fail at once because a CDN edge hiccuped will,
 * without it, retry all 400 at the same instant and hiccup the edge again. The
 * randomisation source is injectable so the sequence is assertable in a test.
 *
 * `Retry-After` always wins over the computed backoff. A server that tells us
 * when to come back knows more than our formula does.
 */

import { AppError } from "@downloader/contract";

export interface RetryPolicy {
  /** Total attempts including the first. `1` disables retrying. */
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
  /** Fraction of the computed delay that is randomised away, 0..1. */
  jitter: number;
  random: () => number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseMs: 500,
  maxMs: 30_000,
  jitter: 0.5,
  random: Math.random,
};

export function resolveRetryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...overrides };
}

/**
 * Delay before attempt `attempt` (1-based; attempt 1 is the first retry).
 * Doubles from `baseMs`, capped at `maxMs`, then scaled down by up to `jitter`.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy): number {
  const exponent = Math.max(0, attempt - 1);
  const uncapped = policy.baseMs * 2 ** exponent;
  const capped = Math.min(policy.maxMs, uncapped);
  const jitter = Math.min(1, Math.max(0, policy.jitter));
  const factor = 1 - jitter + jitter * policy.random();
  return Math.round(capped * factor);
}

/**
 * `Retry-After` is either delta-seconds or an HTTP-date. Returns milliseconds
 * from `nowMs`, or null when the header is absent or unparsable.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (header === null || header === undefined) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/u.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

export interface RetryContext {
  attempt: number;
  error: unknown;
  delayMs: number;
}

export interface WithRetryOptions {
  policy?: Partial<RetryPolicy>;
  signal?: AbortSignal | undefined;
  /** Injected so tests drive it with fake timers rather than real sleeping. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Default: `AppError.retryable`. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Server-directed delay, e.g. from `Retry-After`. Overrides the backoff. */
  retryDelayFor?: (error: unknown) => number | null;
  onRetry?: (context: RetryContext) => void;
}

function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof AppError) {
    // Cancellation is a decision, not a fault.
    if (error.code === "JOB_CANCELED") return false;
    return error.retryable;
  }
  return false;
}

/** Reads a server-directed delay stashed on the error by the HTTP layer. */
export function retryAfterFromError(error: unknown): number | null {
  if (!(error instanceof AppError)) return null;
  const value = error.details?.["retryAfterMs"];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const policy = resolveRetryPolicy(options.policy);
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const retryDelayFor = options.retryDelayFor ?? retryAfterFromError;

  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (options.signal?.aborted === true) throw new AppError("JOB_CANCELED");
    try {
      return await operation(attempt);
    } catch (error: unknown) {
      lastError = error;
      const isLast = attempt >= policy.maxAttempts;
      if (isLast || !shouldRetry(error, attempt)) throw error;

      const directed = retryDelayFor(error);
      const delayMs = directed ?? backoffDelayMs(attempt, policy);
      options.onRetry?.({ attempt, error, delayMs });
      await options.sleep(delayMs, options.signal);
    }
  }

  throw AppError.from(lastError);
}
