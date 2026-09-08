import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { candidateFiles, makeReader, makeResolver } from "../citations.mjs";
import {
  checkRecord,
  compareAgainst,
  findRecords,
  GATE_GLOB,
  gate,
  GRANDFATHERED,
  parseGrandfathered,
  SCOPE,
  SELF,
} from "../citations-gate.mjs";

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

/** `git` in a named directory. Module scope because it closes over nothing. */
const gitIn = (dir: string, ...args: string[]) => {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
};

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
 * `gate` alone still cannot see an exact-match entry, and that is a property of
 * the current tree rather than a gap: a count that matches a record's failures
 * is what an entry *means*. The check that catches it is `compareAgainst`, and
 * the two tests are deliberately adjacent so nobody reads this one as the whole
 * answer — an earlier round of this ticket shipped exactly that misreading.
 */
test("gate alone excuses an entry whose number exactly matches the debt", () => {
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

/**
 * The parser has to agree with the constant it is a parser for, or the history
 * comparison is checking a fiction. This is the one assertion that pins a regex
 * over source text to the value that source text evaluates to.
 */
test("parseGrandfathered reproduces this file's own live constant", () => {
  const source = fs.readFileSync(path.join(REPO, SELF), "utf8");
  expect(parseGrandfathered(source)).toEqual(GRANDFATHERED);
});

test("a file with no GRANDFATHERED block parses as null rather than as empty", () => {
  expect(parseGrandfathered("export const SOMETHING = 1;\n")).toBeNull();
});

/**
 * A throwaway repository with two commits, so `compareAgainst` has a real base
 * to read this file's older copy out of.
 *
 * The fixture writes a *stand-in* for `citations-gate.mjs` at the path `SELF`
 * names — the comparison reads a `GRANDFATHERED` literal out of a blob and
 * nothing else, so a file carrying only that literal exercises exactly what is
 * under test without dragging the real module's imports into a temp tree.
 */
function withHistory(before: string | null, after: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "citations-history-")));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (body: string) => {
    fs.mkdirSync(path.join(dir, path.dirname(SELF)), { recursive: true });
    fs.writeFileSync(path.join(dir, SELF), body);
  };

  git("init", "-q", "-b", "main");
  git("config", "user.email", "history@example.test");
  git("config", "user.name", "history test");
  if (before === null) fs.writeFileSync(path.join(dir, "placeholder"), "");
  else write(before);
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  write(after);
  return { dir, base, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const listing = (entries: [string, number][]) =>
  `export const GRANDFATHERED = new Map([\n${entries
    .map(([r, n]) => `  ["${r}", ${n}],`)
    .join("\n")}\n]);\n`;

/**
 * Variant A of the two silencing routes repo-29 reproduced on the live corpus:
 * break a citation in a passing record and append that record at its exact new
 * count. Silent from the current tree; an increase from zero against the base.
 */
test("appending a record to the list is an increase from zero and is caught", () => {
  const { dir, base, cleanup } = withHistory(
    listing([["docs/work/a.md", 3]]),
    listing([
      ["docs/work/a.md", 3],
      ["docs/work/b.md", 1],
    ]),
  );
  try {
    const result = compareAgainst(
      dir,
      base,
      new Map([
        ["docs/work/a.md", 3],
        ["docs/work/b.md", 1],
      ]),
    );
    expect(result.skipped).toBeNull();
    expect(result.raised).toEqual([{ record: "docs/work/b.md", was: 0, now: 1 }]);
  } finally {
    cleanup();
  }
});

/** Variant C: raise an existing entry to absorb a fresh regression. */
test("raising an existing entry is caught", () => {
  const { dir, base, cleanup } = withHistory(
    listing([["docs/work/a.md", 3]]),
    listing([["docs/work/a.md", 4]]),
  );
  try {
    const result = compareAgainst(dir, base, new Map([["docs/work/a.md", 4]]));
    expect(result.raised).toEqual([{ record: "docs/work/a.md", was: 3, now: 4 }]);
  } finally {
    cleanup();
  }
});

/** The ratchet turning the way it is meant to must not fire. */
test("lowering an entry, or dropping it, is not an increase", () => {
  const { dir, base, cleanup } = withHistory(
    listing([
      ["docs/work/a.md", 3],
      ["docs/work/b.md", 2],
    ]),
    listing([["docs/work/a.md", 1]]),
  );
  try {
    expect(compareAgainst(dir, base, new Map([["docs/work/a.md", 1]])).raised).toEqual([]);
  } finally {
    cleanup();
  }
});

/**
 * The bootstrap case, and the reason it is not an escape hatch: it is reported,
 * it is `skipped` rather than a silent pass, and it can only happen against a
 * commit that predates this file — which after this branch merges is history.
 */
test("a base with no copy of this file is reported as skipped, not as clean", () => {
  const { dir, base, cleanup } = withHistory(null, listing([["docs/work/a.md", 1]]));
  try {
    const result = compareAgainst(dir, base, new Map([["docs/work/a.md", 1]]));
    expect(result.skipped).toMatch(/no scripts\/citations-gate\.mjs/);
    expect(result.raised).toEqual([]);
  } finally {
    cleanup();
  }
});

/**
 * The one case that must never be quiet. A ref nobody fetched is a shallow
 * clone, and answering "nothing went up" after comparing against nothing is the
 * failure every refusal in `citations.mjs` exists to prevent.
 */
test("a ref that does not resolve is an error, never a skip", () => {
  const { dir, base, cleanup } = withHistory(
    listing([["docs/work/a.md", 1]]),
    listing([["docs/work/a.md", 1]]),
  );
  try {
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(() => compareAgainst(dir, "no-such-ref", new Map())).toThrow(/no such commit/);
  } finally {
    cleanup();
  }
});

/** A base that has the file but no readable list is an error for the same reason. */
test("a base whose list cannot be read is an error rather than an assumed empty", () => {
  const { dir, base, cleanup } = withHistory(
    "export const NOTHING = 1;\n",
    listing([["docs/work/a.md", 1]]),
  );
  try {
    expect(() => compareAgainst(dir, base, new Map([["docs/work/a.md", 1]]))).toThrow(
      /carries no GRANDFATHERED block/,
    );
  } finally {
    cleanup();
  }
});

/**
 * The reset, which is the bootstrap window reopened rather than a new hole.
 * Delete this file in one commit, re-add it on top with any numbers at all, and
 * the comparison used to take the same "nothing to compare against" path as a
 * genuine first run — reproduced in a scratch repository during repo-29's third
 * gate, where `9999` sailed through with no objection.
 *
 * One `git log` tells the two apart: a base that never had the file is a
 * bootstrap, a base whose history has it is a deletion. Only the first is
 * excused, and this asserts both sides of that.
 */
test("a base that once had this file and lost it is refused, not treated as a bootstrap", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "citations-reset-")));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (body: string) => {
    fs.mkdirSync(path.join(dir, path.dirname(SELF)), { recursive: true });
    fs.writeFileSync(path.join(dir, SELF), body);
  };
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "reset@example.test");
    git("config", "user.name", "reset test");

    write(listing([["docs/work/a.md", 1]]));
    git("add", "-A");
    git("commit", "-qm", "an honest list");
    const honest = git("rev-parse", "HEAD");

    fs.rmSync(path.join(dir, SELF));
    git("add", "-A");
    git("commit", "-qm", "the enforcement file is deleted");
    const deleted = git("rev-parse", "HEAD");

    write(listing([["docs/work/a.md", 9999]]));
    const inflated = new Map([["docs/work/a.md", 9999]]);

    // Against the commit that still has it, the inflation is plainly an increase.
    expect(compareAgainst(dir, honest, inflated).raised).toEqual([
      { record: "docs/work/a.md", was: 1, now: 9999 },
    ]);
    // Against the commit that dropped it, this must refuse rather than excuse.
    // Deletion and rename share one message on purpose — they are one refusal
    // for one reason, and telling them apart would need a second pattern in a
    // second syntax that could drift from the first.
    expect(() => compareAgainst(dir, deleted, inflated)).toThrow(
      /it was deleted, or this one has been renamed/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The shallow branch, against a **real** shallow clone rather than a mock of
 * one. `git log` over a truncated history answers "this file never existed" for
 * a file it simply cannot see, which is the wrong answer arrived at
 * confidently — so that case is refused rather than excused, and this is what
 * proves the refusal is reachable.
 *
 * `--depth` is ignored for a plain local path, so the clone goes through
 * `file://`; without it the clone comes out complete and the test passes for the
 * wrong reason, having asserted nothing about shallowness at all.
 */
test("a shallow clone is refused, because git log cannot answer there", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "citations-shallow-")));
  const src = path.join(root, "src");
  const dst = path.join(root, "dst");
  try {
    fs.mkdirSync(src);
    gitIn(src, "init", "-q", "-b", "main");
    gitIn(src, "config", "user.email", "shallow@example.test");
    gitIn(src, "config", "user.name", "shallow test");
    fs.mkdirSync(path.join(src, path.dirname(SELF)), { recursive: true });
    fs.writeFileSync(path.join(src, SELF), listing([["docs/work/a.md", 1]]));
    gitIn(src, "add", "-A");
    gitIn(src, "commit", "-qm", "with the gate");
    fs.rmSync(path.join(src, SELF));
    gitIn(src, "add", "-A");
    gitIn(src, "commit", "-qm", "and without it");

    const clone = spawnSync("git", ["clone", "--depth", "1", `file://${src}`, dst], {
      encoding: "utf8",
    });
    expect(clone.error).toBeUndefined();
    expect(clone.status).toBe(0);
    // Asserted rather than assumed: if the clone came out complete, everything
    // below would pass while measuring the wrong thing.
    expect(gitIn(dst, "rev-parse", "--is-shallow-repository")).toBe("true");

    expect(() => compareAgainst(dst, "HEAD", new Map())).toThrow(/this clone is shallow/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The rename, which is the same window as the deletion reached in one commit
 * rather than two: rename the gate, repoint `SELF`, and the new path's history
 * is honestly empty, so the probe used to answer "never existed" and excuse the
 * run. Asking about `GATE_GLOB` instead is what closes it — the *old* name still
 * matches.
 *
 * Written from the renamed file's point of view, which is the only one that can
 * be built here: a base carrying a gate under a different matching name, and no
 * `SELF` at all. That is exactly what the renamed copy sees when it looks back.
 */
test("a base carrying a gate under another matching name is a rename, not a bootstrap", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "citations-rename-")));
  try {
    gitIn(dir, "init", "-q", "-b", "main");
    gitIn(dir, "config", "user.email", "rename@example.test");
    gitIn(dir, "config", "user.name", "rename test");
    fs.mkdirSync(path.join(dir, path.dirname(SELF)), { recursive: true });

    // The base has a gate, under a name this copy does not answer to.
    const older = path.join(path.dirname(SELF), "citations-gate-old.mjs");
    expect(older).not.toBe(SELF);
    fs.writeFileSync(path.join(dir, older), listing([["docs/work/a.md", 1]]));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-qm", "a gate under its older name");
    const base = gitIn(dir, "rev-parse", "HEAD");

    expect(() => compareAgainst(dir, base, new Map([["docs/work/a.md", 2]]))).toThrow(
      /has been renamed/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The glob has to match this file and nothing else it could be confused with.
 * A probe that matched the test fixture or a document quoting the declaration
 * would refuse every legitimate first run — which is the failure mode a
 * *content*-based probe has and this one does not.
 */
test("the glob matches this file, and not its test or a record that quotes it", () => {
  const matched = findRecords(REPO, [GATE_GLOB]);
  expect(matched).toEqual([SELF]);
});

test("the CLI rejects --against with no value", () => {
  const result = spawnSync("node", [CLI, "--against"], { cwd: REPO, encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--against needs a value/);
});

/**
 * A run with no `--against` says so on stdout. A comparison that quietly did not
 * happen is worse than not having one, because a CI log then cannot tell "nothing
 * went up" from "nothing was checked".
 */
test("a run with no history says that no history was compared", () => {
  const { dir, cleanup } = withRepo({ "docs/work/a.md": ANCHORED });
  try {
    const result = spawnSync("node", [CLI], { cwd: dir, encoding: "utf8" });
    expect(result.stdout).toMatch(/No history compared/);
  } finally {
    cleanup();
  }
});
