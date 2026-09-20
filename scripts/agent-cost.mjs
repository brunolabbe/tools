#!/usr/bin/env node
/**
 * What a batch actually cost, read from the task output files a backgrounded
 * `Agent` dispatch leaves behind — not from `subagent_tokens`.
 *
 * repo-53's own numbers are why this exists: the tenth orchestration session
 * measured 152,659 subagent tokens against 3.9 M and 5.8 M tokens all-in for a
 * builder and its reviewer, because `subagent_tokens` excludes cache reads and
 * cache reads are 94 to 97% of the bill. The `standard` trial in `repo-28`
 * reported an "8% saving" from the subagent figure that was wrong by an order
 * of magnitude once cache reads were counted. Every efficiency decision this
 * loop has made — which model builds, how many gate rounds, whether to resume
 * or re-dispatch — was argued from the wrong number.
 *
 * A task output file is JSONL: one record per line, each carrying a `type`.
 * Only `"assistant"` records bill anything, and each one's `message.usage`
 * carries that request's `input_tokens`, `cache_creation_input_tokens`,
 * `cache_read_input_tokens` and `output_tokens`, alongside `message.model`.
 *
 * **One billed API response is logged as several `"assistant"` records**,
 * one per streamed content block plus a final record — repo-53's first gate
 * caught this on a real file (`ac9491c3ec452c459.output`): 438 assistant
 * records, only 223 distinct `requestId`/`message.id` values, and summing
 * every record priced the file at $60.8104 against a real bill of $32.7305, a
 * 1.858× overstatement in the same direction as the `subagent_tokens` defect
 * this script exists to retire. So this groups records by `requestId ??
 * message.id` first and takes each group's largest `output_tokens` — the
 * final record in the stream, its `input_tokens`/`cache_creation_input_tokens`/
 * `cache_read_input_tokens` taken from that same record, since every record in
 * a group carries identical values for those three fields — and only then
 * sums across groups. `stop_reason` is not the selector: on two of the four
 * sampled files its non-null count disagreed with the request-id count
 * (91-vs-89 and 148-vs-150), where `requestId` and `message.id` agreed exactly
 * on all four. A record with neither id (none of the sampled files had one) is
 * its own group by line number, so it neither merges with an unrelated record
 * nor is silently dropped.
 *
 * **A `message.model` of `"<synthetic>"` is not a billed model.** The harness
 * writes one when a request hit the account's session limit (HTTP 429):
 * `usage` is all zeros and the model id names no real model. Counting it as a
 * second model made the multiple-model guard refuse any file that a limit
 * ever touched mid-session — the ordinary case on a busy day, not a rare
 * one — so such records are skipped from both grouping and the model check,
 * counted, and the count is printed beside the row rather than folded in
 * silently. The brief this script started from assumed every assistant
 * record names a billed model; it does not.
 *
 * It does not split `cache_creation_input_tokens` by TTL
 * (`usage.cache_creation.ephemeral_5m_*` vs `ephemeral_1h_*`) — the field the
 * ticket asks this to sum is the combined one, and in every sample measured
 * while building this the 1-hour figure was zero, so the whole sum is priced
 * at the 5-minute write rate. A caller with a file that leans on 1-hour
 * caching will get a slight overstatement; there is nowhere in the summed
 * field to see that and correct it.
 *
 * **A file is refused, not zero-priced, when it can't be read honestly**: more
 * than one model id in one file (a resumed session that changed models
 * mid-flight would silently blend two rate tables into one number), or a
 * model id this table has no rate for (pricing it at zero would understate a
 * bill exactly when a new model needs its rate added). Refusing loudly beats
 * a wrong number that looks like a right one — see `citations.mjs` and
 * `next-id.mjs` for the same stance elsewhere in this repo.
 *
 * One file's failure does not stop the run: every file argument is priced
 * independently, a bad file is reported to stderr and excluded from the
 * total, and the good files still print. The exit code is a bitmask of every
 * failure class seen, for the same reason `citations.mjs`'s is — the classes
 * co-occur across a batch of files, and a ranking would hide whichever lost.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const USAGE = "usage: node scripts/agent-cost.mjs <output-file>...";

/**
 * The date these rates were read, printed beside every dollar figure this
 * prints so a stale table is visible rather than silently assumed current.
 *
 * Read from the `claude-api` skill's cached pricing table and
 * `shared/prompt-caching.md`'s Economics section (cache write is 1.25× the
 * input rate at the default 5-minute TTL; cache read is 0.1× the input rate,
 * except Claude Fable 5.1's documented flat $0.25/MTok).
 */
export const RATES_READ_ON = "2026-09-20";

/**
 * Per-million-token rates, keyed by the exact model id `message.model` holds.
 *
 * A model id with no entry here fails loudly (`EXIT.missingRate`) rather than
 * pricing at zero — see the module doc comment. Add a model here the same day
 * its rate is read, and move `RATES_READ_ON` forward with it.
 */
