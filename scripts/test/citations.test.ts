import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  checkCitations,
  extractCitations,
  extractSections,
  FLAGS,
  makeResolver,
  parseArgs,
  selectSection,
  USAGE,
} from "../citations.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO, "scripts", "citations.mjs");

/** A citation, with the fields a given test does not care about filled in. */
const cite = (over: Partial<ReturnType<typeof extractCitations>[number]> = {}) => ({
  file: "a.ts",
  start: 1,
  end: 1,
  anchor: null as string | null,
  source: "inline" as const,
  line: 1,
  ...over,
});

/**
 * The summary line, asserted bucket by bucket.
 *
 * There is no `N/N` to match any more, and that is the point of repo-18 rather
 * than a change of wording: a run over a record whose fix had moved the cited
 * lines printed `9/9 resolve` while three of the nine pointed at unrelated code,
 * so a single fraction is a number that cannot say which of four things
 * happened. Naming each bucket is what makes a test able to fail.
 */
const summary = (
  verified: number,
  moved: number,
  unanchored: number,
  unresolvable: number,
  total: number,
) =>
  new RegExp(
    `${verified} verified, ${moved} moved, ${unanchored} unanchored, ` +
      `${unresolvable} unresolvable — of ${total} citation`,
  );

/** Any `N/N`, the shape the summary must never print again. */
const SAME_OVER_SAME = /\b(\d+)\/\1\b/;

/** The per-citation lines of a run, mark included — everything `--require-anchors` must leave alone. */
const marks = (out: string) => out.split("\n").filter((line) => /^ {2}\S/.test(line));

test("finds an inline file:line citation", () => {
  const found = extractCitations("The guard is wrong at `src/a.ts:12`.");
  expect(found).toEqual([
    { file: "src/a.ts", start: 12, end: 12, anchor: null, source: "inline", line: 1 },
  ]);
});

test("finds a range, and keeps both ends", () => {
  const found = extractCitations("`src/a.ts:12-18` covers it.");
  expect(found).toHaveLength(1);
  expect([found[0]?.start, found[0]?.end]).toEqual([12, 18]);
});

/**
 * The mode a naive regex misses. A findings table with a `line` column carries
 * citations as bare numbers, and skipping the column under-reports coverage
 * silently — which is the one failure the check exists to prevent.
 */
test("finds bare numbers in a table's line column", () => {
  const table = [
    "| file | line | finding |",
    "| --- | --- | --- |",
    "| `src/a.ts` | 42 | off by one |",
    "| `src/b.ts` | 7 | unreachable |",
  ].join("\n");
  const found = extractCitations(table);
  expect(found.map((c) => `${c.file}:${c.start}`)).toEqual(["src/a.ts:42", "src/b.ts:7"]);
  expect(found.every((c) => c.source === "table")).toBe(true);
});

test("does not read prose that merely contains a colon and digits", () => {
  expect(extractCitations("ran at 10:30, exit 2:1, verdict PASS:1")).toEqual([]);
});

test("resolves a bare filename against the tracked files", () => {
  const resolve = makeResolver(["tools/planner/api/src/grounding/valhalla.ts", "src/other.ts"]);
  expect(resolve("valhalla.ts")).toEqual({ path: "tools/planner/api/src/grounding/valhalla.ts" });
});

/**
 * Real gate records cite bare filenames, and this repo has same-named tests in
 * two tools. Picking the first match would make the check a rubber stamp, so an
 * ambiguous citation is a failure — it is not a pointer.
 */
test("fails an ambiguous bare filename rather than guessing", () => {
  const resolve = makeResolver([
    "tools/downloader/api/test/logging.test.ts",
    "tools/planner/api/test/logging.test.ts",
  ]);
  const result = resolve("logging.test.ts");
  expect(result).toHaveProperty("error");
  expect("error" in result && result.error).toMatch(/ambiguous — 2 tracked files/);
});

test("fails a filename that matches nothing tracked", () => {
  expect(makeResolver(["src/a.ts"])("gone.ts")).toEqual({ error: "no tracked file matches" });
});

test("fails a line past the end of the file, and says how long the file is", () => {
  const results = checkCitations([cite({ start: 99, end: 99 })], () => ["one", "two"]);
  expect(results[0]?.state).toBe("unresolvable");
  expect(results[0]?.reason).toBe("line 99 is past end of file (2 lines)");
});

/**
 * The pre-repo-18 behaviour, kept exactly — and renamed to say what it now is.
 * A citation with no anchor still prints its line for a reader to judge, because
 * that hand judgement is the only check it has; what changed is that it is no
 * longer counted as anything the script verified.
 */
