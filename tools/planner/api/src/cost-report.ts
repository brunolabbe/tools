/**
 * What the planner's runs cost, read off `plan_runs` (pl-49).
 *
 * The question behind it is the owner's: whether a public planner could pay
 * its own bill. That turns on what one run costs, and until pl-49 nothing
 * measured it — pl-39's figure was characters ÷ 4 over fixture briefs. This
 * reads what the runs actually reported, and prices it only when every rate is
 * known.
 *
 * `report.ts` is the process around it: argv, the environment, a read-only
 * database, stdout. Everything that decides a number is here, so a test can
 * seed a database and read the text back without a subprocess.
 *
 * ## What it will not do
 *
 * - **Guess a rate.** With any of the four prices unset it prints tokens, and a
 *   line naming the unset settings where the dollars would be.
 * - **Price each run at the rate it was billed.** It applies the prices set
 *   *now* to tokens stored *then*, and its heading says so. Storing the rate
 *   beside every run would be exact across a price change, and doubles what a
 *   run depends on for a case nobody has met.
 * - **Price a fallback at the fallback's rate.** A reply another model served is
 *   in the totals at the configured model's rates. The report says so when the
 *   window holds one, rather than pretending to a precision it has not got.
 * - **Print anything a traveller wrote.** It selects numbers, a status and a
 *   model name, and nothing else leaves the table.
 */

import { AppError } from "@planner/contract";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { loadApiConfig, MODEL_PRICE_VARIABLES, type ModelPrices } from "./config.ts";

/** The schema version that added the columns this reads — migration 9. */
export const USAGE_SCHEMA_VERSION = 9;

/** One finished run, as the report reads it. */
export interface RunUsageRow {
  status: string;
  model: string | null;
  model_calls: number | null;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  fallback_calls: number | null;
}

/** Runs that reached a terminal state at or after `since`. */
export function selectFinishedRuns(db: SqliteDatabase, since: string): RunUsageRow[] {
  return db
    .prepare(
      `SELECT status, model, model_calls, input_tokens, cache_read_tokens,
              cache_write_tokens, output_tokens, fallback_calls
         FROM plan_runs
        WHERE finished_at IS NOT NULL AND finished_at >= ?
        ORDER BY finished_at`,
    )
    .all(since) as RunUsageRow[];
}

/**
 * The nearest-rank percentile: the smallest value at least `p`% of the sample
 * is at or below.
 *
 * Nearest-rank rather than interpolated, so every figure printed is a run that
 * happened — with a handful of runs an interpolated p95 is a run nobody had.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const TOKEN_KINDS = [
  { label: "input", column: "input_tokens", price: "inputPerMTok" },
  { label: "cache read", column: "cache_read_tokens", price: "cacheReadPerMTok" },
  { label: "cache write", column: "cache_write_tokens", price: "cacheWritePerMTok" },
  { label: "output", column: "output_tokens", price: "outputPerMTok" },
] as const satisfies readonly {
  label: string;
  column: keyof RunUsageRow;
  price: keyof ModelPrices;
}[];

/** A run some provider reported a count for. A scripted run reports none. */
function isMetered(row: RunUsageRow): boolean {
  return TOKEN_KINDS.some((kind) => row[kind.column] !== null);
}

const STATUS_ORDER = ["done", "failed", "canceled"];

function tokens(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString("en-US");
}

