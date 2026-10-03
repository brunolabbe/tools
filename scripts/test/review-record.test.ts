/**
 * `review-record.mjs`'s guards — the pure logic in isolation, then the CLI spawned
 * against a real git fixture for the process-boundary claims (a check that fails, a
 * formatter that repads a table, a restore proven against `HEAD`).
 *
 * Two layers, the same split `next-id.test.ts` and `citations.test.ts` use and
 * for the same reason: the pure functions can be asserted quickly and
 * precisely, and the CLI tests are the only thing that can prove the process
 * boundary — that a failed check really does leave the file on disk
 * byte-identical to `HEAD`, that `npx oxfmt` really does re-pad a table, that
 * the inserted block is found in the *formatted* ticket rather than replayed
 * from line numbers computed before formatting touched the file.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import {
  insertSection,
  locateInsertedBlock,
  normalizeForDiff,
  parseArgs,
  planInsertion,
  USAGE,
  validateFirstLine,
} from "../review-record.mjs";
import { FAKE_GH_MARKER, fakeGhPath } from "./fake-gh.ts";

const REPO = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO, "scripts", "review-record.mjs");

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs reads the ticket, the section file, and an absent --gate", () => {
  expect(parseArgs(["ticket.md", "section.md"])).toEqual({
    ticket: "ticket.md",
    sectionFile: "section.md",
    gate: null,
  });
});

test("parseArgs reads --gate as a number, wherever it falls in argv", () => {
  expect(parseArgs(["ticket.md", "--gate", "3", "section.md"])).toEqual({
    ticket: "ticket.md",
    sectionFile: "section.md",
    gate: 3,
  });
});

test("parseArgs refuses a --gate that is not a positive integer", () => {
  expect(() => parseArgs(["t.md", "s.md", "--gate", "0"])).toThrow(/positive integer/);
  expect(() => parseArgs(["t.md", "s.md", "--gate", "two"])).toThrow(/positive integer/);
  expect(() => parseArgs(["t.md", "s.md", "--gate"])).toThrow(/needs a value/);
});

test("parseArgs refuses an unknown flag and the wrong number of positionals", () => {
  expect(() => parseArgs(["t.md", "s.md", "--nope"])).toThrow(/unknown option --nope/);
  expect(() => parseArgs(["t.md"])).toThrow(USAGE);
  expect(() => parseArgs(["t.md", "s.md", "extra.md"])).toThrow(USAGE);
});

// ---------------------------------------------------------------------------
// validateFirstLine — ticket step 1
// ---------------------------------------------------------------------------

test('validateFirstLine requires exactly "## Review" when --gate is absent', () => {
  expect(() => validateFirstLine("## Review\n\nsomething", null)).not.toThrow();
  expect(() => validateFirstLine("## Review — a gate\n\nsomething", null)).toThrow(
    /exactly "## Review"/,
  );
  expect(() => validateFirstLine("### Gate 1\n\nsomething", null)).toThrow(/exactly "## Review"/);
});

test('validateFirstLine matches "### Gate <n>" on a digit boundary, not a prefix', () => {
  expect(() => validateFirstLine("### Gate 1 — 2026-09-20 · PASS\n", 1)).not.toThrow();
  // "Gate 1" must not accept a file that opens "Gate 10" — the exact defect a
  // naive `startsWith` check would reproduce one gate number over.
  expect(() => validateFirstLine("### Gate 10 — 2026-09-20\n", 1)).toThrow(
    /must start with "### Gate 1"/,
  );
  expect(() => validateFirstLine("## Review\n", 1)).toThrow(/must start with "### Gate 1"/);
});

// ---------------------------------------------------------------------------
// planInsertion — ticket step 2
// ---------------------------------------------------------------------------

const noReview = [
  "# t-1 — a ticket",
  "",
  "## Why",
  "",
  "Reasons.",
  "",
  "## Done when",
  "",
  "- It works.",
  "",
  "## Log",
  "",
  "- filed.",
  "",
].join("\n");

test('planInsertion anchors the first review on "## Log", by heading form', () => {
  const logLine = noReview.split("\n").findIndex((l) => l === "## Log") + 1;
  expect(planInsertion(noReview, null)).toEqual({ anchorLine: logLine });
});

test('planInsertion is not fooled by "## Log" quoted inline in prose above the real heading', () => {
  const quoted = noReview.replace(
    "Reasons.",
    "Reasons, referenced elsewhere as `## Log` in passing, long before the real heading.",
  );
  const logLine = quoted.split("\n").findIndex((l) => l === "## Log") + 1;
  expect(planInsertion(quoted, null)).toEqual({ anchorLine: logLine });
});

test('planInsertion refuses a first review when "## Review" already exists', () => {
  const withReview = noReview.replace("## Log", "## Review\n\n### Gate 1\n\nok.\n\n## Log");
  expect(() => planInsertion(withReview, null)).toThrow(/already has a "## Review"/);
});

test('planInsertion refuses --gate when there is no "## Review" yet', () => {
  expect(() => planInsertion(noReview, 2)).toThrow(/no "## Review" section yet/);
});

test('planInsertion appends a later gate at the end of the existing "## Review" block', () => {
  const withReview = noReview.replace("## Log", "## Review\n\n### Gate 1\n\nok.\n\n## Log");
  const lines = withReview.split("\n");
  const logLine = lines.findIndex((l) => l === "## Log") + 1;
  // The existing block ends on the blank line directly above "## Log".
  expect(planInsertion(withReview, 2)).toEqual({ anchorLine: logLine });
});

// ---------------------------------------------------------------------------
// insertSection / locateInsertedBlock — pure round trip
// ---------------------------------------------------------------------------

test("insertSection followed by locateInsertedBlock recovers exactly what was inserted", () => {
  const { anchorLine } = planInsertion(noReview, null);
  const section = "## Review\n\n### Gate 1 — 2026-09-20\n\nNothing cited.\n";
  const spliced = insertSection(noReview, section, anchorLine);
  const block = locateInsertedBlock(spliced, null);
  expect(block).toBeDefined();
  const blockText = spliced
    .split("\n")
    .slice(block!.start - 1, block!.end)
    .join("\n");
  expect(normalizeForDiff(blockText)).toBe(normalizeForDiff(section.replace(/\n+$/, "")));
});

// ---------------------------------------------------------------------------
// normalizeForDiff
// ---------------------------------------------------------------------------

test("normalizeForDiff treats differently padded tables as equal", () => {
  const loose = "| A | B |\n| --- | --- |\n| a | bbbbbbbb |\n";
  const tight = "|A|B|\n|-|-|\n|a|bbbbbbbb|\n";
  expect(normalizeForDiff(loose)).toBe(normalizeForDiff(tight));
});

test("normalizeForDiff leaves a non-table line untouched", () => {
  expect(normalizeForDiff("Just prose, with a | pipe | in it that is not a table.")).toBe(
    "Just prose, with a | pipe | in it that is not a table.",
  );
});

test("normalizeForDiff trims trailing blank lines only", () => {
  expect(normalizeForDiff("a\n\nb\n\n\n")).toBe("a\n\nb");
});

// ---------------------------------------------------------------------------
// The CLI, against a real git fixture
// ---------------------------------------------------------------------------

/** `git` in a named directory, throwing on failure so a broken fixture fails loudly. */
function gitIn(dir: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

const TICKET_PATH = "docs/work/zz-1-test-ticket.md";

/** A minimal but real ticket, with a real cited file beside it. */
function baseTicket(whyProse: string): string {
  return [
    "---",
    "id: zz-1",
    "tool: repo",
    "title: A test ticket",
    "kind: fix",
    "status: ready",
    "milestone: null",
    "depends_on: []",
    "---",
    "",
    "# zz-1 — A test ticket",
    "",
    "## Why",
    "",
    whyProse,
    "",
    "## Build",
    "",
    "Do the thing.",
    "",
    "## Done when",
    "",
    "- It works.",
    "",
    "## Log",
    "",
    "- 2026-09-20 — Filed.",
    "",
  ].join("\n");
}

/**
 * A throwaway repository with `src/tls.ts` (for anchored citations to point
 * at) and one ticket, committed — the same shape `citations-gate.test.ts`
 * builds, so a passing citation here means the same thing it means there.
 */
function withTicketRepo(whyProse = "Reasons."): {
  dir: string;
  ticketAbs: string;
  cleanup: () => void;
} {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "review-record-")));
  gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "config", "user.email", "review-record@example.test");
  gitIn(dir, "config", "user.name", "review-record test");

  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "src", "tls.ts"),
    [
      "export function verify() {",
      "  // Defence in depth: the store is pinned.",
      "  return true;",
      "}",
      "",
    ].join("\n"),
  );

  const ticketAbs = path.join(dir, TICKET_PATH);
  fs.mkdirSync(path.dirname(ticketAbs), { recursive: true });
  fs.writeFileSync(ticketAbs, baseTicket(whyProse));

  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-qm", "the ticket, before any review");

  return { dir, ticketAbs, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeSectionFile(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

function runCli(dir: string, args: string[]) {
  return spawnSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8", shell: false });
}

test('splices the first review above "## Log" even when prose quotes "## Review" inline first', () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo(
    "Reasons, mentioned once already as `## Review` in passing, long before the real section exists.",
  );
  try {
    const section = writeSectionFile(
      dir,
      "section.md",
      '## Review\n\n### Gate 1 — 2026-09-20\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );

    const result = runCli(dir, [ticketAbs, section]);
    expect(result.status).toBe(0);

    const after = fs.readFileSync(ticketAbs, "utf8");
    const headings = after.split("\n").filter((l) => /^#{2,3} /.test(l));
    // Exactly one real "## Review" heading, and it lands after "## Done when"
    // and before "## Log" — not duplicated, and not spliced at the quoted
    // occurrence 500 lines (or in this fixture, a few lines) above it.
    expect(headings).toEqual([
      "## Why",
      "## Build",
      "## Done when",
      "## Review",
      "### Gate 1 — 2026-09-20",
      "## Log",
    ]);
    // The inline mention is untouched and still just prose.
    expect(after).toMatch(/mentioned once already as `## Review` in passing/);

    // Nothing but the splice itself changed the disclosure — no table here, so
    // the normalised diff against the section file is empty.
    const diffStart = result.stdout.indexOf("Paste this into the Log as the disclosure note:");
    expect(diffStart).toBeGreaterThan(-1);
    expect(result.stdout.slice(diffStart).split("\n").slice(2).join("\n").trim()).toBe("");
  } finally {
    cleanup();
  }
});

test('a gate appended later lands inside the existing "## Review" block, after gate 1', () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const first = writeSectionFile(
      dir,
      "gate1.md",
      '## Review\n\n### Gate 1 — 2026-09-19\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    expect(runCli(dir, [ticketAbs, first]).status).toBe(0);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "gate 1 lands");

    const second = writeSectionFile(
      dir,
      "gate2.md",
      '### Gate 2 — 2026-09-20\n\nStill proof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    const result = runCli(dir, [ticketAbs, "--gate", "2", second]);
    expect(result.status).toBe(0);

    const after = fs.readFileSync(ticketAbs, "utf8");
    const headings = after.split("\n").filter((l) => /^#{2,3} /.test(l));
    expect(headings).toEqual([
      "## Why",
      "## Build",
      "## Done when",
      "## Review",
      "### Gate 1 — 2026-09-19",
      "### Gate 2 — 2026-09-20",
      "## Log",
    ]);
  } finally {
    cleanup();
  }
});

test("a table the formatter re-pads reports an empty normalised diff", () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    // Deliberately unpadded and uneven, with no citation-shaped cell content,
    // so the only thing this exercises is the table reflow.
    const section = writeSectionFile(
      dir,
      "section.md",
      [
        "## Review",
        "",
        "### Gate 1 — 2026-09-20",
        "",
        "| Column A | Column B |",
        "|---|---|",
        "| a | bbbbbbbbbbbb |",
        "| ccccccccccc | d |",
        "",
      ].join("\n"),
    );

    const result = runCli(dir, [ticketAbs, section]);
    expect(result.status).toBe(0);

    // Confirm the formatter actually touched the table, so a diff tool that
    // could not tell padding from a real change would fail this test too.
    const after = fs.readFileSync(ticketAbs, "utf8");
    expect(after).not.toMatch(/\|---\|---\|/);
    expect(after).toMatch(/\| -+ +\| -+ +\|/);

    const diffStart = result.stdout.indexOf("Paste this into the Log as the disclosure note:");
    expect(diffStart).toBeGreaterThan(-1);
    const diffBody = result.stdout.slice(diffStart).split("\n").slice(2).join("\n").trim();
    expect(diffBody).toBe("");
  } finally {
    cleanup();
  }
});

test('refuses a second first-review call once "## Review" already exists on disk', () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const first = writeSectionFile(
      dir,
      "gate1.md",
      '## Review\n\n### Gate 1 — 2026-09-19\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    expect(runCli(dir, [ticketAbs, first]).status).toBe(0);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "gate 1 lands");

    const again = writeSectionFile(dir, "again.md", "## Review\n\nshould not land.\n");
    const result = runCli(dir, [ticketAbs, again]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already has a "## Review"/);
    // Refused before ever touching the file.
    expect(fs.readFileSync(ticketAbs, "utf8")).not.toMatch(/should not land/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Round 2 — a ticket-reviewer gate on repo-55 (2026-09-20): the HEAD restore
// must not discard uncommitted work, the disclosure diff must not stop at a
// gate's own trailing heading, and a repeated --gate must be refused.
// ---------------------------------------------------------------------------

test("refuses to run when the ticket has uncommitted changes against HEAD, and touches nothing", () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const before = fs.readFileSync(ticketAbs, "utf8");
    fs.appendFileSync(ticketAbs, "\n- an uncommitted note, never committed.\n");
    const dirty = fs.readFileSync(ticketAbs, "utf8");
    expect(dirty).not.toBe(before);

    const section = writeSectionFile(
      dir,
      "section.md",
      '## Review\n\n### Gate 1 — 2026-09-20\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    const result = runCli(dir, [ticketAbs, section]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/uncommitted changes against HEAD/);
    // Not restored to HEAD, not spliced — exactly as it stood before the run,
    // uncommitted note included. A restore that overwrote this with HEAD's
    // content would pass just as silently as the splice it was meant to undo.
    expect(fs.readFileSync(ticketAbs, "utf8")).toBe(dirty);
  } finally {
    cleanup();
  }
});

test('the disclosure diff is bounded to the end of "## Review", not a gate\'s own trailing heading', () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const first = writeSectionFile(
      dir,
      "gate1.md",
      '## Review\n\n### Gate 1 — 2026-09-19\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    expect(runCli(dir, [ticketAbs, first]).status).toBe(0);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "gate 1 lands");

    // Gate 2's own body carries a second "###" heading — the reproduction: a
    // block bounded to the *last nested heading* rather than to the end of
    // "## Review" would diff only "three." against the whole section file and
    // report a false non-empty diff on a splice that landed correctly.
    const second = writeSectionFile(
      dir,
      "gate2.md",
      [
        "### Gate 2 — 2026-09-20",
        "",
        "The splice itself.",
        "",
        "### What the builder should read first",
        "",
        'Still proof: `src/tls.ts:2 "Defence in depth"`.',
        "",
      ].join("\n"),
    );
    const result = runCli(dir, [ticketAbs, "--gate", "2", second]);
    expect(result.status).toBe(0);

    const after = fs.readFileSync(ticketAbs, "utf8");
    const headings = after.split("\n").filter((l) => /^#{2,3} /.test(l));
    expect(headings).toEqual([
      "## Why",
      "## Build",
      "## Done when",
      "## Review",
      "### Gate 1 — 2026-09-19",
      "### Gate 2 — 2026-09-20",
      "### What the builder should read first",
      "## Log",
    ]);

    const diffStart = result.stdout.indexOf("Paste this into the Log as the disclosure note:");
    expect(diffStart).toBeGreaterThan(-1);
    const diffBody = result.stdout.slice(diffStart).split("\n").slice(2).join("\n").trim();
    expect(diffBody).toBe("");
  } finally {
    cleanup();
  }
});

test('refuses to re-append a gate number that already exists under "## Review"', () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const first = writeSectionFile(
      dir,
      "gate1.md",
      '## Review\n\n### Gate 1 — 2026-09-19\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    expect(runCli(dir, [ticketAbs, first]).status).toBe(0);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "gate 1 lands");

    const again = writeSectionFile(
      dir,
      "gate1-again.md",
      "### Gate 1 — should not land twice\n\nshould not land.\n",
    );
    const result = runCli(dir, [ticketAbs, "--gate", "1", again]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already has a "### Gate 1" heading/);

    const after = fs.readFileSync(ticketAbs, "utf8");
    expect(after.match(/^### Gate 1 /gmu)).toHaveLength(1);
    expect(after).not.toMatch(/should not land/);
  } finally {
    cleanup();
  }
});

test('planInsertion refuses a gate number that already exists under "## Review" (pure)', () => {
  const withReview = noReview.replace("## Log", "## Review\n\n### Gate 1\n\nok.\n\n## Log");
  expect(() => planInsertion(withReview, 1)).toThrow(/already has a "### Gate 1" heading/);
});

test('locateInsertedBlock bounds a gate\'s block to the end of "## Review", past its own trailing heading', () => {
  const formatted = [
    "## Why",
    "",
    "## Done when",
    "",
    "## Review",
    "",
    "### Gate 1",
    "",
    "one.",
    "",
    "### Gate 2",
    "",
    "two.",
    "",
    "### A heading inside gate 2's own body",
    "",
    "three.",
    "",
    "## Log",
    "",
  ].join("\n");
  const block = locateInsertedBlock(formatted, 2);
  const blockText = formatted
    .split("\n")
    .slice(block.start - 1, block.end)
    .join("\n");
  expect(blockText).toContain("### Gate 2");
  expect(blockText).toContain("### A heading inside gate 2's own body");
  expect(blockText).not.toContain("## Log");
});

// ---------------------------------------------------------------------------
// Round 3 — a ticket-reviewer gate on repo-55, gate 2 (2026-09-20): the
// refusal message must not advise a bare stash in a checkout with a shared
// stash stack, and an untracked ticket must not slip the dirty guard.
// ---------------------------------------------------------------------------

test("the dirty-ticket refusal advises committing, never stashing", () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    fs.appendFileSync(ticketAbs, "\n- another uncommitted note.\n");
    const section = writeSectionFile(
      dir,
      "section.md",
      '## Review\n\n### Gate 1 — 2026-09-20\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    const result = runCli(dir, [ticketAbs, section]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/commit them first/);
    // The stash stack in this checkout is shared across worktrees and
    // concurrent sessions, so a bare `git stash` is unsafe here — the advice
    // must never point at it.
    expect(result.stderr).not.toMatch(/stash/iu);
  } finally {
    cleanup();
  }
});

test("refuses to run when the ticket is not tracked by git yet, and touches nothing", () => {
  const { dir, cleanup } = withTicketRepo();
  try {
    const untrackedProse = "An untracked ticket, never added.";
    const untrackedAbs = path.join(dir, "docs", "work", "untracked-1.md");
    fs.writeFileSync(untrackedAbs, baseTicket(untrackedProse));
    // Deliberately never `git add`-ed — a diff against HEAD for this path
    // would report clean, which is the trap this guard exists to close.

    const section = writeSectionFile(
      dir,
      "section.md",
      '## Review\n\n### Gate 1 — 2026-09-20\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    const result = runCli(dir, [untrackedAbs, section]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/is not tracked by git yet/);
    // Untouched — refused before ever writing the splice.
    expect(fs.readFileSync(untrackedAbs, "utf8")).toBe(baseTicket(untrackedProse));
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// repo-62 — the committed record against the file it came from. Appended with
// its own import, not added to the one at the top, because merged gate records
// cite this file by line and a line added above them displaces every one.
// ---------------------------------------------------------------------------

import {
  compareRecord,
  differingLines,
  formatMarkdown,
  locateGateBlock,
  parseVerifyArgs,
  VERIFY_USAGE,
} from "../review-record.mjs";

test("parseVerifyArgs reads --gate and --rev around the positionals, HEAD by default", () => {
  expect(parseVerifyArgs(["--verify", "t.md", "s.md"])).toEqual({
    ticket: "t.md",
    sectionFile: "s.md",
    gate: null,
    rev: "HEAD",
  });
  expect(parseVerifyArgs(["t.md", "--verify", "--gate", "2", "--rev", "abc123", "s.md"])).toEqual({
    ticket: "t.md",
    sectionFile: "s.md",
    gate: 2,
    rev: "abc123",
  });
  expect(() => parseVerifyArgs(["--verify", "t.md", "s.md", "--gate", "0"])).toThrow(
    /positive integer/,
  );
  expect(() => parseVerifyArgs(["--verify", "t.md", "s.md", "--rev"])).toThrow(/needs a value/);
  expect(() => parseVerifyArgs(["--verify", "t.md"])).toThrow(VERIFY_USAGE);
});

const reviewedTicket = [
  "## Why",
  "",
  "## Review",
  "",
  "### Gate 1",
  "",
  "one.",
  "",
  "### Gate 2",
  "",
  "two.",
  "",
  "### A heading inside gate 2's own body",
  "",
  "more of two.",
  "",
  "### Gate 3",
  "",
  "three.",
  "",
  "## Log",
  "",
].join("\n");

const linesOf = (markdown: string, block: { start: number; end: number }) =>
  markdown
    .split("\n")
    .slice(block.start - 1, block.end)
    .join("\n");

test("locateGateBlock ends an earlier gate at the next gate heading, not at the end of Review", () => {
  const first = linesOf(
    reviewedTicket,
    locateGateBlock(reviewedTicket, null, "## Review\n\n### Gate 1\n\none.\n"),
  );
  expect(first).toContain("### Gate 1");
  expect(first).not.toContain("### Gate 2");

  const second = linesOf(
    reviewedTicket,
    locateGateBlock(reviewedTicket, 2, "### Gate 2\n\n### A heading inside gate 2's own body\n"),
  );
  expect(second).toContain("### A heading inside gate 2's own body");
  expect(second).not.toContain("### Gate 3");

  const third = linesOf(reviewedTicket, locateGateBlock(reviewedTicket, 3, "### Gate 3\n"));
  expect(third).toContain("three.");
  expect(third).not.toContain("## Log");

  expect(() => locateGateBlock(reviewedTicket, 4, "### Gate 4\n")).toThrow(/no "### Gate 4"/);
});

test("compareRecord accepts what the formatter rewrites and rejects a reworded bullet", () => {
  const section = [
    "### Gate 2",
    "",
    "| Finding | Verdict |",
    "|---|---|",
    "| med · x | fixed |",
    "",
    "* **low** · the assertion proves nothing, *as measured*.",
    "",
  ].join("\n");
  const formatted = formatMarkdown(section);
  // The formatter really did rewrite more than padding — otherwise this test
  // could not tell a formatter-aware comparison from a byte comparison.
  expect(formatted).toMatch(/^- \*\*low\*\* · the assertion proves nothing, _as measured_\./m);

  expect(compareRecord(section, formatted, formatted)).toEqual({ matches: true, diff: "" });
  expect(compareRecord(section, section, formatted)).toEqual({ matches: true, diff: "" });

  const reworded = formatted.replace("proves nothing", "was removed; fixed");
  const result = compareRecord(section, reworded, formatted);
  expect(result.matches).toBe(false);
  expect(result.diff).toMatch(/^\+- \*\*low\*\* · the assertion was removed; fixed/m);
  expect(result.diff).toMatch(/^-- \*\*low\*\* · the assertion proves nothing/m);
});

test("differingLines maps the diff's new side onto the ticket's own line numbers", () => {
  const section = "### Gate 2\n\nkeep.\n\nthe reviewer's words.\n";
  const landed = "### Gate 2\n\nkeep.\n\nthe lander's words.";
  const { diff } = compareRecord(section, landed, section);
  // Block starting on ticket line 40: its fifth line is ticket line 44.
  expect(differingLines(diff, 40)).toEqual({
    ticket: [{ line: 44, text: "the lander's words." }],
    section: [{ line: 5, text: "the reviewer's words." }],
  });
});

test("--verify passes a committed record, then fails naming the line once a lander rewords it", () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const first = writeSectionFile(
      dir,
      "gate1.md",
      '## Review\n\n### Gate 1 — 2026-09-19\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    expect(runCli(dir, [ticketAbs, first]).status).toBe(0);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "gate 1 lands");

    // Unpadded table and `*` markers: the formatter rewrites all of them, and
    // none of that is a change to the reviewer's words.
    const second = writeSectionFile(
      dir,
      "gate2.md",
      [
        "### Gate 2 — 2026-09-20",
        "",
        "| Gate 1 finding | Verdict |",
        "|---|---|",
        "| low · the comment | fixed |",
        "",
        "* **low** · the lazy-mount assertion proves nothing, *measured on the base*.",
        '* Still proof: `src/tls.ts:2 "Defence in depth"`.',
        "",
      ].join("\n"),
    );
    const spliced = runCli(dir, [ticketAbs, "--gate", "2", second]);
    expect(spliced.status).toBe(0);
    expect(spliced.stdout).toMatch(/--verify .* --gate 2/);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "gate 2 lands verbatim");

    const clean = runCli(dir, ["--verify", ticketAbs, second, "--gate", "2"]);
    expect(clean.stderr).toBe("");
    expect(clean.status).toBe(0);
    expect(clean.stdout).toMatch(/at HEAD \(lines \d+-\d+\) is /);
    // Gate 1 is still its own file once gate 2 sits below it.
    expect(runCli(dir, ["--verify", ticketAbs, first]).status).toBe(0);

    // The dl-69 shape: the lander rewords a finding into its own disposition
    // after the splice, and commits.
    const committed = fs.readFileSync(ticketAbs, "utf8");
    const rewordedLine =
      committed.split("\n").findIndex((l) => l.includes("the lazy-mount assertion")) + 1;
    fs.writeFileSync(
      ticketAbs,
      committed.replace("proves nothing, _measured on the base_", "was removed; fixed"),
    );
    gitIn(dir, "commit", "-qam", "gate 2 reworded by its lander");

    const caught = runCli(dir, ["--verify", ticketAbs, second, "--gate", "2"]);
    expect(caught.status).toBe(1);
    expect(caught.stderr).toMatch(/at HEAD is .*gate2\.md — it differs beyond table padding/);
    expect(caught.stderr).toContain(
      `  ${rewordedLine}: "- **low** · the lazy-mount assertion was removed; fixed."`,
    );
    expect(caught.stderr).toMatch(/proves nothing, _measured on the base_/);

    // The commit before the rewording still verifies, so the failure is the
    // rewording and not the comparison.
    const earlier = runCli(dir, ["--verify", ticketAbs, second, "--gate", "2", "--rev", "HEAD~1"]);
    expect(earlier.status).toBe(0);

    // Verified from a checkout that lacks the ticket — main, when the ticket
    // was filed on the branch being landed: the rev is read, not the disk.
    fs.rmSync(ticketAbs);
    const offDisk = runCli(dir, ["--verify", ticketAbs, second, "--gate", "2", "--rev", "HEAD~1"]);
    expect(offDisk.stderr).toBe("");
    expect(offDisk.status).toBe(0);
  } finally {
    cleanup();
  }
});

test("a splice whose block does not come back as the section file is restored to HEAD, exit 1", () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const before = fs.readFileSync(ticketAbs, "utf8");
    // An unclosed fence swallows "## Log" once spliced above it, so the
    // "## Review" block runs to the end of the ticket and carries the Log in
    // with it: the landed block is no longer the file the gate wrote.
    const section = writeSectionFile(
      dir,
      "section.md",
      "## Review\n\n### Gate 1 — 2026-09-20\n\n```\nan unclosed fence\n",
    );
    const result = runCli(dir, [ticketAbs, section]);
    expect(result.stderr).toMatch(/after splicing is not .*section\.md/);
    expect(result.stderr).toContain("2026-09-20 — Filed.");
    expect(result.status).toBe(1);
    expect(fs.readFileSync(ticketAbs, "utf8")).toBe(before);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Round 2 — a ticket-reviewer gate on repo-62, gate 1 (2026-09-27): a heading
// inside a gate's body whose title starts "Gate <n>" must not move either end
// of any gate's block.
// ---------------------------------------------------------------------------

test("a gate body quoting a '### Gate <n> …' heading moves neither end of any gate's block", () => {
  const gate1 = [
    "## Review",
    "",
    "### Gate 1",
    "",
    "one.",
    "",
    "### Gate 2 style findings quoted from elsewhere",
    "",
    "quoted.",
    "",
  ].join("\n");
  const gate2 = "### Gate 2\n\ntwo.\n";
  const gate3 = "### Gate 3\n\nthree.\n";
  const ticket = ["## Why", "", gate1, gate2, gate3, "## Log", ""].join("\n");

  const first = locateGateBlock(ticket, null, gate1);
  expect(linesOf(ticket, first)).toContain("quoted.");
  expect(linesOf(ticket, first)).not.toContain("two.");
  expect(compareRecord(gate1, linesOf(ticket, first), formatMarkdown(gate1)).matches).toBe(true);

  // The quoted heading is the first one that starts "Gate 2"; it is not gate 2.
  const second = locateGateBlock(ticket, 2, gate2);
  expect(linesOf(ticket, second)).toBe("### Gate 2\n\ntwo.\n");
  expect(compareRecord(gate2, linesOf(ticket, second), formatMarkdown(gate2)).matches).toBe(true);

  // A lander who drops the quoted heading from gate 1 still fails: the block
  // then runs one heading further, into gate 2.
  const dropped = ticket.replace("### Gate 2 style findings quoted from elsewhere\n\n", "");
  const moved = locateGateBlock(dropped, null, gate1);
  expect(compareRecord(gate1, linesOf(dropped, moved), formatMarkdown(gate1)).matches).toBe(false);
});

test("differingLines skips git's no-newline marker without miscounting the lines after it", () => {
  const diff = [
    "--- section-file",
    "+++ inserted-block",
    "@@ -1,2 +1,2 @@",
    " same",
    "-old ending",
    "\\ No newline at end of file",
    "+new ending",
    "\\ No newline at end of file",
  ].join("\n");
  expect(differingLines(diff, 10)).toEqual({
    ticket: [{ line: 11, text: "new ending" }],
    section: [{ line: 2, text: "old ending" }],
  });
});

// ---------------------------------------------------------------------------
// repo-82 — a CRLF section file must resolve to the same gate block an LF
// copy of the same text does.
// ---------------------------------------------------------------------------

test("locateGateBlock matches the right 'Gate 1' heading when the section text is CRLF", () => {
  const ticket = [
    "## Review",
    "",
    "### Gate 1",
    "",
    "first.",
    "",
    "### Gate 1 restated",
    "",
    "second.",
    "",
    "## Log",
    "",
  ].join("\n");
  const sectionLF = "### Gate 1 restated\n\nsecond.\n";
  const sectionCRLF = sectionLF.replace(/\n/g, "\r\n");

  const lf = locateGateBlock(ticket, 1, sectionLF);
  const crlf = locateGateBlock(ticket, 1, sectionCRLF);
  expect(crlf).toEqual(lf);
  expect(linesOf(ticket, crlf)).toBe(sectionLF);
});

// ---------------------------------------------------------------------------
// repo-80 — `--land`: one command for the whole landing sequence. Appended
// with its own import, for the reason every earlier round here was: a merged
// gate record cites this file by line, and a block inserted mid-file would
// displace every one of them.
// ---------------------------------------------------------------------------

import {
  detectGate,
  land,
  LAND_USAGE,
  parseLandArgs,
  runPreflightDefault,
  setStatus,
  spliceSection,
  verifySection,
} from "../review-record.mjs";

// --- detectGate --------------------------------------------------------------

test('detectGate reads gate 1 from "## Review" and a later gate from its own heading', () => {
  expect(detectGate("## Review\n\nsomething\n")).toBeNull();
  expect(detectGate("### Gate 2 — 2026-09-29\n\nsomething\n")).toBe(2);
  expect(detectGate("### Gate 10 — 2026-09-29\n\nsomething\n")).toBe(10);
});

test("detectGate refuses a section file that opens with neither shape", () => {
  expect(() => detectGate("Some prose, no heading at all.\n")).toThrow(
    /must be "## Review".*or start with "### Gate/,
  );
});

// --- setStatus -----------------------------------------------------------------

const frontmatterTicket = [
  "---",
  "id: zz-2",
  "tool: repo",
  "status: ready",
  "---",
  "",
  "# zz-2",
  "",
].join("\n");

test("setStatus replaces the frontmatter status line and nothing else", () => {
  const updated = setStatus(frontmatterTicket, "done");
  expect(updated).toBe(frontmatterTicket.replace("status: ready", "status: done"));
});

test("setStatus refuses a ticket with no frontmatter, or with no status line", () => {
  expect(() => setStatus("# no frontmatter\n", "done")).toThrow(/no frontmatter/);
  expect(() => setStatus("---\nid: zz-2\n---\n", "done")).toThrow(/no "status:" line/);
  expect(() => setStatus("---\nstatus: a\nstatus: b\n---\n", "done")).toThrow(
    /more than one "status:" line/,
  );
});

// --- parseLandArgs ---------------------------------------------------------

test("parseLandArgs reads a ticket, one or more sections in order, and the three required flags", () => {
  expect(
    parseLandArgs([
      "--land",
      "t.md",
      "gate1.md",
      "gate2.md",
      "--base",
      "origin/main",
      "--status",
      "done",
      "--title",
      "fix(repo): a thing (repo-1)",
    ]),
  ).toEqual({
    ticket: "t.md",
    sections: ["gate1.md", "gate2.md"],
    base: "origin/main",
    status: "done",
    title: "fix(repo): a thing (repo-1)",
    branch: null,
  });
});

test("parseLandArgs refuses a missing flag, an unknown one, and a bad --status", () => {
  expect(() =>
    parseLandArgs(["--land", "t.md", "g.md", "--status", "done", "--title", "x"]),
  ).toThrow(/--base is required/);
  expect(() => parseLandArgs(["--land", "t.md", "g.md", "--base", "main", "--title", "x"])).toThrow(
    /--status must be "done" or "in-flight"/,
  );
  expect(() =>
    parseLandArgs([
      "--land",
      "t.md",
      "g.md",
      "--base",
      "main",
      "--status",
      "maybe",
      "--title",
      "x",
    ]),
  ).toThrow(/--status must be "done" or "in-flight", got "maybe"/);
  expect(() =>
    parseLandArgs(["--land", "t.md", "--base", "main", "--status", "done", "--title", "x"]),
  ).toThrow(/needs a ticket file and at least one section file/);
  expect(() =>
    parseLandArgs([
      "--land",
      "t.md",
      "g.md",
      "--base",
      "main",
      "--status",
      "done",
      "--title",
      "x",
      "--nope",
    ]),
  ).toThrow(/unknown option --nope/);
  expect(LAND_USAGE).toMatch(/--land/);
});

// --- unpinnedPreexistingCitations -------------------------------------------

// --- land() ------------------------------------------------------------------

/**
 * A branch-shaped fixture for `--land`: a real working repo with a real bare
 * "origin", so the push step has somewhere local to land on — never the
 * network, per this ticket's own `Done when`. `base` is the repo's first
 * commit, which already carries `src/tls.ts` and the ticket, on `main`; the
 * caller lands on `feature`, checked out from it.
 */
function withLandRepo(): {
  dir: string;
  bareDir: string;
  ticketAbs: string;
  base: string;
  cleanup: () => void;
} {
  const bareDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "review-record-origin-")));
  gitIn(bareDir, "init", "-q", "--bare", "-b", "main");

  const { dir, ticketAbs } = withTicketRepo();
  gitIn(dir, "remote", "add", "origin", bareDir);
  const base = gitIn(dir, "rev-parse", "HEAD");
  gitIn(dir, "push", "-q", "-u", "origin", "main");
  gitIn(dir, "checkout", "-qb", "feature");

  return {
    dir,
    bareDir,
    ticketAbs,
    base,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(bareDir, { recursive: true, force: true });
    },
  };
}

const okPreflight = () => ({ ok: true, output: "preflight passed (exit 0)" });

test("land() splices two gates, sets status, pushes and verifies — one call, a fixture repo, a local bare remote", () => {
  const { dir, bareDir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );

    // Content the branch itself introduces, cited unpinned — exempt from the
    // pre-existing-content refusal because `base` never held it.
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "new-thing.mjs"), "export const x = 1;\n");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "feat(repo): add the new thing");

    const gate2 = writeSectionFile(
      dir,
      "gate2.md",
      [
        "### Gate 2 — 2026-09-29",
        "",
        'Proof: `scripts/new-thing.mjs:1 "export const x = 1;"`.',
        "",
      ].join("\n"),
    );

    const result = land({
      ticket: ticketAbs,
      sections: [gate1, gate2],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: okPreflight,
    });

    expect(result.steps.map((s) => `${s.name}:${s.ok}`)).toEqual([
      "setup:true",
      "sections:true",
      "splice:true",
      "push:true",
      "verify:true",
      "preflight:true",
    ]);
    expect(result.ok).toBe(true);

    // Two commits, one per gate.
    const subjects = gitIn(dir, "log", "--format=%s", `${base}..HEAD`)
      .split("\n")
      .filter(Boolean)
      .toReversed();
    expect(subjects).toHaveLength(3); // the "new thing" commit, then two gates.
    expect(subjects[1]).toMatch(
      /^docs\(repo\): record gate 1 and set status done on zz-1 \(zz-1\)$/,
    );
    expect(subjects[2]).toMatch(/^docs\(repo\): record gate 2 on zz-1 \(zz-1\)$/);

    // Status set in the ticket at HEAD.
    expect(gitIn(dir, "show", `HEAD:${TICKET_PATH}`)).toMatch(/^status: done$/m);

    // Pushed: the bare remote's own `feature` ref is this branch's HEAD.
    expect(gitIn(bareDir, "rev-parse", "feature")).toBe(gitIn(dir, "rev-parse", "HEAD"));

    // Both gates verify independently against what actually landed.
    expect(runCli(dir, ["--verify", ticketAbs, gate1]).status).toBe(0);
    expect(runCli(dir, ["--verify", ticketAbs, gate2, "--gate", "2"]).status).toBe(0);
  } finally {
    cleanup();
  }
});

