---
id: repo-117
tool: repo
title: The farm links only the workspaces the shared checkout has, and the freshness check cannot see a missing one
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-117 — The farm links only the workspaces the shared checkout has, and the freshness check cannot see a missing one

## Why

`.claude/scripts/worktree-farm.sh` recreates whatever `/workspaces/tools/node_modules`
holds, and `.claude/scripts/check-farm-freshness.mjs` compares that directory with the
shared checkout's own `package-lock.json`, skipping every `link: true` entry by the
repo-45 decision. So a workspace that `main` added after the shared checkout's last
`npm install` is linked by nobody and warned about by nobody: `packages/ui` (repo-108,
merged 2026-10-19 as `da4673e1`) was missing from every farmed worktree for two days,
and every agent of four batches — over twenty builders, gates and landers — hit
`Rollup failed to resolve import "@webtools/ui/tokens.css"` on `npm run build` and ran
`ln -s ../../packages/ui node_modules/@webtools/ui` by hand (orchestration log entries
tools-11, tools-dd, tools-8e, tools-cc and tools-49, 2026-10-20 to 2026-10-24). A link
appeared in the shared checkout on 2026-10-21 02:21 and the symptom stopped; the cause
stands, and recurs the next time a workspace is added.

Reproduction, recorded at the shared checkout on `00977771` and again on `2d1b22bb` and
`93bfa1f1`:

```
$ node .claude/scripts/check-farm-freshness.mjs /workspaces/tools; echo exit=$?
exit=0
$ ls /workspaces/tools/node_modules/@webtools/
core
$ grep -n '"node_modules/@webtools/ui"' package-lock.json
3090:    "node_modules/@webtools/ui": {
$ # in a farmed worktree at da4673e1 or later
$ bash /workspaces/tools/.claude/scripts/worktree-farm.sh
farm built: 402 top-level entries in …/node_modules
$ npm run build
… Rollup failed to resolve import "@webtools/ui/tokens.css" …
```

The check reads the shared checkout's lockfile, so a shared checkout behind
`origin/main` passes while a worktree on `main` misses a workspace:
`git show origin/main:package-lock.json | grep -c '"packages/ui"'` → `2` beside
`grep -c '"packages/ui"' package-lock.json` → `0` on 2026-10-20.

## Build

1. In `worktree-farm.sh`, after the copy loop, read the worktree's own root
   `package.json` `workspaces` globs, resolve each workspace directory's `name`,
   and create the `node_modules/<name>` link relative to the worktree
   (`../../packages/<dir>` or `../../tools/<tool>/<dir>`) wherever the copy loop
   left none. The shared checkout's links stay the template for everything else.
2. In `check-farm-freshness.mjs`, keep the repo-45 scope for fetched packages, and
   add a second pass over the worktree's workspaces: a workspace with no
   `node_modules/<name>` link after the farm is named in the warning with the
   `ln -s` that repairs it. Compare against the worktree's lockfile, not the shared
   checkout's, so a stale shared checkout cannot pass a worktree on `main`.
3. Update `roles/common.md` › _Your worktree_'s hand-link paragraph to say the farm
   links workspaces itself, keeping the hand-link as the fallback for a workspace
   the branch adds before its first commit.

Traps: the farm runs before `npm run build`, so a workspace link to a directory
with no `dist` yet is correct and expected. The copy loop recreates scope
directories as real directories; the new links go inside them.

## Done when

1. In a worktree at a commit whose shared checkout lacks one workspace link,
   `bash .claude/scripts/worktree-farm.sh` creates it, and `npm run build` exits 0
   with no hand `ln -s`. The test removes the link from a fixture shared root and
   farms from it.
2. `node .claude/scripts/check-farm-freshness.mjs <root>` exits 0 and prints the
   missing workspace's name and the repairing `ln -s` when the farmed tree lacks a
   workspace link, and prints nothing when none is missing. Both cases are tests.
3. `roles/common.md` › _Your worktree_ says the farm links workspaces, and names the
   hand-link only as the fallback for a workspace a branch adds.

## Review

