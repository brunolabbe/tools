---
id: dl-106
tool: downloader
title: dl-98's parallel-ranges tests fail on the Windows leg, a different set on each run, and pass on Linux
kind: fix
status: done
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

## Review

**Gate: FAIL** — 2026-10-11 · `55214e67..ba4fb1ec` · Opus 5.5, depth full

| Done when                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The cause is named in the Log with a Windows run that shows it                                       | **verified** — read from `gh run view <id> --log`: run 38158575134 (`bba22382`) prints `sleep(4): mean=14.69 … p50=15.81`, `asked=4000000 … got=1430750`, and for A `judge-single rate=1121295` then `judge-split rate=1984081 single=1121295 floor=1.5`; run 38160856396 checks out the `bba22382` test file and prints `before 1/2/3: FAIL`, each on A (`expected 0 to be greater than 0`) and F9 (`expected 'parallel' to be 'single'`); run 38160489106 prints the bucket's `asked=40000000 … got=39500682` |
| The three tests pass in 10 consecutive runs of the file on `windows-latest`, or the Log says why not | **verified** — run 38168166619 (`8f282c87`) prints `final 1..10: PASS`, `final 11: FAIL`, `final 12..25: PASS`. `8f282c87..ba4fb1ec` also removes the env-gated `dbg` lines from `parallel-ranges.ts` and the test's `afterEach` print and F9 sampler (see the `low` below). `test (windows-latest, informational)` on `ba4fb1ec` (run 38172178386): `parallel-ranges.test.ts (38 tests)` ✓, `Tests 5069 passed \| 24 skipped (5093)`                                                                           |
| They still pass on Linux, and `npm run check` passes                                                 | **verified** — `npx vitest run tools/downloader/engine/test/parallel-ranges.test.ts` 38 of 38 in 4 of 4 runs at head. `npm run check` exit 0. `test (ubuntu-latest)` pass on `ba4fb1ec`                                                                                                                                                                                                                                                                                                                         |

- **high** · no `Done when` line depends on it · nfr:reliability · **`afterStop()` makes the three "opens no more" tests blind to the defect they exist to catch**, and in the engine test the blind span is about 3.1 s, not 100 ms. The three tests are `engine/test/parallel-ranges.test.ts` › "a cancel after the first byte closes every origin connection and opens no more", › "a cancel stops the relay and every ranged fetch, and nothing is fetched after it" and › "the size cap counts reassembled bytes, relayed and fetched, and stops every fetch". In the engine test, `settledAt` is taken after `await media.done`. At base, `canceledAt` was taken right after `abort()`. A probe line in that test reads `abort->done 2970..3016 ms, abort->settledAt 3071..3117 ms` (5 of 5 runs). So the Log's "`afterStop()` now waits 100 ms before the measuring point" is false for that test, and so are `afterStop`'s doc comment ("not from the instant the stop was asked for") and the test's comment "The window is longer than the 262 ms one fetch takes".
  - **Reproduction.** Premise: `RangeFeeder.close()` in `engine/src/download/parallel-ranges.ts` is mutated so that it opens one more origin request per open serve, N ms after the stop (`mutate.mjs open-at-stop` / `open-after-stop-<N>`; each run is the whole file unless filtered by `-t`):

    | planted                    | base test                           | head test                                         |
    | -------------------------- | ----------------------------------- | ------------------------------------------------- |
    | N = 0                      | 3 of 3 stop tests fail, 2 of 2 runs | 38 of 38 pass, 2 of 2 runs                        |
    | N = 50                     | —                                   | 38 of 38 pass                                     |
    | N = 150                    | 3 of 3 fail                         | the two feeder tests fail, the engine test passes |
    | N = 300                    | engine test fails                   | the two feeder tests fail, the engine test passes |
    | N = 2000, engine test only | fails, 2 of 2                       | passes, 2 of 2                                    |

    Base fails on the line `expected [ { range: 'bytes=1179648-', … } ] to deeply equal []`.

  - **The flake the change removed is real.** It must stay removed. With no mutation and only the three stop tests run (`-t`), the base test file fails the engine test 4 of 15 times on Linux under load, and the head file fails it 0 of 15 times. With `#begin` instrumented, the one late arrival in 24 runs is three fan-out fetches begun 10.7–12.1 ms _before_ the cancel (`lastBegins=[[1831.7,…],[1832.5,…],[1833.1,…]]`, `canceledAt=1843.8`, `beginsAfterCancel=[]`) that reached the origin 1.8–2.7 ms after it.
  - **Open decision: which remedy.** Both keep the flake fixed.
    - **(a) Recommended: count rather than time where the test can.** In the two feeder tests, take `feeder.stats().originRequests` at the stop. After the settle, assert that the origin saw exactly that many requests (`seen.length`) and that `originRequests` did not grow: no window at all, and every N above fails. In the engine test, which has no feeder handle, take the measuring point from the abort (`canceledAt + 100`, computed before `await media.done`), not from `done`. That cuts its blind span from about 3.1 s to 100 ms. Cost: one fixer round in the test file, plus a Windows reading of the stop tests from the PR's own leg.
    - **(b) Keep the 100 ms window, but start it at the abort in the engine test.** The comments and the Log then say that a fetch opened within 100 ms of a stop is not caught. The brief forbids loosening, so this is a loosening the owner must accept by name.
