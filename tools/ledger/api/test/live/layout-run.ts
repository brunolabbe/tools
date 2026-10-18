/**
 * lg-38's measurement: can a model describe a workbook's layout well enough
 * that the books, reading through its description, import it?
 *
 * **This is not a vitest suite.** It is a script, run by hand with the owner's
 * key, because a real run spends real money and `npm test` must never be what
 * does that (pl-40's split, kept for the same reasons):
 *
 * - It lives under `test/`, so `tsconfig.tests.json` typechecks it.
 * - It is not named `*.test.ts`, so the ledger's vitest project never collects it.
 * - `assertLiveRunConsent` refuses before anything else runs unless
 *   `LEDGER_LIVE_RUN=1` is set and `ANTHROPIC_API_KEY` holds a key. A key in a
 *   shell is not consent to spend it. It refuses `ANTHROPIC_CUSTOM_HEADERS`
 *   too, as the ledger's own receipt reader does (pl-39): the SDK applies it
 *   to every request whatever the client is given.
 * - `--out` may not be inside the repository: the records are synthetic, but a
 *   run's output is never something to commit by accident.
 *
 * One model per invocation:
 *
 * ```sh
 * LEDGER_LIVE_RUN=1 ANTHROPIC_API_KEY=… node --import tsx \
 *   tools/ledger/api/test/live/layout-run.ts --model claude-haiku-5-5 \
 *   --price-in <USD per million input tokens> --price-out <USD per million output tokens> \
 *   --runs 3 --out <dir outside the repository> [--max-usd 5] [--effort medium] \
 *   [--figures shown|masked] [--fixtures lg7,csv-balance]
 * ```
 *
 * The prices have no default: a rate typed here from memory is a claim, and
 * the record carries whatever it was given. Every fixture is synthetic
 * (`../layout/fixtures.ts`), so nothing real leaves the machine; what is sent
 * is `layoutRequest`, its size recorded beside the API's own token count.
 *
 * Each run is one request: the prompt and the sheets' samples in, a
 * `WorkbookLayout` out as structured output. It is scored by `scoreLayout`
 * and written to `<out>/<model>/<fixture>-<run>.json`; when every run is done,
 * `<out>/<model>/summary.md` holds the table for lg-38's Log.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { workbookLayoutSchema } from "@ledger/contract";
import { LAYOUT_FIXTURE_NAMES, layoutFixtures } from "../layout/fixtures.ts";
import type { LayoutFixture } from "../layout/fixtures.ts";
import { scoreLayout } from "../layout/score.ts";
import type { Outcome, Score } from "../layout/score.ts";
import { DEFAULT_VIEW, estimateTokens, layoutRequest } from "../layout/view.ts";

/**
 * Refuses unless the run was asked for in so many words. Pure, so
 * `api/test/layout-live-gate.test.ts` proves it without spending anything.
 */
export function assertLiveRunConsent(env: NodeJS.ProcessEnv): string {
  if (env["LEDGER_LIVE_RUN"] !== "1") {
    throw new Error(
      "Refusing: LEDGER_LIVE_RUN=1 is not set. A key in the shell is not consent to spend it.",
    );
  }
  const key = env["ANTHROPIC_API_KEY"]?.trim() ?? "";
  if (key === "") throw new Error("Refusing: ANTHROPIC_API_KEY is not set.");
  // The SDK reads this variable whatever the client is given, and a header in
  // it can replace the key or change what a request bills (pl-39). Blank is
  // unset, as the SDK reads it. The value is never repeated: it may carry a key.
  if ((env["ANTHROPIC_CUSTOM_HEADERS"]?.trim() ?? "") !== "") {
    throw new Error(
      "Refusing: ANTHROPIC_CUSTOM_HEADERS is set. The Anthropic SDK applies it to every request and it can replace the key. Unset it.",
    );
  }
  return key;
}

