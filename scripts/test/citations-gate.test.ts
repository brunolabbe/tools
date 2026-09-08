import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { candidateFiles, makeReader, makeResolver } from "../citations.mjs";
import { checkRecord, findRecords, gate, GRANDFATHERED, SCOPE } from "../citations-gate.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO, "scripts", "citations-gate.mjs");

/**
 * A throwaway repository with one source file and whatever records a test asks
 * for, so the gate's own behaviour is asserted against a corpus a test controls
 * rather than against the live one — which changes every time a ticket is gated
 * and would make every count here a moving target.
 */
function withRepo(records: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "citations-gate-")));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };

  git("init", "-q", "-b", "main");
  git("config", "user.email", "gate@example.test");
  git("config", "user.name", "gate test");

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
  for (const [name, body] of Object.entries(records)) {
    fs.mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  git("add", "-A");
  git("commit", "-qm", "the corpus");

  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const checkers = (dir: string) =>
  [makeReader(dir, null), makeResolver(candidateFiles(dir, null))] as const;

const ANCHORED = '## Review\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n';
const BARE = "## Review\n\nProof: `src/tls.ts:2`.\n";

test("a record with no matching section is out of scope rather than an error", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": "# a\n\n## Log\n\nNothing yet.\n" });
  try {
    const [read, resolve] = checkers(dir);
    expect(checkRecord(dir, "docs/work/a.md", "Review", read, resolve)).toMatchObject({
      skipped: true,
    });
  } finally {
    cleanup();
  }
});

test("an anchored citation passes and the same citation without its anchor fails", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED, "docs/work/b.md": BARE });
  try {
    const [read, resolve] = checkers(dir);
    expect(checkRecord(dir, "docs/work/a.md", "Review", read, resolve)).toMatchObject({
      passed: true,
      counts: { verified: 1 },
    });
    const bare = checkRecord(dir, "docs/work/b.md", "Review", read, resolve);
    expect(bare.passed).toBe(false);
    expect(bare.counts).toMatchObject({ unanchored: 1 });
  } finally {
    cleanup();
  }
});

test("citations outside the section are not enforced", () => {
  const record = `${ANCHORED}\n## Log\n\nAn aside at \`src/tls.ts:3\`.\n`;
  const { dir, cleanup } = withRepo({ "docs/work/a.md": record });
  try {
    const [read, resolve] = checkers(dir);
    const result = checkRecord(dir, "docs/work/a.md", "Review", read, resolve);
    expect(result.passed).toBe(true);
    expect(result.total).toBe(1);
  } finally {
    cleanup();
  }
});

test("two sections of the same name are an error, not a silent pick", () => {
  const record = `${ANCHORED}\n## Review\n\nAnd again at \`src/tls.ts:3\`.\n`;
  const { dir, cleanup } = withRepo({ "docs/work/a.md": record });
  try {
    const [read, resolve] = checkers(dir);
    const result = checkRecord(dir, "docs/work/a.md", "Review", read, resolve);
    expect(result.skipped).toBe(false);
    expect(result.error).toMatch(/matches 2 sections/);
  } finally {
    cleanup();
  }
});

test("a grandfathered record is excused and its debt is counted, not hidden", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED, "docs/work/b.md": BARE });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const result = gate(dir, scope, new Set(["docs/work/b.md"]));
    expect(result.failed).toHaveLength(0);
    expect(result.excused.map((r) => r.record)).toEqual(["docs/work/b.md"]);
    expect(result.debt).toEqual({ unanchored: 1 });
    expect(result.staleEntries).toHaveLength(0);
  } finally {
    cleanup();
  }
});

test("a record that is not grandfathered fails the gate", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED, "docs/work/b.md": BARE });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const result = gate(dir, scope, new Set());
    expect(result.failed.map((r) => r.record)).toEqual(["docs/work/b.md"]);
  } finally {
    cleanup();
  }
});

test("a grandfathered record that now passes is reported stale, so the list can only shrink", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const result = gate(dir, scope, new Set(["docs/work/a.md"]));
    expect(result.staleEntries).toEqual([
      { record: "docs/work/a.md", why: "passes this gate now" },
    ]);
  } finally {
    cleanup();
  }
});

test("a grandfathered record the scope no longer reaches is reported stale too", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const result = gate(dir, scope, new Set(["docs/work/gone.md"]));
    expect(result.staleEntries).toEqual([
      { record: "docs/work/gone.md", why: "is no longer a record with a matching section" },
    ]);
  } finally {
    cleanup();
  }
});

test("an untracked record cannot fail the gate", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED });
  try {
    fs.writeFileSync(path.join(dir, "docs", "work", "scratch.md"), BARE);
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    expect(gate(dir, scope, new Set()).failed).toHaveLength(0);
  } finally {
    cleanup();
  }
});

/**
 * The trap the docblock names, asserted rather than described: git's default
 * wildcard spans `/`, so a pathspec that stops at the directory matches nothing
 * and returns a smaller corpus with no error at all.
 */
test("a pathspec that stops at the work directory matches nothing", () => {
  const { dir, cleanup } = withRepo({ "tools/planner/docs/work/pl-1.md": ANCHORED });
  try {
    expect(findRecords(dir, ["tools/*/docs/work"])).toEqual([]);
    expect(findRecords(dir, ["tools/*/docs/work/*.md"])).toEqual([
      "tools/planner/docs/work/pl-1.md",
    ]);
  } finally {
    cleanup();
  }
});

test("the CLI exits non-zero and names the record when a record fails", () => {
  const { dir, cleanup } = withRepo({ "docs/work/b.md": BARE });
  try {
    const result = spawnSync("node", [CLI], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL docs\/work\/b\.md/);
    expect(result.stdout).toMatch(/unanchored/);
    expect(result.stderr).toMatch(/Adding a record to GRANDFATHERED is not the fix/);
  } finally {
    cleanup();
  }
});

test("the CLI rejects an argument rather than ignoring it", () => {
  const result = spawnSync("node", [CLI, "--section", "Log"], { cwd: REPO, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/usage: node scripts\/citations-gate\.mjs/);
});

/**
 * The list is debt, not policy. Every entry has to name a record that exists —
 * a path typo would silently excuse nothing while looking like it excused
 * something, which is the failure mode the stale-entry rule exists to refuse.
 */
test("every grandfathered path is a record this repo actually has", () => {
  const records = new Set(findRecords(REPO, SCOPE.records));
  const missing = [...GRANDFATHERED].filter((record) => !records.has(record));
  expect(missing).toEqual([]);
});
