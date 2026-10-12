---
id: dl-116
tool: downloader
title: Four suites wait out ffmpeg's hard-coded 10 s reconnect back-off and the runner's 3 s kill grace
kind: chore
status: ready
milestone: null
depends_on: [dl-112]
difficulty: standard
---

# dl-116 — Engine options for ffmpeg's reconnect back-off and the kill grace

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

Two engine constants are waited out by tests that are not about them. **The
owner allowed engine options for this on 2026-10-12, with defaults unchanged.**

1. **`-reconnect_delay_max 10`** is hard-coded twice in
   `engine/src/ffmpeg/args.ts`, at line 164 (inside `options.reconnect !== false`)
   and at line 218. ffmpeg retries a dead host or a cut that never heals at about
   0, 1, 3 and 7 s, about 11 s per failure. The tests that pay it, with their own
   comments saying so:

   | File                             | Tests                                               | Comment       |
   | -------------------------------- | --------------------------------------------------- | ------------- |
   | `mirror-failover.test.ts`        | four of five, 45 s                                  | lines 22–24   |
   | `stream.test.ts`                 | "progressive body cut … never served again", 11.1 s | lines 785–786 |
   | `api/test/proxied-https.test.ts` | both 11 s tests                                     | lines 469–470 |

   The total is about 70 s of CI test time.

2. **The kill grace.** `killProcessTree` already takes `graceMs`
   (`engine/src/ffmpeg/kill.ts:93`, default 3000 at `:106`), but the runner's
   `killQuietly` (`engine/src/ffmpeg/runner.ts:279`) passes only `{ logger }`.
   Every POSIX test that cancels a job waits up to 3 s for SIGKILL:
   - the dl-103 stand-ins in `stream.test.ts` (3.05 and 3.4 s, kept on purpose);
   - parallel-ranges' cancel test (4.4 s);
   - probably stream's "an error after the first byte".

   The total is about 9 to 12 s.

## Build

1. **Reconnect delay.**
   - Add an engine option for the reconnect delay ceiling (for example
     `reconnectDelayMaxS`), defaulting to 10. Thread it to both argv builders.
     Read how `readTimeoutMs` reaches `args.ts` and follow that path.
   - Pin the default with an argv test asserting `"-reconnect_delay_max", "10"`
     when nothing is passed.
   - In the tests listed above, pass the smallest value that still exercises a
     retry: 0 or 1. Any test asserting that ffmpeg _retried_ must still see a
     retry.
2. **Kill grace.**
   - Add an engine option for the kill grace, default 3000, and pass it through
     `killQuietly` to `killProcessTree`.
   - Pin the default with a test.
   - **The dl-103 stand-ins wait out the grace on purpose** (their names and
     comments say so). Leave them at the default, and shorten it only in tests
     where the SIGTERM-to-SIGKILL window is not what they prove.
   - The Windows branch (`taskkill /T /F`) has no grace. Do not invent one.
3. **Do not change production defaults.** The API's engine wiring passes
   nothing new.

## Done when

1. Argv tests pin `-reconnect_delay_max 10`, and a test pins a 3000 ms grace,
   both with no option passed.
2. The listed tests run with the shorter values, still prove what their names
   say, and their before and after durations are in the Log.
3. `npm test -- --project downloader` passes. The Windows leg is checked on the
   PR (it is informational, so read it with `gh pr checks`), because the
   `hls-e2e` kill-tree tests run there.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 70 s
  from the reconnect delay and about 9 to 12 s from the grace. Inferred from
  the tests' own comments and CI durations, not measured with the option in
  place.
