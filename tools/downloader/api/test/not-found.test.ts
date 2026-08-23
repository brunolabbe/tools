/**
 * `NOT_FOUND` and `JOB_NOT_FOUND` side by side.
 *
 * dl-17 exists because these two were the same code: an unrecognised route and
 * a recognised route naming a job the store has no record of both answered
 * `JOB_NOT_FOUND`. The other suites assert each half on its own —
 * `web-serving.test.ts` for the route miss, `routes.test.ts` for the job miss —
 * which is where they belong, but neither pins the distinction itself. A
 * refactor that quietly collapsed the two codes back into one would leave both
 * of those suites green. This file exists only to make that regression fail.
 */

import { ROUTES } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { createHarness, probeResult, StubResolver } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe("an unrecognised route vs. a recognised route naming no job", () => {
  test("a URL matching no route is NOT_FOUND", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({ method: "GET", url: "/api/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("a job route naming an id the store has no record of is JOB_NOT_FOUND", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.job("nope") });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "JOB_NOT_FOUND" } });
  });
});
