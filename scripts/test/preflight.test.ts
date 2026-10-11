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
  CI_WORKFLOW_PATH,
  EXIT,
  checkBuild,
  checkCiCommands,
  checkMergeTree,
  checkReview,
  checkTitle,
  deriveExtraCiCommands,
  extractCheckJobCommands,
  isTicketPath,
  mergeTreeConflicts,
  parseArgs,
  parseMergeTreeConflicts,
  assertSpawnable,
  tokenize,
  preflight,
  runBuildCommand,
  scriptsTouched,
  sharedConfigTouched,
  testPlan,
  touchedTools,
} from "../preflight.mjs";

const CLI = path.join(import.meta.dirname, "..", "preflight.mjs");

/** This checkout's own root, so repo-79's new checks can be measured against its real ci.yml. */
const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const REAL_CI_YAML = fs.readFileSync(
  path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
  "utf8",
);

/**
 * A throwaway repository this file controls end to end, the way
 * `citations-gate.test.ts`'s `withRepo` does — a corpus a test can move is the
 * only kind these checks can be proven against, since the live corpus changes
 * every time a ticket is gated.
 */
function makeRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-")));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", shell: false });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "preflight@example.test");
  git("config", "user.name", "preflight test");
  fs.writeFileSync(path.join(dir, ".gitattributes"), "* text=auto eol=lf\n");
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

test("sharedConfigTouched matches any root tsconfig*.json, never a tool's own nested one", () => {
  expect(sharedConfigTouched(["tsconfig.json"])).toBe(true);
  expect(sharedConfigTouched(["tsconfig.tests.json"])).toBe(true);
  expect(sharedConfigTouched(["tsconfig.new-surface.json"])).toBe(true);
  expect(sharedConfigTouched(["tools/downloader/api/tsconfig.json"])).toBe(false);
});

/** Round 2's third med finding: a `scripts/`-only branch ran no suite at all. */
test("scriptsTouched fires on scripts/ and its own scripts/test/ subtree", () => {
  expect(scriptsTouched(["scripts/preflight.mjs"])).toBe(true);
  expect(scriptsTouched(["scripts/test/preflight.test.ts"])).toBe(true);
  expect(scriptsTouched(["tools/downloader/api/src/a.ts"])).toBe(false);
});

