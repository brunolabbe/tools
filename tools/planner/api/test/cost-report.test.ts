/**
 * The cost report, against a seeded database file (pl-49).
 *
 * A file rather than `:memory:`, because the report opens the database
 * read-only by path, the way it does beside a live server — an in-memory
 * database would be a second one, empty.
 *
 * **The seed is varied on purpose.** Four metered runs whose counts differ by
 * run, inserted out of order, so p50, p95 and the mean are three different
 * numbers and an unsorted percentile or a mean passed off as a median prints
 * the wrong one. A scripted run with no counts, a run outside the window and a
 * run still queued are each there to be left out.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { percentile, renderCostReport, runReport } from "../src/cost-report.ts";
import { migrate } from "../src/db/schema.ts";

const NOW = new Date("2026-09-14T12:00:00.000Z");

/** Every rate set: $5 input, $0.50 cache read, $6.25 cache write, $25 output. */
const ALL_PRICES = {
  MODEL_PRICE_INPUT_PER_MTOK: "5",
  MODEL_PRICE_CACHE_READ_PER_MTOK: "0.5",
  MODEL_PRICE_CACHE_WRITE_PER_MTOK: "6.25",
  MODEL_PRICE_OUTPUT_PER_MTOK: "25",
};

let dir: string;
let databasePath: string;

interface SeedRun {
  id: string;
  status: string;
  finishedAt: string | null;
  model: string | null;
  calls: number | null;
  tokens: [number, number, number, number] | null;
  fallbackCalls: number | null;
}

/**
 * Run k (1–4) spends 100,000k input, 1,000,000k cache read, 40,000k cache write
 * and 20,000k output — $1.75k at `ALL_PRICES`.
 */
function metered(k: number, status: string, fallbackCalls = 0): SeedRun {
  return {
    id: `metered-${String(k)}`,
    status,
    finishedAt: `2026-09-1${String(k)}T08:00:00.000Z`,
    model: "claude-opus-5",
    calls: 5,
    tokens: [100_000 * k, 1_000_000 * k, 40_000 * k, 20_000 * k],
    fallbackCalls,
  };
}

const SEED: SeedRun[] = [
  metered(3, "failed"),
  metered(1, "done"),
  metered(4, "canceled", 2),
  metered(2, "done"),
  // The scripted provider reports no counts: a run, and not a free one.
  {
    id: "scripted",
    status: "done",
    finishedAt: "2026-09-13T09:00:00.000Z",
    model: "scripted",
    calls: 5,
    tokens: null,
    fallbackCalls: 0,
  },
  // Outside a seven-day window, and large enough to move every figure if it
  // were counted.
  {
    id: "last-month",
    status: "done",
    finishedAt: "2026-08-01T08:00:00.000Z",
    model: "claude-opus-5",
    calls: 5,
    tokens: [90_000_000, 90_000_000, 90_000_000, 90_000_000],
    fallbackCalls: 9,
  },
  // Not finished, so not in any window.
  {
    id: "queued",
    status: "queued",
    finishedAt: null,
    model: null,
    calls: null,
    tokens: null,
    fallbackCalls: null,
  },
];

