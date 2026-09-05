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
 * What it does not catch is a page that redirects to another host and is
 * refused there — the rejection is filed under the second host and the probe
 * asked about the first, so nothing matches and the tier keeps whatever verdict
 * it had. That is the same under-matching direction `tls-verification.ts`
 * argues for: a certificate failure missed here stays today's bug, while a
 * network blip claimed here would be a new one.
 *
 * ## The collision two concurrent probes of one host can produce, and why one
 * outcome-kind alone is not enough to tell them apart
 *
 * A `CONNECT` to a host does not fail only one way. This proxy also refuses one
 * for an SSRF-blocked target (403), a dead upstream (502) and a leaf it could
 * not issue (500) — three non-certificate shapes — on top of a genuine
 * certificate refusal (502). Measured against a real Chromium: a bare CONNECT
 * proxy handed every one of those three non-certificate statuses, plus two
 * different certificate-refusal messages, and Playwright reported the
 * **identical** `net::ERR_TUNNEL_CONNECTION_FAILED` for all five.
 * So two concurrent probes of the same host — one genuinely cert-refused, one
 * refused or failed for an unrelated reason — are indistinguishable to the tier
 * that asks, and reattaching the recorded cert code to whichever one asks first
 * would be a coin flip rather than an inference.
 *
 * `recordOtherFailure` is what closes it. A caller is told the cert code only
 * when **every** refusal recorded for that host inside its window was a
 * certificate refusal — if a non-certificate one was recorded too, `since`
 * returns `undefined` rather than guess, which degrades that call back to its
 * own raw verdict. That is the safe direction on purpose: a suppressed
 * enrichment is the pre-dl-37 experience for this one ambiguous case, and a
 * wrong one is new.
 *
 * The alternative that was not built: suppressing reattachment whenever
 * **more than one** request to a host is in flight, whatever the outcomes. It
 * was rejected because it is wrong on the *common* case this ticket serves —
 * an operator with one broken private-root origin, probed twice concurrently,
 * both genuinely cert-refused — which it would silently degrade for both,
 * where outcome-tracking correctly enriches both because no non-certificate
 * refusal was ever recorded for that host at all.
 *
 * ## The success this used to be blind to (dl-38)
 *
 * Until dl-38 the two maps above tracked *failures* only, and a load-balanced
 * origin with one broken backend and one healthy one, probed concurrently, was
 * not covered: the broken backend's `CONNECT` is refused and recorded as a
 * certificate rejection, as intended, but the healthy backend's own connection
 * completes cleanly and the tier can then legitimately return `NO_MEDIA_FOUND`
 * on its own terms — no extractor for that page, nothing to do with
 * certificates. With that success recorded nowhere, `since` saw only the
 * genuine certificate rejection in the window and no conflicting outcome, and
 * reattached `TLS_VERIFICATION_FAILED` onto a verdict that had nothing to do
 * with TLS.
 *
 * `recordSuccess` closes it, and the rule it joins is the one already here
 * rather than a new one: **more than one kind of outcome for a host inside a
 * caller's window means this cannot tell which one was the caller's**, so it
 * declines. A success is a kind of outcome.
 *
 * **Why that is not the "suppress on any concurrent request" rule rejected
 * above.** That rule counts *requests*; this one counts outcomes that
 * disagree. The common case dl-37 serves — one broken private-root origin,
 * probed twice concurrently, both genuinely cert-refused — records two
 * certificate refusals and nothing else, so both still enrich. The test named
 * `"two genuine certificate refusals on one host, with no other outcome, both
 * enrich"` is that case, and it is the guard on this file's whole design.
 *
 * ## Which outcomes are the same endpoint's, and why the three maps are not
 * keyed alike
 *
 * The two conflict maps ask one question — **could this outcome have been the
 * caller's own connection?** — and only an outcome that could have been counts
 * as ambiguity. So they are keyed by `host` **and port**, while the certificate
 * map stays keyed by host alone. That asymmetry is the design and not an
 * oversight:
 *
 * - **A certificate refusal is evidence about a host's trust**, and carrying it
 *   across ports is the direction this file spends its whole budget on. A page
 *   on `:443` whose media is refused on `:8443` is a trust problem, and losing
 *   dl-34's sentence for it would be the failure, not the fix.
 * - **A success, or an unrelated failure, is evidence about the one endpoint
 *   that produced it.** A connection to `:443` that worked cannot have been the
 *   connection to `:8443` that was refused, so it creates no ambiguity about it
 *   and must not suppress it.
 *
 * What that buys, stated as the property rather than as the mechanism:
 * **`since` reattaches at least as often as it did before any of the conflict
 * tracking existed.** Narrowing a conflict's key can only shrink the set of
 * recorded outcomes that count against a reattachment, never grow it — so no
 * verdict dl-34 or dl-37 delivers today stops being delivered, and the change
 * is only ever fewer spurious suppressions.
 *
 * The port a resolver asks with is derived by `portFor`, because `URL.port` is
 * empty for a default port where a `CONNECT` authority always carries one —
 * the mismatch that made host-only keying look like the safe option until the
 * asymmetry above made it unnecessary.
 */

/** How many hosts are remembered, per kind. Small on purpose — see `record`. */
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