test("testPlan runs the repo project on scripts/, the full suite on shared config, one project per tool otherwise", () => {
  // `core` follows any code change since repo-90; the scripts/-only plan is the
  // first test appended at the end of this file, so these rows stay where they were.
  expect(testPlan(["tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "downloader"]],
    ["npm", ["test", "--", "--project", "core"]],
  ]);
  expect(testPlan(["packages/core/src/a.ts", "tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test"]],
  ]);
  expect(testPlan(["docs/work/repo-1-a.md"])).toEqual([["npm", ["run", "check"]]]);
  expect(testPlan(["scripts/preflight.mjs", "tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "repo"]],
    ["npm", ["test", "--", "--project", "downloader"]],
    ["npm", ["test", "--", "--project", "core"]],
  ]);
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

/**
 * Round 2's fifth med finding: a failing build command used to print
 * `runCommand`'s own message, written for `next-id.mjs`'s guard against a
 * truncated id sweep, and nothing about what actually broke — because
 * `runCommand` keeps only the first three lines of *stderr*, where oxlint,
 * oxfmt and vitest all report on stdout.
 */
test("runBuildCommand surfaces combined output on failure and never next-id.mjs's own wording", () => {
  expect(() =>
    runBuildCommand(process.execPath, ["-e", "console.log('from stdout'); process.exitCode = 1"]),
  ).toThrow(/from stdout/);
  expect(() =>
    runBuildCommand(process.execPath, ["-e", "console.log('from stdout'); process.exitCode = 1"]),
  ).not.toThrow(/partial file list/);
});

test("runBuildCommand keeps only the last 40 lines of a long failure", () => {
  // `process.exitCode`, not `process.exit(1)`: a child that exits explicitly can
  // end before its piped stdout drains, and under load this test then saw
  // "line 175" as the last line of 200 (measured once in six preflight runs
  // on 2026-09-20). Letting the process end on its own flushes the pipe.
  const script = "for (let i = 0; i < 200; i++) console.log('line ' + i); process.exitCode = 1;";
  let message = "";
  try {
    runBuildCommand(process.execPath, ["-e", script]);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toMatch(/line 199/);
  expect(message).not.toMatch(/line 0\n/);
  expect(message.split("\n").length).toBeLessThanOrEqual(41); // 40 lines + the "exited N" header
});

test("runBuildCommand returns combined output when the command succeeds", () => {
  const out = runBuildCommand(process.execPath, ["-e", "console.log('ok')"]);
  expect(out).toMatch(/ok/);
});

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
  expect(calls.slice(0, 2)).toEqual(["npm run check", "npm test -- --project downloader"]);
});

test("checkBuild stops at the first failing command and sets the check bit", () => {
  const result = checkBuild("/repo", ["tools/downloader/api/src/a.ts"], failingTestRun);
  expect(result.ok).toBe(false);
  expect(result.bit).toBe(EXIT.check);
  expect(result.lines.some((l) => l.startsWith("FAIL"))).toBe(true);
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

/**
 * Round 2's fourth med finding: `validate`'s own `BYPASS` lets a merge subject
 * through with `ok: true` and no type at all, and this branch's own default
 * title source is the branch's last commit subject — so a branch whose tip is
 * a merge commit used to print `ok "undefined" is hidden …` and pass with no
 * type-versus-paths check at all, silently.
 */
/**
 * Round 3's med finding: round 2's fix keyed on `type === undefined`, which
 * only ever catches `Merge ` and `Revert "` — both start uppercase, so
 * `/^[a-z]+/` extracts nothing. `fixup! `, `squash! ` and `amend! ` are
 * lowercase and the regex happily reads a word out of each, none of them a
 * real type. All five of `commit-message.mjs`'s own `BYPASS` forms are tested
 * here, not only the one round 2 measured, which is exactly why round 2's
 * suite stayed green over the gap.
 */
test.each([
  "Merge branch 'main' into work",
  'Revert "feat(downloader): add a thing"',
  "fixup! feat(downloader): document a thing (dl-1)",
  "squash! feat(downloader): document a thing (dl-1)",
  "amend! feat(downloader): document a thing (dl-1)",
])("checkTitle fails a subject commit-message.mjs bypasses: %s", (subject) => {
  const repo = makeTitleRepo();
  try {
    const result = checkTitle(repo.dir, ["tools/downloader/docs/work/dl-1-a.md"], subject);
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.title);
    expect(result.lines.join("\n")).toMatch(/no conventional subject found/);
    expect(result.lines.join("\n")).not.toMatch(/undefined/);
    expect(result.lines.join("\n")).not.toMatch(/is hidden in release-please-config/);
  } finally {
    repo.cleanup();
  }
});

// --- check 5: merge-tree against every other open pull request head --------

/**
 * Done when's fourth planted failure: a gate record two open heads both edit.
 * `main` is the shared base; `a` and `b` each rewrite `docs/work/x-1.md`'s
 * `## Review` section, so `a`'s own preflight sees `b` as a conflicting head.
 * Compared by oid — round 2's fix — not by branch name.
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
    const oidB = repo.git("rev-parse", "b");

    repo.git("checkout", "-q", "a");
    const result = checkMergeTree(repo.dir, {
      listOpenHeads: () => [{ number: 7, headRefName: "b", oid: oidB }],
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
    const oidB = repo.git("rev-parse", "b");

    repo.git("checkout", "-q", "a");
    const result = checkMergeTree(repo.dir, {
      listOpenHeads: () => [{ number: 7, headRefName: "b", oid: oidB }],
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

/**
 * Round 2's med finding 1, reproduced and now closed: comparing against
 * `origin/<headRefName>` went stale the moment a peer pushed since this
 * checkout last fetched. `refs/remotes/origin/b` is deliberately pointed at
 * `main` here — as stale as a ref can be — while `listOpenHeads` reports `b`'s
 * real, conflicting oid. `checkMergeTree` must still catch the conflict,
 * because it never reads the ref at all.
 */
test("checkMergeTree compares the head's own oid and ignores a stale remote-tracking ref of the same name", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.commitAll("base");
    const mainOid = repo.git("rev-parse", "main");

    repo.git("checkout", "-q", "-b", "a");
    repo.write("docs/work/x-1.md", "## Review\n\nSecond pass, from a.\n");
    repo.commitAll("gate on a");

    repo.git("checkout", "-q", "main");
    repo.git("checkout", "-q", "-b", "b");
    repo.write("docs/work/x-1.md", "## Review\n\nSecond pass, from b.\n");
    repo.commitAll("gate on b");
    const oidB = repo.git("rev-parse", "b");

    // A stale local mirror of `b` — as if this checkout fetched before `b`'s
    // gating commit was pushed, and never fetched again.
    repo.git("update-ref", "refs/remotes/origin/b", mainOid);

    repo.git("checkout", "-q", "a");
    const result = checkMergeTree(repo.dir, {
      listOpenHeads: () => [{ number: 7, headRefName: "b", oid: oidB }],
    });
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.mergeTree);
    expect(result.lines.join("\n")).toMatch(/docs\/work\/x-1\.md/);
  } finally {
    repo.cleanup();
  }
});

/**
 * Round 2's low finding 6, reproduced and now closed: excluding "this
 * branch's own pull request" used to compare `git rev-parse --abbrev-ref
 * HEAD` — the literal string `HEAD` in a detached worktree — against a branch
 * name, so it never matched there. Comparing oids has no detached state to
 * get wrong.
 */
test("checkMergeTree excludes the current branch's own pull request even in a detached HEAD", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.commitAll("base");
    repo.git("checkout", "-q", "-b", "mine");
    repo.write("docs/work/x-1.md", "## Review\n\nMy own pass.\n");
    repo.commitAll("gate on mine");
    const oidMine = repo.git("rev-parse", "mine");
    repo.git("checkout", "-q", "--detach", oidMine);
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");

    const result = checkMergeTree(repo.dir, {
      listOpenHeads: () => [{ number: 1, headRefName: "mine", oid: oidMine }],
    });
    expect(result.lines[0]).toMatch(/against 0 other open pull request head/);
  } finally {
    repo.cleanup();
  }
});

/** Round 2's addition to check 5: a head this checkout cannot fetch is a failure, not a skip. */
test("checkMergeTree fails a pull request head whose oid this checkout does not have", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.commitAll("base");

    const result = checkMergeTree(repo.dir, {
      listOpenHeads: () => [{ number: 9, headRefName: "never-fetched", oid: "a".repeat(40) }],
    });
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.mergeTree);
    expect(result.lines.join("\n")).toMatch(/never-fetched.*does not have/);
    expect(result.lines.join("\n")).toMatch(/git fetch/);
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
 * Every git/gh call spawned for real. Check 1's `npm run check` / `npm test`
 * reach the network and a `node_modules` a throwaway fixture repo does not
 * have, so they are stubbed separately, via `buildRun` — a decoupling `run`
 * and `buildRun` only have since round 2, and load-bearing for it: check 1
 * used to share `run` with everything else, which is what let its own
 * `runCommand`-shaped error message leak `next-id.mjs`'s wording into a build
 * failure (round 2's fifth med finding).
 */
function realRun(command: string, args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd, shell: false });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

