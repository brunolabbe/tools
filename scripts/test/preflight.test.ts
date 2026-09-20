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
  grandfatheredFor,
  isTicketPath,
  mergeTreeConflicts,
  parseArgs,
  parseMergeTreeConflicts,
  preflight,
  runBuildCommand,
  scriptsTouched,
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
  expect(testPlan(["tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "downloader"]],
  ]);
  expect(testPlan(["packages/core/src/a.ts", "tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test"]],
  ]);
  expect(testPlan(["docs/work/repo-1-a.md"])).toEqual([["npm", ["run", "check"]]]);
  expect(testPlan(["scripts/preflight.mjs"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "repo"]],
  ]);
  expect(testPlan(["scripts/preflight.mjs", "tools/downloader/api/src/a.ts"])).toEqual([
    ["npm", ["run", "check"]],
    ["npm", ["test", "--", "--project", "repo"]],
    ["npm", ["test", "--", "--project", "downloader"]],
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

/**
 * Round 2's low finding 7: `checkCitations` used to default to this script's
 * own `GRANDFATHERED`, so scanning a `--repo` fixture reported that
 * checkout's own debt list as `STALE` against a corpus that never held it.
 * `grandfatheredFor` reads the repository under test's own copy instead.
 */
test("grandfatheredFor reads the target repository's own citations-gate.mjs, not this script's", () => {
  const repo = makeRepo();
  try {
    repo.write(
      "scripts/citations-gate.mjs",
      'export const GRANDFATHERED = new Map([\n  ["docs/work/only-here.md", 3],\n]);\n',
    );
    repo.commitAll("seed a fixture debt list");
    expect(grandfatheredFor(repo.dir)).toEqual(new Map([["docs/work/only-here.md", 3]]));
  } finally {
    repo.cleanup();
  }
});

test("grandfatheredFor is empty for a repository with no citations-gate.mjs at all", () => {
  const repo = makeRepo();
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("base");
    expect(grandfatheredFor(repo.dir)).toEqual(new Map());
  } finally {
    repo.cleanup();
  }
});

test("checkCitations defaults to the target repo's own list and reports no STALE entries for one with none", () => {
  const repo = makeRepo();
  try {
    repo.write("src/tls.ts", TLS);
    repo.write("docs/work/a.md", ANCHORED_REVIEW);
    repo.commitAll("base");
    const base = repo.git("rev-parse", "HEAD");

    // No `grandfathered` argument — exercising the default, not `new Map()`.
    const result = checkCitations(repo.dir, base);
    expect(result).toMatchObject({ ok: true, bit: 0 });
    expect(result.lines.join("\n")).not.toMatch(/STALE/);
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
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd });
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
test("preflight isolates a throwing check to its own bit and still runs the other four", () => {
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
      grandfathered: new Map(),
      listOpenHeads: () => {
        throw new Error("gh: authentication failed");
      },
    });
    const byName = (name: string) => results.find((r) => r.name === name);
    expect(byName("mergeTree")).toMatchObject({ ok: false, bit: EXIT.mergeTree });
    expect(byName("mergeTree")?.lines.join("\n")).toMatch(/authentication failed/);
    expect(byName("check")).toMatchObject({ ok: true, bit: 0 });
    expect(byName("citations")).toMatchObject({ ok: true, bit: 0 });
    expect(byName("review")).toMatchObject({ ok: true, bit: 0 });
    expect(byName("title")).toMatchObject({ ok: true, bit: 0 });
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
  const ghPath = path.join(shimDir, "gh");
  fs.writeFileSync(ghPath, "#!/bin/sh\nexit 1\n");
  fs.chmodSync(ghPath, 0o755);
  try {
    repo.write("docs/work/seed.md", "seed\n");
    repo.commitAll("docs(repo): seed a fixture");
    const base = repo.git("rev-parse", "HEAD");

    const result = spawnSync(process.execPath, [CLI, "--repo", repo.dir, "--base", base], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` },
    });
    expect(result.stdout).toMatch(/FAIL {2}mergeTree threw/);
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
