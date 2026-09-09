/**
 * The id sweep's guards, one test per guard, each watched failing first.
 *
 * repo-30's whole subject is that this sweep lived in a markdown fence for
 * months and was wrong the entire time, in ways that produced a *confident*
 * answer rather than an error. Each case below is a failure mode measured
 * against the shell version before the lift, and exists so that removing the
 * corresponding guard turns this file red instead of turning the board silently
 * wrong. No count is written here on purpose: the guard set grew once already,
 * and a number in a docblock is a fact with nothing keeping it true.
 *
 * Two layers, deliberately:
 *
 *   - **injected runner** for everything about how a failure propagates. A fake
 *     `run` is exact — it can die after writing half its output, which is the
 *     one case a `PATH` stub cannot express — and it is the same seam the CLI
 *     itself uses, not a test-only branch.
 *   - **the real CLI, spawned**, for the cases that are about the process
 *     boundary: a command genuinely not on `PATH`, a real `git` failing outside
 *     a repository, and a checkout with no `origin/main`. An injected runner
 *     cannot prove any of them, and they are `Done when` lines.
 *
 * **A CLI test's fixture has to establish the condition it names, and this file
 * learned that from CI rather than from care.** The `PATH`-farm test asserted
 * `gh`-absent-is-127 and passed five times across two machines without ever
 * spawning `gh`: every one of those checkouts had an `origin/main`, and the
 * runner's did not, so `git` failed 128 first. See the case itself for the
 * repro. The rule it earned is that these tests assert *which* child failed
 * before they assert a number.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  branchSources,
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
 * The scripted board's stand-in for an object store.
 *
 * The branch half of the sweep needs shas: `ls-remote` returns them and
 * `cat-file` and `diff` are then handed them back. Making them derivable —
 * `sha-<branch>` — lets the fake answer a question *about an object* without
 * owning one. A fixture branch must therefore not itself contain `sha-`.
 */
const shaOf = (name: string) => `sha-${name}`;
const branchIn = (arg: string) => arg.replace(/^.*sha-/u, "").replace(/\^\{commit\}$/u, "");

/**
 * A fake command runner over a scripted board.
 *
 * Keyed by the first two argv words, which is enough to tell `git ls-tree` from
 * `git ls-remote` from `gh pr list` from `gh pr diff` without pretending to
 * parse either CLI.
 */