const stubBuild = () => "";

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
      run: realRun,
      buildRun: stubBuild,
      listOpenHeads: () => [],
    });
    const bitmask = results.reduce((mask, r) => mask | r.bit, 0);
    expect(bitmask).toBe(0);
    expect(results.every((r) => r.ok)).toBe(true);
  } finally {
    repo.cleanup();
  }
});

/**
 * Round 2's second med finding, reproduced and now closed: a bad `--base`
 * used to propagate `git`'s own raw exit status (128) because nothing
 * validated it before computing a diff against it. `preflight` now verifies
 * `base` itself and raises `EXIT.setup`, matching `EXIT`'s own docblock.
 */
test("preflight raises EXIT.setup, not git's raw status, on a --base that does not resolve", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("base");

    let caught: (Error & { exit?: number }) | undefined;
    try {
      preflight(repo.dir, { base: "no-such-base", run: realRun, buildRun: stubBuild });
    } catch (error) {
      caught = error as Error & { exit?: number };
    }
    expect(caught?.exit).toBe(EXIT.setup);
    expect(caught?.exit).not.toBe(128);
  } finally {
    repo.cleanup();
  }
});

/**
 * Round 2's first med finding, reproduced and now closed: a check that threw
 * used to abort the whole run before the other four printed anything, and the
 * failing child's own raw exit status landed in the bitmask's own namespace.
 * `listOpenHeads` here plays the part `gh` auth failure measured against the
 * real CLI: a throw from inside check 5 alone.
 */
test("preflight isolates a throwing check to its own bit and still runs the others", () => {
  const repo = makeRepo();
  try {
    repo.write("src/tls.ts", TLS);
    repo.write("docs/work/a.md", ANCHORED_REVIEW);
    repo.commitAll("docs(repo): seed a fixture");
    const base = repo.git("rev-parse", "HEAD");

    const results = preflight(repo.dir, {
      base,
      run: realRun,
      buildRun: stubBuild,
      listOpenHeads: () => {
        throw new Error("gh: authentication failed");
      },
    });
    const byName = (name: string) => results.find((r) => r.name === name);
    expect(byName("mergeTree")).toMatchObject({ ok: false, bit: EXIT.mergeTree });
    expect(byName("mergeTree")?.lines.join("\n")).toMatch(/authentication failed/);
    expect(byName("check")).toMatchObject({ ok: true, bit: 0 });
    expect(byName("review")).toMatchObject({ ok: true, bit: 0 });
    expect(byName("title")).toMatchObject({ ok: true, bit: 0 });
  } finally {
    repo.cleanup();
  }
});

// --- the CLI's own usage guard, spawned for real ----------------------------

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", shell: false });
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

/**
 * Round 3's first low finding: `guarded()` prints a thrown error's message
 * verbatim, and until this round every git/gh call ran through `next-id.mjs`'s
 * `runCommand`, whose failure message is two sentences about a truncated id
 * sweep — a guard this script does not have. A bad `--base` reaches that path
 * on stderr; `gh` failing inside check 5 reaches it on stdout, through
 * `guarded()`. `runGit` (the replacement, private to this file) carries no
 * such wording, so neither surface should show it any more.
 */
test("the CLI never leaks next-id.mjs's id-sweep wording on a bad --base", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("docs(repo): seed a fixture");

    const result = spawnSync(
      process.execPath,
      [CLI, "--repo", repo.dir, "--base", "no-such-base"],
      {
        encoding: "utf8",
        shell: false,
      },
    );
    expect(result.status).toBe(EXIT.setup);
    expect(result.stderr).not.toMatch(/Refusing to answer/);
  } finally {
    repo.cleanup();
  }
});