function dollars(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(4)}`;
}

export interface CostReportInput {
  rows: readonly RunUsageRow[];
  days: number;
  /** The start of the window, as an ISO timestamp. */
  since: string;
  prices: ModelPrices;
}

export function renderCostReport(input: CostReportInput): string {
  const { rows, prices } = input;
  const lines: string[] = [];

  lines.push(
    `Planner runs that finished in the last ${String(input.days)} day${input.days === 1 ? "" : "s"} (since ${input.since})`,
    "",
  );

  // --- Runs by terminal status.
  const byStatus = new Map<string, number>();
  for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  const statuses = [
    ...STATUS_ORDER,
    ...[...byStatus.keys()].filter((status) => !STATUS_ORDER.includes(status)).toSorted(),
  ];
  lines.push(`Runs by status (${String(rows.length)} in all)`);
  for (const status of statuses) {
    lines.push(`  ${status.padEnd(10)} ${String(byStatus.get(status) ?? 0)}`);
  }

  const byModel = new Map<string, number>();
  for (const row of rows) {
    const model = row.model ?? "(not recorded)";
    byModel.set(model, (byModel.get(model) ?? 0) + 1);
  }
  if (byModel.size > 0) {
    const models = [...byModel.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([model, count]) => `${model} (${String(count)})`);
    lines.push(`  models     ${models.join(", ")}`);
  }
  lines.push("");

  // --- Tokens per run, one kind at a time.
  const metered = rows.filter(isMetered);
  lines.push(
    `Tokens per run (${String(metered.length)} of ${String(rows.length)} runs reported counts)`,
  );
  lines.push(
    `  ${"kind".padEnd(12)} ${"p50".padStart(12)} ${"p95".padStart(12)} ${"mean".padStart(12)}`,
  );
  for (const kind of TOKEN_KINDS) {
    const values = rows.flatMap((row) => {
      const value = row[kind.column];
      return value === null ? [] : [value];
    });
    lines.push(
      `  ${kind.label.padEnd(12)} ${tokens(percentile(values, 50)).padStart(12)} ${tokens(percentile(values, 95)).padStart(12)} ${tokens(mean(values)).padStart(12)}`,
    );
  }
  lines.push("");

  // --- Dollars, only with every rate known.
  const unset = TOKEN_KINDS.filter((kind) => prices[kind.price] === undefined).map(
    (kind) => MODEL_PRICE_VARIABLES[kind.price],
  );
  if (unset.length > 0) {
    lines.push(
      `Dollars: unknown, because ${unset.join(", ")} ${unset.length === 1 ? "is" : "are"} not set.`,
    );
  } else {
    // A kind a metered run did not report bills as nothing for that run: the
    // run is priced on what it did report, and a run with no counts at all is
    // left out rather than priced at zero.
    const perRun = metered.map((row) =>
      TOKEN_KINDS.reduce(
        (sum, kind) => sum + ((row[kind.column] ?? 0) * (prices[kind.price] ?? 0)) / 1_000_000,
        0,
      ),
    );
    lines.push("Dollars per run, at the prices set now — not the prices each run was billed at");
    if (perRun.length === 0) {
      lines.push("  no run in this window reported token counts, so there is nothing to price");
    } else {
      lines.push(
        `  p50 ${dollars(percentile(perRun, 50))}   p95 ${dollars(percentile(perRun, 95))}   mean ${dollars(mean(perRun))}   total ${dollars(perRun.reduce((sum, value) => sum + value, 0))}`,
      );
    }
  }
  lines.push("");

  // --- Fallbacks.
  const withFallback = rows.filter((row) => (row.fallback_calls ?? 0) > 0);
  if (withFallback.length === 0) {
    lines.push("Fallback: no run in this window had a reply served by another model.");
  } else {
    const calls = withFallback.reduce((sum, row) => sum + (row.fallback_calls ?? 0), 0);
    lines.push(
      `Fallback: ${String(withFallback.length)} run${withFallback.length === 1 ? "" : "s"} had a reply served by another model (${String(calls)} call${calls === 1 ? "" : "s"}). Those tokens are counted at the configured model's rates, so the dollars above are approximate.`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/** What `report.ts` hands in, so a test can drive the whole thing without a process. */
export interface ReportProcess {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  now: Date;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = "usage: node tools/planner/api/dist/report.js --days N\n";

function daysFrom(argv: readonly string[]): number | undefined {
  const index = argv.indexOf("--days");
  const raw = index === -1 ? undefined : argv[index + 1];
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const days = Number(raw);
  return days >= 1 ? days : undefined;
}

/**
 * The report, end to end. Returns the exit code.
 *
 * **The database is opened read-only**, and never migrated: this runs beside a
 * live server, which is the only writer, and a second writer here — even one
 * that only set a pragma — could contend with it. A database older than
 * migration 9 is refused with a sentence, rather than failing on a missing
 * column.
 */
export function runReport(io: ReportProcess): number {
  const days = daysFrom(io.argv);
  if (days === undefined) {
    io.stderr(`--days takes a whole number of days, at least 1.\n${USAGE}`);
    return 2;
  }

  let config;
  try {
    config = loadApiConfig({}, io.env);
  } catch (error: unknown) {
    io.stderr(`${AppError.from(error).message}\n`);
    return 1;
  }
  if (config.databasePath === ":memory:") {
    io.stderr("DATABASE_PATH is :memory:, and there is no database file to report on.\n");
    return 1;
  }

  let db: SqliteDatabase;
  try {
    db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
  } catch (error: unknown) {
    io.stderr(
      `Could not open ${config.databasePath} read-only: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }

  try {
    const version = Number(db.pragma("user_version", { simple: true }));
    if (version < USAGE_SCHEMA_VERSION) {
      io.stderr(
        `The database is at schema version ${String(version)}, and run costs are recorded from version ${String(USAGE_SCHEMA_VERSION)}. Start the planner once to migrate it.\n`,
      );
      return 1;
    }

    const since = new Date(io.now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    io.stdout(
      renderCostReport({
        rows: selectFinishedRuns(db, since),
        days,
        since,
        prices: config.modelPrices,
      }),
    );
    return 0;
  } finally {
    db.close();
  }
}
