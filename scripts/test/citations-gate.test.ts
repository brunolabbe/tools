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
    const result = gate(dir, scope, new Map([["docs/work/b.md", 1]]));
    expect(result.failed).toHaveLength(0);
    expect(result.regressed).toHaveLength(0);
    expect(result.excused.map((r) => r.record)).toEqual(["docs/work/b.md"]);
    expect(result.debt).toEqual({ unanchored: 1 });
    expect(result.staleEntries).toHaveLength(0);
  } finally {
    cleanup();
  }
});

/**
 * The ratchet, and the hole it closes. Before the list carried counts, breaking
 * a record and adding it to the list in the same change gave exit 0 in silence —
 * reproduced against the real corpus in repo-29's Log, and this is that shape
 * with two records in it. An entry has to name a number somebody wrote down, so
 * a record that got worse exceeds it and cannot hide behind a fresh line.
 */
test("a grandfathered record holding more than its entry allows fails", () => {
  const two = "## Review\n\nBoth bare: `src/tls.ts:2` and `src/tls.ts:3`.\n";
  const { dir, cleanup } = withRepo({ "docs/work/b.md": two });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const result = gate(dir, scope, new Map([["docs/work/b.md", 1]]));
    expect(result.excused).toHaveLength(0);
    expect(result.regressed.map((r) => [r.record, r.failing, r.allowed])).toEqual([
      ["docs/work/b.md", 2, 1],
    ]);
  } finally {
    cleanup();
  }
});

/**
 * The other jaw. A record repaired part-way holds less debt than its number
 * claims, and the number has to come down in the same change — otherwise the
 * list drifts loose and stops meaning anything, which is repo-25's
 * stale-declaration rule generalised from "excuses nothing" to "excuses more
 * than it needs to".
 */
test("a grandfathered record holding less than its entry allows must be tightened", () => {
  const { dir, cleanup } = withRepo({ "docs/work/b.md": BARE });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const result = gate(dir, scope, new Map([["docs/work/b.md", 5]]));
    expect(result.excused.map((r) => r.record)).toEqual(["docs/work/b.md"]);
    expect(result.staleEntries).toEqual([
      {
        record: "docs/work/b.md",
        why: "now holds 1 failing reference(s), not 5 — tighten the number",
      },
    ]);
  } finally {
    cleanup();
  }
});

/**
 * repo-29 finding 3, at the gate rather than at the checker. `citations.mjs`
 * calls a non-distinct anchor `verified` because the state is a fact about the
 * record; the policy that it is not good enough lives here, which is the same
 * split `unanchored` already uses.
 */
test("an anchor that is not unique in its target fails the gate although it is verified", () => {
  const record = '## Review\n\nProof: `src/tls.ts:2 "depth"`.\n';
  const { dir, cleanup } = withRepo({ "docs/work/a.md": record });
  try {
    const [read, resolve] = checkers(dir);
    // Two lines of the fixture carry the word, so the fragment cannot say which.
    fs.writeFileSync(
      path.join(dir, "src", "tls.ts"),
      ["// depth", "  // Defence in depth: the store is pinned.", "return true;", ""].join("\n"),
    );
    const result = checkRecord(dir, "docs/work/a.md", "Review", read, resolve);
    expect(result.counts).toMatchObject({ verified: 1, indistinct: 1 });
    expect(result.passed).toBe(false);
    expect(result.failing).toBe(1);

    const lax = checkRecord(dir, "docs/work/a.md", "Review", read, resolve, false);
    expect(lax.passed).toBe(true);
    expect(lax.failing).toBe(0);
  } finally {
    cleanup();
  }
});

test("a record that is not grandfathered fails the gate", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED, "docs/work/b.md": BARE });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const result = gate(dir, scope, new Map());
    expect(result.failed.map((r) => r.record)).toEqual(["docs/work/b.md"]);
  } finally {
    cleanup();
  }
});

test("a grandfathered record that now passes is reported stale, so the list can only shrink", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const result = gate(dir, scope, new Map([["docs/work/a.md", 1]]));
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
    const result = gate(dir, scope, new Map([["docs/work/gone.md", 1]]));
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
    expect(gate(dir, scope, new Map()).failed).toHaveLength(0);
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
    expect(result.stdout).toMatch(/FAIL\s+docs\/work\/b\.md/);
    expect(result.stdout).toMatch(/unanchored/);
    expect(result.stderr).toMatch(/occur only once in that file/);
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
  const missing = [...GRANDFATHERED.keys()].filter((record) => !records.has(record));
  expect(missing).toEqual([]);
});

/**
 * An entry allowing zero failures excuses nothing and would sit there for ever
 * looking like it excused something — the rubber stamp this list is shaped to
 * refuse. The gate reports such a record `STALE` at runtime; this catches it
 * without waiting for a run over the whole corpus.
 */
test("no grandfathered entry allows zero failures", () => {
  expect([...GRANDFATHERED].filter(([, allowed]) => allowed < 1)).toEqual([]);
});

/**
 * The residual, pinned so it cannot be rediscovered as a surprise or removed as
 * a bug. `STALE` fires on `failing < allowed` and `WORSE` on `failing >
 * allowed`; an exact match is excused, which means a number that is exactly
 * right silences a fresh regression permanently.
 *
 * That is not closable here — this reads the checkout and never the history, and
 * `ci.yml`'s `check` job takes a depth-1 clone, so there is no previous value of
 * a number to compare against. What the count buys is a legible diff rather than
 * a machine guarantee, and repo-29's Log carries the open question of whether to
 * spend anything further on it. The assertion below is that disclosure in
 * executable form.
 */
test("an entry whose number exactly matches the debt is silent, which is the residual", () => {
  const { dir, cleanup } = withRepo({ "docs/work/b.md": BARE });
  try {
    const scope = { records: ["docs/work/*.md"], section: "Review" };
    const exact = gate(dir, scope, new Map([["docs/work/b.md", 1]]));
    expect(exact.failed).toHaveLength(0);
    expect(exact.regressed).toHaveLength(0);
    expect(exact.staleEntries).toHaveLength(0);

    // One either side of it, so the test says where the silence begins and ends.
    expect(gate(dir, scope, new Map([["docs/work/b.md", 0]])).regressed).toHaveLength(1);
    expect(gate(dir, scope, new Map([["docs/work/b.md", 2]])).staleEntries).toHaveLength(1);
  } finally {
    cleanup();
  }
});
