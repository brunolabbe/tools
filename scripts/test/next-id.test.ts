/**
 * The id sweep's guards, one test per guard, each watched failing first.
 *
 * repo-30's whole subject is that this sweep lived in a markdown fence for
 * months and was wrong the entire time, in ways that produced a *confident*
 * answer rather than an error. The six cases below are the six failure modes
 * measured against the shell version before the lift, and each one exists so
 * that removing the corresponding guard turns this file red instead of turning
 * the board silently wrong.
 *
 * Two layers, deliberately:
 *
 *   - **injected runner** for everything about how a failure propagates. A fake
 *     `run` is exact — it can die after writing half its output, which is the
 *     one case a `PATH` stub cannot express — and it is the same seam the CLI
 *     itself uses, not a test-only branch.
 *   - **the real CLI, spawned**, for the two cases that are about the process
 *     boundary: a command that is genuinely not on `PATH`, and a real `git`
 *     failing outside a repository. An injected runner cannot prove either, and
 *     both are `Done when` lines.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  claims,
  clashes,
  collect,
  idsIn,
  nextFree,
  parseArgs,
  render,
  runCommand,
} from "../next-id.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO, "scripts", "next-id.mjs");

/**
 * A fake command runner over a scripted board.
 *
 * Keyed by the first two argv words, which is enough to tell `git ls-tree` from
 * `gh pr list` from `gh pr diff` without pretending to parse either CLI.
 */
function runner(board: {
  work?: string[];
  tools?: string[];
  prs?: Record<string, string[]>;
  fails?: { on: "git" | "pr list" | "pr diff"; status: number; partial?: string[] };
}) {
  const fails = board.fails;
  return (command: string, args: string[]): string => {
    const die = (status: number) => {
      // The shape that matters: a failure may already have written some of its
      // output. A runner that hands that partial text back is the defect.
      throw Object.assign(new Error(`${command} exited ${status}`), { exit: status });
    };
    if (command === "git") {
      if (fails?.on === "git") die(fails.status);
      const recursive = args.includes("-r");
      return `${(recursive ? (board.tools ?? []) : (board.work ?? [])).join("\n")}\n`;
    }
    if (args[1] === "list") {
      if (fails?.on === "pr list") die(fails.status);
      return `${Object.keys(board.prs ?? {}).join("\n")}\n`;
    }
    const pr = args[2] ?? "";
    if (fails?.on === "pr diff" && pr === Object.keys(board.prs ?? {})[0]) die(fails.status);
    return `${(board.prs?.[pr] ?? []).join("\n")}\n`;
  };
}

const sweep = (board: Parameters<typeof runner>[0], prefix = "repo") =>
  claims(collect(prefix, { run: runner(board) }), prefix);

const rows = (result: ReturnType<typeof sweep>) => result.map((r) => `${r.source} ${prefix(r)}`);
const prefix = (r: { id: number }) => `repo-${r.id}`;

/**
 * Case 1 — the structural defect, and the reason this ticket exists.
 *
 * The old snippet read `tools/<tool>/docs/work/` only, so a `repo-` sweep's
 * merged half matched nothing and the answer came from open pull requests
 * alone. Measured on `origin/main@24e5bf7`: 0 ids against 30.
 */
test("the merged half reads both ticket roots, not just the tool one", () => {
  const result = sweep({
    work: ["docs/work/repo-29-a.md", "docs/work/repo-30-b.md"],
    tools: ["tools/downloader/docs/work/dl-45-x.md", "tools/downloader/README.md"],
  });
  expect(rows(result)).toEqual(["merged repo-29", "merged repo-30"]);

  // The same board under a tool prefix has to come back out of the other root,
  // or "reads both" is only half-proven.
  const dl = claims(
    collect("dl", {
      run: runner({
        work: ["docs/work/repo-29-a.md"],
        tools: ["tools/downloader/docs/work/dl-45-x.md"],
      }),
    }),
    "dl",
  );
  expect(dl).toEqual([{ source: "merged", id: 45 }]);
});

/** A path outside a `work/` directory is not a ticket file and must not count. */
test("the tools root is filtered to docs/work, so a stray path is not a claim", () => {
  const result = sweep({ work: [], tools: ["tools/planner/docs/adr/repo-99-not-a-ticket.md"] });
  expect(result).toEqual([]);
});

