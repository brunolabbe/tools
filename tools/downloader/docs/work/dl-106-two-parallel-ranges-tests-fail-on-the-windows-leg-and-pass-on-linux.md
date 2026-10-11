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
