---
id: repo-128
tool: repo
title: The repo and core suites take 44 s on ubuntu and 251 s on Windows, mostly in fixture spawns
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-128 — The repo and core suites spend their time in fixture spawns

## Why

The test-suite audit of 2026-10-25 compared per-file CI times (run
`40210503276`). The `repo` project is 44 s summed on ubuntu and **251 s on
Windows**, because almost every case spawns `git`, `node` or `bash`, and a
Windows spawn costs about 100 times more. repo-106 and repo-113 already trimmed
`review-record.test.ts`; the same fixes were never applied to its neighbours.
The Windows leg is `continue-on-error` and no ruleset requires it, so these
seconds only help whoever waits for that leg. On ubuntu the win is about 17 s
summed.

## Decision — answered 2026-10-25 by the owner

Asked which removals of coverage are acceptable. Two answers apply here:

- **Clear duplicates may be deleted.**
- **The Linux-only harness hooks are skipped on Windows.** `hooks.test.ts` and
  the `worktree-farm.sh` cases in `check-farm-freshness.test.ts` test bash
  scripts wired in `.claude/settings.json` for the Linux devcontainer. Together
  they cost ~47 s on Windows.

## Build

Estimated seconds saved are given as ubuntu / Windows. All are estimates from
reading the code, priced from repo-113's per-spawn Windows costs, unless marked
measured.

1. `scripts/test/hooks.test.ts`: `describe.skipIf(process.platform === "win32")`,
   with a comment saying why (Linux-only harness). 0 / 39 s (measured).
2. `scripts/test/check-farm-freshness.test.ts`: skip the `worktree-farm.sh`
   cases on win32 the same way. `makeGitRepo` (`:72`) runs 17 `git init`s for
   repos that only need `rev-parse --show-toplevel`; share one per file.
   0.1 / 8 s.
3. `packages/core/test/spawn-safety.test.ts:56-86`: the tree is walked once, but
   each of the three scans re-runs the hand-written `mask()` tokenizer over
   every file (`support/spawn-calls.ts:388`). Cache `mask(text, true)` per
   source. 2.5 / 3 s (measured locally at 0.69 + 0.62 + 0.72 s).
4. `scripts/test/preflight.test.ts:73` `makeRepo`: write the identity with
   `appendFileSync` and copy an empty template repo per file, as repo-113 did in
   `review-record`. The 101 `git config user.*` spawns and 50 `init`s become
   copies. 0.5 / 8 s.
5. `scripts/test/preflight.test.ts:317` `makeTitleRepo`: with `--title` given,
   `checkTitle` never calls git (`commit-message.mjs:84,130`). Use one plain temp
   dir holding `release-please-config.json` and `tools/`, shared by the
   checkTitle cases. 0.2 / 3 s.
6. `scripts/test/next-id.test.ts:738` `ticketRemote` (used by ~12 tests): it
   makes about 250 git spawns per fixture (32 each of add, commit and push, plus
   20 checkouts). Build each history with one `git fast-import` into the bare
   repo, then one fetch. Take care with tests that need an unfetched state.
   1 / 12 s.
7. `scripts/test/review-record.test.ts:1150` `withLandRepo` (~17 land tests):
   template the bare and working pair once per file and fix the remote URL with
   an edit of `.git/config`. The three cases that fail at setup (`:1463`,
   `:1587`, `:1834`) never reach the remote, so they can use `withTicketRepo`.
   0.3 / 7 s.
8. Duplicates:
   - `review-record.test.ts:1328` repeats `:1587` (its own title says
     "superseded by G2-a"). Fold its one unique `git status` assertion into
     `:1587` and delete it.
   - `:505` and `:659` share one fixture and one command; merge them.
   - `check-lockfile-sync.test.ts:169` re-runs the two real `npm install`s that
     `:111` and `:122` already run. Move its cwd spy into those cases. 0.9 / 0 s.
9. `scripts/test/status.test.ts:101` `run()` makes 57 CLI spawns, and its cost
   is CPU, not spawning (7.0 s ubuntu, 12.0 s Windows). Keep about ten spawns,
   for exit codes and flags, and test rendering through the exported functions.
   ~2.5 / 4 s. (Running it twice in CI is repo-127's.)
10. `scripts/test/test-gate.test.ts:301` sets `TEST_GATE_SETTLE_MS: "2500"`. Try
    1000 and keep the change only if the file passes 10 runs in a row locally.
    1.5 / 0 s. Low confidence: a flake costs more than the saving.
11. Stale prose: `preflight.test.ts:4,13,69,1312` and `review-record.test.ts:6`
    cite citations test files retired by adr/006. Reword them.

## Done when

1. `npm test -- --project repo` and `--project core` pass on ubuntu and on the
   Windows leg of this pull request's CI.
2. The Windows leg's `repo` project time is at least 60 s lower than run
   `40210503276`'s 251 s, read from this pull request's CI log.
3. `hooks.test.ts` and the `worktree-farm.sh` cases still run on ubuntu, and are
   reported as skipped on Windows.
4. Each deleted or merged case is named in the Log, with the case that still
   covers its assertion.

## Log

- 2026-10-25: Filed from the test-suite audit; see
  [repo-127](./repo-127-pull-requests-run-every-project-whatever-they-touch.md).
  Spawn counts measured with a git-counting shim: review-record 691, preflight
  464, next-id 287.
