---
id: dl-105
tool: downloader
title: dl-80's empty-floor test reads elapsed time below its 9000 ms floor in a full suite
kind: fix
status: ready
milestone: null
depends_on: [dl-80]
difficulty: standard
---

# dl-105 — The empty-floor test measures below its own floor in a full suite

## Why

dl-80's test "a page with no media respects the empty floor and the deadline" in
`resolvers/test/browser/browser-resolver.test.ts` (describe block "Empty media
floor: pages with delayed players wait longer before NO_MEDIA_FOUND (dl-80)")
asserts `expect(elapsedMs).toBeGreaterThanOrEqual(9000)` after a probe built with
`emptyMinWaitMs: 9000`. It has twice failed with an elapsed time **below** the
floor, both times in a full-suite run; it passes alone:

1. dl-90's first build, `npm test -- --project downloader` inside
   `node scripts/preflight.mjs`, on 2026-10-10. The preflight log
   (`dl-90/build/preflight.log` in the orchestrator's scratch, not committed)
   reads:

   ```
   FAIL  |downloader| tools/downloader/resolvers/test/browser/browser-resolver.test.ts > Empty media floor: pages with delayed players wait longer before NO_MEDIA_FOUND (dl-80) > a page with no media respects the empty floor and the deadline
   AssertionError: expected 8577 to be greater than or equal to 9000
    ❯ tools/downloader/resolvers/test/browser/browser-resolver.test.ts:1842:25
   ```

   The same log: `Test Files 1 failed | 109 passed | 1 skipped (111)`,
   `Tests 1 failed | 2314 passed | 2 skipped (2317)`, the file at 593294 ms and
   that test at 10606 ms.

2. dl-93's branch: `expected 8040 to be greater than or equal to 9000`.
   **Relayed from dl-93's builder report; its log was overwritten, so the
   line is not quoted from a file and the run is not reproducible from a
   record.**

Neither branch touches that test or the code it exercises for this purpose. Run
alone on dl-90's branch (merged with `origin/main` `1a044437`) it passes:

```
npx vitest run --project downloader tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "respects the empty floor and the deadline"
Test Files  1 passed (1)
     Tests  1 passed | 161 skipped (162)
```

What is odd, and why this is a defect and not noise like
[dl-95](./dl-95-the-empty-floor-ceilings-flake-on-a-slow-windows-runner.md)'s
ceilings: **a slow machine can only lengthen the elapsed time**, and the floor is
counted inside `waitForQuiet` from the probe's own start, so an elapsed time
**shorter** than the floor says either the floor started counting before the
test's `startTime`, or the wait ended early, or the clock the test reads and the
clock the wait reads disagree. A timeout that fires late would flake the ceiling,
as dl-95 found; one that returns early flakes the floor, and this is the second
kind.

## Build

Not chased at filing; the owner's instruction to the filer was to record the
numbers and stop. The first move is a reproduction: run the whole
`resolvers/test/browser/browser-resolver.test.ts` file (not the one test) several
times, and the downloader project, logging `Date.now()` at the test's
`startTime`, at the entry of `waitForQuiet` and at its return, to find which of
the three explanations holds. Read `resolvers/src/browser/` for `emptyMinWaitMs`
before guessing: a pooled browser that has already been warmed by an earlier test
in the file, or a floor that begins when the first request is seen rather than
when `resolve` starts, might both give a short elapsed time only after other
tests have run.

Then fix the cause, not the assertion: loosening 9000 to 8000 would hide a floor
that returns early.

## Done when

- The cause is named in the Log, with a run that shows it (a log line, or a test
  that fails before the fix and passes after).
- The test passes in 10 consecutive runs of the whole file and of
  `npm test -- --project downloader`, or the Log says why that is not the bar.
- `npm run check` passes.

## Log

- 2026-10-10, filed from dl-90's landing. The owner chose to file it. Numbers
  above; the cause was not chased. `difficulty: standard`: the cause is unknown,
  and finding it needs judgement about three candidate explanations, but nothing
  in the brief touches a contract or an architecture choice.

- 2026-10-11, built (the builder; Sonnet 5.5). **The cause is the third
  candidate, and it is in the test: it timed the floor on the wall clock
  (`Date.now()`), and the wall clock lost about two seconds before the wait
  began.** The wait did what it should.
  - **The evidence is in the filing's own log, which the brief quoted without
    comparing its two numbers.** dl-90's preflight log
    (`dl-90/build/preflight.log`, lines 10 and 17) has vitest timing the test
    at 10606 ms and the assertion reading `expected 8577`. Vitest times a test
    on the monotonic clock. A normal pass of this test takes 10.5 to 10.7 s
    (10535 ms in a whole-file run and 10701 ms alone, this entry), so the probe
    ran its normal length and `Date.now()` read 2029 ms less of it. Neither
    other explanation can make a normal-length test read short. The wait counts
    from its own start and returned at `waitedFor=9023` on the wall clock and
    on the monotonic clock alike (instrumented, below). And no early return
    exists on this page: `stop` needs DRM or a departure, and `hasPlayableHit`
    was false (`playable=false eff=9000` in the log), so the floor was 9000.
  - **Why only the test can lose the time.** The wait takes its `startedAt`
    after page load, and the test took its `startTime` before it, so a wall
    clock stepped back during the load is seen by the test and not by the
    wait. That is also why a slow machine cannot cause it: it needs the clock
    to move, not to be slow.
  - **Not caught in the wild.** Instrumented (`Date.now` and `performance.now`
    at the test's start and end and at the wait's entry and exits; temporary,
    reverted), one whole-file run passed 181 of 181 in 614.55 s, with the floor
    test at `elapsed=10535 perfElapsed=10536` and the wait at `waitedFor=9023
perfWaited=9023`. A monitor sampling `Date.now()` against
    `performance.now()` once a second saw no step across 26 minutes, which
    took in that run and the preflight's downloader project (which passed). It
    saw the wall clock gain a steady 55 ms per 30 s (0.18 percent), which over
    10 s is 18 ms and explains nothing. A second whole-file run was killed
    part-way to keep the spend sane. So the step is inferred from the two
    numbers above, not observed.
  - **Reproduced on demand, instead.** The new last test in
    `browser-resolver.test.ts`, "a wall clock stepped back before the wait does
    not read as a floor that returned early", spies `Date.now` and steps it
    back 5 s from the resolver's own `network-quiet` stage callback, which runs
    after the test took its start and before the wait takes its own. Before the
    fix, asserting the old measurement, it failed with `AssertionError:
expected 1450 to be greater than or equal to 3000` (floor 3000 ms; the
    test's wall clock had lost the whole 5 s). After it, with the assertion on
    the stopwatch: 1 of 182 passes, and dl-80's floor test, on the same
    stopwatch, 1 of 182 passes. The 9000 ms floor is unchanged.
  - **The fix** is `startStopwatch` (a `performance.now()` reader, at the end of
    the file) in place of `Date.now() - startTime` in dl-80's floor test, the
    only assertion on elapsed time in that block that is a lower bound. The
    ceilings in the other four tests keep `Date.now()`: a step back can only
    shorten what they read, and a ceiling that reads short still held.
  - **Why the bar is not ten consecutive runs.** The whole file takes 614 s
    alone, so ten runs of it and ten of the project are about three hours,
    for an event that has happened twice in the project's history and was not
    seen in 26 minutes here. A pass count would not discriminate between a
    fixed test and one that has not met a step. The deterministic test does,
    and it fails without the fix.
  - **Production was left alone.** `waitForQuiet`, the collector's
    `lastActivityAt` and every deadline in the resolver also read
    `Date.now()`, so a step forward inside the wait shortens the floor by the
    step. That was not seen and is not what failed; it is not filed because
    nothing reproduces it.
  - **What the brief had wrong:** it asked for the reproduction in a full-suite
    run, and the full run was never needed to name the cause, since the
    filing's own log held the two clocks side by side. It also put the
    suspicion on `emptyMinWaitMs` and a pooled browser; neither is involved.
