---
id: dl-116
tool: downloader
title: Four suites wait out ffmpeg's hard-coded 10 s reconnect back-off and the runner's 3 s kill grace
kind: chore
status: done
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

## Review

**Gate: PASS** — 2026-10-12 · `d759b80e..07af7430` · Opus 5.5, depth standard

| Done when                                                                                                                           | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Argv tests pin `-reconnect_delay_max 10`, and a test pins a 3000 ms grace, both with no option passed                               | `engine/test/ffmpeg-args.test.ts` › "is 10 seconds on a network input when nothing is passed", "is 10 seconds on the loopback input when nothing is passed", "is 10 seconds on every input of a stream's argv when nothing is passed" ✓; `engine/test/kill-grace.test.ts` › "is 3000 ms when nothing is passed" ✓ (asserts only SIGTERM at 2900 ms of fake time, then SIGKILL sent at 3000 ms or later); `engine/test/config.test.ts` › "are 10 s of reconnect back-off and a 3000 ms kill grace by default" ✓. With `DEFAULT_KILL_GRACE_MS` at 1000, 2 fail (the config and kill-grace pins). With `DEFAULT_RECONNECT_DELAY_MAX_S` at 5, 5 fail (the config pin, the three argv pins and the NaN fallback). Checked a second way: the API's own engine, built by `createApp` with nothing passed, reads `reconnectDelayMaxS=10 killGraceMs=3000`                  |
| The listed tests run with the shorter values, still prove what their names say, and their before and after durations are in the Log | **verified.** After, from the verbose project run: mirror-failover's three dead-host tests 474 / 188 / 79 ms; stream's "never served again" 86 ms and "an error after the first byte cuts the connection" 2315 ms; proxied-https's two tests 68 / 80 ms; parallel-ranges' cancel test 1671 ms. Before, measured with the engine's threading of both options removed: 11.2 s, 11.1 s and 5.0 s, and the cancel test 4.7 s at a 3000 ms grace. Both agree with the Log. Names still proven, with planted regressions: a failover that never tries the next candidate fails "fails over to a yt-dlp mirror" and "the last candidate's own failure"; reconnect turned off on the loopback input fails "never served again" on its new `refusedReconnects` assertion. A real ffmpeg at a ceiling of 0 retries once (2 requests to a cut body, 3 at 1, 5 at the default) |
| `npm test -- --project downloader` passes; Windows leg checked on the PR                                                            | 115 of 116 files passed (1 skipped), 2471 of 2473 tests passed (2 skipped), `npx vitest run --project downloader`. `test (windows-latest, informational)` passed on `ed154808`: 5201 passed, 27 skipped (5228), with `kill-grace.test.ts` 3 of 3 skipped. That sha adds only a Log entry on top of `07af7430` (`git diff --stat 07af7430 ed154808`: 1 file, the ticket)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

- **low** · no `Done when` line depends on it · `reconnectDelayMaxArg` in
  `engine/src/ffmpeg/args.ts` truncates and floors its input but has no ceiling,
  and the bundled ffmpeg 7.0.2 rejects anything above 4294:
  `reconnectDelayMaxS: 5000` gives argv `5000`, exit 222,
  `Value 5000.000000 for parameter 'reconnect_delay_max' out of range [0 - 4294]`.
  `1e21` gives `1e+21`, which is rejected the same way. The test
  "a whole number of seconds is all ffmpeg accepts, so anything else is rounded
  into range" and the helper's comment both say every whole number is accepted.
  There is no live call site: `api` passes nothing and no environment variable
  sets the option. Fix: `Math.min(4294, …)` and a `5000 → "4294"` case.
- **low** · no `Done when` line depends on it · nothing asserts that
  `EngineConfig.reconnectDelayMaxS` and `killGraceMs` reach the engine's own
  argv and runner. The `buildStreamArgs` and `streamFfmpeg` tests pass the
  values in directly. Replacing `config.reconnectDelayMaxS` and
  `config.killGraceMs` with `undefined` in `attempt` (`engine/src/stream.ts`)
  leaves stream, mirror-failover, kill-grace, config and ffmpeg-args at 123 of
  123 green, only slower (11.2 s, 11.1 s, 5.0 s). Production is unaffected
  either way. Only the speed-up has nothing guarding it.