test('land() lands every commit and the push, then names "preflight" when it fails, without rolling anything back', () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );

    const result = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "in-flight",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: () => ({ ok: false, output: "FAIL check: no package.json in the fixture" }),
    });

    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.name)).toEqual([
      "setup",
      "sections",
      "splice",
      "push",
      "verify",
      "preflight",
    ]);
    const failed = result.steps.at(-1);
    expect(failed?.name).toBe("preflight");
    expect(failed?.ok).toBe(false);
    expect(failed?.detail).toContain("FAIL check: no package.json in the fixture");
    // Gate 1, F3: a post-splice failure prints the pre-landing sha and the
    // reset command, but does not run it — the commit stays, on purpose.
    expect(failed?.detail).toContain(`git reset --hard ${base}`);

    // The commit and the push already happened — a report, not a reversal.
    expect(gitIn(dir, "log", "-1", "--format=%s")).toMatch(/record gate 1/);
  } finally {
    cleanup();
  }
});

test("land() validates every section against a scratch clone before any commit, so a later section's own splice failure lands nothing (gate 1, F3)", () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );
    // Gate 2 cites a `.claude/` line the branch itself adds, unpinned — it is
    // not pre-existing content, so `citations-pin` does not catch it, but
    // `spliceSection`'s own `--require-claude-pins` check (repo-78 gate 2,
    // F2/G2-d) refuses it at `splice`, on the *second* section — the only
    // way to see that is to have gate 1 already spliced in ahead of it,
    // which is exactly what the scratch clone validates.
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "rule.md"), "line one\nline two\n");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "docs(repo): add a rule page");

    // `land()`'s own pre-landing sha is captured at this point — after every
    // commit the branch made on its own, before any commit `land()` makes.
    const preLandingSha = gitIn(dir, "rev-parse", "HEAD");
    const beforeTicket = fs.readFileSync(ticketAbs, "utf8");

    const gate2 = writeSectionFile(
      dir,
      "gate2.md",
      "## Review\n\n### Gate 1 — 2026-09-29, again\n\nA second first review.\n",
    );

    const result = land({
      ticket: ticketAbs,
      sections: [gate1, gate2],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: okPreflight,
    });

    expect(result.ok).toBe(false);
    const failed = result.steps.at(-1);
    expect(failed?.name).toBe("splice");
    expect(failed?.detail).toMatch(/already has a "## Review" section/);
    // Never "rolled back" — validated in a scratch clone, so there was
    // nothing in the real repository to roll back in the first place.
    expect(failed?.detail).toMatch(/Validated against a scratch clone/);
    expect(failed?.detail).not.toMatch(/reset --hard/);

    // Gate 1 never became a real commit at all: the branch is exactly where
    // it started, not left holding half a landing.
    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(preLandingSha);
    expect(fs.readFileSync(ticketAbs, "utf8")).toBe(beforeTicket);
    expect(fs.readFileSync(ticketAbs, "utf8")).not.toMatch(/## Review/);
  } finally {
    cleanup();
  }
});