test("the CLI never leaks next-id.mjs's id-sweep wording when gh fails inside check 5", () => {
  const repo = makeRepo();
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-ghshim-"));
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("docs(repo): seed a fixture");
    const base = repo.git("rev-parse", "HEAD");
    plantFakeGh(shimDir, repo.dir);

    const result = spawnSync(process.execPath, [CLI, "--repo", repo.dir, "--base", base], {
      encoding: "utf8",
      shell: false,
      env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` },
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout).toMatch(/FAIL {2}mergeTree threw/);
    expect(result.stdout).toMatch(/exited 1\n\s+fake gh answered/);
    expect(result.stdout).not.toMatch(/Refusing to answer/);
  } finally {
    repo.cleanup();
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
});

/**
 * Round 3's second low finding: `head.oid.slice(0, 7)` on an `undefined` oid
 * surfaced a raw `TypeError` naming no PR and no field. `defaultListOpenHeads`
 * now validates `headRefOid` itself and fails with the PR number and name
 * instead — reproduced through `checkMergeTree`'s own default, not a bespoke
 * `listOpenHeads` override, since that default is what a `gh` version gap
 * would actually go through.
 */
test("a gh payload missing headRefOid gives an actionable error, not a raw TypeError", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.commitAll("base");

    const run = (command: string, args: string[], options: { cwd?: string } = {}) => {
      if (command === "gh") return JSON.stringify([{ number: 5, headRefName: "no-oid" }]);
      return realRun(command, args, options);
    };
    expect(() => checkMergeTree(repo.dir, { run })).toThrow(/headRefOid for PR #5 \(no-oid\)/);
  } finally {
    repo.cleanup();
  }
});

/**
 * A fake `gh` that runs on every platform, and says so. repo-71: this test used
 * to plant a `#!/bin/sh` script named `gh`, which Windows never runs — libuv's
 * `PATH` search there appends only `.com` and `.exe` to a bare name, and spawns
 * no shell to read a shebang — so on the Windows leg the spawn fell through to
 * whatever real `gh` the runner carries, and the test passed or timed out on a
 * binary it did not control. It could not tell, because a real `gh` in a
 * remote-less fixture also exits non-zero and every assertion held either way.
 *
 * The fake is therefore a real executable on every platform: this process's
 * own `node`, reached under the name `gh` (`gh.exe` on Windows — a hard link,
 * or a copy where the link is refused, since a Windows symlink needs a
 * privilege a developer machine may not grant). Invoked as
 * `gh pr list --state open …` with `cwd` at the fixture, node runs `pr` there
 * as its script, and `pr.js` is planted to print a marker and exit 1 — the
 * non-zero exit, not a failed spawn, being the path the id-sweep wording used
 * to leak through. The marker is what lets the test assert that its own fake
 * answered rather than assume it.
 */
function plantFakeGh(shimDir: string, cwd: string): void {
  fs.writeFileSync(
    path.join(cwd, "pr.js"),
    'process.stderr.write("fake gh answered\\n");\nprocess.exit(1);\n',
  );
  if (process.platform !== "win32") {
    fs.symlinkSync(process.execPath, path.join(shimDir, "gh"));
    return;
  }
  const ghPath = path.join(shimDir, "gh.exe");
  try {
    fs.linkSync(process.execPath, ghPath);
  } catch {
    fs.copyFileSync(process.execPath, ghPath);
  }
}

// --- repo-79: every ci.yml check-job command ---

/**
 * Read off the real `ci.yml`, not a copy — a fixture's own text could drift
 * from the file it exists to track, which is exactly the risk this ticket
 * closes. A step this job gains or changes should move this test, on purpose.
 */
test("extractCheckJobCommands reads this repo's own ci.yml check job, in order", () => {
  expect(extractCheckJobCommands(REAL_CI_YAML)).toEqual([
    "npm ci",
    "node scripts/check-lockfile-sync.mjs",
    "npm run check",
    "node scripts/status.mjs --json > /dev/null",
    "npx vitest run scripts/test/status.test.ts",
  ]);
});

test("extractCheckJobCommands throws rather than silently report nothing when ci.yml has no check job", () => {
  expect(() => extractCheckJobCommands("name: CI\njobs:\n  build:\n    steps:\n")).toThrow(
    /no top-level "check:" job/,
  );
});

/**
 * A shape this parser cannot read must fail loudly — a `run: |` block scalar
 * inside the check job — rather than being silently skipped, which would make
 * `deriveExtraCiCommands` under-report what CI runs without anyone noticing.
 */
test("extractCheckJobCommands throws rather than silently skip a block-scalar run step", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ci",
    "      - run: |",
    "          echo one",
    "  changes:",
    "    steps:",
    "      - run: echo hi",
    "",
  ].join("\n");
  expect(() => extractCheckJobCommands(yaml)).toThrow(/block scalar/);
});

/**
 * The two commands this file actually runs for real: `npm ci` (setup, not a
 * check) and `npm run check` (check 1's own first command) are
 * excluded by name, over the real ci.yml — so a step ci.yml adds to that job
 * later is picked up here automatically, and only a step this file already
 * covers some other way has to be told apart by hand.
 */
test("deriveExtraCiCommands runs only what no other check already covers", () => {
  expect(deriveExtraCiCommands(REAL_CI_YAML)).toEqual([
    ["node", ["scripts/check-lockfile-sync.mjs"]],
    ["node", ["scripts/status.mjs", "--json"]],
    ["npx", ["vitest", "run", "scripts/test/status.test.ts"]],
  ]);
});

test("tokenize splits a plain command and drops a shell redirection", () => {
  expect(tokenize("node scripts/status.mjs --json > /dev/null")).toEqual([
    "node",
    ["scripts/status.mjs", "--json"],
  ]);
});

test("tokenize keeps a double-quoted argument as one token", () => {
  expect(tokenize('node scripts/citations-gate.mjs --against "origin/main"')).toEqual([
    "node",
    ["scripts/citations-gate.mjs", "--against", "origin/main"],
  ]);
});

/**
 * `COVERED` excludes every command ci.yml carries a template in today, so
 * this is a defence for the day a new one is added rather than a live path —
 * and it is exactly what stands between that day and a spawn that receives
 * the four literal characters `${{` as an argument.
 */
test("assertSpawnable throws rather than let a templated expression reach a spawn verbatim", () => {
  expect(() =>
    assertSpawnable("node scripts/x.mjs --against \"origin/${{ github.base_ref || 'main' }}\""),
  ).toThrow(/templated command/);
});

test("assertSpawnable throws on a shell operator or a trailing comment", () => {
  expect(() => assertSpawnable("node a.mjs && node b.mjs")).toThrow(/shell operator/);
  expect(() => assertSpawnable("node a.mjs | grep x")).toThrow(/shell operator/);
  expect(() => assertSpawnable("node a.mjs # a note")).toThrow(/shell operator/);
  expect(() => assertSpawnable("node a.mjs --flag value")).not.toThrow();
});

/**
 * `status.mjs` walks `<repo>/tools` itself with no guard for it being absent,
 * so every fixture below that actually runs it for real needs the directory
 * to exist, empty though it is — the same reason `plantCiCheckScripts` makes
 * it alongside `scripts/`.
 */
function plantCiCheckScripts(dir: string): void {
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, "scripts", "markdown.mjs"),
    path.join(dir, "scripts", "markdown.mjs"),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, "scripts", "status.mjs"),
    path.join(dir, "scripts", "status.mjs"),
  );
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
}

