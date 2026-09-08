/**
 * Rate limiting and admission control.
 *
 * Two levels, tested separately: the bucket arithmetic in isolation with an
 * injected clock (real time makes rate tests either slow or flaky, and usually
 * both), and the routes end to end, where what matters is that a refusal is a
 * well-formed 429 a client can act on rather than an opaque failure.
 */

import { ROUTES } from "@downloader/contract";
import type { JobResponse, ProbeEvent } from "@downloader/contract";
import type { LightMyRequestResponse } from "fastify";
import { describe, expect, test } from "vitest";
import type { Harness } from "./helpers.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";
import { clientKey, ConcurrencyGate, RateLimiter } from "@webtools/core/rate-limit";
import { API_DEFAULTS, loadApiConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { CHANNEL_TTL_MS, MAX_CHANNELS } from "../src/probe-stages.ts";

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

  test("POST /api/jobs is limited, and reading a job is not", async () => {
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

      const first = await create();
      expect(first.statusCode).toBe(201);
      expect((await create()).statusCode).toBe(429);

      // A client that has spent its creation allowance must still be able to
      // watch and cancel what it already started. This read used to go through
      // the job list; dl-32 removed it, and the single read is the more honest
      // proof of the claim anyway — "what it already started" is one job, by id.
      const { id } = (first.json() as JobResponse).job;
      for (let call = 0; call < 5; call++) {
        // oxlint-disable-next-line no-await-in-loop
        const read = await harness.app.server.inject({ method: "GET", url: ROUTES.job(id) });
        expect(read.statusCode).toBe(200);
      }
    } finally {
      await harness.dispose();
    }
  });

  test("two client addresses hold separate allowances through the wired hook", async () => {
    // Pins `createRateLimitHook`'s *default* key, which nothing else does.
    // Every other test here injects without `remoteAddress`, so all of them
    // share one simulated client — mutating that default to a constant passed
    // the entire 228-test api suite before this test existed. "Clients have
    // separate buckets" was proven only against the bare `RateLimiter`, never
    // through the hook that has to ask it the right question.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitJobsPerMinute: 1 },
    });

    try {
      const create = async (remoteAddress: string) =>
        harness.app.server.inject({
          method: "POST",
          url: ROUTES.jobs,
          payload: { url: SOURCE_URL },
          remoteAddress,
        });

      expect((await create("203.0.113.7")).statusCode).toBe(201);
      expect((await create("203.0.113.7")).statusCode).toBe(429);
      // A different client, and the first one's exhausted bucket is not theirs.
      expect((await create("198.51.100.4")).statusCode).toBe(201);
    } finally {
      await harness.dispose();
    }
  });

  test("and an IPv6 client shares one bucket across its own /64", async () => {
    // The other half of the default key: `clientKey` collapses a /64 so a host
    // holding one cannot rotate through 2^64 addresses. Asserted here through
    // the hook, where a key that ignored the address would look identical.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitJobsPerMinute: 1 },
    });

    try {
      const create = async (remoteAddress: string) =>
        harness.app.server.inject({
          method: "POST",
          url: ROUTES.jobs,
          payload: { url: SOURCE_URL },
          remoteAddress,
        });

      expect((await create("2001:db8:1:2::1")).statusCode).toBe(201);
      // Same customer, different address in the same /64.
      expect((await create("2001:db8:1:2:aaaa::9")).statusCode).toBe(429);
      // A different /64 is a different customer.
      expect((await create("2001:db8:1:3::1")).statusCode).toBe(201);
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

/** Runs a job to completion and returns the download link it produced. */
async function tokenUrl(harness: Harness): Promise<string> {
  const created = (
    await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: `${SOURCE_URL}/${String(harness.engine.calls)}` },
    })
  ).json() as JobResponse;
  const finished = await waitFor(
    () => harness.app.context.store.get(created.job.id),
    (job) => job.status === "completed" || job.status === "failed",
    { label: "job to finish" },
  );
  expect(finished.status).toBe("completed");
  return finished.result?.downloadUrl ?? "";
}

/**
 * `GET /api/files/:token` — the one limited route whose client is a video
 * player rather than a form.
 *
 * The numbers below are measured, not chosen. A Chromium `<video>` pointed at a
 * download link (dl-23) issues **one open-ended `Range` request per completed
 * seek**, not a burst per seek: 6 requests for a load plus five deliberate
 * seeks, 207 in a minute of realistic heavy scrubbing on a fast link, 274 with
 * 40 ms of round trip in the way, and 965 during a full unbroken minute of
 * dragging the scrub bar. An unmetered caller with eight sockets managed
 * 24,132. The shipped default sits between the honest client and the hammer.
 */
