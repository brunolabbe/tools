/**
 * Rate limiting and admission control.
 *
 * Two levels, tested separately: the bucket arithmetic in isolation with an
 * injected clock (real time makes rate tests either slow or flaky, and usually
 * both), and the routes end to end, where what matters is that a refusal is a
 * well-formed 429 a client can act on rather than an opaque failure.
 */

import { ROUTES } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { createHarness, probeResult, SOURCE_URL, StubResolver } from "./helpers.ts";
import { clientKey, ConcurrencyGate, RateLimiter } from "../src/rate-limit.ts";

/** A clock the test moves by hand. */
function fakeClock(startMs = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("RateLimiter", () => {
  test("spends a full minute's burst, then refuses", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perMinute: 3, now: clock.now });

    for (let call = 0; call < 3; call++) {
      expect(limiter.check("a").allowed, `call ${call}`).toBe(true);
    }
    const refused = limiter.check("a");
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.limit).toBe(3);
  });

  test("refills continuously rather than in steps", () => {
    // The reason this is a bucket and not a fixed window: a window would admit
    // 2x the limit across its boundary, which for a 15-second browser probe is
    // the difference between a limit and a suggestion.
    const clock = fakeClock();
    const limiter = new RateLimiter({ perMinute: 6, now: clock.now });

    for (let call = 0; call < 6; call++) limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);

    // 6/min is one token per 10 s.
    clock.advance(10_000);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  test("never refills past capacity, however long a client waits", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perMinute: 2, now: clock.now });

    limiter.check("a");
    clock.advance(3_600_000);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  test("retryAfterSec is the real wait, and never rounds down to zero", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perMinute: 6, now: clock.now });
    for (let call = 0; call < 6; call++) limiter.check("a");

    // Empty bucket at one token per 10 s.
    expect(limiter.check("a").retryAfterSec).toBe(10);
    clock.advance(9_500);
    // A fraction of a token short still has to be a whole second, or a client
    // that obeys the header retries into another 429.
    expect(limiter.check("a").retryAfterSec).toBe(1);
  });

  test("clients have separate buckets", () => {
    const limiter = new RateLimiter({ perMinute: 1 });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  test("perMinute of zero disables it entirely", () => {
    const limiter = new RateLimiter({ perMinute: 0 });
    expect(limiter.enabled).toBe(false);
    for (let call = 0; call < 100; call++) expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.size).toBe(0);
  });

  test("the bucket map is bounded, so it is not itself a memory attack", () => {
    const limiter = new RateLimiter({ perMinute: 60, maxKeys: 10 });
    for (let index = 0; index < 500; index++) limiter.check(`client-${index}`);
    expect(limiter.size).toBeLessThanOrEqual(10);
  });

  test("eviction drops the least recently seen client, not an arbitrary one", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perMinute: 1, maxKeys: 2, now: clock.now });

    limiter.check("keep"); // spends its only token
    limiter.check("old");
    limiter.check("keep"); // refreshes recency; "old" is now the oldest
    limiter.check("new"); // evicts "old"

    // "keep" survived with an empty bucket, so it is still refused.
    expect(limiter.check("keep").allowed).toBe(false);
    // "old" was evicted, so it starts again with a full bucket.
    expect(limiter.check("old").allowed).toBe(true);
  });
});

describe("clientKey", () => {
  test("an IPv4 address is its own bucket", () => {
    expect(clientKey("203.0.113.9")).toBe("203.0.113.9");
  });

  test("an IPv4-mapped address collapses to the IPv4 one", () => {
    // Otherwise one client holds two buckets by changing how it spells itself.
    expect(clientKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientKey("[::ffff:203.0.113.9]")).toBe("203.0.113.9");
  });

  test("IPv6 is bucketed by /64, because that is the size of one customer", () => {
    const a = clientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    const b = clientKey("2001:db8:1:2::1");
    // A host holding a /64 could otherwise rotate through 2^64 addresses and
    // never meet the limit at all.
    expect(a).toBe(b);
    expect(clientKey("2001:db8:1:3::1")).not.toBe(a);
  });

  test("a zone index does not create a second bucket", () => {
    expect(clientKey("fe80::1%eth0")).toBe(clientKey("fe80::1"));
  });

  test("an unidentifiable client shares one bucket with every other", () => {
    // The strictest available outcome, which is the right default here.
    expect(clientKey(undefined)).toBe("unknown");
    expect(clientKey("")).toBe("unknown");
    expect(clientKey("not-an-address")).toBe("unknown");
  });
});

