/**
 * A per-client concurrency cap: bounds how much of an expensive resource *one
 * caller* may hold at once, as opposed to `@webtools/core`'s `ConcurrencyGate`,
 * which bounds the resource server-wide with no notion of who is asking.
 *
 * The two compose rather than overlap (dl-51): a request that survives the
 * global gate can still be over its own client's cap, and a request under its
 * client's cap can still find the global gate full. Each is the only thing
 * that stops the failure mode the other cannot see — the global gate cannot
 * stop one address from spending the whole thing, and a per-client cap alone
 * cannot stop a flood spread across many addresses.
 *
 * Kept here rather than lifted to `@webtools/core` alongside `ConcurrencyGate`:
 * this tool is still the only consumer, and the repo's rule is that shared code
 * moves to `packages/` on the second real consumer, not the first guess.
 */

export class PerClientConcurrencyGate {
  readonly limit: number;
  readonly #counts = new Map<string, number>();

  /** `limit` of zero or less disables the cap: every `tryAcquire` succeeds. */
  constructor(limit: number) {
    this.limit = Math.max(0, Math.trunc(limit));
  }

  get enabled(): boolean {
    return this.limit > 0;
  }

  /** In-flight count for one client. For tests and diagnostics. */
  count(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  /**
   * A release function, or `null` when this client is already at its cap.
   * Release is idempotent, like `ConcurrencyGate`'s.
   */
  tryAcquire(key: string): (() => void) | null {
    if (!this.enabled) return () => undefined;

    const current = this.#counts.get(key) ?? 0;
    if (current >= this.limit) return null;
    this.#counts.set(key, current + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.#counts.get(key) ?? 1) - 1;
      if (next <= 0) this.#counts.delete(key);
      else this.#counts.set(key, next);
    };
  }
}