- **low** · no `Done when` line depends on it · nfr:maintainability · The Log describes `8f282c87`, the head of the 24-of-25 Windows series, as "the fixture and the test changes, plus the probe files". But `git diff 8f282c87 ba4fb1ec` also removes code from two files that stay on the branch:
  - `dbg()` and its three calls (`judge-split`, `judge-single`, `fallBack`) in `engine/src/download/parallel-ranges.ts`, which write to stderr while `DL106` is set, as it was in that workflow;
  - the test file's `afterEach` `seen` print and F9's 1 s `marks` sampler.

  By reading, none of these changes a decision. Still, the series did not run the file that lands, and the Log should say so. No probe file or workflow remains: `git diff --name-only 55214e67...ba4fb1ec` lists only the ticket and `parallel-ranges.test.ts`, and `git grep "DL106\|dl106" ba4fb1ec` outside `*.md` finds nothing.

- **dropped** · The held-bytes test's rate cut from 40 to 10 MB/s is not a tolerance change. Delivered rates measured on Linux by `pacing.mts`:
  - base asked 40 MB/s and got 14.9 MB/s; head asks 10 MB/s and gets 9.9 MB/s;
  - with a 15.6 ms timer tick modelled, base got 1.08 MB/s at any asked rate, and head gets 9.88 MB/s.

  The assertions are unchanged. `hold-unbounded` (`#occupied` counts only in-flight fetches) fails the held-bytes test at base and at head.

- **dropped** · The bucket in `send()` gives a speed judge no false speed-up. On Linux it delivers the asked rate within 1% from 500 KB/s to 10 MB/s on one connection.
  - Peak over the asked rate, steady state with a 15.6 ms tick modelled: ≤ 1.33x in any 50 ms window, ≤ 1.09x in any 200 ms window. Base reads 1.31x / 1.15x at 500 KB/s.
  - Shared 2 MB/s throttle: 2.03 MB/s on one connection, 2.06–2.09 MB/s total on four. That is a 1.03x speed-up against the 1.5 floor.
  - After a 300 ms reader pause, the burst is 7x per 50 ms at both base and head. That is socket buffering, not the credit.