**Gate: PASS** — 2026-10-24 · `5f9e3c0a..5486e056` · Opus 5.5, depth medium (dispatched as "standard")

| Done when                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The farm creates a missing workspace link from a fixture shared root, and `npm run build` exits 0 with no hand `ln -s`                         | `scripts/test/check-farm-freshness.test.ts` › "worktree-farm.sh links a workspace the shared root has no link for, inside the scope directory the copy loop made" ✓ (asserts the `linked workspace` line, `readlink` = `../../packages/ui`, the realpath inside the tree, a real scope directory, and the fixture shared root left without the link); goes red, with "…creates the scope directory and an unscoped link…", when the farm's `--link` call is removed. Build clause **verified**: a second tree outside `/workspaces/tools`, farmed from a fixture shared root without `@webtools/ui`, built with exit 0; with the farm's link removed, `npm run build -w @planner/web` exited 1 on `Rollup failed to resolve import "@webtools/ui/tokens.css"` |
| 2. `check-farm-freshness.mjs <root>` exits 0 and prints the missing name and its `ln -s`, and prints nothing when none is missing                 | `scripts/test/check-farm-freshness.test.ts` › "check-farm-freshness.mjs <root> exits 0 and names the workspace with no link and the ln -s that repairs it" ✓ and › "check-farm-freshness.mjs <root> prints nothing when no workspace link is missing" ✓ (`stderr` and `stdout` both `""`; the first test is the companion that fails on empty output). With the workspace pass removed from the no-flag path, the first test and "the workspace check reads the tree's package.json…" go red                                                                                                                                                                                                                                                                  |
| 3. `roles/common.md` › _Your worktree_ says the farm links workspaces, and names the hand-link only as the fallback for a workspace a branch adds | **verified** by reading: "The farm links these itself (repo-117)", and "The hand-link is the fallback for a workspace your branch adds after you farmed"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