test("land() never touches the real repository while validating — an unrelated uncommitted edit to a tracked file survives, and no commit is ever made (gate 1, F3 corrected; superseded at setup by gate 2, G2-a)", () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "rule.md"), "line one\nline two\n");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "docs(repo): add a rule page");

    const preLandingSha = gitIn(dir, "rev-parse", "HEAD");

    // An unrelated, uncommitted edit to a *tracked* file in the same working
    // tree — untracked survives any `git reset --hard` on its own, so this
    // has to be a modification to something already committed to be a real
    // test of it. A mechanism that reached for `git reset --hard` in the
    // real checkout on a later failure — the round-1 shape of this fix —
    // discards exactly this. Gate 2's own G2-a then found the round-2
    // shape (a scratch clone made from `HEAD`) could still commit gate 1 for
    // real before noticing gate 2's own failure, if a tracked file's
    // uncommitted edit shifted a cited line the clone never saw — so this
    // case is now caught earlier still, at `setup`, before the clone is even
    // made, which is what this test now asserts.
    const trackedPath = path.join(dir, "src", "tls.ts");
    const trackedBefore = fs.readFileSync(trackedPath, "utf8");
    fs.writeFileSync(trackedPath, `${trackedBefore}// an unrelated, uncommitted edit\n`);

    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );
    const gate2 = writeSectionFile(
      dir,
      "gate2.md",
      "## Review\n\n### Gate 1 — 2026-09-29, again\n\nA second first review.\n",
    );

    const result = land({
      ticket: ticketAbs,
      sections: [gate1, gate2],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: okPreflight,
    });

    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)?.name).toBe("setup");

    // No commit was ever made in the real repository — not gate 1's, not any
    // other — and the unrelated, uncommitted edit is still there.
    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(preLandingSha);
    expect(gitIn(dir, "log", "--format=%H", `${preLandingSha}..HEAD`).trim()).toBe("");
    expect(fs.readFileSync(trackedPath, "utf8")).toContain("an unrelated, uncommitted edit");
    expect(gitIn(dir, "status", "--porcelain")).toContain("src/tls.ts");
  } finally {
    cleanup();
  }
});