describe("the download route", () => {
  /** The worst *realistic* scrub minute measured for dl-23, on a 40 ms link. */
  const MEASURED_SCRUB_BURST = 274;

  test("refuses with a 429 and a Retry-After once the bucket is empty", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitFilesPerMinute: 3 },
    });

    try {
      const url = await tokenUrl(harness);
      const get = async () => harness.app.server.inject({ method: "GET", url });

      for (let call = 0; call < 3; call++) {
        // oxlint-disable-next-line no-await-in-loop
        expect((await get()).statusCode, `call ${call}`).toBe(200);
      }

      const refused = await get();
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe("RATE_LIMITED");
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.json().error.details.retryAfterSec).toBeGreaterThan(0);
      // `files` is for our logs only, like every other scope.
      expect(refused.json().error.details.scope).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });

  test("a refusal carries none of the route's own headers", async () => {
    // The hook is `onRequest`, so it fires before the handler sets
    // Content-Disposition and Content-Type. Proven rather than reasoned about:
    // a 429 still advertising an attachment would be a broken download.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitFilesPerMinute: 1 },
    });

    try {
      const url = await tokenUrl(harness);
      const served = await harness.app.server.inject({ method: "GET", url });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-disposition"]).toContain("attachment");

      const refused = await harness.app.server.inject({ method: "GET", url });
      expect(refused.statusCode).toBe(429);
      expect(refused.headers["content-disposition"]).toBeUndefined();
      expect(refused.headers["accept-ranges"]).toBeUndefined();
      expect(refused.headers["content-range"]).toBeUndefined();
      expect(String(refused.headers["content-type"])).toContain("application/json");
    } finally {
      await harness.dispose();
    }
  });

  test("a seeking player's measured burst passes at the shipped default", async () => {
    // `bytes=N-` open-ended is the shape Chromium actually sends on a seek; the
    // point of the count is that 274 of them in a row is an ordinary user, and
    // the count the brief suggested — 120 — would have cut them off mid-scrub.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitFilesPerMinute: API_DEFAULTS.rateLimitFilesPerMinute },
    });

    try {
      expect(MEASURED_SCRUB_BURST).toBeLessThan(API_DEFAULTS.rateLimitFilesPerMinute);
      const url = await tokenUrl(harness);
      for (let call = 0; call < MEASURED_SCRUB_BURST; call++) {
        // oxlint-disable-next-line no-await-in-loop
        const response = await harness.app.server.inject({
          method: "GET",
          url,
          headers: { range: `bytes=${String(call % 20)}-` },
        });
        expect(response.statusCode, `seek ${call}`).toBe(206);
      }
    } finally {
      await harness.dispose();
    }
  });

  test("zero disables it, for an operator serving large files to few people", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitFilesPerMinute: 0 },
    });

    try {
      expect(harness.app.context.rateLimits.files.enabled).toBe(false);
      const url = await tokenUrl(harness);
      for (let call = 0; call < 50; call++) {
        // oxlint-disable-next-line no-await-in-loop
        const response = await harness.app.server.inject({ method: "GET", url });
        expect(response.statusCode, `call ${call}`).toBe(200);
        // Nothing to advertise when there is no limit.
        expect(response.headers["ratelimit-limit"]).toBeUndefined();
      }
    } finally {
      await harness.dispose();
    }
  });

  test("one exhausted link does not spend another link's allowance", async () => {
    // The whole reason the key is the token: both requests below come from the
    // same client address, and an address key would have refused the second.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitFilesPerMinute: 1 },
    });

    try {
      const first = await tokenUrl(harness);
      const second = await tokenUrl(harness);
      expect(first).not.toBe(second);

      expect((await harness.app.server.inject({ method: "GET", url: first })).statusCode).toBe(200);
      expect((await harness.app.server.inject({ method: "GET", url: first })).statusCode).toBe(429);

      // Same address, different capability — untouched.
      expect((await harness.app.server.inject({ method: "GET", url: second })).statusCode).toBe(
        200,
      );
    } finally {
      await harness.dispose();
    }
  });

  test("a token that is not even well formed cannot mint itself a bucket", async () => {
    // Obviously-malformed junk falls back to the address key, so it shares one
    // allowance rather than getting a fresh bucket per request. A *well-formed*
    // guess still mints one — `maxKeys` is what bounds that, not this branch.
    // What the fallback guarantees either way is the second assertion: no
    // amount of guessing lands in a real file's bucket.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitFilesPerMinute: 2 },
    });

    try {
      const junk = async (token: string) =>
        harness.app.server.inject({ method: "GET", url: ROUTES.file(token) });

      expect((await junk("one")).statusCode).toBe(404);
      expect((await junk("two")).statusCode).toBe(404);
      expect((await junk("three")).statusCode).toBe(429);

      // And a real link still has its own full allowance.
      const url = await tokenUrl(harness);
      expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(200);
    } finally {
      await harness.dispose();
    }
  });

  test("the bucket key never contains the token itself", async () => {
    // The key reaches a `logger.warn` line, and a file token is a live
    // credential — the same reason `redactUrl` exists.
    const lines: string[] = [];
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitFilesPerMinute: 1 },
      logger: createLogger({ level: "warn", write: (line) => void lines.push(line) }),
    });

    try {
      const url = await tokenUrl(harness);
      const token = url.slice(url.lastIndexOf("/") + 1);
      await harness.app.server.inject({ method: "GET", url });
      expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(429);

      const logged = lines.join("\n");
      expect(logged).toContain("rate limited");
      expect(logged).not.toContain(token);
    } finally {
      await harness.dispose();
    }
  });
});

