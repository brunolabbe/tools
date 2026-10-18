/**
 * lg-38's live harness, without a model: it refuses without consent, and with
 * a fake model it writes the records and the table the owner's run will. No
 * key, no network, nothing spent.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assertLiveRunConsent, measure, parseCli } from "./live/layout-run.ts";
import type { Answer, Ask, MeasureOptions } from "./live/layout-run.ts";
import { layoutFixtures } from "./layout/fixtures.ts";
import { layoutView } from "./layout/view.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ledger-layout-run-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(overrides: Partial<MeasureOptions> = {}): MeasureOptions {
  return {
    model: "fake-model",
    effort: "medium",
    figures: "shown",
    runs: 2,
    priceIn: 1,
    priceOut: 5,
    maxUsd: 5,
    out: dir,
    ...overrides,
  };
}

/** A fake that answers each fixture's correct layout, told apart by what it was shown. */
async function answering(): Promise<{ ask: Ask; asked: string[] }> {
  const fixtures = await layoutFixtures();
  const asked: string[] = [];
  const ask: Ask = (request) => {
    const found = fixtures.find((fixture) => request.endsWith(layoutView(fixture.sheets)));
    asked.push(found?.name ?? "none");
    const answer: Answer = {
      text: found === undefined ? null : JSON.stringify(found.layout),
      stopReason: "end_turn",
      inputTokens: 2_000,
      outputTokens: 400,
    };
    return Promise.resolve(answer);
  };
  return { ask, asked };
}

describe("the layout measurement's harness", () => {
  test("refuses without LEDGER_LIVE_RUN=1, and without a key", () => {
    expect(() => assertLiveRunConsent({ ANTHROPIC_API_KEY: "sk-test" })).toThrow(
      "LEDGER_LIVE_RUN=1 is not set",
    );
    expect(() => assertLiveRunConsent({ LEDGER_LIVE_RUN: "true", ANTHROPIC_API_KEY: "k" })).toThrow(
      "LEDGER_LIVE_RUN=1 is not set",
    );
    expect(() => assertLiveRunConsent({ LEDGER_LIVE_RUN: "1", ANTHROPIC_API_KEY: " " })).toThrow(
      "ANTHROPIC_API_KEY is not set",
    );
    expect(assertLiveRunConsent({ LEDGER_LIVE_RUN: "1", ANTHROPIC_API_KEY: "k" })).toBe("k");
  });

  test("takes no price it was not given, and no flag it does not know", () => {
    expect(() => parseCli(["--model", "m", "--out", dir, "--price-out", "5"])).toThrow(
      "--price-in is required",
    );
    expect(() =>
      parseCli(["--model", "m", "--out", dir, "--price-in", "1", "--price-out", "5", "--key", "x"]),
    ).toThrow("Unknown --key");
    expect(
      parseCli([
        "--model=m",
        "--out",
        dir,
        "--price-in",
        "1",
        "--price-out=5",
        "--fixtures",
        "lg7, csv-balance",
      ]),
    ).toEqual({
      model: "m",
      out: dir,
      priceIn: 1,
      priceOut: 5,
      runs: 3,
      maxUsd: 5,
      effort: "medium",
      figures: "shown",
      fixtures: ["lg7", "csv-balance"],
    });
  });

  test("scores every run, writes a record per run and the table, and prices each from its usage", async () => {
    const { ask, asked } = await answering();
    const records = await measure(options(), ask);

    // Each fixture twice, in the order the measurement runs them.
    const names = (await layoutFixtures()).flatMap((fixture) => [fixture.name, fixture.name]);
    expect(names).toHaveLength(26);
    expect(asked).toEqual(names);
    expect(records.every((record) => record.score.outcome === "matched")).toBe(true);
    // 2 000 in at $1 and 400 out at $5 a million.
    expect(records[0]?.costUsd).toBeCloseTo(0.004, 10);
    const written = readdirSync(path.join(dir, "fake-model")).toSorted();
    expect(written).toHaveLength(27);
    expect(written).toContain("summary.md");
    const table = readFileSync(path.join(dir, "fake-model", "summary.md"), "utf8");
    expect(table).toContain(
      "| fake-model | csv-no-balance | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 2000 | 400 | $0.0040 |",
    );
    expect(table).toContain("| fake-model | **all** | 26 | 26 | 26 |");
  });

  test("an answer cut short, or not JSON, is scored invalid, never read", async () => {
    const records = await measure(options({ runs: 1, fixtures: ["lg7"] }), (): Promise<Answer> =>
      Promise.resolve({ text: "{", stopReason: "max_tokens", inputTokens: 10, outputTokens: 10 }),
    );
    expect(records.map((record) => [record.score.outcome, record.score.issues])).toEqual([
      ["invalid", ["stopped: max_tokens"]],
    ]);
    const garbled = await measure(options({ runs: 1, fixtures: ["lg7"] }), (): Promise<Answer> =>
      Promise.resolve({
        text: "not json",
        stopReason: "end_turn",
        inputTokens: 10,
        outputTokens: 10,
      }),
    );
    expect(garbled[0]?.score.issues).toEqual(["the answer is not JSON"]);
  });

  test("stops before a run whose ceiling would pass --max-usd, not after it", async () => {
    const { ask, asked } = await answering();
    // A run's ceiling is 16 000 output tokens at $5 a million and its input
    // at two characters a token, $0.0827 for lg-7; the first run spends $0.004.
    await expect(
      measure(options({ maxUsd: 0.085, runs: 3, fixtures: ["lg7"] }), ask),
    ).rejects.toThrow("Stopping before lg7 run 2");
    expect(asked).toEqual(["lg7"]);
  });
});

// lg-38 gate 1: the custom-headers refusal and the CLI's three guards.
describe("the layout measurement's harness, round 1", () => {
  /** The repository this test is in: `test` → `api` → `ledger` → `tools` → the root. */
  const repository = path.resolve(import.meta.dirname, "../../../..");
  const need = ["--model", "m", "--price-in", "1", "--price-out", "5"];

  test("refuses ANTHROPIC_CUSTOM_HEADERS beside the key, and never repeats its value", () => {
    const env = {
      LEDGER_LIVE_RUN: "1",
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_CUSTOM_HEADERS: "x-demo-header: from-the-shell",
    };
    expect(() => assertLiveRunConsent(env)).toThrow("ANTHROPIC_CUSTOM_HEADERS is set");
    expect(() => assertLiveRunConsent(env)).not.toThrow("from-the-shell");
    // Blank is unset, as the SDK reads it.
    expect(assertLiveRunConsent({ ...env, ANTHROPIC_CUSTOM_HEADERS: "  " })).toBe("k");
  });

  test("refuses an --out inside the repository, however it is spelled", () => {
    for (const out of [
      repository,
      path.join(repository, "tools", "ledger", "docs", "x"),
      path.join(repository, "results", "..", "results"),
    ]) {
      expect(() => parseCli([...need, "--out", out]), out).toThrow("is inside the repository");
    }
    expect(parseCli([...need, "--out", dir]).out).toBe(path.resolve(dir));
  });

  test("keeps everything after the first = as the value", () => {
    const out = path.join(dir, "a=b");
    expect(parseCli([...need, `--out=${out}`]).out).toBe(out);
  });

  test("refuses a --fixtures name that is no fixture, naming it", () => {
    expect(() => parseCli([...need, "--out", dir, "--fixtures", "lg7,lg-37"])).toThrow(
      "--fixtures names lg-37, which is no fixture",
    );
  });
});