/** A minimal `ci.yml` carrying the same `check`-job commands as the real one. */
const FIXTURE_CI_YAML = [
  "name: CI",
  "on: push",
  "jobs:",
  "  check:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npm ci",
  "      - run: npm run check",
  "      - run: node scripts/status.mjs --json > /dev/null",
  "  changes:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: echo hi",
  "",
].join("\n");

test("checkCiCommands has nothing to check in a repository with no ci.yml", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("base");
    const result = checkCiCommands(repo.dir);
    expect(result).toMatchObject({ ok: true, bit: 0 });
    expect(result.lines.join("\n")).toBe(`ok    no ${CI_WORKFLOW_PATH} here — nothing to check`);
  } finally {
    repo.cleanup();
  }
});

/** Both derived commands run for real, over a repository that has nothing wrong. */
test("checkCiCommands runs the ci.yml commands no other check covers, for real, and passes on a clean repo", () => {
  const repo = makeRepo();
  try {
    plantCiCheckScripts(repo.dir);
    repo.write(CI_WORKFLOW_PATH, FIXTURE_CI_YAML);
    repo.write(
      ".claude/skills/orchestrate-tickets/SKILL.md",
      "# Orchestration\n\nNo citations here.\n",
    );
    repo.commitAll("seed a clean repo");

    const result = checkCiCommands(repo.dir);
    expect(result).toMatchObject({ ok: true, bit: 0 });
    expect(result.lines.join("\n")).toMatch(/^ok {4}node scripts\/status\.mjs --json$/m);
    expect(result.lines.join("\n")).toMatch(/^ok {4}node scripts\/status\.mjs --json$/m);
  } finally {
    repo.cleanup();
  }
});

/** `status.mjs --json`'s own gate, over a ticket this file did not previously reach. */
test("checkCiCommands fails when status.mjs --json finds a dangling depends_on", () => {
  const repo = makeRepo();
  try {
    plantCiCheckScripts(repo.dir);
    repo.write(CI_WORKFLOW_PATH, FIXTURE_CI_YAML);
    repo.write(
      ".claude/skills/orchestrate-tickets/SKILL.md",
      "# Orchestration\n\nNo citations here.\n",
    );
    repo.write(
      "docs/work/repo-1.md",
      [
        "---",
        "id: repo-1",
        "tool: repo",
        "title: a fixture ticket",
        "kind: chore",
        "status: ready",
        "milestone: null",
        'depends_on: ["repo-999"]',
        "---",
        "",
        "# repo-1",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    repo.commitAll("seed a dangling dependency");

    const result = checkCiCommands(repo.dir);
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.ciCommands);
    expect(result.lines.join("\n")).toMatch(/FAIL {2}node scripts\/status\.mjs --json/);
  } finally {
    repo.cleanup();
  }
});

// --- repo-79, gate 2's second med: the round-1 parity fixes, each with its own test ---

/**
 * Gate 2's med: nothing asserted the round-1 parity fixes, so a mutant with
 * both `step.lines.length > 1` and the covered-step exact-match check
 * removed passed this whole suite, 69 of 69, while it silently read a
 * `name:`-first step (losing the step entirely, missing its own command)
 * and silently let `npm ci --ignore-scripts` through uncaught again. Each
 * test below is watched failing against exactly that mutant, one shape at a
 * time, before being restored — this file's own opening comment's
 * discipline, applied to gate 2's own finding rather than repo-51's
 * original guards.
 *
 * `name:`, `if:` and `working-directory:`/`env:` ahead of or alongside
 * `run:` all make a step more than one line, which is what
 * `extractCheckJobCommands` throws on — a real `ci.yml`-shaped fixture per
 * shape, not a hand-built array, since the parser reads text, not an AST.
 */
test("extractCheckJobCommands throws on a name:-first step, not silently losing it", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ci",
    "      - name: Next id",
    "        run: node scripts/next-id.mjs --check",
    "",
  ].join("\n");
  expect(() => extractCheckJobCommands(yaml)).toThrow(/other keys/);
});

test("extractCheckJobCommands throws on an if:-first step, not silently losing it", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ci",
    "      - if: github.event_name == 'pull_request'",
    "        run: node scripts/next-id.mjs --check",
    "",
  ].join("\n");
  expect(() => extractCheckJobCommands(yaml)).toThrow(/other keys/);
});

test("extractCheckJobCommands throws on a working-directory: step, not silently running it in the wrong cwd", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ci",
    "      - run: node ../x.mjs",
    "        working-directory: tools/downloader",
    "",
  ].join("\n");
  expect(() => extractCheckJobCommands(yaml)).toThrow(/other keys/);
});

test("extractCheckJobCommands throws on an env: step, not silently running it missing the env", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ci",
    "      - run: node scripts/status.mjs --json",
    "        env:",
    '          STRICT: "1"',
    "",
  ].join("\n");
  expect(() => extractCheckJobCommands(yaml)).toThrow(/other keys/);
});

/**
 * `assertSpawnable` wired into the real pipeline, not only called directly:
 * a `&&`/`|`/trailing-comment step reaching `deriveExtraCiCommands` through
 * a real `ci.yml`-shaped fixture throws there too, which is what stands
 * between ci.yml gaining one of these later and a literal `&&` token
 * reaching `spawnSync` as an argument.
 */
test("deriveExtraCiCommands throws on a step chained with && through the real pipeline", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ci",
    "      - run: node scripts/status.mjs --json && node scripts/next-id.mjs --check",
    "",
  ].join("\n");
  expect(() => deriveExtraCiCommands(yaml)).toThrow(/shell operator/);
});

