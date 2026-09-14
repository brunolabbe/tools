/**
 * dl-57's report against a seeded database — the one Done-when line that had
 * no test at all before this branch's gate round.
 *
 * Seeds `probe_outcomes` directly through `JobStore` (never through the HTTP
 * route: this is a standalone read-only entry point, and it should not need a
 * running server to test) and `jobs` through the same FSM every job goes
 * through in production, then checks `buildReport`'s numbers and
 * `formatReport`'s text against hand-computed expectations.
 */

import Database from "better-sqlite3";
import { beforeEach, describe, expect, test } from "vitest";
import { JobStore } from "../src/db/job-store.ts";
import { migrate } from "../src/db/schema.ts";
import { buildReport, formatReport, parseReportArgs } from "../src/report.ts";
import type { Report } from "../src/report.ts";

let db: Database.Database;
let store: JobStore;

const WINDOW_START = "2026-09-07T00:00:00.000Z";

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  store = new JobStore(db);
});

function createCompletedJob(id: string, durationMs: number): void {
  store.create({
    id,
    sourceUrl: "https://site.example/x",
    options: {},
    variantId: null,
    createdAt: WINDOW_START,
  });
  store.transition(id, "probing", {}, WINDOW_START);
  store.transition(id, "downloading", {}, WINDOW_START);
  const finishedAt = new Date(new Date(WINDOW_START).getTime() + durationMs).toISOString();
  store.transition(id, "completed", {}, finishedAt);
}

/** Seeds the scenario every test in this file reads. */
function seed(): void {
  // --- probes -------------------------------------------------------------
  // Four fresh `direct` successes, at 100/200/300/400 ms.
  for (const durationMs of [100, 200, 300, 400]) {
    store.recordProbeOutcome(
      {
        host: "direct.example",
        outcome: "ok",
        resolver: "direct",
        attempts: [{ resolver: "direct", code: null, durationMs }],
        durationMs,
        cached: false,
        variants: 1,
        drm: false,
      },
      WINDOW_START,
    );
  }
  // A cache hit on the same host — `cached: true`, `durationMs: 0` (the real
  // shape `probe-outcomes.ts` records), which must not enter the duration
  // percentiles above.
  store.recordProbeOutcome(
    {
      host: "direct.example",
      outcome: "ok",
      resolver: "direct",
      attempts: [],
      durationMs: 0,
      cached: true,
      variants: 1,
      drm: false,
    },
    WINDOW_START,
  );
  // A slow browser success, alone in its own resolver bucket.
  store.recordProbeOutcome(
    {
      host: "browser.example",
      outcome: "ok",
      resolver: "browser",
      attempts: [{ resolver: "browser", code: null, durationMs: 9005 }],
      durationMs: 9005,
      cached: false,
      variants: 2,
      drm: false,
    },
    WINDOW_START,
  );
  // Two distinct failures on the same host, each naming the tier it tried.
  store.recordProbeOutcome(
    {
      host: "fail.example",
      outcome: "NO_MEDIA_FOUND",
      resolver: null,
      attempts: [{ resolver: "direct", code: "NO_MEDIA_FOUND", durationMs: 50 }],
      durationMs: 50,
      cached: false,
      variants: null,
      drm: false,
    },
    WINDOW_START,
  );
  store.recordProbeOutcome(
    {
      host: "fail.example",
      outcome: "TIMEOUT",
      resolver: null,
      attempts: [{ resolver: "browser", code: "TIMEOUT", durationMs: 5000 }],
      durationMs: 5000,
      cached: false,
      variants: null,
      drm: false,
    },
    WINDOW_START,
  );
  // A concurrency-gate refusal: excluded from the success-rate denominator
  // and from "hosts that fail most", not merely uncounted as a success.
  store.recordProbeOutcome(
    {
      host: "gate.example",
      outcome: "RATE_LIMITED",
      resolver: null,
      attempts: [],
      durationMs: 0,
      cached: false,
      variants: null,
      drm: false,
    },
    WINDOW_START,
  );
  // Outside the window entirely — proves the report is filtering by
  // `created_at`, not just returning every row it finds.
  store.recordProbeOutcome(
    {
      host: "old.example",
      outcome: "ok",
      resolver: "direct",
      attempts: [],
      durationMs: 1,
      cached: false,
      variants: 1,
      drm: false,
    },
    "2026-08-20T00:00:00.000Z",
  );

  // --- downloads ------------------------------------------------------------
  createCompletedJob("job-fast", 60_000);
  createCompletedJob("job-slow", 180_000);
  store.create({
    id: "job-failed",
    sourceUrl: "https://site.example/a",
    options: {},
    variantId: null,
    createdAt: WINDOW_START,
  });
  store.transition(
    "job-failed",
    "failed",
    { error: { code: "DOWNLOAD_FAILED", message: "x", retryable: true } },
    WINDOW_START,
  );
  store.create({
    id: "job-canceled",
    sourceUrl: "https://site.example/b",
    options: {},
    variantId: null,
    createdAt: WINDOW_START,
  });
  store.transition(
    "job-canceled",
    "canceled",
    { error: { code: "JOB_CANCELED", message: "x", retryable: false } },
    WINDOW_START,
  );
}

