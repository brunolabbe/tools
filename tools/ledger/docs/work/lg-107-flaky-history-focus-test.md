---
id: lg-107
tool: ledger
title: The lg-95 and lg-99 focus tests go red now and then on main, and the cause is not yet shown
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# lg-107 — The lg-95 and lg-99 focus tests go red now and then on main, and the cause is not yet shown

## Why

Two tests in `tools/ledger/web/test/history.test.tsx` assert that focus ends on the row's button after a save closes the control, and each has failed now and then on `main`'s code, with `document.activeElement` being `body`:

- `the button reports whether its control is open, and takes focus back when it closes (lg-95)`, failing at `history.test.tsx:588:34` (the save-path assertion).
- `after a stored save whose re-read is still running, focus is on the row's button and nothing says it is unread, ${arm} (lg-99)`, a parameterized test of two cases, `focused` and `unfocused`, failing at `history.test.tsx:747:36` (its first focus assertion).

Every red run that recorded the machine's state was on a busy machine, shared with other sessions' suites, and none was seen on an idle one; sighting 2's project run recorded no machine state. Whether load is the cause, or only what lets a race show, is not shown: the Log's measurements are too few to say, and no run was taken on a quiet machine. Both tests usually pass on a solo run. A red ledger run is what whoever meets it gets, and the failure says nothing about the change under test, so each one costs a rerun of the whole ledger project.

The failures have been reported in these places. Sightings 1 and 3 are relayed to this filing and not checked by it; gate 1 resolved the line number in sighting 1. Each says which test it was, or that it is unknown:

1. **2026-11-10, lg-105's landing (PR #780).** Relayed by the orchestrator from the lander's thread comment on #780: `review-record.mjs --land` ran preflight, and `npm test -- --project ledger` failed on an `expect(document.activeElement).toBe(button);` assertion at `tools/ledger/web/test/history.test.tsx:747` while other sessions' vitest runs shared the machine. **The lg-99 test**: the file at the lander's sha (`4dbd5115`) is byte-identical to the base's, and gate 1 resolved line 747 to the lg-99 test's first focus assertion. The assertion's text is the same in both tests. A solo `npx vitest run tools/ledger/web/test/history.test.tsx` then passed 29 of 29.
2. **2026-11-10, lg-104's round 1 builder** (branch `lg-104-refuse-shared-parts`, which touches no `tools/ledger/web` file). Relayed by the orchestrator: `npm test -- --project ledger` gave 2,334 of 2,335 with a test failing, and solo runs of the spec gave 29/29, 29/29, then 28/29. **The project run was the lg-95 test**; the filer read the builder's output file and its failure lines are these:
   - `× the button reports whether its control is open, and takes focus back when it closes (lg-95) 167ms`
   - `AssertionError: expected <body><div>…(1)</div></body> to be <button type="button" …(2)></button> // Object.is equality`
   - `❯ tools/ledger/web/test/history.test.tsx:588:34`
   - `Tests  1 failed | 2334 passed (2335)`

   **The solo 28/29 is unknown**: the relay names no failing test or line, and the output file holds neither, so it may be either test.

3. **Undated, relayed by the coordinator from tools-86.** Its repo-129 builder (branch `repo-129-split-isolation`) hit this failure once under load. tools-86 says it was the isolated half, not an isolation effect. **Which test is unknown**: the relay names none, and does not say what "the isolated half" refers to.

So the lg-95 test is shown red by sighting 2's project run and by the filer's and gate 1's loops, the lg-99 test by sighting 1 and by gate 1's loop, and nothing shows that the two share a cause. The filer's and gate 1's reproductions are under `## Reproduction`.

## Reproduction

The filer's lg-95 loop ran on the base tree `a100f42967ec3fc3760a5a6032449be3e986806a`; gate 1's two loops ran on the ticket-only head `c04797ec`, which changes no code. Each tree was farmed with `bash .claude/scripts/worktree-farm.sh` and built with `npm run build`, and every run was one at a time, under `timeout 120`. The "-t" filter names one test, so the other 28 (lg-95) or 27 (lg-99) are skipped, and no earlier test in the file is needed to make either fail.

