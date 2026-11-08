---
id: repo-137
tool: repo
title: The farm's freshness remedy names an install the pages forbid, and has no case for a stacked branch
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-137 — The farm's freshness remedy names an install the pages forbid, and has no case for a stacked branch

## Why

`.claude/scripts/check-farm-freshness.mjs`, run by the farm in a worktree,
prints a remedy when the shared checkout lacks a package the worktree's lockfile
declares: _"If this branch's own diff adds the package, the one `npm install
--ignore-scripts` from `common.md` applies; otherwise, stop and report it"_.
Two things are wrong with it.

**The install it names is now forbidden.** On 2026-11-01 (tools-e6's log, item

1. a builder's `npm install --ignore-scripts` in a farmed worktree rewrote
   `node_modules/.bin` and `node_modules/.package-lock.json` for every concurrent
   agent, because the farm makes both of those symlinks into the shared checkout; a
   gate's build in the same minute read `sh: 1: tsc: not found`. The 2026-11-01
   review of the orchestration log rewrote `roles/common.md`'s dependency bullet
   around that measurement: never install in a farmed worktree; a version change
   or a new package is a relock (`--package-lock-only --ignore-scripts`), and the
   pull request's CI is the run on the new version. The script's remedy still
   sends an agent to the install.

**It has no case for a stacked branch.** A branch cut from a sibling that added
a package warns `missing N package(s)` with the parent's packages, and the
remedy's two cases — "your diff adds it" and "otherwise stop" — fit neither:
the diff against the parent adds nothing, and stopping is wrong when the parent
is the cause (repo-123 on repo-121, 2026-10-25; tools-5e's log, item 10).

## Reproduction

The remedy text, on `main` at `8ad4e91d`:

```
$ grep -n "npm install --ignore-scripts" .claude/scripts/check-farm-freshness.mjs
140:      "If this branch's own diff adds the package, the one `npm install --ignore-scripts` " +
$ grep -n "npm install --ignore-scripts" scripts/test/check-farm-freshness.test.ts
679:      expect(result.stderr).toContain("npm install --ignore-scripts");
```

The farm's two symlinks, in any farmed worktree (read 2026-11-01 in
`.claude/worktrees/agent-a8e5358889b5d274e`):

```
$ ls -la node_modules | grep -E '\.bin|package-lock'
lrwxrwxrwx  1 pwuser pwuser    35 Nov  1 13:04 .bin -> /workspaces/tools/node_modules/.bin
lrwxrwxrwx  1 pwuser pwuser    49 Nov  1 13:04 .package-lock.json -> /workspaces/tools/node_modules/.package-lock.json
```

The stacked case (relayed from repo-123's builder and lander, 2026-10-25, not
re-run): farming on a branch cut from `origin/repo-121-vite-8-vitest-5` →
`warning: … is missing 3 package(s)` and the remedy above.

## Decision — answered 2026-11-01 by the owner

**Answer: (a)**, no install in a farmed worktree, chosen from (a) and (b)
below with (a) recommended (corrected 2026-11-08: this sentence said "(a), (b)
and (c)" when only (a) and (b) were ever listed); `roles/common.md`'s dependency bullet stands as the
review wrote it. Rated `mechanical` as filed. The options stay as they were put.

Which rule the remedy follows. `roles/common.md` was written under (a) by the
2026-11-01 review, pending this answer; (b) would change it back.

- **(a) No install in a farmed worktree, ever.** A dependency change is a
  relock, the tree runs the old version, and the draft pull request's CI runs
  the new one; a gate reads that CI. The remedy's cases become: the package is
  the one your relock added (expected, say so), or it is `main`'s or a parent
  branch's (stop and report, naming the packages). Recommended: it needs no
  script beyond this one, and it is what the two batches that followed the rule
  measured as safe. Its cost is that a `Done when` line about the new version
  is `unproven (gate)` until CI reads, for the builder and the gate alike.
- **(b) The farm learns to make an install local.** A `--own-deps` mode (or a
  flag on the install step) replaces `.bin` and `.package-lock.json` with real
  copies before an install, so npm writes in the worktree; native modules
  (`better-sqlite3`) still come out unbuilt and need their `build/` copied from
  the shared checkout. A branch can then run its new version locally. Cost: a
  farm change, its test, and a procedure with two more steps that every
  dependency builder pays; untested whether npm leaves the per-package symlinks
  alone when it reifies a changed version.

## Build

1. Rewrite the remedy in `.claude/scripts/check-farm-freshness.mjs` under the
   chosen option, with the stacked-branch case named: when the worktree's
   lockfile matches no `origin/main`, the packages are a parent branch's or
   the agent's own relock, and the text says which to do for each.
2. Update the assertions in `scripts/test/check-farm-freshness.test.ts` (the
   block around line 679) to the new text, and add one case for a worktree
   whose lockfile differs from the shared checkout's by a package the branch
   itself declares.
3. If (b): the farm mode, its header comment, and `roles/common.md`'s
   dependency bullet reworded to name it — that page edit is the owner's, in
   this ticket's pull request.

## Done when

1. The remedy printed for a worktree whose lockfile declares a package the
   shared checkout lacks names no `npm install`, and names what to do when the
   package is the branch's own relock and when it is a parent branch's.
2. `scripts/test/check-farm-freshness.test.ts` asserts 1 and
   `npm test -- --project repo` passes.
3. The text agrees with `roles/common.md`'s dependency bullet word for word on
   what is allowed.

## Review

**Gate: FAIL** — 2026-11-08 · `4a9b8af4..483f9adb` · Sonnet 5.5, depth narrow

Range read as `git diff 4a9b8af4...483f9adb`, ticket file excluded: `.claude/scripts/check-farm-freshness.mjs` and `scripts/test/check-farm-freshness.test.ts`. Build skipped: the diff imports only `node:` builtins and `vitest`. Pull request #765 at this head: `check`, `pr-title`, `codeql`, `changes`, `dependency-review`, `test (ubuntu-latest)` and `CodeQL` all SUCCESS; `test (windows-latest, informational)` was IN_PROGRESS when read.

| Done when                                                                                                                                                                                           | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The remedy printed for a worktree whose lockfile declares a package the shared checkout lacks names no `npm install`, and names what to do for the branch's own relock and for a parent branch's | **proven** for "no `npm install`" and the parent's stop: `scripts/test/check-farm-freshness.test.ts` › "worktree-farm.sh names a package the worktree's lockfile declares and a healthy shared checkout lacks, without telling the reader to install in the worktree" (`not.toContain("npm install")`, beside `toContain` assertions that fail on empty stderr, and `toContain("stop and report it to the orchestrator")`). The own-relock action ("say so in your report and go on") is **verified** by running the script on a scratch tree and reading the line; no test asserts it (F1) |
| 2. The spec asserts 1, and `npm test -- --project repo` passes                                                                                                                                      | **unproven** — clause "asserts 1": the own-relock action and the direction of the discriminator are asserted by nothing (F1). The other clause is met: `npx vitest run scripts/test/check-farm-freshness.test.ts` 29 of 29; `npm test -- --project repo` 15 of 15 files, 630 passed, 1 skipped (631), exit 0                                                                                                                                                                                                                                                                                |
| 3. The text agrees with `roles/common.md`'s dependency bullet word for word on what is allowed                                                                                                      | **verified** by reading, and by running the dispatch's four cases (own relock, parent's package, own relock on a stacked branch, main's package) through the remedy's test. All seven allowances on the page are in the text and the text adds none. One edge where the outcome rests on the agent naming the right `<base>` is F2                                                                                                                                                                                                                                                          |

- **med** · a `Done when` line depends on it (2) · the new spec does not assert what the remedy tells the agent to do for the own-relock case, nor which way its test points. Deleting `say so in your report and go on, and `, `naming the packages`, `copy no other agent's node_modules into this worktree`, the orchestrator-owns-the-install sentence, the one-lockfile-write sentence or `the draft pull request's CI is the reading` from the printed remedy each leaves `check-farm-freshness.test.ts` at 29 of 29. So does swapping the two conditions (`does not declare it, this branch's own relock added it` becomes `declares it, ...`, and `If the base declares it, it came from main or a parent branch: stop` becomes `If the base does not declare it, ...`): 29 of 29, exit 0. The new test's title says it "tells a branch's own relock from a base's package", and it asserts that five substrings are present somewhere. Fix, fully stated: in both tests that read the remedy (the farm end-to-end one and the direct `--worktree-packages` one) add `toContain("does not declare it, this branch's own relock added it, which is expected: say so in your report and go on")` and `toContain("If the base declares it, it came from main or a parent branch: stop and report it to the orchestrator, naming the packages")`. Run against the printed remedy, the two pass on the head and catch the first deletion, `naming the packages` and the inversion; the other four deletions (no copy of another agent's `node_modules`, the orchestrator's install, the one lockfile write, the CI reading) stay unasserted, which `Done when` 1 does not ask for.
- **low** · no `Done when` line depends on it · the remedy's test is only as good as the `<base>` the agent picks. The text says "origin/main, or the parent branch on a stacked branch": with the parent it classifies correctly (cases b and c in the full report); with `origin/main` on a stacked branch it prints "own relock, expected, go on" for the parent's package (case b2), where `common.md` says stop and report. `roles/builder.md` names `origin/main` as a stacked branch's `--base` while `reference/concurrency.md` opens the stacked draft against its parent. The script cannot know the parent, so this is a direction, not a script fix.
- **dropped** · case c (a stacked branch whose own relock adds `c` while the parent added `b`) prints "go on" for `c` and "stop" for `b` in one text, which could read as permission to go on. Dropped: the stop clause says "naming the packages", `common.md` has the same shape, and the outcome the page prescribes (stop, name `b`) is what the text leads to.
- **findings** · the attacks returned 3; 2 carried (the med and the low), 1 dropped.
- NFR: security n/a (text and a test; no URL, header or subprocess path touched) · performance n/a · reliability ✓ (the warning stays advisory, `worktree-farm.sh` still discards its exit code) · maintainability — F1 above.

