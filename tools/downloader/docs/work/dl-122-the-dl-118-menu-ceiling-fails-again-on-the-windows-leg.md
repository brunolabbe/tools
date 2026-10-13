---
id: dl-122
tool: downloader
title: The dl-118 menu ceiling fails again on the Windows leg, at 4286 ms against 4000
kind: fix
status: ready
milestone: null
depends_on: [dl-119]
difficulty: standard
---

# dl-122 — The dl-118 menu ceiling fails again on the Windows leg

## Why

[dl-118](./dl-118-three-age-gate-rows-spend-11-s-each-in-provoke-playback.md)
added `clickTimeoutMs`, and its cap test in `provoke.test.ts` bounds three rows by
a wall-clock ceiling. The menu row (a shell's 18+ menu button, where the two play
clicks are the blocked ones) has a ceiling of `MENU_CEILING_MS = 4000`, set by
[dl-119](./dl-119-the-dl-118-cap-ceiling-fails-on-a-slow-windows-runner.md)
after the same row failed on a Windows runner at 3584 ms against 3000.

On 2026-10-13 the same row failed again on the same leg, on `main` at `6d879b26`:
`expected 4286 to be less than 4000`. The leg is informational, so the run's own
conclusion is still `success`; the failure is visible only on the job.

Two readings of the row on the Windows leg since dl-119 raised the ceiling are on
record. They disagree, which points to an intermittent failure rather than a
constant slowdown. They are different quantities, so they are labelled:

- **Failed:** 4286 ms from the assertion's own timer around `provokePlayback`;
  vitest's per-test time for the same row is 4353 ms (it also covers `goto` and
  context creation). Run 38327148890 at `6d879b26`. The same run's two cookie
  rows read 2163 and 2167 ms, normal.
- **Passed:** 1892 ms, vitest's per-test time (the passing run's timer value is not
  in any log), run 38324641962 at `e240fbd1` (PR #467), 30 minutes earlier, on the
  same Windows leg. Its cookie rows read 2152 and 2111 ms.

The leg was not slow in the failing run; one row was, and its neighbours were
normal. That is dl-119's shape too (menu 3587 ms against cookie rows 2252 and
2239 ms).

The 4000 ms ceiling was set from a 3.6 s Windows reading and a 5.5 to 5.7 s
uncapped one-site regression on Linux. The Windows reading is now 4.3 s. A 4286 ms
reading is 1.2 s under the regression, so on its own it does not show that the
cap was working. Whether the
runner's uncapped path is also slower is unmeasured. Until someone measures it, a
wall-clock reading from a Windows runner cannot separate a slow cap from a partly
uncapped page. dl-119 left the same question open for its 3584 ms reading.

This is the second Windows failure of the menu row. dl-95 and dl-119 both chose a
wall-clock ceiling for a slow Windows runner, and this is the same kind of failure.

## Reproduction

Re-run on 2026-10-13, from the worktree at `6d879b26` (`origin/main`).

```
$ gh run view 38327148890 --json headSha,conclusion,event,name,jobs   (summarised)
headSha 6d879b2682e7e7cef34479cb944ce5e3413a0d69, event push, run conclusion success
job "test (windows-latest, informational)"  id 115068775760  conclusion failure
  step "Run npm test"  conclusion failure

$ gh run view --job 115068775760 --log-failed | grep -E "FAIL |AssertionError"
test (windows-latest, informational)	Run npm test	... FAIL  downloader tools/downloader/resolvers/test/browser/provoke.test.ts > clickTimeoutMs caps the clicks a covering layer blocks (dl-118) > a shell's 18+ menu button: the blocked clicks wait for the cap, not 2000 ms
test (windows-latest, informational)	Run npm test	... AssertionError: expected 4286 to be less than 4000
test (windows-latest, informational)	Run npm test	##[error]AssertionError: expected 4286 to be less than 4000
```

(ANSI colour codes removed, the repeated job-and-step prefix shortened.)

```
$ gh run view 38324641962 --json headSha,conclusion,event,name,jobs   (summarised)
headSha e240fbd1ce2bf36d386ad90034998c9f0e40f623, event pull_request, run conclusion success
job "test (windows-latest, informational)"  id 115060412701  conclusion success
  step "Run npm test"  conclusion success

$ gh run view --job 115060412701 --log | grep -a "menu button: the blocked clicks"
...✓ a shell's 18+ menu button: the blocked clicks wait for the cap, not 2000 ms 1892ms
```

The ceiling in the file:

```
$ grep -n "MENU_CEILING_MS" tools/downloader/resolvers/test/browser/provoke.test.ts
641:  const MENU_CEILING_MS = 4000;
653:      MENU_CEILING_MS,
```

