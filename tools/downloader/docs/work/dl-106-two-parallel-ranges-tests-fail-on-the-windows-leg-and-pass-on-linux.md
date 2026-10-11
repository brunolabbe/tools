---
id: dl-106
tool: downloader
title: Two parallel-ranges tests fail on the Windows leg of dl-98's head and pass on Linux
kind: fix
status: ready
milestone: null
depends_on: [dl-98]
difficulty: standard
---

# dl-106 — Two parallel-ranges tests fail on Windows and pass on Linux

## Why

dl-98's head `6f85fb48` (pull request #421) was green on every required check
and red on the informational leg, `test (windows-latest, informational)`, in
both of its attempts. Run 38141287195, `engine/test/parallel-ranges.test.ts`
being the only failing file in each (`Test Files 1 failed | 255 passed | 1
skipped (257)`):

1. **Attempt 1** (job 114475545565): one failure, 5068 tests passed.

   ```
   FAIL  downloader tools/downloader/engine/test/parallel-ranges.test.ts > dl-98: a host that refuses parallel ranges > 'no speed-up at 4 (a per-client thrott…': the job completes on one connection, identical in media, and the next job opens one
   AssertionError: expected 0 to be greater than 0
    ❯ tools/downloader/engine/test/parallel-ranges.test.ts:568:28
   ```

   The test took 2323 ms. Line 568 is `expect(after.length).toBeGreaterThan(0)`:
   the origin saw no request after the last fan-out request, so the job never
   continued on one open-ended request. Gate 3 records that the same test
   passed on the Windows run of `3b6a832d`, in 7809 ms.

2. **Attempt 2** (job 114495526538, the re-run the owner chose on 2026-10-11),
   two failures, 5067 tests passed. The first is the same test, the same
   assertion, 2352 ms. The second passed in attempt 1:

   ```
   FAIL  downloader tools/downloader/engine/test/parallel-ranges.test.ts > dl-98 round 2: a request that goes away is no longer measured > F9: a request ffmpeg closed while it was reading does not count a later pause as the origin's time
   AssertionError: {"mode":"parallel","maxHeldBytes":2490368,"deliveredBytes":8814592,"originRequests":5,"maxConcurrentFetches":4,"refusal":null}: expected 'parallel' to be 'single' // Object.is equality
    ❯ tools/downloader/engine/test/parallel-ranges.test.ts:1352:49
   ```

   That test took 12537 ms (12522 ms when it passed in attempt 1): the feeder
   split a source whose test meant it to stay on one connection.

Both pass on Linux. Gate 3 ran the first test 10 of 10 under 14 busy loops on
dl-98's head and 10 of 10 on the head before the round. The cause is
**unmeasured**: the two failing tests are dl-98's own, one from the original
build and one added in its second round, and nothing yet says whether the
feeder, the judge or the test's timing assumption is what Windows disagrees
with. The first failure is a fallback path that did not run; the second is the
speed judge reading a slow origin where the test arranged a fast one. Both read
as the same judge deciding differently under Windows' timing, which is a
hypothesis and not a finding.

dl-98 landed with these two red on the informational leg by the owner's
choice, which is why this is a ticket and not a retry.

## Build

Reproduce first, on Windows, which is the only place either fails. Run the
whole `engine/test/parallel-ranges.test.ts` file (and not each test alone, since
the F9 test passed in attempt 1 and failed in attempt 2 of the same run) several
times on the `windows-latest` leg, with the feeder's `stats()` and the
`seen` list (range, `at`) printed on a failure. For the first test, print every
entry of `seen` with its `at` and range, so the order of the last fan-out request
and the continuation is visible. For the second, print the meter's rate and the
judge's window at the split.

Then fix the cause. Do not widen the `toBeGreaterThan(0)` or the
`toBe("single")` to make the leg green: each is the test's claim, and a
fallback that does not continue, or a fast origin that gets four connections, is
the behaviour dl-98 exists to get right.

## Done when

- The cause is named in the Log with a Windows run that shows it (a log line, or
  a change that fails before the fix and passes after on that leg).
- Both tests pass in 10 consecutive runs of the `parallel-ranges.test.ts` file
  on `windows-latest`, or the Log says why that is not the bar.
- Both still pass on Linux, and `npm run check` passes.

## Log

- 2026-10-11, filed in dl-98's pull request (#421). The owner was asked "How
  should dl-98 land?" with the options "Rerun the Windows job once, then land"
  (recommended), "Land now, record it" and "Another builder round on that test",
  and chose the first: rerun once, and if it failed again, land dl-98 and file
  this ticket with both Windows runs as the reproduction. It failed again. The
  numbers above are read from `gh run view 38141287195 --attempt 1 --job
114475545565 --log` and `gh run view 38141287195 --job 114495526538 --log`
  (the latest attempt); each prints the lines quoted. The cause was not chased.
- `difficulty: standard`: the cause is unknown and finding it needs judgement
  about whether the feeder, the speed judge or the tests' timing is wrong, so it
  is not `mechanical`; but nothing in it reaches a contract or a decision about
  what dl-98 should do, so it is not `hard`. It can only be reproduced on the
  Windows leg, which makes it slow rather than hard.
