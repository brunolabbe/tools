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
(`scripts/test/preflight.test.ts:3038-3041`). The two-line comment above it says
why it sits last: "it reads what every test above left behind" (`:3036-3037`).
Under vitest's file order that holds. Under `--sequence.shuffle` it does not. The
spec runs before some of the tests that call `makeShimDir()`, so the floor sees
fewer than three and fails, even though nothing leaks.

The defect is order, not isolation. The spec reads state that other tests in the
same file write, and the shuffle decides whether they have run yet. The spec
only sees the shim directories made before it runs, so a shim test that leaks
after the spec has read the list is not seen in that run. With nothing made
before it, the floor reds, which is the safe direction.

This was recorded before. repo-110's Log on `main` names the order dependence
and the same message under `--sequence.shuffle --sequence.seed=1`, and carries
it as finding F3 (low), left unfixed by the owner's choice. At the tools-86
checkpoint 4 the owner chose to file tickets for it rather than leave it in the
Log; this is the repo half. The ledger half is a separate ticket and is not
covered here. The repo-129 builder's report at that checkpoint recommended
filing a ledger ticket for the two ledger files and a repo ticket for ghshim,
and the owner chose that. repo-129's branch (`repo-129-split-isolation`, pull
request #783, not merged) diagnoses the same failure on 2026-11-10 and leaves it
alone. It was never an isolation problem, which is why `--isolate` is not the
fix and why this ticket does not touch the project split.

The failure is seed-dependent, and the failing seeds are a property of the
current test set, not of the spec. At the base sha, seeds 1 through 20 fail on
four of them: 2, 7, 8 and 16. repo-110's Log had seed 1 failing on an earlier
copy of the file. A sweep of seeds is therefore the reading that counts, not a
single seed.

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

Seeds 1 through 20, the full sweep, on the same base file: seeds 2, 7, 8 and 16
exit 1, the rest exit 0 (see the Log for the per-seed record). The spec passes in
file order, fails alone (zero made), and reds under four of the twenty shuffled
seeds. The owner's wording "1 failed | 120 passed" matches; the skipped test is
counted here because the file has one.

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

The owner's answer to the open question on the floor, 2026-11-10, is recorded
under `## Decision — answered 2026-11-10 by the owner` below: option (a). Build
what it says.

1. Move the leak check out of the test body and into a file-level `afterAll`.
   Hooks run after every test in the file in both orders, so the list is complete
   whatever the shuffle. The file already has file-level `afterAll` hooks at
   `:135` and `:376`; follow their shape. The hook asserts that no entry of
   `shimDirsMade` still exists, and its failure message names each leftover path
   (for example `expect(leftovers, "leaked: " + leftovers.join(", ")).toEqual([])`). **The hook has no floor.** A filtered run whose tests make no
   shim directory passes the hook: it says nothing leaked among the tests that ran,
   not that a shim test ran. That is the cost of option (a), and the Build accepts
   it. A whole-file run with fewer than three registered directories no longer
   reds: if the six real tests stopped registering their shim directories and one
   leaked, the hook would not see it and the file would exit 0, where the old
   `>= 3` floor exits 1. That is the second cost of (a), and the Build accepts it.
2. Add an order-free cover test for the empty-list case, the one thing the hook
   no longer proves. It calls `makeShimDir()` once, asserts the directory is in
   `shimDirsMade` and exists, then calls `removeShimDir(dir)`. Name it with
   `makeShimDir records each directory (repo-144)`, because Done when 5 filters on
   that substring, and keep it out of any ordering dependence: it makes its own
   directory and removes it. The cover test covers the recording, not the callers:
   it proves `makeShimDir` pushes onto `shimDirsMade`, and says nothing about the
   six tests that call it.
3. Remove the old `test(...)` at `:3038-3041` and its two-line comment at
   `:3036-3037`. Delete all six lines (comment 2, test 4): deleting only `:3037` leaves a
   dangling comment. Keep an explanatory comment in the hook that says why it is in an
   `afterAll`: shuffled order is the reason.
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

## Decision — answered 2026-11-10 by the owner

