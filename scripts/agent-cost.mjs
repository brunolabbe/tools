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
 * **Cache writes are priced by TTL.** `usage.cache_creation` splits the
 * combined `cache_creation_input_tokens` into `ephemeral_5m_input_tokens` and
 * `ephemeral_1h_input_tokens`, and the two are billed at 1.25× and 2× the
 * input rate. Five minutes is a subagent's default, not a property of one:
 * every subagent sample measured while repo-53 built this was 5-minute only,
 * a main session's transcript is 1-hour (this script's 2026-09-26 revision
 * read one whose every write was, which the combined figure would have
 * under-priced by 37.5%), and since 2026-09-26 the builder and gate
 * definitions set `experimental: cacheTtl: 1h`. A record with no split prices
 * its whole write at the 5-minute rate, as before.
 *
 * **Two more facts per file, both read rather than priced.** `effort` is the
 * top-level field every assistant record carries (checked on a 2026-09-26
 * transcript: 70 of 70 billed records), printed so a pairing's effort is a
 * recorded fact the way its model is. `cold` counts responses that paid to
 * re-cache their transcript because the cache had expired, and it needs two
 * signals: a write above half the response's context, and a gap since the
 * previous assistant record longer than the TTL the run's last write used —
 * one hour if it wrote any 1-hour tokens, five minutes otherwise. The first
 * signal alone is sentinelle's `agent-usage.mjs`'s measure, and on its own it
 * also counts a warm turn whose fresh tool result is half its context: over the
 * 28 subagent transcripts the devcontainer kept (2026-08-25 to 09-02), 21 turns
 * passed it, 12 of them 5 to 25 minutes after the previous assistant record and
 * 9 within a minute of it. The gap is measured from the previous **assistant**
 * record, because a wake writes a `user` record at wake time and the reply
 * follows it within seconds. A file without timestamps counts no cold turns.
 *
 * **Time, per agent.** `active` sums the gaps between consecutive timestamped
 * records that fall between 0 and five minutes; a longer gap is waiting — on
 * a person, a gate, a wake — and the WSL clock this runs under also jumps, so
 * negative gaps are dropped. `wall` is the first timestamp to the last. The
 * cap and the method are sentinelle's `agent-usage.mjs`'s; the figures are
 * approximate, and the total sums active time only.
 *
 * **An agent can be named by id** (`--agent <id>`) instead of by its task
 * output file: the transcript is looked up at
 * `<config>/projects/<project>/<session>/subagents/agent-<id>.jsonl`, where
 * `<config>` is `CLAUDE_CONFIG_DIR` or `~/.claude`. An id is what an `Agent`
 * result reports and what an orchestrator already holds for `SendMessage`,
 * and an agent whose last turn ended in a message — the case the per-agent
 * table used to record as `not reported` — still has a transcript.
 *
 * **The session that launched the agents is priced too.** Each `--agent`'s
 * transcript sits at `<project>/<session>/subagents/`, and the session's own
 * is `<project>/<session>.jsonl` beside that directory; it is printed once per
 * session as `orchestrator <session id>` and counted in the total. The
 * orchestrator's own transcript went unpriced until 2026-09-26 (history.md's
 * 2026-09-20 row says so), and sentinelle's worked example puts it at about a
 * quarter of a ticket. **A session file read mid-batch is a floor**: it is the
 * live transcript of the session running the command, and it grows after the
 * run that read it.
 *
 * **Each response is priced at its own model's rate**, and every model a file
 * carries is printed. A file with two models used to be refused, so that a
 * resumed session that changed models could not blend two rate tables into
 * one number; pricing per response keeps that promise without refusing the
 * file, which matters since Claude Code documents automatic model fallback on
 * Fable, Opus 5.5 and Opus 5 as a model switch mid-session. Model ids are
 * normalised before the lookup — a `[1m]` context suffix and a `-YYYYMMDD`
 * date suffix name no different rate — as in sentinelle's `agent-usage.mjs`.
 *
 * **A file is refused, not zero-priced, when it can't be read honestly**: a
 * model id this table has no rate for, because pricing it at zero would
 * understate a bill exactly when a new model needs its rate added. Refusing
 * loudly beats a wrong number that looks like a right one — see
 * `citations.mjs` and `next-id.mjs` for the same stance elsewhere in this
 * repo.
 *
 * One file's failure does not stop the run: every file argument is priced
 * independently, a bad file is reported to stderr and excluded from the
 * total, and the good files still print. The exit code is a bitmask of every
 * failure class seen, for the same reason `citations.mjs`'s is — the classes
 * co-occur across a batch of files, and a ranking would hide whichever lost.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const USAGE = "usage: node scripts/agent-cost.mjs [--agent <id>]... [<output-file>...]";

