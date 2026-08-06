export interface BackoffOptions {
  initialMs: number;
  maxMs: number;
  factor: number;
  /** Fraction of the base delay to spread the retry over, in [0, 1). */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  initialMs: 500,
  maxMs: 15_000,
  factor: 2,
  jitter: 0.25,
};

/**
 * Delay before retry number `attempt` (1-based).
 *
 * `random` is injected so tests are deterministic; 0.5 is the no-jitter point,
 * which makes the exponential schedule exactly reproducible.
 */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(options.initialMs * options.factor ** exponent, options.maxMs);
  const spread = base * options.jitter * (random() * 2 - 1);
  return Math.max(0, Math.round(Math.min(base + spread, options.maxMs)));
}