test('land() names "push" when the remote already holds a commit this branch has not seen', () => {
  const { dir, bareDir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    gitIn(dir, "push", "-q", "origin", "feature");

    // A second clone lands an unrelated commit on the remote's `feature`
    // first, so this branch's own push is no longer a fast-forward.
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-other-"));
    const clone = spawnSync("git", ["clone", "-q", bareDir, otherDir], {
      encoding: "utf8",
      shell: false,
    });
    expect(clone.status).toBe(0);
    gitIn(otherDir, "config", "user.email", "other@example.test");
    gitIn(otherDir, "config", "user.name", "other");
    gitIn(otherDir, "checkout", "-q", "feature");
    fs.writeFileSync(path.join(otherDir, "elsewhere.txt"), "elsewhere\n");
    gitIn(otherDir, "add", "-A");
    gitIn(otherDir, "commit", "-qm", "an unrelated commit lands on the remote first");
    gitIn(otherDir, "push", "-q", "origin", "feature");
    fs.rmSync(otherDir, { recursive: true, force: true });

    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );

    const result = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: okPreflight,
    });

    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)?.name).toBe("push");
  } finally {
    cleanup();
  }
});

// --- spliceSection / verifySection — the refactor repo-80 pulled `main` and
// `verifyMain`'s bodies into, checked once directly so a change to either
// wrapper cannot silently stop calling them.
// ---------------------------------------------------------------------------