/**
 * The date these rates were read, printed beside every dollar figure this
 * prints so a stale table is visible rather than silently assumed current.
 *
 * Read from the `claude-api` skill's cached pricing table and
 * `shared/prompt-caching.md`'s Economics section (cache write is 1.25× the
 * input rate at the default 5-minute TTL and 2× at the 1-hour one; cache read
 * is 0.1× the input rate, except Claude Fable 5.1's documented flat
 * $0.25/MTok and Claude Opus 5.5's $0.20/MTok, which is 0.05× its input and
 * the same figure as Sonnet 5's and Sonnet 5.5's).
 */
export const RATES_READ_ON = "2026-09-30";

/**
 * Per-million-token rates, keyed by the model id `normaliseModel` returns.
 *
 * A model id with no entry here fails loudly (`EXIT.missingRate`) rather than
 * pricing at zero — see the module doc comment. Add a model here the same day
 * its rate is read, and move `RATES_READ_ON` forward with it.
 */
export const RATES = /** @type {const} */ ({
  "claude-opus-5-5": {
    input: 4.0,
    cacheWrite: 5.0,
    cacheWrite1h: 8.0,
    cacheRead: 0.2,
    output: 20.0,
  },
  "claude-opus-5": {
    input: 5.0,
    cacheWrite: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
    output: 25.0,
  },
  "claude-sonnet-5-5": {
    input: 2.0,
    cacheWrite: 2.5,
    cacheWrite1h: 4.0,
    cacheRead: 0.2,
    output: 10.0,
  },
  "claude-sonnet-5": {
    input: 2.0,
    cacheWrite: 2.5,
    cacheWrite1h: 4.0,
    cacheRead: 0.2,
    output: 10.0,
  },
  "claude-haiku-4-5": {
    input: 1.0,
    cacheWrite: 1.25,
    cacheWrite1h: 2.0,
    cacheRead: 0.1,
    output: 5.0,
  },
  "claude-fable-5-1": {
    input: 10.0,
    cacheWrite: 12.5,
    cacheWrite1h: 20.0,
    cacheRead: 0.25,
    output: 50.0,
  },
});

/**
 * Which bit of the exit code each failure class sets. A bitmask rather than a
 * ranking, because a run over several files can hit more than one class at
 * once and a ranking would hide whichever lost — same reasoning as
 * `citations.mjs`'s `EXIT`. Bit `2` is retired: it was `multipleModels` until
 * 2026-09-26, when a file carrying two models became priced per turn instead
 * of refused, and it is not reused so an old exit code cannot change meaning.
 */
