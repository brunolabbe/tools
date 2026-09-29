---
id: repo-83
tool: repo
title: spawn-safety's `shell: false` check is per file, not per call, and nothing guards the widened pattern
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-83 — spawn-safety's `shell: false` check is per file, not per call

## Why

`packages/core/test/spawn-safety.test.ts`'s "every file that spawns says
`shell: false` explicitly" — widened by repo-77 to `spawn`, `spawnSync`,
`execFile` and `execFileSync` — asks whether `shell: false` appears **anywhere
in the file**, not whether each call itself carries it. A file with nine
`spawnSync` calls and one `shell: false` string anywhere passes in full; the
other eight calls are never individually asked.

**Measured at repo-77's pushed head**, `node
<scratch>/gate1/percall.mjs "$(pwd)"` — the gate's own per-call script, not
retyped: 484 files scanned, 28 import `node:child_process`, **137 calls**
total, **14 lacking their own `shell: false`**, 0 files failing the whole-file
test. (The gate reported 17 lacking at repo-77's `42e6405`; this ticket's own
mechanical round fixed 3 of them in `scripts/test/citations.test.ts`, so 14
remain — the same population the gate named minus those three.) The 14 are in
`scripts/preflight.mjs` (2), `scripts/review-record.mjs` (7) and
`scripts/test/preflight.test.ts` (5); none sets a truthy `shell`, so nothing
here runs a shell — the gap is that nothing checks it call by call.

**Nothing guards the widened pattern either.** repo-75 added a test asserting
the scan reaches `scripts/` and `.mjs`, so narrowing the roots back to
workspaces' `src` would fail something. The call pattern has no equivalent: a
scratch copy of the test with the pattern narrowed from
`\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(` back to `\bspawn\s*\(`
alone still passes, 0 offenders, at repo-77's head — every file that has a
`spawnSync`/`execFile`/`execFileSync` call already has a `spawn(` call or a
`shell: false` string somewhere else in the same file, so the widening this
ticket's own commit and repo-77 depend on is not enforced by anything that
would fail if it regressed.

## The decision

Whether to make the check per call, given what building it costs:

- **(a) — recommended.** Make "every file that spawns says `shell: false`
  explicitly" per call: fail a call that neither inlines `shell: false` nor
  references (by name, including a spread) an object literal in the same file
  that does — the same association `percall.mjs`'s heuristic already performs
  for measurement. Add a guard test in the shape of repo-75's, asserting the
  narrowed pattern fails on a fixture, so a future narrowing back to `spawn(`
  regresses loudly instead of silently. Fixes the 14 calls above as part of
  the same ticket, since the rewritten check would fail on them immediately.
  Real cost: the per-call association is heuristic (a call whose options come
  from a destructured, computed, or cross-file constant is not "the same
  file, by name" and would need either a documented limit or more machinery),
  so this is real work, not a rename — worth a `standard` rating, not
  `mechanical`.
- **(b) — don't file further work; accept the file-level check as the
  convention.** The 14 calls set no truthy `shell`, so the actual security
  property — no shell reaches a child process — already holds; a per-call
  check would catch an omission of the explicit marker, not a live
  vulnerability, and the whole-file check already enforces the rule
  `CLAUDE.md` states ("never invoke a shell"). Leaves the call pattern
  unguarded, as-is.

## Build (if (a))

1. Rewrite "every file that spawns says `shell: false` explicitly" to
   evaluate each matched call's own argument list plus, where a call passes a
   named identifier as its options argument, that identifier's own object
   literal in the same file (as `percall.mjs` does) — fail a call neither
   route reaches.
2. Add a test in `spawn-safety.test.ts` asserting the pattern narrowed to
   `spawn(` alone fails against a fixture that only calls `spawnSync` without
   `shell: false` — the guard repo-75 gave the scan's roots, given to the call
   pattern too.
3. Fix the 14 calls the new check finds red: `scripts/preflight.mjs` (2),
   `scripts/review-record.mjs` (7), `scripts/test/preflight.test.ts` (5) —
   re-measure first, this is a snapshot.

## Done when (if (a))

- A call to `spawnSync`, `execFile` or `execFileSync` whose own options carry
  no `shell: false`, in a file that has one elsewhere, fails
  `spawn-safety.test.ts`, shown red before the fix.
- A pattern narrowed back to `spawn(` alone fails the new guard test.
- Every call in the scan passes the per-call check.
- `npm run check` and the `core` and `repo` suites pass.

## Log

- 2026-09-29 — Filed from repo-77's gate finding (`nfr:maintainability`, its
  low: "nothing guards the widened pattern"), on the owner's choice of "File
  it" over "Don't file", put by the orchestrator via `AskUserQuestion`.
  Reproduced both halves at repo-77's head (`42e6405`) before filing: the
  gate's own `percall.mjs` reports 137 calls, 14 lacking their own
  `shell: false` after repo-77's mechanical round fixed 3 in
  `scripts/test/citations.test.ts` (17 before that round); a scratch copy of
  `spawn-safety.test.ts` with the call pattern narrowed to `spawn(` alone
  still passes, 0 offenders, over the same tree. No fix made here — the
  decision above is open.