test("spliceSection and verifySection are what main() and verifyMain() now call", () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const section = writeSectionFile(
      dir,
      "section.md",
      '## Review\n\n### Gate 1 — 2026-09-29\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n',
    );
    const spliced = spliceSection(ticketAbs, section, null);
    expect(spliced.relative).toBe(TICKET_PATH);
    expect(spliced.diff).toBe("");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "gate 1 lands");

    const verified = verifySection(ticketAbs, section, null, "HEAD");
    expect(verified.relative).toBe(TICKET_PATH);
    expect(verified.block.start).toBeGreaterThan(0);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// repo-80 — the `--land` CLI itself, not only the `land()` function: argv
// parsing, the process-boundary commit and push, and the real `preflight.mjs`
// this repository ships, all through `node review-record.mjs --land`.
// ---------------------------------------------------------------------------

test("the --land CLI refuses a missing flag before touching git, naming it on stderr", () => {
  const { dir, ticketAbs, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      "## Review\n\n### Gate 1 — smoke\n\nsomething.\n",
    );
    const result = runCli(dir, ["--land", ticketAbs, gate1, "--status", "done", "--title", "x"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--base is required/);
  } finally {
    cleanup();
  }
});

test('the --land CLI lands the commit and the push for real, then fails naming "preflight" against a fixture with no package.json', () => {
  const { dir, bareDir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — smoke\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );
    vi.stubEnv("PATH", fakeGhPath(dir));
    const result = runCli(dir, [
      "--land",
      ticketAbs,
      gate1,
      "--base",
      base,
      "--status",
      "done",
      "--title",
      "docs(repo): land the fixture ticket (zz-1)",
    ]);
    vi.unstubAllEnvs();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/== splice ==\nok/);
    expect(result.stdout).toMatch(/== push ==\nok/);
    expect(result.stdout).toMatch(/== verify ==\nok/);
    expect(result.stdout).toMatch(/== preflight ==\nFAIL/);
    expect(result.stderr).toMatch(/--land failed at "preflight"/);

    // The real preflight really ran against this fixture and really failed on its
    // own check 1 (`npm run check` has no `package.json` to read here) — asserted
    // on the step name it prints, never on npm's wording (gate 1, F4: `npm.cmd` on
    // Windows fails differently). Its `gh` is the planted fake, not the runner's:
    // the one spawn here that can reach a network (repo-89, a 49 s timeout), and the
    // marker proves the fake answered, since a real `gh` here exits non-zero too.
    expect(result.stdout).toContain(FAKE_GH_MARKER);
    expect(result.stdout).toMatch(/== check ==\nFAIL/);

    // Everything before "preflight" really landed, real push included.
    expect(gitIn(bareDir, "rev-parse", "feature")).toBe(gitIn(dir, "rev-parse", "HEAD"));
    expect(gitIn(dir, "log", "-1", "--format=%s")).toMatch(/record gate 1/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// repo-80 gate 1, F2: four links of the landing chain had no test — a
// mutation at any of these four passed 52 of 52 before this round. Each test
// below is red on exactly the mutation the gate named, run alone.
// ---------------------------------------------------------------------------

test("land() sets status in the FIRST commit, not only at HEAD (F2/M2)", () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );
    const gate2 = writeSectionFile(dir, "gate2.md", "### Gate 2 — 2026-09-29\n\nNothing cited.\n");

    const result = land({
      ticket: ticketAbs,
      sections: [gate1, gate2],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: okPreflight,
    });

    expect(result.ok).toBe(true);
    const shas = gitIn(dir, "log", "--format=%H", `${base}..HEAD`)
      .split("\n")
      .filter(Boolean)
      .toReversed();
    expect(shas).toHaveLength(2);
    // The commit BEFORE landing still has the old status …
    expect(gitIn(dir, "show", `${base}:${TICKET_PATH}`)).toMatch(/^status: ready$/m);
    // … and the FIRST commit `land()` makes already has the new one — a
    // mutation writing status only in the last commit leaves this one still
    // "ready".
    expect(gitIn(dir, "show", `${shas[0]}:${TICKET_PATH}`)).toMatch(/^status: done$/m);
  } finally {
    cleanup();
  }
});