FAIL on one row alone: `Done when` 2 is `unproven` from the one `med`. Nothing found is a `high`. The `--packages` remedy and its test are unchanged.

## Log

- 2026-11-01 — Filed by the review of the orchestration log (tools-5e's items
  2 and 10, tools-18's item 2, tools-97's item 3, tools-54 third's item 2,
  tools-e6's items 1 to 3). The symlink reading and the remedy grep are re-run
  on `main` at `8ad4e91d`; the stacked case is relayed.
- 2026-11-01 — Owner chose (a) at the review session's checkpoint (asked beside
  repo-135's question); `status` moved to `ready` in the same commit. Build 3
  does not apply.
- 2026-11-08 — Built on `4a9b8af4` (branch `repo-137-farm-remedy`) under answer
  (a). Build 3 does not apply: `roles/common.md`'s dependency bullet already reads
  as (a) and is unchanged.
  - Reproduction, re-run: the ticket's `8ad4e91d` is no longer `main`, so the
    grep ran on `4a9b8af4`:
    `git show 4a9b8af4:.claude/scripts/check-farm-freshness.mjs | grep -n "npm install --ignore-scripts"`
    printed line 140, the worktree remedy's `"If this branch's own diff adds the
    package, the one npm install --ignore-scripts"` string. On the branch that
    grep finds nothing. `grep -n "npm install" .claude/scripts/check-farm-freshness.mjs`
    finds three lines, all allowed: the header comment (line 7), the `--packages`
    remedy for the shared checkout (line 154, the orchestrator's install), and a
    comment above the workspaces pass (line 170).
  - Build 1: the worktree remedy names no `npm install`. It says no install runs
    in a worktree; a package the dispatch's base lockfile does not declare is this
    branch's own relock (expected, say so, go on); one it declares came from main
    or a parent branch (stop and report, naming the packages). The base is the
    one the dispatch names, which the script cannot know, so the check is text the
    agent runs (`git show <base>:package-lock.json`), not a comparison in the
    script. Output on a fixture tree declaring `@anthropic-ai/sdk` and holding no
    `node_modules` entry for it: `exit 1`, with the remedy line.
  - Build 2: the existing `worktree-farm.sh names a package the worktree's lockfile
    declares and a healthy shared checkout lacks` case already is the
    "lockfile differs from the shared checkout's by a package the branch declares"
    shape; its assertions moved to the new text. The added case is the direct
    `--worktree-packages` one, `…tells a branch's own relock from a base's package…`.
    Against the base script both cases fail (`2 failed | 27 passed`, the two named
    above); on the branch `29 passed`.
  - Done when 1: the remedy names no `npm install` (test asserts
    `not.toContain("npm install")`), and names both cases (own relock; main's or a
    parent branch's). Verdict: met.
  - Done when 2: `npx vitest run scripts/test/check-farm-freshness.test.ts`,
    `29 of 29`; `npm test -- --project repo`, `Tests 630 passed | 1 skipped (631)`,
    `Test Files 15 passed (15)`, exit 0. `npm run check` exit 0.
  - Done when 3: the remedy's allowances match `roles/common.md`'s dependency
    bullet: no install in a worktree; the relock is the one lockfile write; own
    relock expected; main's or a parent's stop and report; the install is the
    orchestrator's. Verdict: met on reading; `roles/common.md` was not edited.
  - Correction: the Decision's "chosen from (a), (b) and (c)" listed two options.
  - Fold-in: none. `worktree-farm.sh` prints no install remedy (grep above).
  - Not measured: the stacked-branch case itself (relayed, not re-run); CI on the
    draft pull request (not read).
- 2026-11-08 — Round 1, after gate 1 (`483f9adb`): fixer, `c838d031`. Gate 1's
  medium: the spec asserted five substrings present somewhere, so swapping the two
  conditions left it at `29 of 29`. Fixed: both tests that read the remedy (the
  farm end-to-end one and the direct `--worktree-packages` one) now assert
  `does not declare it, this branch's own relock added it, which is expected: say
  so in your report and go on` and `If the base declares it, it came from main or
  a parent branch: stop and report it to the orchestrator, naming the packages`.
  - Proof: with the gate's `mutate-invert.mjs` run on the committed tree (the
    discriminator inverted in the script), `npx vitest run
    scripts/test/check-farm-freshness.test.ts` printed `2 failed | 27 passed (29)`,
    exit 1; restored with `git checkout c838d031 -- <path>`, `29 passed (29)`.
  - Owner answers (2026-11-08, the owner, via the orchestrator):
    1. Gate 1's open decision, whether to assert the other four allowances (no copy
       of another agent's `node_modules`, the orchestrator's install, the one
       lockfile write, the CI reading) too. Options: (1, recommended) the two
       assertions above only, since `Done when` 1 and 2 ask for nothing else; (2)
       also assert the four. The owner chose option 1; the four stay unasserted.
    2. The builder's open decision, whether `roles/common.md`'s dependency bullet
       should name the base-lockfile test (`git show <base>:package-lock.json`).
       Options: put it on the next review session's list (the orchestrator's
       recommendation), leave the page as is, or file a `repo-` ticket now. The
       builder had recommended adding the clause. The owner chose to put it on the
       review list: no page edit and no ticket.
  - Not part of this round: gate 1's low (the remedy is only as good as the
    `<base>` the agent picks), which stays recorded.
