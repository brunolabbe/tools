/**
 * repo-51's guards, one test per failure mode, each watched failing against a
 * build with the corresponding check removed — the same discipline
 * `next-id.test.ts` explains in its own opening comment and this file borrows
 * rather than re-argues.
 *
 * Two layers, for the same reason `next-id.test.ts` splits them:
 *
 *   - **real temporary git repositories** for everything a check actually has
 *     an opinion about — a `done` ticket with no `## Review`, a title over
 *     the wrong paths, two branches that conflict on a file. Faking these would
 *     mean re-implementing the very logic (`commit-message.mjs`'s convention,
 *     real `git merge-tree`) the check exists to defer to.
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
import { afterAll, expect, test } from "vitest";
import {
  CHECK_ORDER,
  CI_WORKFLOW_PATH,
  EXIT,
  allProjects,
  checkBuild,
  checkCiCommands,
  checkMergeTree,
  checkReview,
  checkTitle,
  ciProjects,
  deriveExtraCiCommands,
  extractCheckJobCommands,
  isTicketPath,
  mergeTreeConflicts,
  packageGraph,
  parseArgs,
  parseMergeTreeConflicts,
  assertSpawnable,
  tokenize,
  preflight,
  projectsFor,
  rerunCommand,
  runBuildCommand,
  scriptsTouched,
  sharedConfigTouched,
  testPlan,
  touchedTools,
} from "../preflight.mjs";
import { failedChecks } from "../review-record.mjs";

const CLI = path.join(import.meta.dirname, "..", "preflight.mjs");

/** This checkout's own root, so repo-79's new checks can be measured against its real ci.yml. */
const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const REAL_CI_YAML = fs.readFileSync(
  path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
  "utf8",
);

/**
 * A throwaway repository this file controls end to end — a corpus a test can
 * move is the only kind these checks can be proven against, since the live
 * corpus changes every time a ticket is gated.
 */
function makeRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-")));
  fs.cpSync(repoTemplateDir(), dir, { recursive: true });
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", shell: false });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
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

/**
 * What `makeRepo` starts every test from, built once per file (repo-128, after
 * repo-113's `review-record.test.ts`): `init` and two `git config` spawns for
 * each of about 50 repositories, 40 ms apiece on Windows. A repository with no
 * remote holds no absolute path, so a copy of its directory is a repository of
 * its own. The identity is written to `.git/config` rather than set in the
 * environment because a scratch clone a check makes must still find none of it
 * — the same reason `review-record.test.ts`'s `setIdentity` gives. Background
 * maintenance is off for repo-116's reason: a `git commit` that forks one can
 * leave a lock file that vanishes under a later `fs.cpSync`.
 */
let repoTemplate: string | undefined;

function repoTemplateDir(): string {
  if (repoTemplate === undefined) {
    const built = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-template-")));
    try {
      const init = spawnSync("git", ["-C", built, "init", "-q", "-b", "main"], {
        encoding: "utf8",
        shell: false,
      });
      if (init.status !== 0) throw new Error(`git init\n${init.stderr}`);
      fs.appendFileSync(
        path.join(built, ".git", "config"),
        "[user]\n\temail = preflight@example.test\n\tname = preflight test\n[maintenance]\n\tauto = false\n",
      );
      fs.writeFileSync(path.join(built, ".gitattributes"), "* text=auto eol=lf\n");
    } catch (error) {
      fs.rmSync(built, { recursive: true, force: true });
      throw error;
    }
    repoTemplate = built;
  }
  return repoTemplate;
}

afterAll(() => {
  if (repoTemplate !== undefined) fs.rmSync(repoTemplate, { recursive: true, force: true });
});

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
  // `repo` follows any tool too since repo-127: its preflight suite reads every tool's layout.
  expect(testPlan(["tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "downloader"]],
    ["npm", ["test", "--", "--project", "repo"]],
    ["npm", ["test", "--", "--project", "core"]],
  ]);
  expect(testPlan(["packages/core/src/a.ts", "tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test"]],
  ]);
  expect(testPlan(["docs/work/repo-1-a.md"])).toEqual([["npm", ["run", "check"]]]);
  expect(testPlan(["scripts/preflight.mjs", "tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "downloader"]],
    ["npm", ["test", "--", "--project", "repo"]],
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

/**
 * With `--title` given, `checkTitle` reads only `release-please-config.json` and
 * the names under `tools/` (`commit-message.mjs`'s `releasingTypes` and
 * `toolScopes`) and never runs git, so a plain directory serves every case and
 * is shared between them (repo-128). A case that wanted git state would use
 * `makeRepo`.
 */
let titleDir: string | undefined;

function titleFixtureDir(): string {
  if (titleDir === undefined) {
    const built = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-title-")));
    fs.writeFileSync(path.join(built, "release-please-config.json"), RP_CONFIG);
    fs.mkdirSync(path.join(built, "tools", "downloader"), { recursive: true });
    titleDir = built;
  }
  return titleDir;
}

afterAll(() => {
  if (titleDir !== undefined) fs.rmSync(titleDir, { recursive: true, force: true });
});

/** Done when's third planted failure: a feat title over markdown-only tools/ paths. */
test("checkTitle fails a changelog-worthy type whose only tools/ path is markdown", () => {
  const result = checkTitle(
    titleFixtureDir(),
    ["tools/downloader/docs/work/dl-1-a.md"],
    "feat(downloader): document a thing",
  );
  expect(result.ok).toBe(false);
  expect(result.bit).toBe(EXIT.title);
  expect(result.lines.join("\n")).toMatch(/markdown/);
});

test("checkTitle passes the same type when a tools/ path is not markdown", () => {
  const result = checkTitle(
    titleFixtureDir(),
    ["tools/downloader/api/src/a.ts", "tools/downloader/docs/work/dl-1-a.md"],
    "feat(downloader): add a thing",
  );
  expect(result).toMatchObject({ ok: true, bit: 0 });
});

test("checkTitle passes a hidden type over markdown-only paths, since no changelog is cut", () => {
  const result = checkTitle(
    titleFixtureDir(),
    ["tools/downloader/docs/work/dl-1-a.md"],
    "chore(downloader): file a ticket",
  );
  expect(result).toMatchObject({ ok: true, bit: 0 });
  expect(result.lines.join("\n")).toMatch(/hidden/);
});

test("checkTitle fails outright on a title commit-message.mjs's own convention rejects", () => {
  const result = checkTitle(titleFixtureDir(), [], "Fixed a thing.");
  expect(result.ok).toBe(false);
  expect(result.bit).toBe(EXIT.title);
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
  const result = checkTitle(titleFixtureDir(), ["tools/downloader/docs/work/dl-1-a.md"], subject);
  expect(result.ok).toBe(false);
  expect(result.bit).toBe(EXIT.title);
  expect(result.lines.join("\n")).toMatch(/no conventional subject found/);
  expect(result.lines.join("\n")).not.toMatch(/undefined/);
  expect(result.lines.join("\n")).not.toMatch(/is hidden in release-please-config/);
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
  const shimDir = makeShimDir();
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
    removeShimDir(shimDir);
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
// of this file. It was written that way to keep the lines already-merged gate
// records cited from moving, a rule adr/006 retired along with the citations;
// an `import` declaration is valid at the top level of a module wherever it
// is written, so it stays where it is.
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
    ["npm", ["test", "--", "--project", "repo"]],
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

// --- repo-101: a tool's markdown is not a tool's code ------------------------

/**
 * repo-101's Done when 1: a diff that is only markdown under a tool plans the
 * build and nothing else. Gate records, Log entries and filed tickets all land
 * this way, and each used to pay for a whole tool's suite.
 */
test("testPlan plans no npm test for a diff of only markdown under tools/ (repo-101)", () => {
  expect(
    testPlan(["tools/downloader/docs/work/dl-111-x.md", "tools/planner/docs/work/pl-1-x.md"]),
  ).toEqual([["npm", ["run", "check"]]]);
  expect(touchedTools(["tools/downloader/docs/work/dl-111-x.md"])).toEqual([]);
});

/**
 * repo-101's Done when 2: one non-markdown path under a tool still plans that
 * tool's project and `core`, whatever markdown sits beside it.
 */
test("testPlan still plans the tool and core for markdown mixed with one code path (repo-101)", () => {
  expect(
    testPlan(["tools/downloader/docs/work/dl-111-x.md", "tools/downloader/api/src/a.ts"]),
  ).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "downloader"]],
    ["npm", ["test", "--", "--project", "repo"]],
    ["npm", ["test", "--", "--project", "core"]],
  ]);
});

/**
 * Build step 1's rename case, through `preflight()` against a real repository,
 * because the fault is in what `git diff --name-only` reports and not in
 * `testPlan`. Rename detection is on by default and reports a rename as its
 * destination only, so `git mv tools/downloader/src/a.ts tools/downloader/docs/a.md`
 * listed a markdown file and nothing else, and the deleted source's suite was
 * skipped. The same commit with `--no-renames` lists both sides.
 */
test("preflight plans the tool's suite for a .ts renamed to .md, since its source was deleted (repo-101)", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, "release-please-config.json"), RP_CONFIG);
  try {
    repo.write("tools/downloader/src/a.ts", TLS);
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");

    fs.mkdirSync(path.join(repo.dir, "tools", "downloader", "docs"), { recursive: true });
    repo.git("mv", "tools/downloader/src/a.ts", "tools/downloader/docs/a.md");
    repo.commitAll("docs(downloader): move the source to a note");

    const calls: string[] = [];
    const results = preflight(repo.dir, {
      base,
      title: "docs(downloader): move the source to a note",
      run: realRun,
      buildRun: recordingRun(calls),
      listOpenHeads: () => [],
    });
    expect(calls).toContain("npm test -- --project downloader");
    expect(calls).toContain("npm test -- --project core");
    expect(results.find((r) => r.name === "check")).toMatchObject({ ok: true, bit: 0 });
  } finally {
    repo.cleanup();
  }
});