test("land() actually calls its verify step once per section, and stops on its failure (F2/M4)", () => {
  const { dir, bareDir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );

    let calls = 0;
    const result = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      verify: () => {
        calls += 1;
        throw Object.assign(new Error("boom"), {
          stderr: "the committed record does not match the section file, on purpose",
        });
      },
      runPreflight: okPreflight,
    });

    // A deleted verify loop never calls this at all, and `result.ok` stays
    // `true` — both assertions are red on that mutation, run alone.
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)?.name).toBe("verify");
    expect(result.steps.at(-1)?.detail).toContain("does not match the section file, on purpose");

    // The commit and the push already happened — verify runs after both.
    expect(gitIn(bareDir, "rev-parse", "feature")).toBe(gitIn(dir, "rev-parse", "HEAD"));
  } finally {
    cleanup();
  }
});

test("land() passes --title through to runPreflight (F2/M5)", () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );
    const title = "docs(repo): land the fixture ticket (zz-1)";
    const runPreflight = vi.fn(() => ({ ok: true, output: "" }));

    const result = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "done",
      title,
      runPreflight,
    });

    expect(result.ok).toBe(true);
    expect(runPreflight).toHaveBeenCalledTimes(1);
    expect(runPreflight.mock.calls[0]?.slice(1)).toEqual([base, title]);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// repo-80 gate 1 — a trailing low: setStatus on a CRLF frontmatter.