export const EXIT = /** @type {const} */ ({
  unreadableFile: 1,
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
 * A gap between two records longer than this is not counted as active time:
 * the agent was waiting — on a person, on another agent, or asleep between a
 * report and a wake — and the WSL clock this runs under jumps, so a gap can
 * also be negative. The cap is sentinelle's `agent-usage.mjs`'s
 * (`MAX_ACTIVE_GAP_MS`), and the active figure is approximate either way.
 */
export const MAX_ACTIVE_GAP_MS = 5 * 60 * 1000;

/** The two prompt-cache TTLs a write can carry; see `cold` in the module doc. */
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * The id a rate is keyed by: a context suffix (`[1m]`) and a date suffix
 * (`-20251001`) name no different price, and which form a transcript records
 * has not been checked for every model — Opus 5.5's is undated, Haiku 4.5's is
 * unverified — so both forms price, as in sentinelle's `agent-usage.mjs`.
 *
 * @param {string} model
 * @returns {string}
 */
export function normaliseModel(model) {
  return model.replace(/\[[^\]]*\]$/u, "").replace(/-\d{8}$/u, "");
}

/**
 * @typedef {{model: string, input: number, cacheWrite: number, cacheWrite1h: number, cacheRead: number, output: number}} Response
 * @typedef {{models: string[], responses: Response[], input: number, cacheWrite: number, cacheWrite1h: number, cacheRead: number, output: number, syntheticSkipped: number, efforts: string[], coldRestarts: number, activeMs: number, wallMs: number}} FileTotals
 */

/**
 * Sum the billed token fields over every **billed API response** in one
 * transcript's contents, keeping each response's own model.
 *
 * A response is not a record: streaming logs the same response once per
 * content block plus a final record, all sharing one `requestId` and
 * `message.id` and identical `input_tokens`/`cache_creation_input_tokens`/
 * `cache_read_input_tokens` — only `output_tokens` grows across them, ending
 * at the true billed figure on the final record. So records are grouped by
 * `requestId ?? message.id` first, this keeps each group's largest
 * `output_tokens` and that same record's other fields, and only the kept,
 * deduplicated figures are summed. See the module doc comment for the
 * measurement that found this.
 *
 * A `"<synthetic>"` `message.model` (a session-limit marker, not a billed
 * response) is skipped and counted in `syntheticSkipped`.
 *
 * `models` is every distinct normalised model the billed responses carry,
 * sorted; each response keeps its own, and `priceFile` prices it by that one.
 * `cacheWrite` stays the combined write and `cacheWrite1h` is the part of it
 * written at the 1-hour TTL; `efforts` is every distinct `effort` the billed
 * records carry, sorted, with `unrecorded` for a record that has none;
 * `coldRestarts` counts responses whose write exceeds half of their input,
 * write and read together, **and** which began longer after the previous
 * assistant record than the TTL of the run's last write — see the module doc;
 * `activeMs` sums the gaps between consecutive timestamped records that fall
 * between 0 and `MAX_ACTIVE_GAP_MS`, and `wallMs` is the last timestamp minus
 * the first — both 0 for a file with fewer than two timestamps.
 *
 * Refuses (`EXIT.noAssistantRecords`) a file with no billable assistant
 * records at all, rather than returning a zero-cost row that reads as a real,
 * cheap file.
 *
 * @param {string} content
 * @param {string} file
 * @returns {FileTotals}
 */
export function sumUsage(content, file) {
  /** @type {Set<string>} */
  const models = new Set();
  /** @type {Map<string, Response>} */
  const responses = new Map();
  /** @type {Set<string>} */
  const efforts = new Set();
  /** @type {number[]} */
  const timestamps = [];
  /** @type {Map<string, number | null>} ms since the previous assistant record, per response */
  const gaps = new Map();
  /** @type {number | null} */
  let lastAssistantAt = null;
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
      /** @type {{type?: unknown, timestamp?: unknown, requestId?: unknown, effort?: unknown, message?: {id?: unknown, model?: unknown, usage?: Record<string, unknown>}}} */ (
        record
      );
    /** @type {number | null} */
    let at = null;
    if (typeof rec.timestamp === "string") {
      const parsed = Date.parse(rec.timestamp);
      if (!Number.isNaN(parsed)) {
        at = parsed;
        timestamps.push(parsed);
      }
    }
    if (rec.type !== "assistant") continue;

    const raw = rec.message?.model;
    if (raw === SYNTHETIC_MODEL) {
      syntheticSkipped += 1;
      continue;
    }
    if (typeof raw !== "string") continue;
    const model = normaliseModel(raw);
    models.add(model);
    efforts.add(typeof rec.effort === "string" ? rec.effort : "unrecorded");

    // requestId first, then message.id, and a per-line fallback when neither
    // is present — so a record with no id is its own group rather than
    // merging with an unrelated one that also lacks an id.
    const key =
      typeof rec.requestId === "string"
        ? rec.requestId
        : typeof rec.message?.id === "string"
          ? rec.message.id
          : `line:${i}`;

    if (!gaps.has(key)) {
      gaps.set(key, at !== null && lastAssistantAt !== null ? at - lastAssistantAt : null);
    }
    if (at !== null) lastAssistantAt = at;

    const usage = rec.message?.usage ?? {};
    const output = Number(usage.output_tokens ?? 0);
    const kept = responses.get(key);
    if (!kept || output > kept.output) {
      responses.set(key, {
        model,
        input: Number(usage.input_tokens ?? 0),
        cacheWrite: Number(usage.cache_creation_input_tokens ?? 0),
        cacheWrite1h: Number(
          /** @type {{ephemeral_1h_input_tokens?: unknown} | undefined} */ (usage.cache_creation)
            ?.ephemeral_1h_input_tokens ?? 0,
        ),
        cacheRead: Number(usage.cache_read_input_tokens ?? 0),
        output,
      });
    }
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
  let cacheWrite1h = 0;
  let cacheRead = 0;
  let output = 0;
  let coldRestarts = 0;
  let ttlMs = FIVE_MINUTES_MS;
  for (const [key, kept] of responses) {
    input += kept.input;
    cacheWrite += kept.cacheWrite;
    cacheWrite1h += kept.cacheWrite1h;
    cacheRead += kept.cacheRead;
    output += kept.output;
    const context = kept.input + kept.cacheWrite + kept.cacheRead;
    const gap = gaps.get(key) ?? null;
    if (context > 0 && kept.cacheWrite > context / 2 && gap !== null && gap > ttlMs) {
      coldRestarts += 1;
    }
    if (kept.cacheWrite > 0) ttlMs = kept.cacheWrite1h > 0 ? ONE_HOUR_MS : FIVE_MINUTES_MS;
  }

  let activeMs = 0;
  for (let i = 1; i < timestamps.length; i += 1) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap >= 0 && gap <= MAX_ACTIVE_GAP_MS) activeMs += gap;
  }
  const wallMs = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

  return {
    models: [...models].toSorted(),
    responses: [...responses.values()],
    input,
    cacheWrite,
    cacheWrite1h,
    cacheRead,
    output,
    syntheticSkipped,
    efforts: [...efforts].toSorted(),
    coldRestarts,
    activeMs,
    wallMs,
  };
}