- **low** · `nfr:maintainability` · the brief's Done when 3 and the Log both
  say "the `hls-e2e` kill-tree tests run there". `engine/test/hls-e2e.test.ts`
  was removed in dl-53. On Windows the kill tree is covered by
  `engine/test/stream.test.ts` › "cancelling after the first byte kills ffmpeg
  and rejects `done` with JOB_CANCELED", which passed on the Windows leg, and
  by `ffmpeg-args.test.ts` › "process-tree kill". Three source comments
  outside this diff still name the deleted file (`preview-frame.test.ts`,
  `mse-page.spec.ts`, `api/test/helpers/tls-origin.ts`).
- **dropped** · `killGraceMs` gets no validation, unlike the reconnect option
  (a negative or NaN reaches `setTimeout`). It has no live caller and I did not
  measure it, so it is not a finding.
- **dropped** · the kill grace that `grabPreviewFrame` uses does not follow
  `EngineConfig.killGraceMs`. Preview grabs are not engine runs, take no
  `EngineConfig`, and keep the 3000 ms default. Not a defect.
- **dropped** · the 300 ms grace narrows the parallel-ranges cancel test's
  post-abort window from about 3.4 s to about 0.8 s. The one regression I could
  plant there, a feeder that ignores the abort, passes at both 300 ms and
  3000 ms, because ffmpeg then exits on SIGTERM and closes the feeder within
  milliseconds. So I found no regression that the default catches and 300 ms
  misses.
- **findings** · the hunt returned 6; 3 carried, 3 dropped.
- Windows `taskkill /T /F` branch: `killTreeWindows(pid, logger)` is unchanged
  and still gets the same pid and logger. The win32 skip on `kill-grace.test.ts`
  hides nothing that should run there, because all three tests measure the
  POSIX SIGTERM-to-SIGKILL window.
- Title type: `test` is hidden in `release-please-config.json`, as are
  `refactor` and `chore`, so the branch releases nothing. That is right,
  because no user-visible behaviour changes. A non-hidden type (`feat`, `perf`)
  would cut a release for nothing. `node scripts/commit-message.mjs --text`
  exits 0 on the title.
- Invariants: no shell (`spawn-safety.test.ts` passes, and the new `spawn` uses
  `shell: false`), process trees are killed (the new test kills the group with
  `-pid`), no `any`, no `console`. Contract untouched, no new package, no route
  change. Skipped: SSRF, redaction, AppError codes, image closure (no path in
  the diff reaches them; `image-closure.test.ts` passes anyway).
- NFR: security n/a (the argv shape is unchanged, the whitelist still asserted)
  · performance ✓ (about 70 s off the listed tests) · reliability ✓ (production
  defaults pinned and confirmed through `createApp`) · maintainability, see the
  lows above.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 70 s
  from the reconnect delay and about 9 to 12 s from the grace. Inferred from
  the tests' own comments and CI durations, not measured with the option in
  place.