/** What a model answered, as the harness needs it. */
export interface Answer {
  text: string | null;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

export type Ask = (request: string) => Promise<Answer>;

export interface MeasureOptions {
  model: string;
  effort: "low" | "medium" | "high";
  figures: "shown" | "masked";
  runs: number;
  /** USD per million tokens. */
  priceIn: number;
  priceOut: number;
  maxUsd: number;
  /** Where the records go; the model's name is a directory under it. */
  out: string;
  /** Every fixture when absent. */
  fixtures?: readonly string[];
}

export interface RunRecord {
  fixture: string;
  run: number;
  model: string;
  effort: string;
  figures: string;
  requestChars: number;
  requestTokensEstimated: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stopReason: string | null;
  score: Score;
  /** The model's answer as parsed, or `null` when it was no JSON. */
  answer: unknown;
}

/** Room for thinking on top of a description of a few hundred tokens, as the receipt reader gives it. */
export const MAX_OUTPUT_TOKENS = 16_000;

function cost(options: MeasureOptions, input: number, output: number): number {
  return (input * options.priceIn + output * options.priceOut) / 1_000_000;
}

function noAnswer(issue: string): Score {
  return {
    outcome: "invalid",
    valid: false,
    verified: false,
    sameImport: false,
    matched: false,
    issues: [issue],
    problems: 0,
    differences: [],
  };
}

/** Every run, written as it finishes; the spend stop refuses a run whose ceiling would pass `maxUsd`. */
export async function measure(options: MeasureOptions, ask: Ask): Promise<RunRecord[]> {
  const all = await layoutFixtures();
  const chosen: LayoutFixture[] =
    options.fixtures === undefined
      ? all
      : all.filter((fixture) => options.fixtures?.includes(fixture.name));
  const directory = path.join(options.out, options.model);
  mkdirSync(directory, { recursive: true });
  const records: RunRecord[] = [];
  let spent = 0;
  for (const fixture of chosen) {
    const request = layoutRequest(fixture.sheets, { ...DEFAULT_VIEW, figures: options.figures });
    // Two characters a token is well over what French text and figures take,
    // so the ceiling is one, not a guess.
    const ceiling = cost(options, Math.ceil(request.length / 2), MAX_OUTPUT_TOKENS);
    for (let run = 1; run <= options.runs; run++) {
      if (spent + ceiling > options.maxUsd) {
        throw new Error(
          `Stopping before ${fixture.name} run ${String(run)}: its ceiling of $${ceiling.toFixed(4)} would take the session past --max-usd=$${options.maxUsd.toFixed(2)} ($${spent.toFixed(4)} spent).`,
        );
      }
      const answer = await ask(request);
      const costUsd = cost(options, answer.inputTokens, answer.outputTokens);
      spent += costUsd;
      let parsed: unknown = null;
      let score: Score;
      if (answer.stopReason !== "end_turn" || answer.text === null) {
        score = noAnswer(`stopped: ${answer.stopReason ?? "no reason"}`);
      } else {
        try {
          parsed = JSON.parse(answer.text);
          score = scoreLayout(fixture, parsed);
        } catch {
          score = noAnswer("the answer is not JSON");
        }
      }
      const record: RunRecord = {
        fixture: fixture.name,
        run,
        model: options.model,
        effort: options.effort,
        figures: options.figures,
        requestChars: request.length,
        requestTokensEstimated: estimateTokens(request),
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        costUsd,
        stopReason: answer.stopReason,
        score,
        answer: parsed,
      };
      records.push(record);
      writeFileSync(
        path.join(directory, `${fixture.name}-${String(run)}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
      );
    }
  }
  writeFileSync(path.join(directory, "summary.md"), summary(records));
  return records;
}

const OUTCOMES: readonly Outcome[] = [
  "matched",
  "same-import",
  "refused",
  "let-through",
  "invalid",
];

/** The Log's table: one row per fixture, then the total. */
export function summary(records: readonly RunRecord[]): string {
  const head =
    "| Model | Fixture | Runs | Passed | Matched | Same import | Caught | Let through | Invalid | Input tokens (mean) | Output tokens (mean) | Cost per run (mean) |";
  const rule = `|${" --- |".repeat(12)}`;
  const groups = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = `${record.model}\u0000${record.fixture}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const row = (model: string, fixture: string, group: readonly RunRecord[]): string => {
    const count = (outcome: Outcome): number =>
      group.filter((record) => record.score.outcome === outcome).length;
    const mean = (pick: (record: RunRecord) => number): number =>
      group.reduce((sum, record) => sum + pick(record), 0) / Math.max(1, group.length);
    const passed = group.filter((record) => record.score.verified).length;
    return `| ${model} | ${fixture} | ${String(group.length)} | ${String(passed)} | ${String(count("matched"))} | ${String(count("same-import"))} | ${String(count("refused"))} | ${String(count("let-through"))} | ${String(count("invalid"))} | ${String(Math.round(mean((record) => record.inputTokens)))} | ${String(Math.round(mean((record) => record.outputTokens)))} | $${mean((record) => record.costUsd).toFixed(4)} |`;
  };
  const lines = [head, rule];
  for (const group of groups.values()) {
    const [first] = group;
    if (first !== undefined) lines.push(row(first.model, first.fixture, group));
  }
  const [any] = records;
  if (any !== undefined) lines.push(row(any.model, "**all**", records));
  const outcomes = OUTCOMES.map(
    (outcome) =>
      `- ${outcome}: ${String(records.filter((record) => record.score.outcome === outcome).length)}`,
  );
  return `${lines.join("\n")}\n\nOutcomes over ${String(records.length)} runs:\n\n${outcomes.join("\n")}\n`;
}

// --- The command ---

/** The repository this file is in: `--out` must be outside it. */
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

const USAGE =
  "Usage: LEDGER_LIVE_RUN=1 ANTHROPIC_API_KEY=… node --import tsx tools/ledger/api/test/live/layout-run.ts --model <id> --price-in <usd/Mtok> --price-out <usd/Mtok> --out <dir> [--runs 3] [--max-usd 5] [--effort low|medium|high] [--figures shown|masked] [--fixtures a,b]";

export function parseCli(argv: readonly string[]): MeasureOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index] ?? "";
    // Everything after the first `=` is the value: a path may hold one.
    const equals = flag.indexOf("=");
    const name = equals === -1 ? flag : flag.slice(0, equals);
    const inline = equals === -1 ? undefined : flag.slice(equals + 1);
    if (!name.startsWith("--")) throw new Error(`${USAGE}\nUnexpected ${flag}`);
    const value = inline ?? argv[++index];
    if (value === undefined) throw new Error(`${USAGE}\n${name} needs a value`);
    values.set(name, value);
  }
  const known = new Set([
    "--model",
    "--price-in",
    "--price-out",
    "--out",
    "--runs",
    "--max-usd",
    "--effort",
    "--figures",
    "--fixtures",
  ]);
  for (const name of values.keys()) {
    if (!known.has(name)) throw new Error(`${USAGE}\nUnknown ${name}`);
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined || value.trim() === "")
      throw new Error(`${USAGE}\n${name} is required`);
    return value;
  };
  const positive = (name: string, fallback?: number): number => {
    const raw = values.get(name);
    const value = raw === undefined ? fallback : Number(raw);
    if (value === undefined) throw new Error(`${USAGE}\n${name} is required`);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
    return value;
  };
  const effort = values.get("--effort") ?? "medium";
  if (effort !== "low" && effort !== "medium" && effort !== "high") {
    throw new Error("--effort is low, medium or high");
  }
  const figures = values.get("--figures") ?? "shown";
  if (figures !== "shown" && figures !== "masked") throw new Error("--figures is shown or masked");
  const runs = positive("--runs", 3);
  if (!Number.isInteger(runs)) throw new Error("--runs is a whole number");
  const fixtures = values
    .get("--fixtures")
    ?.split(",")
    .map((name) => name.trim());
  const unknown = fixtures?.filter((name) => !LAYOUT_FIXTURE_NAMES.includes(name)) ?? [];
  if (unknown.length > 0) {
    throw new Error(
      `--fixtures names ${unknown.join(", ")}, which is no fixture (${LAYOUT_FIXTURE_NAMES.join(", ")}).`,
    );
  }
  const out = path.resolve(required("--out"));
  const inside = path.relative(REPOSITORY, out);
  if (
    inside === "" ||
    (inside !== ".." && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside))
  ) {
    throw new Error(`--out ${out} is inside the repository; give a directory outside it.`);
  }
  return {
    model: required("--model"),
    priceIn: positive("--price-in"),
    priceOut: positive("--price-out"),
    out,
    runs,
    maxUsd: positive("--max-usd", 5),
    effort,
    figures,
    ...(fixtures === undefined ? {} : { fixtures }),
  };
}

/**
 * The real model, built only after consent. Every option the SDK reads from
 * the environment when it is not given one is given here; the one it reads
 * whatever it is given, `ANTHROPIC_CUSTOM_HEADERS`, `assertLiveRunConsent`
 * has already refused.
 */
function anthropicAsk(apiKey: string, options: MeasureOptions): Ask {
  const client = new Anthropic({
    apiKey,
    authToken: null,
    webhookKey: null,
    baseURL: "https://api.anthropic.com",
    timeout: 180_000,
    maxRetries: 2,
    logLevel: "off",
  });
  const format = zodOutputFormat(workbookLayoutSchema);
  return async (request) => {
    const message = await client.messages.create({
      model: options.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: options.effort, format },
      messages: [{ role: "user", content: request }],
    });
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    return {
      text: text.length === 0 ? null : text.join(""),
      stopReason: message.stop_reason,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  };
}

async function main(): Promise<void> {
  const apiKey = assertLiveRunConsent(process.env);
  const options = parseCli(process.argv.slice(2));
  const records = await measure(options, anthropicAsk(apiKey, options));
  process.stdout.write(summary(records));
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