export const RATES = /** @type {const} */ ({
  "claude-opus-5": { input: 5.0, cacheWrite: 6.25, cacheRead: 0.5, output: 25.0 },
  "claude-sonnet-5": { input: 2.0, cacheWrite: 2.5, cacheRead: 0.2, output: 10.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, cacheWrite: 1.25, cacheRead: 0.1, output: 5.0 },
  "claude-fable-5-1": { input: 10.0, cacheWrite: 12.5, cacheRead: 0.25, output: 50.0 },
});

/**
 * Which bit of the exit code each failure class sets. A bitmask rather than a
 * ranking, because a run over several files can hit more than one class at
 * once and a ranking would hide whichever lost — same reasoning as
 * `citations.mjs`'s `EXIT`.
 */
export const EXIT = /** @type {const} */ ({
  unreadableFile: 1,
  multipleModels: 2,
  missingRate: 4,
  noAssistantRecords: 8,
});

/** An error carrying the exit bit the CLI should leave behind. */
function fail(message, exit) {
  return Object.assign(new Error(message), { exit });
}

/**
 * A `message.model` value that names no real, billable model — the harness's
 * own marker for a request that hit the session limit rather than a response
 * from any model.
 */
const SYNTHETIC_MODEL = "<synthetic>";

/**
 * @typedef {{model: string, input: number, cacheWrite: number, cacheRead: number, output: number, syntheticSkipped: number}} FileTotals
 */

/**
 * Sum the four billed token fields over every **billed API response** in one
 * task output file's contents, and name its single model id.
 *
 * A response is not a record: streaming logs the same response once per
 * content block plus a final record, all sharing one `requestId` and
 * `message.id` and identical `input_tokens`/`cache_creation_input_tokens`/
 * `cache_read_input_tokens` — only `output_tokens` grows across them, ending
 * at the true billed figure on the final record. So records are grouped by
 * `requestId ?? message.id` first, this keeps each group's largest
 * `output_tokens` and that same record's other three fields, and only the
 * kept, deduplicated figures are summed. See the module doc comment for the
 * measurement that found this.
 *
 * A `"<synthetic>"` `message.model` (a session-limit marker, not a billed
 * response — see the module doc comment) is skipped before either check:
 * it counts toward neither the model set nor the grouped totals, only toward
 * `syntheticSkipped`.
 *
 * Refuses (`EXIT.multipleModels`) a file whose **billable** assistant records
 * carry more than one `message.model` value, naming both. Refuses
 * (`EXIT.noAssistantRecords`) a file with no billable assistant records at
 * all, rather than returning a zero-cost row that reads as a real, cheap
 * file.
 *
 * @param {string} content
 * @param {string} file
 * @returns {FileTotals}
 */
export function sumUsage(content, file) {
  /** @type {Set<string>} */
  const models = new Set();
  /** @type {Map<string, {input: number, cacheWrite: number, cacheRead: number, output: number}>} */
  const responses = new Map();
  let syntheticSkipped = 0;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;

    /** @type {unknown} */
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw fail(
        `${file}:${i + 1}: not valid JSON (${/** @type {Error} */ (error).message})`,
        EXIT.unreadableFile,
      );
    }
    const rec =
      /** @type {{type?: unknown, requestId?: unknown, message?: {id?: unknown, model?: unknown, usage?: Record<string, unknown>}}} */ (
        record
      );
    if (rec.type !== "assistant") continue;

    const model = rec.message?.model;
    if (model === SYNTHETIC_MODEL) {
      syntheticSkipped += 1;
      continue;
    }
    if (typeof model === "string") models.add(model);

    // requestId first, then message.id, and a per-line fallback when neither
    // is present — so a record with no id is its own group rather than
    // merging with an unrelated one that also lacks an id (both fixtures and
    // any future record shape this hasn't seen yet).
    const key =
      typeof rec.requestId === "string"
        ? rec.requestId
        : typeof rec.message?.id === "string"
          ? rec.message.id
          : `line:${i}`;

    const usage = rec.message?.usage ?? {};
    const output = Number(usage.output_tokens ?? 0);
    const kept = responses.get(key);
    if (!kept || output > kept.output) {
      responses.set(key, {
        input: Number(usage.input_tokens ?? 0),
        cacheWrite: Number(usage.cache_creation_input_tokens ?? 0),
        cacheRead: Number(usage.cache_read_input_tokens ?? 0),
        output,
      });
    }
  }

  if (models.size > 1) {
    throw fail(
      `${file}: carries more than one model — ${[...models].toSorted().join(", ")}`,
      EXIT.multipleModels,
    );
  }
  if (models.size === 0) {
    throw fail(
      `${file}: no assistant records with a model id found` +
        (syntheticSkipped > 0
          ? ` (${syntheticSkipped} synthetic session-limit record${syntheticSkipped === 1 ? "" : "s"} skipped)`
          : ""),
      EXIT.noAssistantRecords,
    );
  }

  let input = 0;
  let cacheWrite = 0;
  let cacheRead = 0;
  let output = 0;
  for (const kept of responses.values()) {
    input += kept.input;
    cacheWrite += kept.cacheWrite;
    cacheRead += kept.cacheRead;
    output += kept.output;
  }

  return { model: [...models][0], input, cacheWrite, cacheRead, output, syntheticSkipped };
}

