/**
 * repo-51's guards, one test per failure mode, each watched failing against a
 * build with the corresponding check removed — the same discipline
 * `next-id.test.ts` and `citations-gate.test.ts` both explain in their own
 * opening comments and this file borrows rather than re-argues.
 *
 * Two layers, for the same reason `next-id.test.ts` splits them:
 *
 *   - **real temporary git repositories** for everything a check actually has
 *     an opinion about — a citation whose target line moved, a `done` ticket
 *     with no `## Review`, a title over the wrong paths, two branches that
 *     conflict on a file. Faking these would mean re-implementing the very
 *     logic (`citations-gate.mjs`'s corpus scan, `commit-message.mjs`'s
 *     convention, real `git merge-tree`) the check exists to defer to.
 *   - **an injected `run`** only where the real command is expensive or
 *     environment-dependent and the check's *own* logic is what is under
 *     test — check 1's `npm run check` / `npm test` cannot run against a
 *     throwaway repository with no `node_modules`, so its planted failure is
 *     a stubbed exit rather than a real one. That is a narrower claim than
 *     the other four checks make about themselves, and is called out here
 *     rather than left to look like the same kind of proof.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { expect, test } from "vitest";
import {
  EXIT,
  checkBuild,
  checkCitations,
  checkMergeTree,
  checkReview,
  checkTitle,
  isTicketPath,
  mergeTreeConflicts,
  parseArgs,
  parseMergeTreeConflicts,
  preflight,
  sharedConfigTouched,
  testPlan,
  touchedTools,
} from "../preflight.mjs";

const CLI = path.join(import.meta.dirname, "..", "preflight.mjs");

/**
 * A throwaway repository this file controls end to end, the way
 * `citations-gate.test.ts`'s `withRepo` does — a corpus a test can move is the
 * only kind these checks can be proven against, since the live corpus changes
 * every time a ticket is gated.
 */
function makeRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-")));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "preflight@example.test");
  git("config", "user.name", "preflight test");

  const write = (file: string, content: string) => {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  const commitAll = (message: string) => {
    git("add", "-A");
    git("commit", "-qm", message);
  };
  return {
    dir,
    git,
    write,
    commitAll,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const TLS = [
  "export function verify() {",
  "  // Defence in depth: the store is pinned.",
  "  return true;",
  "}",
  "",
].join("\n");
const TLS_SHIFTED = ["// inserted", ...TLS.split("\n")].join("\n");
const ANCHORED_REVIEW = '## Review\n\nProof: `src/tls.ts:2 "Defence in depth"`.\n';

// --- pure helpers -----------------------------------------------------------

test("touchedTools reads tool names from the diff's own paths, not a flag", () => {
  expect(
    touchedTools([
      "tools/downloader/api/src/x.ts",
      "tools/planner/web/src/y.tsx",
      "docs/work/repo-1-a.md",
    ]),
  ).toEqual(["downloader", "planner"]);
  expect(touchedTools(["docs/work/repo-1-a.md"])).toEqual([]);
});

test("sharedConfigTouched fires on packages/ and the named root config, not on a tool's own files", () => {
  expect(sharedConfigTouched(["packages/core/src/a.ts"])).toBe(true);
  expect(sharedConfigTouched(["vitest.config.ts"])).toBe(true);
  expect(sharedConfigTouched(["tools/downloader/api/src/a.ts"])).toBe(false);
});

test("testPlan runs the full suite when shared config moved, one project per tool otherwise", () => {
  expect(testPlan(["tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "downloader"]],
  ]);
  expect(testPlan(["packages/core/src/a.ts", "tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test"]],
  ]);
  expect(testPlan(["docs/work/repo-1-a.md"])).toEqual([["npm", ["run", "check"]]]);
});

test("isTicketPath matches both ticket roots and nothing outside them", () => {
  expect(isTicketPath("docs/work/repo-1-a.md")).toBe(true);
  expect(isTicketPath("tools/downloader/docs/work/dl-1-a.md")).toBe(true);
  expect(isTicketPath("tools/downloader/README.md")).toBe(false);
  expect(isTicketPath("docs/adr/003-x.md")).toBe(false);
});

test("parseMergeTreeConflicts reads one conflicting path off the stage lines, deduped", () => {
  const output = [
    "d4a744080ef2c8f43f5213d9ff7ece1bc949eed6",
    "100644 a29bdeb434d874c9b1d8969c40c42161b03fafdc 1\tf.txt",
    "100644 f15d4b4a143c164b5e380b8e413e7f5da2f82c7f 2\tf.txt",
    "100644 1863db64041218d96066fab7f65d83ebd05af45e 3\tf.txt",
    "",
    "Auto-merging f.txt",
    "CONFLICT (content): Merge conflict in f.txt",
  ].join("\n");
  expect(parseMergeTreeConflicts(output)).toEqual(["f.txt"]);
});

test("parseMergeTreeConflicts reads a clean merge's single line as no conflicts", () => {
  expect(parseMergeTreeConflicts("f10fbf81d15839e7ce6c281530bb22a9f47ccf98")).toEqual([]);
});

// --- check 1: build and suites (injected run — see file header) ------------

/** A `run` stub with nothing to close over — module scope per oxlint's own rule. */
function recordingRun(calls: string[]) {
  return (command: string, args: string[]) => {
    calls.push(`${command} ${args.join(" ")}`);
    return "";
  };
}

/** `npm run check` succeeds; any `npm test` invocation fails. */
function failingTestRun(_command: string, args: string[]) {
  if (args[0] === "run") return "";
  throw new Error("2 tests failed");
}

test("checkBuild runs check plus one project per touched tool and sets no bit when all succeed", () => {
  const calls: string[] = [];
  const result = checkBuild("/repo", ["tools/downloader/api/src/a.ts"], recordingRun(calls));
  expect(result).toMatchObject({ ok: true, bit: 0 });
  expect(calls).toEqual(["npm run check", "npm test -- --project downloader"]);
});

test("checkBuild stops at the first failing command and sets the check bit", () => {
  const result = checkBuild("/repo", ["tools/downloader/api/src/a.ts"], failingTestRun);
  expect(result.ok).toBe(false);
  expect(result.bit).toBe(EXIT.check);
  expect(result.lines.some((l) => l.startsWith("FAIL"))).toBe(true);
});

// --- check 2: citations gate, planted against a real fixture ---------------

test("checkCitations exits 0 over a clean corpus", () => {
  const repo = makeRepo();
  try {
    repo.write("src/tls.ts", TLS);
    repo.write("docs/work/a.md", ANCHORED_REVIEW);
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");

    const result = checkCitations(repo.dir, base, new Map());
    expect(result).toMatchObject({ ok: true, bit: 0 });
  } finally {
    repo.cleanup();
  }
});

/**
 * Done when's first planted failure: a moved citation in a merged record.
 * `ANCHORED_REVIEW` is merged at `base`; the branch's own change shifts the
 * cited line without touching the citation, the same reproduction
 * `citations-gate.test.ts` uses for the `moved` state.
 */
test("checkCitations fails and names the record when a merged citation's target line moves", () => {
  const repo = makeRepo();
  try {
    repo.write("src/tls.ts", TLS);
    repo.write("docs/work/a.md", ANCHORED_REVIEW);
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");

    repo.write("src/tls.ts", TLS_SHIFTED);
    repo.commitAll("shift the cited line");

    const result = checkCitations(repo.dir, base, new Map());
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.citations);
    expect(result.lines.join("\n")).toMatch(/docs\/work\/a\.md/);
  } finally {
    repo.cleanup();
  }
});

// --- check 3: the `## Review` presence test ---------------------------------

const DONE_NO_REVIEW = "---\nid: x-1\nstatus: done\n---\n\n# x-1\n\n## Log\n\nDone.\n";
const DONE_WITH_REVIEW =
  "---\nid: x-1\nstatus: done\n---\n\n# x-1\n\n## Review\n\nLGTM.\n\n## Log\n\nDone.\n";
const READY_NO_REVIEW = "---\nid: x-1\nstatus: ready\n---\n\n# x-1\n\n## Log\n\nNot yet.\n";

/** Done when's second planted failure: a `done` ticket with no record. */
test("checkReview fails and names a ticket this branch marks done with no ## Review section", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("base");
    repo.write("docs/work/x-1.md", DONE_NO_REVIEW);
    repo.commitAll("close the ticket");

    const result = checkReview(repo.dir, ["docs/work/x-1.md"]);
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.review);
    expect(result.lines.join("\n")).toMatch(/x-1\.md is marked done but has no ## Review/);
  } finally {
    repo.cleanup();
  }
});

