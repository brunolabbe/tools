/**
 * dl-57: one `probe_outcomes` row for every way `POST /api/probe` can end,
 * except the per-client rate-limit bucket, which never reaches the code that
 * records one — and, since the dl-51 rebase, dl-51's per-client probe cap
 * (`probeClientGate`), which is per-client capacity by the same reasoning and
 * is excluded by construction: it refuses before `routes/probe.ts` declares
 * `attempts`/`startedAt` or enters the `try` any recording call lives in.
 */

import { AppError, ROUTES } from "@downloader/contract";
import { clientKey } from "@webtools/core/rate-limit";
import { describe, expect, test } from "vitest";
import { runRetentionSweep } from "../src/server.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";

/** One `probe_outcomes` row, everything but `host` and `createdAt` fixed. */
function outcome(host: string) {
  return {
    host,
    outcome: "ok" as const,
    resolver: "direct",
    attempts: [],
    durationMs: 1,
    cached: false,
    variants: 1,
    drm: false,
  };
}

describe("probe_outcomes", () => {
  test("a success records one row naming the winning resolver", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult({ resolver: "browser" })),
    });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      expect(response.statusCode).toBe(200);

      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        host: new URL(SOURCE_URL).hostname,
        outcome: "ok",
        resolver: "browser",
        cached: false,
        variants: 1,
        drm: false,
      });
      expect(rows[0]?.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await harness.dispose();
    }
  });

  test("a failure records one row with the AppError code and each attempt's resolver, code and duration", async () => {
    // A terminal code (`DRM_PROTECTED`), not `NO_MEDIA_FOUND`: that one is a
    // fall-through, so with the real direct tier also registered — required
    // for the app to boot at all, see `assertUsable` — the chain would move on
    // to it and reach real DNS. The chain-exhaustion case, where `attempts`
    // holds more than one entry, is covered at the registry level in
    // `resolvers/test/registry.test.ts` with no real tier involved.
    const harness = await createHarness({
      resolver: new StubResolver(async () => {
        throw new AppError("DRM_PROTECTED");
      }),
    });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      expect(response.statusCode).toBe(451);

      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        host: new URL(SOURCE_URL).hostname,
        outcome: "DRM_PROTECTED",
        resolver: null,
        cached: false,
      });
      // The registry's own out-parameter, not a re-parse of the error's
      // `details` — see `ResolverRegistry.resolve()`.
      expect(rows[0]?.attempts).toEqual([
        { resolver: "stub", code: "DRM_PROTECTED", durationMs: expect.any(Number) },
      ]);
    } finally {
      await harness.dispose();
    }
  });

  test("a cache hit records its own row", async () => {
    const resolver = new StubResolver(probeResult());
    const harness = await createHarness({ resolver });
    try {
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      const second = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      expect((second.json() as { cached: boolean }).cached).toBe(true);

      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ outcome: "ok", cached: true, durationMs: 0 });
    } finally {
      await harness.dispose();
    }
  });

  test("a concurrency-gate refusal records one row, distinct from a per-client rate-limit refusal", async () => {
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

      release?.();
      await first;

      const rows = harness.app.context.store.probeOutcomes();
      // One success (the first request) and one gate refusal — not two, so the
      // refusal really is a separate row rather than the success double-counted.
      expect(rows).toHaveLength(2);
      const refusal = rows.find((row) => row.outcome === "RATE_LIMITED");
      expect(refusal).toMatchObject({ outcome: "RATE_LIMITED", resolver: null, cached: false });
    } finally {
      release?.();
      await harness.dispose();
    }
  });

  test("a per-client rate-limit refusal records nothing", async () => {
    const resolver = new StubResolver(probeResult());
    const harness = await createHarness({ resolver, config: { rateLimitProbePerMinute: 1 } });
    try {
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/a` },
      });
      const refused = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/b` },
      });
      expect(refused.statusCode).toBe(429);

      // Only the one successful probe recorded — the bucket's own refusal never
      // reaches the route handler that records an outcome.
      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.outcome).toBe("ok");
    } finally {
      await harness.dispose();
    }
  });

  test("a signed URL's path and query string, or the client address, never reach a probe_outcomes row", async () => {
    const resolver = new StubResolver(probeResult());
    const harness = await createHarness({ resolver });
    const signedUrl = `${SOURCE_URL}?sig=super-secret-credential`;
    try {
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: signedUrl },
      });

      const [row] = harness.app.context.store.probeOutcomes();
      expect(row?.host).toBe(new URL(SOURCE_URL).hostname);
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain("sig=");
      expect(serialized).not.toContain("super-secret-credential");
      expect(serialized).not.toContain("/watch/42");
      // `inject()`'s default remote address — `host` is computed from the
      // source URL, never the caller's own address.
      expect(serialized).not.toContain("127.0.0.1");
    } finally {
      await harness.dispose();
    }
  });

  test("a failing outcome write leaves the probe's response unchanged", async () => {
    const resolver = new StubResolver(probeResult());
    const harness = await createHarness({ resolver });
    try {
      // Break the write, the same way a full disk or a locked table would.
      const broken = new Error("disk full");
      const original = harness.app.context.store.recordProbeOutcome.bind(harness.app.context.store);
      harness.app.context.store.recordProbeOutcome = () => {
        throw broken;
      };

      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { cached: boolean }).cached).toBe(false);

      // Restore, so `dispose()` and any later assertion see the real store.
      harness.app.context.store.recordProbeOutcome = original;
    } finally {
      await harness.dispose();
    }
  });
});

