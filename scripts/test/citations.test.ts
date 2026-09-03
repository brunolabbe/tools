import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { checkCitations, extractCitations, makeResolver, parseArgs } from "../citations.mjs";

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
 * `--section` is repo-14's open question — implement it or drop it — and this
 * branch settles neither. What it settles is that the flag stops lying: still
 * accepted, still does nothing, and now says so on stderr. The byte-identical
 * stdout is the ticket's own reproduction, kept deliberately and announced
 * instead of silent. Asserted so that either resolution has to come through this
 * test rather than past it.
 */
test("the CLI says --section did nothing rather than filtering silently", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "citations-"));
  const record = path.join(dir, "ticket.md");
  fs.writeFileSync(record, "## Review\n\nFine at `scripts/citations.mjs:1`.\n");

  const plain = spawnSync("node", [CLI, record], { cwd: REPO, encoding: "utf8" });
  const scoped = spawnSync("node", [CLI, "--section", "Log", record], {
    cwd: REPO,
    encoding: "utf8",
  });

  expect(plain.stderr).toBe("");
  expect(scoped.status).toBe(0);
  expect(scoped.stdout).toBe(plain.stdout);
  expect(scoped.stderr).toMatch(/--section is not implemented/);
  expect(scoped.stderr).toMatch(/Nothing was filtered/);

  fs.rmSync(dir, { recursive: true, force: true });
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
