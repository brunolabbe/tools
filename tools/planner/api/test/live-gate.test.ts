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
import { assertLiveRunConsent, parseCli, runCeilingUsd } from "./live/run.ts";
import type { RunBudget } from "@planner/agent";

/**
 * The first gate's own mutation, reproduced literally: `outputCeilingTokens`
 * without the attempts factor, and the input ceiling collapsed to
 * `worstInputTokensPerCall` alone, dropping the re-ask's echo entirely.
 * Asserted different from `runCeilingUsd` below, so a future accidental
 * simplification back to this shape fails a test rather than passing quietly.
 */
function mutantCeiling(budget: RunBudget, worstInputTokensPerCall: number): number {
  const outputCeilingTokens = budget.maxSpecialists * budget.maxOutputTokens;
  const inputCeilingTokens = budget.maxSpecialists * worstInputTokensPerCall;
  return (outputCeilingTokens * 25 + inputCeilingTokens * 5) / 1_000_000;
}

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
  // The production default `runBudgetFor` returns under the deployed
  // 8,000-token cap: 2 attempts, not 1. The first gate found that no test
  // here exercised this shape at all — every prior test either isolated a
  // single attempt or passed `worstInputTokensPerCall: 0`, and a mutation
  // that dropped the second attempt's echoed input still passed all of them.
  const productionBudget = {
    maxSpecialists: 5,
    maxOutputTokens: 8_000,
    maxAttemptsPerSpecialist: 2,
  };

  test("the production (2-attempt) budget, A-shaped (no finds, ~783 input tokens): reproduces the filing's own ≈$2.24 ceiling", () => {
    // Build step 3 / the filing's Log: output is 5 specialists x 2 attempts x
    // 8,000 tokens = 80,000 tokens, $2.00 at $25/MTok. Input is attempt 1
    // (783) plus attempt 2, which echoes attempt 1's reply back plus the
    // complaint: 783 + (783 + 8,000) = 9,566 per specialist, x5 = 47,830
    // tokens, $0.23915 at $5/MTok. Total $2.23915, which the filing rounds to
    // $2.24 and this test pins to the cent.
    const ceiling = runCeilingUsd(productionBudget, 783);
    expect(ceiling).toBeCloseTo(2.0 + 0.23915, 5);
    expect(Number(ceiling.toFixed(2))).toBe(2.24);
  });

  test("the production (2-attempt) budget, B/C-shaped (~10,700 input tokens): reproduces the filing's own ≈$2.73 ceiling", () => {
    // Output is unchanged (still 80,000 tokens, $2.00). Input per specialist
    // is 10,700 + (10,700 + 8,000) = 29,400, x5 = 147,000 tokens, $0.735 at
    // $5/MTok. Total $2.735.
    const ceiling = runCeilingUsd(productionBudget, 10_700);
    expect(ceiling).toBeCloseTo(2.0 + 0.735, 5);
    // $2.735 exactly, which floating-point rounding prints as "$2.73" rather
    // than "$2.74" — confirmed against the gate's own independent arithmetic.
    expect(ceiling.toFixed(2)).toBe("2.73");
  });

  test("set D's budget (maxOutputTokens: 512, B-shaped input): reproduces a ≈$0.68 ceiling", () => {
    // Output: 5 x 2 x 512 = 5,120 tokens, $0.128. Input per specialist:
    // 10,700 + (10,700 + 512) = 21,912, x5 = 109,560 tokens, $0.5478. Total
    // $0.6758.
    const setDBudget = { ...productionBudget, maxOutputTokens: 512 };
    const ceiling = runCeilingUsd(setDBudget, 10_700);
    expect(ceiling).toBeCloseTo(0.128 + 0.5478, 5);
  });

  test("isolating the output term: 1 attempt is 40k tokens / $1.00, 2 attempts (production) is 80k tokens / $2.00", () => {
    const oneAttemptOutputOnly = runCeilingUsd(
      { ...productionBudget, maxAttemptsPerSpecialist: 1 },
      0,
    );
    expect(oneAttemptOutputOnly).toBeCloseTo((5 * 8_000 * 25) / 1_000_000, 6);
    expect(oneAttemptOutputOnly).toBeCloseTo(1.0, 6);

    // A 0-input, 2-attempt call still carries the echo term itself
    // (`maxOutputTokens` is echoed back on the re-ask even if attempt 1's
    // input was free), so isolating the *output* line item at 2 attempts
    // means reading it back out of the golden-value tests above instead:
    // $2.23915 (A) minus $0.23915 (its input line) is $2.00 exactly, and
    // that arithmetic is independently checked by the two golden tests.
    const twoAttempts = runCeilingUsd(productionBudget, 783);
    const twoAttemptsInputLine = 5 * (783 + (783 + 8_000)) * (5 / 1_000_000);
    expect(twoAttempts - twoAttemptsInputLine).toBeCloseTo(2.0, 6);
  });

  test("a run with only one attempt per specialist has no echoed re-ask input", () => {
    const oneAttempt = { ...productionBudget, maxAttemptsPerSpecialist: 1 };
    const ceiling = runCeilingUsd(oneAttempt, 1_000);
    const expectedInputUsd = (5 * 1_000 * 5) / 1_000_000;
    const expectedOutputUsd = (5 * 1 * 8_000 * 25) / 1_000_000;
    expect(ceiling).toBeCloseTo(expectedInputUsd + expectedOutputUsd, 6);
  });

  test("grows with worstInputTokensPerCall, so a corridor-shaped set prices higher than a bare one", () => {
    const bare = runCeilingUsd(productionBudget, 783);
    const corridor = runCeilingUsd(productionBudget, 10_700);
    expect(corridor).toBeGreaterThan(bare);
  });

  test("a smaller maxOutputTokens (set D's shape) lowers the ceiling", () => {
    const full = runCeilingUsd(productionBudget, 10_700);
    const edge = runCeilingUsd({ ...productionBudget, maxOutputTokens: 512 }, 10_700);
    expect(edge).toBeLessThan(full);
  });

  test("a mutant that drops the re-ask's echoed input term is caught (regression for the first gate's MED 2)", () => {
    const real = runCeilingUsd(productionBudget, 783);
    const mutant = mutantCeiling(productionBudget, 783);
    expect(mutant).toBeCloseTo(1.01958, 4); // matches the gate's own reported "$1.02"
    expect(real).not.toBeCloseTo(mutant, 2);
  });
});

