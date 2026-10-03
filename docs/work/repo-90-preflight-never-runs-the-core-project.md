---
id: repo-90
tool: repo
title: Preflight exits 0 on a change that fails the core project's source scans
kind: fix
status: in-flight
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

## Log

- 2026-10-03 — Filed and fixed inside repo-84's branch, on the owner's instruction after repo-84's gate 1 named the gap: it is the same branch's defect surfacing, and a separate branch would have re-run a whole gate for a six-line change.
- 2026-10-03 — **Positive control.** Commit `b9175ca` is the fix, laid on repo-84's head that still carried the unsafe spawns. `node scripts/preflight.mjs --base origin/main` on it exited 1: `FAIL  npm test -- --project core`, then `1 failed` in `packages/core/test/spawn-safety.test.ts` ("every file that spawns says shell: false at each of its calls"), listing both offending calls in `scripts/test/re-resolve-citations.test.ts`. The same defect without the fix, head `9ed966d`, had exited 0 (above). After repo-84's own spawns were repaired (`shell: false` in the suite's `TEXT`), the same command exits 0 with this ticket `in-flight`; the report names the head.
- 2026-10-03 — **Status is `in-flight`, not `done`, and why.** The instruction was to mark this ticket done in the branch. Preflight's `## Review` check fails a `done` ticket with no review section: `FAIL  docs/work/repo-90-preflight-never-runs-the-core-project.md is marked done but has no ## Review section`, exit 4, measured at head `760871a` where the ticket said `done`. The review section lands with the gate, so whoever lands sets `done` in the first record commit, as the builder page says.