**The lg-95 loop** (1 test selected):

```
timeout 120 npx vitest run tools/ledger/web/test/history.test.tsx -t "takes focus back when it closes"
```

**The lg-99 loop** (2 cases selected, `focused` and `unfocused`):

```
timeout 120 npx vitest run tools/ledger/web/test/history.test.tsx -t "after a stored save whose re-read is still running"
```

Each table gives the 1-minute load average from `uptime` at the run's start, and the count of vitest processes by `ps` at the run's start, counted with `grep -c '[v]itest'`. The 1-minute average lags the run it is recorded against.

### The lg-95 loop, filer, 20 runs: 2 red

Red at runs 11 and 14, both with `history.test.tsx:588:34`; the other 18 exited 0 with `Tests 1 passed | 28 skipped (29)`. Run 11's failure lines:

```
× the button reports whether its control is open, and takes focus back when it closes (lg-95) 396ms
AssertionError: expected <body><div>…(1)</div></body> to be <button type="button" …(2)></button> // Object.is equality
❯ tools/ledger/web/test/history.test.tsx:588:34
```

| Run | Result   | 1-min load | vitest processes |
| --- | -------- | ---------- | ---------------- |
| 1   | pass     | 6.64       | 19               |
| 2   | pass     | 6.43       | 14               |
| 3   | pass     | 6.43       | 14               |
| 4   | pass     | 6.47       | 14               |
| 5   | pass     | 6.47       | 14               |
| 6   | pass     | 6.60       | 18               |
| 7   | pass     | 6.60       | 19               |
| 8   | pass     | 7.43       | 14               |
| 9   | pass     | 7.43       | 14               |
| 10  | pass     | 7.48       | 14               |
| 11  | **FAIL** | 7.48       | 14               |
| 12  | pass     | 7.68       | 14               |
| 13  | pass     | 7.62       | 14               |
| 14  | **FAIL** | 7.62       | 14               |
| 15  | pass     | 8.21       | 14               |
| 16  | pass     | 9.08       | 14               |
| 17  | pass     | 10.27      | 4                |
| 18  | pass     | 10.27      | 0                |
| 19  | pass     | 10.09      | 0                |
| 20  | pass     | 10.09      | 0                |

The process counts are the filer's, read from its per-run files after gate 1 (F4) asked for them; they were taken at each run's start and not tabulated in the first version. Both red runs sat at 14 vitest processes, as did 11 of the 18 green runs, and the four runs at 0 to 4 processes were all green: 20 runs do not separate the two, and the table does not show the process count as a cause.

### The lg-95 loop, gate 1, 10 runs: 8 red

Gate 1 ran the same command on the ticket-only head `c04797ec`, which changes no code; its source is gate 1's scratch summary file, which is not kept in the repository. Red runs exited 1 with `Tests 1 failed | 28 skipped (29)` and `history.test.tsx:588:34`; the two green runs, 8 and 10, exited 0 with `Tests 1 passed | 28 skipped (29)`.

| Run | Result   | 1-min load | vitest processes |
| --- | -------- | ---------- | ---------------- |
| 1   | **FAIL** | 14.81      | 29               |
| 2   | **FAIL** | 15.31      | 32               |
| 3   | **FAIL** | 16.16      | 33               |
| 4   | **FAIL** | 16.07      | 30               |
| 5   | **FAIL** | 17.67      | 32               |
| 6   | **FAIL** | 18.09      | 31               |
| 7   | **FAIL** | 19.04      | 28               |
| 8   | pass     | 19.59      | 33               |
| 9   | **FAIL** | 19.79      | 33               |
| 10  | pass     | 19.64      | 28               |

### The lg-99 loop, gate 1, 10 runs: 1 red