describe("parseCli", () => {
  test("reads --out and --max-usd in space-separated form", () => {
    expect(parseCli(["--out", "/tmp/x", "--max-usd", "2.5"])).toEqual({
      outDir: "/tmp/x",
      maxUsd: 2.5,
    });
  });

  test("reads --out and --max-usd in --flag=value form (the gate's MED 3)", () => {
    expect(parseCli(["--out", "/tmp/x", "--max-usd=0.01"])).toEqual({
      outDir: "/tmp/x",
      maxUsd: 0.01,
    });
  });

  test("defaults --max-usd to 10 only when the flag is absent entirely", () => {
    expect(parseCli(["--out", "/tmp/x"])).toEqual({ outDir: "/tmp/x", maxUsd: 10 });
  });

  test("--max-usd with no following value throws rather than silently keeping the default (the gate's MED 3)", () => {
    expect(() => parseCli(["--out", "/tmp/x", "--max-usd"])).toThrow(/requires a value/);
  });

  test("--out with no following value throws", () => {
    expect(() => parseCli(["--max-usd", "5", "--out"])).toThrow(/requires a value/);
  });

  test("an unrecognized argument throws rather than being silently ignored", () => {
    expect(() => parseCli(["--out", "/tmp/x", "--bogus", "1"])).toThrow(/Unrecognized argument/);
  });

  test("no --out throws, naming the usage", () => {
    expect(() => parseCli(["--max-usd", "5"])).toThrow(/--out/);
  });

  test("a non-positive or non-numeric --max-usd throws", () => {
    expect(() => parseCli(["--out", "/tmp/x", "--max-usd", "0"])).toThrow(
      /must be a positive number/,
    );
    expect(() => parseCli(["--out", "/tmp/x", "--max-usd", "nope"])).toThrow(
      /must be a positive number/,
    );
  });
});