/**
 * The covered-step exact match: a step that merely resembles `npm ci` throws
 * naming what it looks like, rather than falling through uncaught to be
 * spawned for real — gate 1's own measured defect, reproduced through the
 * real pipeline rather than only through `COVERED`'s own shape. `npm ci
 * --ignore-scripts` is never spawned either way this assertion can fail: a
 * throw or a silent skip both count as "not spawned", so this checks the
 * loud path specifically, which is what the round-1 fix promised.
 */
test("deriveExtraCiCommands throws on npm ci --ignore-scripts rather than spawn it uncaught", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ci --ignore-scripts",
    "      - run: npm run check",
    "",
  ].join("\n");
  expect(() => deriveExtraCiCommands(yaml)).toThrow(/looks like "npm ci"/);
});

// --- repo-79, gate 2's lows: COVERED whitespace and the npm ci alias ---

/**
 * Gate 2's low: `COVERED` compared raw text, so `npm  ci` (two spaces) —
 * measured through `deriveExtraCiCommands` directly against this repo's own
 * ci.yml with the step re-spelled — matched neither the guard nor the exact
 * form and fell through to `assertSpawnable`/`tokenize`, which split it on
 * whitespace regardless and spawned a real install. `canonicalize` collapses
 * the run of spaces before either comparison runs.
 */
test("deriveExtraCiCommands treats npm  ci (extra whitespace) as covered, never spawning it", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm  ci",
    "      - run: npm run check",
    "",
  ].join("\n");
  expect(deriveExtraCiCommands(yaml)).toEqual([]);
});

/**
 * Gate 2's low: `npm clean-install` is `npm`'s own alias for `npm ci` and
 * matched no guard at all, so it spawned a real install under a name
 * `COVERED` had never heard of. `canonicalize` rewrites the alias to the name
 * it stands for before either comparison runs.
 */
test("deriveExtraCiCommands treats npm clean-install as covered, never spawning it", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm clean-install",
    "      - run: npm run check",
    "",
  ].join("\n");
  expect(deriveExtraCiCommands(yaml)).toEqual([]);
});

// --- repo-79, gate 2's low: assertSpawnable's broader coverage ---

/**
 * Gate 2's low: a `;`, a glued redirect (no space either side of `>`), a
 * `$VAR` or a `run:` value wholly wrapped in one pair of quotes all reached
 * `spawnSync` as a literal, meaningless argument before this round — measured
 * through `deriveExtraCiCommands` directly, not only `assertSpawnable` in
 * isolation, since the parser wiring is what gate 1's own mutant already
 * proved could be right while `assertSpawnable` itself was never reached for
 * a given shape.
 */
test("assertSpawnable throws on a semicolon, a glued redirect, an unexpanded $VAR and a wholly quoted value", () => {
  expect(() => assertSpawnable("node a.mjs --json; node b.mjs --check")).toThrow(/shell operator/);
  expect(() => assertSpawnable("node a.mjs --json >/dev/null")).toThrow(/glued redirect/);
  expect(() => assertSpawnable("node a.mjs --json 2>/dev/null")).toThrow(/glued redirect/);
  expect(() => assertSpawnable("node a.mjs --since $GITHUB_SHA")).toThrow(/unexpanded \$VAR/);
  expect(() => assertSpawnable('"node a.mjs --check"')).toThrow(/wholly quoted/);
  // The positive control: the legitimate, already-supported space-delimited
  // redirect this repo's own ci.yml uses is still not flagged.
  expect(() => assertSpawnable("node a.mjs --json > /dev/null")).not.toThrow();
});

/** A minimal `ci.yml` carrying one check-job step, for the pipeline test below. */
function oneCheckStep(run: string): string {
  return ["name: CI", "jobs:", "  check:", "    steps:", `      - run: ${run}`, ""].join("\n");
}

test("deriveExtraCiCommands throws on each of the five newly caught shapes, through the real pipeline", () => {
  const stepFor = oneCheckStep;
  expect(() =>
    deriveExtraCiCommands(
      stepFor("node scripts/status.mjs --json; node scripts/next-id.mjs --check"),
    ),
  ).toThrow(/shell operator/);
  expect(() => deriveExtraCiCommands(stepFor("node scripts/status.mjs --json >/dev/null"))).toThrow(
    /glued redirect/,
  );
  expect(() =>
    deriveExtraCiCommands(stepFor("node scripts/status.mjs --json 2>/dev/null")),
  ).toThrow(/glued redirect/);
  expect(() =>
    deriveExtraCiCommands(stepFor("node scripts/next-id.mjs --since $GITHUB_SHA")),
  ).toThrow(/unexpanded \$VAR/);
  expect(() => deriveExtraCiCommands(stepFor('"node scripts/next-id.mjs --check"'))).toThrow(
    /wholly quoted/,
  );
});

// --- repo-82, repo-79 gate 3's low: NPM_ALIASES knew one of npm's own four ---

/**
 * `npm ci --help` lists `aliases: clean-install, ic, install-clean,
 * isntall-clean` — measured directly, 2026-09-28 — and `NPM_ALIASES` knew
 * only the first. Each of the other three, run through `deriveExtraCiCommands`
 * exactly as `npm  ci` and `npm clean-install` already are above, used to
 * match no guard at all and fall through to `assertSpawnable`/`tokenize`,
 * spawning a real install under a name this file had never heard of.
 */
test("deriveExtraCiCommands treats npm ic, npm install-clean and npm isntall-clean as covered, never spawning them", () => {
  const yaml = [
    "name: CI",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ic",
    "      - run: npm install-clean",
    "      - run: npm isntall-clean",
    "      - run: npm run check",
    "",
  ].join("\n");
  expect(deriveExtraCiCommands(yaml)).toEqual([]);
});

