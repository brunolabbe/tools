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
- **Superseded on 2026-11-15 by the owner's amendment below; left as it stood.** **For each of the two tests, an interleaved window shows the fix.** Run the test's loop from `## Reproduction` against the base tree (the tree the branch forked from) and against the branch's tree, alternately, one run at a time, each under `timeout 120`: base, branch, base, branch, so that both trees see the same machine. Record the 1-minute load and the vitest process count with every run, and put the table in the Log. The fix holds for that test when the base goes red **at least 3 times** and the branch goes red **0 times** over the same window.
  - The window is **40 pairs** (40 base runs and 40 branch runs). If the base has gone red fewer than 3 times in them, extend it by 20 pairs at a time, up to **100 pairs**.
  - If the base has gone red fewer than 3 times at 100 pairs, the line is **`unproven`**, not passed, if the branch has not gone red: a window in which the base does not fail has not tested the fix, and a quiet machine is that window. Say so in the Log with the counts, and run the window again when the machine is busy.
  - A single red run on the branch, at any point in the window, fails the line at once, whatever the base has done so far, including when it is still under 3 reds: the branch red is read first, and the window stops there. Record it and go back to step 2.
  - **Red means the test failing at its focus assertion**: `history.test.tsx:588` in the lg-95 test, `:747` or `:756` in the lg-99 test (the lines at `a100f429`), with `document.activeElement` being `body`. A `timeout 120` kill, a test timeout or any other failure is not red: it counts toward neither the base's 3 nor the branch's 0, and the Log records it with its run.
  - The two tests each need their own window: their rates differ (see the Log for why 3, 40 and 100).
  - **The cost.** A run took about 2.7 s (the filer, at load 6 to 10) and about 4.8 s at load 15 to 20 (gate 1's lg-95 loop). The 100-pair cap is 200 runs, about 9 to 16 minutes per test, and two tests make two windows. The base needs a second tree, farmed and built, as well.
- **Superseded on 2026-11-15 by the owner's amendment below; left as it stood.** `npx vitest run tools/ledger/web/test/history.test.tsx` passes every test in the file (29 of 29 at `a100f429`, which the Log's measurements also use).
- `npm run check` passes.
- **Superseded on 2026-11-15 by the owner's amendment below; left as it stood.** The `expect(document.activeElement).toBe(button);` assertions are still in both tests: the save-path one in the lg-95 test (line 588 at `a100f429`) and the first focus assertion in the lg-99 test (line 747), and still assert focus ends on the row's button.

**The owner's amendment of 2026-11-15** (answer and options in the Log). It replaces the three lines marked superseded above. `main`'s base does not go red: 0 of 100 runs for each test at `4e040577`, because a TanStack Query timer flushes the restore effect before the test reads focus (Log, 2026-11-15). So the window runs on `a100f429`, where the race still shows.

- **For each of the two tests, an interleaved window on `a100f429` shows the fix.** Arm A is `a100f429` with no change. Arm B is `a100f429` with the same one-line change the branch makes: the focus restore in `Refile` becomes a `useLayoutEffect`. Run the test's loop from `## Reproduction` on arm A and arm B alternately, one run at a time, each under `timeout 120`: A, B, A, B. Record the 1-minute load and the vitest process count with every run, and put the table in the Log with the load for each pair. The fix holds for that test when arm A goes red **at least 3 times** and arm B **0 times** over the same window.
  - The window is **40 pairs**. If arm A has gone red fewer than 3 times in them, extend by 20 pairs at a time, up to **100 pairs**. If arm A is still under 3 reds at 100 pairs, the line is **`unproven`**: say so with the counts, and do not run it longer.
  - A single red run on arm B fails the line at once, and the window stops there.
  - **Red is scored by what the failing assertion says, not by a line number.** A run is red when it exits non-zero, a code-frame line in its output points at a line whose source in that tree is `expect(document.activeElement).toBe(button);`, and the output has `expected <body>`. At `a100f429` that is line 588, the lg-95 save path (580, its cancel path, counts as red too), or 747 or 756 in the lg-99 test. A timeout or any other failure is not red, and the Log records it with its run.