describe("parseReportArgs", () => {
  test("reads --days, and falls back to a week on anything else", () => {
    expect(parseReportArgs(["--days", "3"])).toEqual({ days: 3 });
    expect(parseReportArgs([])).toEqual({ days: 7 });
    expect(parseReportArgs(["--days", "not-a-number"])).toEqual({ days: 7 });
    expect(parseReportArgs(["--days", "0"])).toEqual({ days: 7 });
    expect(parseReportArgs(["--days", "-3"])).toEqual({ days: 7 });
  });
});

describe("buildReport against a seeded database", () => {
  let report: Report;

  beforeEach(() => {
    seed();
    report = buildReport(db, WINDOW_START, 7);
  });

  test("counts probes: total, attempted, gate refusals and successes", () => {
    // 9 rows in the window: 4 direct + 1 cache hit + 1 browser + 2 fail.example
    // + 1 gate refusal. old.example, the 10th, is outside it.
    expect(report.probes.total).toBe(9);
    expect(report.probes.gateRefusals).toBe(1);
    expect(report.probes.attempted).toBe(8);
    // ok: 4 direct + 1 cache hit + 1 browser = 6.
    expect(report.probes.successes).toBe(6);
    expect(report.probes.successRate).toBeCloseTo(6 / 8);
  });

  test("groups successes by winning resolver, as a share of all successes", () => {
    expect(report.probes.byResolver).toEqual([
      { resolver: "direct", successes: 5, share: 5 / 6 },
      { resolver: "browser", successes: 1, share: 1 / 6 },
    ]);
  });

  test("lists the hosts that fail most, with codes and tiers tried — never the gate refusal", () => {
    expect(report.probes.topFailingHosts).toEqual([
      {
        host: "fail.example",
        failures: 2,
        codes: ["NO_MEDIA_FOUND", "TIMEOUT"],
        tiersAttempted: ["direct", "browser"],
      },
    ]);
  });

  test("p50/p95 duration per resolver, cache hits excluded, nearest-rank", () => {
    // [100, 200, 300, 400]: nearest rank of p50 is index ceil(0.5*4)-1 = 1 -> 200;
    // p95 is ceil(0.95*4)-1 = 3 -> 400. The cache hit (durationMs 0) plays no part.
    expect(report.probes.durationByResolver).toEqual([
      { resolver: "direct", p50Ms: 200, p95Ms: 400, n: 4 },
      { resolver: "browser", p50Ms: 9005, p95Ms: 9005, n: 1 },
    ]);
  });

  test("counts downloads: total, successes, code breakdown, p50 duration", () => {
    expect(report.downloads.total).toBe(4);
    expect(report.downloads.successes).toBe(2);
    expect(report.downloads.successRate).toBeCloseTo(0.5);
    // Both codes have count 1, and this report does not promise a tie-break
    // order — compared as a set, not a sequence.
    expect(report.downloads.codeCounts).toHaveLength(2);
    expect(report.downloads.codeCounts).toEqual(
      expect.arrayContaining([
        { code: "DOWNLOAD_FAILED", count: 1 },
        { code: "JOB_CANCELED", count: 1 },
      ]),
    );
    // [60000, 180000]: nearest-rank p50 is the lower one, index ceil(0.5*2)-1 = 0.
    expect(report.downloads.p50DurationMs).toBe(60_000);
  });

  test("a row outside the window is never counted", () => {
    // old.example would be a seventh direct success if it leaked in.
    const withoutFilter = report.probes.byResolver.find((r) => r.resolver === "direct");
    expect(withoutFilter?.successes).toBe(5);
  });
});

describe("formatReport against the same seed", () => {
  test("prints the rates, the per-resolver breakdown and the duration lines", () => {
    seed();
    const text = formatReport(buildReport(db, WINDOW_START, 7));

    expect(text).toContain("last 7 day(s)");
    expect(text).toContain(
      "success rate: 75.0% (6/8 attempted, 1 refused by the concurrency gate)",
    );
    expect(text).toContain("direct: 5 (83.3%)");
    expect(text).toContain("browser: 1 (16.7%)");
    expect(text).toContain("fail.example: 2 (NO_MEDIA_FOUND, TIMEOUT; tried direct, browser)");
    expect(text).toContain("direct: p50=200 p95=400 (n=4)");
    expect(text).toContain("browser: p50=9005 p95=9005 (n=1)");
    expect(text).toContain("Downloads");
    expect(text).toContain("success rate: 50.0% (2/4)");
    expect(text).toContain("DOWNLOAD_FAILED: 1");
    expect(text).toContain("JOB_CANCELED: 1");
    expect(text).toContain("p50 download duration: 60000 ms");
  });

  test("an empty window prints honest 'n/a' and 'none' rather than fabricating a rate", () => {
    const text = formatReport(buildReport(db, WINDOW_START, 7));
    expect(text).toContain("success rate: n/a (0/0 attempted, 0 refused by the concurrency gate)");
    expect(text).toContain("no successful probe in this window");
    expect(text).toContain("hosts that fail most:\n    none");
    expect(text).toContain("no timed probe in this window");
    expect(text).toContain("success rate: n/a (0/0)");
    expect(text).toContain("no failed download in this window");
    expect(text).toContain("p50 download duration: n/a");
  });
});