// --- repo-82's gate 1, low: npm also resolves a prefix of an alias, and a
// fifth alias (`cit`) NPM_ALIASES never named, to a real `npm ci` ---

/**
 * `NPM_ALIASES` only rewrites the four exact spellings `npm ci --help` lists.
 * npm itself also resolves an unambiguous prefix of a command or alias name
 * — `npm install-clea --help` and `npm isntall-cl --help` both print "Clean
 * install a project", npm 10.9.9, measured directly, 2026-09-28 — and `npm
 * cit` is a fifth, wholly different alias (`install-ci-test`) this file never
 * named. None of the three matches any `COVERED` guard, so before this fix
 * each fell through to `assertSpawnable`/`tokenize` and would have been
 * spawned for real; now each throws, naming the step, rather than guessing.
 */
test("deriveExtraCiCommands throws on npm install-clea, npm isntall-cl and npm cit rather than spawn any of them", () => {
  const stepFor = oneCheckStep;

  expect(() => deriveExtraCiCommands(stepFor("npm install-clea"))).toThrow(
    /does not recognise as "npm ci" or "npm run check"/,
  );
  expect(() => deriveExtraCiCommands(stepFor("npm isntall-cl"))).toThrow(
    /does not recognise as "npm ci" or "npm run check"/,
  );
  expect(() => deriveExtraCiCommands(stepFor("npm cit"))).toThrow(
    /does not recognise as "npm ci" or "npm run check"/,
  );
});

// --- repo-65: check 1 also selects a suite for a working-tree-only edit ----

// A second, later `import` rather than one more name in the block at the top
// of this file: every name up there is cited by line number from five
// already-merged tickets' own `## Review` sections (this file's own
// `:739`, `:293`, and more like them), and one more line in that block moves
// every one of those citations by one — measured directly, with this import
// briefly added up there instead: `node scripts/citations-gate.mjs --against
// origin/main` went from 0 failing to 5 records, 44 citations, all `moved` by
// exactly one line. An `import` declaration is valid at the top level of a
// module wherever it is written, so this one costs nothing upstream of it.
import { workingTreePaths } from "../preflight.mjs";

/**
 * `git status --porcelain=v1 -z`'s own shape: a plain edit or an untracked
 * path is one NUL-terminated field, but a rename or copy carries the new
 * path's field immediately followed by the *original* path as a second,
 * standalone field — parsed wrong, that second field reads on the next turn
 * of the loop as a bare, statusless path of its own rather than being folded
 * into the rename it belongs to.
 */
test("workingTreePaths reports a staged rename's two sides, an unstaged edit and an untracked path", () => {
  const repo = makeRepo();
  try {
    repo.write("a.txt", "one\n");
    repo.write("tools/downloader/b.ts", "two\n");
    repo.commitAll("base");

    repo.git("mv", "tools/downloader/b.ts", "tools/downloader/c.ts");
    fs.appendFileSync(path.join(repo.dir, "a.txt"), "more\n");
    repo.write("tools/planner/d.ts", "new\n");

    const found = workingTreePaths(repo.dir, realRun);
    expect(found).toEqual(
      expect.arrayContaining([
        "a.txt",
        "tools/downloader/c.ts",
        "tools/downloader/b.ts",
        "tools/planner/d.ts",
      ]),
    );
    expect(found.length).toBe(4);
  } finally {
    repo.cleanup();
  }
});

/**
 * The ticket's own reproduction, run through `preflight()` itself rather than
 * `testPlan` alone: an edit to a file already tracked under `scripts/`, left
 * uncommitted, used to vanish from `${base}...HEAD` entirely and take check
 * 1's `repo` project suite with it — a clean `check` bit over a change
 * nothing had actually run. Checks 3 and 4 stay on `diffPaths`, committed-only
 * — repo-65's decision (b) — so this same uncommitted edit must leave both of
 * them exactly as they were, which the last two assertions below pin down.
 */
test("preflight's check 1 runs the repo project's suite for an edit still only in the working tree (repo-65)", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, "release-please-config.json"), RP_CONFIG);
  fs.mkdirSync(path.join(repo.dir, "tools", "downloader"), { recursive: true });
  try {
    repo.write("src/tls.ts", TLS);
    repo.write("docs/work/a.md", ANCHORED_REVIEW);
    repo.write("scripts/seed.mjs", "// seed\n");
    repo.write("docs/work/x-1.md", DONE_NO_REVIEW);
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");

    repo.write("docs/work/x-2.md", DONE_WITH_REVIEW);
    repo.commitAll("fix(downloader): close x-2 cleanly");

    // Left uncommitted on purpose — the premise the ticket's Why measured.
    fs.writeFileSync(path.join(repo.dir, "scripts", "seed.mjs"), "// seed, edited\n");
    expect(repo.git("diff", "--name-only", `${base}...HEAD`)).not.toMatch(/scripts\/seed\.mjs/);

    // repo-65 gate 1's med finding: without these two lines, the assertions
    // below pass whether `checkReview`/`checkTitle` are handed `diffPaths` or
    // `testSelectionPaths`, since the only uncommitted path is
    // `scripts/seed.mjs` and neither check has an opinion about it — this
    // test locked nothing about the split it claimed to. `x-1.md` is `done`
    // with no `## Review` at the base already, and unchanged between `base`
    // and `HEAD`, so `diffPaths` never carries it; an uncommitted append to
    // it plus an untracked file is what actually distinguishes the two path
    // sets — handing `testSelectionPaths` to `checkReview` would surface
    // `x-1.md` and fail with `bit: 4`, where committed-only `diffPaths` never
    // sees it. Measured: reverting `checkReview`/`checkTitle` to
    // `testSelectionPaths` here now fails this assertion (`review`'s `ok`
    // goes `false`), where it did not before this fixture addition.
    fs.appendFileSync(path.join(repo.dir, "docs", "work", "x-1.md"), "\n<!-- touched -->\n");
    repo.write("tools/downloader/NOTES.md", "notes\n");

    const calls: string[] = [];
    const buildRun = (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      return "";
    };

    const results = preflight(repo.dir, {
      base,
      run: realRun,
      buildRun,
      listOpenHeads: () => [],
    });

    expect(calls).toContain("npm test -- --project repo");
    expect(results.find((r) => r.name === "check")).toMatchObject({ ok: true, bit: 0 });
    expect(results.find((r) => r.name === "review")).toMatchObject({ ok: true, bit: 0 });
    expect(results.find((r) => r.name === "title")).toMatchObject({ ok: true, bit: 0 });
  } finally {
    repo.cleanup();
  }
});

