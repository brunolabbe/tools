import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  checkCitations,
  extractCitations,
  extractSections,
  makeResolver,
  parseArgs,
  selectSection,
} from "../citations.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO, "scripts", "citations.mjs");

test("finds an inline file:line citation", () => {
  const found = extractCitations("The guard is wrong at `src/a.ts:12`.");
  expect(found).toEqual([{ file: "src/a.ts", start: 12, end: 12, source: "inline", line: 1 }]);
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
  const results = checkCitations(
    [{ file: "a.ts", start: 99, end: 99, source: "inline", line: 1 }],
    () => ["one", "two"],
  );
  expect(results[0]?.ok).toBe(false);
  expect(results[0]?.reason).toBe("line 99 is past end of file (2 lines)");
});

test("returns the cited line's text so a reader can judge the content", () => {
  const results = checkCitations(
    [{ file: "a.ts", start: 2, end: 2, source: "inline", line: 1 }],
    () => ["one", "  const guard = true;", "three"],
  );
  expect(results[0]?.ok).toBe(true);
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
  expect(good.stdout).toMatch(/1\/1 resolve/);

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
    expect(result.stdout).toMatch(/1\/1 resolve/);
  }

  fs.rmSync(dir, { recursive: true, force: true });
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
  expect(all.stdout).toMatch(/4\/4 resolve/);

  // Three, not one: the fenced `## Log` is not a heading. And not four: `## Log`
  // proper is outside the span.
  const review = run(record, "--section", "Review");
  expect(review.status).toBe(0);
  expect(review.stdout).toMatch(/3\/3 resolve/);
  expect(review.stdout).toMatch(/commit-message\.mjs:1/);
  expect(review.stdout).not.toMatch(/citations\.mjs:2/);

  const log = run(record, "--section", "Log");
  expect(log.status).toBe(0);
  expect(log.stdout).toMatch(/1\/1 resolve/);
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
  expect(empty.stdout).toMatch(/0\/0 resolve/);

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
 * The defect at the level it happens. A flag's value does not look like a flag,
 * so the old `argv.find((a) => !a.startsWith("--"))` could not tell one from the
 * positional argument. Both orders, because only one of them was ever broken and
 * a test that checks the working one proves nothing.
 */
test("parseArgs consumes a flag's value instead of mistaking it for the ticket file", () => {
  const expected = { file: "ticket.md", rev: "HEAD", section: null };
  expect(parseArgs(["--rev", "HEAD", "ticket.md"])).toEqual(expected);
  expect(parseArgs(["ticket.md", "--rev", "HEAD"])).toEqual(expected);
  expect(parseArgs(["ticket.md"])).toEqual({ file: "ticket.md", rev: null, section: null });
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