/**
 * `GET /api/probe/:id/events` — the SSE channel that narrates an analysis.
 *
 * dl-46. This was the one client-facing endpoint with no bucket, and
 * subscribing is what *creates* a channel, so `MAX_CHANNELS` was spendable by
 * anyone who could reach the port. Nothing leaks and no analysis fails when it
 * is full — what is denied is the narration — but it was denied for the cost of
 * holding sockets, which is what the bucket below prices.
 *
 * The awkward shape of these tests is the endpoint's, not a preference: an
 * *allowed* subscribe holds its socket until the probe it names says `done`, so
 * every allowed stream here is opened alongside the probe that terminates it.
 * A refusal returns immediately, because the hook runs on `onRequest`.
 *
 * Its two helpers are below rather than inside it, which is oxlint's
 * `consistent-function-scoping` rule and not a preference.
 */

/** A distinct, schema-valid probe id per call: `[A-Za-z0-9_-]{16,64}`. */
function probeId(n: number): string {
  return `probe-id-${String(n).padStart(8, "0")}`;
}

/** Opens the stage channel and runs the probe that ends it, together. */
async function narrate(
  harness: Harness,
  n: number,
  remoteAddress?: string,
): Promise<{ stream: LightMyRequestResponse; frames: ProbeEvent[]; probeStatus: number }> {
  const id = probeId(n);
  const opened = harness.app.server.inject({
    method: "GET",
    url: ROUTES.probeEvents(id),
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
  });
  // A distinct URL each time, or the probe cache answers without opening a
  // channel — and then nothing would ever terminate the stream above.
  const probe = harness.app.server.inject({
    method: "POST",
    url: ROUTES.probe,
    payload: { url: `${SOURCE_URL}/${String(n)}`, probeId: id },
  });
  const [stream, posted] = await Promise.all([opened, probe]);
  return {
    stream,
    frames: stream.body
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ProbeEvent),
    probeStatus: posted.statusCode,
  };
}