- **dropped** · The builder's note that `close()` made a no-op does not fail the engine cancel test is true at base too, so `afterStop()` did not cause it. `close-noop` fails the same two feeder tests at base and at head, 1 of 1 run each, and not the engine test. ffmpeg's exit closes the serves. That predates this branch.
- **dropped** · A raised speed-up floor (`floor-3.6`, 3.6x) passes all 38 tests at head. That is not a regression any of the three tests claims to catch: the per-connection fixture measures at least 3.6x at four connections.
- **positive control** · The base test file passes on Linux, 38 of 38 in 3 of 3 whole-file runs. The head fails on each regression it should catch, in both trees:
  - `no-fallback`: A fails at base and head;
  - `floor-0.9`: A fails at base and head;
  - `hold-unbounded`: held-bytes and F2 fail at base and head;
  - `no-release-on-drop` (gate 2's F9 undone): F9 fails at base and head, 2 of 2 each;
  - `close-noop`: the two feeder stop tests fail at base and head.
- **findings** · the hunt returned 6; 2 carried, 4 dropped.
- Invariants: the diff is one test file and the ticket, so only style applies (no `any`, no `console`, `node:` builtins) ✓. The rest are skipped as out of the diff's reach.
- NFR: security n/a · performance n/a (three tests 100 ms longer) · reliability — the high above · maintainability — the low above.

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
- 2026-10-11, gate 1 failed `ba4fb1ec` on one high, and the owner chose the
  remedy; this entry supersedes the `afterStop()` fix above.
  - **The gate's finding (high).** `afterStop()` took its measuring point after
    `await media.done`. In the engine test that is about 3.1 s after the abort
    (`abort->done 2970..3016 ms, abort->settledAt 3071..3117 ms`, 5 of 5 runs),
    so the three "opens no more" tests could not see a request opened in that
    span: a planted `close()` that opens one more request 150 ms or 300 ms after
    the stop failed the base tests and passed the engine test at `ba4fb1ec`. The
    flake `afterStop()` removed is real (base, three stop tests only, 4 of 15
    on Linux under load; the late arrival in the gate's instrumented run was
    three fetches begun 10.7 to 12.1 ms before the cancel, which reached the
    origin 1.8 to 2.7 ms after it) and stays removed.
  - **Owner's answers, 2026-10-11** (asked by the orchestrator through
    AskUserQuestion; both are the owner's choices, not an agent's):
    1. "Gate it now (Recommended)" over "Another 25-run series" and "Tolerate
       stalls", for the 1-in-25 Windows residual at `8f282c87`. Chosen: **Gate it
       now.**
    2. For the gate's remedy, "Count, not time (Recommended)" (the gate's (a):
       count requests where the test can, and time only from the abort in the
       engine test; its builder resumed with a fresh Windows series on the exact
       file that lands, then gate 2) over "Keep a 100 ms window" (the gate's (b)).
       Chosen: **Count, not time.**
  - **What changed in `parallel-ranges.test.ts`.** `afterStop()` is gone.
    - The feeder cancel test ("a cancel stops the relay and every ranged fetch,
      and nothing is fetched after it") reads `feeder.stats().originRequests`
      right after `abort()` and, after 300 ms, asserts it did not grow and that
      the origin saw no more than that many requests (`seen.length`).
    - The size-cap test does the same with the stats it already took after the
      read, **and** keeps a time check, from 100 ms after the stop. The count
      cannot do it alone there: the feeder begins 5 requests and the origin
      sees 4 (`DBG originRequests=5 seen=4`, 5 of 5 runs), one being aborted
      before it connects, so one planted extra hides in that slack. This is the
      one place the count was not enough on its own; it is not an open decision
      because the time check is the gate's own (b) for a test that has no better.
    - The engine test has no feeder handle. Its measuring point is `abort()`
      plus 100 ms, **taken before `await media.done`**, so the blind span is 100
      ms and not 3.1 s. Its comment now says that.
  - **The gate's mutations, at head `539911a4`, on Linux** (the gate's
    `open-at-stop` and `open-after-stop-N`, re-planted from the same text by a
    local script, the three stop tests, `-t`; 2 runs each, 15 for no mutation):

    | planted                | cancel after first byte (engine) | feeder cancel | size cap |
    | ---------------------- | -------------------------------- | ------------- | -------- |
    | none, 15 runs          | pass                             | pass          | pass     |
    | N = 0 (`open-at-stop`) | pass                             | **fail**      | pass     |
    | N = 50                 | pass                             | **fail**      | pass     |
    | N = 150                | **fail**                         | **fail**      | **fail** |
    | N = 300                | **fail**                         | **fail**      | **fail** |
    | N = 2000               | **fail**                         | pass          | pass     |

    Every planted request fails at least one test, as the gate asked; the engine
    test and the size-cap time check cannot see N of 0 and 50, which is the 100 ms
    that distinguishes them from the 3 ms legitimate late arrival. The 4-of-15
    base flake: 0 of 15 on the three stop tests unmutated.

  - **The series on the file that lands**, `windows-latest`, run 38178371109,
    head `60001f1d` (the test file's blob is `fd4af9bb`, the engine tree is
    `fb219f77`, as printed in the run): `PASS` in runs 1 to 13 and 15 to 25,
    `FAIL` in run 14, 24 of 25. The failure is the held-bytes test,
    `AssertionError: expected 'fallen-back' to be 'parallel'`; this series printed
    no judge lines, so it has no log to say whether a runner stall explains it
    (the earlier one did). It is the same class of residual as the 1 in 25 at
    `8f282c87` (a 50 ms judging window, three timer ticks), in a different test;
    left as it is, because the owner chose to gate. A `measureMs` of 100 with the
    same 10 MB/s would halve that noise and still leave the 2 MB before the
    reader pauses at twice the window, but it changes a test setting and needs
    another series.
  - The series' head was the final head plus the probe workflow, which is deleted
    in the final commit. `git diff 60001f1d <final head> -- tools/downloader/engine`
    prints nothing.
- 2026-10-11, gate 2's high applied, and the owner's answer on the held-bytes
  residual recorded.
  - **Owner's answer, 2026-10-11** (asked by the orchestrator through
    AskUserQuestion; the owner's choice, not an agent's), on the builder's open
    decision about the held-bytes test's 1 in 25 Windows residual (`expected
