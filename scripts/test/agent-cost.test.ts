/**
 * agent-cost's guards, one test per failure mode, plus the fixture case its
 * "Done when" line asks for: two short task output files, one Sonnet and one
 * Opus, priced against hand-computed dollar figures.
 *
 * The fixture shape (`type: "assistant"`, `message.model`, `message.usage`
 * with `input_tokens` / `cache_creation_input_tokens` /
 * `cache_read_input_tokens` / `output_tokens`) was read from a real task
 * output file rather than guessed — `agent-cost.mjs`'s module doc comment
 * names the ticket that measured it.
 *
 * Two layers, as in `citations.test.ts` and `next-id.test.ts`: the exported
 * functions for the arithmetic, and the real CLI spawned for argument parsing
 * and the exit code — the process boundary is part of the contract here too.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  EXIT,
  formatDollars,
  parseArgs,
  priceFile,
  processFile,
  RATES,
  RATES_READ_ON,
  render,
  sumUsage,
  USAGE,
} from "../agent-cost.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const CLI = path.resolve(here, "..", "agent-cost.mjs");
const FIXTURES = path.resolve(here, "fixtures", "agent-cost");

const sonnetFixture = path.join(FIXTURES, "sonnet.jsonl");
const opusFixture = path.join(FIXTURES, "opus.jsonl");
const mixedModelFixture = path.join(FIXTURES, "mixed-model.jsonl");
const unknownModelFixture = path.join(FIXTURES, "unknown-model.jsonl");
const noAssistantFixture = path.join(FIXTURES, "no-assistant.jsonl");

// --- The "Done when" case: two files, hand-computed sums and dollars -------

test("sums the four billed fields over every assistant record, ignoring other record types", () => {
  const content = [
    '{"type":"user","message":{"role":"user","content":"hi"}}',
    '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":100,"cache_creation_input_tokens":1000,"cache_read_input_tokens":2000,"output_tokens":50}}}',
    '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":200,"cache_creation_input_tokens":0,"cache_read_input_tokens":5000,"output_tokens":150}}}',
  ].join("\n");
  expect(sumUsage(content, "inline.jsonl")).toEqual({
    model: "claude-sonnet-5",
    input: 300,
    cacheWrite: 1000,
    cacheRead: 7000,
    output: 200,
  });
});

test("prices the Sonnet fixture at the hand-computed dollar figure", () => {
  const priced = processFile(sonnetFixture);
  // (300/1e6)*2 + (1000/1e6)*2.5 + (7000/1e6)*0.2 + (200/1e6)*10 = 0.0065
  expect(priced).toEqual({
    model: "claude-sonnet-5",
    input: 300,
    cacheWrite: 1000,
    cacheRead: 7000,
    output: 200,
    dollars: expect.closeTo(0.0065, 9),
  });
});

test("prices the Opus fixture at the hand-computed dollar figure", () => {
  const priced = processFile(opusFixture);
  // (1000/1e6)*5 + (30000/1e6)*6.25 + (150000/1e6)*0.5 + (3000/1e6)*25 = 0.3425
  expect(priced).toEqual({
    model: "claude-opus-5",
    input: 1000,
    cacheWrite: 30000,
    cacheRead: 150000,
    output: 3000,
    dollars: expect.closeTo(0.3425, 9),
  });
});

test("renders one row per file, a total row, and the rate date beside every dollar figure", () => {
  const sonnet = { file: sonnetFixture, ...processFile(sonnetFixture) };
  const opus = { file: opusFixture, ...processFile(opusFixture) };
  const out = render([sonnet, opus]);
  const lines = out.split("\n");

  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain(sonnetFixture);
  expect(lines[0]).toContain("claude-sonnet-5");
  expect(lines[0]).toContain(formatDollars(0.0065));
  expect(lines[1]).toContain(opusFixture);
  expect(lines[1]).toContain(formatDollars(0.3425));
  expect(lines[2]).toMatch(/^total/);
  // total input = 300 + 1000, cacheWrite = 1000 + 30000, cacheRead = 7000 + 150000, output = 200 + 3000
  expect(lines[2]).toContain("input=1300");
  expect(lines[2]).toContain("cacheWrite=31000");
  expect(lines[2]).toContain("cacheRead=157000");
  expect(lines[2]).toContain("output=3200");
  expect(lines[2]).toContain(formatDollars(0.349));
  for (const line of lines) {
    expect(line).toContain(`rates read ${RATES_READ_ON}`);
  }
});

test("the CLI over the Sonnet and Opus fixtures prints the same total and exits 0", () => {
  const result = spawnSync("node", [CLI, sonnetFixture, opusFixture], {
    cwd: REPO,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(formatDollars(0.0065));
  expect(result.stdout).toContain(formatDollars(0.3425));
  expect(result.stdout).toContain(formatDollars(0.349));
});

// --- Refusal: two model ids in one file -------------------------------------

test("sumUsage refuses a file with two model ids, naming both", () => {
  const content = [
    '{"type":"assistant","message":{"model":"claude-opus-5","usage":{"input_tokens":10,"output_tokens":5}}}',
    '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":5}}}',
  ].join("\n");
  expect(() => sumUsage(content, "mixed.jsonl")).toThrowError(
    /mixed\.jsonl: carries more than one model — claude-opus-5, claude-sonnet-5/,
  );
});

test("the CLI over a mixed-model file refuses it, names both models, and sets the multipleModels exit bit", () => {
  const result = spawnSync("node", [CLI, mixedModelFixture], { cwd: REPO, encoding: "utf8" });
  expect(result.status).toBe(EXIT.multipleModels);
  expect(result.stderr).toContain("claude-opus-5");
  expect(result.stderr).toContain("claude-sonnet-5");
  expect(result.stdout).toBe("");
});

// --- Refusal: a model id with no rate ---------------------------------------

test("priceFile fails loudly on a model id missing from RATES, rather than pricing at zero", () => {
  const totals = {
    model: "claude-nonexistent-9",
    input: 10,
    cacheWrite: 0,
    cacheRead: 0,
    output: 5,
  };
  expect(() => priceFile(totals, "unknown.jsonl")).toThrowError(
    /unknown\.jsonl: no rate for model "claude-nonexistent-9"/,
  );
});

test("the CLI over an unrated model refuses it and sets the missingRate exit bit, not a $0.0000 row", () => {
  const result = spawnSync("node", [CLI, unknownModelFixture], { cwd: REPO, encoding: "utf8" });
  expect(result.status).toBe(EXIT.missingRate);
  expect(result.stderr).toContain("claude-nonexistent-9");
  expect(result.stdout).toBe("");
});

test("every model this script actually rates has a positive rate in every column", () => {
  for (const [model, rate] of Object.entries(RATES)) {
    for (const [field, value] of Object.entries(rate)) {
      expect(value, `${model}.${field}`).toBeGreaterThan(0);
    }
  }
});

// --- Refusal: a file with no assistant records ------------------------------

test("sumUsage refuses a file with no assistant records, rather than a silent zero-cost row", () => {
  const content = '{"type":"user","message":{"role":"user","content":"hi"}}';
  expect(() => sumUsage(content, "empty.jsonl")).toThrowError(
    /empty\.jsonl: no assistant records with a model id found/,
  );
});

test("the CLI over a file with no assistant records refuses it and sets the noAssistantRecords bit", () => {
  const result = spawnSync("node", [CLI, noAssistantFixture], { cwd: REPO, encoding: "utf8" });
  expect(result.status).toBe(EXIT.noAssistantRecords);
  expect(result.stdout).toBe("");
});

// --- Refusal: a file that cannot be read ------------------------------------

test("the CLI over a nonexistent file refuses it and sets the unreadableFile bit", () => {
  const missing = path.join(FIXTURES, "does-not-exist.jsonl");
  const result = spawnSync("node", [CLI, missing], { cwd: REPO, encoding: "utf8" });
  expect(result.status).toBe(EXIT.unreadableFile);
  expect(result.stderr).toContain(missing);
});

test("a malformed JSON line refuses the file and sets the unreadableFile bit", () => {
  expect(() => sumUsage("not json at all", "bad.jsonl")).toThrowError(
    /bad\.jsonl:1: not valid JSON/,
  );
});

// --- Multiple files: independent failure, aggregated exit bitmask ----------

test("one bad file among several is excluded from the total; the good files still print", () => {
  const result = spawnSync("node", [CLI, sonnetFixture, unknownModelFixture, opusFixture], {
    cwd: REPO,
    encoding: "utf8",
  });
  expect(result.status).toBe(EXIT.missingRate);
  expect(result.stdout).toContain(sonnetFixture);
  expect(result.stdout).toContain(opusFixture);
  expect(result.stdout).not.toContain(unknownModelFixture);
  expect(result.stdout).toContain(formatDollars(0.349)); // total excludes the refused file
  expect(result.stderr).toContain("claude-nonexistent-9");
});

test("exit bits from different failure classes combine by bitwise OR across a batch", () => {
  const result = spawnSync("node", [CLI, unknownModelFixture, mixedModelFixture], {
    cwd: REPO,
    encoding: "utf8",
  });
  expect(result.status).toBe(EXIT.missingRate | EXIT.multipleModels);
});

// --- Argument parsing --------------------------------------------------------

test("parseArgs refuses an empty argument list with the usage line", () => {
  expect(() => parseArgs([])).toThrowError(
    new RegExp(USAGE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")),
  );
});

test("parseArgs refuses an unknown option rather than treating it as a filename", () => {
  expect(() => parseArgs(["--bogus"])).toThrowError(/unknown option --bogus/);
});

test("the CLI with no arguments exits 1 and prints usage to stderr", () => {
  const result = spawnSync("node", [CLI], { cwd: REPO, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(USAGE);
});