/**
 * @typedef {FileTotals & {dollars: number}} PricedTotals
 */

/**
 * Price one file's responses against `RATES`, each at its own model's rate.
 *
 * Refuses (`EXIT.missingRate`) a file any of whose models this table has no
 * rate for, rather than pricing that model at zero — the whole point of the
 * refusal, per the module doc comment, is that a missing rate must not look
 * like a free file.
 *
 * @param {FileTotals} totals
 * @param {string} file
 * @returns {PricedTotals}
 */
export function priceFile(totals, file) {
  const unrated = totals.models.filter((model) => !(model in RATES));
  if (unrated.length > 0) {
    throw fail(
      `${file}: no rate for model ${unrated.map((m) => JSON.stringify(m)).join(", ")} — add it ` +
        `to RATES in scripts/agent-cost.mjs rather than pricing it at zero`,
      EXIT.missingRate,
    );
  }
  let dollars = 0;
  for (const r of totals.responses) {
    const rate = RATES[/** @type {keyof typeof RATES} */ (r.model)];
    dollars +=
      (r.input / 1_000_000) * rate.input +
      ((r.cacheWrite - r.cacheWrite1h) / 1_000_000) * rate.cacheWrite +
      (r.cacheWrite1h / 1_000_000) * rate.cacheWrite1h +
      (r.cacheRead / 1_000_000) * rate.cacheRead +
      (r.output / 1_000_000) * rate.output;
  }
  return { ...totals, dollars };
}