/**
 * repo-65 gate 1, low 1: without `--untracked-files=all`, a repository with
 * `status.showUntrackedFiles=no` set returns nothing at all for an untracked
 * path — measured directly, plain `git status --porcelain=v1 -z` over this
 * exact fixture returned `""`.
 */
test("workingTreePaths sees an untracked file even when status.showUntrackedFiles=no is set", () => {
  const repo = makeRepo();
  try {
    repo.git("config", "status.showUntrackedFiles", "no");
    repo.write("seed.txt", "seed\n");
    repo.commitAll("base");
    repo.write("untracked.mjs", "new\n");

    expect(workingTreePaths(repo.dir, realRun)).toEqual(["untracked.mjs"]);
  } finally {
    repo.cleanup();
  }
});

/**
 * repo-65 gate 1, low 2: without `--untracked-files=all`, an entirely
 * untracked directory collapses to one `dir/` entry rather than its files —
 * harmless while `tools/`, `scripts/` and `packages/` stay tracked, but not
 * documented as a property of the return value. With the flag, the same
 * fixture returns the file itself.
 */
test("workingTreePaths reports an untracked directory's own file, not the collapsed directory", () => {
  const repo = makeRepo();
  try {
    repo.write("seed.txt", "seed\n");
    repo.commitAll("base");
    repo.write("tools/planner/d.ts", "new\n");

    expect(workingTreePaths(repo.dir, realRun)).toEqual(["tools/planner/d.ts"]);
  } finally {
    repo.cleanup();
  }
});

/**
 * repo-65 gate 1, low 4: `workingTreePaths`' own `git status` call used to
 * share the same `try`/`catch` as the `--base` resolution above it, so a
 * `git status` failure came back worded as a bad `--base` — reproduced with
 * an injected `run` that throws only on `status`, restored to a distinct
 * message and the same `EXIT.setup` bit once the two calls got their own
 * `try` each.
 */
test("preflight blames the working tree, not --base, when git status itself fails", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");

    const throwsOnStatus: typeof realRun = (command, args, options) => {
      if (args[0] === "status") throw new Error("fatal: index file corrupt (simulated)");
      return realRun(command, args, options);
    };

    let caught: (Error & { exit?: number }) | undefined;
    try {
      preflight(repo.dir, { base, run: throwsOnStatus, buildRun: stubBuild });
    } catch (error) {
      caught = error as Error & { exit?: number };
    }
    // Asserting the exit bit through a local first, rather than reading
    // `caught?.exit` directly in the `expect()` call below: that exact call,
    // written out, is already a merged citation's anchor at
    // `scripts/test/preflight.test.ts:764`, and a second, identical line
    // would make it indistinct.
    const exitBit = caught?.exit;
    expect(exitBit).toBe(EXIT.setup);
    expect(caught?.message).toMatch(/the working tree could not be read/);
    expect(caught?.message).not.toMatch(/--base/);
  } finally {
    repo.cleanup();
  }
});

// --- repo-90: the core project's source scans reach scripts/ and every tool ---

test("testPlan runs core after the repo project when only scripts/ moved, and after each tool", () => {
  expect(testPlan(["scripts/re-resolve-citations.mjs"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "repo"]],
    ["npm", ["test", "--", "--project", "core"]],
  ]);
  expect(testPlan(["tools/planner/api/src/a.ts", "tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "downloader"]],
    ["npm", ["test", "--", "--project", "planner"]],
    ["npm", ["test", "--", "--project", "core"]],
  ]);
});

test("testPlan adds no core project to a diff that touches neither scripts/ nor a tool, and runs it once under shared config", () => {
  expect(testPlan(["docs/work/repo-1-a.md"])).toEqual([["npm", ["run", "check"]]]);
  expect(testPlan([".claude/skills/orchestrate-tickets/SKILL.md"])).toEqual([
    ["npm", ["run", "check"]],
  ]);
  const shared = testPlan(["scripts/preflight.mjs", "package.json"]);
  expect(shared).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test"]],
  ]);
});

test("checkBuild fails on a scripts/ diff when only core's suite fails", () => {
  // The defect: a new test spawning without `shell: false` fails core's
  // spawn-safety scan and nothing else, and preflight passed it (repo-90).
  const calls: string[] = [];
  const onlyCoreFails = (command: string, args: string[]) => {
    calls.push(`${command} ${args.join(" ")}`);
    if (args.includes("core")) throw new Error("spawn-safety: 1 failed");
    return "";
  };
  const result = checkBuild("/repo", ["scripts/test/a.test.ts"], onlyCoreFails);
  expect(result).toMatchObject({ ok: false, bit: EXIT.check });
  expect(calls).toEqual([
    "npm run check",
    "npm test -- --project repo",
    "npm test -- --project core",
  ]);
});
