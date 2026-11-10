---
id: repo-144
tool: repo
title: The preflight leak spec counts the shim directories earlier tests made, so a shuffled run reds it
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-144 — The preflight leak spec counts the shim directories earlier tests made

## Why

`scripts/test/preflight.test.ts` ends with a spec that reads a module-level list,
`shimDirsMade`, and asserts two things about it: that at least three shim
directories were made, and that none of them still exists
(`scripts/test/preflight.test.ts:3038-3041`). The file says why it sits last:
"it reads what every test above left behind" (`:3037`). Under vitest's file
order that holds. Under `--sequence.shuffle` it does not. The spec runs before
some of the tests that call `makeShimDir()`, so the floor sees fewer than three
and fails, even though nothing leaks.

The defect is order, not isolation. The spec reads state that other tests in the
same file write, and the shuffle decides whether they have run yet. The
`shimDirsMade` list lives for the whole file, so the same reading would also
hide a real leak whenever the spec ran with nothing made.

This was recorded before. repo-110's Log on `main` names the order dependence
and the same message under `--sequence.shuffle --sequence.seed=1`, and carries
it as finding F3 (low), left unfixed by the owner's choice. On 2026-11-10, at the
tools-86 checkpoint, the owner chose to file tickets for it rather than leave it in
the Log, and this is the repo half. The ledger half is a separate ticket and is not covered here.
repo-129's builder reached the same failure while splitting the suites into
isolated and shared projects (that work is on branch `repo-129-split-isolation`,
pull request #783, not merged), and asked for it to be fixed or excluded before
shuffled readings were taken. It was never an isolation problem, which is why
`--isolate` is not the fix and why this ticket does not touch the project split.

The failure is seed-dependent, and the seed that fails is a property of the
current test set, not of the spec. It is 2 at the base sha below; seeds 1, 3, 4
and 5 pass there. repo-110's Log had seed 1 failing on an earlier copy of the
file. A sweep of seeds is therefore the reading that counts, not a single seed.

### Reproduction

Base: `origin/main` at `a100f42967ec3fc3760a5a6032449be3e986806a`. Measured
2026-11-10 in a worktree farmed and built per `common.md`, vitest `v5.0.5`.

Command, expected to fail:

```
$ npx vitest run scripts/test/preflight.test.ts --sequence.shuffle --sequence.seed=2
 RUN  v5.0.5 /workspaces/tools/.claude/worktrees/agent-ab142da0edabf6704
      Running tests with seed "2"

 ❯ |repo| scripts/test/preflight.test.ts (122 tests | 1 failed | 1 skipped) 3190ms
   × no preflight-ghshim directory this file made is left behind (repo-110) 11ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |repo| scripts/test/preflight.test.ts > no preflight-ghshim directory this file made is left behind (repo-110)
AssertionError: expected 2 to be greater than or equal to 3
 ❯ scripts/test/preflight.test.ts:3039:31

 Test Files  1 failed (1)
      Tests  1 failed | 120 passed | 1 skipped (122)
```

Same file, file-level shuffle only, same seed, expected to pass:

```
$ npx vitest run scripts/test/preflight.test.ts --sequence.shuffle.files --sequence.seed=2
      Running tests with seed "2"

 Test Files  1 passed (1)
      Tests  121 passed | 1 skipped (122)
```

Controls, the same day at the same sha:

```
$ npx vitest run scripts/test/preflight.test.ts -t "no preflight-ghshim directory"
AssertionError: expected 0 to be greater than or equal to 3
      Tests  1 failed | 121 skipped (122)

$ npx vitest run scripts/test/preflight.test.ts
      Tests  121 passed | 1 skipped (122)

$ npx vitest run scripts/test/preflight.test.ts --sequence.shuffle --sequence.seed=<n>
n=1: Tests  121 passed | 1 skipped (122)
n=2: AssertionError: expected 2 to be greater than or equal to 3   (Tests  1 failed | 120 passed | 1 skipped (122)), run twice
n=3: Tests  121 passed | 1 skipped (122)
n=4: Tests  121 passed | 1 skipped (122)
n=5: Tests  121 passed | 1 skipped (122)
```

The spec passes in file order, fails alone (zero made), and reds under one
shuffled seed of five. The owner's wording "1 failed | 120 passed" matches; the
skipped test is counted here because the file has one.

### The state it depends on, at `a100f429`

- `scripts/test/preflight.test.ts:2430` declares `const shimDirsMade: string[] = []`,
  module-level, shared by every test in the file.
- `:2432-2435` `makeShimDir()` creates a `preflight-ghshim-*` directory and pushes
  it onto that list. Six calls exist, in six tests:
  - `:791`, in the test at `:789` (the check-5 `gh` leak wording);
  - `:2271`, in the test at `:2269` (`--only mergeTree` exits 16);
  - `:2302`, in the test at `:2300` (the probe's failure first, exit 16 alone);
  - `:2486`, `:2505`, `:2527`, in the three `removeShimDir` unit tests at
    `:2485`, `:2504`, `:2526`.
- The first two removal sites are `:809` and `:2296`; each test's `finally` calls
  `removeShimDir(shimDir)`.
- `:3038-3041` is the spec. Its floor, `:3039`, reads the list's length at the
  moment the spec runs. Under shuffle that is however many of the six have run.
  Its second assertion, `:3040`, is order-free in its outcome, because each maker
  removes its own directory in a `finally`. Only the floor is order-dependent.

## Build

1. Move the leak check out of the test body and into a file-level `afterAll`.
   Hooks run after every test in the file in both orders, so the list is complete
   whatever the shuffle. The file already has file-level `afterAll` hooks at
   `:135` and `:376`; follow their shape. The hook asserts that no entry of
   `shimDirsMade` still exists, and its failure message names each leftover path
   (use `expect(leftovers, message).toEqual([])` or a thrown `Error` listing them).
2. Keep the floor (`shimDirsMade.length >= 3`) inside the hook, so that a run in
   which no shim test ran fails rather than passing vacuously. Under
   `-t "repo-110"` the three `removeShimDir` unit tests make three directories
   and the floor is met; the Done-when line below checks that.
3. Remove the old `test(...)` at `:3038` and its comment `:3037`, rather than
   leaving an empty test behind. Keep the explanatory comment in the hook and say
   why it is in an `afterAll`: shuffled order is the reason.
4. Mutation control, committed first: commit the file as a baseline
   (`test(repo): preflight leak spec baseline`), then comment out the
   `removeShimDir(shimDir)` in the `finally` at `:2296`, run the file in file order
   and under `--sequence.shuffle --sequence.seed=2`, and confirm the hook fails and
   names that directory both times. Restore with `git checkout <sha> -- <path>`,
   not `git checkout -- <path>`, per `common.md`'s undo rule. Record both outputs
   in the Log.
5. Do not change `vitest.config.ts`. Do not add `sequence.shuffle` to it, and do
   not exclude the file from any project.
6. Run `npx oxlint scripts/test/preflight.test.ts`, `npm run check`, and
   `npx oxfmt --check scripts/test/preflight.test.ts`. The file is under
   `scripts/test` and is not under an oxfmt ignore pattern, so the check applies.

## Done when

1. `npx vitest run scripts/test/preflight.test.ts --sequence.shuffle --sequence.seed=2`
   reports 0 failed. At `a100f429` it reports 1 failed (Reproduction above).
2. The same command for seeds 1 through 20 reports 0 failed on every seed, and the
   Log lists the sweep's per-seed totals.
3. `npx vitest run scripts/test/preflight.test.ts` (file order) and
   `--sequence.shuffle.files --sequence.seed=2` both pass.
4. The leak check is order-free: `grep -n "afterAll" scripts/test/preflight.test.ts`
   shows the hook, and no test body reads `shimDirsMade`. The mutation control in
   Build 4 is red under file order and under seed 2, and names the directory, and
   the file is restored to the baseline sha.
5. `npx vitest run scripts/test/preflight.test.ts -t "repo-110"` passes, with the
   three `removeShimDir` unit tests and the hook's floor met.
6. `npm run check` exits 0 and `npx oxfmt --check scripts/test/preflight.test.ts`
   exits 0 at the branch head.

## Log

### 2026-11-10 — filed

Reproduced at `origin/main` `a100f42967ec3fc3760a5a6032449be3e986806a` on branch
`repo-file-ghshim-order`: `--sequence.shuffle --sequence.seed=2` gives
`1 failed | 120 passed | 1 skipped`, and `--sequence.shuffle.files --sequence.seed=2`
gives `121 passed | 1 skipped`. The output and the controls are in Reproduction.
Filed as the repo half of the owner's 2026-11-10 decision at tools-86 checkpoint 4
(options: file two tickets, record in the Log only, or fix in repo-129; the owner
chose filing two, after the repo-129 builder's recommendation).

Two readings on record that this measurement qualifies. repo-110's Log on `main`
says seed 1 fails with the same message, and repo-128's Review on branch
`repo-129-split-isolation` (unmerged) has a note in repo-128's file that seeds 1 and
2 fail on the base's copy of the file. At `a100f429`, seed 1 passes and only
seed 2 fails (run twice). The failing seed moves with the test set, so the Build
asks for a sweep rather than one seed.