/**
 * Case 2 — a pull request whose diff touches no ticket file is ordinary.
 *
 * In the shell version this was `grep`'s exit 1 on no match. Adding `pipefail`
 * without guarding it made the first such pull request abort the loop and take
 * every later pull request's ids with it, which is the trap that caught the
 * first cut at the repair.
 */
test("a pull request touching no ticket file does not truncate the sweep", () => {
  const result = sweep({
    work: ["docs/work/repo-30-b.md"],
    prs: {
      "900": ["CHANGELOG.md", "package.json"],
      "901": ["docs/work/repo-99-held.md"],
    },
  });
  expect(rows(result)).toEqual(["merged repo-30", "PR#901 repo-99"]);
});

/**
 * Case 3 — the clash, which is the whole point and the thing `sort -u` erased.
 *
 * `sort -u -t- -k2 -n` dedupes on the *key*, so two sources holding one id
 * collapsed into one line and the second claimant vanished.
 */
test("two sources holding one id both survive, and are named as a clash", () => {
  const result = sweep({
    work: ["docs/work/repo-30-b.md"],
    prs: {
      "902": ["docs/work/repo-30-b.md"],
      "901": ["docs/work/repo-99-a.md"],
      "903": ["docs/work/repo-99-b.md"],
    },
  });
  expect(rows(result)).toEqual([
    "PR#902 repo-30",
    "merged repo-30",
    "PR#901 repo-99",
    "PR#903 repo-99",
  ]);
  expect(clashes(result)).toEqual([
    { id: 30, sources: ["PR#902", "merged"] },
    { id: 99, sources: ["PR#901", "PR#903"] },
  ]);
  expect(render(result, "repo")).toContain("clash: repo-99 is claimed by PR#901, PR#903");
});

/**
 * The tie-break is by source name and not by input order.
 *
 * The shell version got this from GNU sort's last-resort whole-line comparison,
 * and a gate reviewer read the absent `-s` as a bug — backwards, since `-s`
 * disables that comparison. The reasoning does not survive the port, so the
 * property is asserted directly: the same rows in a different input order come
 * back identical.
 */
test("equal ids order by source, whatever order the sources arrived in", () => {
  const one = claims(
    [
      { source: "PR#903", paths: ["docs/work/repo-99-b.md"] },
      { source: "PR#901", paths: ["docs/work/repo-99-a.md"] },
    ],
    "repo",
  );
  const other = claims(
    [
      { source: "PR#901", paths: ["docs/work/repo-99-a.md"] },
      { source: "PR#903", paths: ["docs/work/repo-99-b.md"] },
    ],
    "repo",
  );
  expect(one).toEqual(other);
  expect(one.map((r) => r.source)).toEqual(["PR#901", "PR#903"]);
});

/**
 * Case 4 — a failing `gh pr list` must stop the sweep, not shorten it.
 *
 * The shell version inlined this into a `for` word list, where a failing
 * command substitution has its status discarded even under `set -e`: the sweep
 * printed the merged half and exited 0, which is the defect it had just been
 * rewritten to fix.
 */
test("a failing pr list stops the sweep rather than answering from merged alone", () => {
  expect(() =>
    sweep({ work: ["docs/work/repo-30-b.md"], fails: { on: "pr list", status: 1 } }),
  ).toThrowError(/exited 1/u);
});

/**
 * Case 5 — the partial-stdout case, raised by the gate reviewer.
 *
 * A real `gh` can write some of its output and then die. Taking that partial
 * text is the original defect in different clothes: a short list of ids,
 * indistinguishable from a correct one.
 */
test("a command that dies after writing part of its output contributes nothing", () => {
  expect(() =>
    sweep({
      work: ["docs/work/repo-30-b.md"],
      prs: { "900": ["docs/work/repo-77-partway.md"], "901": ["docs/work/repo-88-later.md"] },
      fails: { on: "pr diff", status: 1, partial: ["docs/work/repo-77-partway.md"] },
    }),
  ).toThrowError(/exited 1/u);
});

/**
 * Case 5, at the layer that actually holds the guard.
 *
 * The test above proves `collect` propagates a failure instead of swallowing
 * it, but the refusal to *read a failed command's stdout* lives in
 * `runCommand`, and a fake runner cannot pin it — the fake is the thing
 * deciding to throw. So this drives the real one against a real child that
 * writes a plausible ticket path and then dies. A real child rather than a
 * shell: the output has to come from a process, but it does not have to come
 * from `sh`.
 *
 * **The child is a file, not `node -e`, and the first draft of this test is the
 * reason.** With the program inline in argv, `repo-77` appeared in the thrown
 * message because the message echoes the arguments — so the assertion went red
 * against a guard that was working. An assertion that cannot tell leaked stdout
 * from an echoed argument is not checking the guard, so the payload is kept out
 * of argv entirely.
 */