test("checkReview passes a done ticket that carries its own Review section", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", DONE_WITH_REVIEW);
    repo.commitAll("close the ticket, gated");

    const result = checkReview(repo.dir, ["docs/work/x-1.md"]);
    expect(result).toMatchObject({ ok: true, bit: 0 });
  } finally {
    repo.cleanup();
  }
});

test("checkReview does not check a ticket this branch has not marked done", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", READY_NO_REVIEW);
    repo.commitAll("touch it, still open");

    const result = checkReview(repo.dir, ["docs/work/x-1.md"]);
    expect(result).toMatchObject({ ok: true, bit: 0 });
  } finally {
    repo.cleanup();
  }
});

// --- check 4: the title's type against its paths ----------------------------

const RP_CONFIG = JSON.stringify({
  "changelog-sections": [
    { type: "feat", section: "Features" },
    { type: "fix", section: "Fixes" },
    { type: "chore", section: "Chores", hidden: true },
  ],
});

function makeTitleRepo() {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, "release-please-config.json"), RP_CONFIG);
  fs.mkdirSync(path.join(repo.dir, "tools", "downloader"), { recursive: true });
  repo.commitAll("seed the title fixture");
  return repo;
}

/** Done when's third planted failure: a feat title over markdown-only tools/ paths. */
test("checkTitle fails a changelog-worthy type whose only tools/ path is markdown", () => {
  const repo = makeTitleRepo();
  try {
    const result = checkTitle(
      repo.dir,
      ["tools/downloader/docs/work/dl-1-a.md"],
      "feat(downloader): document a thing",
    );
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.title);
    expect(result.lines.join("\n")).toMatch(/markdown/);
  } finally {
    repo.cleanup();
  }
});

test("checkTitle passes the same type when a tools/ path is not markdown", () => {
  const repo = makeTitleRepo();
  try {
    const result = checkTitle(
      repo.dir,
      ["tools/downloader/api/src/a.ts", "tools/downloader/docs/work/dl-1-a.md"],
      "feat(downloader): add a thing",
    );
    expect(result).toMatchObject({ ok: true, bit: 0 });
  } finally {
    repo.cleanup();
  }
});

test("checkTitle passes a hidden type over markdown-only paths, since no changelog is cut", () => {
  const repo = makeTitleRepo();
  try {
    const result = checkTitle(
      repo.dir,
      ["tools/downloader/docs/work/dl-1-a.md"],
      "chore(downloader): file a ticket",
    );
    expect(result).toMatchObject({ ok: true, bit: 0 });
    expect(result.lines.join("\n")).toMatch(/hidden/);
  } finally {
    repo.cleanup();
  }
});

test("checkTitle fails outright on a title commit-message.mjs's own convention rejects", () => {
  const repo = makeTitleRepo();
  try {
    const result = checkTitle(repo.dir, [], "Fixed a thing.");
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.title);
  } finally {
    repo.cleanup();
  }
});

// --- check 5: merge-tree against every other open pull request head --------

/**
 * Done when's fourth planted failure: a gate record two open heads both edit.
 * `main` is the shared base; `a` and `b` each rewrite `docs/work/x-1.md`'s
 * `## Review` section, so `a`'s own preflight sees `b` as a conflicting head.
 */
test("checkMergeTree fails and names the gate record two open heads both edit", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.commitAll("base");

    repo.git("checkout", "-q", "-b", "a");
    repo.write("docs/work/x-1.md", "## Review\n\nSecond pass, from a.\n");
    repo.commitAll("gate on a");

    repo.git("checkout", "-q", "main");
    repo.git("checkout", "-q", "-b", "b");
    repo.write("docs/work/x-1.md", "## Review\n\nSecond pass, from b.\n");
    repo.commitAll("gate on b");

    repo.git("checkout", "-q", "a");
    const result = checkMergeTree(repo.dir, {
      listOpenHeads: () => [{ number: 7, headRefName: "b", ref: "b" }],
    });
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.mergeTree);
    expect(result.lines.join("\n")).toMatch(/docs\/work\/x-1\.md/);
    expect(result.lines.join("\n")).toMatch(/gate record/);
  } finally {
    repo.cleanup();
  }
});

