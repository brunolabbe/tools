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

- 2026-10-12 — Built on `dl-112` from `bb4d2044`. Each file run alone with
  `npx vitest run <file>` on a machine shared with other builders' suites, so
  the absolute seconds are noisy and the differences are not. **Done when 1,
  before → after, whole file:**
  - `engine/test/parallel-ranges.test.ts`: 102.2 s → 78.8 s (38 of 38 tests).
  - `engine/test/stream.test.ts`: 63.5 s → 42.6 s (75 of 75).
  - `engine/test/mirror-failover.test.ts`: 45.1 s → 34.0 s (5 tests → 4).
  - `api/test/stream-link.test.ts`: 25.5 s → 17.8 s (17 of 17).
  - `api/test/egress-ca.test.ts`: 15.8 s → 2.7 s (12 of 12).

  Per test (before → after): egress-ca "set" 6.6 → 0.2 s and "deprecated name"
  6.7 → 0.1 s, by `grabFrame: async () => null` in `wiredApp`; stream.test.ts
  "interleave" and "Windows-shaped" 10.3 → 0.9 s each, "an error after the first
  byte" 7.0 → 5.0 s; stream-link "visitor leaves while waiting for a slot"
  5.1 → 0.1 s and "an error after the first byte" 11.3 → 9.2 s;
  parallel-ranges unknown size 5.5 → 1.6 s, unknown duration 5.5 → 1.6 s, opted-out
  host 4.2 → 1.1 s, and each of the six refusal rows 4.4 → 2.3 s.

- **What the brief had wrong, and what was done instead.**
  - **Step 2, the `5000`s.** Only `standIn` (line 851) is paid for: its exit is
    what decides the "interleave" and "Windows-shaped" tests, two runs of 5 s
    each. It is now `standIn(lines, exitAfterMs = 5000)` and those two pass 300 ms.
    The four `later(5000, "process.exit(0);")` in the dl-103 stand-ins are never
    reached: row 1 is killed after its 3 s SIGTERM grace (3.0 s, dl-116's) and rows
    2 and 3 end on the verdict (0.28 s and 0.33 s), so there was nothing to
    shorten and they are untouched. `later(15_000, …)` is untouched: the timer
    row asserts `withinMs: 6_000` against it.
  - **Step 5, "visitor leaves while waiting for a slot" (5.1 s).** The body takes
    0.26 s. The other 5.0 s is `dispose` waiting for the first visitor's request,
    which the test left open (`void get(…)`). It now keeps that promise and awaits
    it in `finally`: 0.15 s, same assertions. The wait was not what it proves.
  - **Step 5, the late-segment test.** The API's probe reads the late segment too,
    so the delay is paid twice: the job's timeline is a probe of about
    `min(delay, 4 s)`, then the stage timeout, then the 3 s kill grace. Measured
    (headers, end) for (delay, timeout): (10 s, 4 s) 4.17 s, 11.1 s; (10 s, 2 s)
    4.17 s, 9.2 s; (5 s, 2 s) 4.17 s, 9.1 s; (3 s, 1.5 s) 3.24 s, 6.3 s. Lowered
    to 5 s and 2 s like the engine's, for 2 s saved; going to (3 s, 1.5 s) would
    save 2 s more and leave a 1.5 s margin for the first fragment, which I did not
    judge safe for a slow runner.
  - **Step 6, mirror-failover.** "a host that refuses the connection is failed
    over to the mirror" (`mirror-ok`) asserts nothing the dl-47 test does not:
    both dial a dead primary, both decode the file with `-xerror`, both check the
    mirror served `index.m3u8` and at least one `.ts`; dl-47 also checks the
    second alternate was never dialled. Nothing was left to fold in, so it is
    deleted and the file's docblock says so.
  - **Step 7, the 403 and 503 rows are kept.** dl-98's Log records the owner
    choosing "Cover 403 and 503 too" over "Done when as written", and the brief's
    own rule here is to keep a row an owner decision chose. They are instead cut
    in cost with the rest. **The cancel idea was not applied**: the cancel test's
    own comment says `media.done` settles about 3 s after an abort, which is more
    than the 2 s the second read costs, and an abort without awaiting `done`
    leaves ffmpeg alive into the next test's request log. Not measured here; what
    was measured is the replacement: `SLOW_AGAINST_HALF_A_SECOND` = 4 MB/s, half
    the media rate of a source declared 0.5 s long, where 1 and 2 MB/s were an
    eighth and a quarter. The "unknown size" and "unknown duration" tests keep
    their controls, which split at the new rate (1.6 s each).
- **Done when 2, tests deleted or merged:**
  - Deleted: `mirror-failover.test.ts` "a host that refuses the connection is
    failed over to the mirror", covered by "the engine fails over to a yt-dlp
    mirror exactly as it does to an HLS one (dl-47)" in the same file.
  - Merged: dl-103's second `generateLargeProgressive` into dl-102's, as
    `ensureLargeFixture()`, which both `beforeAll`s call so a run filtered to
    either block still has the files (`-t "dl-103"`: 19 of 19; `-t "dl-102"`: 11 of
    11). dl-103's URLs `/large-103/…` became `/large/…`.
- **Done when 3, `git log -S` on each removed test:**
  `git log --oneline -S"a host that refuses the connection is failed over to the mirror"`
  prints `4b9ce2ff` (repo-39, which anchored citations) and `1f0f4402` (dl-45,
  which added it). Neither is a gate finding or an owner decision about the
  test; but dl-45's Done when 2 names it as its proof (`@c87153d:275`, a pinned
  sha), so that row now points at a deleted test. dl-45 is `done` and was left
  alone; the surviving proof is the dl-47 test above.
  `git log --oneline -S"large-103"` prints `df941568` (dl-103), the fixture's own
  commit, not a decision about it.
- **Each shortened timing can still fail.** The "interleave" short exit: with
  `connectionOf` returning a constant, `npx vitest run
tools/downloader/engine/test/stream.test.ts -t "however the lines interleave"`
  fails (`promise resolved … instead of rejecting`, 0.87 s), and passes unmutated.
  The opted-out row: with `singleConnectionHosts: ["127.0.0.2"]` it fails
  (`fanOut` 25, `maxOpen` 4), so the 4 MB/s rate still splits a host that is not
  opted out.
- **Not measured.** The Windows leg: these timings are unproven on Windows until
  the pull request's Windows leg has run (dl-106's 15.6 ms timer tick applies to
  the 4 MB/s fixture and the 300 ms stand-in exit; the dl-103 and "interleave"
  stand-ins are skipped there).
