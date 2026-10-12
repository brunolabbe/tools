---
id: dl-105
tool: downloader
title: dl-80's empty-floor test reads elapsed time below its 9000 ms floor in a full suite
kind: fix
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-11 · `9d0e2ea6..96b8bb03` · Opus 5.5, depth full

| Done when                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The cause is named in the Log, with a run that shows it      | `resolvers/test/browser/browser-resolver.test.ts` › "a wall clock stepped back before the wait does not read as a floor that returned early" ✓. Its `expect(elapsedMs).toBeGreaterThanOrEqual(floorMs)` fails with `startStopwatch` put back on `Date.now` (`expected 1434 to be greater than or equal to 3000`) and passes at head. The Log's arithmetic also checks out: `@vitest/runner` 4.1.10 times a test with `performance.now`, vitest's duration runs 3 ms over the test's own window here, and so dl-90's 10606 ms against `expected 8577` is a wall clock about 2.03 s behind the monotonic one. See the first med for what the test cannot see. |
| 10 consecutive runs, or the Log says why that is not the bar | **verified**. The reason holds, and I measured it again. The whole file took 619.00 s here (`Tests 182 passed (182)`, floor test 10544 ms), so ten runs of the file and ten of the project take about 3.4 h. A monitor running 1500 s saw 0 backward steps (largest backward move 0.92 ms), so a pass count cannot tell a fixed test from one that never met a step. The deterministic test can tell them apart (row above).                                                                                                                                                                                                                                |
| `npm run check` passes                                       | **verified**: exit 0 at `96b8bb03`. CI `check` also passed on `96b8bb03`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

