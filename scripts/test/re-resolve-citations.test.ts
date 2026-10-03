/**
 * `re-resolve-citations.mjs` against a real git repository (repo-84).
 *
 * One fixture, built once: a base commit, then a tip commit that shifts, rewords
 * and deletes lines of the file a record cites. Every verdict the script has is
 * one citation in it, so a case that stops being reachable turns a row red
 * rather than disappearing. The tests read `rows` for the verdict and the CLI
 * only for what the process boundary owns: the exit code and stderr.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parseArgs, render, reResolve } from "../re-resolve-citations.mjs";

const CLI = path.resolve(import.meta.dirname, "..", "re-resolve-citations.mjs");
const TEXT = { encoding: "utf8", shell: false } as const;

const BASE_APP = [
  "// header",
  "export const alpha = 1;",
  "export const beta = 2;",
  "export const gamma = 3;",
  "export function dup() {}",
  "export const delta = 4;",
  "export const epsilon = 5;",
  "export const zeta = 6;",
];
// Two lines inserted after the header, `delta` deleted, `dup` repeated.
const TIP_APP = [
  "// header",
  "// new a",
  "// new b",
  "export const alpha = 1;",
  "export const beta = 2;",
  "export const gamma = 3;",
  "export function dup() {}",
  "export function dup() {}",
  "export const epsilon = 5;",
  "export const zeta = 6;",
];
const BASE_SHORT = Array.from({ length: 10 }, (_, i) => `// short ${i + 1}`);
// Shortened below the line the record cites, which `checkCitations` alone calls
// unresolvable before it looks at the anchor.
const TIP_SHORT = ["// short 1", "// short 2", "// short 9"];
// The anchor starts on two lines at the base and on one at the tip (gate 1, F2).
const BASE_DUP = ["// d", "const DUPX = 1;", "// m", "// n", "const DUPX = 2;"];
const TIP_DUP = ["// a", "// b", "// c", "// d", "// m", "// n", "const DUPX = 1;"];
const PAGE_BASE = ["# Page", "## Heading"];
const PAGE_TIP = ["# Page", "intro", "## Heading"];

let dir = "";
let base = "";
let tip = "";

const git = (...args: string[]) => {
  const result = spawnSync("git", ["-C", dir, ...args], TEXT);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
};
const write = (name: string, lines: string[]) =>
  fs.writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
const run = (markdown: string, options: { section?: string; base?: string } = {}) =>
  reResolve({ markdown, repo: dir, section: options.section ?? null, base: options.base ?? null });
const only = (markdown: string, options = {}) => {
  const { rows } = run(markdown, options);
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`expected one re-resolved citation, got ${rows.length}`);
  }
  return row;
};

beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "re-resolve-")));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "re-resolve@example.test");
  git("config", "user.name", "re-resolve test");
  git("config", "commit.gpgsign", "false");
  write("app.ts", BASE_APP);
  write("short.ts", BASE_SHORT);
  write("dupx.ts", BASE_DUP);
  fs.mkdirSync(path.join(dir, ".claude"));
  write(".claude/page.md", PAGE_BASE);
  git("add", "-A");
  git("commit", "-qm", "base");
  base = git("rev-parse", "--short=7", "HEAD");
  write("app.ts", TIP_APP);
  write("short.ts", TIP_SHORT);
  write("dupx.ts", TIP_DUP);
  write(".claude/page.md", PAGE_TIP);
  git("add", "-A");
  git("commit", "-qm", "tip");
  tip = git("rev-parse", "--short=7", "HEAD");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a citation whose anchor is still in its range holds", () => {
  const row = only('At `app.ts:9 "export const epsilon"`.\n');
  expect(row.action).toBe("holds");
  expect(row.suggestion).toBeNull();
});

test("a shifted anchor on one line is repointed there, at the width the record cited", () => {
  const single = only('At `app.ts:2 "export const alpha"`.\n');
  expect(single).toMatchObject({ action: "repoint", suggestion: "app.ts:4" });

  const range = only('At `app.ts:3-4 "export const beta"`.\n');
  expect(range).toMatchObject({ action: "repoint", suggestion: "app.ts:5-6" });
  expect(range.detail).toContain("keeps the old width");
});

test("an anchor on several lines is ambiguous and lists them, never choosing", () => {
  const row = only('At `app.ts:5 "export function dup"`.\n');
  expect(row).toMatchObject({ action: "ambiguous", suggestion: null, hits: [7, 8] });
});

test("an anchor that is nowhere in the file is gone", () => {
  const row = only('At `app.ts:6 "export const delta"`.\n');
  expect(row).toMatchObject({ action: "gone", suggestion: null, hits: [] });
});

test("a file that does not exist is unresolvable, not gone", () => {
  const row = only('At `nowhere.ts:1 "anything"`.\n');
  expect(row.action).toBe("unresolvable");
});

test("a range the branch shortened the file below is still found, not unresolvable", () => {
  // Line 9 is past the end of the 3-line tip. The anchor is on line 3.
  const row = only('At `short.ts:9 "short 9"`.\n');
  expect(row).toMatchObject({ action: "repoint", suggestion: "short.ts:3" });
});

test("without --base nothing is ever a pin", () => {
  const { rows } = run('At `app.ts:4 "export const alpha"`, which predates the branch.\n');
  expect(rows.map((r) => r.action)).toEqual(["holds"]);
});

test("with --base, content already at the base is a pin to its base line, whether it moved or not", () => {
  const holdsAtTip = only('At `app.ts:4 "export const alpha"`.\n', { base });
  expect(holdsAtTip).toMatchObject({ action: "pin", suggestion: `app.ts@${base}:2` });
  expect(holdsAtTip.detail).toContain("At the tip: holds");

  const movedAtTip = only('At `app.ts:2 "export const alpha"`.\n', { base });
  expect(movedAtTip).toMatchObject({ action: "pin", suggestion: `app.ts@${base}:2` });
  expect(movedAtTip.detail).toContain("At the tip: the anchor is at 4");

  // Gone at the tip but present at the base: the record described the base.
  const deleted = only('At `app.ts:6 "export const delta"`.\n', { base });
  expect(deleted).toMatchObject({ action: "pin", suggestion: `app.ts@${base}:6` });
  expect(deleted.detail).toContain("At the tip: the anchor is nowhere in the file");
});

test("with --base, content the branch introduced is left alone", () => {
  const row = only('At `app.ts:2 "// new a"`.\n', { base });
  expect(row.action).toBe("holds");
});

test("the pin carries the short sha of the base, resolved from any commit-ish", () => {
  const row = only('At `app.ts:4 "export const alpha"`.\n', { base: "HEAD~1" });
  expect(row.suggestion).toBe(`app.ts@${base}:2`);
  expect(base).not.toBe(tip);
});

test("pinned, anchorless, prose, declared and malformed references are counted, never re-resolved", () => {
  const markdown = [
    "## Review",
    "",
    `Pinned: \`app.ts@${base}:2 "export const alpha"\`.`,
    "Anchorless: `app.ts:3`.",
    "Prose: see line 5.",
    'Declared: `app.ts:1 "nothing like this"`.',
    'Malformed: `app.ts@xyz:2 "export const alpha"`.',
    'Real: `app.ts:9 "export const epsilon"`.',
    "",
    "<!-- citations: evidence app.ts:1 -->",
    "",
  ].join("\n");
  const { rows, skipped } = run(markdown);
  expect(rows.map((r) => r.action)).toEqual(["holds"]);
  expect(skipped).toEqual({ pinned: 1, malformed: 1, unanchored: 1, unchecked: 1, declared: 1 });
});

test("a pinned citation that no longer holds is not this script's to report", () => {
  // The pin is true of the base and is read there on every run.
  const { rows } = run(`At \`app.ts@${base}:6 "export const delta"\`.\n`);
  expect(rows).toEqual([]);
});

test("--section narrows to one heading's span, and an unknown one is an error", () => {
  const markdown = [
    "## Review",
    "",
    'In: `app.ts:2 "export const alpha"`.',
    "",
    "## Log",
    "",
    'Out: `app.ts:6 "export const delta"`.',
    "",
  ].join("\n");
  expect(run(markdown, { section: "Review" }).rows.map((r) => r.action)).toEqual(["repoint"]);
  expect(run(markdown).rows.map((r) => r.action)).toEqual(["repoint", "gone"]);
  expect(() => run(markdown, { section: "Nonexistent" })).toThrow();
});

test("an unknown base is a usage-class error naming the ref", () => {
  expect(() => run('At `app.ts:4 "export const alpha"`.\n', { base: "no-such-ref" })).toThrow(
    /--base no-such-ref: no such commit/,
  );
});

test("render prints a row and the suggestion for each non-holding citation, and one count per verdict", () => {
  const markdown = [
    'a `app.ts:9 "export const epsilon"`',
    'b `app.ts:2 "export const alpha"`',
    'c `app.ts:6 "export const delta"`',
    "",
  ].join("\n");
  const { text, exit } = render(run(markdown), "rec.md");
  expect(exit).toBe(1);
  expect(text).toContain("-> app.ts:4");
  expect(text).toContain(
    "1 holds, 1 repoint, 0 pin, 0 ambiguous, 1 gone, 0 unresolvable — of 3 re-resolved",
  );
  expect(text).toContain("exit 1 — 2 citation(s) want a change");
});

test("a record whose every citation holds renders exit 0", () => {
  const { text, exit } = render(run('a `app.ts:9 "export const epsilon"`\n'), "rec.md");
  expect(exit).toBe(0);
  expect(text).toContain("exit 0 — every re-resolved citation holds");
});

test("parseArgs refuses a missing record, a second record, an unknown flag and a flag with no value", () => {
  expect(() => parseArgs([])).toThrow(/no record given/);
  expect(() => parseArgs(["a.md", "b.md"])).toThrow(/one record at a time/);
  expect(() => parseArgs(["a.md", "--wat"])).toThrow(/unknown flag --wat/);
  expect(() => parseArgs(["a.md", "--base"])).toThrow(/--base needs a value/);
  expect(() => parseArgs(["a.md", "--section", "--base", "x"])).toThrow(/--section needs a value/);
  expect(parseArgs(["a.md", "--section", "Review", "--base", "main"])).toEqual({
    file: "a.md",
    section: "Review",
    base: "main",
  });
});

test("the CLI exits 1 on a citation that wants a change, 0 on one that does not, 2 on a bad ref", () => {
  const stale = path.join(dir, "stale.md");
  const fine = path.join(dir, "fine.md");
  fs.writeFileSync(stale, '## Review\n\nAt `app.ts:2 "export const alpha"`.\n');
  fs.writeFileSync(fine, '## Review\n\nAt `app.ts:9 "export const epsilon"`.\n');
  const exec = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { ...TEXT, cwd: dir });

  const wants = exec(stale);
  expect(wants.status).toBe(1);
  expect(wants.stdout).toContain("-> app.ts:4");
  expect(wants.stdout).toContain("(record line 3)");

  const clean = exec(fine);
  expect(clean.status).toBe(0);
  expect(clean.stderr).toBe("");

  const pinned = exec(stale, "--base", base);
  expect(pinned.status).toBe(1);
  expect(pinned.stdout).toContain(`-> app.ts@${base}:2`);

  const badRef = exec(stale, "--base", "no-such-ref");
  expect(badRef.status).toBe(2);
  expect(badRef.stderr).toContain("--base no-such-ref: no such commit");
  expect(badRef.stdout).toBe("");

  const noArgs = exec();
  expect(noArgs.status).toBe(2);
  expect(noArgs.stderr).toContain("usage: node scripts/re-resolve-citations.mjs");
});

test("with --base, an anchor on several base lines is ambiguous, never a pin to the first (gate 1, F2)", () => {
  // One line at the tip, so only the base side is ambiguous.
  const row = only('At `dupx.ts:7 "const DUPX"`.\n', { base });
  expect(row).toMatchObject({ action: "ambiguous", suggestion: null });
  expect(row.detail).toContain("starts on 2 lines there (2, 5)");
  expect(row.detail).toContain("At the tip: holds");
  // Without --base the same citation holds, so the verdict is the base's own.
  expect(only('At `dupx.ts:7 "const DUPX"`.\n').action).toBe("holds");
});

test("a repoint into a .claude page says a bare line is refused there", () => {
  const row = only('At `.claude/page.md:2 "## Heading"`.\n');
  expect(row).toMatchObject({ action: "repoint", suggestion: ".claude/page.md:3" });
  expect(row.detail).toContain("never a bare line");
  expect(only('At `app.ts:2 "export const alpha"`.\n').detail).not.toContain(".claude/");
});

test("an exit-0 run says it did not check anchor distinctness or .claude pins", () => {
  const { text } = render(run('a `app.ts:9 "export const epsilon"`\n'), "rec.md");
  expect(text).toContain("not checked here: distinct anchors, .claude pins");
});