// ---------------------------------------------------------------------------

test("setStatus closes a CRLF frontmatter correctly, and keeps its line endings CRLF", () => {
  const lf = frontmatterTicket;
  const crlf = lf.replaceAll("\n", "\r\n");

  // Reproduced before the fix: `lines.indexOf("---", 1)` never matches
  // `"---\r"`, so a CRLF-closed frontmatter was reported as never closed at
  // all, even though `lines[0]`'s own `.trim()` check — unaffected, since
  // `.trim()` strips `\r` too — found the opening fence correctly.
  const updated = setStatus(crlf, "done");
  expect(updated).toBe(crlf.replace("status: ready\r", "status: done\r"));
  expect(updated).toContain("\r\n");
});

// ---------------------------------------------------------------------------
// repo-80 gate 2 — F2/M5 as the gate actually named it: the previous round's
// test pinned `land()`'s own call to whatever `runPreflight` it was given,
// never `runPreflightDefault`'s own argv to the real `preflight.mjs`, which
// is where the gate's mutation (dropping `--title`) actually lives.
// ---------------------------------------------------------------------------

test("runPreflightDefault passes --title through to the real preflight.mjs argv (gate 2, F2/M5)", () => {
  const spawn = vi.fn((_cmd: string, _args: string[], _options: unknown) => ({
    status: 0,
    stdout: "",
    stderr: "",
  }));
  const title = "docs(repo): land the fixture ticket (zz-1)";

  const result = runPreflightDefault("/some/repo", "origin/main", title, spawn);

  expect(result.ok).toBe(true);
  expect(spawn).toHaveBeenCalledTimes(1);
  const call = spawn.mock.calls.at(0);
  const args = call?.[1] ?? [];
  // Dropping `--title` (or its value) from this array is exactly gate 2's
  // named mutation — `scripts/review-record.mjs`, the argv literal inside
  // `runPreflightDefault` — and this assertion is red on either half of it.
  expect(args).toContain("--title");
  expect(args[args.indexOf("--title") + 1]).toBe(title);
  expect(args).toContain("origin/main");
  expect(args).toContain("/some/repo");
});

// ---------------------------------------------------------------------------
// repo-80 gate 2 — G2-a: validation reads the committed tree (the scratch
// clone), the real pass used to read the working tree — a dirty tracked file
// could make them disagree. The owner's answer: refuse at `setup`.
// ---------------------------------------------------------------------------

test("land() refuses at setup when a tracked file has an uncommitted change, before any clone or commit (gate 2, G2-a)", () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const preLandingSha = gitIn(dir, "rev-parse", "HEAD");

    // Not the ticket itself — a different tracked, already-committed file,
    // the exact shape gate 2's probe used: an uncommitted edit that would
    // have shifted a cited line invisibly to the scratch clone.
    const trackedPath = path.join(dir, "src", "tls.ts");
    fs.writeFileSync(
      trackedPath,
      `// inserted, uncommitted\n${fs.readFileSync(trackedPath, "utf8")}`,
    );

    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );

    const result = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: okPreflight,
    });

    expect(result.ok).toBe(false);
    const failed = result.steps.at(-1);
    expect(failed?.name).toBe("setup");
    expect(failed?.detail).toMatch(/uncommitted change to a tracked file/);
    // Never the misleading "commit(s) already made" hint — nothing ran yet.
    expect(failed?.detail).not.toMatch(/commit\(s\) already made/);
    expect(failed?.detail).not.toMatch(/reset --hard/);
    // `trimEnd()`, never `trim()` (gate 3, G3-c): `git status --porcelain`'s
    // own leading space on an unstaged change (" M src/tls.ts") must survive
    // into the message. `trim()` would strip exactly that space off this
    // single-line status, printing the staged shape ("M src/tls.ts") instead.
    expect(failed?.detail).toContain(" M src/tls.ts");
    expect(failed?.detail).not.toContain("first:\nM src/tls.ts");

    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(preLandingSha);
    expect(fs.readFileSync(trackedPath, "utf8")).toContain("inserted, uncommitted");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// repo-80 gate 2 — G2-b: a validation (or real-pass) failure names which