- 2026-10-12 — Built on `dl-116` from `d759b80e` (dl-112 is merged as #438). Each
  suite run alone with `npx vitest run --reporter=verbose <file>` on a machine
  other builders share, so the absolute seconds are noisy and the differences
  are not.
  - **The defaults were pinned first, against unchanged source.**
    `npx vitest run tools/downloader/engine/test/kill-grace.test.ts
    tools/downloader/engine/test/ffmpeg-args.test.ts` printed `Tests  1 failed |
    33 passed (34)`: the three `-reconnect_delay_max 10` pins and the two
    default-grace tests passed, and the one test that passes `killGraceMs` failed
    with `expected 3014.937724 to be less than 2000`, because nothing yet read the
    option. After the change all 44 of the three files (`kill-grace`,
    `ffmpeg-args`, `config`) pass.
  - **Each pin can fail.** With the grace constant at 1000 the grace test run
    prints `× is 3000 ms when nothing is passed` and `expected [ 'SIGTERM',
    'SIGKILL' ] to deeply equal [ 'SIGTERM' ]`. With the reconnect constant at 5
    (both mutations in one run) the three files print `Tests  5 failed | 39
    passed (44)`: the config test, the three argv pins and the NaN fallback.
    Both restored (`grep -n "DEFAULT_KILL_GRACE_MS =" …/kill.ts` prints
    `= 3000`, and the reconnect constant `= 10`).
    The first version of the grace pin asked whether the child was still alive at
    2900 ms and **did not fail under the 1000 mutation**: a SIGKILLed child stays
    a zombie, and so alive to `kill(pid, 0)`, until the event loop reaps it, which
    a fake clock gives no time for. It now records the signals sent and the fake
    time of each.
  - **What was built.** `EngineConfig.reconnectDelayMaxS` (default 10) and
    `killGraceMs` (default 3000), set through `createEngine` only: no environment
    variable and nothing in `api`, whose `createEngine` call is untouched. The
    first reaches `-reconnect_delay_max` on every network input (video, separate
    audio, subtitles) and the loopback input, through
    `StreamArgsOptions.reconnectDelayMaxS`; the second reaches
    `killProcessTree` through `FfmpegRunOptions.killGraceMs` and `killQuietly`.
    The preview-frame run is not given either (it is `reconnect: false`, and its
    kill is not in the list). The Windows branch is as it was.
  - **Done when 2, before → after, per test:**
    - `engine/test/mirror-failover.test.ts` "fails over to a yt-dlp mirror (dl-47)"
      11.17 → 0.88 s, "the last candidate's own failure" 11.08 → 0.25 s, "with no
      mirror to try" 11.04 → 0.13 s; whole file 33.97 → 3.37 s (4 of 4 before
      and after). Reconnect ceiling 0, so one immediate retry, then the failure.
    - `engine/test/stream.test.ts` "a progressive body cut … never served again"
      11.07 → 0.09 s (ceiling 0; it now also asserts that at least one reconnect
      was refused, so a failure with no retry cannot pass it); "an error after the
      first byte" 5.03 → 2.33 s (grace 300 ms); whole file 43.71 → 34.09 s (75 of 75).
    - `api/test/proxied-https.test.ts` "the same fetch fails when httpproxy leaves
      the protocol whitelist" 11.04 → 0.05 s and "a download from an origin ffmpeg
      has no CA for fails" 11.09 → 0.06 s (ceiling 0); whole file 27.81 → 5.80 s
      (18 of 18).
    - `engine/test/parallel-ranges.test.ts` "a cancel after the first byte closes
      every origin connection" 4.36 → 1.79 s (grace 300 ms), and nothing else in
      the file changed (dl-114 edits the rest); whole file 74.95 → 73.98 s (39 of
      39), the rest being unchanged tests and noise.
  - **What the brief had wrong.**
    - "Read how `readTimeoutMs` reaches `args.ts` and follow that path": it does
      not reach it. No caller passes `readTimeoutMs`; `args.ts` supplies its own
      default. The path followed instead is `tlsCaFile`'s: `EngineConfig` →
      `StreamArgsOptions` → `buildNetworkInputArgs`.
    - "four of five" mirror-failover tests: dl-112 deleted one, so it was three of
      four. The fourth, the expired-URL one, gets a 403 and is not retried; it
      keeps the default.
    - The stream "an error after the first byte" is the one `killQuietly` test the
      brief guessed at ("probably"): confirmed, 5.0 → 2.3 s, the other 2.0 s being
      its own stage timeout. The dl-103 stand-ins and "a cancel whose kill outlasts
      the hold" keep the 3 s default on purpose, untouched.
  - **Not folded in: `api/test/stream-link.test.ts` "an error after the first
    byte aborts the connection" (9.2 s after dl-112).** It has the same shape,
    but its engine is built by `createApp` from the API's own config, and giving
    it a grace means a new API config key; this ticket's rule 3 is that the API's
    engine wiring passes nothing new. Left as it was, for the owner to decide.
  - **Not measured: Windows.** This changes an ffmpeg argv path and the
    process-tree kill, and neither is proven on Windows until the draft pull
    request's Windows leg has run; the `hls-e2e` kill-tree tests run there. The
    new grace tests are skipped on win32 (the branch has no grace to pin).

- 2026-10-12 — **The owner's answer on the stream-link test.** Asked whether
  `api/test/stream-link.test.ts` "an error after the first byte aborts the
  connection" (about 9.2 s) should be shortened, which needs a new API config key
  and so is ruled out by this ticket's rule 3, the owner chose **"A, leave it as
  is"** on 2026-10-12, over "B, file a follow-up ticket for a test-only
  `killGraceMs` API config key". A was the recommended option. The test is
  unchanged and nothing is filed; the "left as it was, for the owner to decide"
  line above is now decided. Relayed through the coordinator.
