---
id: dl-120
tool: downloader
title: The F9 paused-request tests split under CPU load, because the loopback's fill outlasts the 2 s window
kind: fix
status: done
milestone: null
depends_on: [dl-106]
difficulty: standard
---

# dl-120 — The F9 paused-request tests split under CPU load

## Why

`engine/test/parallel-ranges.test.ts` › "F9: a paused request ffmpeg closed does
not keep the meter paused for the next one" fails now and then with `expected
'parallel' to be 'single'`. The failing line is the first check in
`pausedThenRead`: the job must still be on one connection 4 s after reader A
stopped. The evidence, with where it came from:

1. **dl-118's builder (2026-10-12).** It failed once in a full `npm test --
--project downloader` run under load, at dl-118's head, which touched no
   engine code. It passed alone (`npx vitest run
tools/downloader/engine/test/parallel-ranges.test.ts -t "F9: a paused
request"`) and in the first full run.
2. **dl-108's gate (session tools-38), relayed and not re-run here.** Run alone
   10 times on each side, it failed 1 of 10 on `origin/main` 0484ae71 (run 6,
   `expected 'parallel' to be 'single'`) and 0 of 10 on dl-108's head 5670642d.
3. **History.** dl-106's Log records a Linux F9 failure that it never explained.
   That one was the sibling test "a request ffmpeg closed while it was reading
   does not count a later pause as the origin's time", and this ticket does not
   explain it either (see the Log).

