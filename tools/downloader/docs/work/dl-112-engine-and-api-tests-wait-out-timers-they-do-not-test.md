---
id: dl-112
tool: downloader
title: Engine and API tests wait out frame grabs, fake-ffmpeg exits and stage timeouts they do not test
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-112 — Engine and API tests stop waiting out timers they do not test

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

Once browser-resolver is fixed, the next slowest suites set CI's floor:
parallel-ranges 104 s, stream 65 s, mirror-failover 45 s, stream-link 24 s and
egress-ca 15 s (CI run 38203804906). Most of that is a test waiting for a timer
to run out, not doing work. This ticket takes the **test-only** share. The
shares that need an engine option are in
[dl-116](./dl-116-engine-options-for-ffmpegs-reconnect-back-off-and-the-kill-grace.md),
and `Meter` is in
[dl-114](./dl-114-pure-rules-the-browser-tests-reach-through-chromium.md).

**The owner decided (2026-10-12):** delete a test that another test already
covers, but keep any row that a gate or an owner decision chose. Where you merge
assertions, keep a comment naming the gate finding they came from.

## Build

1. **egress-ca: the clearest single fix.** Measured:
   - "set" and "deprecated name" take 6.78 s each. With `FFMPEG_PATH=/bin/false`
     the first took 0.21 s.
   - The cause: after the probe, the thumbnail step's frame grab runs until
     `FRAME_GRAB_TIMEOUT_MS = 6_000` (`api/src/thumbnails.ts:132`), because the
     fixture answers every path with the master playlist.
   - The fix: `createApp` already takes `grabFrame` (`api/src/server.ts:75`).
     Pass `grabFrame: async () => null` in the test's app factory, unless a test
     there is about thumbnails.
2. **stream.test.ts: the fake ffmpeg's exit.** The interleave and
   Windows-shaped tests take about 10.3 s each, because each run's outcome is
   settled when the stand-in exits:
   - the `setTimeout(… process.exit(0), 5000)` stand-in at line 851;
   - `later(5000, "process.exit(0);")` at lines 2045, 2058 and 2068.

   Make the exit delay a parameter, and use the shortest value with which each
   test still proves its ordering. Do not touch the `later(15_000, …)` at line
   2077 unless you have read why it is 15 s.

3. **stream.test.ts: "an error after the first byte"** (7.0 s) uses
   `stageTimeoutMs: 4_000` with a 10 s late segment. Lower both values together,
   keeping their ratio.
4. **stream.test.ts: a duplicate fixture.** The dl-103 `beforeAll` regenerates
   the same `generateLargeProgressive` file that dl-102's block already made
   (about lines 1516 and 1830). Share one file.
5. **stream-link.test.ts:** the same shape as step 3, with
   `lateSegmentDelayMs = 10_000` and `stageTimeoutMs: 4_000` at lines 588–589
   (11.4 s locally). "Visitor leaves while waiting for a slot" (5.2 s) has no
   explained cause. Time it, and fix it only if the wait is not what it proves.
6. **mirror-failover.test.ts:** "a host that refuses the connection is failed
   over to the mirror" (line 291) is a subset of the dl-47 test at line 249.
   Both send a dead primary to the mirror and check the output decodes, and the
   dl-47 test also asserts the second alternate is never dialled. Fold anything
   only 291 asserts into 249, then delete 291 (saves about 11 s).
7. **parallel-ranges.test.ts:** apply each change only if the test still proves
   its claim afterwards.
   - **Refusal rows.** The 403 and 503 rows (4.4 s each) go through the same
     `REFUSAL_STATUSES` set (`engine/src/download/parallel-ranges.ts:177`) as
     the 429 row. Keep 429 end to end, and pin the set's membership with a unit
     assertion. In the kept row, once the measuring window has passed, cancel
     the second job instead of reading all 4 MB to compare media again; the
     first job's comparison already proves the media.
   - **Unknown size, unknown duration, opted-out host** (5.6, 5.6 and 4.2 s).
     Each reads 4 MB at 1 MB/s to assert a connection count that is settled
     early. Cancel the job once the count is observable, or use a shorter
     fixture.
   - **Cancel** (4.4 s) awaits `media.done`, which settles after the kill grace.
     Leave it for dl-116.
   - **Do not touch** the "≥3x faster" headline test, F4, the F2 stall, or the
     bytes-held-ahead test. dl-106's Windows timing lessons apply to every
     timing you shorten here (line 141 warns about the 15.6 ms Windows timer
     tick).

## Done when

1. Each file named above has before and after durations, from a local run, in
   the Log.
2. Every test deleted or merged is named in the Log with the test that now
   covers it.
3. `npm test -- --project downloader` passes, and no test removed here had a
   gate or owner decision behind it (check `git log -S` on its name).

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimates are about 35 to
  45 s for parallel-ranges, about 22 s for stream, 13 s for egress-ca, about
  8 s for stream-link and 11 s for mirror-failover. They are inferred except
  for egress-ca, which was measured.