/**
 * One endpoint, for the two maps that are about endpoints rather than hosts.
 *
 * `|` rather than `:`, because a normalised IPv6 host is full of colons and
 * `::1:443` reads as an address rather than as an address and a port. Nothing
 * a `CONNECT` authority or a `URL.hostname` can produce contains a `|`, so the
 * split is unambiguous even though nothing ever splits it.
 */
function endpoint(host: string, port: number): string {
  return `${key(host)}|${String(port)}`;
}

/**
 * The port a resolver's URL means, spelled the way a `CONNECT` authority spells
 * it.
 *
 * `URL.port` is the empty string for a default port and `parseAuthority` always
 * yields an explicit number, so without this the two sides never agree on an
 * ordinary `https://host/` — which is the mismatch that made keying by port
 * look unaffordable before the header's asymmetry made it cheap.
 */
export function portFor(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

/**
 * Inserts-or-touches `name` in `map`, moving it to the most-recently-used end,
 * and evicts the oldest once `max` is exceeded.
 *
 * Shared by all three kinds of record `TlsRejectionLog` keeps, so the eviction
 * policy — and any future fix to it — cannot drift between them. It takes an
 * already-computed key rather than a host, because the three do not agree on
 * what a key is: see the header. Bounded rather than swept on a timer because
 * this is fed by a hostile page's own subresource fetches — a page naming a
 * thousand refused origins must cost a thousand nothing, not a timer's worth of
 * memory.
 */
function touch<V>(map: Map<string, V>, name: string, value: V, max: number): void {
  map.delete(name);
  map.set(name, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done === true) break;
    map.delete(oldest.value);
  }
}

export class TlsRejectionLog {
  /** Latest certificate refusal per **host** — see the header's asymmetry. */
  readonly #certificates = new Map<string, { code: string; at: number }>();
  /** Latest non-certificate refusal per **endpoint** — see `recordOtherFailure`. */
  readonly #otherFailures = new Map<string, number>();
  /** Latest successful CONNECT per **endpoint** — see `recordSuccess`. */
  readonly #successes = new Map<string, number>();
  readonly #now: () => number;
  readonly #max: number;

  constructor(options: TlsRejectionLogOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#max = options.max ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Files a certificate refusal against a host.
   *
   * Re-recording a host moves it to the end of this map's eviction order, so
   * the hosts a run is actually failing on are the ones that survive.
   *
   * **Takes no port, and that is the header's asymmetry rather than an
   * omission.** A refused certificate is a fact about the host's trust that is
   * worth carrying to a caller asking about another of its ports; the two
   * conflict maps below are the ones that must not.
   */
  record(host: string, code: string): void {
    touch(this.#certificates, key(host), { code, at: this.#now() }, this.#max);
  }

  /**
   * Files that this proxy refused or failed `host`'s `CONNECT` for a reason
   * that was **not** a certificate — an SSRF block, a dead upstream, a leaf
   * this proxy could not issue.
   *
   * Exists only to make `since` refuse to guess. See the header's "collision"
   * section for why a code recorded here has to count against reattachment
   * even though this method never hands one back, and its "which outcomes are
   * the same endpoint's" section for why `port` is part of the key.
   */
  recordOtherFailure(host: string, port: number): void {
    touch(this.#otherFailures, endpoint(host, port), this.#now(), this.#max);
  }

  /**
   * Files that this proxy **completed** a `CONNECT` to `host` — in terminating
   * mode, that it verified the origin's certificate and issued a leaf for it.
   *
   * Exists for the same reason `recordOtherFailure` does and counts the same
   * way: it is a second kind of outcome for **this endpoint**, so a certificate
   * refusal recorded beside it inside one caller's window is not attributable
   * to that caller. See the header's dl-38 section for the load-balanced origin
   * this closes, why counting outcomes is not the same as counting requests,
   * and why a success on `:443` says nothing about a refusal on `:8443`.
   */
  recordSuccess(host: string, port: number): void {
    touch(this.#successes, endpoint(host, port), this.#now(), this.#max);
  }

  /**
   * The verify code this proxy refused `host` with **during** the caller's own
   * attempt, or `undefined` — including when it will not guess.
   *
   * `at` is a start time rather than a duration, which is what makes the
   * certificate half self-expiring: there is no TTL to tune and no sweep to
   * run, because a record older than the call that is asking is by
   * construction not about it. The same rule is applied to
   * `#otherFailures` and to `#successes`: an outcome of either kind recorded
   * **inside** the same window means this endpoint produced more than one
   * outcome during it, which is exactly the case a real Chromium cannot tell
   * apart from a certificate refusal on its own — so this returns `undefined`
   * rather than reattach a code that might belong to the other outcome. A
   * success from before the window is as irrelevant as a stale refusal, by the
   * same rule and for the same reason.
   *
   * `port` scopes the two conflict lookups and deliberately not the certificate
   * one. `resolvers.ts` derives it with `portFor`; see the header for why the
   * three maps are not keyed alike.
   */
  since(host: string, port: number, at: number): string | undefined {
    const entry = this.#certificates.get(key(host));
    if (entry === undefined || entry.at < at) return undefined;
    const here = endpoint(host, port);
    const otherAt = this.#otherFailures.get(here);
    if (otherAt !== undefined && otherAt >= at) return undefined;
    const successAt = this.#successes.get(here);
    if (successAt !== undefined && successAt >= at) return undefined;
    return entry.code;
  }
}