describe("the probe stage channel", () => {
  test("a client over its limit gets a JSON error, not an empty event stream", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitProbeEventsPerMinute: 1 },
    });

    try {
      const first = await narrate(harness, 1);
      expect(first.stream.statusCode).toBe(200);
      expect(String(first.stream.headers["content-type"])).toContain("text/event-stream");

      // The channel count before the refused subscribe: subscribing is what
      // creates a channel, so a hook that did not run would show one more.
      const channelsBefore = harness.app.context.probeStages.channelCount;
      const refused = await harness.app.server.inject({
        method: "GET",
        url: ROUTES.probeEvents(probeId(2)),
      });

      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe("RATE_LIMITED");
      expect(refused.json().error.retryable).toBe(true);
      // The point of the ordering: `onRequest` fires before the handler, so no
      // streaming header was ever written and the body is an error a client can
      // read rather than a stream that will never say anything.
      expect(String(refused.headers["content-type"])).toContain("application/json");
      expect(String(refused.headers["content-type"])).not.toContain("text/event-stream");
      expect(refused.body).not.toContain("data: ");
      // Both the header every HTTP client understands and the field the UI reads.
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.json().error.details.retryAfterSec).toBeGreaterThan(0);
      // `scope` is for our logs; the allowlist in http-errors.ts keeps it there.
      expect(refused.json().error.details.scope).toBeUndefined();
      expect(refused.headers["ratelimit-limit"]).toBe("1");

      expect(harness.app.context.probeStages.channelCount).toBe(channelsBefore);
    } finally {
      await harness.dispose();
    }
  });

  test("a probe whose narration was refused still completes and answers normally", async () => {
    // The whole reason this endpoint can be refused at all: the analysis is the
    // product and the narration is decoration over it. `POST /api/probe` has its
    // own bucket, off in this harness, so the only refusal in play is the SSE
    // one.
    const resolver = new StubResolver(probeResult());
    const harness = await createHarness({
      resolver,
      config: { rateLimitProbeEventsPerMinute: 1 },
    });

    try {
      expect((await narrate(harness, 1)).stream.statusCode).toBe(200);

      const refused = await harness.app.server.inject({
        method: "GET",
        url: ROUTES.probeEvents(probeId(2)),
      });
      expect(refused.statusCode).toBe(429);

      const probed = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/unnarrated`, probeId: probeId(2) },
      });
      expect(probed.statusCode).toBe(200);
      // A real answer, not merely a 200: the resolver ran a second time and the
      // response carries the analysis it produced.
      expect(resolver.calls).toBe(2);
      expect(probed.json().cached).toBe(false);
      expect(probed.json().probe.title).toBe(probeResult().title);
      expect(probed.json().probe.variants).toHaveLength(probeResult().variants.length);
    } finally {
      await harness.dispose();
    }
  });

  test("a client under its limit is unaffected, so it cannot pass by refusing everyone", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitProbeEventsPerMinute: 5 },
    });

    try {
      for (let call = 1; call <= 3; call++) {
        // oxlint-disable-next-line no-await-in-loop
        const narrated = await narrate(harness, call);
        expect(narrated.stream.statusCode, `call ${call}`).toBe(200);
        expect(String(narrated.stream.headers["content-type"])).toContain("text/event-stream");
        // A real narration, not merely a 200: the stream carried its frames and
        // was ended by the terminator rather than by anything here.
        expect(narrated.frames.at(-1)?.type).toBe("done");
        expect(narrated.probeStatus).toBe(200);
        // The advisory `RateLimit-*` headers do not survive an *allowed*
        // subscribe: this route writes its own headers straight to `reply.raw`,
        // which bypasses Fastify's header store. Pinned so it is a known
        // property rather than a surprise. It costs nothing — `EventSource`
        // exposes no response headers to the page, and a refusal is an ordinary
        // Fastify error response that carries all of them.
        expect(narrated.stream.headers["ratelimit-limit"]).toBeUndefined();
      }
    } finally {
      await harness.dispose();
    }
  });

  test("one address exhausting the channel cannot silence another", async () => {
    // Keyed per IP, which was dl-46's open question and the owner's answer. The
    // second address is a different customer and its narration is untouched.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitProbeEventsPerMinute: 1 },
    });

    try {
      expect((await narrate(harness, 1, "203.0.113.7")).stream.statusCode).toBe(200);

      const refused = await harness.app.server.inject({
        method: "GET",
        url: ROUTES.probeEvents(probeId(2)),
        remoteAddress: "203.0.113.7",
      });
      expect(refused.statusCode).toBe(429);

      expect((await narrate(harness, 3, "198.51.100.4")).stream.statusCode).toBe(200);
    } finally {
      await harness.dispose();
    }
  });

  test("the default is on, and is one subscribe per probe", async () => {
    // A new limiter that defaulted off would leave this the only unprotected
    // endpoint again, silently. Read off `loadApiConfig` with an empty
    // environment rather than off `API_DEFAULTS`, so the wiring is included.
    const shipped = loadApiConfig({}, {});
    expect(shipped.rateLimitProbeEventsPerMinute).toBeGreaterThan(0);
    // The endpoints are used one-for-one: the client opens the stream, then
    // POSTs the probe it names. Equal allowances mean this bucket can never be
    // the one that refuses a client still inside its probe allowance.
    expect(shipped.rateLimitProbeEventsPerMinute).toBe(shipped.rateLimitProbePerMinute);

    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitProbeEventsPerMinute: shipped.rateLimitProbeEventsPerMinute },
    });
    try {
      expect(harness.app.context.rateLimits.probeEvents.enabled).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  test("the default keeps one address under the hub's cap", () => {
    // The arithmetic the default is chosen by, pinned so that raising either
    // number alone has to argue with it. A rate does not obviously bound a
    // concurrency: what makes it one here is that a subscriber's socket is
    // closed after CHANNEL_TTL_MS, so the channels one bucket key holds at
    // once are the requests it can make inside that window — a full bucket's
    // burst, *plus* the refill over it. Dropping the burst term is the easy
    // mistake and understates this by a quarter.
    const burst = API_DEFAULTS.rateLimitProbeEventsPerMinute;
    const refilled = API_DEFAULTS.rateLimitProbeEventsPerMinute * (CHANNEL_TTL_MS / 60_000);
    expect(burst + refilled).toBe(40);
    expect(burst + refilled).toBeLessThan(MAX_CHANNELS);
  });
});

/**
 * `GET /api/thumbnail/:token` — the other route that had no bucket.
 *
 * Inherited work rather than a new finding: dl-44 gave the preview images a
 * disk copy, which turned a repeated map lookup into a repeated file read, and
 * the owner answered its rate-limit question as "leave it, and carry it on
 * dl-46". Keyed on the token for the same reason `/api/files/:token` is — what
 * it protects is one image, not the service.
 */
describe("the thumbnail route", () => {
  /** A 2x2 GIF. Small, real, and a member of the content-type allowlist. */
  const GIF = Buffer.from("R0lGODlhAgACAIAAAP///wAAACH5BAAAAAAALAAAAAACAAIAAAIDRAJZADs=", "base64");

  /** Puts an image in the store the way a probe would, and returns its URL. */
  function storedImage(harness: Harness): string {
    const token = harness.app.context.thumbnails.put({ contentType: "image/gif", bytes: GIF });
    return ROUTES.thumbnail(token);
  }

  test("refuses past its limit, and the refusal carries none of the route's headers", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitThumbnailPerMinute: 2 },
    });

    try {
      const url = storedImage(harness);
      const get = async () => harness.app.server.inject({ method: "GET", url });

      for (let call = 0; call < 2; call++) {
        // oxlint-disable-next-line no-await-in-loop
        const served = await get();
        expect(served.statusCode, `call ${call}`).toBe(200);
        expect(served.headers["content-type"]).toBe("image/gif");
      }

      const refused = await get();
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe("RATE_LIMITED");
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.json().error.details.retryAfterSec).toBeGreaterThan(0);
      expect(refused.json().error.details.scope).toBeUndefined();
      // `onRequest`, so the handler never ran: no image headers on a 429.
      expect(String(refused.headers["content-type"])).toContain("application/json");
      expect(refused.headers["cache-control"]).toBeUndefined();
      expect(refused.headers["x-content-type-options"]).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });

  test("one exhausted image does not spend another image's allowance", async () => {
    // The reason the key is the token: both requests come from the same client
    // address, and an address key would have refused the second image.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitThumbnailPerMinute: 1 },
    });

    try {
      const first = storedImage(harness);
      const second = storedImage(harness);
      expect(first).not.toBe(second);

      expect((await harness.app.server.inject({ method: "GET", url: first })).statusCode).toBe(200);
      expect((await harness.app.server.inject({ method: "GET", url: first })).statusCode).toBe(429);
      expect((await harness.app.server.inject({ method: "GET", url: second })).statusCode).toBe(
        200,
      );
    } finally {
      await harness.dispose();
    }
  });

  test("the token never reaches the log line that records the refusal", async () => {
    // A thumbnail token is a live capability, exactly like a file token, and
    // the bucket key is logged. Same guard, same reason, different route.
    const lines: string[] = [];
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { rateLimitThumbnailPerMinute: 1 },
      logger: createLogger({ level: "warn", write: (line) => void lines.push(line) }),
    });

    try {
      const url = storedImage(harness);
      const token = url.slice(url.lastIndexOf("/") + 1);
      await harness.app.server.inject({ method: "GET", url });
      expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(429);

      const logged = lines.join("\n");
      expect(logged).toContain("rate limited");
      expect(logged).not.toContain(token);
    } finally {
      await harness.dispose();
    }
  });

  test("the default is on", () => {
    expect(loadApiConfig({}, {}).rateLimitThumbnailPerMinute).toBeGreaterThan(0);
  });
});