Two questions, both answered at the tools-86 checkpoints. Both answers are the
gate's recommendation; none overrode it.

**1. The floor in the hook (gate 1 F1, re-asked on gate 2's N1).** Answered at
checkpoint 6 for the first form and re-asked at checkpoint 9.

- Question at checkpoint 6: keep the `shimDirsMade.length >= 3` floor in the
  file-level `afterAll`, which reds any filtered run that makes fewer than three
  shim directories? Options: (a) drop the floor, keep the leftovers assertion and
  add an order-free cover test; (b) keep the floor and document the supported
  filters; (c) keep the floor but detect whether the file ran whole (no stable
  vitest API found). Choice: (a). The options and their measurements are in the
  Log, round 1.
- Question at checkpoint 9, put on gate 2's N1 measurement: "With option (a), the
  floorless hook plus the cover test, if the six real tests stopped registering
  their shim directories and one leaked, a whole-file run still exits 0 (121
  passed). The old >=3 floor exits 1 in that case. Keep (a)?" Options: keep (a) and
  state the limit; switch to (b) and keep the floor. **Choice: keep (a), state the
  limit.** Build 1 and Build 2 state it.
- Provenance: the owner, tools-86 checkpoint 9, 2026-11-10; the recommendation was
  the gate's.

**2. Where gate 2's lows are fixed (N2, N3, N4, N5, and the rest of F3 and F6).**

- Question: apply them at the landing, or send the ticket back for another gate?
  Choice: fix at landing, no re-gate, each with its own Fixed at landing Log entry.
  The other option offered was not carried in the landing dispatch and is not
  recorded here.
- Provenance: the owner, tools-86 checkpoint 9, 2026-11-10; the recommendation was
  the gate's.

## Done when

1. `npx vitest run scripts/test/preflight.test.ts --sequence.shuffle --sequence.seed=2`
   exits 0 and prints `Test Files  1 passed (1)`. At `a100f429` it exits 1 and
   prints `Test Files  1 failed (1)` (Reproduction above).
2. The same command for seeds 1 through 20 exits 0 with `Test Files  1 passed (1)`
   on every seed. The Log records the sweep, and the base's four failing seeds
   (2, 7, 8, 16) beside it.
3. `npx vitest run scripts/test/preflight.test.ts` (file order) and
   `--sequence.shuffle.files --sequence.seed=2` each exit 0 with
   `Test Files  1 passed (1)`.
4. The leak check is order-free. `grep -n "afterAll" scripts/test/preflight.test.ts`
   shows the hook, and `grep -n "shimDirsMade"` shows only its declaration, the
   `makeShimDir` helper, the cover test and the hook, with no test body reading the
   list other than the cover test. The mutation control in Build 4 exits 1 and prints `Test Files  1 failed (1)`
   under file order and under seed 2, and the hook's failure names the leaked
   directory path. After the restore, `git diff <baseline sha> --
   scripts/test/preflight.test.ts` prints nothing.
5. Each of these exits 0 with `Test Files  1 passed (1)`:
   `-t "repo-110"`, `-t "repo-104"`,
   `-t "the CLI never leaks next-id.mjs's id-sweep wording"`,
   `-t "allProjects is exactly"`, and `-t "makeShimDir records each directory"`.
   `-t "repo-104"`, `-t "the CLI never leaks next-id.mjs's id-sweep wording"` and
   `-t "allProjects is exactly"` are the filters that went red under the floor,
   which is the regression this round removes. `-t "repo-110"` did not go red under
   it and stays as the control. The last is the cover test.
6. `npm run check` exits 0 and `npx oxfmt --check scripts/test/preflight.test.ts`
   exits 0, both at the branch head.

## Log

### 2026-11-10 — filed

Reproduced at `origin/main` `a100f42967ec3fc3760a5a6032449be3e986806a` on branch
`repo-file-ghshim-order`: `--sequence.shuffle --sequence.seed=2` gives
`1 failed | 120 passed | 1 skipped`, and `--sequence.shuffle.files --sequence.seed=2`
gives `121 passed | 1 skipped`. The output and the controls are in Reproduction.
Filed as the repo half of the owner's tools-86 checkpoint 4 decision (options:
file two tickets, record in the Log only, or fix in repo-129 and file only the
ledger ticket; the owner chose filing two, the repo-129 builder's recommendation).

Two readings on record that this measurement qualifies. repo-110's Log on `main`
says seed 1 fails with the same message, and repo-128's gate record on the
unmerged branch `repo-129-split-isolation` says seeds 1 and 2 fail on the base's
copy of the file. At `a100f429`, seed 1 passes and seed 2 fails (run twice). The
failing seeds move with the test set, so the Build asks for a sweep rather than
one seed.

_Correction, round 1 (2026-11-10):_ the first draft said repo-129's builder "asked
for it to be fixed or excluded before shuffled readings were taken". That request
is a 2026-10-25 note in repo-129's file, taken from repo-128's gate 1, not the
builder's. The builder's own recommendation is the one at checkpoint 4 above.

### 2026-11-10 — round 1, the gate's findings and the owner's answers

Gate 1 (`ticket-reviewer-sonnet`, narrow, on head `962f628f`) returned CONCERNS.
Its section and full report are in the gate's scratch directory, and this round
answers each of its findings.

**Open decision, answered 2026-11-10 at tools-86 checkpoint 6.** The question
(gate F1): the Build kept the `shimDirsMade.length >= 3` floor inside the
file-level `afterAll`. A file-level hook runs after any run that executes at least
one test of the file, so a filtered run that makes fewer than three shim
directories goes red. Measured by the gate on a probe with the real file
untouched: `-t "repo-104"` exit 1 (`expected 2`, `Tests 14 passed | 107 skipped`),
`-t "the CLI never leaks next-id.mjs's id-sweep wording"` exit 1 (`expected 1`),
`-t "allProjects is exactly"` exit 1 (`expected 0`); the same filters exit 0 at
the base. Re-measured by this round on a probe with the floor in the hook:
`-t "repo-104"` exit 1, `AssertionError: expected 2 to be greater than or equal to 3`,
`Tests 14 passed | 107 skipped (121)`.

Options, as the gate and the owner had them:

- **(a)** drop the floor from the hook and keep the leftovers assertion, with an
  order-free cover test for the empty list. Measured on that variant by this round:
  `-t "repo-104"` exit 0 (`Tests 14 passed | 107 skipped`) and `-t "allProjects is
  exactly"` exit 0 (`Tests 1 passed | 120 skipped`). The mutation and the sweep on
  it are the Build's own Done-when lines, not yet run.
  WITHDRAWN — do not cite the two counts in this bullet. They are of a 121-test
  variant with no cover test. The Build's variant, with the cover test, gives
  `14 passed | 108 skipped (122)` and `1 passed | 121 skipped (122)` (gate 2, N3).
- **(b)** keep the floor and document in the Build and the hook's comment that only
  the whole file or `-t "repo-110"` is a supported filter, accepting the red.
- **(c)** keep the floor but detect whether the file ran whole. The gate found no
  stable vitest API for that.

**Choice: (a).** Provenance: the owner's answer at tools-86 checkpoint 6, taken as
the gate's recommendation, which the owner accepted. Recorded here by the builder
of round 1 because the ticket has no `needs-decision` heading to hold it.

WITHDRAWN — do not cite the reason in the sentence above. `scripts/status.mjs`
rejects only a `## Decision — open` heading on a ticket that is not
`needs-decision`, so `## Decision — answered <date> by <who>` was available on a
`ready` ticket. The answers now sit under that heading (error by the round 1
builder, found by gate 2's N5).

**Lows, fixed in this round, with the owner's direction to fix all six** (F2-F7):

- **F2** (Done when 1, 2, 3, 5): the lines said "reports 0 failed" or "passes", and
  a failing hook is not counted on the `Tests` line (`Test Files  1 failed (1)` over
  `Tests 120 passed | 1 skipped (121)`, exit 1). Reworded to exit codes and
  `Test Files` lines.
- **F3** (Done when 4): the `afterAll` grep did not show that no test body reads
  the list, and the restore named no command. Reworded to `grep -n shimDirsMade`
  and `git diff <baseline sha> -- <path>` empty.
- **F4** (Why, Reproduction): the Why said "the seed that fails is 2" and listed
  seeds 1, 3, 4 and 5 as passing; the ticket never ran past 5. Seeds 1 through 20
  at the base: four fail, 2, 7, 8 and 16. The sweep is in the Reproduction and
  the Done-when baseline now records the four.
- **F5** (Why): the Why said the list "would also hide a real leak whenever the
  spec ran with nothing made". With nothing made the floor reds. Reworded to the
  case that is hidden: a leak by a shim test that runs after the spec has read
  the list.
- **F6** (Why, Build 3): the phrase is on `:3036`, and the comment is two lines,
  `:3036-3037`. Build 3 now deletes all four lines of the old test and comment.
- **F7** (Why, Log): the repo-129 builder attribution. Corrected above, and the
  Why now cites the checkpoint-4 recommendation as the batch conversation.

**Measured this round, on the base file (the real file is unchanged by this round):**
A sweep of one `npx vitest run` per seed, on the base tree, gives, for
`--sequence.shuffle --sequence.seed=n` with n = 1 to 20: exit 1 for seeds 2, 7, 8
and 16, exit 0 for the other sixteen. The same script's other runs at the base:
in the same sweep: file order exit 0; `--sequence.shuffle.files --sequence.seed=2` exit 0;
`-t "repo-110"` exit 0; `-t "removeShimDir survives one EBUSY"` exit 0;
`-t "the CLI never leaks next-id.mjs's id-sweep wording"` exit 0;
`-t "no preflight-ghshim directory"` exit 1 (`expected 0`), as the Reproduction
records.

**Dropped by the gate:** "the ledger half is a separate ticket" with no id. The
ledger ticket is outside this pull request's range, so it is not a defect here.

### 2026-11-10 — landing

- 2026-11-10 — Gate 1's and gate 2's full reports are on the pull request thread,
  #788; status unchanged.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N1 — "say in Build 2 that
  the cover test covers the recording, not the callers. Say in Build 1 that a
  whole-file run with fewer than three registered directories no longer reds."
  `git diff 264f2e1d HEAD -- docs/work/repo-144-the-preflight-leak-spec-depends-on-test-order.md | grep -v 'Fixed at landing' | grep -c '^+.*That is the second cost [o]f'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N2 — "The first four are
  the filters that went red under the floor." `git diff 264f2e1d HEAD -- docs/work/repo-144-the-preflight-leak-spec-depends-on-test-order.md | grep -c '^-.*The first four are the filters that went red'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N3 — "the Log's
  measurements of (a) are of a 121-test variant, which has no cover test."
  `git diff 264f2e1d HEAD -- docs/work/repo-144-the-preflight-leak-spec-depends-on-test-order.md | grep -v 'Fixed at landing' | grep -c '^+.*The Build.s variant, with the cover test, give[s]'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N4 — "Put the name in
  Build 2." `git diff 264f2e1d HEAD -- docs/work/repo-144-the-preflight-leak-spec-depends-on-test-order.md | grep -c '^-.*and keep it out of any ordering dependence'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N5 — "Move the answers
  under the answered heading, and correct the Log's reason." `git diff 264f2e1d HEAD -- docs/work/repo-144-the-preflight-leak-spec-depends-on-test-order.md | grep -v 'Fixed at landing' | grep -c '^+.*was available on [a]'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F3 (fixed in part) — "the
  clause 'no test body reading the list' is now false of the cover test."
  `git diff 264f2e1d HEAD -- docs/work/repo-144-the-preflight-leak-spec-depends-on-test-order.md | grep -c '^-.*list. The mutation control in Build 4'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F6 (fixed in part) —
  "Delete all four lines miscounts a six-line block." `git diff 264f2e1d HEAD -- docs/work/repo-144-the-preflight-leak-spec-depends-on-test-order.md | grep -c '^-.*Delete all four lines: deleting only'` → `1`.