test("an unanchored citation returns the line's text, and is never verified", () => {
  const results = checkCitations([cite({ start: 2, end: 2 })], () => [
    "one",
    "  const guard = true;",
    "three",
  ]);
  expect(results[0]?.state).toBe("unanchored");
  expect(results[0]?.text).toBe("const guard = true;");
});

/**
 * The gate is the exit code, so it is verified by making it fail first — the
 * same standard repo-6 set for `status --json`.
 */
test("the CLI exits non-zero on an unresolvable citation, and zero when they all resolve", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "citations-"));
  const record = path.join(dir, "ticket.md");

  fs.writeFileSync(record, "## Review\n\nBroken at `scripts/citations.mjs:999999`.\n");
  const bad = spawnSync("node", [CLI, record], { cwd: REPO, encoding: "utf8" });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/cannot be right/);

  fs.writeFileSync(record, "## Review\n\nFine at `scripts/citations.mjs:1`.\n");
  const good = spawnSync("node", [CLI, record], { cwd: REPO, encoding: "utf8" });
  expect(good.status).toBe(0);
  expect(good.stdout).toMatch(summary(0, 0, 1, 0, 1));
  // It resolves and it is not verified, because the record gave it no anchor.
  expect(good.stdout).not.toMatch(SAME_OVER_SAME);

  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Acceptance 1. An unknown flag used to be swallowed in silence, which is the
 * shape this whole script exists to prevent in records: a run that did not do
 * what its arguments said, reported as if it had.
 */
