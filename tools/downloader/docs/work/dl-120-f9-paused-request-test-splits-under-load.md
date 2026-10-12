---
id: dl-120
tool: downloader
title: The F9 paused-request tests split under CPU load, because the loopback's fill outlasts the 2 s window
kind: fix
status: in-flight
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
  - **The fix is in the test.** `pausedThenRead` now uses an 8 MB/s origin
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
    was not measured here.
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
    numbers in one test helper.