/**
 * @typedef {FileTotals & {dollars: number}} PricedTotals
 */

/**
 * Price one file's summed usage against `RATES`.
 *
 * Refuses (`EXIT.missingRate`) a model id this table has no rate for, rather
 * than pricing it at zero — the whole point of the refusal, per the module
 * doc comment, is that a missing rate must not look like a free file.
 *
 * @param {FileTotals} totals
 * @param {string} file
 * @returns {PricedTotals}
 */
export function priceFile(totals, file) {
  const rate = RATES[/** @type {keyof typeof RATES} */ (totals.model)];
  if (!rate) {
    throw fail(
      `${file}: no rate for model ${JSON.stringify(totals.model)} — add it to RATES in ` +
        `scripts/agent-cost.mjs rather than pricing it at zero`,
      EXIT.missingRate,
    );
  }
  const dollars =
    (totals.input / 1_000_000) * rate.input +
    (totals.cacheWrite / 1_000_000) * rate.cacheWrite +
    (totals.cacheRead / 1_000_000) * rate.cacheRead +
    (totals.output / 1_000_000) * rate.output;
  return { ...totals, dollars };
}

/** `$` plus four decimal places — enough to distinguish files costing cents from files costing tenths of a cent. */
export function formatDollars(n) {
  return `$${n.toFixed(4)}`;
}

/**
 * @typedef {PricedTotals & {file: string}} Row
 */

/** ` (N synthetic records skipped)`, or `""` when there were none — never printed for a zero count. */
function syntheticNote(count) {
  return count > 0 ? `  (${count} synthetic record${count === 1 ? "" : "s"} skipped)` : "";
}

/**
 * One line per priced file, in the order given, then a total row summing all
 * four token fields and the dollar figure across them. `RATES_READ_ON` is
 * printed beside every dollar figure — the per-file ones and the total —
 * rather than once at the top, so a line copied out of a longer run still
 * carries the date its number depends on. A file that skipped one or more
 * `"<synthetic>"` session-limit records says so beside its row, so the
 * skip is visible rather than folded silently into the totals.
 *
 * @param {Row[]} rows
 * @returns {string}
 */
export function render(rows) {
  const lines = rows.map(
    (r) =>
      `${r.file}  ${r.model}  input=${r.input} cacheWrite=${r.cacheWrite} ` +
      `cacheRead=${r.cacheRead} output=${r.output}  ${formatDollars(r.dollars)} ` +
      `(rates read ${RATES_READ_ON})${syntheticNote(r.syntheticSkipped)}`,
  );

  const total = rows.reduce(
    (acc, r) => ({
      input: acc.input + r.input,
      cacheWrite: acc.cacheWrite + r.cacheWrite,
      cacheRead: acc.cacheRead + r.cacheRead,
      output: acc.output + r.output,
      dollars: acc.dollars + r.dollars,
      syntheticSkipped: acc.syntheticSkipped + r.syntheticSkipped,
    }),
    { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, dollars: 0, syntheticSkipped: 0 },
  );
  lines.push(
    `total  input=${total.input} cacheWrite=${total.cacheWrite} cacheRead=${total.cacheRead} ` +
      `output=${total.output}  ${formatDollars(total.dollars)} (rates read ${RATES_READ_ON})` +
      `${syntheticNote(total.syntheticSkipped)}`,
  );
  return lines.join("\n");
}

/**
 * @param {string[]} argv
 * @returns {string[]}
 */
export function parseArgs(argv) {
  if (argv.length === 0) throw fail(USAGE, 1);
  for (const arg of argv) {
    if (arg.startsWith("--")) throw fail(`unknown option ${arg}\n${USAGE}`, 1);
  }
  return argv;
}

/**
 * Read, sum and price one file. Reading is where the fourth guard lives —
 * `EXIT.unreadableFile` on a file `readFileSync` cannot open — alongside the
 * three `sumUsage`/`priceFile` raise above.
 *
 * @param {string} file
 * @returns {PricedTotals}
 */
export function processFile(file) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    throw fail(`${file}: ${/** @type {Error} */ (error).message}`, EXIT.unreadableFile);
  }
  return priceFile(sumUsage(content, file), file);
}

/**
 * Price every file given, independently. A file that fails is reported to
 * stderr and left out of the printed rows and the total; the run still prints
 * whatever succeeded and returns the bitwise OR of every failure's exit bit.
 *
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv = process.argv.slice(2)) {
  const files = parseArgs(argv);
  /** @type {Row[]} */
  const rows = [];
  let exit = 0;
  for (const file of files) {
    try {
      rows.push({ file, ...processFile(file) });
    } catch (error) {
      const failure = /** @type {Error & {exit?: number}} */ (error);
      process.stderr.write(`${failure.message}\n`);
      exit |= failure.exit ?? 1;
    }
  }
  if (rows.length > 0) process.stdout.write(`${render(rows)}\n`);
  return exit;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    const failure = /** @type {Error & {exit?: number}} */ (error);
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = failure.exit ?? 1;
  }
}
