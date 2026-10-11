---
id: dl-106
tool: downloader
title: dl-98's parallel-ranges tests fail on the Windows leg, a different set on each run, and pass on Linux
kind: fix
status: ready
milestone: null
depends_on: [dl-98]
difficulty: standard
---

# dl-106 — dl-98's parallel-ranges tests fail on Windows, a different set each run, and pass on Linux

## Why

dl-98 (pull request #421) was green on every required check and red on the
informational leg, `test (windows-latest, informational)`, in all three Windows
runs it has had. The only failing file in each is
`engine/test/parallel-ranges.test.ts` (`Test Files 1 failed | 255 passed | 1
skipped (257)`), and the set of tests that fails in it is different every time.
The three runs, read from the job logs:

1. **Run 38141287195, attempt 1** (job 114475545565, head `6f85fb48`): one
   failure, `Tests 1 failed | 5068 passed | 24 skipped (5093)`.

   ```
   FAIL  downloader tools/downloader/engine/test/parallel-ranges.test.ts > dl-98: a host that refuses parallel ranges > 'no speed-up at 4 (a per-client thrott…': the job completes on one connection, identical in media, and the next job opens one
   AssertionError: expected 0 to be greater than 0
    ❯ tools/downloader/engine/test/parallel-ranges.test.ts:568:28
   ```

   The test took 2323 ms. Line 568 is `expect(after.length).toBeGreaterThan(0)`:
   the origin saw no request after the last fan-out request, so the job never
   continued on one open-ended request. Gate 3 records that the same test
   passed on the Windows run of `3b6a832d`, in 7809 ms.

2. **Run 38141287195, attempt 2** (job 114495526538, head `6f85fb48`, the
   re-run the owner chose on 2026-10-11): `Tests 2 failed | 5067 passed | 24
skipped (5093)`. The first is the same test, the same assertion, at
   `parallel-ranges.test.ts:568:28`, 2352 ms. The second passed in attempt 1:

   ```
   FAIL  downloader tools/downloader/engine/test/parallel-ranges.test.ts > dl-98 round 2: a request that goes away is no longer measured > F9: a request ffmpeg closed while it was reading does not count a later pause as the origin's time
   AssertionError: {"mode":"parallel","maxHeldBytes":2490368,"deliveredBytes":8814592,"originRequests":5,"maxConcurrentFetches":4,"refusal":null}: expected 'parallel' to be 'single' // Object.is equality
    ❯ tools/downloader/engine/test/parallel-ranges.test.ts:1352:49
   ```

   That test took 12537 ms (12522 ms when it passed in attempt 1): the feeder
   split a source whose test meant it to stay on one connection.

3. **Run 38149758806** (job 114500599619, head `96a3a055`, dl-98's landing
   head, after the second round and gate 3): `Tests 3 failed | 5066 passed | 24
skipped (5093)`. The first and third are the two above, at the same lines
   (`:568:28`, 2297 ms; `:1352:49`, 12539 ms, with `"maxHeldBytes":2736128,
"deliveredBytes":12042240,"originRequests":5,"maxConcurrentFetches":4`). The
   second is new, and fails in the opposite direction to F9:

   ```
   FAIL  downloader tools/downloader/engine/test/parallel-ranges.test.ts > dl-98: the feeder's own limits > bytes held ahead never exceed 4 x 4 MB, measured at the defaults with ffmpeg not reading
   AssertionError: expected 'fallen-back' to be 'parallel' // Object.is equality
    ❯ tools/downloader/engine/test/parallel-ranges.test.ts:787:26
   ```

   It took 18004 ms; it passed in 4936 ms in attempt 1 and 4716 ms in attempt 2
   of run 38141287195. Line 787 is `expect(stats.mode).toBe("parallel")`: the
   feeder gave up on parallel ranges for a source the test arranged to be fast
   enough to keep them.

The failing set, run by run: {A}, {A, F9}, {A, held bytes, F9}, where A is the
"no speed-up at 4" test. A failed in 3 of 3 runs, F9 in 2 of 3, the held-bytes
test in 1 of 3. All of them pass on Linux: gate 3 ran A 10 of 10 under 14 busy
loops on dl-98's head, and 10 of 10 on the head before the round.

The cause is **unmeasured**. The failing tests are all dl-98's own, from the
original build and from its second round, and nothing yet says whether the
feeder, the speed judge or the tests' timing assumptions are what Windows
disagrees with. What the three runs do show is that the wrong decision goes both
ways: A and the held-bytes test see a fallback (or no continuation) where a
parallel run was expected, and F9 sees a parallel run where one connection was
expected. All of that reads as the same judge deciding differently under
Windows' timing, which is a hypothesis and not a finding. F9's 12.5 s duration
is the same whether it passes or fails, so it is not a timeout.

dl-98 landed with these red on the informational leg by the owner's choice,
which is why this is a ticket and not a retry.

## Build

Reproduce first, on Windows, which is the only place any of them fails. Run the
whole `engine/test/parallel-ranges.test.ts` file (and not each test alone, since
F9 passed in attempt 1 and failed in attempt 2 of the same run, and the
held-bytes test passed in both attempts and failed in the next run) several
times on the `windows-latest` leg, with the feeder's `stats()` and the `seen`
list (range, `at`) printed on a failure. For A, print every entry of `seen` with
its `at` and range, so the order of the last fan-out request and the
continuation is visible. For F9 and the held-bytes test, print the meter's rate
and the judge's window at the decision.

Then fix the cause, which may be one cause or several. Do not widen the
`toBeGreaterThan(0)` or either `toBe(...)` to make the leg green: each is the
test's claim, and a fallback that does not continue, a fast origin that is
refused four connections, or a throttled one that gets them is the behaviour
dl-98 exists to get right.

## Done when

- The cause is named in the Log with a Windows run that shows it (a log line, or
  a change that fails before the fix and passes after on that leg).
- The three tests above pass in 10 consecutive runs of the
  `parallel-ranges.test.ts` file on `windows-latest`, or the Log says why that is
  not the bar.
- They still pass on Linux, and `npm run check` passes.

## Log

- 2026-10-11, filed in dl-98's pull request (#421). The owner was asked "How
  should dl-98 land?" with the options "Rerun the Windows job once, then land"
  (recommended), "Land now, record it" and "Another builder round on that test",
  and chose the first: rerun once, and if it failed again, land dl-98 and file
  this ticket with both Windows runs as the reproduction. It failed again. The
  numbers for run 38141287195 are read from `gh run view 38141287195 --attempt 1
--job 114475545565 --log` and `gh run view 38141287195 --job 114495526538
--log` (the latest attempt); each prints the lines quoted. The cause was not
  chased.
- 2026-10-11, widened from two tests to the whole class. dl-98's landing head
  `96a3a055` failed three tests on the informational Windows leg (run
  38149758806, job 114500599619, read from `gh run view 38149758806 --job
114500599619 --log`), one of them new. The owner was asked "dl-98's landing
  head failed three tests on the informational Windows leg … What now?" with the
  options "Merge #421; widen dl-106 to the whole class" (recommended), "Hold #421
  unmerged until dl-106 is built" and "Merge #421 as it is", and chose the first.
  The ticket's title, Why and Done-when now cover every parallel-ranges failure
  seen on that leg, not the two of the first run.
- `difficulty: standard`: the cause is unknown and finding it needs judgement
  about whether the feeder, the speed judge or the tests' timing is wrong, so it
  is not `mechanical`; but nothing in it reaches a contract or a decision about
  what dl-98 should do, so it is not `hard`. It can only be reproduced on the
  Windows leg, which makes it slow rather than hard. Widening to three tests
  does not change that reason, so the field stays.
- 2026-10-11, built (pull request #424, branch `dl-106-parallel-ranges-windows`).
  **The cause is the test fixture, not the feeder or the judge**, and the
  production code is unchanged. Everything below ran on `windows-latest` in a
  branch-only probe workflow (since deleted: a workflow that runs one spec file N
  times, which is the only affordable way to run it ten times there) and is
  read from `gh run view <id> --log`.
  - **A Windows timer fires on a ~15.6 ms tick.** Run 38158575134 (head
    `bba22382`), the timer probe: `sleep(0): mean=11.41 p50=15.51`, `sleep(4):
mean=14.69 p50=15.81 min=4.04`, `sleep(16): mean=26.94 p50=29.67`. Linux, the
    same probe: `sleep(4): mean=4.11`.
  - **So `send()`, which sleeps once per 16 KiB slice, cannot go faster than
    about 1.4 MB/s there, whatever rate it is asked for.** The same run, the
    fixture's own loop against a plain client: `asked=2000000 got=1299831`,
    `asked=4000000 got=1430750`, `asked=40000000 got=1384852 in 43326 ms`, and
    four connections at `asked=2000000` each got `1374354,1374636,...` ; on Linux
    `asked=2000000 got=1979516`, `asked=4000000 got=3977061`.
  - **That one fact explains the three reported failures.** A ("no speed-up at
    4"): the shared 2 MB/s throttle read 1.12 MB/s on one connection and 1.98 on
    four, a 1.77x speed-up over the 1.5 floor, so the feeder correctly kept the
    split and never fell back (`judge-single rate=1121295`, `judge-split
rate=1984081 single=1121295`, run 38158575134; the test's `after` list was
    empty). F9: a "4 MB/s" origin against 3 MB/s of media is a fixture that
    delivers 1.4 MB/s (the probe line above), which is slow, so the feeder
    correctly split. The held-bytes test failed for a related reason, in the
    bullet on the two further defects below.
  - **Before the fix, in isolation, A and F9 fail every time.** Run 38160856396
    (test file at `bba22382`): `before 1: FAIL`, `before 2: FAIL`, `before 3:
FAIL`, each with `AssertionError: expected 0 to be greater than 0` (A) and
    `... expected 'parallel' to be 'single'` (F9). The ten runs of 38158575134
    failed 10 of 10 (the failing names were lost to a grep bug in the probe).
    Run alone, the file fails the same two tests each time; in CI's full suite
    the set varies, which fits other work on the machine changing the timer
    resolution while a test runs. That last part is a hypothesis: nothing
    here measured the resolution during a full-suite run.
  - **The fix is in the fixture: `send()` is a bucket, not a timer per slice.** A
    late wake-up writes every slice that fell due while it slept; what a stall
    can bank is capped at `MAX_CREDIT_MS` (25 ms), so a reader that paused is not
    answered with a burst. Run 38160489106 (head `aa21e562`): the same probe
    with the bucket delivers `asked=2000000 got=1977212`, `asked=4000000
got=3956421`, `asked=40000000 got=39500682`, four connections at 4 MB/s each
    `3954745,...`. A, F9 and the held-bytes test were the tests this was found
    for; no production line moved.
  - **Two more defects of the same fixture surfaced once it was fast, and are
    fixed in the same pull request.** (1) The held-bytes test asked its origin
    for 40 MB/s, which the old fixture never delivered (13 MB/s on Linux, 1.4 on
    Windows). Delivered in full, the 2 MB the reader takes before it pauses goes
    by inside the 50 ms measuring window, so the split waited for the pause to
    end (`AssertionError: expected 65536 to be greater than or equal to
12582912`, run 38163890319) or fell back because a copy-bound single
    connection is not 1.5x slower than four (`expected 'fallen-back' to be
'parallel'`, same run). It now asks for 10 MB/s, a throttle this process can
    outrun. (2) "a cancel after the first byte ... opens no more" measured
    requests from the instant of `abort()`, and a fetch the feeder had already
    written to its socket reaches the origin a few ms later: `AssertionError:
expected [ { …(7) }, ... ] to deeply equal []` on Windows (run
    38160856396, 1 of 10) and, with a late request 3 ms after the abort, on Linux
    on both fixtures (old pacing 1 of 30, bucket 1 of 20 before the fix; on
    Windows that test alone was 0 of 25 on each, run 38162765663; the
    old-pacing log reads `"range": "bytes=1572864-1703935"`). The
    first fix for it, `afterStop()` (head `ba4fb1ec`), is **superseded by the
    entry at the end of this Log**: it took the measuring point after `await
media.done`, which in the engine test is about 3.1 s after the abort, not 100
    ms, so it left that test and the others blind to a request opened in that
    span, and gate 1 failed it. The Log sentence that said it "waits 100 ms
    before the measuring point" was true of the two feeder tests only.
  - **After the fix**, same file, `windows-latest`: head `8f282c87` (the
    fixture and the test changes, **plus the probe code that stayed in two
    files**: a `dbg()` writing to stderr while `DL106` was set, in the feeder
    source; and, in the test file, an `afterEach` print of `seen` and a 1 s
    sampler in F9. None of it changes a decision, by reading, but that series
    did not run the file that landed at `ba4fb1ec`, and neither run the file
    that lands now; the series after the last entry does): `PASS` in runs 1 to 10
    and 12 to 25, `FAIL` in run 11, 24 of 25 (run 38168166619). Run 11 failed
    two tests that share a runner stall visible in the same log: the proxy test
    (`expected 3 to be greater than 4`, a fallback `no-speedup 1635457 B/s split
against 1906097 B/s on one`) and F9 (`parallel` for `single`), with
    `judge-single rate=305588 activeMs=536` a few seconds earlier and the F9 byte
    counts per second `5062656,5963776,7208960` where every other run has
    `...,5095424,9142272,13189120`. An earlier head (`353a7a53`, run 38166078975) was 13 of 15 on the same file for the same kind of reason (F9's
    `expected 5406720 to be greater than 10000000`, and the proxy test's `expected 0 to
be greater than 4`, the second not explained: its log was not kept). On Linux
    the same file is 38 of 38 (`npx vitest run
tools/downloader/engine/test/parallel-ranges.test.ts`), the cancel/size-cap
    tests 40 of 40 and the held-bytes test 40 of 40 after the change.
  - **What I could not show.** Why the full suite changes the timer
    resolution is a hypothesis. The 1-in-25 residual on Windows is attributed to
    runner stalls from the log's own numbers, not proved; the one failure of the
    proxy test in run 38166078975 has no log. The Done-when's "10 consecutive
    runs" is met (runs 1 to 10 and 12 to 25 of 38168166619) but is a weaker bar
    than "no failure in 25".
  - **What the brief had wrong.** "The cause is unmeasured ... the feeder, the
    speed judge or the tests' timing assumptions": it was the last, and the
    fixture's pacing in particular. "Reproduce first ... printing `stats()`
    and `seen`" was not needed once a timer probe ran; the print of the judge's
    rates was what showed A's 1.77x. The brief also expected one cause or
    several: it is one in the fixture and two it exposed.
  - Fold-in decision: the 3 tests' shared "opens no more" pattern is fixed in all
    three places it occurs (see the last entry for how); nothing else was folded
    or left.
