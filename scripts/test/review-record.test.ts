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
