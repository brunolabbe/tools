---
id: lg-107
tool: ledger
title: The lg-95 focus test fails under load on main, and its cause is not yet shown
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# lg-107 — The lg-95 focus test fails under load on main, and its cause is not yet shown

## Why

The test `the button reports whether its control is open, and takes focus back when it closes (lg-95)` in `tools/ledger/web/test/history.test.tsx` fails now and then on `main`'s code, when the machine is busy with other sessions' suites. It usually passes on a solo run: the filer's own solo loop went red 2 times in 20 (see the Log). A red ledger run is what whoever meets it gets, and the failure says nothing about the change under test, so each one costs a rerun of the whole ledger project. The failure has now been reported in three places. They are relayed to this filing, not checked by it, except where the Log says otherwise.

1. **2026-11-10, lg-105's landing (PR #780).** Relayed by the orchestrator from the lander's thread comment on #780: `review-record.mjs --land` ran preflight, and `npm test -- --project ledger` failed on the `expect(document.activeElement).toBe(button);` assertion while other sessions' vitest runs shared the machine. A solo `npx vitest run tools/ledger/web/test/history.test.tsx` then passed 29 of 29.
2. **2026-11-10, lg-104's round 1 builder** (branch `lg-104-refuse-shared-parts`, which touches no `tools/ledger/web` file). Relayed by the orchestrator: `npm test -- --project ledger` gave 2,334 of 2,335 with this test failing, and solo runs of the spec gave 29/29, 29/29, then 28/29. The builder's output file was read by the filer, and its failure lines are these:
   - `× the button reports whether its control is open, and takes focus back when it closes (lg-95) 167ms`
   - `AssertionError: expected <body><div>…(1)</div></body> to be <button type="button" …(2)></button> // Object.is equality`
   - `❯ tools/ledger/web/test/history.test.tsx:588:34`
   - `Tests  1 failed | 2334 passed (2335)`
3. **Undated, relayed by the coordinator from tools-86.** Its repo-129 builder (branch `repo-129-split-isolation`) hit this failure once under load. tools-86 says it was the isolated half, not an isolation effect. The relay does not say what "the isolated half" refers to, and the filer has not checked it.

The filer's own reproduction, on the base, is in the Log below.

## Build

1. **Reproduce before changing anything.** Run the Reproduction's command on the base tree, as many times as the failure rate needs to show a red run (at least one in 20, per the Log). Record the machine's load with each run. The failure is intermittent, so a fix is judged by a count of red-before and green-after runs, never by one run.
2. **Find the cause by a run, not by reading.** The failing assertion is the one on the save path: `expect(document.activeElement).toBe(button);`, directly after `await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());` in the lg-95 test. Its cancel-path twin, the same assertion after `cancel` is clicked, has not failed in the filer's runs. In the failing runs the active element is `body`. The focus restore is the `useEffect` in `Refile` in `tools/ledger/web/src/history/History.tsx`, which calls `button.current?.focus()` when the control has just closed by this row's own Cancel or Save and `document.activeElement` is `document.body`. Show by a run which of these happens under load: the effect does not run, the effect runs and its condition is false when it does, the effect runs after the test's assertion, or the button is replaced before the effect runs. Put the one that the run shows in the Log.
3. **Fix the cause the run shows, in the product or in the test.** A longer wait in the test is a fix only if the run shows the product's focus restore lands after an event the test does not wait for. Do not weaken the assertion: after the Save closes the control, focus must still end on the row's button. Do not add `retry`, `skip` or `todo` to the test.
4. **Keep the lg-99 tests' assertions unchanged.** `tools/ledger/web/test/history.test.tsx` also asserts `document.activeElement` against the row button in the lg-99 tests further down the file. They were not run for this filing, and a fix to the restore effect will reach them, so run the whole file after the change.

## Done when

- The Log names the cause, and the run that shows it, from step 2. It is not a hypothesis.
- On the base tree the Reproduction's loop shows at least one red run of 20, with its `:588:34` failure line, and the Log quotes it.
- On the branch, 40 runs of the Reproduction's command, each with `timeout 120`, all pass, with the machine's load recorded in the Log. (The base rate measured by the filer is 2 red in 20, so a clean 40 is evidence, not proof.)
- `npx vitest run tools/ledger/web/test/history.test.tsx` passes every test in the file (29 of 29 at `a100f429`, which the Log's measurements also use).
- `npm run check` passes.
- The save-path assertion `expect(document.activeElement).toBe(button);` is still in the lg-95 test, and still asserts focus ends on the row's button.

## Log

- 2026-11-10 — Filed on `origin/main` at `a100f429`, under the id `lg-107` reserved for it (`lg-106` is held by PR #789, peer tools-86's). The commit adds this file only. Status is `ready`: the cause is not known, but the reproduction is in hand and no question for the owner is open.
- 2026-11-10 — **Correction to the filing brief.** The brief named the failing assertion "around line 747". Line 747 is not in this test. The lg-95 test is at lines 563 to 589 at `a100f429`, and its two `expect(document.activeElement).toBe(button);` lines are 580 (cancel path) and 588 (save path). Lines 747 and 756 belong to a parameterized lg-99 test, `after a stored save whose re-read is still running, focus is on the row's button and nothing says it is unread, ${arm} (lg-99)`. The failure in every red run below is at 588.
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

  Load, from `uptime` at the start of each run (1-minute average; the machine also had 0 to 19 vitest processes from other sessions by `ps` at each run's start, counted by `grep -c '[v]itest'`):

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

- 2026-11-10 — Not measured by the filer: the whole-file run (10 times, per the brief's fallback), because the one-test loop already went red; the lg-99 sibling test with the same assertion; any run on a machine with no other sessions; any run under the test gate (`npm test`); the cancel path at line 580, which did not fail in the 20 runs.
- 2026-11-10 — Hypothesis, not shown by any run and not tested: under load, the save path's focus restore lands after the `waitFor` in the test has returned, so the assertion at 588 sees `body`. The Build's step 2 is there to confirm or refute this.
- 2026-11-10 — Sightings 1 to 3 in `## Why` are relayed; the filer read sighting 2's output file and did not check sightings 1 and 3.