// --- repo-102: a tool's suite narrows to the packages a change can reach ------

function pkg(name: string, deps: string[] = []) {
  return JSON.stringify({
    name: `@foo/${name}`,
    dependencies: Object.fromEntries(deps.map((d) => [`@foo/${d}`, "*"])),
  });
}

/**
 * A throwaway tool tree: `contract` <- `engine` <- `api`, and a `web` that
 * depends on `contract` alone, the shape of the downloader without its names.
 * Every package has a `test/` directory, as `vitest.config.ts`'s glob needs.
 */
function makeToolTree(extra: Record<string, string> = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-tool-")));
  const files: Record<string, string> = {
    "tools/foo/contract/package.json": pkg("contract"),
    "tools/foo/engine/package.json": pkg("engine", ["contract"]),
    "tools/foo/api/package.json": pkg("api", ["contract", "engine"]),
    "tools/foo/web/package.json": pkg("web", ["contract"]),
    "tools/foo/contract/test/a.test.ts": "export {};\n",
    "tools/foo/engine/test/a.test.ts": "export {};\n",
    "tools/foo/api/test/a.test.ts": "export {};\n",
    "tools/foo/web/test/a.test.ts": "export {};\n",
    ...extra,
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** The filters planned after `--project foo`: `[]` is the whole project, `null` is no such command. */
function planFor(paths: string[], repo: string): string[] | null {
  const command = testPlan(paths, repo).find(([, args]) => args.includes("foo"));
  return command ? command[1].slice(command[1].indexOf("foo") + 1) : null;
}

test("testPlan plans only the leaf package for a change to it (repo-102)", () => {
  const tree = makeToolTree();
  try {
    expect(planFor(["tools/foo/api/src/a.ts"], tree.dir)).toEqual(["tools/foo/api/test/"]);
    expect(planFor(["tools/foo/web/src/a.ts"], tree.dir)).toEqual(["tools/foo/web/test/"]);
  } finally {
    tree.cleanup();
  }
});

test("testPlan plans every package for a change to contract, as the tool's whole project (repo-102)", () => {
  const tree = makeToolTree();
  try {
    // All four packages are affected, so the plan is the unfiltered project
    // CI runs, not four filters that spell the same thing.
    expect(planFor(["tools/foo/contract/src/a.ts"], tree.dir)).toEqual([]);
    expect(testPlan(["tools/foo/contract/src/a.ts"], tree.dir)).toEqual([
      ["npm", ["run", "check"]],
      ["npm", ["test", "--", "--project", "foo"]],
      ["npm", ["test", "--", "--project", "repo"]],
      ["npm", ["test", "--", "--project", "core"]],
    ]);
  } finally {
    tree.cleanup();
  }
});

test("testPlan plans engine and api for a change to engine, and not web or contract (repo-102)", () => {
  const tree = makeToolTree();
  try {
    expect(planFor(["tools/foo/engine/src/a.ts"], tree.dir)).toEqual([
      "tools/foo/api/test/",
      "tools/foo/engine/test/",
    ]);
  } finally {
    tree.cleanup();
  }
});

test("testPlan plans the whole tool for any path that belongs to no package (repo-102)", () => {
  const tree = makeToolTree({
    "tools/foo/Dockerfile": "FROM scratch\n",
    "tools/foo/e2e/a.spec.ts": "export {};\n",
    "tools/foo/tsconfig.json": "{}\n",
    "tools/foo/src/loose.ts": "export {};\n",
  });
  try {
    for (const orphan of [
      "tools/foo/Dockerfile",
      "tools/foo/playwright.config.ts",
      "tools/foo/e2e/a.spec.ts",
      "tools/foo/tsconfig.json",
      "tools/foo/src/loose.ts",
      "tools/foo/gone/src/deleted.ts", // a package that no longer exists
    ]) {
      expect(planFor([orphan], tree.dir)).toEqual([]);
      // Alongside a path that would narrow, the orphan still wins.
      expect(planFor(["tools/foo/api/src/a.ts", orphan], tree.dir)).toEqual([]);
    }
  } finally {
    tree.cleanup();
  }
});

test("testPlan runs the whole tool when it cannot read the tree, and when no repo is given (repo-102)", () => {
  expect(planFor(["tools/foo/api/src/a.ts"], "/nonexistent/repo")).toEqual([]);
  expect(testPlan(["tools/foo/api/src/a.ts"])[1]).toEqual([
    "npm",
    ["test", "--", "--project", "foo"],
  ]);
});

test("packageGraph adds an edge for a test import the manifests do not declare (repo-102)", () => {
  const tree = makeToolTree({
    // web declares only contract, but its test borrows engine's helper.
    "tools/foo/web/test/b.test.ts": 'import { media } from "../../engine/test/helpers/media.ts";\n',
    "tools/foo/engine/test/helpers/media.ts": "export const media = 1;\n",
  });
  try {
    expect(packageGraph(tree.dir, "foo")?.get("web")?.dependsOn.get("engine")).toEqual(
      new Set([""]),
    );
    // So an engine change now reaches web, which the manifests alone would not say.
    expect(planFor(["tools/foo/engine/src/a.ts"], tree.dir)).toEqual([
      "tools/foo/api/test/",
      "tools/foo/engine/test/",
      "tools/foo/web/test/",
    ]);
  } finally {
    tree.cleanup();
  }
});

test("packageGraph counts a devDependency on a workspace and a bare @tool/package import (repo-102)", () => {
  const tree = makeToolTree({
    "tools/foo/web/package.json": JSON.stringify({
      name: "@foo/web",
      dependencies: { "@foo/contract": "*" },
      devDependencies: { "@foo/engine": "*" },
    }),
    "tools/foo/contract/test/b.test.ts": 'import { x } from "@foo/api";\n',
  });
  try {
    const graph = packageGraph(tree.dir, "foo");
    expect([...(graph?.get("web")?.dependsOn.keys() ?? [])].toSorted()).toEqual([
      "contract",
      "engine",
    ]);
    expect([...(graph?.get("contract")?.dependsOn.keys() ?? [])]).toEqual(["api"]);
  } finally {
    tree.cleanup();
  }
});

test("packageGraph does not read a comment's mention of a sibling as a dependency (repo-102)", () => {
  const tree = makeToolTree({
    "tools/foo/contract/src/a.ts": [
      "/**",
      " * Lives in `@foo/engine`, see ../../engine/src/a.ts and tools/foo/api/src/b.ts.",
      " */",
      "// and `@foo/web`, ../../web/src/a.ts",
      "export const url = 'http://example.test/';",
      "",
    ].join("\n"),
  });
  try {
    expect(packageGraph(tree.dir, "foo")?.get("contract")?.dependsOn.size).toBe(0);
  } finally {
    tree.cleanup();
  }
});

test("packageGraph scopes a path that names data to that path, so a source change does not spread to its reader (repo-102)", () => {
  const tree = makeToolTree({
    // engine reads a fixture of web by relative path, api walks up to a
    // directory of web's with segments, as a helper under jsdom must.
    "tools/foo/engine/test/b.test.ts": 'const f = "../../web/test/fixtures/x.json";\n',
    "tools/foo/api/test/b.test.ts": 'const d = join("tools", "foo", "web", "public");\n',
  });
  try {
    const graph = packageGraph(tree.dir, "foo");
    expect(graph?.get("engine")?.dependsOn.get("web")).toEqual(
      new Set(["web/test/fixtures/x.json"]),
    );
    expect(graph?.get("api")?.dependsOn.get("web")).toEqual(new Set(["web/public"]));
    // A source change in web runs web alone: neither reader reads its source.
    expect(planFor(["tools/foo/web/src/a.ts"], tree.dir)).toEqual(["tools/foo/web/test/"]);
    // The fixture and the directory each fire their own reader, and only it.
    expect(planFor(["tools/foo/web/test/fixtures/x.json"], tree.dir)).toEqual([
      "tools/foo/engine/test/",
      "tools/foo/web/test/",
    ]);
    expect(planFor(["tools/foo/web/public/logo.svg"], tree.dir)).toEqual([
      "tools/foo/api/test/",
      "tools/foo/web/test/",
    ]);
  } finally {
    tree.cleanup();
  }
});

test("checkBuild hands testPlan the repo it is checking, so the narrowing reaches the spawned command (repo-102)", () => {
  const tree = makeToolTree();
  try {
    const calls: string[] = [];
    const result = checkBuild(tree.dir, ["tools/foo/api/src/a.ts"], recordingRun(calls));
    expect(result.ok).toBe(true);
    expect(calls).toContain("npm test -- --project foo tools/foo/api/test/");
  } finally {
    tree.cleanup();
  }
});

/**
 * Done when 1, against this checkout's real manifests and not a fixture. The
 * downloader has five packages; a change to `api` alone must plan `api` and
 * not `resolvers`, and a change to `contract` must plan all five (so it plans
 * the project unfiltered).
 */
test("testPlan on the real downloader: an api diff plans api only, a contract diff plans all five (repo-102)", () => {
  const graph = packageGraph(REPO_ROOT, "downloader");
  expect([...(graph?.keys() ?? [])].toSorted()).toEqual([
    "api",
    "contract",
    "engine",
    "resolvers",
    "web",
  ]);
  expect([...(graph?.values() ?? [])].every((p) => p.hasTests)).toBe(true);

  const apiOnly = testPlan(["tools/downloader/api/src/server.ts"], REPO_ROOT)[1]?.[1];
  expect(apiOnly).toEqual(["test", "--", "--project", "downloader", "tools/downloader/api/test/"]);
  expect((apiOnly ?? []).join(" ")).not.toContain("resolvers");

  expect(testPlan(["tools/downloader/contract/src/index.ts"], REPO_ROOT)[1]?.[1]).toEqual([
    "test",
    "--",
    "--project",
    "downloader",
  ]);
  // The declared edges, read from the real package.json files.
  expect([...(graph?.get("api")?.dependsOn.keys() ?? [])]).toEqual(
    expect.arrayContaining(["contract", "engine", "resolvers"]),
  );
  // And the two that no manifest declares but a test reads by path.
  expect(graph?.get("engine")?.dependsOn.has("resolvers")).toBe(true);
  expect(graph?.get("api")?.dependsOn.get("web")).toEqual(new Set(["web/public"]));
});

test("testPlan on the real tools: a leaf of planner and of ledger narrows the same way (repo-102)", () => {
  expect(testPlan(["tools/planner/api/src/a.ts"], REPO_ROOT)[1]?.[1]).toEqual([
    "test",
    "--",
    "--project",
    "planner",
    "tools/planner/api/test/",
  ]);
  expect(testPlan(["tools/ledger/books/src/a.ts"], REPO_ROOT)[1]?.[1]).toEqual([
    "test",
    "--",
    "--project",
    "ledger",
    "tools/ledger/api/test/",
    "tools/ledger/books/test/",
    "tools/ledger/web/test/",
  ]);
});

// --- repo-102 round 1: what the scan must not lose, and the guards it relies on ---

/**
 * Gate 1's high. A comment stripper that deletes more than a comment hides a
 * reader, and a hidden reader is the one way this narrowing can skip a test it
 * should have run. Both shapes below are code, not comments.
 */
test("packageGraph keeps a reader whose line holds a // inside a string, or follows a template line starting with a slash-star (repo-102)", () => {
  const tree = makeToolTree({
    "tools/foo/engine/test/p5.test.ts":
      'const note = "see //"; export const P = new URL("../../web/public/", import.meta.url);\n',
    "tools/foo/api/test/glob.test.ts": [
      "export const glob = `",
      "/*.json`;",
      'export const P = new URL("../../web/test/fixtures/", import.meta.url);',
      "/** end */",
      "",
    ].join("\n"),
  });
  try {
    expect(planFor(["tools/foo/web/public/terms.html"], tree.dir)).toEqual([
      "tools/foo/engine/test/",
      "tools/foo/web/test/",
    ]);
    // api holds the template-literal reader; engine's read is of web/public only.
    expect(planFor(["tools/foo/web/test/fixtures/a.json"], tree.dir)).toEqual([
      "tools/foo/api/test/",
      "tools/foo/web/test/",
    ]);
  } finally {
    tree.cleanup();
  }
});

test("packageGraph still strips a whole-line // comment and a JSDoc block, but keeps an unstarred block (repo-102)", () => {
  const tree = makeToolTree({
    "tools/foo/contract/src/a.ts": [
      "// see ../../web/src/a.ts and @foo/web",
      "/** @foo/engine in a one-line docblock */",
      "/**",
      " * @foo/api, ../../api/src/a.ts",
      " */",
      "/*",
      "  @foo/web is named here, in a block whose body has no stars",
      "*/",
      "",
    ].join("\n"),
  });
  try {
    const edges = packageGraph(tree.dir, "foo")?.get("contract")?.dependsOn;
    expect([...(edges?.keys() ?? [])]).toEqual(["web"]);
  } finally {
    tree.cleanup();
  }
});

test("packageGraph scopes a name built at run time by its literal head, and a changed file under that head fires the reader (repo-102)", () => {
  const tree = makeToolTree({
    "tools/foo/engine/test/b.test.ts":
      "const f = `../../web/test/fixtures/manifests/hls-${n}.m3u8`;\n",
    "tools/foo/api/test/b.test.ts": 'const f = "tools/foo/web/test/fixtures/page-" + n;\n',
  });
  try {
    expect(planFor(["tools/foo/web/test/fixtures/manifests/hls-master.m3u8"], tree.dir)).toEqual([
      "tools/foo/engine/test/",
      "tools/foo/web/test/",
    ]);
    expect(planFor(["tools/foo/web/test/fixtures/page-1.html"], tree.dir)).toEqual([
      "tools/foo/api/test/",
      "tools/foo/web/test/",
    ]);
  } finally {
    tree.cleanup();
  }
});

test("packageGraph reads an extensionless specifier that resolves to a file as code, so the edge is the whole package (repo-102)", () => {
  const tree = makeToolTree({
    "tools/foo/engine/test/helpers/mp4.ts": "export const mp4 = 1;\n",
    "tools/foo/engine/test/helpers2/index.ts": "export const x = 1;\n",
    // Bundler resolution lets a web test leave the extension off.
    "tools/foo/web/test/c.test.ts": 'import { mp4 } from "../../engine/test/helpers/mp4";\n',
    // The directory form is read by a different package, so one edge cannot
    // stand in for the other: a whole-package edge absorbs a scoped one.
    "tools/foo/contract/test/d.test.ts": 'import { x } from "../../engine/test/helpers2";\n',
  });
  try {
    expect(packageGraph(tree.dir, "foo")?.get("web")?.dependsOn.get("engine")).toEqual(
      new Set([""]),
    );
    expect(packageGraph(tree.dir, "foo")?.get("contract")?.dependsOn.get("engine")).toEqual(
      new Set([""]),
    );
    // Contract now reads engine as a whole, and every package depends on contract.
    expect(planFor(["tools/foo/engine/test/helpers/mp4.ts"], tree.dir)).toEqual([]);
  } finally {
    tree.cleanup();
  }
});

/** Gate 1's mutation survivors: each guard below was deletable with every test green. */
test("testPlan widens for a file at the tool's root whose name begins with a package's, and ignores a package that owns no tests (repo-102)", () => {
  const tree = makeToolTree({
    // `docsite` is a workspace with no test/ directory that depends on engine.
    "tools/foo/docsite/package.json": pkg("docsite", ["engine"]),
    "tools/foo/docsite/src/a.ts": "export {};\n",
  });
  try {
    // `webs` is a root file; `rest.slice(0, -1)` would read it as the `web` package.
    expect(planFor(["tools/foo/webs"], tree.dir)).toEqual([]);
    // docsite is affected by an engine change but has no tests to filter on.
    expect(planFor(["tools/foo/engine/src/a.ts"], tree.dir)).toEqual([
      "tools/foo/api/test/",
      "tools/foo/engine/test/",
    ]);
    // A change to docsite alone leaves nothing to run, so the whole tool runs.
    expect(planFor(["tools/foo/docsite/src/a.ts"], tree.dir)).toEqual([]);
  } finally {
    tree.cleanup();
  }
});

// --- repo-104: the merge-tree probe runs first, fetches for itself, and can run alone ---

const gitIn = (dir: string, ...args: string[]) => {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
};

/**
 * `repo` pushed to a bare `origin`, and a second clone of that origin which can
 * publish a branch `repo` has not fetched: the shape of a pull request head
 * that moved while a run was going. The clone is the "peer"; `repo` never
 * learns of its commits until something fetches.
 */
function makeRepoWithOrigin() {
  const repo = makeRepo();
  repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
  repo.commitAll("base");
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-origin-")));
  gitIn(bare, "init", "-q", "--bare", "-b", "main");
  repo.git("remote", "add", "origin", bare);
  repo.git("push", "-q", "origin", "main");
  const peer = path.join(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-peer-"))),
    "clone",
  );
  gitIn(os.tmpdir(), "clone", "-q", bare, peer);
  gitIn(peer, "config", "user.email", "peer@example.test");
  gitIn(peer, "config", "user.name", "peer");
  /** Publish `branch` from the peer with `content` in the gate record; return its oid. */
  const publish = (branch: string, content: string) => {
    gitIn(peer, "checkout", "-q", "-B", branch, "origin/main");
    fs.writeFileSync(path.join(peer, "docs/work/x-1.md"), content);
    gitIn(peer, "commit", "-qam", `gate on ${branch} ${content.length}`);
    gitIn(peer, "push", "-q", "--force", "origin", branch);
    return gitIn(peer, "rev-parse", "HEAD");
  };
  return {
    repo,
    publish,
    cleanup: () => {
      repo.cleanup();
      fs.rmSync(bare, { recursive: true, force: true });
      fs.rmSync(path.dirname(peer), { recursive: true, force: true });
    },
  };
}

const hasCommitIn = (dir: string, oid: string) =>
  spawnSync("git", ["-C", dir, "cat-file", "-e", `${oid}^{commit}`], { shell: false }).status === 0;

test("checkMergeTree fetches a head that moved after gh pr list, then compares it (repo-104)", () => {
  const world = makeRepoWithOrigin();
  try {
    world.repo.write("docs/work/x-1.md", "## Review\n\nSecond pass, from here.\n");
    world.repo.commitAll("gate here");
    const moved = world.publish("moved", "## Review\n\nSecond pass, from the peer.\n");
    // The premise: this checkout has never seen the head `gh` is about to list.
    expect(hasCommitIn(world.repo.dir, moved)).toBe(false);

    const result = checkMergeTree(world.repo.dir, {
      run: realRun,
      listOpenHeads: () => [{ number: 11, headRefName: "moved", oid: moved }],
    });

    const text = result.lines.join("\n");
    expect(text).not.toMatch(/does not have/);
    // Compared, not merely found: the two branches edit one gate record.
    expect(result.ok).toBe(false);
    expect(text).toMatch(/#11 moved conflicts on: docs\/work\/x-1\.md/);
    expect(hasCommitIn(world.repo.dir, moved)).toBe(true);
  } finally {
    world.cleanup();
  }
});

test("checkMergeTree brings in a listed head that was force-updated before the fetch (repo-104)", () => {
  const world = makeRepoWithOrigin();
  try {
    const listed = world.publish("moved", "## Review\n\nListed, then replaced.\n");
    // release-please's shape: the branch is force-pushed again, so `listed` is
    // no branch's tip and `git fetch origin` alone will not bring it.
    world.publish("moved", "## Review\n\nThe replacement.\n");

    const result = checkMergeTree(world.repo.dir, {
      run: realRun,
      listOpenHeads: () => [{ number: 12, headRefName: "moved", oid: listed }],
    });

    expect(result.lines.join("\n")).not.toMatch(/does not have/);
    expect(result.lines.join("\n")).toMatch(/#12 moved merges cleanly/);
  } finally {
    world.cleanup();
  }
});

test("checkMergeTree still fails an oid that a fetch cannot bring (repo-104)", () => {
  const world = makeRepoWithOrigin();
  try {
    const result = checkMergeTree(world.repo.dir, {
      run: realRun,
      listOpenHeads: () => [{ number: 13, headRefName: "ghost", oid: "a".repeat(40) }],
    });
    expect(result.ok).toBe(false);
    expect(result.bit).toBe(EXIT.mergeTree);
    expect(result.lines.join("\n")).toMatch(/#13 ghost is at aaaaaaa.*does not have even after/);
  } finally {
    world.cleanup();
  }
});

test("checkMergeTree notes a fetch that failed instead of failing on it, and still compares what it has (repo-104)", () => {
  const repo = makeRepo();
  try {
    repo.write("f.txt", "seed\n");
    repo.commitAll("base");
    repo.git("checkout", "-q", "-b", "other");
    repo.write("g.txt", "other\n");
    repo.commitAll("other");
    const other = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "-q", "main");

    const run = (command: string, args: string[], options: { cwd?: string } = {}) => {
      if (command === "git" && args[0] === "fetch") throw new Error("git fetch origin exited 128");
      return realRun(command, args, options);
    };
    const result = checkMergeTree(repo.dir, {
      run,
      listOpenHeads: () => [{ number: 15, headRefName: "other", oid: other }],
    });
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toMatch(/note {2}git fetch origin exited 128/);
    expect(result.lines.join("\n")).toMatch(/#15 other merges cleanly/);
  } finally {
    repo.cleanup();
  }
});

test("preflight runs the merge-tree probe before any other check and reports each as it finishes (repo-104)", () => {
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

    const events: string[] = [];
    const results = preflight(repo.dir, {
      base,
      run: realRun,
      buildRun: () => {
        events.push("suite");
        return "";
      },
      listOpenHeads: () => [],
      onResult: (r) => events.push(r.name),
    });

    expect(results.map((r) => r.name)).toEqual([...CHECK_ORDER]);
    expect(CHECK_ORDER[0]).toBe("mergeTree");
    // The probe's line is out before the first suite command starts.
    expect(events.indexOf("mergeTree")).toBeLessThan(events.indexOf("suite"));
    expect(events.indexOf("suite")).toBeGreaterThan(-1);
  } finally {
    repo.cleanup();
  }
});

test("preflight stops at a conflicting head with exit 16 before any suite, and names the command for the rest (repo-104)", () => {
  const world = makeRepoWithOrigin();
  try {
    const { repo } = world;
    const base = repo.git("rev-parse", "HEAD");
    repo.write("docs/work/x-1.md", "## Review\n\nSecond pass, from here.\n");
    repo.commitAll("gate here");
    const peerHead = world.publish("peer", "## Review\n\nSecond pass, from the peer.\n");

    let suites = 0;
    const results = preflight(repo.dir, {
      base,
      title: "docs(repo): a title (repo-1)",
      run: realRun,
      buildRun: () => {
        suites += 1;
        return "";
      },
      listOpenHeads: () => [{ number: 21, headRefName: "peer", oid: peerHead }],
    });

    expect(suites).toBe(0);
    expect(results.map((r) => r.name)).toEqual(["mergeTree", "halted"]);
    expect(results.reduce((mask, r) => mask | r.bit, 0)).toBe(EXIT.mergeTree);
    const halted = results[1]?.lines.join("\n") ?? "";
    expect(halted).toMatch(/check, ciCommands, review, title did not run/);
    // Both commands: the probe on its own, and the checks that never ran.
    expect(halted).toContain(
      `node scripts/preflight.mjs --only mergeTree --base '${base}' --title 'docs(repo): a title (repo-1)'`,
    );
    expect(halted).toContain(
      `node scripts/preflight.mjs --only check,ciCommands,review,title --base '${base}' --title 'docs(repo): a title (repo-1)'`,
    );
    expect(results[1]).toMatchObject({ skipped: ["check", "ciCommands", "review", "title"] });
  } finally {
    world.cleanup();
  }
});

test("--only mergeTree runs the probe alone: no suite, no other check (repo-104)", () => {
  const repo = makeRepo();
  try {
    repo.write("src/tls.ts", TLS);
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");
    repo.write("tools/downloader/api/src/a.ts", "export {};\n");
    repo.commitAll("fix(downloader): touch a suite (dl-1)");

    let suites = 0;
    const results = preflight(repo.dir, {
      base,
      run: realRun,
      buildRun: () => {
        suites += 1;
        return "";
      },
      listOpenHeads: () => [],
      only: ["mergeTree"],
    });

    // The diff touches a tool, so a full run would have planned its suite: the
    // zero is the option working, not an empty plan.
    expect(touchedTools(["tools/downloader/api/src/a.ts"])).toEqual(["downloader"]);
    expect(suites).toBe(0);
    expect(results.map((r) => r.name)).toEqual(["mergeTree"]);
  } finally {
    repo.cleanup();
  }
});

test("the CLI's --only mergeTree exits 16 on a failed probe and prints no other check (repo-104)", () => {
  const repo = makeRepo();
  const shimDir = makeShimDir();
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("docs(repo): seed a fixture");
    const base = repo.git("rev-parse", "HEAD");
    plantFakeGh(shimDir, repo.dir);

    const result = spawnSync(
      process.execPath,
      [CLI, "--repo", repo.dir, "--base", base, "--only", "mergeTree"],
      {
        encoding: "utf8",
        shell: false,
        env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(EXIT.mergeTree);
    // The marker proves the fake answered, not a real gh.
    expect(result.stdout).toMatch(/fake gh answered/);
    expect(result.stdout).toMatch(/== mergeTree ==/);
    expect(result.stdout).not.toMatch(/== (check|ciCommands|review|title) ==/);
    expect(result.stdout).toMatch(/preflight failed: mergeTree \(exit 16\)/);
  } finally {
    repo.cleanup();
    removeShimDir(shimDir);
  }
});

test("the CLI prints the probe's failure first and exits 16 alone, with no suite started (repo-104)", () => {
  const repo = makeRepo();
  const shimDir = makeShimDir();
  try {
    repo.write("docs/work/x-1.md", "## Review\n\nFirst pass.\n");
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "-q", "-b", "peer");
    repo.write("docs/work/x-1.md", "## Review\n\nFrom the peer.\n");
    repo.commitAll("peer gate");
    const peer = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "-q", "main");
    repo.write("docs/work/x-1.md", "## Review\n\nFrom here.\n");
    repo.commitAll("our gate");

    plantFakeGh(shimDir, repo.dir);
    // Overwrite the fake's script: a gh that answers, listing the peer head.
    fs.writeFileSync(
      path.join(repo.dir, "pr.js"),
      `process.stdout.write(${JSON.stringify(JSON.stringify([{ number: 31, headRefName: "peer", headRefOid: peer }]))});\n`,
    );

    const result = spawnSync(process.execPath, [CLI, "--repo", repo.dir, "--base", base], {
      encoding: "utf8",
      shell: false,
      env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` },
    });
    expect(result.error).toBeUndefined();
    // Exactly 16: the repository has no package.json, so a started `npm run
    // check` would have added bit 1.
    expect(result.status).toBe(EXIT.mergeTree);
    expect(result.stdout.trimStart().startsWith("== mergeTree ==")).toBe(true);
    expect(result.stdout).toMatch(/#31 peer conflicts on: docs\/work\/x-1\.md/);
    expect(result.stdout).not.toMatch(/== check ==/);
    expect(result.stdout).toMatch(/check, ciCommands, review, title did not run/);
    // The last line carries the unrun checks too: it is the line a lander reads.
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe(
      "preflight failed: mergeTree (exit 16); not run: check, ciCommands, review, title",
    );
    // And the lander's hint, fed this real output, covers all five checks.
    expect(failedChecks(result.stdout)).toEqual([
      "mergeTree",
      "check",
      "ciCommands",
      "review",
      "title",
    ]);
  } finally {
    repo.cleanup();
    removeShimDir(shimDir);
  }
});

test("parseArgs reads --only as a comma list, repeatable, and rejects a name that is not a check (repo-104)", () => {
  expect(parseArgs(["--base", "b", "--only", "mergeTree"]).only).toEqual(["mergeTree"]);
  expect(parseArgs(["--base", "b", "--only", "check,title", "--only", "review"]).only).toEqual([
    "check",
    "title",
    "review",
  ]);
  expect(parseArgs(["--base", "b"]).only).toBeUndefined();
  expect(() => parseArgs(["--base", "b", "--only", "merge-tree"])).toThrow(/not merge-tree/);
  expect(() => parseArgs(["--base", "b", "--only", ""])).toThrow(/--only takes/);
});

test("rerunCommand names the checks, the base and the title, and omits a title it was not given (repo-104)", () => {
  expect(rerunCommand(["mergeTree"], "origin/main", "fix(repo): x (repo-1)")).toBe(
    "node scripts/preflight.mjs --only mergeTree --base 'origin/main' --title 'fix(repo): x (repo-1)'",
  );
  expect(rerunCommand(["check", "title"], "origin/main", undefined)).toBe(
    "node scripts/preflight.mjs --only check,title --base 'origin/main'",
  );
});

test("rerunCommand single-quotes a title so backticks and $(…) stay text when pasted (repo-104)", () => {
  expect(rerunCommand(["title"], "origin/main", "fix: `npm run dev` never $(id) started")).toBe(
    "node scripts/preflight.mjs --only title --base 'origin/main' --title 'fix: `npm run dev` never $(id) started'",
  );
  expect(rerunCommand(["title"], "origin/main", 'fix: it\'s "done"')).toBe(
    "node scripts/preflight.mjs --only title --base 'origin/main' --title 'fix: it'\\''s \"done\"'",
  );
});

test("a gh payload with an oid that is not a commit id is refused before it reaches git fetch (repo-104)", () => {
  const repo = makeRepo();
  try {
    repo.write("f.txt", "seed\n");
    repo.commitAll("base");
    const calls: string[][] = [];
    const run = (command: string, args: string[], options: { cwd?: string } = {}) => {
      if (command === "gh") {
        return JSON.stringify([
          { number: 7, headRefName: "evil", headRefOid: "--upload-pack=touch /tmp/x;false" },
        ]);
      }
      calls.push(args);
      return realRun(command, args, options);
    };
    expect(() => checkMergeTree(repo.dir, { run })).toThrow(/PR #7 \(evil\).*not a commit id/);
    expect(calls.some((args) => args[0] === "fetch")).toBe(false);
  } finally {
    repo.cleanup();
  }
});

test("a halted run for an oid no fetch can bring says so, not only 'a conflict' (repo-104)", () => {
  const world = makeRepoWithOrigin();
  try {
    const base = world.repo.git("rev-parse", "HEAD");
    const results = preflight(world.repo.dir, {
      base,
      run: realRun,
      buildRun: stubBuild,
      listOpenHeads: () => [{ number: 13, headRefName: "ghost", oid: "a".repeat(40) }],
    });
    const halted = results.find((r) => r.name === "halted")?.lines.join("\n") ?? "";
    expect(halted).toMatch(/a missing head is a fetch to retry/);
    expect(halted).toMatch(/A conflict is another pull request's head/);
  } finally {
    world.cleanup();
  }
});

// --- repo-110: the gh shim directory's removal ---

/**
 * Every shim directory this file makes, so a leak is a fact about these paths
 * and not a count of `os.tmpdir()`: another agent's preflight run shares that
 * directory and makes its own `preflight-ghshim-*` while this one runs.
 */
const shimDirsMade: string[] = [];

function makeShimDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-ghshim-"));
  shimDirsMade.push(dir);
  return dir;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

type ShimRemove = (dir: string, options: { recursive: true; force: true }) => void;

/**
 * The only place a shim directory is removed. The `gh.exe` in it is a hard link
 * to (or copy of) this process's `node`, and the child that ran it is the
 * process whose image that file is: on Windows the unlink can land before the
 * image is released and throw `EBUSY`, and `force: true` does not retry that.
 * One red in four Windows legs on 2026-10-18 (repo-110).
 *
 * Retries `EBUSY` and nothing else, a bounded number of times with a growing
 * wait. Any other error is a real fault and is thrown as it came. A directory
 * still held after the last attempt throws naming the directory, so a leak
 * fails the test instead of passing in silence. `remove` and `wait` are
 * parameters so a test can make Linux throw `EBUSY`, which it never does.
 */
function removeShimDir(
  dir: string,
  remove: ShimRemove = (shimDir, options) => fs.rmSync(shimDir, options),
  wait: (ms: number) => void = sleepSync,
): void {
  const attempts = 8;
  for (let attempt = 1; ; attempt++) {
    try {
      remove(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
      if (attempt === attempts) {
        throw new Error(`could not remove ${dir}: still EBUSY after ${attempts} attempts`, {
          cause: error,
        });
      }
      wait(50 * attempt);
    }
  }
}

function busy(dir: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${dir}'`), {
    code: "EBUSY",
  });
}

test("removeShimDir survives one EBUSY and then removes the directory (repo-110)", () => {
  const dir = makeShimDir();
  fs.writeFileSync(path.join(dir, "gh"), "x");
  let calls = 0;
  const waits: number[] = [];
  removeShimDir(
    dir,
    (target, options) => {
      calls++;
      if (calls === 1) throw busy(target);
      fs.rmSync(target, options);
    },
    (ms) => waits.push(ms),
  );
  expect(calls).toBe(2);
  expect(waits).toEqual([50]);
  expect(fs.existsSync(dir)).toBe(false);
});

test("removeShimDir fails naming the directory when EBUSY never clears (repo-110)", () => {
  const dir = makeShimDir();
  let calls = 0;
  try {
    expect(() =>
      removeShimDir(
        dir,
        (target) => {
          calls++;
          throw busy(target);
        },
        () => {},
      ),
    ).toThrow(dir);
    expect(calls).toBe(8);
    // The failure is the report; the directory is still there to be named.
    expect(fs.existsSync(dir)).toBe(true);
  } finally {
    removeShimDir(dir);
  }
});

test("removeShimDir throws any error other than EBUSY at once, unretried (repo-110)", () => {
  const dir = makeShimDir();
  let calls = 0;
  const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  try {
    expect(() =>
      removeShimDir(
        dir,
        () => {
          calls++;
          throw denied;
        },
        () => {},
      ),
    ).toThrow(denied);
    expect(calls).toBe(1);
  } finally {
    removeShimDir(dir);
  }
});

// --- repo-127: a pull request's CI runs the projects its paths reach ---------

test("projectsFor runs a planner-only change on core, repo and planner and nothing else (repo-127)", () => {
  // Done when 1, the mapping half: `ci.yml`'s `changes` job prints this list.
  expect(projectsFor(["tools/planner/api/src/a.ts"])).toEqual(["planner", "repo", "core"]);
  expect(
    projectsFor([
      "tools/planner/web/src/b.tsx",
      "tools/planner/docs/work/pl-1-x.md",
      "tools/planner/api/test/c.test.ts",
    ]),
  ).toEqual(["planner", "repo", "core"]);
  expect(projectsFor(["scripts/status.mjs"])).toEqual(["repo", "core"]);
  // All markdown is the only empty answer, and CI never asks it: `code=false` skips the matrix.
  expect(projectsFor(["tools/planner/docs/work/pl-1-x.md", "docs/work/repo-1-a.md"])).toEqual([]);
});

test("projectsFor runs every project for packages/, root config, .github/ and any path no tool owns (repo-127)", () => {
  // Done when 2. `null` is every project: `ciProjects` turns it into the full list.
  for (const shared of [
    "packages/core/src/a.ts",
    "packages/ui/README.md",
    "package.json",
    "package-lock.json",
    "vitest.config.ts",
    "tsconfig.json",
    "tsconfig.tests.json",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    ".github/workflows/ci.yml",
    ".github/workflows/planner.yml",
    ".claude/hooks/check-pr-title.sh",
    ".claude/settings.json",
    ".githooks/commit-msg",
    "release-please-config.json",
    "compose.planner.yaml",
    ".gitattributes",
  ]) {
    expect(projectsFor([shared]), shared).toBeNull();
    expect(projectsFor(["tools/planner/api/src/a.ts", shared]), shared).toBeNull();
  }
  expect(sharedConfigTouched([".github/workflows/ci.yml"])).toBe(true);
  expect(sharedConfigTouched([".claude/skills/orchestrate-tickets/SKILL.md"])).toBe(false);
  expect(sharedConfigTouched(["tools/planner/api/tsconfig.json"])).toBe(false);
});

test("allProjects is exactly the projects vitest.config.ts declares (repo-127)", () => {
  // The full set CI runs is read off `tools/`, so this is what keeps a renamed
  // or split project (repo-129) from silently leaving the matrix.
  const config = fs.readFileSync(path.join(REPO_ROOT, "vitest.config.ts"), "utf8");
  const declared = [...config.matchAll(/^\s+name: "([^"]+)",$/gmu)].map((match) => match[1]);
  expect(declared.length).toBeGreaterThanOrEqual(5);
  expect(allProjects(REPO_ROOT).toSorted()).toEqual(declared.toSorted());
});

test("ciProjects answers --all with every project and turns projectsFor's null into the same list (repo-127)", () => {
  const all = allProjects(REPO_ROOT);
  expect(ciProjects(REPO_ROOT, true, "")).toEqual(all);
  expect(
    ciProjects(REPO_ROOT, false, ".github/workflows/ci.yml\ntools/planner/api/src/a.ts\n"),
  ).toEqual(all);
  expect(ciProjects(REPO_ROOT, false, "tools/planner/api/src/a.ts\r\n\n")).toEqual([
    "planner",
    "repo",
    "core",
  ]);
});

test("the --ci-projects CLI reads diff paths on stdin and prints one line (repo-127)", () => {
  const run = (args: string[], input: string) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      input,
      encoding: "utf8",
      shell: false,
    });
  const planner = run(["--ci-projects"], "tools/planner/api/src/a.ts\n");
  expect(planner.error).toBeUndefined();
  expect(planner.status).toBe(0);
  expect(planner.stdout).toBe("planner repo core\n");
  const all = run(["--ci-projects", "--all"], "");
  expect(all.status).toBe(0);
  expect(all.stdout).toBe(`${allProjects(REPO_ROOT).join(" ")}\n`);
  const bad = run(["--ci-projects", "--base", "origin/main"], "");
  expect(bad.status).toBe(EXIT.setup);
  expect(bad.stderr).toMatch(/--ci-projects takes only --all/u);
});

/** The `run: |` block of `ci.yml`'s `changes` job, dedented, exactly as the runner gets it. */
function changesStepScript(yaml: string): string {
  const lines = yaml.split("\n");
  const job = lines.indexOf("  changes:");
  const start = lines.findIndex((line, i) => i > job && line === "        run: |");
  expect(job).toBeGreaterThan(0);
  expect(start).toBeGreaterThan(job);
  return dedentedRunBlock(lines, start);
}

/** The `run: |` block of the matrix's test step for one leg's shell, dedented. */
function matrixStepScript(yaml: string, shell: "bash" | "pwsh"): string {
  const lines = yaml.split("\n");
  const name = lines.findIndex(
    (line, i) =>
      line === "        name: Test the projects this change reaches" &&
      lines[i + 1] === `        shell: ${shell}`,
  );
  const start = lines.findIndex((line, i) => i > name && line === "        run: |");
  expect(name).toBeGreaterThan(0);
  expect(start).toBeGreaterThan(name);
  return dedentedRunBlock(lines, start);
}

function dedentedRunBlock(lines: string[], start: number): string {
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

/**
 * Done when 1, 3 and 4 against the workflow's own shell: the `changes` step is
 * cut out of `ci.yml` and run by bash in a throwaway repository carrying this
 * checkout's `scripts/`, under each event's environment. POSIX only — Windows
 * has no bash this suite can name without resolving WSL's, and the job runs on
 * `ubuntu-latest` alone.
 */
test.skipIf(process.platform === "win32")(
  "ci.yml's changes step filters a pull request and runs every project on push, schedule and no base (repo-127)",
  () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-changes-")));
    const git = (...args: string[]) => {
      const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", shell: false });
      if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
      return result.stdout.trim();
    };
    const write = (file: string, content: string) => {
      fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    };
    const commit = (message: string) => {
      git("add", "-A");
      git("commit", "-qm", message);
      return git("rev-parse", "HEAD");
    };
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "preflight@example.test");
      git("config", "user.name", "preflight test");
      for (const script of ["preflight.mjs", "commit-message.mjs", "status.mjs", "markdown.mjs"]) {
        write(
          `scripts/${script}`,
          fs.readFileSync(path.join(REPO_ROOT, "scripts", script), "utf8"),
        );
      }
      for (const tool of ["downloader", "ledger", "planner"])
        write(`tools/${tool}/api/src/a.ts`, "export {};\n");
      const base = commit("base");
      write("tools/planner/api/src/a.ts", "export const a = 1;\n");
      write("tools/planner/docs/work/pl-1-x.md", "# a ticket\n");
      const planner = commit("planner only");
      write("tools/planner/docs/work/pl-1-x.md", "# a ticket, edited\n");
      const docs = commit("docs only");
      write(".github/workflows/ci.yml", "name: CI\n");
      const workflow = commit("workflow");

      const script = changesStepScript(REAL_CI_YAML);
      const step = (event: string, from: string, to: string) => {
        // Its own directory, so the file's name is not a guessable one in the temp dir.
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-output-"));
        const output = path.join(outputDir, "output");
        fs.writeFileSync(output, "");
        try {
          const result = spawnSync("bash", ["-c", script], {
            cwd: dir,
            encoding: "utf8",
            shell: false,
            env: {
              ...process.env,
              GITHUB_EVENT_NAME: event,
              BASE: from,
              HEAD: to,
              GITHUB_OUTPUT: output,
            },
          });
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(0);
          return { log: result.stdout, output: fs.readFileSync(output, "utf8") };
        } finally {
          fs.rmSync(outputDir, { recursive: true, force: true });
        }
      };
      const every = "projects=core repo downloader ledger planner\n";

      const pr = step("pull_request", base, planner);
      expect(pr.output).toBe("code=true\nprojects=planner repo core\n");
      expect(pr.log).toContain("Projects: planner repo core");

      expect(step("pull_request", planner, docs).output).toBe("code=false\n");
      expect(step("pull_request", docs, workflow).output).toBe(`code=true\n${every}`);
      // The same planner-only diff, pushed to main: every project (Done when 3).
      expect(step("push", base, planner).output).toBe(`code=true\n${every}`);
      // No base at all, a first push, and a base this clone does not have (Done when 3 and 4).
      expect(step("schedule", "", workflow).output).toBe(`code=true\n${every}`);
      expect(step("workflow_dispatch", "", workflow).output).toBe(`code=true\n${every}`);
      expect(step("push", "0".repeat(40), planner).output).toBe(`code=true\n${every}`);
      expect(step("pull_request", "1".repeat(40), planner).output).toBe(`code=true\n${every}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("ci.yml runs status.test.ts once, in check, and the matrix runs changes' list without it (repo-127)", () => {
  // Done when 6, read off the workflow: `check` runs it on every event, and the
  // one `npm test` the matrix makes excludes it and takes the project list.
  expect(extractCheckJobCommands(REAL_CI_YAML)).toContain(
    "npx vitest run scripts/test/status.test.ts",
  );
  // One per leg: bash on Linux, PowerShell on Windows.
  const npmTests = REAL_CI_YAML.split("\n").filter((line) =>
    /^\s+(?:- run: )?npm(?:\.cmd)? test\b/u.test(line),
  );
  expect(npmTests.map((line) => line.trim())).toEqual([
    'npm test -- "${args[@]}" --exclude scripts/test/status.test.ts',
    "npm.cmd test -- @projectArgs --exclude scripts/test/status.test.ts",
  ]);
  expect(REAL_CI_YAML).toContain("PROJECTS: ${{ needs.changes.outputs.projects }}");
  expect(REAL_CI_YAML).toContain("projects: ${{ steps.diff.outputs.projects }}");
});

// Gate 1's path-reading lows (repo-127). `git diff --name-only` quotes a
// non-ASCII path unless `core.quotePath=false`, and `ciProjects` once trimmed
// each line; both made a path read as something other than its own text.
const CAFE = `caf${String.fromCharCode(0xe9)}`;

test("ciProjects reads a path as its own text, so a directory named ` tools` is no tool (repo-127)", () => {
  const all = allProjects(REPO_ROOT);
  // Trimmed, ` tools/planner/api/src/a.ts` was `tools/planner/api/src/a.ts` and
  // gave `planner repo core`; as written it is outside `tools/`, a path no tool
  // owns, and runs every project.
  expect(ciProjects(REPO_ROOT, false, " tools/planner/api/src/a.ts\n")).toEqual(all);
  expect(ciProjects(REPO_ROOT, false, "tools/planner/api/src/a.ts\n\n")).toEqual([
    "planner",
    "repo",
    "core",
  ]);
});

test.skipIf(process.platform === "win32")(
  "ci.yml's changes step maps a non-ASCII path under tools/planner to planner, repo and core (repo-127)",
  () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-quote-")));
    const git = (...args: string[]) => {
      const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", shell: false });
      if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
      return result.stdout.trim();
    };
    const write = (file: string, content: string) => {
      fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    };
    // Its own directory, so the file's name is not a guessable one in the temp dir.
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-output-"));
    const output = path.join(outputDir, "output");
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "preflight@example.test");
      git("config", "user.name", "preflight test");
      // Quoting is git's default; a global `core.quotePath=false` would hide the fault.
      git("config", "core.quotePath", "true");
      for (const script of ["preflight.mjs", "commit-message.mjs", "status.mjs", "markdown.mjs"]) {
        write(
          `scripts/${script}`,
          fs.readFileSync(path.join(REPO_ROOT, "scripts", script), "utf8"),
        );
      }
      for (const tool of ["downloader", "ledger", "planner"])
        write(`tools/${tool}/api/src/a.ts`, "export {};\n");
      git("add", "-A");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      write(`tools/planner/api/src/${CAFE}.ts`, "export {};\n");
      git("add", "-A");
      git("commit", "-qm", "a non-ASCII path");
      const head = git("rev-parse", "HEAD");

      fs.writeFileSync(output, "");
      const result = spawnSync("bash", ["-c", changesStepScript(REAL_CI_YAML)], {
        cwd: dir,
        encoding: "utf8",
        shell: false,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "pull_request",
          BASE: base,
          HEAD: head,
          GITHUB_OUTPUT: output,
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(output, "utf8")).toBe("code=true\nprojects=planner repo core\n");
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("preflight plans a non-ASCII path under a tool as that tool's suite, not every project (repo-127)", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, "release-please-config.json"), RP_CONFIG);
  try {
    // Quoting is git's default; a global `core.quotePath=false` would hide the fault.
    repo.git("config", "core.quotePath", "true");
    repo.write("tools/downloader/src/a.ts", TLS);
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");
    repo.write(`tools/downloader/src/${CAFE}.ts`, TLS);
    repo.commitAll("fix(downloader): add a non-ASCII file");

    const calls: string[] = [];
    preflight(repo.dir, {
      base,
      run: realRun,
      buildRun: recordingRun(calls),
      listOpenHeads: () => [],
      only: ["check"],
    });
    expect(calls).toContain("npm test -- --project downloader");
    expect(calls).toContain("npm test -- --project repo");
    expect(calls).not.toContain("npm test");
  } finally {
    repo.cleanup();
  }
});

// Gate 1's med (repo-127): the three empty-list guards and the Windows argument
// mapping were each deletable with the suite green. These run the real step
// scripts out of `ci.yml`, with a stub where a defect would have to be.

test.skipIf(process.platform === "win32")(
  "ci.yml's changes step fails a code change that --ci-projects maps to no project (repo-127)",
  () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-empty-")));
    const git = (...args: string[]) => {
      const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", shell: false });
      if (result.status !== 0) throw new Error(`git ${args.join(" ")}\n${result.stderr}`);
      return result.stdout.trim();
    };
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-output-"));
    const output = path.join(outputDir, "output");
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "preflight@example.test");
      git("config", "user.name", "preflight test");
      // A mapping defect, planted: whatever it is asked, it names nothing.
      fs.mkdirSync(path.join(dir, "scripts"));
      fs.writeFileSync(path.join(dir, "scripts/preflight.mjs"), 'process.stdout.write("\\n");\n');
      fs.writeFileSync(path.join(dir, "a.ts"), "export {};\n");
      git("add", "-A");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
      git("commit", "-qam", "code");
      const head = git("rev-parse", "HEAD");

      fs.writeFileSync(output, "");
      const result = spawnSync("bash", ["-c", changesStepScript(REAL_CI_YAML)], {
        cwd: dir,
        encoding: "utf8",
        shell: false,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "pull_request",
          BASE: base,
          HEAD: head,
          GITHUB_OUTPUT: output,
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain(
        "::error::non-markdown paths changed, and --ci-projects named no project",
      );
      expect(result.status).toBe(1);
      expect(fs.readFileSync(output, "utf8")).toBe("");
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

/**
 * Runs one leg's matrix step with `npm` (`npm.cmd` for PowerShell) replaced by
 * a stub that prints the arguments it got on a line starting `ARGS:`.
 */
function runMatrixStep(shell: "bash" | "pwsh", projects: string | undefined) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-matrix-"));
  try {
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(dir, "npm.cmd"), "@echo ARGS: %*\r\n");
    } else {
      for (const stub of ["npm", "npm.cmd"])
        fs.writeFileSync(path.join(dir, stub), '#!/bin/sh\necho "ARGS: $*"\n', { mode: 0o755 });
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = `${dir}${path.delimiter}${env[pathKey] ?? ""}`;
    delete env.PROJECTS;
    if (projects !== undefined) env.PROJECTS = projects;
    const script = matrixStepScript(REAL_CI_YAML, shell);
    // The runner's own wrapping for each shell: `bash -e {0}` with the step's
    // `set` line, and pwsh's stop preference plus its LASTEXITCODE epilogue.
    const result =
      shell === "bash"
        ? spawnSync("bash", ["-e", "-c", script], { encoding: "utf8", shell: false, env })
        : spawnSync(
            "pwsh",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$ErrorActionPreference = 'stop'\n${script}\nif ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }`,
            ],
            { encoding: "utf8", shell: false, env },
          );
    expect(result.error).toBeUndefined();
    const args = result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("ARGS: "))
      .map((line) => line.slice("ARGS: ".length).trim());
    return { status: result.status, stdout: result.stdout, args };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MATRIX_ARGS =
  "test -- --project planner --project repo --project core --exclude scripts/test/status.test.ts";
const MATRIX_EMPTY = "::error::changes reported a code change and no project to test";

test.skipIf(process.platform === "win32")(
  "ci.yml's bash matrix step passes every project as --project and refuses an empty list (repo-127)",
  () => {
    const listed = runMatrixStep("bash", "planner repo core");
    expect(listed.status, listed.stdout).toBe(0);
    expect(listed.args).toEqual([MATRIX_ARGS]);
    for (const empty of ["", "   ", "\n"]) {
      const result = runMatrixStep("bash", empty);
      expect(result.stdout, JSON.stringify(empty)).toContain(MATRIX_EMPTY);
      expect(result.status, JSON.stringify(empty)).toBe(1);
      expect(result.args).toEqual([]);
    }
    // Unset is `set -u`'s to refuse, before the guard is reached.
    const unset = runMatrixStep("bash", undefined);
    expect(unset.status).not.toBe(0);
    expect(unset.args).toEqual([]);
  },
);

const HAS_PWSH =
  spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { shell: false })
    .status === 0;

// The Windows leg's step. Skipped wherever pwsh is not installed, which
// includes the devcontainer; GitHub's runners carry it.
test.skipIf(!HAS_PWSH)(
  "ci.yml's PowerShell matrix step passes every project as --project and refuses an empty list (repo-127)",
  () => {
    const listed = runMatrixStep("pwsh", "planner repo core");
    expect(listed.status, listed.stdout).toBe(0);
    expect(listed.args).toEqual([MATRIX_ARGS]);
    for (const empty of ["", "   ", undefined]) {
      const result = runMatrixStep("pwsh", empty);
      expect(result.stdout, JSON.stringify(empty)).toContain(MATRIX_EMPTY);
      expect(result.status, JSON.stringify(empty)).toBe(1);
      expect(result.args).toEqual([]);
    }
  },
);

// Last in the file on purpose: it reads what every test above left behind, and
// it is the spec a shim test that stops calling `removeShimDir` turns red.
test("no preflight-ghshim directory this file made is left behind (repo-110)", () => {
  expect(shimDirsMade.length).toBeGreaterThanOrEqual(3);
  expect(shimDirsMade.filter((dir) => fs.existsSync(dir))).toEqual([]);
});