Run on the ticket-only head `c04797ec`; its source is gate 1's scratch summary file, which is not kept in the repository. The nine green runs exited 0 with `Tests 2 passed | 27 skipped (29)`. Run 6 exited 1 with `Tests 1 failed | 1 passed | 27 skipped (29)`:

```
× after a stored save whose re-read is still running, focus is on the row's button and nothing says it is unread, unfocused (lg-99) 112ms
AssertionError: expected <body><div>…(1)</div></body> to be <button type="button" …(2)></button> // Object.is equality
❯ tools/ledger/web/test/history.test.tsx:747:36
```

| Run | Result   | 1-min load | vitest processes |
| --- | -------- | ---------- | ---------------- |
| 1   | pass     | 19.64      | 26               |
| 2   | pass     | 19.11      | 15               |
| 3   | pass     | 19.11      | 15               |
| 4   | pass     | 18.38      | 22               |
| 5   | pass     | 17.31      | 22               |
| 6   | **FAIL** | 17.31      | 18               |
| 7   | pass     | 16.72      | 13               |
| 8   | pass     | 16.72      | 7                |
| 9   | pass     | 15.94      | 7                |
| 10  | pass     | 15.94      | 7                |

The filer measured no lg-99 loop. The two tests' rates are therefore each from one set of runs, at one load range, and are rough: lg-95 was 2 of 20 at load 6.43 to 10.27 (filer) and 8 of 10 at load 14.81 to 19.79 (gate 1); lg-99 was 1 of 10 at load 15.94 to 19.64 (gate 1). The two sets differ in more than load (the machine's other sessions, the hour), so the table shows that the rate moves with the machine's state and does not show that load is its cause.

## Build

1. **Reproduce before changing anything.** Run both loops from `## Reproduction` on the base tree, interleaved with the branch as `## Done when` says once there is a branch to interleave with. Record the machine's load and the vitest process count with each run. The failures are intermittent, so a fix is judged by a count of red-before and green-after runs over one window, never by one run.
2. **Find the cause by a run, not by reading, for each test.**
   - **The lg-95 test.** The failing assertion is the one on the save path: `expect(document.activeElement).toBe(button);`, directly after `await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());`. Its cancel-path twin, the same assertion after `cancel` is clicked, has not failed in any run so far. In the failing runs the active element is `body`.
   - **The lg-99 test.** The failing assertion is the first focus assertion after the same `waitFor` and the check that the second `fetchRows` call is pending. It failed on the `unfocused` case in gate 1's run; which case failed in sighting 1 is unknown, and the `focused` case failed in no run that named it. No failing run named a later assertion in that test (after the re-read answers).
   - The focus restore is the `useEffect` in `Refile` in `tools/ledger/web/src/history/History.tsx`, which calls `button.current?.focus()` when the control has just closed by this row's own Cancel or Save and `document.activeElement` is `document.body`. Show by a run which of these happens: the effect does not run, the effect runs and its condition is false when it does, the effect runs after the test's assertion, or the button is replaced before the effect runs. Put the one that the run shows in the Log, for each test, and say whether the two share it.
3. **Fix the cause the run shows, in the product or in the test.** A longer wait in the test is a fix only if the run shows the product's focus restore lands after an event the test does not wait for. Do not weaken either assertion: after the Save closes the control, focus must still end on the row's button. Do not add `retry`, `skip` or `todo` to either test. If the two have different causes, fix both here and say so in the Log; a fix that needs a choice between the product and the test, with both reasonable, goes in the Log as an open decision with its options.
4. **Run the whole file after the change.** `tools/ledger/web/test/history.test.tsx` holds the other lg-99 test cases and the lg-95 test, all of which assert `document.activeElement` against the row button, and a fix to the restore effect reaches all of them.

## Done when