/** `$` plus four decimal places — enough to distinguish files costing cents from files costing tenths of a cent. */
export function formatDollars(n) {
  return `$${n.toFixed(4)}`;
}

/** Two digits, for the minutes and seconds of a duration. */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/** A duration as `1h02m03s`, `2m03s` or `3s`. */
export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${pad2(m)}m${pad2(sec)}s`;
  if (m > 0) return `${m}m${pad2(sec)}s`;
  return `${sec}s`;
}

/**
 * @typedef {PricedTotals & {file: string}} Row
 */

/** ` (N synthetic records skipped)`, or `""` when there were none — never printed for a zero count. */
function syntheticNote(count) {
  return count > 0 ? `  (${count} synthetic record${count === 1 ? "" : "s"} skipped)` : "";
}

/** ` (1h N)` after the combined write when any of it was written at the 1-hour TTL. */
function oneHourNote(count) {
  return count > 0 ? ` (1h ${count})` : "";
}

/**
 * One line per priced file, in the order given, then a total row summing the
 * token fields, the cold restarts, the active time and the dollar figure
 * across them. Each file's row names every model and effort it ran at, its
 * active and wall-clock time, and its cold restarts; the total has no wall
 * clock, because agents overlap and a sum of wall clocks measures nothing.
 * `RATES_READ_ON` is printed beside every dollar figure — the per-file ones and
 * the total — so a line copied out of a longer run still carries the date its
 * number depends on.
 *
 * @param {Row[]} rows
 * @returns {string}
 */
export function render(rows) {
  const lines = rows.map(
    (r) =>
      `${r.file}  ${r.models.join("+")}  effort=${r.efforts.join("/")}  ` +
      `active=${formatDuration(r.activeMs)} wall=${formatDuration(r.wallMs)}  input=${r.input} ` +
      `cacheWrite=${r.cacheWrite}${oneHourNote(r.cacheWrite1h)} cacheRead=${r.cacheRead} ` +
      `output=${r.output} cold=${r.coldRestarts}  ${formatDollars(r.dollars)} ` +
      `(rates read ${RATES_READ_ON})${syntheticNote(r.syntheticSkipped)}`,
  );

  const total = rows.reduce(
    (acc, r) => ({
      input: acc.input + r.input,
      cacheWrite: acc.cacheWrite + r.cacheWrite,
      cacheWrite1h: acc.cacheWrite1h + r.cacheWrite1h,
      cacheRead: acc.cacheRead + r.cacheRead,
      output: acc.output + r.output,
      dollars: acc.dollars + r.dollars,
      syntheticSkipped: acc.syntheticSkipped + r.syntheticSkipped,
      coldRestarts: acc.coldRestarts + r.coldRestarts,
      activeMs: acc.activeMs + r.activeMs,
    }),
    {
      input: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      output: 0,
      dollars: 0,
      syntheticSkipped: 0,
      coldRestarts: 0,
      activeMs: 0,
    },
  );
  lines.push(
    `total  active=${formatDuration(total.activeMs)}  input=${total.input} ` +
      `cacheWrite=${total.cacheWrite}${oneHourNote(total.cacheWrite1h)} ` +
      `cacheRead=${total.cacheRead} output=${total.output} cold=${total.coldRestarts}  ` +
      `${formatDollars(total.dollars)} (rates read ${RATES_READ_ON})` +
      `${syntheticNote(total.syntheticSkipped)}`,
  );
  return lines.join("\n");
}

/**
 * Files and `--agent` ids, in the order given, which is the order they print.
 *
 * @param {string[]} argv
 * @returns {({kind: "file" | "agent", value: string})[]}
 */
export function parseArgs(argv) {
  if (argv.length === 0) throw fail(USAGE, 1);
  /** @type {({kind: "file" | "agent", value: string})[]} */
  const inputs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--agent") {
      const id = argv[i + 1];
      if (id === undefined || id.startsWith("--")) throw fail(`--agent needs an id\n${USAGE}`, 1);
      inputs.push({ kind: "agent", value: id });
      i += 1;
    } else if (arg.startsWith("--")) {
      throw fail(`unknown option ${arg}\n${USAGE}`, 1);
    } else {
      inputs.push({ kind: "file", value: arg });
    }
  }
  return inputs;
}

/**
 * The transcript of the subagent with this id, searched for under every
 * project and session of the Claude Code config directory — see the module
 * doc comment. Refuses (`EXIT.unreadableFile`) an id with no transcript,
 * naming where it looked.
 *
 * @param {string} id
 * @param {string} [configDir]
 * @returns {string}
 */
export function findAgentTranscript(
  id,
  configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
) {
  const projects = path.join(configDir, "projects");
  const name = `agent-${id}.jsonl`;
  if (existsSync(projects)) {
    for (const project of readdirSync(projects, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      for (const session of readdirSync(path.join(projects, project.name), {
        withFileTypes: true,
      })) {
        if (!session.isDirectory()) continue;
        const candidate = path.join(projects, project.name, session.name, "subagents", name);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw fail(`agent ${id}: no ${name} under ${projects}/*/*/subagents`, EXIT.unreadableFile);
}

/**
 * The session that launched a subagent, from where its transcript lives: an
 * agent's file is `<project>/<session>/subagents/agent-<id>.jsonl`, and the
 * session's own is `<project>/<session>.jsonl` beside that directory — the
 * layout sentinelle's `agent-usage.mjs` reads its orchestrator line from.
 *
 * @param {string} agentFile
 * @returns {{id: string, file: string}}
 */
export function sessionOf(agentFile) {
  const sessionDir = path.dirname(path.dirname(agentFile));
  const id = path.basename(sessionDir);
  return { id, file: path.join(path.dirname(sessionDir), `${id}.jsonl`) };
}

/**
 * Read, sum and price one file. Reading is where the fourth guard lives —
 * `EXIT.unreadableFile` on a file `readFileSync` cannot open — alongside the
 * `sumUsage`/`priceFile` refusals above.
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
 * Price every file and agent given, independently, then the session every
 * `--agent` was launched from, once per session, as a row labelled
 * `orchestrator <session id>`. One that fails is reported to stderr and left
 * out of the printed rows and the total; the run still prints whatever
 * succeeded and returns the bitwise OR of every failure's exit bit. A session
 * with no transcript beside its agents is named on stderr and sets no bit: the
 * agents' rows are still right without it.
 *
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv = process.argv.slice(2)) {
  /** @type {Row[]} */
  const rows = [];
  /** @type {Map<string, string>} */
  const sessions = new Map();
  let exit = 0;
  const price = (label, file) => {
    try {
      rows.push({ file: label, ...processFile(file) });
    } catch (error) {
      const failure = /** @type {Error & {exit?: number}} */ (error);
      process.stderr.write(`${failure.message}\n`);
      exit |= failure.exit ?? 1;
    }
  };
  for (const input of parseArgs(argv)) {
    if (input.kind === "file") {
      price(input.value, input.value);
      continue;
    }
    let file;
    try {
      file = findAgentTranscript(input.value);
    } catch (error) {
      const failure = /** @type {Error & {exit?: number}} */ (error);
      process.stderr.write(`${failure.message}\n`);
      exit |= failure.exit ?? 1;
      continue;
    }
    const session = sessionOf(file);
    if (!sessions.has(session.id)) sessions.set(session.id, session.file);
    price(`agent-${input.value}`, file);
  }
  for (const [id, file] of sessions) {
    if (existsSync(file)) price(`orchestrator ${id}`, file);
    else process.stderr.write(`orchestrator ${id}: no session transcript at ${file}\n`);
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