describe("ConcurrencyGate", () => {
  test("admits up to the limit and then refuses rather than queues", () => {
    const gate = new ConcurrencyGate(2);
    const first = gate.tryAcquire();
    const second = gate.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.inFlight).toBe(2);
  });

  test("releasing frees a slot, and releasing twice does not free two", () => {
    const gate = new ConcurrencyGate(1);
    const release = gate.tryAcquire();
    release?.();
    release?.();
    expect(gate.inFlight).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });
});

describe("the routes", () => {
  test("POST /api/probe refuses past its limit, with everything a client needs", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitProbePerMinute: 2 },
    });

    try {
      const probe = async (url: string) =>
        harness.app.server.inject({ method: "POST", url: ROUTES.probe, payload: { url } });

      // Distinct URLs, or the probe cache would answer the second one for free
      // and the limiter would never see it.
      expect((await probe(`${SOURCE_URL}/1`)).statusCode).toBe(200);
      expect((await probe(`${SOURCE_URL}/2`)).statusCode).toBe(200);

      const refused = await probe(`${SOURCE_URL}/3`);
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe("RATE_LIMITED");
      expect(refused.json().error.retryable).toBe(true);
      // Both the header every HTTP client understands and the field the UI reads.
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.json().error.details.retryAfterSec).toBeGreaterThan(0);
      // `scope` is for our logs; the allowlist in http-errors.ts keeps it there.
      expect(refused.json().error.details.scope).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });

  test("a rate-limited probe never reaches the resolver", async () => {
    const resolver = new StubResolver(probeResult());
    const harness = await createHarness({ resolver, config: { rateLimitProbePerMinute: 1 } });

    try {
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/a` },
      });
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/b` },
      });
      // The whole point: the expensive work is never started. The hook runs on
      // `onRequest`, before the body is even parsed.
      expect(resolver.calls).toBe(1);
    } finally {
      await harness.dispose();
    }
  });

  test("headers advertise the remaining allowance before it runs out", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitProbePerMinute: 5 },
    });

    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["ratelimit-limit"]).toBe("5");
      expect(response.headers["ratelimit-remaining"]).toBe("4");
    } finally {
      await harness.dispose();
    }
  });

  test("POST /api/jobs is limited, and reading jobs is not", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitJobsPerMinute: 1 },
    });

    try {
      const create = async () =>
        harness.app.server.inject({
          method: "POST",
          url: ROUTES.jobs,
          payload: { url: SOURCE_URL },
        });

      expect((await create()).statusCode).toBe(201);
      expect((await create()).statusCode).toBe(429);

      // A client that has spent its creation allowance must still be able to
      // watch and cancel what it already started.
      for (let call = 0; call < 5; call++) {
        const listed = await harness.app.server.inject({ method: "GET", url: ROUTES.jobs });
        expect(listed.statusCode).toBe(200);
      }
    } finally {
      await harness.dispose();
    }
  });

  test("the two endpoints hold separate allowances", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitProbePerMinute: 1, rateLimitJobsPerMinute: 1 },
    });

    try {
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      // Spending the probe budget must not lock a client out of downloading
      // the thing it just analysed.
      const created = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      });
      expect(created.statusCode).toBe(201);
    } finally {
      await harness.dispose();
    }
  });

  test("the global gate refuses a probe that no per-IP bucket would have stopped", async () => {
    // The distributed case: every caller is within its own allowance, and the
    // server still cannot afford to run them all at once.
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const resolver = new StubResolver(async () => {
      await blocked;
      return probeResult();
    });

    const harness = await createHarness({
      resolver,
      config: { maxConcurrentProbes: 1, rateLimitProbePerMinute: 0 },
    });

    try {
      const first = harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/slow` },
      });
      // Wait until the first probe is actually holding the slot.
      while (harness.app.context.probeGate.inFlight === 0) {
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const second = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/other` },
      });
      expect(second.statusCode).toBe(429);
      expect(second.json().error.code).toBe("RATE_LIMITED");
      expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);

      release?.();
      expect((await first).statusCode).toBe(200);
      // The slot went back, so the next caller is served rather than refused.
      expect(harness.app.context.probeGate.inFlight).toBe(0);
    } finally {
      release?.();
      await harness.dispose();
    }
  });

  test("a failed probe still releases its slot", async () => {
    const resolver = new StubResolver(async () => {
      throw new Error("resolver exploded");
    });
    const harness = await createHarness({ resolver, config: { maxConcurrentProbes: 1 } });

    try {
      for (let call = 0; call < 3; call++) {
        // oxlint-disable-next-line no-await-in-loop
        const response = await harness.app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload: { url: `${SOURCE_URL}/${call}` },
        });
        // 500, not 429: a leaked slot would turn the second call into a refusal
        // and the endpoint would be permanently dead after one bad page.
        expect(response.statusCode).toBe(500);
      }
      expect(harness.app.context.probeGate.inFlight).toBe(0);
    } finally {
      await harness.dispose();
    }
  });
});