- **med** · no `Done when` line depends on it (the `Date.now` control above meets line 1) · **the new test's wait ends on a quiet gate the step stalled, not on its floor, so its floor assertion passes with the floor deleted.** The test steps `Date.now` back 5 s at `network-quiet`, which comes after the page's last request. The collector's `lastActivityAt` was stamped before the step, so `idleFor` in `waitForQuiet` (`src/browser/provoke.ts`) stays negative for 5 s, and the wait runs about 5000 + 1200 ms whatever the floor is. I planted `effectiveMinWaitMs = options.minWaitMs` (production ignores `emptyMinWaitMs`). The new test still passed, at 6394 ms; dl-80's floor test caught it (`expected 2870.2 to be greater than or equal to 9000`). In dl-90's run the wait did end on its 9000 floor, because vitest's 10606 ms is a normal length. A stall of step + 1200 ≤ 3.2 s also hides under a 9 s floor. So the test reproduces the measurement error, but with a different exit from the wait. **Remedy (measured):** step at the `page-load` stage instead, which is also where the Log puts the step. At head it passes (4605 ms). With the `Date.now` stopwatch it fails (`expected -318 to be greater than or equal to 3000`). With the floor deleted it fails (`expected 2805.7 to be greater than or equal to 3000`). Mutation and run scripts: `gate-1/mutate.mjs` (`steppageload`, `nofloor`, `datenow`), `gate-1/matrix.sh <worktree> <sha> <outdir> <mutations…>`.
- **med** · no `Done when` line depends on it · **the Log's clock-monitor reading is false as measured here, and the open decision rests on it.** The Log says the monitor "saw no step across 26 minutes" and saw the wall clock "gain a steady 55 ms per 30 s". It also says a forward step inside the wait "was not seen". Sampling `Date.now()` against `performance.timeOrigin + performance.now()` every 20 ms for 1500 s gave 50 jumps, every one of them forward, 57.9–70.9 ms each, one every 30.0 s. Between jumps the offset was flat to under 1 ms. The divergence is steps, not a rate. A rate could not produce it anyway: slewing moves `CLOCK_MONOTONIC` with `CLOCK_REALTIME`. Two of my instrumented floor runs took one. In one, the wall clock read 58 ms more than the monotonic clock between `page-load` and `provoke-playback`. In the other it read 61 ms more inside the wait (wall span from `network-quiet` to `settle-requests` 9090 ms, monotonic 9029). The same mechanism undercuts the Log's sentence on the four ceilings that kept `Date.now()`, "a step back can only shorten what they read". True, but a forward step, which happens here every 30 s, lengthens what they read by up to 71 ms. Monitor script: `gate-1/clockmon.mjs <seconds> <outfile>`.
- **low** · `nfr:maintainability` · dl-80's floor test, whose measuring line this branch rewrote, starts timing before page load. The time before the wait ran 1617–1669 ms (monotonic) in 12 instrumented runs, so a floor cut short by less than that still passes. With the floor capped at 8000 the test passed at 9703 ms; capped at 7000 it failed at 8683. The slack was already there at the base. Starting the stopwatch from the `network-quiet` stage callback would bound the wait itself.
- **dropped** · "the named cause is only the one picked". Each alternative the brief and the dispatch named either shortens the real (monotonic) length of the test, or only lengthens what the test reads: an early return, `emptyMinWaitMs` not applied, a floor counted from elsewhere, a pooled page, time before `waitForQuiet`. The plants show it: capped at 7000, vitest timed 8687 ms; with no floor, 2874 ms. Runs that pass take 10544–10709 ms (9 runs). The filed 10606 ms is normal, and `no-media.html` cannot depart or produce a playable hit. That leaves a wall clock about 2.03 s behind outside the wait. A step inside the wait would have lengthened the test to about 12.6 s. Kept as the cause the evidence forces, with one caveat: no backward step has been seen in this container (0 of 50 steps).
- **dropped** · CI `test (windows-latest, informational)` fails on `96b8bb03` in `engine/test/parallel-ranges.test.ts` (dl-98's "bytes held ahead never exceed 4 x 4 MB…" and "F9: a request ffmpeg closed…"). This branch touches no engine file: out of the reviewed diff. `test (ubuntu-latest)` passed on the same sha.
- **findings** · the hunt returned 5; 3 carried, 2 dropped.
- Invariants: no production file changed (`git diff --name-only` names only the ticket and `browser-resolver.test.ts`), so imports, errors, shell, redaction, SSRF, progress, contract and image closure are skipped. Style holds: `vi` imported explicitly, no `any`, no `console`.
- NFR: security n/a · performance n/a · reliability — first med, Log finding · maintainability — low above.

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
perfWaited=9023`. [WITHDRAWN — do not cite this sentence or the next one; see the correction entry of 2026-10-11 below] A monitor sampling `Date.now()` against
    `performance.now()` once a second saw no step across 26 minutes, which
    took in that run and the preflight's downloader project (which passed). It
    saw the wall clock gain a steady 55 ms per 30 s (0.18 percent), which over
    10 s is 18 ms and explains nothing. A second whole-file run was killed
    part-way to keep the spend sane. So the step is inferred from the two
    numbers above, not observed.
  - **Reproduced on demand, instead.** The new last test in
    `browser-resolver.test.ts`, "a wall clock stepped back before the wait does
    not read as a floor that returned early", spies `Date.now` and steps it
    back 5 s from the resolver's own `network-quiet` stage callback (superseded: the step now lands at `page-load`, see the correction entry of 2026-10-11 below), which runs
    after the test took its start and before the wait takes its own. Before the
    fix, asserting the old measurement, it failed with `AssertionError:
expected 1450 to be greater than or equal to 3000` (floor 3000 ms; the
    test's wall clock had lost the whole 5 s). After it, with the assertion on
    the stopwatch: 1 of 182 passes, and dl-80's floor test, on the same
    stopwatch, 1 of 182 passes. The 9000 ms floor is unchanged.
  - **The fix** is `startStopwatch` (a `performance.now()` reader, at the end of
    the file) in place of `Date.now() - startTime` in dl-80's floor test, the
    only assertion on elapsed time in that block that is a lower bound. The
    ceilings in the other four tests keep `Date.now()`: [WITHDRAWN — do not cite this sentence; see the correction entry of 2026-10-11 below] a step back can only
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
    step. [WITHDRAWN — do not cite this sentence; see the correction entry of 2026-10-11 below] That was not seen and is not what failed; it is not filed because
    nothing reproduces it.
  - **What the brief had wrong:** it asked for the reproduction in a full-suite
    run, and the full run was never needed to name the cause, since the
    filing's own log held the two clocks side by side. It also put the
    suspicion on `emptyMinWaitMs` and a pooled browser; neither is involved.

- 2026-10-11, correction and landing (the lander; Sonnet 5.5, fixer). Gate 1
  (Opus 5.5) returned CONCERNS with two meds and a low; the owner chose to fix
  both meds at landing without a re-gate. Their text is in the gate's section
  above, as the gate wrote it. The low (dl-80's floor test starts timing before
  page load, so a floor cut short by less than about 1.6 s still passes) stays
  recorded and unfixed.
  - **Correction of the clock-monitor sentences above (the builder's; found
    false by gate 1).** The builder wrote that the monitor "saw no step across
    26 minutes" and saw the wall clock "gain a steady 55 ms per 30 s". Gate 1
    sampled `Date.now()` against `performance.timeOrigin + performance.now()`
    every 20 ms for 1500 s (`gate-1/clockmon.mjs`, in the orchestrator's
    scratch, not committed): 50 jumps, every one forward, 57.9 to 70.9 ms each,
    one every 30.0 s, and the offset flat to under 1 ms between them. The
    divergence is steps, not a rate; slewing moves `CLOCK_MONOTONIC` with
    `CLOCK_REALTIME`, so a rate could not produce it. No
    backward step was seen (0 of 50; the largest backward move was 0.92 ms),
    which still leaves the filing's 2029 ms loss inferred from its two numbers.
  - **Correction of "a step back can only shorten what they read".** True of
    the four ceilings that keep `Date.now()`, and incomplete: a forward step,
    which happens here every 30 s, lengthens what they read by up to 71 ms. The
    same holds for production's `Date.now()` readers (`waitForQuiet`, the
    collector's `lastActivityAt`, the browser deadlines): a forward step inside
    the wait shortens the floor by the step. Gate 1's instrumented floor runs
    took one, 58 ms between `page-load` and `provoke-playback` in one and 61 ms
    inside the wait in the other (wall span `network-quiet` to `settle-requests`
    9090 ms, monotonic 9029). "That was not seen" in the production sentence is
    withdrawn for the same reason. The size of these steps explains none of the
    2029 ms.
  - **Fixed at landing (gate 1, first med): the new test stepped the clock where
    the wait could stall, not where it could return early.** At
    `network-quiet` the collector's `lastActivityAt` was stamped before the
    step, so `idleFor` in `waitForQuiet` stayed negative for the 5 s step and
    the wait ran about 5000 + 1200 ms whatever the floor was: with the floor
    deleted the test still passed (6394 ms, gate 1). The step now lands at
    `page-load`, before navigation. `browser-resolver.test.ts`, the last test,
    with its comment saying why. Three runs of dl-80's floor test and this one
    together (one per state), `npx vitest run --project downloader
tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t
"respects the empty floor and the deadline|wall clock stepped back"`
    (at 97a59990; 2 of 182 selected each run):
    - at head: `Tests  2 passed | 180 skipped (182)`, the new test at 4584 ms.
    - stopwatch back on `Date.now` (`datenow`): the new test fails,
      `AssertionError: expected -325 to be greater than or equal to 3000`;
      dl-80's floor test passes (10667 ms), as it did at the base.
    - the floor deleted in `waitForQuiet` (`nofloor`, production ignores
      `emptyMinWaitMs`): both fail, `expected 2865.43 to be greater than or
equal to 9000` (dl-80's) and `expected 2793.65 to be greater than or
equal to 3000` (the new test).
  - **Fixed at landing (gate 1, second med): the two sentences above.** The
    corrections are the two entries before this one, and the withdrawn
    sentences stand with their marks.
  - **The owner's two answers, 2026-10-11 (asked by the orchestrator through
    AskUserQuestion; the owner's, not an agent's).**
    1. The builder's open decision on production's wall clock. Question: what
       to do about `waitForQuiet`, the collector's `lastActivityAt` and the
       browser deadlines reading `Date.now()`, given gate 1 measured this
       container's wall clock stepping forward 58 to 71 ms every 30 s and none
       backward. Options: "Leave it (Recommended)", the builder's
       recommendation, the gate gave numbers only; "Floor start only, now";
       "File a ticket", to convert the browser tier to a monotonic clock.
       **Chosen: Leave it.** No production change, no ticket.
    2. Gate 1's two meds. Options: "Fix at landing (Recommended)" and "Leave
       recorded". **Chosen: Fix at landing**, applied with no re-gate; the
       record keeps each finding as the gate wrote it.
