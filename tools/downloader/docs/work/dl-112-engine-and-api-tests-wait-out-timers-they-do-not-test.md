---
id: dl-112
tool: downloader
title: Engine and API tests wait out frame grabs, fake-ffmpeg exits and stage timeouts they do not test
kind: chore
status: done
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

## Review

**Gate: PASS** — 2026-10-12 · `bb4d2044..4244dc61` · Opus 5.5, depth medium

| Done when                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Before and after durations for each of the five files, from a local run, in the Log               | **verified**: the Log has all five. Two re-timed here, `npx vitest run <file>`, base test file against head test file on the same build: `egress-ca.test.ts` 16.8 s → 3.5 s (12 of 12 both; Log 15.8 → 2.7), `parallel-ranges.test.ts` 102.4 s → 78.8 s (38 of 38 both; Log 102.2 → 78.8). Per test: unknown size 5.5 → 1.6 s, unknown duration 5.5 → 1.6 s, opted-out 4.2 → 1.1 s, refusal rows 4.4 → 2.3 s. The direction and size in the Log hold                          |
| 2. Every test deleted or merged is named in the Log with the test that now covers it                 | **verified**: the diff removes one test, `mirror-failover.test.ts` › "a host that refuses the connection is failed over to the mirror", and merges one fixture (`ensureLargeFixture`). The Log names both and what covers them. Test counts do not move elsewhere: egress-ca 12/12 and parallel-ranges 38/38 at base and head. Mutation H below shows the named replacement goes red when refused-connection failover breaks                                                  |
| 3. `npm test -- --project downloader` passes; no removed test had a gate or owner decision behind it | **verified**: `npx vitest run --project downloader` at head gave 2457 passed, 2 skipped (2459), 114 files plus 1 skipped, exit 0. PR #438's `test (ubuntu-latest)` and `test (windows-latest, informational)` both passed on `4244dc61` (run 38264895200; Windows 5108 passed, 24 skipped). For the second clause, `git log -S` on the deleted name prints `4b9ce2ff` (repo-39) and `1f0f4402` (dl-45), and neither is a gate finding or an owner choice. Reading taken below |

**Each changed timing still fails when the behaviour it names breaks.** Production mutations were planted in a copy of the head tree and the test was run at the head. All went red:

- `egress-ca.test.ts`: `server.ts` loses the `originTls` spread, and "set" and "deprecated name" fail with `expected 502 to be 200` (3 failed, 9 passed).
- `stream.test.ts`, the 300 ms stand-in exit, two mutations:
  - A reconnect clears every connection (`endedEarly.clear()`). "however the lines interleave" and "Windows-shaped connection" both fail with `promise resolved "{ bytes: 4096, durationSec: 6 }" instead of rejecting`.
  - Reconnects are ignored. Both fail with `promise rejected "AppError: The source cut part of the vide…" instead of resolving`.
  - As a check on the comment's claim, `EXIT_AFTER_LINES_MS = 0` still passed 5 of 5 runs on Linux.
- `stream.test.ts` and `stream-link.test.ts`, the 2 s / 5 s late segment: the stage timeout is replaced by an hour, with the engine `dist` rebuilt. Both "an error after the first byte" tests fail with `expected false to be true` on `aborted`.
- `stream-link.test.ts`, "waiting for a slot" with `firstGet` now awaited: `files.ts` `onClose` never cancels. The test fails with `timed out waiting for job … "status":"queued"` after 20.4 s, so the awaited `firstGet` does not hang the failure.
- `parallel-ranges.test.ts` at 4 MB/s, four mutations:
  - The opt-out is ignored in `splittable`: the opted-out test fails with `fanOut 25, maxOpen 4, requests 27`.
  - An unknown duration is read as 0.1 s: the unknown-duration test fails with the same counts.
  - 503 is removed from `REFUSAL_STATUSES`: the 503 row fails with `{ fanOut: 3, maxOpen: 2, requests: 6 }` (1 failed, 5 passed).
  - The no-speed-up fallback is removed: the per-client-throttle row fails with `expected 0 to be greater than 0`.

**The deleted mirror test.**

- Mutation H drops `Connection to \S+ failed` and `Connection refused` from `FFMPEG_HOST_FAILURE`. Over the whole engine package, 3 of 262 fail: `failover.test.ts` › "a host that never answered is one, on either path", plus two in `mirror-failover.test.ts`, "…exactly as it does to an HLS one (dl-47)" and "the last candidate's own failure is what reaches the caller".
- Mutation I is an off-by-one in the loop, `index + 2 < candidates.length`. It breaks exactly the deleted test's single-mirror shape. The dl-47 test stays green, because it has three candidates. "the last candidate's own failure…" goes red (`expected 1 to be greater than 1`), so a single-mirror regression is still caught, though by an error-path test rather than one that decodes the recovered file.

**The shared fixture.** `fixtureRoot` is a per-file `mkdtemp` and the memo is module state, so no second file can reach it. No block in the project runs concurrently.

- The four changed api and engine files (all but `parallel-ranges.test.ts`) were run together under the project's settings twice: 108 of 108 both times.
- A `--sequence.shuffle` run with seed 1 ran dl-103's block before dl-102's: 30 passed, 45 skipped, exit 0.