function seed(runs: readonly SeedRun[]): void {
  const db = new Database(databasePath);
  migrate(db);
  db.prepare(
    "INSERT INTO plans (id, title, brief_json, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run("p", "A trip", "{}", "then", "then");
  const insert = db.prepare(
    `INSERT INTO plan_runs
       (id, plan_id, status, started_at, finished_at, model, model_calls,
        input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, fallback_calls)
     VALUES (?, 'p', ?, 'then', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const run of runs) {
    insert.run(
      run.id,
      run.status,
      run.finishedAt,
      run.model,
      run.calls,
      ...(run.tokens ?? [null, null, null, null]),
      run.fallbackCalls,
    );
  }
  db.close();
}

function report(argv: string[], env: Record<string, string> = {}) {
  let stdout = "";
  let stderr = "";
  const code = runReport({
    argv,
    env: { DATABASE_PATH: databasePath, ...env },
    now: NOW,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

/** The figures on one row of the token table, as printed. */
function tokenRow(output: string, label: string): string[] {
  const line = output.split("\n").find((entry) => entry.startsWith(`  ${label.padEnd(12)} `));
  if (line === undefined) throw new Error(`no row for ${label}`);
  return line
    .slice(2 + 12)
    .trim()
    .split(/\s+/);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "planner-cost-report-"));
  databasePath = path.join(dir, "planner.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the cost report", () => {
  test("counts the window's runs by terminal status, and nothing outside it", () => {
    seed(SEED);
    const { code, stdout } = report(["--days", "7"]);

    expect(code).toBe(0);
    expect(stdout).toContain("Runs by status (5 in all)");
    expect(stdout).toMatch(/^ {2}done {7}3$/m);
    expect(stdout).toMatch(/^ {2}failed {5}1$/m);
    expect(stdout).toMatch(/^ {2}canceled {3}1$/m);
    expect(stdout).not.toMatch(/queued/);
  });

  test("prints p50, p95 and the mean of each token kind, over the runs that reported one", () => {
    seed(SEED);
    const { stdout } = report(["--days", "7"]);

    expect(stdout).toContain("Tokens per run (4 of 5 runs reported counts)");
    expect(tokenRow(stdout, "input")).toEqual(["200,000", "400,000", "250,000"]);
    expect(tokenRow(stdout, "cache read")).toEqual(["2,000,000", "4,000,000", "2,500,000"]);
    expect(tokenRow(stdout, "cache write")).toEqual(["80,000", "160,000", "100,000"]);
    expect(tokenRow(stdout, "output")).toEqual(["40,000", "80,000", "50,000"]);
  });

  test("with every price set, prints dollars per run and in total, and says whose prices they are", () => {
    seed(SEED);
    const { stdout } = report(["--days", "7"], ALL_PRICES);

    expect(stdout).toContain(
      "Dollars per run, at the prices set now — not the prices each run was billed at",
    );
    // $1.75, $3.50, $5.25 and $7.00 — the scripted run is not priced at zero.
    expect(stdout).toContain("p50 $3.5000   p95 $7.0000   mean $4.3750   total $17.5000");
  });

  test.each([
    [
      "one price",
      { ...ALL_PRICES, MODEL_PRICE_CACHE_WRITE_PER_MTOK: "" },
      "MODEL_PRICE_CACHE_WRITE_PER_MTOK is not set",
    ],
    [
      "two prices",
      { MODEL_PRICE_INPUT_PER_MTOK: "5", MODEL_PRICE_OUTPUT_PER_MTOK: "25" },
      "MODEL_PRICE_CACHE_READ_PER_MTOK, MODEL_PRICE_CACHE_WRITE_PER_MTOK are not set",
    ],
    [
      "every price",
      {},
      "MODEL_PRICE_INPUT_PER_MTOK, MODEL_PRICE_CACHE_READ_PER_MTOK, MODEL_PRICE_CACHE_WRITE_PER_MTOK, MODEL_PRICE_OUTPUT_PER_MTOK are not set",
    ],
  ])("with %s unset, prints no dollar figure and names what is missing", (_name, env, missing) => {
    seed(SEED);
    const { code, stdout } = report(["--days", "7"], env);

    expect(code).toBe(0);
    expect(stdout).toContain(`Dollars: unknown, because ${missing}.`);
    expect(stdout).not.toContain("$");
  });

  test("says the dollars are approximate when a run in the window had a fallback call", () => {
    seed(SEED);
    const { stdout } = report(["--days", "7"], ALL_PRICES);

    expect(stdout).toContain(
      "Fallback: 1 run had a reply served by another model (2 calls). Those tokens are counted at the configured model's rates, so the dollars above are approximate.",
    );
  });

  test("and says there was none when there was none", () => {
    const text = renderCostReport({
      rows: [],
      days: 1,
      since: "2026-09-13T12:00:00.000Z",
      prices: {
        inputPerMTok: undefined,
        outputPerMTok: undefined,
        cacheReadPerMTok: undefined,
        cacheWritePerMTok: undefined,
      },
    });
    expect(text).toContain("Fallback: no run in this window had a reply served by another model.");
    expect(text).toContain("Tokens per run (0 of 0 runs reported counts)");
  });

  test("refuses a --days that is not a whole number of days", () => {
    seed(SEED);
    for (const argv of [[], ["--days"], ["--days", "0"], ["--days", "1.5"], ["--days", "a"]]) {
      const { code, stdout, stderr } = report(argv);
      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toContain("--days");
    }
  });

  test("refuses a price that is not a number, as the server's boot does", () => {
    seed(SEED);
    const { code, stderr } = report(["--days", "7"], { MODEL_PRICE_INPUT_PER_MTOK: "five" });
    expect(code).toBe(1);
    expect(stderr).toContain("MODEL_PRICE_INPUT_PER_MTOK");
  });

  test("opens the database read-only: one before migration 9 is refused and left as it was", () => {
    const db = new Database(databasePath);
    db.exec("CREATE TABLE plan_runs (id TEXT PRIMARY KEY) STRICT; PRAGMA user_version = 8;");
    db.close();

    const { code, stderr } = report(["--days", "7"]);

    expect(code).toBe(1);
    expect(stderr).toContain("schema version 8");
    const after = new Database(databasePath, { readonly: true });
    // Not migrated, not touched: a writer here would contend with the server's.
    expect(Number(after.pragma("user_version", { simple: true }))).toBe(8);
    expect(after.pragma("journal_mode", { simple: true })).toBe("delete");
    after.close();
  });

  test("does not create a database that is not there", () => {
    const { code, stderr } = report(["--days", "7"]);
    expect(code).toBe(1);
    expect(stderr).toContain("read-only");
    expect(existsSync(databasePath)).toBe(false);
  });
});

describe("percentile", () => {
  test("is nearest-rank, so every figure is a run that happened", () => {
    expect(percentile([40, 10, 30, 20], 50)).toBe(20);
    expect(percentile([40, 10, 30, 20], 95)).toBe(40);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});