- The Log names the cause for each test, and the run that shows it, from step 2. It is not a hypothesis. It says whether the two share a cause.
- **For each of the two tests, an interleaved window shows the fix.** Run the test's loop from `## Reproduction` against the base tree (the tree the branch forked from) and against the branch's tree, alternately, one run at a time, each under `timeout 120`: base, branch, base, branch, so that both trees see the same machine. Record the 1-minute load and the vitest process count with every run, and put the table in the Log. The fix holds for that test when the base goes red **at least 3 times** and the branch goes red **0 times** over the same window.
  - The window is **40 pairs** (40 base runs and 40 branch runs). If the base has gone red fewer than 3 times in them, extend it by 20 pairs at a time, up to **100 pairs**.
  - If the base has gone red fewer than 3 times at 100 pairs, the line is **`unproven`**, not passed, if the branch has not gone red: a window in which the base does not fail has not tested the fix, and a quiet machine is that window. Say so in the Log with the counts, and run the window again when the machine is busy.
  - A single red run on the branch, at any point in the window, fails the line at once, whatever the base has done so far, including when it is still under 3 reds: the branch red is read first, and the window stops there. Record it and go back to step 2.
  - **Red means the test failing at its focus assertion**: `history.test.tsx:588` in the lg-95 test, `:747` or `:756` in the lg-99 test (the lines at `a100f429`), with `document.activeElement` being `body`. A `timeout 120` kill, a test timeout or any other failure is not red: it counts toward neither the base's 3 nor the branch's 0, and the Log records it with its run.
  - The two tests each need their own window: their rates differ (see the Log for why 3, 40 and 100).
  - **The cost.** A run took about 2.7 s (the filer, at load 6 to 10) and about 4.8 s at load 15 to 20 (gate 1's lg-95 loop). The 100-pair cap is 200 runs, about 9 to 16 minutes per test, and two tests make two windows. The base needs a second tree, farmed and built, as well.
- `npx vitest run tools/ledger/web/test/history.test.tsx` passes every test in the file (29 of 29 at `a100f429`, which the Log's measurements also use).
- `npm run check` passes.
- The `expect(document.activeElement).toBe(button);` assertions are still in both tests: the save-path one in the lg-95 test (line 588 at `a100f429`) and the first focus assertion in the lg-99 test (line 747), and still assert focus ends on the row's button.

## Log

- 2026-11-10 — Filed on `origin/main` at `a100f429`, under the id `lg-107` reserved for it (`lg-106` is held by PR #789, peer tools-86's). The commit adds this file only. Status is `ready`: the cause is not known, but the reproduction is in hand and no question for the owner is open.
- 2026-11-10 — **WITHDRAWN — do not cite this paragraph.** Original text, left standing: "**Correction to the filing brief.** The brief named the failing assertion "around line 747". Line 747 is not in this test. The lg-95 test is at lines 563 to 589 at `a100f429`, and its two `expect(document.activeElement).toBe(button);` lines are 580 (cancel path) and 588 (save path). Lines 747 and 756 belong to a parameterized lg-99 test, `after a stored save whose re-read is still running, focus is on the row's button and nothing says it is unread, ${arm} (lg-99)`. The failure in every red run below is at 588." **Retraction (gate 1, F1, 2026-11-10):** the 747 was not an error in the brief. It was the lander's own report of PR #780, and it was a sighting of the lg-99 test; the file at the lander's sha `4dbd5115` is byte-identical to the base's. The Correction called the 747 an error in the brief, and the error is the filer's. What stands in the paragraph is the line arithmetic (the lg-95 test is at 563 to 589, its assertions at 580 and 588, the lg-99 test's at 747 and 756); "the failure in every red run below is at 588" is true only of the filer's own lg-95 loop, and gate 1's lg-99 loop failed at 747:36.
- 2026-11-10 — Reproduction on the base tree, `a100f42967ec3fc3760a5a6032449be3e986806a`, worktree `agent-a619eeb318f587bf5`, after `bash .claude/scripts/worktree-farm.sh` and `npm run build` (exit 0). Command, run 20 times one at a time, each `timeout 120`:

  ```
  timeout 120 npx vitest run tools/ledger/web/test/history.test.tsx -t "takes focus back when it closes"
  ```

  Result: **2 of 20 red.** Runs 11 and 14 exited 1. The other 18 exited 0 with `Tests 1 passed | 28 skipped (29)`.

  Red run 11 (the failure lines, same as sighting 2):

  ```
  × the button reports whether its control is open, and takes focus back when it closes (lg-95) 396ms
  FAIL  |ledger| tools/ledger/web/test/history.test.tsx > the button reports whether its control is open, and takes focus back when it closes (lg-95)
  AssertionError: expected <body><div>…(1)</div></body> to be <button type="button" …(2)></button> // Object.is equality
  ❯ tools/ledger/web/test/history.test.tsx:588:34
     588|   expect(document.activeElement).toBe(button);
  ```

  Red run 14 has the same failure line, `history.test.tsx:588:34`. The failure happened with the other 28 tests skipped, so no earlier test in the file is needed to make it fail.

  Load, from `uptime` at the start of each run (1-minute average; the machine also had 0 to 19 vitest processes from other sessions by `ps` at each run's start, counted by `grep -c '[v]itest'`; the per-run counts are in `## Reproduction`, added after gate 1's F4, since only the load was tabulated here):

  | Run | Result   | 1-min load at start |
  | --- | -------- | ------------------- |
  | 1   | pass     | 6.64                |
  | 2   | pass     | 6.43                |
  | 3   | pass     | 6.43                |
  | 4   | pass     | 6.47                |
  | 5   | pass     | 6.47                |
  | 6   | pass     | 6.60                |
  | 7   | pass     | 6.60                |
  | 8   | pass     | 7.43                |
  | 9   | pass     | 7.43                |
  | 10  | pass     | 7.48                |
  | 11  | **FAIL** | 7.48                |
  | 12  | pass     | 7.68                |
  | 13  | pass     | 7.62                |
  | 14  | **FAIL** | 7.62                |
  | 15  | pass     | 8.21                |
  | 16  | pass     | 9.08                |
  | 17  | pass     | 10.27               |
  | 18  | pass     | 10.27               |
  | 19  | pass     | 10.09               |
  | 20  | pass     | 10.09               |

  The load range across the 20 runs was 6.43 to 10.27, and the two red runs sat inside it, at 7.48 and 7.62. Two red runs in 20 is too few to call the load a cause. The 1-minute average also lags the run it is recorded against.

- 2026-11-10 — Not measured by the filer: the whole-file run (10 times, per the brief's fallback), because the one-test loop already went red; the lg-99 test with the same assertion (gate 1 measured it, next entry); any run on a machine with no other sessions; any run under the test gate (`npm test`); the cancel path at line 580, which did not fail in the 20 runs.
- 2026-11-10 — Hypothesis for the lg-95 test, not shown by any run and not tested: under load, the save path's focus restore lands after the `waitFor` in the test has returned, so the assertion at 588 sees `body`. The Build's step 2 is there to confirm or refute this; whether it holds for the lg-99 test is equally untested.
- 2026-11-10 — Sightings 1 to 3 in `## Why` are relayed; the filer read sighting 2's output file and did not check sightings 1 and 3. Which test each one was is now stated in the Why (gate 1's F3): sighting 1 the lg-99 test, sighting 2's project run the lg-95 test, its solo 28/29 and sighting 3 unknown.
- 2026-11-10 — **Gate 1's readings (`gate-1@c04797ec`), taken by the gate and not re-measured by the fixer.** Ten runs of each loop on the ticket-only head `c04797ec`, one at a time: the lg-95 loop (the filer's command), at 1-minute load 14.81 to 19.79 with 28 to 33 vitest processes from other sessions, was **8 of 10 red**, every red at `history.test.tsx:588:34`; the lg-99 loop (a command the filer never ran), at load 15.94 to 19.64 with 7 to 26 processes, was **1 of 10 red**, at `history.test.tsx:747:36` on the `unfocused` case. Tables in `## Reproduction`. These two sets and the filer's 2 of 20 differ in more than load, so they do not show load as a cause, and no run was taken on an idle machine.
- 2026-11-10 — **How N = 3 and the 40-to-100-pair window were chosen (gate 1's F2, the owner's answer above).** The rates are rough, each from one set of 10 or 20 runs: lg-95 2/20 at load 6 to 10 and 8/10 at 15 to 20; lg-99 1/10 at 15 to 20. The window has to be one in which the base goes red often enough that a clean branch means something, and a quiet machine, on which the base never goes red, must not pass. Binomial arithmetic on those rates, with p the chance a base run goes red:
  - **Why 3 base reds and not 1.** One or two base reds in a window is what the filer's own 2 of 20 already was, and it can be chance in the window; 3 means the window demonstrably produces failures at a rate where a clean branch is informative.
  - **Why 40 pairs to start.** At p = 0.1 (lg-99's 1 in 10, and about lg-95's rate at the filer's load), 40 base runs reach 3 reds with probability 0.78 (binomial, computed for this entry), and a branch whose fix does nothing goes clean in 40 runs with probability 0.9^40 = 1.5%. At p = 0.8 (lg-95 at gate 1's load) 3 reds arrive within the first few pairs, with probability above 0.9999 in 20 base runs.
  - **Why extend to 100 pairs.** At p = 0.1, 100 base runs reach 3 reds with probability 0.998, so a base that stays under 3 at 100 pairs is a machine too quiet to fail, not bad luck, and the line is graded `unproven`. A do-nothing branch goes clean over 100 runs with probability 0.9^100 = 2.7e-5. A loop run is about 3 seconds in the filer's timings (run 1 of the filer's loop: 01:31:16 to 01:31:19 on `uptime`), so 100 pairs is about 10 minutes.
  - **What can go wrong.** If the true rate is under 0.1 (the 1 of 10 and the 2 of 20 are small samples), the extension reaches the cap without the base getting to 3, and the result is `unproven`, which is the intended outcome and not a pass. A branch red at any point fails the line.
- 2026-11-10 — **Owner's answer to gate 1's F1 (scope).** Question: the ticket names one flaky test and there are two; where does the second one go? Options: (a) widen this ticket to both tests, which is the gate's recommendation; (b) keep it on lg-95 and file the lg-99 flake separately. **Chosen: (a).** Recorded by the fixer on the owner's word, relayed by the orchestrator.
- 2026-11-10 — **Owner's answer to gate 1's F2 (how Done when 2 and 3 prove a fix).** Question: a clean run count means nothing without the load it ran at, so how is a fix proven? Options: interleave base and branch runs in one window, with load recorded per run, so that the fix holds when the base goes red at least N times while the branch stays clean over the same window (the orchestrator's recommendation); require a minimum recorded load (about 7.5); leave it to the builder. **Chosen: the interleaved window.** N and the window size are left to the fixer to choose from the measured rates, with the reason in the Log; a quiet machine, on which the base never goes red, proves nothing and must not pass. Recorded by the fixer on the owner's word, relayed by the orchestrator.
- 2026-11-10 — **Round 1 fixes (fixer), after gate 1.** F1 (a): title, Why, Build and Done when widened to both tests, the lg-99 loop and gate 1's reading added, the "Correction" withdrawn above. F2: Done when's old lines 2 and 3 replaced by the interleaved window; the title and Why say the failures were seen on a busy machine and no longer state load as the cause. F3: the Why says which test each sighting was. F4: `## Reproduction` added, with the filer's per-run vitest process counts (read from the filer's `load-NN.txt` files, which were kept) and gate 1's. `difficulty` and `status` unchanged.
- 2026-11-10 — Owner's answer to gate 2's recorded lows (2026-11-10, relayed by the orchestrator). Question: fix gate 2's lows at the landing, or leave them recorded? Options: fix F2's remainder, N1, N2, N5 and N6 with no re-gate (chosen); leave all recorded. Then N4: leave it (chosen, the gate's recommendation), or add a Build line on making a window busy. N3 also stays recorded; neither N3 nor N4 is changed. Recorded by the fixer on the owner's word.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F2 remainder — "the Why's 'Every red run so far was on a busy machine' ... and Build step 2's 'which of these happens under load'". The Why now says only the runs that recorded the machine's state were on a busy one, and that sighting 2's project run recorded none; Build step 2 no longer says "under load". Proof: `git diff 531bd42c HEAD -- tools/ledger/docs/work/lg-107-flaky-history-focus-test.md | grep -c '^-.*Every red run so far was on a busy machine'` → 1, and the same with `which of these happens under load` → 1.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N1 — "the Log entry 'Gate 1's readings' ... gives the lg-95 loop's range for both loops", and the Reproduction intro, the lg-99 failure block and the `/tmp` sources. The Log entry now gives each loop its own range (lg-95: load 14.81 to 19.79, 28 to 33 processes; lg-99: load 15.94 to 19.64, 7 to 26 processes) and says the lg-99 command is one the filer never ran; the Reproduction intro says gate 1 ran on the ticket-only head c04797ec; the lg-99 block's raw line has its Object.is equality suffix back; the two `/tmp` paths are replaced by a sentence saying gate 1's scratch summary is not kept in the repository. Proof: `git diff 531bd42c HEAD -- tools/ledger/docs/work/lg-107-flaky-history-focus-test.md | grep -c '^-.*Same tree and commands as the filer'` → 1, with `^-.*Both loops run on the base tree` → 1, `^-.*scratchpad/lg-107/gate-1/repro/lg95.summary` → 1, `^-.*scratchpad/lg-107/gate-1/repro/lg99.summary` → 1 and `^-AssertionError: expected` → 1.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N2 — "'The filer read the orchestrator's relay as a wrong line number and wrote the lg-99 test off' and 'which is why the first version of this ticket took it for the lg-95 test'". The attribution to the filer stays; the reasoning attributed to it is dropped, and the retraction says what the Correction said. Proof: `git diff 531bd42c HEAD -- tools/ledger/docs/work/lg-107-flaky-history-focus-test.md | grep -c '^-.*wrote the lg-99 test off'` → 1, and `^-.*which is why the first version of this ticket` → 1.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N5 — "'Red' is not defined ... the `unproven` bullet says 'whatever the branch did' while the next says a branch red fails 'whatever the base did'". Done when now defines red as a failure at the focus assertion (`:588` in the lg-95 test, `:747` or `:756` in the lg-99 test), with a timeout or any other failure not counting, and settles the clash: the `unproven` grade needs the branch not to have gone red, and a branch red fails the line at once, read first, even when the base is under 3 reds. Proof: `git diff 531bd42c HEAD -- tools/ledger/docs/work/lg-107-flaky-history-focus-test.md | grep -c '^-.*whatever the branch did'` → 1 and `^-.*whatever the base did` → 1; for the definition, which only adds, `grep -v 'Fixed at landing' | grep -c '^+.*Red means the test failing at its focus assertion'` → 1.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N6 — "The cost is in the Log only ... At the 100-pair cap that is 200 runs, about 9 to 16 minutes a test, two windows, and a second tree to farm and build". Done when now carries the cost, from the measured 2.7 s (filer) and 4.8 s (gate 1's lg-95 loop at load 15 to 20); the Log's earlier "about 10 minutes" is the quiet-machine figure for one test. Proof, an added sentence: `git diff 531bd42c HEAD -- tools/ledger/docs/work/lg-107-flaky-history-focus-test.md | grep -v 'Fixed at landing' | grep -c '^+.*A run took about 2.7 s'` → 1.
- 2026-11-10 — Gate 1's and gate 2's full reports are on the pull request thread, #790; status unchanged.
