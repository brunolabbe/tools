/**
 * dl-37: the side channel that keeps dl-34's verdict alive once the tiers stop
 * meeting origin certificates themselves.
 *
 * The behaviour worth pinning is not "it remembers a string" — it is the two
 * bounds that make remembering one safe. It must not answer for a refusal that
 * happened before the caller started asking, because a resolver that returns
 * `NO_MEDIA_FOUND` for an ordinary reason would otherwise inherit a stale
 * verdict and stop the chain; and it must not grow without limit, because what
 * feeds it is a hostile page's own subresource fetches.
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