/**
 * The positive control repo-51's Done when names by name: a run that finds no
 * conflict still says so explicitly, so an empty pull request list cannot be
 * mistaken for the same "clean" result. Two separate messages, asserted
 * separately, or the zero-heads case could silently stand in for this one.
 */
test("checkMergeTree passes and says so when the other open head does not conflict", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.write("other.md", "untouched\n");
    repo.commitAll("base");

    repo.git("checkout", "-q", "-b", "a");
    repo.write("docs/work/x-1.md", "## Review\n\nSecond pass, from a.\n");
    repo.commitAll("gate on a");

    repo.git("checkout", "-q", "main");
    repo.git("checkout", "-q", "-b", "b");
    repo.write("other.md", "changed by b, a different file entirely\n");
    repo.commitAll("edit on b");

    repo.git("checkout", "-q", "a");
    const result = checkMergeTree(repo.dir, {
      listOpenHeads: () => [{ number: 7, headRefName: "b", ref: "b" }],
    });
    expect(result).toMatchObject({ ok: true, bit: 0 });
    expect(result.lines.join("\n")).toMatch(/no conflicts with any other open pull request head/);
  } finally {
    repo.cleanup();
  }
});

test("checkMergeTree says explicitly that an empty pull request list checked nothing", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.commitAll("base");

    const result = checkMergeTree(repo.dir, { listOpenHeads: () => [] });
    expect(result).toMatchObject({ ok: true, bit: 0 });
    expect(result.lines.join("\n")).toMatch(/nothing was checked/);
  } finally {
    repo.cleanup();
  }
});

test("checkMergeTree excludes the current branch's own pull request from the comparison", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.commitAll("base");
    repo.git("checkout", "-q", "-b", "mine");
    repo.write("docs/work/x-1.md", "## Review\n\nMy own pass.\n");
    repo.commitAll("gate on mine");

    const result = checkMergeTree(repo.dir, {
      listOpenHeads: () => [{ number: 1, headRefName: "mine", ref: "mine" }],
    });
    expect(result.lines[0]).toMatch(/against 0 other open pull request head/);
  } finally {
    repo.cleanup();
  }
});

test("mergeTreeConflicts reports a real git failure rather than treating it as a conflict", () => {
  const repo = makeRepo();
  try {
    repo.write("f.txt", "seed\n");
    repo.commitAll("base");
    expect(() => mergeTreeConflicts(repo.dir, "HEAD", "no-such-ref")).toThrow(/exited/);
  } finally {
    repo.cleanup();
  }
});

/**
 * `npm run check` / `npm test` stubbed out — a throwaway fixture repo has no
 * `node_modules` to run either against — every other command spawned for
 * real, so the four checks that do have an opinion run it.
 */
function realGitStubbedNpm(command: string, args: string[], options: { cwd?: string } = {}) {
  if (command === "npm") return "";
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

// --- the whole pipeline ------------------------------------------------------

/**
 * Done when's positive case: a clean branch exits 0 across every check. Check
 * 1 is stubbed per the file header; the other four run for real against one
 * fixture that satisfies all of them at once.
 */
test("preflight sets no bit at all on a clean branch", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, "release-please-config.json"), RP_CONFIG);
  fs.mkdirSync(path.join(repo.dir, "tools", "downloader"), { recursive: true });
  try {
    repo.write("src/tls.ts", TLS);
    repo.write("docs/work/a.md", ANCHORED_REVIEW);
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");

    repo.write("docs/work/x-2.md", DONE_WITH_REVIEW);
    repo.commitAll("fix(downloader): close x-2 cleanly");

    const results = preflight(repo.dir, {
      base,
      run: realGitStubbedNpm,
      grandfathered: new Map(),
      listOpenHeads: () => [],
    });
    const bitmask = results.reduce((mask, r) => mask | r.bit, 0);
    expect(bitmask).toBe(0);
    expect(results.every((r) => r.ok)).toBe(true);
  } finally {
    repo.cleanup();
  }
});

// --- the CLI's own usage guard, spawned for real ----------------------------

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("the CLI demands --base and exits outside the check bitmask", () => {
  const result = cli([]);
  expect(result.status).toBe(EXIT.setup);
  expect(result.stderr).toMatch(/--base is required/);
});

test("parseArgs rejects an option with no value", () => {
  expect(() => parseArgs(["--base"])).toThrow(/--base needs a value/);
});
