/**
 * The certificates the tiers' egress proxy refused, so the tier's own failure
 * can be named instead of guessed at.
 *
 * ## Why a side channel exists at all
 *
 * dl-27 gave a refused `CONNECT` one channel out: the status line,
 * `502 TLS certificate verification failed (<verify code>)`. That is enough for
 * the two clients that quote it — ffmpeg echoes a proxy's status line at
 * warning level, and yt-dlp reports
 * `Tunnel connection failed: 502 TLS certificate verification failed (…)`
 * verbatim. It is not enough for Chromium, and dl-37 measured the difference:
 * **every non-200 CONNECT response reaches Playwright as the single token
 * `net::ERR_TUNNEL_CONNECTION_FAILED`**, so a refused certificate, an SSRF
 * block and a dead upstream are one string by the time the browser tier sees
 * them.
 *
 * Before dl-37 that did not matter, because the tiers were behind a *tunnelling*
 * proxy: they met the origin certificate themselves and named the failure
 * themselves, which is all of dl-34's half two. Moving them onto a terminating
 * proxy takes that away — this proxy now meets the certificate and the tier only
 * sees a proxy that said no. Without something here, dl-34's fix silently
 * regresses to "The site could not be reached", on a *retryable* code, for a
 * trust problem: the exact sentence dl-34's `## Why` calls the worst available
 * one.
 *
 * ## Why matching by host is honest, and where it gives up
 *
 * `egress-proxy.ts`'s header states the constraint this works within: one proxy
 * serves every download and nothing in a request identifies the caller. So a
 * rejection cannot be attributed to a *job*, and this does not try to. It
 * matches on two things a resolver does know — the host it asked for, and the
 * window its own attempt ran in — and `resolvers.ts` reads it with the resolve
 * call's own start time, so a record left by an earlier probe cannot be
 * borrowed.
 *
 * What is left is a collision between two concurrent probes of the **same host**
 * inside one window, and that one is benign in the only direction it can
 * happen: two probes of one host meet one origin certificate and get one
 * verdict. What it does not catch is a page that redirects to another host and
 * is refused there — the rejection is filed under the second host and the probe
 * asked about the first, so nothing matches and the tier keeps whatever verdict
 * it had. That is the same under-matching direction `tls-verification.ts`
 * argues for: a certificate failure missed here stays today's bug, while a
 * network blip claimed here would be a new one.
 */

/** How many hosts are remembered. Small on purpose — see `record`. */
const DEFAULT_MAX_ENTRIES = 64;

export interface TlsRejectionLogOptions {
  /** Injected by tests, and by nothing else. */
  now?: () => number;
  max?: number;
}

/**
 * A hostname as both sides spell it.
 *
 * The proxy's key comes from a `CONNECT` authority and a resolver's from
 * `URL.hostname`, and the two disagree about IPv6: `parseAuthority` unwraps
 * `[::1]:443` to `::1` while `new URL("https://[::1]/").hostname` keeps the
 * brackets. Normalising both here is a line; discovering it as a tier that
 * never matches is an afternoon.
 */
function key(host: string): string {
  const trimmed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return trimmed.toLowerCase();
}

export class TlsRejectionLog {
  readonly #entries = new Map<string, { code: string; at: number }>();
  readonly #now: () => number;
  readonly #max: number;

  constructor(options: TlsRejectionLogOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#max = options.max ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Files a refusal against a host, evicting the oldest once the cap is
   * reached.
   *
   * Bounded rather than swept on a timer because this is fed by a hostile
   * page's own subresource fetches — a page naming a thousand refused origins
   * must cost a thousand nothing. Insertion order is the eviction order, and
   * re-recording a host moves it to the end, so the hosts a run is actually
   * failing on are the ones that survive.
   */
  record(host: string, code: string): void {
    const name = key(host);
    this.#entries.delete(name);
    this.#entries.set(name, { code, at: this.#now() });
    while (this.#entries.size > this.#max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  /**
   * The verify code this proxy refused `host` with **during** the caller's own
   * attempt, or `undefined`.
   *
   * `at` is a start time rather than a duration, which is what makes this
   * self-expiring: there is no TTL to tune and no sweep to run, because a
   * record older than the call that is asking is by construction not about it.
   */
  since(host: string, at: number): string | undefined {
    const entry = this.#entries.get(key(host));
    return entry !== undefined && entry.at >= at ? entry.code : undefined;
  }
}
