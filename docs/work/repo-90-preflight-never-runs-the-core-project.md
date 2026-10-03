---
id: repo-90
tool: repo
title: Preflight exits 0 on a change that fails the core project's source scans
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-90 — Preflight never runs the `core` project

## Why

`packages/core/test/spawn-safety.test.ts` scans **every source file in the
repository** for a spawn without `shell: false` (repo-75 widened it from the
workspaces' `src` to `scripts/`, every `test/` and every `.mjs`). It runs in the
`core` vitest project. `scripts/preflight.mjs`'s `testPlan` ran a project only
for a path class it recognised: the full suite when shared config moved, `repo`
when `scripts/` moved, one project per tool a diff touches. So a diff that adds
an unsafe spawn to `scripts/` or to a tool's code runs the project **beside**
the scan, and preflight reports green on a change CI then fails.

Found by repo-84's gate 1 (F1, and its dropped line): the build's new suite
spawned `git` and `node` through a `TEXT` option object with no `shell: false`.

## The reproduction

Measured in this worktree at repo-84's head `9ed966d`, which carried the
defect:

```
$ npx vitest run packages/core/test/spawn-safety.test.ts
 AssertionError: expected [ …(2) ] to deeply equal []
 +   "scripts/test/re-resolve-citations.test.ts:54 spawnSync(\"git\", [\"-C\", dir, ...args], TEXT)",
 +   "scripts/test/re-resolve-citations.test.ts:248 spawnSync(process.execPath, [CLI, ...args], { ...TEXT, cwd: dir })",
      Tests  1 failed | 17 passed (18)
$ node scripts/preflight.mjs --base origin/main --title "feat(repo): re-resolve a record's unpinned citations by anchor, naming each repair (repo-84)"
== check ==
ok    npm run check
ok    npm test -- --project repo
…
preflight passed (exit 0)
```

Preflight ran `npm run check` and `--project repo` only, and exited 0.

## Build

`testPlan` appends `npm test -- --project core` after the projects a diff
already selects, whenever the diff touches `scripts/` or a tool. Not for a
documentation-only diff outside both, which `npm run check` alone covers, and
not under shared config, where the full `npm test` already includes it.

**Why that selection and not a narrower one.** The scan reads `scripts/` and
every tool's tests and sources, so a path rule for `scripts/` alone would leave
the identical gap for a tool diff: a new `spawnSync` without `shell: false` in a
tool's test fails core and runs only that tool's own project. `core` is measured
at 2 seconds (`npx vitest run --project core`, 2.7 s wall clock here), so a
narrower rule that picked the one spec would save nothing and would have to
track the spec's name. A tool's ticket file under `docs/work/` also selects
`core`, which costs the same two seconds and keeps the rule a path prefix.

The edit to `scripts/preflight.mjs` is line-neutral (7 lines out, 7 in), because
merged records cite that file by unpinned line number into the code below it.

## Done when

- A diff touching only `scripts/` selects the `core` project after `repo`, and a tool diff selects it after the tool's own project. Proved by the test "testPlan runs core after the repo project when only scripts/ moved, and after each tool", appended at the end of `scripts/test/preflight.test.ts`.
- A diff touching neither selects no `core`, and shared config still runs the full suite once. Proved by the next test, "testPlan adds no core project to a diff that touches neither scripts/ nor a tool".
- A failure in `core` alone fails `checkBuild` with the `check` bit. Proved by the third appended test, "checkBuild fails on a scripts/ diff when only core's suite fails".
- **The positive control**, on a real run: preflight over a head that still carries the defect exits non-zero, naming the scan's failing test; after the repair it exits 0. See the Log.

## Review

### Gate 1

**Gate: PASS** — 2026-10-03 · `9ed966d..fcb3be0`, the repo-84 branch this ticket was filed and fixed in (base `ebb808b`; `origin/main` still there) · code-review at medium

Acceptance is the ticket's own `## Done when`. Unpinned coordinates resolve against `fcb3be0`.

| Done when                                                                                                                            | Proof                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `scripts/`-only diff selects `core` after `repo`, and a tool diff selects it after the tool's own project                          | **proven** — `scripts/test/preflight.test.ts:2220-2232 "testPlan runs core after the repo project when only scripts/ moved"`. With `core` dropped from `testPlan`, 3 tests fail, this one among them                                                           |
| A diff touching neither selects no `core`, and shared config runs the full suite once                                                | **proven** — `scripts/test/preflight.test.ts:2234-2244 "testPlan adds no core project to a diff that touches neither"`. With `core` appended unconditionally, 2 tests fail, this one among them                                                                |
| A failure in `core` alone fails `checkBuild` with the `check` bit                                                                    | **proven** — `scripts/test/preflight.test.ts:2256 "ok: false, bit: EXIT.check"`                                                                                                                                                                                |
| The positive control: preflight over a head still carrying the defect exits non-zero naming the failing test, and 0 after the repair | **verified** — at `b9175ca`, `node scripts/preflight.mjs --base origin/main --title …` exit 1, `FAIL  npm test -- --project core`, `packages/core/test/spawn-safety.test.ts (18 tests, 1 failed)`; at `fcb3be0` exit 0 with `ok    npm test -- --project core` |

- **Line-neutrality, verified by enumeration.** Every unpinned citation in every `docs/work/` record into `scripts/preflight.mjs` (83, in 11 records: repo-47 6, repo-51 24, repo-64 8, repo-65 9, repo-67 6, repo-75 9, repo-77 1, repo-78 1, repo-79 13, repo-82 1, repo-83 5) and into `scripts/test/preflight.test.ts` (34): the text of the cited lines at `ebb808b` against `fcb3be0` differs for 0 of 117. `citations-gate.mjs --against ebb808b` reports the same 45 moved in 16 records as at `9ed966d`, and `--against origin/main` exits 0.
- **low** · R90-1 · The selection is narrower than the scan it serves. The scan reads every source file in the repository (`packages/core/test/spawn-safety.test.ts@ebb808b:12 "The scan therefore reads every source"`), and `core` is selected only when `scripts/` or a tool moved (`scripts/preflight.mjs:255 "projects.length > 0 ? [...projects,"`), with a comment, `scripts/preflight.mjs:254 "read every file under scripts/ and tools/"`, that states the narrower reading as fact. Tracked source outside both prefixes: `.claude/scripts/check-farm-freshness.mjs`, which the `repo` project also typechecks (`scripts/test/tsconfig.json@ebb808b:34 "check-farm-freshness.mjs"`); `testPlan` on that path alone returns only `npm run check`, neither `repo` nor `core`. A new root-level source file other than `vitest.config.ts` is the same. That file spawns nothing today, so there is no live miss; CI still runs the scan. The image-closure scan is covered: `tools/ledger/Dockerfile` selects `ledger` and `core`, and `packages/` and root `package.json` run the full suite.
- **low** · R90-2 · `scripts/test/preflight.test.ts:247 "calls.slice(0, 2)"` turns an exact assertion into a prefix one, so the test named "checkBuild runs check plus one project per touched tool" no longer says what else runs. Measured: with `core` dropped from `testPlan`, it still passed while 3 others failed. Nothing slips, since the `testPlan` rows and the appended `checkBuild` test pin the exact list; the slice keeps the line count, and with it the citations above, unchanged.
- **low** · R90-3 · A merged record now cites a thinner test. repo-51 cites line 144 of `scripts/test/preflight.test.ts` for check 1 on a `scripts/`-only branch (`docs/work/repo-51-one-preflight-command-before-a-pull-request.md@ebb808b:120 "check 1 on a"`); this round moved the `scripts/`-only row out of that test to the end of the file. The citation still verifies, since its anchor is the test name, and the new comment at `scripts/test/preflight.test.ts:145 "the scripts/-only plan is the"` points onward, so the record is not false, only no longer self-contained.
- **Premises:** the Why's account of repo-75 widening the scan to `scripts/`, every `test/` and every `.mjs` matches the scan's own header; the reproduction matches repo-84 gate 1, which measured it at `9ed966d`. `in-flight` is right until the lander sets `done` with this section.
- **findings** · code-review at medium over the `scripts/preflight.mjs` and `scripts/test/preflight.test.ts` lines of `9ed966d..fcb3be0` returned 3; 3 carried, 0 dropped.
- NFR: security ✓, it closes a gap in front of the no-shell scan · performance — one more project per code diff, 58 tests · reliability ✓ · maintainability — R90-1, R90-2, R90-3.
- **Not verified:** the Build's 2-second timing of the `core` project; the Windows leg.

## Log

- 2026-10-03 — Filed and fixed inside repo-84's branch, on the owner's instruction after repo-84's gate 1 named the gap: it is the same branch's defect surfacing, and a separate branch would have re-run a whole gate for a six-line change.
- 2026-10-03 — **Positive control.** Commit `b9175ca` is the fix, laid on repo-84's head that still carried the unsafe spawns. `node scripts/preflight.mjs --base origin/main` on it exited 1: `FAIL  npm test -- --project core`, then `1 failed` in `packages/core/test/spawn-safety.test.ts` ("every file that spawns says shell: false at each of its calls"), listing both offending calls in `scripts/test/re-resolve-citations.test.ts`. The same defect without the fix, head `9ed966d`, had exited 0 (above). After repo-84's own spawns were repaired (`shell: false` in the suite's `TEXT`), the same command exits 0 with this ticket `in-flight`; the report names the head.
- 2026-10-03 — **Status is `in-flight`, not `done`, and why.** The instruction was to mark this ticket done in the branch. Preflight's `## Review` check fails a `done` ticket with no review section: `FAIL  docs/work/repo-90-preflight-never-runs-the-core-project.md is marked done but has no ## Review section`, exit 4, measured at head `760871a` where the ticket said `done`. The review section lands with the gate, so whoever lands sets `done` in the first record commit, as the builder page says.
