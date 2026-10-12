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

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, test } from "vitest";
import {
  assertLiveRunConsent,
  livePricesFor,
  observedUsd,
  parseCli,
  runCeilingUsd,
} from "./live/run.ts";
import type { LivePrices } from "./live/run.ts";
import type { RunBudget, RunUsage } from "@planner/agent";
import { loadApiConfig, MODEL_PRICE_VARIABLES } from "../src/config.ts";

/**
 * Opus 5's public rates, which the filing's golden ceilings below were worked
 * out at. A fixture, not the harness's: since pl-55 the harness reads its rates
 * from `MODEL_PRICE_*` and holds none itself, and the arithmetic these tests pin
 * is the same at any rate.
 */
const OPUS_5_RATES: LivePrices = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  cacheReadPerMTok: 0.5,
  cacheWritePerMTok: 6.25,
};

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
    const ceiling = runCeilingUsd(productionBudget, 783, OPUS_5_RATES);
    expect(ceiling).toBeCloseTo(2.0 + 0.23915, 5);
    expect(Number(ceiling.toFixed(2))).toBe(2.24);
  });

  test("the production (2-attempt) budget, B/C-shaped (~10,700 input tokens): reproduces the filing's own ≈$2.73 ceiling", () => {
    // Output is unchanged (still 80,000 tokens, $2.00). Input per specialist
    // is 10,700 + (10,700 + 8,000) = 29,400, x5 = 147,000 tokens, $0.735 at
    // $5/MTok. Total $2.735.
    const ceiling = runCeilingUsd(productionBudget, 10_700, OPUS_5_RATES);
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
    const ceiling = runCeilingUsd(setDBudget, 10_700, OPUS_5_RATES);
    expect(ceiling).toBeCloseTo(0.128 + 0.5478, 5);
  });

  test("isolating the output term: 1 attempt is 40k tokens / $1.00, 2 attempts (production) is 80k tokens / $2.00", () => {
    const oneAttemptOutputOnly = runCeilingUsd(
      { ...productionBudget, maxAttemptsPerSpecialist: 1 },
      0,
      OPUS_5_RATES,
    );
    expect(oneAttemptOutputOnly).toBeCloseTo((5 * 8_000 * 25) / 1_000_000, 6);
    expect(oneAttemptOutputOnly).toBeCloseTo(1.0, 6);

    // A 0-input, 2-attempt call still carries the echo term itself
    // (`maxOutputTokens` is echoed back on the re-ask even if attempt 1's
    // input was free), so isolating the *output* line item at 2 attempts
    // means reading it back out of the golden-value tests above instead:
    // $2.23915 (A) minus $0.23915 (its input line) is $2.00 exactly, and
    // that arithmetic is independently checked by the two golden tests.
    const twoAttempts = runCeilingUsd(productionBudget, 783, OPUS_5_RATES);
    const twoAttemptsInputLine = 5 * (783 + (783 + 8_000)) * (5 / 1_000_000);
    expect(twoAttempts - twoAttemptsInputLine).toBeCloseTo(2.0, 6);
  });

  test("a run with only one attempt per specialist has no echoed re-ask input", () => {
    const oneAttempt = { ...productionBudget, maxAttemptsPerSpecialist: 1 };
    const ceiling = runCeilingUsd(oneAttempt, 1_000, OPUS_5_RATES);
    const expectedInputUsd = (5 * 1_000 * 5) / 1_000_000;
    const expectedOutputUsd = (5 * 1 * 8_000 * 25) / 1_000_000;
    expect(ceiling).toBeCloseTo(expectedInputUsd + expectedOutputUsd, 6);
  });

  test("grows with worstInputTokensPerCall, so a corridor-shaped set prices higher than a bare one", () => {
    const bare = runCeilingUsd(productionBudget, 783, OPUS_5_RATES);
    const corridor = runCeilingUsd(productionBudget, 10_700, OPUS_5_RATES);
    expect(corridor).toBeGreaterThan(bare);
  });

  test("a smaller maxOutputTokens (set D's shape) lowers the ceiling", () => {
    const full = runCeilingUsd(productionBudget, 10_700, OPUS_5_RATES);
    const edge = runCeilingUsd({ ...productionBudget, maxOutputTokens: 512 }, 10_700, OPUS_5_RATES);
    expect(edge).toBeLessThan(full);
  });

  test("a mutant that drops the re-ask's echoed input term is caught (regression for the first gate's MED 2)", () => {
    const real = runCeilingUsd(productionBudget, 783, OPUS_5_RATES);
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

describe("runCeilingUsd follows the rates it is given (pl-55)", () => {
  const productionBudget = {
    maxSpecialists: 5,
    maxOutputTokens: 8_000,
    maxAttemptsPerSpecialist: 2,
  };

  test("the same budget at a synthetic rate prices its own token counts, not Opus 5's", () => {
    // B-shaped: 80,000 output tokens and 147,000 input tokens (the $2.73
    // golden test's counts), at $0.10 in and $0.50 out: $0.04 + $0.0147.
    const rates: LivePrices = {
      inputPerMTok: 0.1,
      outputPerMTok: 0.5,
      cacheReadPerMTok: 0.01,
      cacheWritePerMTok: 0.125,
    };
    expect(runCeilingUsd(productionBudget, 10_700, rates)).toBeCloseTo(0.04 + 0.0147, 9);
  });

  test("scaling every rate by k scales the ceiling by k", () => {
    const base = runCeilingUsd(productionBudget, 783, OPUS_5_RATES);
    for (const k of [0.02, 0.4, 3]) {
      const scaled: LivePrices = {
        inputPerMTok: OPUS_5_RATES.inputPerMTok * k,
        outputPerMTok: OPUS_5_RATES.outputPerMTok * k,
        cacheReadPerMTok: OPUS_5_RATES.cacheReadPerMTok * k,
        cacheWritePerMTok: OPUS_5_RATES.cacheWritePerMTok * k,
      };
      expect(runCeilingUsd(productionBudget, 783, scaled)).toBeCloseTo(base * k, 9);
    }
  });

  test("zero rates are a zero ceiling, so nothing in it still reads a constant", () => {
    const zero: LivePrices = {
      inputPerMTok: 0,
      outputPerMTok: 0,
      cacheReadPerMTok: 0,
      cacheWritePerMTok: 0,
    };
    expect(runCeilingUsd(productionBudget, 10_700, zero)).toBe(0);
  });
});

describe("livePricesFor (pl-55)", () => {
  const ALL_FOUR = {
    [MODEL_PRICE_VARIABLES.inputPerMTok]: "0.1",
    [MODEL_PRICE_VARIABLES.outputPerMTok]: "0.5",
    [MODEL_PRICE_VARIABLES.cacheReadPerMTok]: "0.01",
    [MODEL_PRICE_VARIABLES.cacheWritePerMTok]: "0.125",
  };

  test("under anthropic, refuses with one rate unset and names that variable", () => {
    for (const variable of Object.values(MODEL_PRICE_VARIABLES)) {
      const env: NodeJS.ProcessEnv = { MODEL_PROVIDER: "anthropic", ...ALL_FOUR };
      delete env[variable];
      const config = loadApiConfig({}, env);
      expect(() => livePricesFor(config)).toThrow(`Refusing: ${variable} is unset.`);
    }
  });

  test("under anthropic with none set, names all four", () => {
    const config = loadApiConfig({}, { MODEL_PROVIDER: "anthropic" });
    expect(() => livePricesFor(config)).toThrow(
      `Refusing: ${Object.values(MODEL_PRICE_VARIABLES).join(", ")} are unset.`,
    );
  });

  test("under anthropic with all four set, returns them", () => {
    const config = loadApiConfig({}, { MODEL_PROVIDER: "anthropic", ...ALL_FOUR });
    expect(livePricesFor(config)).toEqual({
      inputPerMTok: 0.1,
      outputPerMTok: 0.5,
      cacheReadPerMTok: 0.01,
      cacheWritePerMTok: 0.125,
    });
  });

  test("under scripted with none set, returns zeros — the keyless run needs nothing", () => {
    const config = loadApiConfig({}, {});
    expect(config.modelProvider).toBe("scripted");
    expect(livePricesFor(config)).toEqual({
      inputPerMTok: 0,
      outputPerMTok: 0,
      cacheReadPerMTok: 0,
      cacheWritePerMTok: 0,
    });
  });
});

describe("observedUsd follows the rates it is given (pl-55 gate 1)", () => {
  // The scripted run reports `null` usage, so no run here can see a rate
  // `observedUsd` ignores: only a golden over all four token kinds can. The
  // dollars are worked by hand, per MTok.
  // `thinkingTokens` is a share of `outputTokens`, already priced there, so a
  // non-zero one must add nothing.
  const usage: RunUsage = {
    calls: 10,
    inputTokens: 12_345,
    outputTokens: 6_789,
    thinkingTokens: 2_000,
    cacheReadTokens: 4_000,
    cacheWriteTokens: 1_500,
    fallbackCalls: 0,
  };

  test("at 2 / 10 / 0.2 / 2.5: 24,690 + 67,890 + 800 + 3,750 micro-dollars", () => {
    const rates = {
      inputPerMTok: 2,
      outputPerMTok: 10,
      cacheReadPerMTok: 0.2,
      cacheWritePerMTok: 2.5,
    };
    expect(observedUsd(usage, rates)).toBeCloseTo(0.09713, 9);
  });

  test("at 4 / 20 / 0.2 / 5: 49,380 + 135,780 + 800 + 7,500 micro-dollars", () => {
    const rates = {
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheReadPerMTok: 0.2,
      cacheWritePerMTok: 5,
    };
    expect(observedUsd(usage, rates)).toBeCloseTo(0.19346, 9);
  });
});

describe("main() refuses on an unset rate before it builds a provider (pl-55 gate 1)", () => {
  // `livePricesFor` alone cannot prove the ordering: moving it below
  // `createModelProvider` leaves every test above green. With both a rate and
  // the key missing, whichever refusal prints is the one that ran first.
  const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
  const SCRIPT = path.resolve(import.meta.dirname, "live/run.ts");

  test("names the unset MODEL_PRICE_* variable, not the missing key", () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(env)) {
      if (name.startsWith("MODEL") || name.startsWith("ANTHROPIC_")) delete env[name];
    }
    Object.assign(env, {
      PLANNER_LIVE_RUN: "1",
      MODEL_PROVIDER: "anthropic",
      [MODEL_PRICE_VARIABLES.inputPerMTok]: "1",
      [MODEL_PRICE_VARIABLES.cacheReadPerMTok]: "0.1",
      [MODEL_PRICE_VARIABLES.cacheWritePerMTok]: "1.25",
    });
    const outDir = mkdtempSync(path.join(os.tmpdir(), "pl-55-refusal-"));
    try {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", SCRIPT, "--out", path.join(outDir, "records")],
        { cwd: REPO_ROOT, env, encoding: "utf8", shell: false },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Refusing: ${MODEL_PRICE_VARIABLES.outputPerMTok} is unset.`);
      expect(result.stderr).not.toContain("ANTHROPIC_API_KEY");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});