- **low** · no `Done when` line depends on it · `api/test/egress-ca.test.ts`, the comment in `wiredApp` says "a probe's verdict does not wait on the grab's result". The probe route does wait for the grab: `routes/probe.ts` awaits `captureThumbnail` before it replies. At the base, the 6.7 s each probe test took was inside the test body, since `cleanups` run in `afterAll`. What holds is that the status does not depend on what the grab returns. "does not depend on the grab's result" is the accurate wording.
- **dropped** · reading of Done when 3's "a gate … behind it". I read it as a test a gate finding or an owner decision asked for, which is the owner's own wording in Why ("keep any row that a gate or an owner decision chose"). The deleted test was dl-45's builder's proof for its Done when 2, which its gate then ran. It was not chosen by a gate, so the line holds. Under the stricter reading (any test a gate record cites), it collides: dl-45's `## Review` cites the deleted test, pinned to a commit that is on `origin/main` and still resolves, and dl-45's line ("a connection-level failure from the first host … retries the alternate and succeeds — driven by a fixture origin") is still proven by the dl-47 test, which mutation H turns red. So neither reading leaves a line unproven.
- **dropped** · the unknown-size row did not go red under a size guessed at 4 MiB in `#bitrate` and the split, nor with `splittable` also ignoring `seekable`. That held at the base too, so it predates this branch and is not about the rate. The behaviour never broke: `#relayHead` nulls `serve.end` on any non-206 answer, so the mutation is no evidence either way.
- **dropped** · brief step 7's 403 and 503 rows were kept, not cut. dl-98's Log records the owner choosing "Cover 403 and 503 too", and the brief's own rule keeps a row an owner decision chose. Not a defect.
- **findings** · the hunt returned 4: 1 carried, 3 dropped.
- Windows: the leg ran green once on `4244dc61`. The two 300 ms stand-in tests are `skipIf(win32)` and never run there. The tightened rates and the 2 s stage timeouts did run there and passed: "an error after the first byte" took 2098 ms in the engine and 6688 ms in the api; unknown size 2263 ms; opted-out 1091 ms. That is one sample, so flake rate is unmeasured.
- Not verified: the Log's claim that the four `later(5000, …)` dl-103 stand-ins are never reached. It explains a speed-up not taken; nothing correct rests on it.
- NFR: security n/a (test-only diff, no `src` touched) · performance ✓ (measured above) · reliability ✓ (two together-runs, one shuffled run, one full project run, CI on both legs) · maintainability: the comment above.

### Gate 2

**Gate: PASS** — 2026-10-12 · `4244dc61..ae34955e` (one commit, `ae34955e`) · Opus 5.5, depth medium

Scope: the round's own commit. It replaces dl-98's "a 403" and "a 503" rows in `parallel-ranges.test.ts` with a feeder-level `test.each` over 403, 429 and 503, on the owner's 2026-10-12 answer. It also logs that answer in dl-112 and dl-98 and rewords one comment in `egress-ca.test.ts`. No `src` file is touched.

**Gate 1's finding**

- **low**, the `wiredApp` comment in `egress-ca.test.ts`: **fixed**. It now reads "the probe route still waits for the grab before it replies, but its status does not depend on the grab's result". That matches `routes/probe.ts`, which awaits `captureThumbnail` before replying.

**The new test**, `parallel-ranges.test.ts` › "a %s on a fan-out fetch is reported to onRefused as a status refusal". Mutations were planted in a copy of the head tree, and the refusal block was run under each:

| Mutation                                                  | Result                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| none                                                      | 7 of 7 pass                                                          |
| `REFUSAL_STATUSES` without 403                            | the 403 case fails; 1 failed, 6 passed                               |
| without 503                                               | the 503 case fails; 1 failed, 6 passed                               |
| without 429                                               | the 429 case and the "a 429" end-to-end row fail; 2 failed, 5 passed |
| `#check` gives a 503 the kind `reset` instead of `status` | the 503 case fails; 1 failed, 6 passed                               |
| `onRefused` reports `host:port` instead of the host       | all 7 fail, the new cases on their `host: "127.0.0.1"` assertion     |

**Whether the fallback after a refusal is still exercised**

- **Status refusals.** The "a 429" row still drives a status refusal end to end. It covers the fallback to one connection, identical media, open-ended requests after the last fan-out, and the remembered host. `#check` and `#fallBack` have no branch on which status it was: the only status-specific input is set membership, and the new test pins that.
- **The continuation in `#fallBack`, skipped for every refusal kind.** Over the whole file, 2 of 39 fail: "a second read relaying a whole-file 200 is left to finish when the split falls back" and "F2: a fan-out fetch that sends its headers and then nothing falls back, and the job completes".
- **The same skip for `status` refusals only.** Every row stays green at this head, including "a 429". It also stayed green at `4244dc61`, with "a 403" and "a 503" still present (6 of 6). So removing the rows lost no proof on this axis. The job still completes on one connection with identical media without that branch.

**Records**

