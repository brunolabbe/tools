/**
 * `review-record.mjs`'s guards — the pure logic in isolation, then the CLI
 * spawned against a real git fixture for the process-boundary claims (a check
 * that fails, a formatter that repads a table, a restore proven against
 * `HEAD`).
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
import { expect, test } from "vitest";
import {
  insertSection,
  locateInsertedBlock,
  normalizeForDiff,
  parseArgs,
  planInsertion,
  USAGE,
  validateFirstLine,
} from "../review-record.mjs";

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
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
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
  return spawnSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8" });
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

test("a section that fails the checker leaves the ticket byte-identical to HEAD, exit non-zero", () => {
  const { dir, ticketAbs, cleanup } = withTicketRepo();
  try {
    const before = fs.readFileSync(ticketAbs, "utf8");
    const atHead = gitIn(dir, "show", `HEAD:${TICKET_PATH}`);
    expect(before).toBe(`${atHead}\n`); // sanity: git strips no trailing newline of its own

    // Unanchored: resolves, but --require-anchors fails it.
    const section = writeSectionFile(dir, "section.md", "## Review\n\nProof: `src/tls.ts:2`.\n");
    const result = runCli(dir, [ticketAbs, section]);

    expect(result.status).not.toBe(0);
    expect(result.status).toBeGreaterThan(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/unanchored/);

    // The restore, proven against HEAD itself rather than a copy this test made.
    const restoredFromHead = gitIn(dir, "show", `HEAD:${TICKET_PATH}`);
    const onDisk = fs.readFileSync(ticketAbs, "utf8");
    expect(onDisk).toBe(`${restoredFromHead}\n`);
    expect(onDisk).toBe(before);
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
