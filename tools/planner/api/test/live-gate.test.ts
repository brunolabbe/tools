/**
 * pl-40's consent gate — proved without spending anything.
 *
 * `assertLiveRunConsent` is the first thing `api/test/live/run.ts`'s `main()`
 * calls, before a config is read or a provider is built. Importing the module
 * for this test does not run that `main()`: the file only calls it when
 * invoked directly (`node --import tsx .../run.ts`), guarded by a check
 * against `process.argv[1]` — see the bottom of that file.
 *
 * This is also the harness's own proof that vitest never collects it: if the
 * `describe` below ran as *itself* a live run, this file would need
 * `PLANNER_LIVE_RUN=1` in CI just to import it, and it does not.
 */

import { describe, expect, test } from "vitest";
import { assertLiveRunConsent, runCeilingUsd } from "./live/run.ts";

describe("assertLiveRunConsent", () => {
  test("refuses when PLANNER_LIVE_RUN is unset", () => {
    expect(() => assertLiveRunConsent({})).toThrow(/PLANNER_LIVE_RUN=1/);
  });

  test("refuses when PLANNER_LIVE_RUN is anything other than the literal '1'", () => {
    expect(() => assertLiveRunConsent({ PLANNER_LIVE_RUN: "true" })).toThrow(/PLANNER_LIVE_RUN=1/);
    expect(() => assertLiveRunConsent({ PLANNER_LIVE_RUN: "0" })).toThrow(/PLANNER_LIVE_RUN=1/);
  });

  test("a key sitting in the shell is not consent on its own", () => {
    expect(() => assertLiveRunConsent({ ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" })).toThrow(
      /PLANNER_LIVE_RUN=1/,
    );
  });

  test("passes when PLANNER_LIVE_RUN is exactly '1'", () => {
    expect(() => assertLiveRunConsent({ PLANNER_LIVE_RUN: "1" })).not.toThrow();
  });
});

describe("runCeilingUsd", () => {
  const budget = { maxSpecialists: 5, maxOutputTokens: 8_000, maxAttemptsPerSpecialist: 2 };

  test("matches the filing's own worst-case arithmetic: 80k output tokens plus the re-ask's echoed input", () => {
    // Build step 3 / the filing's Log: MAX_SPECIALISTS (5) x 2 attempts x
    // MAX_OUTPUT_TOKENS (8,000) is 80k output tokens, $2.00 at $25/MTok.
    const outputOnly = runCeilingUsd({ ...budget, maxAttemptsPerSpecialist: 1 }, 0);
    expect(outputOnly).toBeCloseTo((5 * 8_000 * 25) / 1_000_000, 6);
  });

  test("a run with only one attempt per specialist has no echoed re-ask input", () => {
    const oneAttempt = { ...budget, maxAttemptsPerSpecialist: 1 };
    const ceiling = runCeilingUsd(oneAttempt, 1_000);
    const expectedInputUsd = (5 * 1_000 * 5) / 1_000_000;
    const expectedOutputUsd = (5 * 1 * 8_000 * 25) / 1_000_000;
    expect(ceiling).toBeCloseTo(expectedInputUsd + expectedOutputUsd, 6);
  });

  test("grows with worstInputTokensPerCall, so a corridor-shaped set prices higher than a bare one", () => {
    const bare = runCeilingUsd(budget, 783);
    const corridor = runCeilingUsd(budget, 10_700);
    expect(corridor).toBeGreaterThan(bare);
  });

  test("a smaller maxOutputTokens (set D's shape) lowers the ceiling", () => {
    const full = runCeilingUsd(budget, 10_700);
    const edge = runCeilingUsd({ ...budget, maxOutputTokens: 512 }, 10_700);
    expect(edge).toBeLessThan(full);
  });
});
