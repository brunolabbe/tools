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
import { portFor, TlsRejectionLog } from "../src/tls-rejections.ts";

/**
 * The port every test below means unless it says otherwise: what `portFor`
 * derives for an ordinary `https://host/`, and what a `CONNECT` authority for
 * one carries. Named rather than inlined so the cross-port tests at the end
 * read as the exception they are.
 */
const HTTPS = 443;

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

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
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

    expect(log.since("cdn.example", HTTPS, startedAt)).toBeUndefined();
  });

  test("another host's refusal is not borrowed", () => {
    const log = new TlsRejectionLog();
    const startedAt = Date.now();
    log.record("other.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBeUndefined();
  });

  test("the two spellings of an IPv6 host are the same host", () => {
    // The proxy files it from a CONNECT authority (`::1`) and a resolver asks
    // with `URL.hostname` (`[::1]`). Unnormalised, the browser tier would
    // simply never match on an IPv6 origin, silently.
    const log = new TlsRejectionLog();
    const startedAt = Date.now();
    log.record("::1", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("[::1]", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("case does not decide whether a host matches", () => {
    const log = new TlsRejectionLog();
    const startedAt = Date.now();
    log.record("CDN.Example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("a page naming many refused origins evicts the oldest, not the newest", () => {
    const log = new TlsRejectionLog({ max: 3 });
    const startedAt = Date.now();
    for (const host of ["a.example", "b.example", "c.example", "d.example"]) {
      log.record(host, "DEPTH_ZERO_SELF_SIGNED_CERT");
    }

    expect(log.since("a.example", HTTPS, startedAt)).toBeUndefined();
    expect(log.since("d.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(log.since("b.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("re-recording a host keeps it, rather than letting it age out under load", () => {
    const log = new TlsRejectionLog({ max: 2 });
    const startedAt = Date.now();
    log.record("keeps.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    log.record("filler.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    // Touching it again moves it to the end of the eviction order.
    log.record("keeps.example", "CERT_HAS_EXPIRED");
    log.record("pushes.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("filler.example", HTTPS, startedAt)).toBeUndefined();
    expect(log.since("keeps.example", HTTPS, startedAt)).toBe("CERT_HAS_EXPIRED");
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
    log.recordOtherFailure("cdn.example", HTTPS);

    expect(log.since("cdn.example", HTTPS, startedAt)).toBeUndefined();
  });

  test("the order does not matter — other-first still blocks it", () => {
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.recordOtherFailure("cdn.example", HTTPS);
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBeUndefined();
  });

  test("a non-certificate refusal from before the caller started does not block it", () => {
    // Symmetric with the certificate half's own staleness rule: an unrelated
    // failure that finished before this call began cannot be concurrent with
    // it, whatever it was.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    log.recordOtherFailure("cdn.example", HTTPS);
    time.advance(600_000);
    const startedAt = time.now();
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("a non-certificate refusal on a different host does not block it", () => {
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    log.recordOtherFailure("other.example", HTTPS);

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
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

    expect(log.since("cdn.example", HTTPS, firstStartedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(log.since("cdn.example", HTTPS, secondStartedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("an evicted other-failure entry stops blocking, same as any other cache", () => {
    const log = new TlsRejectionLog({ max: 1 });
    const startedAt = Date.now();
    log.recordOtherFailure("cdn.example", HTTPS);
    // Evicts cdn.example's other-failure entry — the cap applies to this map
    // independently, exactly as it does to the certificate one.
    log.recordOtherFailure("filler.example", HTTPS);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });
});

/**
 * dl-38: the third outcome. `recordOtherFailure` above tracks the case where
 * two *failing* outcomes collide on one host; a host that answered one
 * connection cleanly while refusing another was recorded nowhere, so `since`
 * saw a lone certificate refusal and reattached it to a caller whose own
 * connection had worked.
 *
 * The load-balanced origin this is about: one hostname, two backends, one
 * serving a broken certificate and one healthy. The healthy backend's caller
 * reaches `NO_MEDIA_FOUND` on its own terms — no extractor for the page — and
 * must keep that verdict.
 *
 * **Half of these tests assert that reattachment still happens**, and that is
 * deliberate: recording successes moves this file measurably closer to
 * "suppress whenever anything else touched the host", which the header rejects
 * by name. A suite that only ever asserted `toBeUndefined()` would stay green
 * for a `since` that had stopped answering at all.
 */
describe("a host that both worked and was refused inside one window (dl-38)", () => {
  test("a successful CONNECT recorded in the caller's window blocks reattachment", () => {
    // The ticket's scenario, at this file's own level: job A lands on the
    // broken backend and is cert-refused; job B lands on the healthy one and
    // its CONNECT completes. B's own window contains both, so B is told
    // nothing rather than told it was the certificate.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    time.advance(5);
    log.recordSuccess("cdn.example", HTTPS);

    expect(log.since("cdn.example", HTTPS, startedAt)).toBeUndefined();
  });

  test("the order does not matter — success first still blocks it", () => {
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.recordSuccess("cdn.example", HTTPS);
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBeUndefined();
  });

  test("a success from before the caller started does not block it", () => {
    // The staleness rule applied to the third map, and the first of the
    // over-suppression guards: successes accumulate on a long-lived log, so
    // without this every host that has ever worked would be permanently
    // unenrichable — the whole feature, silently off.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    log.recordSuccess("cdn.example", HTTPS);
    time.advance(600_000);
    const startedAt = time.now();
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("a success on a different host does not block it", () => {
    // A page loads its own origin fine and its media host is refused: the
    // ordinary shape of what dl-34 exists to name, and it must stay named.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    log.recordSuccess("page.example", HTTPS);

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("an evicted success entry stops blocking, same as any other cache", () => {
    const log = new TlsRejectionLog({ max: 1 });
    const startedAt = Date.now();
    log.recordSuccess("cdn.example", HTTPS);
    // Evicts cdn.example's success entry — the cap applies to this map
    // independently, exactly as it does to the other two.
    log.recordSuccess("filler.example", HTTPS);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("the two spellings of an IPv6 host are the same host here too", () => {
    // The proxy files a success from a CONNECT authority (`::1`) and the
    // resolver asks with `URL.hostname` (`[::1]`). Unnormalised, this map
    // would be the one place the suppression silently never fires.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    log.record("::1", "DEPTH_ZERO_SELF_SIGNED_CERT");
    log.recordSuccess("::1", HTTPS);

    expect(log.since("[::1]", HTTPS, startedAt)).toBeUndefined();
  });
});

/**
 * The residual dl-38 first shipped documented and the owner then asked to fix:
 * one hostname answering on two ports, healthy on one and broken on the other.
 *
 * The rule these pin is **"could this outcome have been the caller's own
 * connection?"** — so the two conflict maps are keyed by host *and* port while
 * the certificate map is not. The last test in this block is the one that keeps
 * the asymmetry honest: narrowing the conflict key must not narrow the
 * reattachment.
 */
describe("one hostname answering on two ports", () => {
  const ALT = 8443;

  test("a success on :443 does not suppress a refusal the caller met on :8443", () => {
    // The owner's case. Two endpoints of one hostname, one healthy and one
    // serving a broken certificate; the caller is the one that met the broken
    // one and must still be told which.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    time.advance(5);
    log.recordSuccess("cdn.example", HTTPS);

    expect(log.since("cdn.example", ALT, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("a success on :443 still suppresses it for the caller that asked about :443", () => {
    // The other half of the same case, and the guard that this fix did not
    // simply undo dl-38: the caller whose own connection was the one that
    // worked keeps its own verdict.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    time.advance(5);
    log.recordSuccess("cdn.example", HTTPS);

    expect(log.since("cdn.example", HTTPS, startedAt)).toBeUndefined();
  });

  test("a non-certificate failure on :443 does not suppress a refusal on :8443 either", () => {
    // dl-37's conflict map gets the same rule, because it answers the same
    // question. A dead upstream on one port is not evidence about another.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    time.advance(5);
    log.recordOtherFailure("cdn.example", HTTPS);

    expect(log.since("cdn.example", ALT, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    // Still ambiguous for the caller it could have belonged to.
    expect(log.since("cdn.example", HTTPS, startedAt)).toBeUndefined();
  });

  test("a certificate refusal is still carried across ports", () => {
    // **The anti-regression, and the reason the certificate map keeps its
    // host-only key.** A page on :443 whose media is refused on :8443 is a
    // trust problem, and dl-34's whole point is that it gets named. Keying
    // this map by port too would have bought the tests above by losing this,
    // which is the wrong trade in the direction this file cares about.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now });

    const startedAt = time.now();
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(log.since("cdn.example", ALT, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("the two ports are two entries, not one that overwrites the other", () => {
    // Read through the eviction cap, which is the only way to observe the
    // number of entries from outside. `max: 1` keeps the most recent, so
    // recording :443 and then :8443 leaves *only* :8443 — and the :443 caller
    // gets its reattachment back. A log that keyed both ports as one host
    // would have one entry that both callers hit, and would suppress both.
    const time = clock();
    const log = new TlsRejectionLog({ now: time.now, max: 1 });

    const startedAt = time.now();
    time.advance(5);
    log.record("cdn.example", "DEPTH_ZERO_SELF_SIGNED_CERT");
    log.recordSuccess("cdn.example", HTTPS);
    log.recordSuccess("cdn.example", ALT);

    expect(log.since("cdn.example", HTTPS, startedAt)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(log.since("cdn.example", ALT, startedAt)).toBeUndefined();
  });
});

/**
 * The derivation that makes the two sides agree at all: `URL.port` is empty
 * for a default port and a `CONNECT` authority always carries an explicit
 * number, so a resolver asking about `https://host/` has to say 443 out loud.
 */
describe("portFor", () => {
  test("an https URL with no port means 443", () => {
    expect(portFor(new URL("https://cdn.example/watch"))).toBe(443);
  });

  test("an explicit port is used as written", () => {
    expect(portFor(new URL("https://cdn.example:8443/watch"))).toBe(8443);
  });

  test("an http URL with no port means 80", () => {
    // Nothing records a certificate refusal on this path — the proxy's
    // plain-HTTP handler fires no hooks at all — but a resolver may still ask,
    // and it must not accidentally collide with the 443 entry.
    expect(portFor(new URL("http://cdn.example/watch"))).toBe(80);
  });

  test("an IPv6 URL keeps its port and its brackets are the log's problem, not this one", () => {
    expect(portFor(new URL("https://[::1]:8443/watch"))).toBe(8443);
  });
});