// section file it came from, not only the checker's own text.
// ---------------------------------------------------------------------------

test("land() names the failing section file in a splice failure's detail (gate 2, G2-b)", () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "rule.md"), "line one\nline two\n");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "docs(repo): add a rule page");

    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );
    // Named "second.md" rather than "gate2.md" on purpose — the assertion
    // below has to come from the file `land()` was actually given, not a
    // naming convention this test happens to reuse elsewhere.
    const second = writeSectionFile(
      dir,
      "second.md",
      "## Review\n\n### Gate 1 — 2026-09-29, again\n\nA second first review.\n",
    );

    const result = land({
      ticket: ticketAbs,
      sections: [gate1, second],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: okPreflight,
    });

    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)?.detail).toMatch(/^second\.md — /);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// repo-80 gate 2 — G2-c: the scratch clone's cleanup, and the reset hint on a
// push failure, had no test — each removable with all tests still green.
// ---------------------------------------------------------------------------

test("land() leaves no scratch directory behind, whether validation passes or fails (gate 2, G2-c; isolated per gate 3, G3-a)", () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  // A private temp directory, isolated from whatever else is running in the
  // machine's shared temp directory (gate 3, G3-a): counting every
  // `review-record-land-*` entry there is racy the moment a second session
  // runs this same suite, or `preflight`'s own project-wide `npm test`,
  // concurrently — measured by the gate at 9 failures of 12 runs made
  // alongside two other processes exercising `land()`. `os.tmpdir()` reads
  // `TMPDIR` (POSIX) or `TEMP`/`TMP` (Windows) fresh on every call, so
  // overriding all three for the duration of this test redirects `land()`'s
  // own `fs.mkdtempSync(os.tmpdir(), ...)` here without touching anything
  // else on the machine — on POSIX `TMPDIR` alone is enough, since Node
  // checks it first, but Node's own `os.tmpdir()` never reads `TMPDIR` on
  // Windows at all, only `TEMP` then `TMP`; setting only `TMPDIR` there would
  // leave `land()` writing to the real shared directory while this test
  // counted the empty private one (gate 3's own reading, unmeasured here —
  // this suite has only run on Linux).
  const privateTmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "review-record-private-tmp-")),
  );
  const originalTmpdir = process.env.TMPDIR;
  const originalTemp = process.env.TEMP;
  const originalTmp = process.env.TMP;
  process.env.TMPDIR = privateTmp;
  process.env.TEMP = privateTmp;
  process.env.TMP = privateTmp;
  try {
    const prefix = "review-record-land-";
    const countScratchDirs = () =>
      fs.readdirSync(privateTmp).filter((n) => n.startsWith(prefix)).length;
    const before = countScratchDirs();

    // A validation failure that reaches the scratch clone before refusing —
    // an unanchored citation fails `spliceSection`'s own check inside it,
    // which is where the scratch directory this asserts on actually exists.
    const badGate = writeSectionFile(
      dir,
      "bad.md",
      "## Review\n\n### Gate 1\n\nProof: `src/tls.ts:2`.\n",
    );
    const failed = land({
      ticket: ticketAbs,
      sections: [badGate, badGate],
      base,
      status: "done",
      title: "x",
      runPreflight: okPreflight,
    });
    expect(failed.ok).toBe(false);
    expect(failed.steps.at(-1)?.name).toBe("splice");
    expect(countScratchDirs()).toBe(before);

    // A full success — validation and the real pass both run.
    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );
    const ok = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "done",
      title: "x",
      runPreflight: okPreflight,
    });
    expect(ok.ok).toBe(true);
    expect(countScratchDirs()).toBe(before);
  } finally {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    if (originalTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = originalTemp;
    if (originalTmp === undefined) delete process.env.TMP;
    else process.env.TMP = originalTmp;
    fs.rmSync(privateTmp, { recursive: true, force: true });
    cleanup();
  }
});

test("land() prints the reset command on a push failure too, not only on preflight (gate 2, G2-c)", () => {
  const { dir, bareDir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    gitIn(dir, "push", "-q", "origin", "feature");
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-other-"));
    const clone = spawnSync("git", ["clone", "-q", bareDir, otherDir], {
      encoding: "utf8",
      shell: false,
    });
    expect(clone.status).toBe(0);
    gitIn(otherDir, "config", "user.email", "other@example.test");
    gitIn(otherDir, "config", "user.name", "other");
    gitIn(otherDir, "checkout", "-q", "feature");
    fs.writeFileSync(path.join(otherDir, "elsewhere.txt"), "elsewhere\n");
    gitIn(otherDir, "add", "-A");
    gitIn(otherDir, "commit", "-qm", "an unrelated commit lands on the remote first");
    gitIn(otherDir, "push", "-q", "origin", "feature");
    fs.rmSync(otherDir, { recursive: true, force: true });

    const gate1 = writeSectionFile(
      dir,
      "gate1.md",
      `## Review\n\n### Gate 1 — 2026-09-29\n\nProof: \`src/tls.ts@${base}:2 "Defence in depth"\`.\n`,
    );

    const result = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "done",
      title: "docs(repo): land the fixture ticket (zz-1)",
      runPreflight: okPreflight,
    });

    expect(result.ok).toBe(false);
    const failed = result.steps.at(-1);
    expect(failed?.name).toBe("push");
    expect(failed?.detail).toMatch(/git reset --hard/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// repo-80 gate 2 — G2-d: a range citation's suggested pin keeps the range.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A lander works on a detached HEAD: the builder's worktree holds the branch
// name. Every fixer landing on 2026-10-03 committed, then failed at the push.
// ---------------------------------------------------------------------------

test("parseLandArgs reads --branch", () => {
  expect(
    parseLandArgs([
      "--land",
      "t.md",
      "g.md",
      "--base",
      "origin/main",
      "--status",
      "done",
      "--title",
      "x",
      "--branch",
      "feature",
    ]).branch,
  ).toBe("feature");
});

test("land() refuses a detached HEAD with no --branch before it commits anything", () => {
  const { dir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(dir, "gate1.md", "## Review\n\n### Gate 1\n\nA first review.\n");
    gitIn(dir, "checkout", "-q", "--detach");
    const before = gitIn(dir, "rev-parse", "HEAD");

    const result = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "done",
      title: "x",
      runPreflight: okPreflight,
    });

    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ name: "setup", ok: false });
    expect(result.steps.at(-1)?.detail).toMatch(/--branch/);
    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(before);
  } finally {
    cleanup();
  }
});

test("land() pushes a detached HEAD to the branch --branch names", () => {
  const { dir, bareDir, ticketAbs, base, cleanup } = withLandRepo();
  try {
    const gate1 = writeSectionFile(dir, "gate1.md", "## Review\n\n### Gate 1\n\nA first review.\n");
    gitIn(dir, "push", "-q", "origin", "feature");
    gitIn(dir, "checkout", "-q", "--detach");

    const result = land({
      ticket: ticketAbs,
      sections: [gate1],
      base,
      status: "done",
      title: "x",
      branch: "feature",
      runPreflight: okPreflight,
    });

    expect(result.steps.map((s) => `${s.name}:${s.ok}`)).toContain("push:true");
    expect(result.ok).toBe(true);
    expect(gitIn(bareDir, "rev-parse", "refs/heads/feature")).toBe(gitIn(dir, "rev-parse", "HEAD"));
  } finally {
    cleanup();
  }
});