- **dl-112's Log** says what the owner chose: "Replace with a unit test" over "Keep the rows (Recommended)", and that a unit assertion counts as covering 403 and 503 for dl-98. Neither more nor less.
- **dl-112's Log, other claims:**
  - `git log -S'kind: "a 403"'` and the same for `"a 503"` at the base each print only `72b47fe1` (dl-98), as stated.
  - 39 of 39 tests confirmed. The file ran in 75.3 s here; the Log says 75.9 s.
- **dl-98's new Log line** names the rows, what replaced them, the date and that 429 stays. It leaves out the part of the answer that matters to dl-98's own record: that the owner ruled a unit assertion still counts as dl-98's "Cover 403 and 503 too". See the low below.
- **Done when 3** (no removed test had a gate or owner decision behind it) stays **verified**, on one ground: the two rows did have an owner decision behind them (dl-98's "Cover 403 and 503 too"), and the owner removed them by a later decision, recorded with its options in dl-112's Log. The gate records that and grants nothing.

**Windows.** `test (windows-latest, informational)` passed on `ae34955e`, run 38271220330: 5109 passed, 24 skipped, and `parallel-ranges.test.ts` 39 tests in 77.2 s. `test (ubuntu-latest)` also passed on that sha.

- **low** · no `Done when` line depends on it · dl-98's new Log line records the replacement but not the owner's ruling that a unit assertion covers 403 and 503. Read alone, it looks as if dl-98's owner-chosen coverage was dropped. Adding "the owner decided a unit assertion counts as covering 403 and 503" would make it say what was chosen.
- **dropped** · the 429 row does not catch a `status`-only skip of `#fallBack`'s continuation. The skip escaped the removed rows too (shown above at `4244dc61`), so this round did not introduce it, and the user-visible fallback still holds under it.
- **findings** · the hunt returned 2: 1 carried, 1 dropped. Nothing in this round is a `high`.
- NFR: security n/a (test and docs only) · performance ✓ (75.3 s, 39 of 39) · reliability ✓ (both CI legs green on `ae34955e`) · maintainability: the low above.

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

- 2026-10-12 — **Round 2, the owner's answer.** Asked whether to keep dl-98's
  "a 403" and "a 503" refusal rows or replace them with a unit test, the owner
  chose **"Replace with a unit test"** on 2026-10-12, over "Keep the rows
  (Recommended)", and decided that a unit assertion counts as covering 403 and
  503 for dl-98. Relayed through the orchestrator.
  - The two rows are removed from `parallel-ranges.test.ts`. In their place,
    `test.each(["403", "429", "503"])` "a %s on a fan-out fetch is reported to
    onRefused as a status refusal" starts a real `RangeFeeder` against the
    fixture, reads its loopback as ffmpeg would, waits for `onRefused`, and
    asserts `[{ host: "127.0.0.1", kind: "status" }]`, no fatal error, and that
    the origin did refuse. 213 ms each. **429 stays as the end-to-end row** (the
    owner named only 403 and 503): it keeps the fallback and the host memory
    proven for the set, and it is in the new test too, so all three members of
    `REFUSAL_STATUSES` are pinned. The reset, 200 and no-speed-up rows are
    different mechanisms and stay.
  - **Red without each member.** `REFUSAL_STATUSES` is
    `engine/src/download/parallel-ranges.ts:177`, restored after each run. With
    `new Set([403, 429])`, `npx vitest run
tools/downloader/engine/test/parallel-ranges.test.ts -t "fan-out fetch is
reported"` prints `× a 503 on a fan-out fetch is reported to onRefused as a
status refusal 5010ms`, `Error: not within 5000 ms: no refusal reported;
origin saw
["bytes=0-","bytes=966656-1097727","bytes=1097728-1228799","bytes=1228800-1359871","bytes=835584-"]`
    and `Tests 1 failed | 2 passed`. With `new Set([429, 503])` it prints `× a
403 on a fan-out fetch …`, the same error and `Tests 1 failed | 2 passed`.
    Unmutated: 3 of 3 pass.
  - **Timing.** `parallel-ranges.test.ts` alone: 102.2 s before dl-112, 78.8 s
    after round 1, 75.9 s now (39 of 39 tests). The two rows were 2.3 s each; the
    three new tests are 0.2 s each.
  - **Done when 3, the removed rows.**
    `git log --oneline -S'kind: "a 403"' -- tools/downloader/engine/test/parallel-ranges.test.ts`
    and the same with `"a 503"` each print only `72b47fe1` (dl-98, which added
    them). The owner's answer above is what clears them, and dl-98's Log now
    says so.
  - Gate 1's one low, fixed: the `wiredApp` comment in `egress-ca.test.ts` said
    the probe's verdict does not wait on the grab; it now says the probe route
    still waits for the grab before it replies and its status does not depend on
    the grab's result.

- 2026-10-12 — **Gate 2's one low, _fixed at landing_** (the owner chose that
  over leaving it recorded, with no re-gate): dl-98's Log line recorded the
  replacement but not the owner's ruling that a unit assertion still counts as
  its "Cover 403 and 503 too". The clause is added there.