describe("a job's stored host", () => {
  test("never carries the path, the query string or an address", async () => {
    const harness = await createHarness();
    try {
      const signedUrl = `${SOURCE_URL}?sig=super-secret-credential`;
      const created = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: signedUrl },
      });
      expect(created.statusCode).toBe(201);
      const jobId = (created.json() as { job: { id: string } }).job.id;

      const host = harness.app.context.store.jobHost(jobId);
      expect(host).toBe(new URL(SOURCE_URL).hostname);
      expect(host).not.toContain("sig=");
      expect(host).not.toContain("super-secret-credential");
      // The clause this title actually claims: `inject()`'s default remote
      // address is 127.0.0.1, and `host` is computed from the source URL, not
      // the request — so it can never equal the caller's own address.
      expect(host).not.toBe("127.0.0.1");
    } finally {
      await harness.dispose();
    }
  });
});

describe("probe_outcomes retention", () => {
  test("a controlled clock prunes rows older than OUTCOME_RETENTION_DAYS and keeps newer ones", async () => {
    let clock = new Date("2026-09-07T00:00:00.000Z");
    const harness = await createHarness({
      now: () => clock,
      config: { outcomeRetentionDays: 90 },
    });
    try {
      const store = harness.app.context.store;
      const tooOld = new Date(clock.getTime() - 91 * 24 * 3_600_000).toISOString();
      const stillGood = new Date(clock.getTime() - 89 * 24 * 3_600_000).toISOString();
      store.recordProbeOutcome(outcome("old.example"), tooOld);
      store.recordProbeOutcome(outcome("recent.example"), stillGood);

      await runRetentionSweep(harness.app.context);

      expect(store.probeOutcomes().map((row) => row.host)).toEqual(["recent.example"]);
    } finally {
      await harness.dispose();
    }
  });

  test("0 disables pruning entirely, like the rate limits' convention for off", async () => {
    let clock = new Date("2026-09-07T00:00:00.000Z");
    const harness = await createHarness({
      now: () => clock,
      config: { outcomeRetentionDays: 0 },
    });
    try {
      const store = harness.app.context.store;
      const veryOld = new Date(clock.getTime() - 400 * 24 * 3_600_000).toISOString();
      store.recordProbeOutcome(outcome("ancient.example"), veryOld);

      await runRetentionSweep(harness.app.context);

      expect(store.probeOutcomes()).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });
});

describe("the dl-51/dl-57 agreement: a per-client probe-cap refusal", () => {
  test("records no probe_outcomes row, and still releases its client slot", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver = new StubResolver(async (call) => {
      if (call === 0) await blocked;
      return probeResult();
    });
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentProbes: 4, maxProbesPerClient: 1, rateLimitProbePerMinute: 0 },
    });
    const clientA = "203.0.113.7";

    try {
      const first = harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/1` },
        remoteAddress: clientA,
      });
      await waitFor(
        () => harness.app.context.probeClientGate.count(clientKey(clientA)),
        (count) => count === 1,
        { label: "first probe to hold its client slot" },
      );

      const refused = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/2` },
        remoteAddress: clientA,
      });
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe("RATE_LIMITED");

      release?.();
      await first;

      // One row — the first probe's success — never two: the refusal in
      // between recorded nothing.
      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.outcome).toBe("ok");

      // And the refusal did not leak the slot it never held.
      expect(harness.app.context.probeClientGate.count(clientKey(clientA))).toBe(0);
    } finally {
      release?.();
      await harness.dispose();
    }
  });
});

describe("guard-stage exits (dl-57 owner decision A)", () => {
  test("BLOCKED_TARGET records a row, host masked as an IP literal", async () => {
    // A literal IP in the URL never reaches DNS at all — `net.isIP` catches
    // it directly in the guard — so this needs no lookup stub, only the
    // address check turned on.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { ssrfAllowPrivateAddresses: false },
    });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: "http://127.0.0.1/admin" },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("BLOCKED_TARGET");

      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        host: "ip-literal",
        outcome: "BLOCKED_TARGET",
        resolver: null,
        cached: false,
      });
    } finally {
      await harness.dispose();
    }
  });

  test("UNREACHABLE records a row with the guard's parsed hostname", async () => {
    // `.invalid` is IANA-reserved (RFC 2606) and will never resolve; real DNS
    // lookup, not a stub, matching how the route actually reaches the guard.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { ssrfAllowPrivateAddresses: false },
    });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: "http://this-host-should-not-resolve.invalid/x" },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("UNREACHABLE");

      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        host: "this-host-should-not-resolve.invalid",
        outcome: "UNREACHABLE",
        resolver: null,
        cached: false,
      });
    } finally {
      await harness.dispose();
    }
  });

  test("an unparseable URL never reaches the guard, so it gets no row — the schema refuses it first", async () => {
    const harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: "not a url at all" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_URL");
      expect(harness.app.context.store.probeOutcomes()).toHaveLength(0);
    } finally {
      await harness.dispose();
    }
  });
});

describe("IP-literal hosts never reach a row as themselves (dl-57 owner decision C)", () => {
  test("a successful probe against an IP-literal page URL stores the marker, not the address", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      // The default: an IP literal is allowed through the address check, so
      // resolution proceeds and this is the success path, not BLOCKED_TARGET.
    });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: "http://93.184.215.14/watch" },
      });
      expect(response.statusCode).toBe(200);

      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.host).toBe("ip-literal");
      expect(JSON.stringify(rows[0])).not.toContain("93.184.215.14");
    } finally {
      await harness.dispose();
    }
  });

  test("a trailing FQDN dot does not group a host apart from itself", async () => {
    const harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: "http://site.example./watch" },
      });
      expect(response.statusCode).toBe(200);

      const rows = harness.app.context.store.probeOutcomes();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.host).toBe("site.example");
    } finally {
      await harness.dispose();
    }
  });
});