Filed and built on the owner's 2026-10-12 answer. The options were "file only
(orchestrator's recommendation)", "file and build now" and "don't file", and the
owner chose **file and build now**.

## Build

1. Reproduce with deliberate contention, not whatever the machine happens to be
   running. Pin the run and K busy loops to one core:
   `taskset -c 11 node -e "for(;;){}"` K times, then `taskset -c 11 npx vitest run
tools/downloader/engine/test/parallel-ranges.test.ts -t "F9: a paused
request"`.
2. Find out whether the meter or the test is wrong. If the meter is, stop: that
   is a design choice in `parallel-ranges.ts`, and it needs the owner's answer.
3. If the test is wrong, fix its timing assumption. A wider tolerance is
   acceptable only with a measurement that shows the tolerance was what was
   wrong.

## Done when

1. The cause is named in the Log with a measurement that shows it: the bytes
   the loopback absorbed, and the meter's active time when the feeder paused.
2. Both `pausedThenRead` tests (`-t "F9: a paused request"`) pass in 20 of 20
   runs at the branch head with 11 busy loops on the test's core. At the base, under the same
   load, they failed in 5 of 20 runs. The Log records both series.
3. "F9: a paused request ffmpeg closed …" passes 10 of 10 runs alone at the
   branch head.
4. The tests still catch the defect gate 2's F9 found: with the one-flag meter
   planted (`release()` leaves a request paused, and one paused request pauses
   the meter), both tests fail at the head as they do at the base.
5. No production line changes: `git diff origin/main -- tools/downloader/engine/src`
   prints nothing.

## Review

**Gate: CONCERNS** — 2026-10-12 · `84c899e4..fa0a03cf` · Sonnet 5.5, depth standard

| Done when                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The cause is named in the Log with a measurement                                     | **verified**. Reproduced with trace lines planted in `Meter.record`, `#pump`, `#judge` and `#split` (since removed). At the base under 11 busy loops the feeder's held pause came at `active=1898..1996 ms`, `bytes=7.62..7.98 MB` (39 held pauses); the one failing run had no held pause and `SPLIT rate=3797040 bitrate=10000000 active=2007 bytes=7618763`. See finding 1 for what moves the number.              |
| 2. Both tests pass 20 of 20 at the head with 11 busy loops; the Log records both series | **verified** for the head: 20 of 20 (`Tests  2 passed \| 41 skipped (43)` each). The base half is the builder's record of 5 of 20; I measured 1 of 20 under the same 11 loops (load average 9 to 14, the loops counted), the same signature, and 15 of 15 at 23 loops. Not a failure of the line: the base rate depends on load.                                                                                      |
| 3. "F9: a paused request ffmpeg closed …" passes 10 of 10 alone at the head             | **verified**, 10 of 10 (`-t "F9: a paused request ffmpeg closed"`, pinned to core 5, load average 4.4 to 8.8).                                                                                                                                                                                                                                                                                                        |
| 4. With the one-flag meter planted, both tests fail at the head                         | **verified**. `parallel-ranges.test.ts` › both "F9: a paused request …" tests: planted `release()` that deletes nothing **and** `allPaused = this.#paused.size > 0` → 2 of 2 fail at the head (`expected null not to be null`) and 4 of 4 across the base and head files. Each half alone: release-only fails 0 of 4; paused-only fails "left open" in both files and "closed" passes in both. Same at base and head. |
| 5. No production line changes                                                           | **verified**. `git diff 84c899e4...HEAD -- tools/downloader/engine/src` prints nothing; `git diff HEAD origin/main -- tools/downloader/engine/src` (origin/main e46ec2eb) prints nothing. The diff is three files: the helper, the ticket, one dl-114 bullet. dl-108's tests at the end of the file are untouched.                                                                                                    |

CI on this head: `test (ubuntu-latest)` and `test (windows-latest, informational)` both passed on `fa0a03cf`, as did `check`, `CodeQL`, `docker` and both e2e legs. The Windows leg is one run of an informational check; Windows buffer autotuning is unmeasured.

- **med** · no `Done when` line depends on it · **open decision: the fix cuts the failure but does not remove it, and its stated headroom is the median.** The Log says the fill takes "about 0.9 s clear of the window"; the shipped comment says it "takes about 1 s". The fill is 7.5 to 9.2 MB at 8 MB/s (6.3 to 10.4 MB across every series here), bounded by the kernel (this machine: `tcp_wmem` max 4 MiB, `tcp_rmem` max 6 MiB). So what decides a run is how fast the fixture's 8 MB/s is delivered in a starved process. Measured, `-t "F9: a paused request"`, the run and the busy loops pinned with `taskset -c 11`:

  | series (2 tests per run)                     | runs failed | held-pause active time (the fill's cost)       | load average, loops included |
  | -------------------------------------------- | ----------- | ---------------------------------------------- | ---------------------------- |
  | base, 11 loops                               | 1 of 20     | 1898 to 1996 ms of 2000                        | 9 to 14                      |
  | **head, 11 loops**                           | 0 of 20     | 917 to 1870 ms, median 990, 4 of 40 over 1.4 s | 13 to 22                     |
  | base, 23 loops                               | 15 of 15    | none held in 30 of 30                          | 24 to 32                     |
  | **head, 23 loops**                           | 4 of 15     | 1191 to 1873 ms; 6 of 30 tests held none       | 16 to 37                     |
  | A unthrottled, B at 4 MB/s (below), 23 loops | 0 of 15     | 254 to 1182 ms                                 | 24 to 31                     |

  A failing head run shows the mechanism: `SPLIT rate=2545751 bitrate=20000000 active=2002 bytes=5095627` with no pause held, after 26 `JUMP … sinceLast=…` stalls of 110 to 458 ms. The fixture delivered 1.5 to 3 MB/s of its 8, and the meter, which was right about that, split. The cause the Log names is correct; doubling the rate buys a 1.7x margin on the delivered rate (the worst fill, 9.2 MB, needs 4.6 MB/s sustained), not independence from it. The thinnest margin at the Done-when load was 130 ms.

  - Option A, **accept**: Done when 2 is met; the residual failure shows at twice the acceptance load. No further work.
  - Option B, **pin the fill instead of the rate (recommended)**: Node has no API for a TCP socket's buffers (`socket._handle` exposes `open, bind, listen, connect, bind6, connect6, getsockname, getpeername, setNoDelay, setKeepAlive, reset`; only `dgram` has `setRecvBufferSize`), so the kernel's fill cannot be pinned. The fixture reads `behaviour.perConnectionBps` once per request, though, so in `pausedThenRead` set it to `null` before A's request (the loopback then fills in 0.25 to 1.2 s of window even at a 1/24 share of a core) and to `4_000_000` before B's, with the media rate at `size / 20_000_000`. Measured 15 of 15 at 23 loops, and the same planted one-flag meter fails both tests (2 of 2). Cost: one more builder round on a few lines and the comment; the 4 s wait and the bounds stay.

- **low** · `nfr:maintainability` · The comment above `pausedThenRead` ("took 5.2 to 7.8 MB", "(7.5 to 9.2 MB) take about 1 s", "5 of 20 runs") reads as more headroom than there is: held fills measured 6.3 to 10.4 MB and 0.92 to 1.87 s at the head, and the base rate was 1 of 20 here. If option A is taken, reword it to "about 1 s, up to 1.9 s with 11 busy loops on the core, and the test still fails when the process is starved further".
- **low** · `nfr:maintainability` · dl-114's new Build bullet says to keep "the origin's rate × `measureMs` well above about 10 MB". At 23 loops 16 MB nominal (8 MB/s × 2 s) failed 4 of 15, because the delivered rate fell to a third of nominal. It should say delivered, and name the unthrottled reader as the way out if option B is taken. Its "5.2 to 9.2 MB" is not an upper bound either (10.4 MB with an unthrottled origin).
- **low** · open decision, outside dl-120 (its Done when 5 forbids a production change) · no live call site shown · **the meter charges the gap between a released request and the next request's first byte as origin time.** `Meter.record` adds `now - lastAt - paused`; once `release()` empties the members nothing is paused and nothing is being read, so the whole gap counts, with no bytes in it. This is what the builder's 3.4 MB/s was: in an idle base run `JUMP t=5983 added=302 sinceLast=2730 paused=2427 … members=1`, then `JUDGE rate=3410889 active=2003 bytes=6832128`, that is 1582 ms of A, the test's 300 ms sleep, and 118 ms of B. Reproduction with nothing paused: an 8 MB/s origin against 5 MB/s of media, A read for 0.5 s and closed, B starts `gapMs` later, 4 s read:

  | gapMs | judged rate               | mode after 4 s                              |
  | ----- | ------------------------- | ------------------------------------------- |
  | 0     | 7956671 B/s               | single                                      |
  | 300   | 6782876 B/s               | single                                      |
  | 1000  | 3994964 B/s, `added=1006` | **parallel** (a fast origin, wrongly split) |

  It is not what made the old test fail (those runs split before B existed, `held=NONE`), it is not a regression, and the old test could not see it (its bitrate is 2.5x the origin's rate). In production the gap is ffmpeg's reopen plus the origin's first-byte time, so a few percent of a 5 s window, and a wrong split falls back through `no-speedup`. Options: (a) leave it, since first-byte latency is arguably the origin's; (b) have `release()` of the last member call `interrupt()`, which drops the gap and B's first chunk. Recommend (a) now, and a bullet on dl-114's Meter unit-test item so whichever is chosen gets an assertion. The owner's call.

- **dropped** · "a timer or the meter's arithmetic is the real cause": checked. In every failing base run the pause had not engaged when the window closed (`held=NONE`), so no pause arithmetic ran; `rate=3797040` is `7618763 B / 2.007 s`. The stalls that shave the delivered rate are in finding 1.
- **dropped** · "at 8 MB/s a 16 MB fill reaches the window again": not on Linux here. The fill was 10.4 MB at most, even with an unthrottled origin. The risk is the delivered rate, finding 1; Windows is unmeasured.
- **dropped** · scope: no file under `engine/src` changes, the dl-114 bullet's facts match what was measured apart from the two points above, and dl-108's tests are untouched. Nothing to report.
- **findings** · the hunt returned 7; 4 carried (1 med, 3 low), 3 dropped.
- NFR: security n/a · performance n/a (the 4 s wait is unchanged) · reliability — finding 1 · maintainability — the two comment findings above.

## Log

- 2026-10-12, filed and built (branch `dl-120`, base `origin/main` 84c899e4,
  which has dl-108's #451; `git diff origin/dl-108 origin/main --
tools/downloader/engine` prints nothing, so the measurements taken at dl-108's
  head b531355c hold here).
  - **The cause is the test's timing assumption, not the meter.** Reader A reads
    200 KB and stops. The feeder keeps writing to it until the kernel's socket
    buffers between them are full and `write()` blocks, and only then pauses the
    origin. Every byte of that fill is real origin reading, and the meter counts
    it. It was measured with temporary stderr lines, since removed, at the
    feeder's pause, its resume and its split. Across those series (idle; 16 and
    24 busy loops spread over the 12 cores; 1, 3, 7 and 11 loops on the test's
    core) and three instrumented full `--project downloader` runs, the
    loopback took between 5.2 MB and 7.8 MB, and the larger amounts came under
    CPU contention. At the fixture's 4 MB/s that is
    1.3 to 1.99 s of active time against `measureMs: 2_000`:
    - alone: `pause … active=1570 bytes=6291456` (8 of 8 runs between 1570 and
      1584 ms);
    - 11 busy loops on the test's core, passing: `active=1893` to
      `active=1992`, `bytes` 7.6 to 7.7 MB;
    - the same load, failing (at dl-108's head b531355c):
      `split t=13748 rate=3811197 bitrate=10000000 active=2003 bytes=7635147`,
      with the last pause at `active=1454 bytes=5390539` and the feeder still
      writing. The window closed on A alone before the pause held. The meter
      then judged a 3.8 MB/s origin against 10 MB/s of media and split, which
      is the right decision for that origin.
  - **The fix is in the test** (superseded by the round 2 entry below, which
    leaves A unthrottled instead). `pausedThenRead` now uses an 8 MB/s origin
    against 20 MB/s of media, the same 0.4 ratio. The same buffers (7.5 to
    9.2 MB at that rate) fill in 0.92 to 1.08 s of active time
    (`pause … active=919` to `active=1083`, 12 runs, 11 busy loops), about 0.9 s
    clear of the window instead of 0.01 to 0.4 s. `measureMs`, the 4 s wait, B's
    4.5 s bound and the assertions are unchanged. No tolerance was widened.
  - **Before and after, 11 busy loops on core 11** (`pinned.sh`, a scratch
    script: `taskset -c 11` on the run and on 11 `node -e "for(;;){}"`;
    `-t "F9: a paused request"`, which runs both `pausedThenRead` tests). A
    full `vitest run` of another session was live in the shared checkout during
    both series, with a load average of 9 to 28:
    - base (test file at 84c899e4): **5 of 20 runs failed**, each with `expected
'parallel' to be 'single'`. Four were the "closed" test and one was "left
      open". An earlier series at b531355c failed 2 of 12, and one at main
      32f8a994 with 7 loops failed 2 of 6;
    - head: **20 of 20 passed** (`Tests 2 passed | 41 skipped (43)` each).
  - **Alone at the head:** "F9: a paused request ffmpeg closed" passed 10 of 10.
    At the base it also passed 10 of 10 alone, at 32f8a994 and at b531355c. The
    test fails only under contention, so the alone series cannot show a
    difference, and Done when 2 carries the proof.
  - **The whole file at the head:** `npx vitest run
tools/downloader/engine/test/parallel-ranges.test.ts` gave `Tests 43 passed
(43)` in 80.02 s.
  - **The tests still catch gate 2's F9** (`mutate.sh`, planted in
    `parallel-ranges.ts` and restored after each run). Each mutation gave the
    same result against the base test file and the head one:
    - `release()` keeps the request (`members`/`paused` not deleted): both pass.
      Alone it is not a defect these tests can see, because B reading keeps the
      meter running;
    - one paused request pauses the meter (`allPaused = paused.size > 0`):
      "left open" fails, "closed" passes;
    - both together, the one-flag shape gate 2 found: **both fail** (`Tests 2
failed`).
  - **What the brief had wrong.** "The meter's windows and timer ticks, the
    fixture's rate against the media rate" pointed at the right parameters. The
    missing variable was the kernel's buffer between the feeder and a stopped
    reader, which is several megabytes and grows under CPU contention. The
    fixture delivered its 4 MB/s at every load measured (rate at the pause
    4.0 MB/s, and 3.8 MB/s in the worst failing run), so the fixture's pacing
    was not the cause.
  - **dl-106's unexplained Linux failure** was in the sibling test "a request
    ffmpeg closed while it was reading …", which this branch does not touch. It
    has a 4000 ms window against 4 MB/s, and a reader that stops after 200 KB,
    so the same fill (at most about 2 s) lands inside its window. A failure of
    that test means the measured rate fell below 3 MB/s, which is a different
    mechanism. It stays unexplained.
  - **dl-98's "finishes at least 3x faster" test** has also failed on the
    Windows leg today, at a ratio of 2.907 to 2.995 against 3. That is relayed
    by the orchestrator, which read one of the readings itself. It does not share
    this cause. That test compares the wall time of two whole ffmpeg jobs, with
    no reader that stops and no pause, and this branch does not change it. It
    was not measured here. It has since been filed as
    [dl-121](./dl-121-the-3x-parallel-ranges-test-fails-on-the-windows-leg.md).
  - **Fold-in decision.** dl-114 item 3 plans to export `Meter`, unit-test its
    pause arithmetic, and shrink the third F9 test. This branch makes none of
    that free, so it is not folded in. Its Build gains one bullet, in this
    branch, because what was measured here bounds that shrink: rate ×
    `measureMs` must stay well above the loopback's fill, or the window closes
    before the pause it is meant to contain. The `sleep(4_000)` in
    `pausedThenRead` could now be about 2.5 s, since the fill takes about 1 s,
    but no ticket specifies that, and dl-114 may replace these tests anyway. It
    is left alone.
  - `difficulty: standard`: finding the cause needed instrumenting the feeder
    and choosing between a meter defect and a test assumption. The fix is two
    numbers in one test helper. (Superseded by the round 2 entry below, which
    sets A's and B's rates separately.)
- 2026-10-13, round 2, after gate 1 (CONCERNS: one med, three lows, all five
  Done-when lines verified at fa0a03cf).
  - **Owner's decisions, 2026-10-12** (asked by the orchestrator; both were the
    gate's recommendations):
    1. On the med, "the fix cuts the failure but does not remove it": doubling
       the rate left the fill's cost to the rate the fixture _delivers_, and at
       23 busy loops on one core the head failed 4 of 15 (gate 1's series). The
       options were "accept as built (A)" and "unthrottle reader A (B)".
       **Chosen: B.**
    2. On the low "the meter charges the gap between a released request and the
       next one's first byte as origin time": the options were "a note on
       dl-114" (recommended), "a separate ticket" and "leave it". **Chosen: a
       bullet on dl-114's `Meter` unit-test item**, with the gate's
       reproduction table. No production line changes here, so Done when 5
       holds.
  - **What changed.** In `pausedThenRead`, `behaviour.perConnectionBps` is
    `null` before A's request and `4_000_000` before B's, since the fixture
    takes the rate per request. The media stays at `size / 20_000_000`, so B is
    0.2 of the media rate and splits. A fills the loopback at the socket's own
    speed. Its bytes raise the rate the meter judges, but across the 23-loop
    series below the split judged 4.4 to 7.5 MB/s against a 20 MB/s bitrate. The 4 s wait, B's 4.5 s
    bound and the assertions are unchanged. The comment above the helper now
    describes this design, and dl-114's bullet now says _delivered_ rate and
    names the unthrottled reader as the way out (the two wording lows).
  - **(a) The head under 23 busy loops on core 11** (`pinned.sh … 20 … 23`,
    instrumented the same way as before, load average 2.9 to 28): **20 of 20
    passed**. A's held pause came at `active=257` to `active=1604` (median 522;
    one run at 1604, the rest at most 1067), with 7.5 to
    10.4 MB taken by the loopback. The split came at
    `rate=4409707` to `7545930`, `bitrate=20000000`.
  - **(b) The one-flag meter mutation** (`mutate.sh`, head test file, load
    average 17.7 decaying to 7.2 with no loops of mine running): "both" →
    **`Tests 2 failed`**. The two parts alone gave the same results as at the
    base: `no-release` → both pass; `any-paused` → "left open" fails.
  - **(c) Each half alone:**
    - each test alone, idle (load average 2.6 to 6.7): "closed" 5 of 5 and "left
      open" 5 of 5;
    - the change's first half alone (A unthrottled, B left unthrottled too),
      idle (load average 1.9 to 2.1): **2 of 2 runs fail both tests** with
      `expected null not to be null`. B is never slow, so it never splits: B's
      throttle is what makes the test able to pass;
    - the change's second half alone (B at 4 MB/s, A throttled at 4 MB/s too),
      23 loops (load average 1.6 to 28.8): **7 of 10 runs fail** with `expected
'parallel' to be 'single'`. A's unthrottling is what removes the flake.
  - **Done when 2 and 3 again, uninstrumented, at the head:** 11 loops, **20 of
    20** (load average 12.2 to 20.8). Alone, "closed" passed 10 of 10 (load
    average 4.6 to 10.8). The whole file: `Tests 43 passed (43)` in 79.67 s.
  - No other session's `vitest` was running when the 23-loop, half-2 and
    11-loop series started (`ps -eo pid,args | grep vitest` printed nothing). I
    did not check before the shorter idle runs.
- 2026-10-13 — **Gate 2's three lows, _fixed at landing_.** The owner was asked
  "Land it how?" with the options "lander fixes wording (recommended)" and "land
  as is", and chose **the lander fixes the wording, with no re-gate**. Only
  comments and docs change. No test logic and no number the test asserts moves,
  and nothing was re-measured.
  1. dl-114's loopback bullet said the fill "costs the window little whatever
     the kernel takes". It now says the cost is small at the median (522 ms, the
     builder's 23-loop series) and not bounded: about 1.1 s at 23 loops in gate
     2's series and 1.6 s in the builder's, and about 2 s at 47 (gate 2). The
     bullet names the remedy as fitting the two-reader `pausedThenRead`. It
     marks as **unmeasured** whether the third F9 test, whose one reader both
     stops and is measured, stays meaningful with that reader unthrottled. The
     over-long joined line is reflowed.
  2. The test comment's "5.2 to 10.4 MB" and "4.4 to 7.5 MB/s at the split" now
     give both measurements with their source and load. The held fills with A
     unthrottled were 7.5 to 10.45 MB (builder, 23 loops) and 6.3 to 10.45 MB
     (gate 2, 11 and 23 loops). The split rates at 23 loops were 4.4 to
     7.5 MB/s (builder) and 5.8 to 8.6 MB/s (gate 2). The 5.2 MB is real, but
     it was measured with A throttled at 4 MB/s
     (`DL120 pause t=4862 active=1284 bytes=5160960 received=5177344` in the
     builder's `probe-busy24-10.log`). So it now appears only in dl-114's
     bullet, under that condition.
  3. The round 1 entry's "The fix is two numbers in one test helper" is marked
     superseded by the round 2 entry, not deleted.