- **On the branch, based on `main`, the change is in `tools/ledger/web/src/history/History.tsx`**, and `npx vitest run tools/ledger/web/test/history.test.tsx` passes every test in the file (32 at `4e040577`).
- The four `expect(document.activeElement).toBe(button);` assertions in the two tests stay exactly as written. At `4e040577` they are at these lines of `history.test.tsx`, with `a100f429`'s line in brackets: the lg-95 test's cancel path at 588 (580) and its save path at 596 (588); the lg-99 test's first focus assertion at 755 (747) and its second at 764 (756).
- `npm run check` exits 0. The ledger project's suite is CI's, on the pull request.

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
- 2026-11-15 — **Builder, branch `lg-107-focus-flake` off `main` at `4e040577`. Stopped after Build 1 and Build 2. Nothing is fixed: on `main` the base did not go red, and the dispatch says to report that and not build a fix.** The four entries below give the measurements.
- 2026-11-15 — **What the brief has wrong at `4e040577`.** lg-98 (#785, `332fd3ae`) rewrote `History.tsx` and `history.test.tsx` after `a100f429` and moved History's reads and writes onto TanStack Query. The file now has 32 tests, not 29: the lg-95 loop prints `Tests 1 passed | 31 skipped (32)` and the lg-99 loop `Tests 2 passed | 30 skipped (32)`. The lines moved by +8. At `4e040577` the lg-95 test starts at line 571, its cancel-path assertion is at 588 and its save-path assertion at 596; the lg-99 test's first focus assertion is at 755 and its second at 764. The Done when's `history.test.tsx:588 … :747 or :756` are `a100f429`'s lines. At `4e040577`, `:588` is the cancel path, which has never failed. Every run below therefore scores red by content: exit non-zero, a code-frame line whose source in that run's tree is `expect(document.activeElement).toBe(button);`, and `expected <body>` in the output. That reads 588 at `a100f429` and 596, 755 or 764 at `4e040577`. The `-t` patterns still match. The restore effect is at `History.tsx:596-609` at `4e040577`, its `button.current?.focus()` at 603.
- 2026-11-15 — **Build 1, both loops on the base `4e040577`, 100 runs each, one at a time under `timeout 120` (the `## Reproduction` commands): 0 red of 100 (lg-95) and 0 red of 100 (lg-99, 200 cases).** No run failed for any other reason. Load is the 1-minute average from `/proc/loadavg` at each run's start. The vitest count is `ps -eo args | grep -c '[v]itest'` at the same moment. The per-run rows were in the builder's scratch directory, which is not kept.

  | Loop  | Runs | Red | 1-min load  | vitest processes | Mean run |
  | ----- | ---- | --- | ----------- | ---------------- | -------- |
  | lg-95 | 40   | 0   | 6.43 – 8.11 | 9 – 27           | 2.6 s    |
  | lg-95 | 60   | 0   | 2.68 – 8.68 | 0 – 18           | 2.7 s    |
  | lg-99 | 40   | 0   | 5.76 – 8.56 | 3 – 22           | 2.7 s    |
  | lg-99 | 60   | 0   | 3.93 – 8.30 | 0 – 23           | 2.7 s    |

  The lg-95 loop was also run 20 more times on the base, pinned with `taskset` to one or two CPUs, each shared with a busy `node -e 'for (;;) {}'`: 0 of 10 red on one CPU (load 3.77 – 4.93) and 0 of 10 on two (load 4.85 – 8.69). Those runs slowed to about 5 s each, so pinning does not bring the failure back. The filer's 2 of 20 was at load 6.43 – 10.27, and the 40-run lg-95 block above covers 6.43 – 8.11 of that range with 0 red. On the same machine, at load 4.75 – 5.65, **the lg-95 loop on `a100f429` went red 2 of 20** (runs 8 and 12, both `history.test.tsx:588:34` and `expected <body>…`, `Tests 1 failed | 28 skipped (29)`). So the failure still reproduces at the filing sha at the filer's rate, and stopped reproducing on `main` after lg-98.

- 2026-11-15 — **Build 2, the cause, shown by a run: the restore effect runs after the test's assertion.** The probe was a copy of the lg-95 save path and of the lg-99 test (both arms) down to the first focus assertion. It was never committed and was removed after each run. It records a timeline with no assertions: the control's `<fieldset>` leaving the DOM (React's commit, logged from `Node.prototype.removeChild`), the end of the commit's macrotask (a `queueMicrotask` marker), every `setTimeout` set after the Save click and who set it, each timer firing, every `focus()` call with the stack frames that name its macrotask and React phase, and the `waitFor`'s return. It also records `document.activeElement` at the assertion and 50 ms later, and whether the row's button is still connected and still the one `findByRole` returns. 20 runs on each tree, 60 cases each:

  | Tree       | Case              | Focus on `body` at assertion | Button focused 50 ms later | Button replaced | Route that ran the effect's `focus()`                                                                  |
  | ---------- | ----------------- | ---------------------------- | -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
  | `a100f429` | lg-95 save path   | 6 of 20                      | 20 of 20                   | 0               | `flushPassiveEffects` from `processImmediate` (React's scheduler task), 20 of 20                       |
  | `a100f429` | lg-99 focused     | 3 of 20                      | 20 of 20                   | 0               | same, 20 of 20                                                                                         |
  | `a100f429` | lg-99 unfocused   | 5 of 20                      | 20 of 20                   | 0               | same, 20 of 20                                                                                         |
  | `4e040577` | each of the three | 0 of 20                      | 20 of 20                   | 0               | `flushPassiveEffects` from `listOnTimeout`, inside a TanStack Query `setTimeout(0)` callback, 60 of 60 |

  A red case at `a100f429` (lg-99 unfocused), in ms from the test's start: `125.34` the fieldset leaves the DOM, in the scheduler task that commits; `133.18` that task ends; `133.44` RTL's `asyncWrapper` sets its `setTimeout(0)` drain once the `waitFor` callback has passed; `133.93` the drain fires; `134.08` the `waitFor` returns and the assertion reads `body`; `142.05` the effect calls `focus()` on the same, still-connected button, from `flushPassiveEffects` in the next scheduler task. In every one of the 14 red cases the effect ran after the `waitFor` returned, on the same button. So the effect ran, its condition was true when it ran, and the button was not replaced. **The cause is the third of Build 2's four: the effect runs after the test's assertion.** React commits the close in one scheduler task and runs the passive effect (`useEffect`) in a later one. The test's `waitFor` waits for the DOM change and then for one `setTimeout(0)`, and nothing it waits for orders that timer after React's next scheduler task. **The two tests share this cause.** Both arms of the lg-99 test show it too: the `focused` arm also loses focus to `body`, because the focused Save is removed. That arm did not fail in gate 1's ten lg-99 runs, and the probe shows it is open to the same race (3 of 20).

  Why `main` does not show it: on `4e040577` the same effect is flushed earlier, by a `setTimeout(0)` set from `@tanstack/query-core` before the commit. In all 60 cases the timer that fired just before the effect's `focus()` was one of these, set 14.7 to 32.4 ms before the commit. Its callback leads to sync-priority work (`performSyncWorkOnRoot` on the stack), and React flushes pending passive effects before it does sync work. Which TanStack call sets the timer was not traced. The full stack in one run reads `History.tsx:603` ← `flushPassiveEffects` ← `flushPendingEffects` ← `performSyncWorkOnRoot` ← `processRootScheduleInMicrotask` ← `runNextTicks` ← `listOnTimeout`. That timer was set before RTL's drain, so it fires first, and the effect lands before the assertion. **The race is still in the code**: nothing the test waits for orders the effect before the assertion. It is hidden on `main` by a timer the screen's data layer happens to set. These runs do not show whether that ordering holds on every machine.

- 2026-11-15 — **Both candidate fixes were measured on `a100f429`, where the race shows. Neither is committed: choosing between them is the open decision below.** Test side (`await waitFor(() => focus is on the row's button)` after the Save's `waitFor`, the assertion unchanged): the probe gave 0 of 60 cases on `body`, 20 runs. Product side (the restore effect in `Refile` as `useLayoutEffect`, the rest of `History.tsx` unchanged): the probe gave 0 of 60 on `body`, 20 runs, with the `focus()` now inside the commit, from `flushLayoutEffects` ← `commitRoot`. The real loops gave 0 of 20 (lg-95, load 4.05 – 5.09) and 0 of 20 (lg-99, load 3.36 – 3.90), and `npx vitest run tools/ledger/web/test/history.test.tsx` passed `Tests 29 passed (29)`. Neither run is a Done when window: the base was not interleaved with them, and the base for this ticket's window is `main`, where the race does not show.
- 2026-11-15 — **Open decision, for the owner through the orchestrator.** (a) Make the restore a `useLayoutEffect` in `Refile` (product). Focus moves in the same commit that removes the control, before any timer or microtask, so no frame has focus on the page, and the two assertions stay exactly as written. The Done when's window cannot be met on `main`, whose base does not go red. The proof would be rewritten as an interleaved window on `a100f429` with and without the one-line change, plus the whole file on `main`. (b) Wait for the focus in the two tests (test side). The test then reads "focus ends on the button" rather than "focus is on the button once the control has closed", and the product keeps a frame where focus is on the page. The same proof problem as (a). (c) Fix nothing and close lg-107 as not reproducing on `main`, with the cause recorded here. The race stays and is hidden by TanStack Query's timer order. The builder recommends (a). Fold-in: none; the change this branch would carry touches nothing else already specified.
- 2026-11-15 — **Owner's answer to the open decision above**, relayed by the orchestrator on 2026-11-15 and recorded by the builder.
  - **Question:** fix the race in the product, fix it in the test, or close without a fix?
  - **Options:** (1) the product fix, making `Refile`'s focus restore a `useLayoutEffect`, with the Done when's window reworded; (2) the test fix, waiting for focus in the two tests; (3) close with the cause recorded and no fix.
  - **Chosen: (1).** The builder and the orchestrator had both recommended it, and nothing was overridden.
  - **With it, the owner accepted a reworded proof.** That is the amendment under `## Done when`: an interleaved window on `a100f429`, per test, comparing no change with the one-line change. It keeps the ticket's 40-to-100-pair window, its 3 reds against 0, `unproven` at 100 pairs with no further run, and red scored by the assertion's content. On the branch, the change is in `History.tsx`, the whole of `history.test.tsx` passes as a single file, and the focus assertions stay exactly as written. `npm run check` exits 0, and the ledger suite is left to CI. The three Done when lines this replaces are marked superseded and left in place.
- 2026-11-15 — **The fix, on the branch (`9c4f2c28`).** `Refile`'s focus restore in `tools/ledger/web/src/history/History.tsx` is now a `useLayoutEffect`. Its body, its condition and its dependencies are unchanged. A comment says why. `useLayoutEffect` joins the `react` import. `history.test.tsx` is untouched: `git diff --stat 4e040577 HEAD` lists only `History.tsx` and this ticket, and lines 588, 596, 755 and 764 still read `expect(document.activeElement).toBe(button);`. On the branch, `npx vitest run tools/ledger/web/test/history.test.tsx` gave `Tests 32 passed (32)`. `npx oxlint tools/ledger/web` exited 0, and `npm run check` exited 0 at `9c4f2c28`. The timeline probe from the Build 2 entry, run 5 times on the branch (15 cases), had focus on the button at the assertion in 15 of 15. The `focus()` ran from `flushLayoutEffects` ← `commitRoot`, inside the commit that removes the control. The ledger project's suite is left to CI on #808.
- 2026-11-15 — **The amended Done when's windows, both met.** Each ran in one tree at `a100f429`, farmed with `bash .claude/scripts/worktree-farm.sh` and built with `npm run build` (exit 0), then removed. Before each run the tree's `History.tsx` was set to arm A (the file at `a100f429`, compared with `cmp`) or arm B (that file with the effect as `useLayoutEffect`, made by script; `diff` shows only the import line and line 601). Every arm A run had 0 `useLayoutEffect` in the file at its start and every arm B run 2. Each run was the `## Reproduction` loop command under `timeout 120`, one at a time, alternating A, B, A, B. Red is scored as the amendment says. No run failed any other way. Load is the 1-minute average from `/proc/loadavg` at each run's start, and the vitest count is `ps -eo args | grep -c '[v]itest'` at the same moment.

  | Test  | Pairs | Arm A red | Arm B red | 1-min load   | vitest processes | Mean run |
  | ----- | ----- | --------- | --------- | ------------ | ---------------- | -------- |
  | lg-95 | 40    | 5         | 0         | 6.02 – 12.88 | 1 – 20           | 2.5 s    |
  | lg-99 | 60    | 3         | 0         | 3.57 – 6.02  | 0 – 14           | 2.1 s    |

  The lg-95 window stopped at 40 pairs with arm A at 5 reds. Each red was `history.test.tsx:588:34`, the save path, with `Tests 1 failed | 28 skipped (29)`. The lg-99 window had 1 arm A red at 40 pairs, so it was extended by 20, and it had 3 at 60. All three failed at `history.test.tsx:747:36` on the `focused` arm, with `Tests 1 failed | 1 passed | 27 skipped (29)`.

  The lg-95 window, pair by pair:

  | Pair | A (no change)  | B (`useLayoutEffect`) | Load at A | Load at B | vitest at A / B |
  | ---- | -------------- | --------------------- | --------- | --------- | --------------- |
  | 1    | green          | green                 | 7.48      | 7.48      | 12 / 12         |
  | 2    | green          | green                 | 7.36      | 7.36      | 12 / 11         |
  | 3    | green          | green                 | 7.09      | 7.09      | 12 / 12         |
  | 4    | green          | green                 | 7.01      | 7.01      | 12 / 12         |
  | 5    | green          | green                 | 7.00      | 6.84      | 11 / 11         |
  | 6    | green          | green                 | 6.84      | 7.02      | 12 / 12         |
  | 7    | green          | green                 | 7.02      | 6.86      | 12 / 11         |
  | 8    | green          | green                 | 8.15      | 8.15      | 12 / 12         |
  | 9    | green          | green                 | 7.66      | 7.66      | 12 / 12         |
  | 10   | **red** (:588) | green                 | 7.52      | 7.52      | 18 / 20         |
  | 11   | **red** (:588) | green                 | 7.88      | 9.41      | 19 / 16         |
  | 12   | green          | green                 | 10.50     | 10.50     | 16 / 16         |
  | 13   | green          | green                 | 10.22     | 12.12     | 12 / 20         |
  | 14   | **red** (:588) | green                 | 12.12     | 12.03     | 12 / 16         |
  | 15   | green          | green                 | 12.11     | 12.34     | 12 / 6          |
  | 16   | green          | green                 | 12.88     | 12.88     | 20 / 10         |
  | 17   | green          | green                 | 12.25     | 12.25     | 7 / 8           |
  | 18   | green          | green                 | 11.59     | 11.59     | 13 / 13         |
  | 19   | green          | green                 | 11.30     | 11.30     | 11 / 11         |
  | 20   | green          | green                 | 10.87     | 10.87     | 13 / 8          |
  | 21   | **red** (:588) | green                 | 10.24     | 10.24     | 9 / 9           |
  | 22   | green          | green                 | 9.74      | 9.74      | 5 / 9           |
  | 23   | green          | green                 | 9.36      | 9.36      | 8 / 9           |
  | 24   | green          | green                 | 8.93      | 8.93      | 9 / 4           |
  | 25   | green          | green                 | 8.78      | 8.78      | 4 / 1           |
  | 26   | green          | green                 | 8.39      | 8.39      | 4 / 3           |
  | 27   | green          | green                 | 7.96      | 7.96      | 8 / 8           |
  | 28   | green          | green                 | 7.73      | 7.73      | 4 / 8           |
  | 29   | green          | green                 | 7.59      | 7.59      | 5 / 8           |
  | 30   | green          | green                 | 7.38      | 7.38      | 5 / 8           |
  | 31   | green          | green                 | 7.35      | 7.35      | 8 / 8           |
  | 32   | green          | green                 | 7.08      | 7.08      | 11 / 13         |
  | 33   | green          | green                 | 6.83      | 6.83      | 11 / 13         |
  | 34   | green          | green                 | 6.61      | 6.61      | 8 / 9           |
  | 35   | green          | green                 | 6.88      | 6.88      | 13 / 13         |
  | 36   | **red** (:588) | green                 | 6.73      | 6.73      | 13 / 13         |
  | 37   | green          | green                 | 6.59      | 6.59      | 13 / 13         |
  | 38   | green          | green                 | 6.30      | 6.30      | 13 / 13         |
  | 39   | green          | green                 | 6.20      | 6.20      | 13 / 10         |
  | 40   | green          | green                 | 6.02      | 6.02      | 13 / 13         |

  The lg-99 window, pair by pair:

  | Pair | A (no change)  | B (`useLayoutEffect`) | Load at A | Load at B | vitest at A / B |
  | ---- | -------------- | --------------------- | --------- | --------- | --------------- |
  | 1    | green          | green                 | 6.02      | 5.70      | 13 / 13         |
  | 2    | green          | green                 | 5.70      | 5.88      | 13 / 13         |
  | 3    | green          | green                 | 5.88      | 5.73      | 13 / 9          |
  | 4    | green          | green                 | 5.73      | 5.59      | 9 / 9           |
  | 5    | green          | green                 | 5.59      | 5.30      | 9 / 9           |
  | 6    | green          | green                 | 5.30      | 5.30      | 6 / 9           |
  | 7    | green          | green                 | 5.12      | 5.12      | 9 / 9           |
  | 8    | green          | green                 | 4.95      | 4.95      | 9 / 9           |
  | 9    | green          | green                 | 4.95      | 4.95      | 4 / 7           |
  | 10   | green          | green                 | 4.64      | 4.64      | 8 / 7           |
  | 11   | green          | green                 | 4.51      | 4.51      | 12 / 9          |
  | 12   | green          | green                 | 4.39      | 4.39      | 9 / 8           |
  | 13   | green          | green                 | 4.39      | 4.19      | 9 / 9           |
  | 14   | green          | green                 | 4.19      | 4.02      | 8 / 9           |
  | 15   | green          | green                 | 4.02      | 3.78      | 9 / 9           |
  | 16   | green          | green                 | 3.78      | 3.71      | 9 / 10          |
  | 17   | green          | green                 | 3.71      | 3.90      | 13 / 12         |
  | 18   | green          | green                 | 3.90      | 3.99      | 13 / 9          |
  | 19   | green          | green                 | 3.99      | 3.99      | 9 / 9           |
  | 20   | green          | green                 | 3.91      | 3.91      | 5 / 8           |
  | 21   | green          | green                 | 3.91      | 3.91      | 9 / 9           |
  | 22   | green          | green                 | 5.84      | 5.84      | 5 / 9           |
  | 23   | green          | green                 | 5.62      | 5.62      | 12 / 10         |
  | 24   | green          | green                 | 5.57      | 5.57      | 10 / 2          |
  | 25   | green          | green                 | 5.36      | 5.36      | 5 / 5           |
  | 26   | green          | green                 | 5.09      | 5.09      | 4 / 5           |
  | 27   | green          | green                 | 4.92      | 4.92      | 4 / 8           |
  | 28   | green          | green                 | 4.92      | 4.77      | 8 / 3           |
  | 29   | green          | green                 | 4.77      | 4.79      | 7 / 7           |
  | 30   | green          | green                 | 4.79      | 4.72      | 5 / 8           |
  | 31   | green          | green                 | 4.72      | 4.75      | 7 / 5           |
  | 32   | green          | green                 | 4.75      | 4.93      | 4 / 10          |
  | 33   | green          | green                 | 4.93      | 5.17      | 4 / 6           |
  | 34   | **red** (:747) | green                 | 5.17      | 5.24      | 1 / 4           |
  | 35   | green          | green                 | 5.24      | 5.22      | 1 / 4           |
  | 36   | green          | green                 | 5.22      | 4.88      | 0 / 0           |
  | 37   | green          | green                 | 4.88      | 4.88      | 3 / 3           |
  | 38   | green          | green                 | 4.65      | 4.65      | 4 / 4           |
  | 39   | green          | green                 | 4.44      | 4.44      | 4 / 4           |
  | 40   | green          | green                 | 4.40      | 4.40      | 4 / 4           |
  | 41   | green          | green                 | 4.29      | 4.29      | 0 / 4           |
  | 42   | green          | green                 | 4.29      | 4.03      | 4 / 4           |
  | 43   | **red** (:747) | green                 | 4.03      | 3.94      | 0 / 0           |
  | 44   | green          | green                 | 3.94      | 3.87      | 0 / 3           |
  | 45   | **red** (:747) | green                 | 3.87      | 3.80      | 4 / 3           |
  | 46   | green          | green                 | 3.80      | 3.73      | 4 / 3           |
  | 47   | green          | green                 | 3.73      | 4.48      | 4 / 0           |
  | 48   | green          | green                 | 4.48      | 4.48      | 0 / 0           |
  | 49   | green          | green                 | 4.20      | 4.20      | 0 / 0           |
  | 50   | green          | green                 | 3.94      | 3.94      | 0 / 0           |
  | 51   | green          | green                 | 3.94      | 3.71      | 0 / 0           |
  | 52   | green          | green                 | 3.71      | 3.57      | 0 / 0           |
  | 53   | green          | green                 | 3.57      | 4.72      | 14 / 7          |
  | 54   | green          | green                 | 4.72      | 4.83      | 4 / 4           |
  | 55   | green          | green                 | 4.83      | 5.00      | 4 / 8           |
  | 56   | green          | green                 | 5.00      | 5.00      | 5 / 4           |
  | 57   | green          | green                 | 4.92      | 4.92      | 4 / 4           |
  | 58   | green          | green                 | 4.85      | 4.85      | 4 / 3           |
  | 59   | green          | green                 | 4.78      | 4.78      | 4 / 0           |
  | 60   | green          | green                 | 4.56      | 4.56      | 0 / 0           |

- 2026-11-15 — Fixed at landing by owner choice: gate 1, F1 — "By the content rule a failure of the cancel-path assertion is red; by the list it is not named." The amended Done when's red definition now says the cancel-path assertion counts as red too, at line 580 at `a100f429`. Proof: the removed fragment "580 is its cancel path" counts 1 in `git diff 657c6195 HEAD -- tools/ledger/docs/work/lg-107-flaky-history-focus-test.md`, filtered to removed lines.