'fallen-back' to be 'parallel'`, above). Options: "Leave it at 50
    (Recommended)" (the builder's recommendation; gate 2 gave none), "Raise
    measureMs to 100" and "speedupFloor: 0". Chosen: **Leave it at 50.** Gate 2's
    measured numbers for it, under a 15.6 ms tick model of the judge's window:
    the split-to-single rate ratio has median 3.16 and minimum 2.89 at
    `measureMs` 50, and 3.50 and 3.41 at 100, against a floor of 1.5. The residual
    stays attributed to runner stalls, as above, and is not proved.
  - **Gate 2's finding (high): the two feeder stop tests took the count after
    the stop.** The feeder cancel test read `originRequests` after `abort()`,
    which runs `RangeFeeder.close()` synchronously, and the size-cap test read it
    from `feeder.stats()` after `readLoopback` resolved, after `#fatal` had closed
    the feeder; a request that `close()` itself began through `#begin` was in the
    count it was compared against. Gate 2's mutation `begin-at-stop-sync` passed
    all three stop tests at `4563c082`. Fixed in `parallel-ranges.test.ts`, and
    only there: the cancel test reads `requestsAtStop` on the line before
    `controller.abort()`, and the size-cap test passes `feederFor` an `onFatal`
    that records `feeder.stats().originRequests` (`#fatal` calls `onFatal` before
    `close()`) and then pushes the error, and hands that number to
    `expectNothingOpenedSince`. The helper's comment now says where the count
    must be read. The size cap's time check stays.
  - **Measured on Linux after the change.** `begin-at-stop-sync` planted in a
    scratch copy of the tree, the two feeder tests, `-t`: the cancel test fails
    `expected 5 to be 4` and the size cap `expected 6 to be 5`, 2 of 2 runs. The
    whole file is 38 of 38 on one run, and 37 of 38 on another in which the
    untouched F9 test failed (`expected 'parallel' to be 'single'`); F9 alone,
    8 of 8 passes. The one F9 failure is unexplained and not chased: no Windows
    series was run on this change, which is a test-file edit in two tests, so the
    24-of-25 series above is of the file before it.