- **low** · no `Done when` line depends on it · the Log's "Fixture proof" for Done when 1 (a farm into the builder's worktree, then `npm run build` exited 0) cannot tell a linked tree from an unlinked one. In a worktree under `/workspaces/tools`, Node's parent walk finds `/workspaces/tools/node_modules/@webtools/ui`, which the shared checkout has had since 2026-10-21: with the link removed from this gate's worktree, `npm run build -w @planner/web` still exited 0. The claim holds, measured outside `/workspaces/tools`; the evidence offered for it does not show it. False in the safe direction.
- **low** · no `Done when` line depends on it · no live call site · `findMissingWorkspaceLinks` and `linkMissingWorkspaces` in `.claude/scripts/check-farm-freshness.mjs` treat a dangling link as present (`existsAsEntry` is `lstat`). When a workspace has moved and the shared checkout still links the old directory, the farm copies the dangling link, does not repair it and does not name it: fixture `@webtools/ui -> ../../packages/old-ui` beside `packages/ui` gave `--link` and `--workspaces` both exit 0, both silent, and the link still dangling.
- **low** · no `Done when` line depends on it · no live call site · `linkMissingWorkspaces` checks only the link's immediate parent for a symlink. When the tree's `node_modules` itself is a symlink to a shared one (the layout the farm's header forbids), `--link` wrote `@webtools/ui` into the fixture shared `node_modules/@webtools` (before: `core`; after: `core ui`). The docstring claims only the scope case, and the scope case is guarded and tested. The direction for a fix is to check that the parent's realpath sits under the root's realpath before writing. Not run.
- **low** · open decision · no `Done when` line depends on it · Build 2 says "compare against the worktree's lockfile". The workspace pass reads the worktree's `package.json` globs instead, which gives the same property for workspaces (`listWorkspaces` 18 = `npm query .workspace` 18 = 18 directories on disk). The fetched-package pass still reads the shared checkout's lockfile, as Build 2's "keep the repo-45 scope" says. So a stale shared checkout still passes a worktree on `main` that lacks a newly _fetched_ package: in that fixture the farm's stderr was empty and it exited 0. The options are below, and (A) is recommended: (A) leave it, since the ticket's Why and every `Done when` line are about workspaces; (B) have the farm also run `--packages` on the worktree after the copy loop. (B) was measured silent on this healthy tree and warned on the fixture, but its remedy text then calls the worktree "the shared checkout" and tells the reader to `npm install` there, which `common.md` forbids, so the message would need a worktree variant.
- **dropped** · reverse case, where the shared root links a workspace the worktree does not declare: the copy loop copies the link verbatim and it dangles in the worktree. The check is silent, nothing in the tree imports it, and the build is unaffected. This is the copy loop's behaviour before this diff, and the diff does not cause it.
- **findings** · the hunt returned 5: 4 carried, 1 dropped.
- CI at `5486e056`, read once: `check` ×2, `changes`, `codeql`, `CodeQL`, `dependency-review` pass; `test (ubuntu-latest)` and `test (windows-latest, informational)` were still in progress. No acceptance line rests on a CI leg.
- NFR: security: the scope-symlink skip is tested and goes red when removed; the ancestor case is above · performance n/a (the farm adds two `node` calls) · reliability ✓ (both new farm calls `|| true`; a re-run of `--link` is a no-op) · maintainability: the low findings above.

### Gate 2

**Gate: CONCERNS** — 2026-10-24 · `5486e056..df339907` · Opus 5.5, depth narrow

The round is `git log --first-parent --no-merges 5486e056..df339907`: `03c563da` (code and tests) and `df339907` (Log, plus a `Set` for the flag list). The merge from `main` in between, `fbba02bf`, touched only an lg-67 ticket file, and no gate-1 finding rests on that file.

| Done when                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The farm creates a missing workspace link from a fixture shared root, and `npm run build` exits 0 with no hand `ln -s`                         | `scripts/test/check-farm-freshness.test.ts` › "worktree-farm.sh links a workspace the shared root has no link for, inside the scope directory the copy loop made" ✓. It goes red, with "…creates the scope directory and an unscoped link…", when the farm's `--link` call is removed (2 failed of 28). The build clause is **verified** in a second tree outside `/workspaces/tools`, farmed from a fixture shared root without `@webtools/ui`. The farm printed `linked workspace @webtools/ui -> ../../packages/ui` and `npm run build` exited 0. With the link removed, `npm run build -w @planner/web` exited 1 on `Rollup failed to resolve import "@webtools/ui/tokens.css"` |
| 2. `check-farm-freshness.mjs <root>` exits 0 and prints the missing name and its `ln -s`, and prints nothing when none is missing                 | `scripts/test/check-farm-freshness.test.ts` › "check-farm-freshness.mjs <root> exits 0 and names the workspace with no link and the ln -s that repairs it" ✓ and › "check-farm-freshness.mjs <root> prints nothing when no workspace link is missing" ✓. Both go red when the workspace pass is removed from the no-flag path (2 failed of 28)                                                                                                                                                                                                                                                                                                                                      |
| 3. `roles/common.md` › _Your worktree_ says the farm links workspaces, and names the hand-link only as the fallback for a workspace a branch adds | **verified** by reading. The round does not touch `roles/common.md` (`git diff --name-only 5486e056 df339907`), so gate 1's reading stands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Gate 1's findings:

- **F1 · fixed.** The Log's new evidence is a build outside `/workspaces/tools`, run both with and without the link, and that does tell a linked tree from an unlinked one. Re-running gate 1's `t2-build.sh` on a second tree at `df339907` gave `build-with-farm-link exit=0` and `planner-web-build-without-link exit=1`.
- **F2 · recorded unfixed** on the owner's decision. Not graded.
- **F3 · fixed.** `ancestor.sh` gave `shared @webtools before: core` and `after: core` (at `5486e056` it was `core ui`). With the `staysInside` guard removed, the new test "…writes nothing through a node_modules that is itself a symlink to a shared one" and the scope-symlink test both go red (2 failed of 28). With the guard swapped back to the old parent-only `lstat` check, only the new test goes red (1 of 28), so that test is the one catching the ancestor case. Links inside the tree still get written: a scope directory linked into the tree, `node_modules` linked into the tree, the root named through a symlink, and no `node_modules` at all each linked every workspace. A fresh farm of the second tree also linked `@webtools/ui`.
- **F4 · fixed, as option (B).** The farm runs `--worktree-packages`. On gate 1's `edges.sh` case 2 it now warns with `new-dep` and a remedy that says "Stop and report it to the orchestrator; do not install in a worktree". It was silent on this healthy tree: the real farm wrote 0 bytes to stderr, and `--worktree-packages` exited 0 with no output. `equiv.sh` found `--packages` byte-identical to main's no-flag form on `/workspaces/tools` and on a stale fixture. Removing the farm's new call turns "worktree-farm.sh names a package the worktree's lockfile declares…" red (1 of 28), and so does dropping the worktree remedy.

New findings in the round:

- **med** · no `Done when` line depends on it · the new `--worktree-packages` pass cannot tell a stale shared checkout from a branch that adds a dependency. On a branch that adds one, its text is false.
  - **Repro:** the farmed tree's real lockfile plus one entry, `brand-new-dep`, with the shared install healthy. `--worktree-packages` exited 1 and printed "the shared checkout this worktree was farmed from is behind its lockfile. Stop and report it to the orchestrator; do not install in a worktree."
  - **What a gate on such a branch reads:** `roles/common.md` › _Your worktree_ tells it to stop on that warning. The same section allows "the one install allowed here" for "a dependency your ticket adds".
  - **The remedy does not clear it:** installing in the shared checkout, at `main`, leaves the warning in place, because `main` does not have the dependency.
  - **It will happen:** 18 commits on `main` since 2026-09-24 touched `package-lock.json`. Among them, lg-7 (#396) added 197 fetched-package entries, `@fast-csv/format` among them.
  - **Direction:** the falsehood runs towards stopping, not towards skipping a check. Its cost is a misrouted stop and a remedy that cannot clear it.
  - **Open decision (remedy not run):**
    - (A) **recommended:** the worktree remedy names both cases. If this branch's own diff adds the package, the one `npm install --ignore-scripts` from `common.md` applies; otherwise, stop and report.
    - (B) the pass also reads `origin/main`'s lockfile and names the packages the branch adds separately. That means more code, plus a dependency on `git` and a fetched `origin`.
- **dropped** · gate 1's `probe-farm.sh` did not exercise the missing-link case on an already-farmed tree. The farm never prunes, so the earlier real farm's `ui` link stayed in place, and gate 1's `ghost` link stayed after the re-farm. This is the farm's behaviour from before the round. The missing-link case was measured instead on the fresh second tree.
- **dropped** · when the tree's `node_modules` is a dangling symlink, `--link` writes nothing and `--workspaces` prints an `ln -s` that cannot succeed. There is no live call site, since the farm's header forbids that layout, and the outcome is safe.
- **dropped** · a scope directory linked into the tree gets a relative link written inside its target, and that link resolves only because the two paths have the same depth. No live call site.
- **findings** · 4 verdicts on gate 1's findings (3 fixed, 1 recorded unfixed). The attacks returned 4 new: 1 carried, 3 dropped.
- CI at `df339907`, read once: `check` ×2, `changes`, `codeql`, `CodeQL` and `dependency-review` pass. `test (ubuntu-latest)` and `test (windows-latest, informational)` were pending. No acceptance line rests on a CI leg.
- Nothing here is a `high`.
- NFR:
  - **security:** F3's guard is tested both ways.
  - **performance:** n/a; the farm adds one `node` call.
  - **reliability:** the new call ends in `|| true`.
  - **maintainability:** the med above.

## Log

- 2026-10-24 — Filed by the 2026-10-24 review of the orchestration log, from six items in five
  batch entries (tools-11 items 1–2, tools-dd item 2, tools-8e item 1, tools-cc item 1, tools-49
  item 6); the reproductions above are theirs, re-read against the shared checkout on 2026-10-24,
  where `ls node_modules/@webtools/` → `core ui` and the check exits 0.
- 2026-10-24 — Built (branch `repo-117-farm-links-missing-workspaces`).
  - `check-farm-freshness.mjs` gains `listWorkspaces`, `findMissingWorkspaceLinks`,
    `linkMissingWorkspaces` and `warnIfWorkspacesUnlinked`, and flags: `--packages`
    (the repo-45 pass, as before), `--workspaces` (the new warning), `--link` (create
    the links); `<root>` alone runs both checks on `<root>`. `worktree-farm.sh` calls
    `--packages` on the shared root before the copy loop, then `--link` and
    `--workspaces` on the worktree after it, so the link lands in the real scope
    directory the loop made. A scope directory that is itself a symlink is skipped, as
    writing through it would put the link in the shared checkout.
  - The brief's step 2 says to compare "against the worktree's lockfile"; the pass reads
    the worktree's `package.json` `workspaces` globs instead (step 1's own source), which
    needs no lockfile and cannot disagree with it. Only a whole `*` path segment is
    expanded (`packages/*`, `tools/*/*`), no `**` or negation.
  - Done when 2 says the workspace warning exits 0, unlike the fetched-package pass
    (exit 1); built as written. The farm discards both exit codes.
  - Fixture proof (scratch `build/real.sh`): a shared root whose `@webtools` held only
    `core`, farmed into this worktree with `node_modules` removed, printed
    `linked workspace @webtools/ui -> ../../packages/ui`, and `npm run build` exited 0
    with no hand `ln -s`. Against a healthy shared root the farm is silent about workspaces.
  - Not folded in (superseded by the next entry): `reference/worktree-hygiene.md` ›
    _Give a new worktree its dependencies_ still said the shared checkout "needs one
    `npm install`" after a new workspace merges, and `SKILL.md` step 1 ran the check with
    no flag, which now also names an unlinked workspace there. Both pages were outside
    this ticket's dispatch.
- 2026-10-24 — Owner's decision on that open decision, relayed by the orchestrator. The
  question: the two pages above are now partly stale; what to do? The options: (1) file a
  one-line follow-up (the builder's recommendation), (2) log it for the next review (the
  orchestrator's recommendation), (3) fold it into repo-117 now, with `SKILL.md` step 1
  taking `--packages` and the `worktree-hygiene.md` sentence reworded. The owner chose
  **(3), fold into repo-117 now**, overriding both recommendations. Both page edits are
  the owner's and in scope:
  - `SKILL.md` step 1 now runs `check-farm-freshness.mjs --packages /workspaces/tools`.
    Measured equal to the old no-flag form on main (`5f9e3c0a`): against a stale shared
    root (lockfile declares `@anthropic-ai/sdk`, absent) both print the same warning and
    exit 1, and against a healthy root both print nothing and exit 0 (`cmp` on stdout,
    stderr and exit code: identical).
  - `worktree-hygiene.md` › _Give a new worktree its dependencies_ now says the shared
    checkout needs one `npm install` for a newly fetched package, and that a new
    workspace does not, since the farm links the worktree's own workspaces. The
    paragraph's first line (the shared copy of the farm script) is unchanged: it was not
    part of the answer.
- 2026-10-24 — Gate 1 (Opus) passed `5486e056` with four lows; the owner chose which to
  fix, relayed by the orchestrator.
  - **F4**, the worktree's fetched packages. Question: a stale shared checkout still passes
    a worktree on `main` that lacks a newly _fetched_ package; should the farm also run
    `--packages` on the worktree after the copy loop? Options: (A) leave it, since every
    `Done when` line is about workspaces (the gate's recommendation); (B) the farm checks
    the worktree too, with a remedy text that does not tell the reader to install in a
    worktree. The owner chose **(B)**, overriding the gate's recommendation. Built:
    `check-farm-freshness.mjs --worktree-packages <worktree>` (`warnIfStale` with
    `{ worktree: true }`), called by the farm last. Its remedy reads "the shared checkout
    this worktree was farmed from is behind its lockfile. Stop and report it to the
    orchestrator; do not install in a worktree." `--packages` keeps its text: the
    `equiv.sh` comparison against the old no-flag form on main is identical again, on a
    stale and a healthy root (exit 1 with the same stderr; exit 0, nothing). Where the
    shared lockfile is itself ahead of its install, both passes name the package: two
    warnings, not one.
  - **F1**, the Done when 1 evidence. Accepted: the earlier "Fixture proof" ran in a
    worktree under `/workspaces/tools`, where Node's parent walk reaches the shared
    checkout's `node_modules/@webtools/ui`, so a build there passed with or without the
    link. Remeasured from a detached worktree under the scratch directory
    (`build/outside.sh`; no `node_modules` on any ancestor, `NODE_PATH` empty), farmed from
    a fixture shared root whose `@webtools` held only `core`: the farm printed
    `linked workspace @webtools/ui -> ../../packages/ui`, `npm run build` exited **0**
    with the link; with `node_modules/@webtools/ui` removed,
    `npm run build -w @planner/web` exited **1** (`Rollup failed to resolve import
    "@webtools/ui/tokens.css"`); re-running the farm restored the link and the same build
    exited **0**. The gate's `t2-build.sh` measures the same thing; I wrote my own only
    to add the restore step and print the ancestor check. The earlier Fixture-proof
    bullet above stands as the farm's output, not as proof of the build.
  - **F3**, `--link` through a symlinked `node_modules`. Reproduced first with the gate's
    fixture (the tree's `node_modules` a symlink to a shared one holding `core`):
    `linkMissingWorkspaces` returned `@webtools/ui` and the shared `@webtools` listing
    went from `core` to `core,ui`. `linkMissingWorkspaces` now resolves the directory it
    writes into (nearest existing ancestor, `realpath`) and skips any that leaves the
    tree's own `realpath`; the workspace is then left for the `--workspaces` warning.
    Removing the guard turns the new test and the scope-symlink test red (3 failed of 28
    with the farm's new call also removed); restored, 28 of 28.
  - **F2**, recorded unfixed on the owner's word. The orchestrator's message pasted three
    of the gate's four lows (F1, F3, F4); F2's text did not reach this builder, so it is
    named here only as left unfixed, and its wording is the gate's own record.
- 2026-10-25 — Fixed at landing by owner choice: gate 2, the med — "the new
  `--worktree-packages` pass cannot tell a stale shared checkout from a branch that adds a
  dependency", applied as option (A): the remedy names both cases. The gate's `adddep.sh`
  on this tree, before: remedy "Stop and report it to the orchestrator; do not install in a
  worktree", exit 1. After: remedy "If this branch's own diff adds the package, the one
  `npm install --ignore-scripts` from `common.md` applies; otherwise, stop and report it to
  the orchestrator and do not install in a worktree", exit 1 (the warning still fires; only
  its text changed). `git diff df339907 HEAD -- .claude/scripts/check-farm-freshness.mjs |
  grep -c '^-.*Stop and report it to the orchestrator; do not install'` → `1`. The farm
  test now asserts the three fragments and still asserts no `npm install` in the shared
  checkout or in the worktree.
- 2026-10-25 — Fixed after `--land`, on the owner's decision about a CI reading (not a gate
  finding). Run 40146023330, job 121027483489, `test (windows-latest, informational)` at
  `5b0adfcd`: 3 failed of 28 in `scripts/test/check-farm-freshness.test.ts`, each a
  `worktree-farm.sh` test (`..\..\packages\ui` against `../../packages/ui`, the same for
  `tools\demo\api`, and the temp path's `RUNNER~1` short-name form against the long form in
  the warning). The Windows leg had passed on #626, #620 and #617. The owner chose, over
  asserting path-agnostically or merging as is and filing, to skip those three tests on
  win32: the farm is a bash script that runs only in the devcontainer's worktrees. They now
  run through `test.skipIf(process.platform === "win32")`, and no other test changed. Proof
  on Linux: `npx vitest run scripts/test/check-farm-freshness.test.ts` → 28 passed of 28,
  including the three skipped on Windows, "worktree-farm.sh links a workspace the shared
  root has no link for, inside the scope directory the copy loop made", "worktree-farm.sh
  creates the scope directory and an unscoped link when the shared root has neither" and
  "worktree-farm.sh names a package the worktree's lockfile declares and a healthy shared
  checkout lacks, without telling the reader to install in the worktree". The skip itself
  is unmeasured on Windows: the next push's Windows leg is its reading.
