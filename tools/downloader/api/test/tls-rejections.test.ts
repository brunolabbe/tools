/**
 * dl-37: the side channel that keeps dl-34's verdict alive once the tiers stop
 * meeting origin certificates themselves.
 *
 * The behaviour worth pinning is not "it remembers a string" — it is the three
 * bounds that make remembering one safe. It must not answer for a refusal that
 * happened before the caller started asking, because a resolver that returns
 * `NO_MEDIA_FOUND` for an ordinary reason would otherwise inherit a stale
 * verdict and stop the chain; it must not grow without limit, because what
 * feeds it is a hostile page's own subresource fetches; and — confirmed by
 * measuring a real Chromium against every status this proxy can answer a
 * `CONNECT` with (`egress-proxy.test.ts`'s own committed measurement) — it must
 * refuse to answer at all when a non-certificate refusal landed on the same
 * host in the same window, because `net::ERR_TUNNEL_CONNECTION_FAILED` is what
 * Chromium reports for every one of them and nothing in it says which.
 */

import { describe, expect, test } from "vitest";
import { TlsRejectionLog } from "../src/tls-rejections.ts";

function clock(): { now: () => number; advance: (ms: number) => void } {
  let value = 1_000;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

describe("what the tiers' proxy refused", () => {
  test("a refusal inside the caller's own window is reported", () => {
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(50);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("a refusal from before the caller started is not", () => {
    // The failure this exists to prevent: yt-dlp returning `NO_MEDIA_FOUND`
    // because a site has no extractor, ten minutes after some other probe was
    // refused on the same host, and being upgraded to `TLS_VERIFICATION_FAILED`
    // — which stops the resolver chain and never reaches the browser tier.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    time.advance(600_000);
    const startedAt = time.now();

    expect(log.since("cdn.example", startedAt)).toBeUndefined();
  });

  test("another host's refusal is not borrowed", () => {
    const log = new TlsRejectionLog();
    const startedAt = Date.now();
    log.record("other.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", startedAt)).toBeUndefined();
  });

  test("the two spellings of an IPv6 host are the same host", () => {
    // The proxy files it from a CONNECT authority (`::1`) and a resolver asks
    // with `URL.hostname` (`[::1]`). Unnormalised, the browser tier would
    // simply never match on an IPv6 origin, silently.
    const log = new TlsRejectionLog();
    const startedAt = Date.now();
    log.record("::1", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("[::1]", startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("case does not decide whether a host matches", () => {
    const log = new TlsRejectionLog();
    const startedAt = Date.now();
    log.record("CDN.Example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("a page naming many refused origins evicts the oldest, not the newest", () => {
    const log = new TlsRejectionLog({ max: 3 });
    const startedAt = Date.now();
    for (const host of ["a.example", "b.example", "c.example", "d.example"]) {
      log.record(host, "DEPTH_ZERO_SELF_SIGNED_CERT");
    }

    expect(log.since("a.example", startedAt)).toBeUndefined();
    expect(log.since("d.example", startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(log.since("b.example", startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("re-recording a host keeps it, rather than letting it age out under load", () => {
    const log = new TlsRejectionLog({ max: 2 });
    const startedAt = Date.now();
    log.record("keeps.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    log.record("filler.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    // Touching it again moves it to the end of the eviction order.
    log.record("keeps.example", "CERT_HAS_EXPIRED");
    log.record("pushes.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("filler.example", startedAt)).toBeUndefined();
    expect(log.since("keeps.example", startedAt)).toBe("CERT_HAS_EXPIRED");
  });
});

/**
 * The concurrency/identity gap a gate found: `since` matches by host and
 * window, not by call, so two concurrent probes of one host are only safe to
 * enrich when every outcome the proxy produced for that host in the window was
 * a certificate refusal. `egress-proxy.test.ts`'s
 * `"a policy block, a leaf failure, a dead upstream and two certificate
 * refusals are one message"` is the committed measurement this design rests
 * on: a real Chromium reports the identical `net::ERR_TUNNEL_CONNECTION_FAILED`
 * for all five, so a tier cannot tell "my own CONNECT was cert-refused" from "a
 * concurrent CONNECT to the same host failed for an unrelated reason while
 * mine did too" on the message alone.
 */
describe("what happens when the same host produced more than one outcome", () => {
  test("a non-certificate refusal recorded in the caller's window blocks reattachment", () => {
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    time.advance(5);
    // A different, concurrent probe of the same host was blocked by policy, or
    // met a dead upstream — either way, not a certificate problem, and this
    // caller's own `UNREACHABLE` could be either one.
    log.recordOtherFailure("cdn.example");

    expect(log.since("cdn.example", startedAt)).toBeUndefined();
  });

  test("the order does not matter — other-first still blocks it", () => {
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.recordOtherFailure("cdn.example");
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", startedAt)).toBeUndefined();
  });

  test("a non-certificate refusal from before the caller started does not block it", () => {
    // Symmetric with the certificate half's own staleness rule: an unrelated
    // failure that finished before this call began cannot be concurrent with
    // it, whatever it was.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    log.recordOtherFailure("cdn.example");
    time.advance(600_000);
    const startedAt = time.now();
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("a non-certificate refusal on a different host does not block it", () => {
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    log.recordOtherFailure("other.example");

    expect(log.since("cdn.example", startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("two genuine certificate refusals on one host, with no other outcome, both enrich", () => {
    // The case a coarser fix (suppress whenever more than one request to a
    // host is in flight) would have broken: an operator's single broken
    // private-root origin, probed twice concurrently, is exactly the common
    // case dl-37 exists to serve, and no non-certificate outcome was ever
    // recorded for this host at all.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const firstStartedAt = time.now();
    time.advance(1);
    const secondStartedAt = time.now();
    time.advance(1);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", firstStartedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(log.since("cdn.example", secondStartedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("an evicted other-failure entry stops blocking, same as any other cache", () => {
    const log = new TlsRejectionLog({ max: 1 });
    const startedAt = Date.now();
    log.recordOtherFailure("cdn.example");
    // Evicts cdn.example's other-failure entry — the cap applies to this map
    // independently, exactly as it does to the certificate one.
    log.recordOtherFailure("filler.example");
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });
});