test("the CLI rejects an unknown flag with the usage string and a non-zero exit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "citations-"));
  const record = path.join(dir, "ticket.md");
  fs.writeFileSync(record, "## Review\n\nFine at `scripts/citations.mjs:1`.\n");

  const result = spawnSync("node", [CLI, record, "--nonsense"], { cwd: REPO, encoding: "utf8" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/unknown option --nonsense/);
  expect(result.stderr).toMatch(/usage: node scripts\/citations\.mjs/);
  // It must refuse, not check the record anyway and mention the flag afterwards.
  expect(result.stdout).not.toMatch(/resolve/);

  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Acceptance 2, and the more valuable half of the ticket: `--rev` is documented
 * *and* implemented, and it broke on an argument order every CLI convention
 * permits, because a flag's value does not start with `--` and so was
 * indistinguishable from the ticket file. Both orders, since the bug was only
 * ever visible in one of them.
 */
test("the CLI resolves the ticket rather than a file named after the sha, in either order", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "citations-"));
  const record = path.join(dir, "ticket.md");
  fs.writeFileSync(record, "## Review\n\nFine at `scripts/citations.mjs:1`.\n");

  for (const argv of [
    [record, "--rev", "HEAD"],
    ["--rev", "HEAD", record],
  ]) {
    const result = spawnSync("node", [CLI, ...argv], { cwd: REPO, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    // Both halves matter: the record was read, and the rev was actually applied.
    expect(result.stdout).toMatch(/resolved against HEAD/);
    expect(result.stdout).toMatch(summary(0, 0, 1, 0, 1));
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * repo-18's answer to "how does the tool know a citation is right": the citation
 * carries a fragment of what it points at. Both spellings are accepted because
 * reviewers here already wrote the first one thirteen times before anything
 * could read it — the format is theirs, not a new one invented for the check.
 */
test("finds anchor text after a citation, inside or outside the backticks", () => {
  expect(extractCitations('at `src/a.ts:12` "const guard = true"')[0]?.anchor).toBe(
    "const guard = true",
  );
  expect(extractCitations('at `src/a.ts:12 "const guard = true"`')[0]?.anchor).toBe(
    "const guard = true",
  );
  expect(extractCitations('at `src/a.ts:12-18 "const guard"`')[0]?.anchor).toBe("const guard");
});

/**
 * The false-positive half, and the reason the separation rule is one optional
 * space rather than `[ \t]*`: prose that quotes something a sentence later is not
 * an anchor, and reading it as one would report a citation moved for saying so.
 * Measured over every `.md` in the tree at the time: 13 anchors extracted, all of
 * them genuine, and zero citations followed by a typographic quote — so `"` alone
 * is enough and `“` would only start catching prose.
 */
test("does not take a quotation further along the sentence for an anchor", () => {
  expect(extractCitations('`src/a.ts:12`, and then the reviewer said "no"')[0]?.anchor).toBe(null);
  expect(extractCitations("`src/a.ts:12` and “a smart-quoted aside”")[0]?.anchor).toBe(null);
});

test("finds an anchor in a table's line cell, where the location is a bare number", () => {
  const table = [
    "| file | line | finding |",
    "| --- | --- | --- |",
    '| `src/a.ts` | 42 "const guard = true" | off by one |',
  ].join("\n");
  expect(extractCitations(table)[0]).toMatchObject({
    file: "src/a.ts",
    start: 42,
    anchor: "const guard = true",
  });
});

/**
 * **Done when 1**, at the unit. The same citation against two versions of one
 * file: the second inserts three lines *above* the cited region and changes
 * nothing else. Before, it is verified; after, it is moved and the reason says
 * where the text went.
 *
 * An insertion rather than a deletion on purpose — the ticket is explicit about
 * it and it is the whole difficulty. A deleted file already failed before this
 * change (`line 99 is past end of file`), so a deletion fixture would pass
 * without proving anything. Here the cited lines still *exist* at both revs, and
 * the old check called that resolved.
 */
const CITED_REGION = [
  "export const before = 1;",
  "// Defence in depth, and **not** what fixes the collision — a mutation",
  "// run proved it.",
  "export const after = 2;",
];
const INSERTED_ABOVE = ["// inserted", "// inserted", "// inserted", ...CITED_REGION];

test("a citation whose referent moved is reported as moved, not as resolved", () => {
  const citation = cite({ start: 2, end: 3, anchor: "Defence in depth" });

  const before = checkCitations([citation], () => CITED_REGION)[0];
  expect(before?.state).toBe("verified");

  const after = checkCitations([citation], () => INSERTED_ABOVE)[0];
  expect(after?.state).toBe("moved");
  expect(after?.reason).toBe('anchor "Defence in depth" is not in 2-3 — it is at 5');
  // The half that makes this ticket hard: it still resolves. Lines 2 and 3 exist
  // in both files, so nothing about the coordinates is wrong.
  expect(INSERTED_ABOVE.length).toBeGreaterThanOrEqual(3);
  expect(after?.text).toBe("// inserted");
});

/**
 * An anchor is matched against the file joined into one string, because the
 * things worth anchoring wrap. This is the real case, not an invented one:
 * repo-7 cites ``03-RELEASING.md:97-99 "heads that release's `### Features`"``
 * and that text runs across two lines of the target, so it is on neither of
 * them. A line-by-line match reports "not anywhere in the file" and is wrong.
 */
test("an anchor that wraps across two source lines still matches", () => {
  const results = checkCitations(
    [cite({ start: 2, end: 3, anchor: "decided downloader `0.2.0`, a **minor** bump" })],
    () => [
      "- **`a112cd4`** is what",
      "  decided downloader `0.2.0`, a **minor** bump from `0.1.1`, and it heads that",
      "  release's `### Features`.",
    ],
  );
  expect(results[0]?.state).toBe("verified");
});

/**
 * The boundary of that, pinned rather than left to be discovered. The lines are
 * joined raw, so a comment's continuation marker sits in the middle of the
 * haystack and an anchor spanning it does not match. Stripping `//`, `*` and `#`
 * would be built for a case nothing has asked for — of the 13 anchors written by
 * hand in this repo before the script could read any of them, one needs the join
 * and none needs a marker stripped. The fix when it bites is to shorten the
 * anchor, and the reason says how to tell: "not anywhere in the file".
 */
test("an anchor spanning a comment's continuation marker does not match, and says so", () => {
  const results = checkCitations(
    [cite({ start: 2, end: 3, anchor: "a mutation run proved it" })],
    () => CITED_REGION,
  );
  expect(results[0]?.state).toBe("moved");
  expect(results[0]?.reason).toMatch(/not anywhere in a\.ts/);
  // Shortening it to one line's worth is what the reason is telling you to do.
  const shorter = checkCitations(
    [cite({ start: 2, end: 3, anchor: "what fixes the collision" })],
    () => CITED_REGION,
  );
  expect(shorter[0]?.state).toBe("verified");
});

/**
 * The other half of that boundary, and the reason it is narrow enough to leave
 * alone. Because the lines are joined **raw**, the marker is still in the
 * haystack — so an anchor produced the way `records.md` tells you to produce one,
 * by copying what you read, carries the marker across the break and verifies.
 * Only an author retyping the text and silently dropping the marker hits the
 * failure above.
 *
 * Pinned because it is load-bearing for a decision: stripping the haystack alone
 * would break *this* case, so the only coherent alternative is strip-both-sides,
 * and `#`/`*` are ambiguous enough in markdown and JSDoc that its false-positive
 * surface is worse than the miss it fixes.
 */
test("an anchor that keeps the comment marker it copied still matches across the break", () => {
  const results = checkCitations(
    [cite({ start: 2, end: 3, anchor: "what fixes the collision — a mutation // run proved it." })],
    () => CITED_REGION,
  );
  expect(results[0]?.state).toBe("verified");
});

/**
 * The end of a range is deliberately loose — an anchor may run past the line it
 * cites — but the dangerous direction is closed: text lying *entirely* outside
 * the cited range can never read as verified, because the match's start line
 * must be inside it. That is what stops joining from reproducing the
 * pre-repo-18 failure, where a citation landed on whatever had moved into its
 * line number.
 */
test("an anchor starting outside the cited range is moved, however loose the end is", () => {
  const file = ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;"];

  // Runs past the cited line, and verifies: the start is in range.
  const past = checkCitations(
    [cite({ start: 2, end: 2, anchor: "const b = 2; const c = 3; const d = 4;" })],
    () => file,
  );
  expect(past[0]?.state).toBe("verified");

  // Starts after the cited range, and cannot verify however much it overlaps.
  const outside = checkCitations(
    [cite({ start: 1, end: 2, anchor: "const c = 3; const d = 4;" })],
    () => file,
  );
  expect(outside[0]?.state).toBe("moved");
  expect(outside[0]?.reason).toMatch(/is not in 1-2 — it is at 3/);
});

test("an anchor that is nowhere in the file says so, rather than naming a line", () => {
  const results = checkCitations([cite({ start: 1, end: 1, anchor: "not in here" })], () => [
    "one",
    "two",
  ]);
  expect(results[0]?.state).toBe("moved");
  expect(results[0]?.reason).toMatch(/not anywhere in a\.ts/);
});

/**
 * A truncated anchor is a prefix of what its author read, not a literal. Two of
 * the anchors already in this repo end in an ellipsis, and treating the dots as
 * text would report both as moved.
 */
test("a trailing ellipsis in an anchor is a truncation mark, not text to match", () => {
  const results = checkCitations(
    [cite({ start: 1, end: 1, anchor: "an existing row survives migration 3..." })],
    () => ["  test('an existing row survives migration 3, keeping its columns')"],
  );
  expect(results[0]?.state).toBe("verified");
});

/** **Done when 3**, at the unit: four states, and none of them is a boolean. */
test("the four states are distinct, and an unanchored citation is not one of the good ones", () => {
  const results = checkCitations(
    [
      cite({ start: 1, end: 1, anchor: "one" }),
      cite({ start: 1, end: 1, anchor: "two" }),
      cite({ start: 1, end: 1 }),
      cite({ start: 99, end: 99 }),
    ],
    () => ["one", "two"],
  );
  expect(results.map((r) => r.state)).toEqual(["verified", "moved", "unanchored", "unresolvable"]);
});

/**
 * A record with citations in more than one section, so a filtered run can be
 * asserted to be *strictly* smaller than an unfiltered one rather than merely
 * equal to it — which is the whole failure this flag had.
 *
 * The fenced `## Log` is load-bearing. Records here quote changelog fragments
 * in code blocks: measured across every record under `docs/work`, 40
 * heading-looking lines sit inside fences. A splitter that took them for
 * headings would end `## Review` early and silently drop the citations after
 * it, so this fixture makes that failure visible as a smaller count.
 */
const TWO_SECTION_RECORD = [
  "# Record",
  "",
  "## Review",
  "",
  "Broken at `scripts/citations.mjs:1`.",
  "",
  "```md",
  "## Log",
  "A quoted heading, not a real one.",
  "```",
  "",
  "Also `scripts/status.mjs:1`.",
  "",
  "### Nested under Review",
  "",
  "Nested at `scripts/commit-message.mjs:1`.",
  "",
  "## Log",
  "",
  "Elsewhere at `scripts/citations.mjs:2`.",
  "",
  "## Nothing here",
  "",
  "No citations at all.",
  "",
].join("\n");

/** Write the fixture to a fresh temp dir and hand back its path plus a cleanup. */
function withRecord(body: string): { record: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "citations-"));
  const record = path.join(dir, "ticket.md");
  fs.writeFileSync(record, body);
  return { record, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const run = (...argv: string[]) =>
  spawnSync("node", [CLI, ...argv], { cwd: REPO, encoding: "utf8" });

/**
 * Acceptance 3. A filtered run reports strictly fewer citations than an
 * unfiltered one, and `## Review` carries its `###` subsection with it — the
 * alternative would drop those citations, which is the failure this script
 * exists to prevent, reintroduced by its own new flag.
 */
test("--section narrows the check to one heading's span, subsections included", () => {
  const { record, cleanup } = withRecord(TWO_SECTION_RECORD);

  const all = run(record);
  expect(all.status).toBe(0);
  expect(all.stdout).toMatch(summary(0, 0, 4, 0, 4));

  // Three, not one: the fenced `## Log` is not a heading. And not four: `## Log`
  // proper is outside the span.
  const review = run(record, "--section", "Review");
  expect(review.status).toBe(0);
  expect(review.stdout).toMatch(summary(0, 0, 3, 0, 3));
  expect(review.stdout).toMatch(/commit-message\.mjs:1/);
  expect(review.stdout).not.toMatch(/citations\.mjs:2/);

  const log = run(record, "--section", "Log");
  expect(log.status).toBe(0);
  expect(log.stdout).toMatch(summary(0, 0, 1, 0, 1));
  expect(log.stdout).toMatch(/citations\.mjs:2/);

  // The scope is named in the output, so a count can never be read against the
  // wrong denominator without the denominator being on screen next to it.
  expect(log.stdout).toMatch(/under "Log"/);

  cleanup();
});

/**
 * The sub-question the ticket argued and this settles the same way, for a reason
 * the ticket did not give: `0/0 resolve` with exit 0 is *already* the honest
 * output for a section that exists and holds no citations, so a silent miss
 * would be indistinguishable from a correct result. A typo'd section name would
 * report success having checked nothing at all — a worse wrong-denominator
 * failure than the one this ticket was filed for. Both halves are asserted here,
 * because the pair is the point.
 */
test("a section that matches nothing is an error, while an empty one that exists is not", () => {
  const { record, cleanup } = withRecord(TWO_SECTION_RECORD);

  const missing = run(record, "--section", "NoSuchSectionAtAll");
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toMatch(/no section matches "NoSuchSectionAtAll"/);
  // It lists what the record does have, so the typo costs one read, not two.
  expect(missing.stderr).toMatch(/## Review/);
  expect(missing.stdout).not.toMatch(/resolve/);

  const empty = run(record, "--section", "Nothing here");
  expect(empty.status).toBe(0);
  expect(empty.stdout).toMatch(summary(0, 0, 0, 0, 0));

  cleanup();
});

/**
 * Matching more than one section fails rather than taking the first, which is
 * the rule `makeResolver` already applies to an ambiguous bare filename for the
 * same reason: quietly picking one is how a check becomes a rubber stamp.
 */
test("a --section name matching two sections fails and names them both", () => {
  const { record, cleanup } = withRecord(TWO_SECTION_RECORD);

  const ambiguous = run(record, "--section", "N");
  expect(ambiguous.status).not.toBe(0);
  expect(ambiguous.stderr).toMatch(/matches 2 sections/);
  expect(ambiguous.stderr).toMatch(/Nested under Review/);
  expect(ambiguous.stderr).toMatch(/Nothing here/);

  cleanup();
});

/**
 * A throwaway repository whose second commit inserts three lines above a cited
 * comment and changes nothing else — the reproduction repo-18 was filed from, in
 * miniature. It has to be a real repository because the CLI finds its root with
 * `git rev-parse` and reads a rev with `git show`, and it has to be an insertion
 * because the failure this ticket is about only exists while the cited lines
 * still resolve.
 */
function withInsertionRepo(): {
  dir: string;
  record: string;
  mixed: string;
  legacy: string;
  before: string;
  cleanup: () => void;
} {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "citations-repo-")));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (lines: string[]) =>
    fs.writeFileSync(path.join(dir, "src", "tls.ts"), `${lines.join("\n")}\n`);

  git("init", "-q", "-b", "main");
  git("config", "user.email", "citations@example.test");
  git("config", "user.name", "citations test");
  fs.mkdirSync(path.join(dir, "src"));

  write(CITED_REGION);
  git("add", "-A");
  git("commit", "-qm", "the tree the record was written against");
  const before = git("rev-parse", "HEAD");

  write(INSERTED_ABOVE);
  git("add", "-A");
  git("commit", "-qm", "the fix, which inserted three lines above the cited region");

  // One citation, so the two revs differ in the verdict and nothing else.
  const record = path.join(dir, "drift.md");
  fs.writeFileSync(record, '## Review\n\nThe comment at `src/tls.ts:2-3 "Defence in depth"`.\n');

  // All four states at once, so the summary has something to be wrong about.
  const mixed = path.join(dir, "mixed.md");
  fs.writeFileSync(
    mixed,
    [
      "## Review",
      "",
      'Moved: `src/tls.ts:2-3 "Defence in depth"`.',
      'Still right: `src/tls.ts:7 "export const after"`.',
      "Never checked: `src/tls.ts:1`.",
      "Cannot be right: `src/tls.ts:400`.",
      "",
    ].join("\n"),
  );

  // Nothing but unanchored citations, so the exit code turns on the flag alone
  // and on nothing else in the record.
  const legacy = path.join(dir, "legacy.md");
  fs.writeFileSync(legacy, "## Review\n\nAt `src/tls.ts:1` and at `src/tls.ts:7`.\n");

  return {
    dir,
    record,
    mixed,
    legacy,
    before,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * **Done when 1**, end to end and against a real git tree. One record, one
 * citation, two revs whose only difference is three inserted lines: verified at
 * the first, moved at the second, and the failure names the line the text went
 * to.
 *
 * Before this ticket both runs printed `1/1 resolve` and exited 0, because lines
 * 2 and 3 exist in both trees. That is the whole defect, and it is why the
 * fixture inserts rather than deletes.
 */
test("the CLI tells a citation whose referent moved from one that still points at it", () => {
  const { dir, record, before, cleanup } = withInsertionRepo();

  const atWriting = spawnSync("node", [CLI, record, "--rev", before], {
    cwd: dir,
    encoding: "utf8",
  });
  expect(atWriting.status).toBe(0);
  expect(atWriting.stdout).toMatch(summary(1, 0, 0, 0, 1));
  expect(atWriting.stdout).toMatch(/^ {2}ok /m);

  const atTip = spawnSync("node", [CLI, record, "--rev", "HEAD"], { cwd: dir, encoding: "utf8" });
  expect(atTip.status).toBe(1);
  expect(atTip.stdout).toMatch(summary(0, 1, 0, 0, 1));
  expect(atTip.stdout).toMatch(/^ {2}MOVED /m);
  expect(atTip.stdout).toMatch(/anchor "Defence in depth" is not in 2-3 — it is at 5/);
  expect(atTip.stderr).toMatch(/1 citation\(s\) do not point at what they say/);

  cleanup();
});

/**
 * **Done when 3.** The summary is checked on a record holding all four states at
 * once, because the summary is a separate code path from the per-citation lines
 * and it is where the original defect hid: the builder that found repo-18 judged
 * nine printed lines individually and never read the total, which said 9/9.
 */
test("the summary cannot read N/N while a citation is in the moved state", () => {
  const { dir, mixed, cleanup } = withInsertionRepo();

  const result = spawnSync("node", [CLI, mixed, "--rev", "HEAD"], { cwd: dir, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stdout).toMatch(summary(1, 1, 1, 1, 4));

  // Not merely "the wording changed": no `N/N` of any kind survives anywhere in
  // the output, so there is nothing left that reads as "all of them are fine".
  expect(result.stdout).not.toMatch(SAME_OVER_SAME);

  // And the four states are four distinct marks, not one word with four reasons.
  for (const mark of [/^ {2}ok /m, /^ {2}MOVED /m, /^ {2}unanchored /m, /^ {2}FAIL /m]) {
    expect(result.stdout).toMatch(mark);
  }

  cleanup();
});

/**
 * `--require-anchors`, which the owner asked for over the recommendation to
 * leave it advisory: a branch that wants the stricter standard can opt in, and a
 * later ticket flipping the default finds the machinery built.
 *
 * One record, one tree, two runs. The exit code turns on the flag and on nothing
 * else, which is the only way to show the flag is what did it.
 *
 * The naive version of this test passes against the *unfixed* source for the
 * wrong reason — old code exits 1 on an unrecognised `--require-anchors` with
 * "unknown option", so `expect(status).not.toBe(0)` is green on code that has no
 * flag at all. So the run is asserted to have happened: the summary on stdout,
 * the count named on stderr, and no parse error.
 */
test("--require-anchors makes an unanchored citation fatal, and nothing else does", () => {
  const { dir, legacy, cleanup } = withInsertionRepo();
  const at = (...argv: string[]) =>
    spawnSync("node", [CLI, legacy, ...argv], { cwd: dir, encoding: "utf8" });

  const lenient = at();
  expect(lenient.status).toBe(0);
  expect(lenient.stdout).toMatch(summary(0, 0, 2, 0, 2));
  // The default's whole point: a legacy record still passes, and says nobody
  // looked. `stderr is empty` and `exit 0` still mean the same thing.
  expect(lenient.stderr).toBe("");
  expect(lenient.stdout).toMatch(/carry no anchor text/);

  const strict = at("--require-anchors");
  expect(strict.status).toBe(1);
  // It ran, rather than refusing the argument: same citations, same states, same
  // counts. Without this the assertion above is satisfied by "unknown option".
  expect(strict.stdout).toMatch(summary(0, 0, 2, 0, 2));
  expect(strict.stderr).not.toMatch(/unknown option/);
  expect(strict.stderr).toMatch(/2 citation\(s\) carry no anchor text and --require-anchors/);

  // And the reason is on the line with the numbers, so a CI log says which
  // policy judged them.
  expect(strict.stdout).toMatch(/unresolvable — of 2 citations, anchors required/);
  expect(lenient.stdout).not.toMatch(/anchors required/);

  cleanup();
});

/**
 * The flag is policy, not taxonomy. A citation's state is a fact about the
 * record, so `--require-anchors` must not repaint one: the per-citation lines
 * and every bucket are identical with and without it, and only the exit code and
 * the suffix move. A flag that turned `unanchored` into a fifth failing state
 * would make the same record report differently depending on argv.
 */
test("--require-anchors changes the exit code and not a single citation's state", () => {
  const { dir, mixed, cleanup } = withInsertionRepo();
  const at = (...argv: string[]) =>
    spawnSync("node", [CLI, mixed, "--rev", "HEAD", ...argv], { cwd: dir, encoding: "utf8" });

  const lenient = at();
  const strict = at("--require-anchors");

  expect(marks(strict.stdout)).toEqual(marks(lenient.stdout));
  expect(strict.stdout).toMatch(summary(1, 1, 1, 1, 4));
  expect(lenient.stdout).toMatch(summary(1, 1, 1, 1, 4));

  // Both fail here, because a moved citation was already fatal — so this record
  // cannot show what the flag does, which is why the test above uses one that
  // has nothing but unanchored citations.
  expect(lenient.status).toBe(1);
  expect(strict.status).toBe(1);

  cleanup();
});

/**
 * The flag is not simply "always fail". A record whose citations are all
 * anchored and all correct passes under it, which is the state it is asking
 * records to reach.
 */
test("--require-anchors passes a record that has no unanchored citation", () => {
  const { dir, record, before, cleanup } = withInsertionRepo();

  const result = spawnSync("node", [CLI, record, "--rev", before, "--require-anchors"], {
    cwd: dir,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toMatch(summary(1, 0, 0, 0, 1));

  cleanup();
});

/**
 * Done-when 3 says the docblock usage line, `main()`'s usage string and the
 * flags actually parsed all name the same set — and until now that was checked
 * once, by hand, and nothing would fail if a later edit touched one without the
 * others. This is the gate's own low finding, folded in because it is cheap and
 * ties directly to an acceptance line rather than being general tidying.
 */
// `[a-z]+` stopped at the first hyphen, so it read `--require-anchors` as
// `--require` in all three sources at once and compared them equal without ever
// seeing the flag — the same agreeing-while-wrong shape this file is about.
const flagsIn = (text: string) => [...text.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]).toSorted();

test("the docblock usage line, USAGE, and FLAGS name the same set of flags", () => {
  const source = fs.readFileSync(CLI, "utf8");
  const docblockLine = /^\s*\*\s+node scripts\/citations\.mjs\b.*$/m.exec(source)?.[0];
  expect(docblockLine).toBeDefined();

  expect(flagsIn(docblockLine ?? "")).toEqual(flagsIn(USAGE));
  expect(flagsIn(USAGE)).toEqual([...FLAGS.keys()].toSorted());
});

/**
 * The defect at the level it happens. A flag's value does not look like a flag,
 * so the old `argv.find((a) => !a.startsWith("--"))` could not tell one from the
 * positional argument. Both orders, because only one of them was ever broken and
 * a test that checks the working one proves nothing.
 */
test("parseArgs consumes a flag's value instead of mistaking it for the ticket file", () => {
  const expected = { file: "ticket.md", rev: "HEAD", section: null, requireAnchors: false };
  expect(parseArgs(["--rev", "HEAD", "ticket.md"])).toEqual(expected);
  expect(parseArgs(["ticket.md", "--rev", "HEAD"])).toEqual(expected);
  expect(parseArgs(["ticket.md"])).toEqual({
    file: "ticket.md",
    rev: null,
    section: null,
    requireAnchors: false,
  });
});

/**
 * The same defect read from the other end. `--require-anchors` is the first flag
 * here that takes no value, and a parser that assumed every flag took one would
 * swallow the ticket file as its argument — reproducing repo-14 one flag over,
 * and reported as `ENOENT: ticket.md` if it were reported at all. Both orders,
 * because only one of them can be wrong.
 */
test("parseArgs treats --require-anchors as a flag with no value", () => {
  const expected = { file: "ticket.md", rev: null, section: null, requireAnchors: true };
  expect(parseArgs(["--require-anchors", "ticket.md"])).toEqual(expected);
  expect(parseArgs(["ticket.md", "--require-anchors"])).toEqual(expected);
  // And it composes with a flag that does take one, in any order.
  expect(parseArgs(["--require-anchors", "--rev", "HEAD", "ticket.md"])).toEqual({
    ...expected,
    rev: "HEAD",
  });
  expect(parseArgs(["--rev", "HEAD", "--require-anchors", "ticket.md"])).toEqual({
    ...expected,
    rev: "HEAD",
  });
});

/**
 * Every way an argument can be wrong is loud. The single-dash case is here
 * because `-r HEAD` would otherwise be taken as the ticket file and reproduce
 * this ticket one dash over, reported as `ENOENT: -r`.
 */
test("parseArgs refuses an unknown flag, a valueless flag and a second positional", () => {
  expect(() => parseArgs(["ticket.md", "--nonsense"])).toThrow(/unknown option --nonsense/);
  expect(() => parseArgs(["-r", "HEAD", "ticket.md"])).toThrow(/unknown option -r/);
  expect(() => parseArgs(["ticket.md", "--rev"])).toThrow(/--rev needs a value/);
  expect(() => parseArgs(["a.md", "b.md"])).toThrow(/unexpected argument b\.md/);
  expect(() => parseArgs([])).toThrow(/usage: node scripts\/citations\.mjs/);
  // Each of those prints the usage, because being told what is wrong without
  // being told what is right is half an error message.
  expect(() => parseArgs(["ticket.md", "--nonsense"])).toThrow(/\[--rev <sha>\]/);
});

/**
 * A heading owns everything down to the next heading of the same level or
 * higher. Getting this wrong drops the citations under a subsection while still
 * printing a confident count, which is the failure the whole script exists to
 * prevent.
 */
test("extractSections gives a heading the span of its subsections", () => {
  const md = ["# Top", "a", "## One", "b", "### Under one", "c", "## Two", "d"].join("\n");
  expect(extractSections(md)).toEqual([
    { title: "Top", level: 1, start: 1, end: 8 },
    { title: "One", level: 2, start: 3, end: 6 },
    { title: "Under one", level: 3, start: 5, end: 6 },
    { title: "Two", level: 2, start: 7, end: 8 },
  ]);
});

/**
 * Records quote changelog fragments, so `### Fixes` inside a fence is common —
 * 40 such lines across the work records when this was measured. Taking one for a
 * heading would end the enclosing section early and silently shrink the count.
 */
test("extractSections does not read a heading out of a fenced block", () => {
  const md = ["## Real", "```md", "## Not a heading", "```", "tail"].join("\n");
  expect(extractSections(md)).toEqual([{ title: "Real", level: 2, start: 1, end: 5 }]);
});

test("selectSection matches case-insensitively, preferring an exact hit to a prefix", () => {
  const sections = extractSections(["## Log", "a", "## Logging notes", "b"].join("\n"));
  expect(selectSection(sections, "log").title).toBe("Log");
  expect(selectSection(sections, "LOGGING").title).toBe("Logging notes");
  // Prefix is the fallback, which is what makes an em-dashed heading typeable.
  expect(selectSection(extractSections("### Gate — 2026-09-01"), "Gate").title).toBe(
    "Gate — 2026-09-01",
  );
});

/**
 * Both refusals, and the reason they are refusals rather than an empty result:
 * `0/0` is already what a real but citation-free section prints, so a silent
 * miss would be indistinguishable from a correct answer.
 */
test("selectSection refuses a name that matches nothing, and one that matches two", () => {
  const sections = extractSections(["## Nested", "a", "## Nothing", "b"].join("\n"));
  expect(() => selectSection(sections, "Missing")).toThrow(/no section matches "Missing"/);
  // The refusal lists what is there, so a typo costs one read rather than two.
  expect(() => selectSection(sections, "Missing")).toThrow(/## Nested/);
  expect(() => selectSection(sections, "N")).toThrow(/"N" matches 2 sections/);
});