test("runCommand discards the stdout of a command that failed after writing some", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-id-partial-"));
  const child = path.join(dir, "half.mjs");
  fs.writeFileSync(
    child,
    "process.stdout.write('docs/work/repo-77-partway.md\\n');\nprocess.exit(3);\n",
  );
  let caught: (Error & { exit?: number }) | null = null;
  try {
    runCommand(process.execPath, [child]);
  } catch (error) {
    caught = error as Error & { exit?: number };
  }
  expect(caught).not.toBeNull();
  // The child's own status is carried, so `concurrency.md`'s failure table keeps
  // meaning what it said when it was measured against the shell version.
  expect(caught?.exit).toBe(3);
  // And the partial line is nowhere in what the caller could act on. `half.mjs`
  // is in argv and so in the message; `repo-77` can only have come from stdout.
  expect(caught?.message).not.toContain("repo-77");
});

/** `nextFree` is the question a caller actually asks, and an empty board is 1. */
test("the next free id is one past the highest claim, from any source", () => {
  expect(nextFree([])).toBe(1);
  expect(
    nextFree(
      sweep({
        work: ["docs/work/repo-30-b.md"],
        prs: { "901": ["docs/work/repo-99-held.md"] },
      }),
    ),
  ).toBe(100);
});

test("idsIn dedupes within a source and treats the prefix as literal text", () => {
  expect(idsIn(["docs/work/repo-30-a.md", "docs/work/repo-30-a.md"], "repo")).toEqual([30]);
  // A prefix carrying a regex metacharacter must not become a pattern.
  expect(idsIn(["docs/work/a.b-7-x.md", "docs/work/axb-7-x.md"], "a.b")).toEqual([7]);
  // `repo-30` inside a longer number is 30, not 3.
  expect(idsIn(["docs/work/repo-301-x.md"], "repo")).toEqual([301]);
});

test("parseArgs demands a prefix and rejects an option with no value", () => {
  expect(() => parseArgs([])).toThrowError(/usage/u);
  expect(() => parseArgs(["repo", "--rev"])).toThrowError(/--rev needs a value/u);
  expect(parseArgs(["repo", "--rev", "HEAD"])).toEqual({
    prefix: "repo",
    repo: undefined,
    rev: "HEAD",
  });
});

/**
 * The two process-boundary cases, run against the real CLI.
 *
 * These are the `Done when` line "exits non-zero when `gh` or `git` fails,
 * rather than printing a short list — demonstrated by a run with the command
 * unavailable", and an injected runner cannot demonstrate it: the point is that
 * a command which is not there at all is caught. The exit codes are the child's
 * own, which keeps the failure table in `concurrency.md` true.
 */
function cli(args: string[], over: { cwd?: string; PATH?: string } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: over.cwd ?? REPO,
    env: { ...process.env, ...(over.PATH === undefined ? {} : { PATH: over.PATH }) },
  });
}

/**
 * A PATH holding everything the sweep needs except the one command named.
 *
 * The lookup walks `PATH` here rather than asking a shell `command -v`, because
 * spawning `sh -c` to build a fixture in the repo that forbids shells would be
 * a poor joke, and because a symlink farm is what makes the 127 real rather
 * than stubbed.
 */
function pathWithout(missing: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-id-path-"));
  const entries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const command of ["git", "gh"]) {
    if (command === missing) continue;
    const found = entries
      .map((entry) => path.join(entry, command))
      .find((candidate) => fs.existsSync(candidate));
    if (found) fs.symlinkSync(found, path.join(dir, command));
  }
  return dir;
}

test("a command that is not on PATH exits 127 and says which one", () => {
  const result = cli(["repo"], { PATH: pathWithout("gh") });
  expect(result.status).toBe(127);
  expect(result.stderr).toMatch(/gh/u);
  // The half that matters: it did not answer from the merged half alone.
  expect(result.stdout).toBe("");
});

test("git failing outside a repository exits non-zero rather than printing a short list", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "next-id-outside-"));
  const result = cli(["repo", "--repo", outside]);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/Refusing to answer from a partial file list/u);
});

test("the CLI reports usage and exits 1 with no prefix", () => {
  const result = cli([]);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/usage: node scripts\/next-id\.mjs/u);
});