function runner(board: {
  work?: string[];
  tools?: string[];
  prs?: Record<string, string[]>;
  /** Branch name → the files that branch adds over `rev`, as a diff lists them. */
  branches?: Record<string, string[]>;
  /** Branches the remote names but whose commit this checkout does not hold. */
  unfetched?: string[];
  fails?: {
    on: "git" | "ls-remote" | "pr list" | "pr diff";
    status: number;
    partial?: string[];
  };
}) {
  const fails = board.fails;
  return (command: string, args: string[]): string => {
    const die = (status: number, message?: string) => {
      // The shape that matters: a failure may already have written some of its
      // output. A runner that hands that partial text back is the defect.
      throw Object.assign(new Error(message ?? `${command} exited ${status}`), { exit: status });
    };
    if (command === "git") {
      if (fails?.on === "git") die(fails.status);
      if (args[0] === "ls-remote") {
        if (fails?.on === "ls-remote") die(fails.status);
        return `${Object.keys(board.branches ?? {})
          .map((name) => `${shaOf(name)}\trefs/heads/${name}`)
          .join("\n")}\n`;
      }
      if (args[0] === "cat-file") {
        const name = branchIn(args[2] ?? "");
        // Real git's exact wording, because the script matches on it to tell
        // "this branch was never fetched" from "this repository is broken", and
        // a fake that invents its own phrasing would prove the wrong thing.
        if ((board.unfetched ?? []).includes(name)) {
          die(128, `fatal: Not a valid object name ${shaOf(name)}^{commit}`);
        }
        return "";
      }
      if (args[0] === "diff") {
        return `${(board.branches?.[branchIn(args.at(-1) ?? "")] ?? []).join("\n")}\n`;
      }
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
 * Case 9 — repo-41: a pushed branch carrying no open pull request.
 *
 * The transcript in repo-41's Why, as a fixture. On `main` at `a5e31c7` the
 * sweep printed `next free: repo-39` while `docs/work/repo-39-….md` was already
 * committed and pushed on `repo-37-anchor-planner-review-corpus` — a branch that
 * had not merged and had no pull request, so neither of the two sources the tool
 * read could see it.
 *
 * The branch's *name* is deliberately not enough here, which is the whole point:
 * it says `repo-37` and the file it holds says `repo-39`. A sweep that read
 * branch names would still have answered 39 and still been wrong, for the same
 * reason `concurrency.md` gives about commit subjects and pull request titles.
 */
test("a pushed branch with no pull request claims the ids in its diff, not just its name", () => {
  const result = sweep({
    work: ["docs/work/repo-37-a.md", "docs/work/repo-38-b.md"],
    prs: { "197": ["docs/work/repo-38-b.md"] },
    branches: {
      "repo-37-anchor-planner-review-corpus": [
        "docs/work/repo-39-the-unanchored-half-of-the-review-corpus.md",
      ],
      // `main` is a head like any other, and its diff against `rev` is empty —
      // which is why the source is a diff and not an `ls-tree`. A tree listing
      // would re-report every merged id here and clash with `merged` on all of
      // them.
      main: [],
    },
  });
  expect(rows(result)).toEqual([
    "branch/repo-37-anchor-planner-review-corpus repo-37",
    "merged repo-37",
    "PR#197 repo-38",
    "merged repo-38",
    "branch/repo-37-anchor-planner-review-corpus repo-39",
  ]);
  // The `Done when` line: 39 was the answer before, and it was taken.
  expect(nextFree(result)).toBe(40);
  expect(render(result, "repo")).toContain("next free: repo-40");
});

/**
 * The honest half of case 9, and the reason the fix does not claim to close the
 * race: `ls-remote` names a branch whose commit this checkout does not hold, and
 * no amount of local git can read that branch's files.
 *
 * So the branch still becomes a source — its *name* is a claim, and a coarse
 * claim beats none — and the run says out loud that it read only the name. The
 * assertion on `nextFree` is deliberate: `repo-45` is in that branch's diff and
 * is still handed out. That is the limit, written down rather than implied.
 */
test("a branch the remote names but this checkout has not fetched is reported, not dropped", () => {
  const sources = collect("repo", {
    run: runner({
      work: ["docs/work/repo-30-b.md"],
      branches: { "repo-44-a-peer-just-pushed": ["docs/work/repo-45-also-held.md"] },
      unfetched: ["repo-44-a-peer-just-pushed"],
    }),
  });
  const branch = sources.find((source) => source.source.startsWith("branch/"));
  expect(branch?.paths).toEqual(["repo-44-a-peer-just-pushed"]);
  expect(branch?.note).toMatch(/repo-44-a-peer-just-pushed/u);
  expect(branch?.note).toMatch(/git fetch origin/u);

  const result = claims(sources, "repo");
  expect(rows(result)).toEqual(["merged repo-30", "branch/repo-44-a-peer-just-pushed repo-44"]);
  expect(nextFree(result)).toBe(45);
});

/**
 * The sharpest case, and the one that decides where the note lives.
 *
 * A branch named `wip-…` holding `docs/work/repo-50-….md`, not yet fetched,
 * claims **no id at all** — the name carries none and the files cannot be read.
 * If the warning were folded into a source label it would print only when that
 * source produced a row, so this exact branch would be silent, which is the
 * defect the ticket is about wearing one more costume. It is a line of its own
 * instead, and it survives an empty board.
 */
test("an unread branch is printed even when it claimed no id at all", () => {
  const sources = collect("repo", {
    run: runner({
      branches: { "wip-no-id-in-the-name": ["docs/work/repo-50-invisible.md"] },
      unfetched: ["wip-no-id-in-the-name"],
    }),
  });
  const notes = sources.flatMap((source) => (source.note ? [source.note] : []));
  expect(notes).toHaveLength(1);

  const out = render(claims(sources, "repo"), "repo", notes);
  expect(out).toContain("wip-no-id-in-the-name");
  expect(out).toContain("next free: repo-1");
});

/**
 * The branch source gets the same refusal every other source has: a failing
 * `git ls-remote` stops the sweep rather than answering from the two sources
 * that did work. Offline, that is what happens, and a confident short answer is
 * exactly the failure this file exists for.
 */
test("a failing ls-remote stops the sweep rather than answering from merged and PRs alone", () => {
  expect(() =>
    sweep({
      work: ["docs/work/repo-30-b.md"],
      prs: { "901": ["docs/work/repo-99-held.md"] },
      branches: { "repo-44-x": [] },
      fails: { on: "ls-remote", status: 128 },
    }),
  ).toThrowError(/exited 128/u);
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
 * than stubbed. A farm is also the only option that works when the two commands
 * share a directory, which on this box they do (`/usr/bin/git`, `/usr/bin/gh`)
 * — filtering `PATH` by directory would take `git` out with `gh`.
 *
 * **The link keeps the resolved file's own name, extension included.** A link
 * named `git` pointing at `git.exe` is invisible to Windows' `PATHEXT` lookup,
 * which is the same shebang-and-shims hazard `.claude/rules/testing.md` records
 * against `node_modules/.bin`. Getting it wrong does not fail loudly: the farm
 * silently provides neither command and the sweep's *first* call is the one
 * that dies, which is a different test than the one that is written.
 */
/**
 * A fixture-repository command that insists it worked.
 *
 * Shared by the two cases below that build a real remote, and asserted rather
 * than ignored: a fixture step that fails quietly leaves the case measuring a
 * repository it did not build. Identity on the flags because these are made
 * inside a `mkdtemp`, where no user config is guaranteed.
 */
const runGit = (cwd: string, args: string[]) => {
  const result = spawnSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args],
    {
      cwd,
      encoding: "utf8",
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, `git ${args.join(" ")}\n${result.stderr}`).toBe(0);
  return result.stdout;
};

function pathWithout(missing: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-id-path-"));
  const entries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = ["", ".exe", ".cmd", ".bat"];
  for (const command of ["git", "gh"]) {
    if (command === missing) continue;
    const found = entries
      .flatMap((entry) => extensions.map((ext) => path.join(entry, command + ext)))
      .find((candidate) => fs.existsSync(candidate));
    if (found) fs.symlinkSync(found, path.join(dir, path.basename(found)));
  }
  return dir;
}

/**
 * Case 6 — a command that is not installed at all.
 *
 * **This test is the branch's one CI failure, and the reason is worth more than
 * the fix.** It passed here three times and on the reviewer's box twice, then
 * came back `expected 128 to be 127` on both `ubuntu-latest` and
 * `windows-latest`. Nothing about `gh` had changed: a default `actions/checkout`
 * fetches one commit and creates **no remote-tracking refs**, so `git ls-tree
 * origin/main` failed 128 before `gh` was ever spawned. Every local run had an
 * `origin/main` to read, so the assertion had never once observed the thing its
 * own name describes. Reproduced by rebuilding that checkout — `git init`, a
 * depth-1 fetch of one sha, no `origin/main` — which returns 128 with the
 * default rev and 127 with `--rev HEAD`.
 *
 * So two changes, and neither is a loosened assertion. `--rev HEAD` makes the
 * *other* command succeed, which is what the fixture always had to do for this
 * test to mean anything. And the assertions now name which child failed, so if
 * the farm ever stops providing `git` this fails saying so instead of passing
 * on a coincidence — a bare `toBe(127)` is satisfied by `git` being missing too.
 */
test("a command that is not on PATH exits 127 and says which one", () => {
  const result = cli(["repo", "--rev", "HEAD"], { PATH: pathWithout("gh") });
  expect(result.error).toBeUndefined();
  // Which child died, asserted before the number: `git` failing would also be
  // a non-zero exit, and this test would be measuring the fixture, not the code.
  expect(result.stderr).toMatch(/^gh:/mu);
  expect(result.stderr).not.toMatch(/git ls-tree/u);
  expect(result.status).toBe(127);
  // The half that matters: it did not answer from the merged half alone.
  expect(result.stdout).toBe("");
});

/**
 * The other half of the same discovery: a checkout with no `origin/main` is the
 * ordinary state on a runner, so the default rev has to fail *legibly* rather
 * than just non-zero. It must not fall back to `HEAD` — answering confidently
 * from a different tree is this ticket's defect in one more costume.
 */
test("a missing default rev keeps git's status and says how to fix it", () => {
  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), "next-id-shallow-"));
  for (const args of [
    ["init", "-q"],
    [
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    ],
  ]) {
    expect(spawnSync("git", args, { cwd: shallow, encoding: "utf8" }).status).toBe(0);
  }
  const result = cli(["repo", "--repo", shallow]);
  expect(result.status).toBe(128);
  expect(result.stderr).toMatch(/origin\/main` is not in this checkout/u);
  expect(result.stderr).toMatch(/--rev HEAD/u);
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

/**
 * Case 9 against real git, over a real remote that is a fixture.
 *
 * The injected-runner cases above prove `collect` wires the source up and
 * reports it. They cannot prove the two facts that decided the sweep's shape,
 * because a fake decides its own answers: that `git ls-remote --heads` sees a
 * branch this checkout's `refs/remotes/` does not, and that git really does
 * refuse to read the files of a sha it holds no object for.
 *
 * A **fixture** remote and not `origin`, per repo-41's Build step 3 — the real
 * one moves, and the reproduction in that ticket's Why expires the moment a pull
 * request opens on the branch it names.
 *
 * Both halves of one fixture, in order, so the branch is the same branch: the
 * clone reads it before fetching and then after.
 *
 * Not through the CLI, deliberately. `collect` also calls `gh pr list`, which
 * cannot answer about a local bare repository, so driving this end to end would
 * need a stubbed `gh` on `PATH` and would be measuring the stub. `branchSources`
 * is the seam the CLI itself uses, not a test-only branch.
 */
test("against a real fixture remote, an unfetched branch is named and a fetched one is read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-id-remote-"));
  const bare = path.join(dir, "remote.git");
  const peer = path.join(dir, "peer");
  const mine = path.join(dir, "mine");
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(peer, file)), { recursive: true });
    fs.writeFileSync(path.join(peer, file), text);
  };

  // `trunk`, not `main`: nothing here depends on the name, and this repo denies
  // a push to `main` by hook — a fixture that also runs cleanly by hand is worth
  // more than a realistic branch name.
  runGit(dir, ["init", "-q", "--bare", "-b", "trunk", bare]);
  runGit(dir, ["clone", "-q", bare, peer]);
  write("docs/work/repo-1-seed.md", "seed\n");
  runGit(peer, ["add", "-A"]);
  runGit(peer, ["commit", "-qm", "seed"]);
  runGit(peer, ["push", "-q", "origin", "trunk"]);
  runGit(dir, ["clone", "-q", bare, mine]);

  // The reproduction's shape: the id is in the file, not in the branch name.
  runGit(peer, ["checkout", "-q", "-b", "some-unrelated-slug"]);
  write("docs/work/repo-9-held.md", "held\n");
  runGit(peer, ["add", "-A"]);
  runGit(peer, ["commit", "-qm", "file a ticket"]);
  runGit(peer, ["push", "-q", "origin", "some-unrelated-slug"]);

  // Before `mine` fetches. The local mirror does not have the branch at all,
  // which is the measurement that ruled out sweeping `refs/remotes/`; the remote
  // does, and its object is absent, so only the name is readable — and in this
  // fixture the name holds no id, which is exactly why the note has to exist.
  expect(runGit(mine, ["for-each-ref", "--format=%(refname)", "refs/remotes/"])).not.toContain(
    "some-unrelated-slug",
  );
  const before = branchSources({ cwd: mine, rev: "origin/trunk" });
  const unread = before.find((source) => source.source === "branch/some-unrelated-slug");
  expect(unread?.paths).toEqual(["some-unrelated-slug"]);
  expect(unread?.note).toMatch(/some-unrelated-slug/u);
  expect(claims(before, "repo")).toEqual([]);

  // After it fetches, that branch's own diff carries `repo-9`, which no name
  // anywhere says. `trunk` is a head too and contributes nothing, because its
  // diff against `rev` is empty — the property that makes the trunk head
  // self-excluding instead of a special case.
  runGit(mine, ["fetch", "-q", "origin"]);
  const after = branchSources({ cwd: mine, rev: "origin/trunk" });
  const read = after.find((source) => source.source === "branch/some-unrelated-slug");
  expect(read?.note).toBeUndefined();
  expect(read?.paths).toContain("docs/work/repo-9-held.md");
  expect(claims(after, "repo")).toEqual([{ source: "branch/some-unrelated-slug", id: 9 }]);
});

/**
 * The hazard the diff choice brought with it, and the reason it has a fallback.
 *
 * A branch that shares no history with `rev` — `gh-pages` and its kin — makes
 * the symmetric difference fatal, measured: `git diff --name-only
 * origin/trunk...<sha>` returns `fatal: … no merge base`, exit 128. Left alone
 * that takes the *whole* sweep down, so one orphan branch on the remote would
 * turn a working tool into one that answers nothing at all.
 *
 * Its own fixture rather than a fourth branch on the one above, because these
 * cases spawn real git and the Windows runner charges roughly two orders of
 * magnitude per spawn (see the project's `testTimeout` note in
 * `vitest.config.ts`); the case above measures 105 ms here.
 *
 * `peer` reads its own remote, which saves a clone: it already holds every
 * object, and this case is about history shape rather than about what has been
 * fetched.
 */
test("a branch sharing no history with the rev over-claims rather than killing the sweep", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-id-orphan-"));
  const bare = path.join(dir, "remote.git");
  const peer = path.join(dir, "peer");
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(peer, file)), { recursive: true });
    fs.writeFileSync(path.join(peer, file), text);
  };

  runGit(dir, ["init", "-q", "--bare", "-b", "trunk", bare]);
  runGit(dir, ["clone", "-q", bare, peer]);
  write("docs/work/repo-1-seed.md", "seed\n");
  runGit(peer, ["add", "-A"]);
  runGit(peer, ["commit", "-qm", "seed"]);
  runGit(peer, ["push", "-q", "origin", "trunk"]);

  runGit(peer, ["checkout", "-q", "--orphan", "orphan-pages"]);
  runGit(peer, ["rm", "-rq", "--cached", "."]);
  fs.rmSync(path.join(peer, "docs/work/repo-1-seed.md"));
  write("docs/work/repo-77-orphan.md", "page\n");
  runGit(peer, ["add", "-A"]);
  runGit(peer, ["commit", "-qm", "orphan"]);
  runGit(peer, ["push", "-q", "origin", "orphan-pages"]);

  const sources = branchSources({ cwd: peer, rev: "origin/trunk" });
  const orphan = sources.find((source) => source.source === "branch/orphan-pages");
  expect(orphan?.note).toMatch(/shares no history/u);
  expect(orphan?.paths).toContain("docs/work/repo-77-orphan.md");
  // The cost of the fallback, asserted rather than hidden: a two-dot diff lists
  // every file that differs, so a file the orphan *deletes* is claimed too. Per
  // `idsIn`'s docblock that is the cheap error, and `repo-1` is already merged,
  // so it surfaces as a clash rather than as a lost id.
  expect(claims(sources, "repo")).toEqual([
    { source: "branch/orphan-pages", id: 1 },
    { source: "branch/orphan-pages", id: 77 },
  ]);
});