Locally the row is not reproduced: a Linux run reads the capped menu row at 1.9 to
2.1 s (dl-119's table). The failure is the Windows runner's, so the test can only
be checked locally against the two regressions the row must keep catching.

## Build

**Decision: the form of the menu row's bound.** This is an open choice between
options with different costs, so it is the owner's to make, not the builder's.
Options, the recommended one first:

1. **Chosen (owner, 2026-10-13).** **Measure the mechanism, not the clock.** Assert that the menu row's blocked
   clicks were given the cap as their timeout, by observing the click calls,
   instead of asserting on total elapsed time. It does not depend on runner speed
   at all, and it takes the wall-clock threshold out of this row. Cost: a different
   test shape, and the title and comment change, since the row no longer proves a
   wall-clock bound; it also does not cover waits that are not click timeouts. The
   builder first checks that the cap reaches the click call as its timeout option.
   Two more qualifiers, from the gate's probe on the head. The observation point
   is Playwright's internal `Locator` class (wrap `click` on
   `Object.getPrototypeOf(page.locator("body"))`), which is not documented API,
   a cost this option carries. And the assertion cannot be "no click got 2000 ms",
   because the age-gate press and the video clicks legitimately carry 2000 and
   1500: key it by outcome, so that every click that **rejected** was given the
   cap, with a companion that fails on empty (at least one rejected click, not an
   exact count, which varies with timing) and the uncapped control at 2000. The
   gate's probe, which showed all three plants and the uncapped control, is a
   starting point: `/tmp/claude-1000/-workspaces-tools/af8e8ee8-720f-4ca5-a229-4eddd777e39b/scratchpad/dl-122/gate-1/probe.mts`
   (scratch, not committed; it takes `<worktree> <cap|none> <pathname>`). Wrap
   `click` by hand and restore it in `finally`, rather than `vi.spyOn`: the file
   imports no `vi`, and adding it would change the import line, outside the cap
   block that Done when 5 allows. Recommended because it removes the recurring cause rather than moving the
   threshold again.
2. **Not taken.** **Raise `MENU_CEILING_MS` to 4500 ms.** The smallest change, and the same form
   as dl-119. Cost: 4500 leaves 214 ms above the slowest Windows reading on record
   (4286 ms) and about 1 s under the one-site regression (5.5 s on Linux). A slower
   runner later needs the next raise, and the row's margin against its regression
   narrows with each one.
3. **Not taken.** **Skip or retry the row on Windows.** Cost: a Windows-only skip drops the only
   coverage that runs on the platform where the slow readings occur, and a retry
   hides a real regression. Not recommended.

Whichever option is chosen, the work is:

- Plant each regression and show the row it should fail does fail, as dl-119's
  Done when 2 required: consent click uncapped (both cookie rows), play selector
  click uncapped and play text click uncapped (menu row, each alone and both).
  Record each plant's time, or for option 1 the timeout each click was given.
- Time only `provokePlayback`, as dl-119 does.
- Change only the dl-118 cap block of `provoke.test.ts` (dl-113's edits to the other
  blocks merged in #450).
- Record in the Log the margin the bound leaves against the capped runs (including
  1892, 3584 and 4286 ms from the Windows leg) and against the regression, measured
  more than once locally. A Windows leg can show one reading per run, so the margin
  against Windows readings is a count of readings, not a measurement.

## Done when

1. The owner's answer to the decision above is recorded in the Log, with its date
   and the option it was chosen from, and `status` is `ready` in the commit that
   records it.
2. The menu row's check, in the form chosen, passes at the 4286 ms reading on
   record, and still fails each planted regression. For a wall-clock form, the bound
   sits above 4286 ms and below the one-site uncapped reading; for option 1, the
   Log shows the timeout each click was given, capped and uncapped.
3. Each planted regression fails the row it should, and the Log records each plant
   with its time or timeout: consent click uncapped fails both cookie rows; each
   play click uncapped, and both, fails the menu row.
4. The three rows pass with the cap in place:
   `npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t
"clickTimeoutMs caps"` reports `Tests 3 passed`.
5. Nothing outside the dl-118 cap block of `provoke.test.ts` changes, other than
   this ticket.

## Log

- 2026-10-13 — Filed by a builder in a maintenance dispatch (model: Haiku 5.5,
  builder-mechanical), from the reproduction above, with no code or test change.
  - **Status `needs-decision` when filed, `ready` now.** The Build's form was an
    open choice between options with different costs, and the builder may not
    settle it.
  - **Difficulty `standard`**, rated for the work once an option is chosen. It is
    the same procedure as dl-119, which was rated `standard`. Option 1 is more
    judgement than option 2; the rating was left as filed when the answer landed,
    and the owner may re-rate it.
  - Commands run for the reproduction are in the Reproduction section, and their
    output is pasted there.
  - What the sibling said that this reading now contradicts: dl-119's Log says the
    slowest Windows capped reading (3.6 s) left 0.4 s to the 4000 ms ceiling. A
    4286 ms Windows reading is past it.
- 2026-10-13 — Gate (ticket-reviewer-sonnet, Sonnet 5.5, narrow): PASS, six low
  findings, all fixed in this pull request. The gate's record is the pull request
  thread, not a committed file (the ticket stays `ready`, so records.md commits
  none): https://github.com/brunolabbe/tools/pull/470#issuecomment-6135887121
  - **The gate measured what the filing called unmeasured.** Every `ci.yml` run
    since #456's merge: 39 Windows readings reached the cap rows. The menu row
    passed 38 times at 1887 to 2255 ms (median about 2010) and failed once, at
    4353 ms, which is the run named above. The cookie rows read at most 2329 ms
    against their 3200 ms ceiling. So the failure is one outlier in 39 readings,
    on one row, with its neighbours normal.
- 2026-10-13 — **Owner's answer, status `ready`.** The question was "the form of
  the menu row's bound", with the options (1) observe the click timeout, (2) raise
  `MENU_CEILING_MS` to 4500 ms, (3) skip or retry on Windows, (4) leave it
  `needs-decision`. The owner chose **option 1**, with the 1-in-39 measurement in
  front of them. That was the builder's recommendation, so none was overridden.
  The owner also chose to fix the gate's six lows in this pull request.
