/**
 * A very short-lived probe cache.
 *
 * It exists for one case: the double-click, and the React strict-mode double
 * render. Both fire two identical probes within a second, and a browser probe
 * costs ~15 s and ~300 MB, so serving the second from memory is worth real
 * money.
 *
 * It is capped at 60 s (`PROBE_CACHE_TTL_CEILING_MS`) because a `ProbeResult`
 * contains signed media URLs that commonly expire in 30–300 s (analysis §5).
 * A longer TTL would hand out links that are already dead, which is strictly
 * worse than not caching: the client would be told the download failed rather
 * than waiting a few more seconds for a fresh answer.
 *
 * **The job pipeline never reads this.** Jobs always re-probe — that is what
 * the `probing` state is for. This cache serves the `/api/probe` route alone.
 */

import type { ProbeResult } from "@downloader/contract";

interface Entry {
  probe: ProbeResult;
  storedAtMs: number;
}

export interface ProbeCacheOptions {
  ttlMs: number;
  /** Bounds memory: a probe result with many variants is not small. */
  maxEntries?: number;
  now?: () => number;
}

export class ProbeCache {
  readonly #entries = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: ProbeCacheOptions) {
    this.#ttlMs = Math.max(0, options.ttlMs);
    this.#maxEntries = Math.max(1, options.maxEntries ?? 200);
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(url: string): ProbeResult | null {
    if (this.#ttlMs === 0) return null;
    const entry = this.#entries.get(url);
    if (entry === undefined) return null;
    if (this.#now() - entry.storedAtMs >= this.#ttlMs) {
      this.#entries.delete(url);
      return null;
    }
    // Refresh recency for the LRU eviction below without extending the TTL —
    // the expiry is about the URLs inside, not about how popular the entry is.
    this.#entries.delete(url);
    this.#entries.set(url, entry);
    return entry.probe;
  }

  set(url: string, probe: ProbeResult): void {
    if (this.#ttlMs === 0) return;
    this.#entries.delete(url);
    this.#entries.set(url, { probe, storedAtMs: this.#now() });
    while (this.#entries.size > this.#maxEntries) {
      // Map iteration is insertion-ordered, so the first key is the least
      // recently used.
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  delete(url: string): void {
    this.#entries.delete(url);
  }

  clear(): void {
    this.#entries.clear();
  }
}
