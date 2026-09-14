/**
 * dl-57: one `probe_outcomes` row for every way `POST /api/probe` can end,
 * except the per-client rate-limit bucket, which never reaches the code that
 * records one.
 */

import { AppError, ROUTES } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { runRetentionSweep } from "../src/server.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver } from "./helpers.ts";

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
