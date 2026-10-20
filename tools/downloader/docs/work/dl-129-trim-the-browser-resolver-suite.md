---
id: dl-129
tool: downloader
title: The browser tests are half the downloader project's test time, and most of each probe is two fixed sleeps
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-129 — Trim the browser-resolver tests, and the file that sets the local wall clock

## Why

The owner is cutting the wall clock of the build-and-gate loop (2026-10-18). A
downloader ticket runs the downloader project three or four times: the
builder's preflight, the gate's own run, the landing's `--land` preflight, and
CI on every push. Whatever that project costs is paid that many times per
ticket, so trimming it saves time without changing the process.
[repo-99](../../../../docs/work/repo-99-ci-runs-vitest-on-three-workers-for-a-wait-bound-suite.md)
showed that more workers could not help while one file was wait-bound, and
[dl-117](./dl-117-split-browser-resolver-test-so-one-file-is-not-the-whole-run.md)
split that file into six. Nobody had measured the project since. The Log's
2026-10-18 entry does, at `335efcd4`. Four findings set this ticket's shape:

- **The project is cheap now, and the wall clock has two different limits.**
  `npm test -- --project downloader` on this 12-core machine took 84.3 s when it
  ran alone through the gate (11 workers). With other agents' vitest runs on the
  machine it took 104.2 s and 101.9 s. Run alone, one file sets the wall clock:
  `engine/test/parallel-ranges.test.ts`, 72 to 78 s on one worker, 43 tests run
  in sequence. In the two loaded runs it finished last by 18 to 20 s. On CI no
  single file sets it. The ubuntu `npm test` step (every project, four workers)
  took 231 s against 726 s of summed test time, and no file ran longer than
  73 s. So CI time follows the summed time: each second of test time removed
  saves about a quarter of a second on CI.
- **The browser tests are the biggest share of that summed time.** The six
  `browser-resolver-*.test.ts` files plus `consent-scope.test.ts` ("the seven
  browser files" below) took 325 s of the project's 659 s in the quiet run, and
  318 s of the downloader's 608 s on CI's ubuntu leg. All of
  `resolvers/test/browser/` took 352 s.
- **Most of each probe is fixed waiting that no test could change.** The
  middle probe takes 2.0 s. Of the 147 tests in the seven browser files, 68 take
  1 to 2 s and 62 take 2 to 3 s. dl-115 measured
  where the time goes: about 510 ms is page load plus `LANDING_URL_SETTLE_MS`
  (500 ms), about 1000 ms is two provocation passes with a fixed 900 ms sleep
  between them (`provokePlayback` in `src/browser/provoke.ts`), and the rest
  is the quiet wait. dl-115 made the quiet wait settable for tests that
  expect a stream. **The two fixed sleeps stayed, by the owner's ruling of
  2026-10-12.** The owner re-read that ruling on 2026-10-18 (Decision A,
  below): a test may now shorten both, under the rule in the Build.
- **Each file's own Chromium costs nothing measurable once the machine is
  warm.** The first test in six of the seven files takes 2.0 to 2.3 s, about
  the same as the middle test (1.3 to 2.8 s); `-capture`'s first test is not
  a probe. The cold-start case is dl-117's
  gate 1 F2, and the owner chose to record it and change nothing.

## Build

The steps below are the trims, one for each kind of wait the Log found, shaped
by the owner's answers under the Decision section.

**Which tests may change their waits (Decision A).** A test may take the
shortened sleeps of step 2 only when it **expects a stream whose player mounts
at once**: it asserts a captured stream, and its fixture puts the player on the
page without a timer, an input or a late mount. Every other test keeps both
sleeps at their production values: a test that expects `NO_MEDIA_FOUND`, an
error, or something left unpressed or unrequested (dl-115's negative tests); a
test whose fixture mounts the player or a layer late; and every test in the
floor list below.

**One rule covers every step.** A test that proves a product floor or a
product cap keeps its real wait, its fixture's timing and its assertion:

- `parallel-ranges.test.ts` › "a job that measures slow switches to 4
  connections and finishes at least 3x faster" (dl-98, dl-127; 11.1 s);
- `browser-resolver-departure-and-floor.test.ts` › "captures an HLS player that
  attaches after 6 seconds with extended floor" and "a budget shorter than the
  floor plus page load ends TIMEOUT, at the deadline, not NO_MEDIA_FOUND past
  it" (dl-80; 6.6 s and 4.0 s), "a wall clock stepped back before the wait does
  not read as a floor that returned early" (dl-105; 4.7 s), and "a resolver
  given no minWaitMs hands the wait MIN_WAIT_MS, and holds it that long"
  (dl-115; 2.8 s);
- `browser-resolver-capture.test.ts` › "a body the page never reads is
  abandoned at settle()'s cap, and the probe still answers" (dl-111,
  `SETTLE_TIMEOUT_MS`; 5.0 s);
- `browser-resolver-age-gate.test.ts` › "meets a modal and a gate that mount
  after the playback passes are over" (dl-48, the overlay revisit; 9.8 s);
- the dl-55 tests that prove the 500 ms landing settle (the "surface click
  chooses the player, not a related-video card" describe in
  `browser-resolver-departure-and-floor.test.ts`), and the fixtures timed
  against the two sleeps: `consent-scope.test.ts`'s r5 (revealed at 1.2 s) and
  r5b (6 s), which dl-113 said not to retime.

Together these take about 50 s of test time, and none of it is to be
recovered.

1. **Measure first, in one session, on a warm cache.** Run
   `npm test -- --project downloader --reporter=default --reporter=json
--outputFile.json=<scratch>/<tag>.json` three times before any change. For
   each run, record the gate's `test-gate:` line, the number of other vitest
   workers on the machine at the start (`ps -eo args | grep -c
'[w]orkers/forks.js'`) and the load average at the start and the end.
   Throw away the first run in a fresh worktree. With no
   `node_modules/.vite/vitest/<hash>/results.json` yet, vitest orders the
   files by size, so the longest browser files start 13 to 45 s late (the Log's
   run 1). The machine is shared and the wall clock swings by 20 s with
   other agents' runs (84 to 104 s in the Log), so **alternate the before-runs
   and the after-runs** (before, after, before, after, before, after) and
   run the base in a second tree, as `common.md` describes. The figure that
   is graded is the summed file time from the JSON report (`endTime -
startTime` per file), which load moves less than the wall clock.
2. **The two fixed sleeps** (Decision A). Add two options to
   `BrowserResolverOptions`, shaped like `minWaitMs` (dl-115): one for the
   landing settle (default `LANDING_URL_SETTLE_MS`, 500, in
   `src/resolvers/browser.ts`) and one for the sleep after pass 0 in
   `provokePlayback` (`src/browser/provoke.ts`, today the literal `900` in
   `sleep(budget(options.deadline, 900), ...)`; name it as a constant if that
   helps the pin). Pin both defaults with a test that fails if either changes.
   Production callers pass neither. Use them only in the tests the eligibility
   rule above admits, and list those tests in the Log. Choose values at or
   above the 200 ms tick of the wait loop. Show that the overlay revisit still runs in
   every test that depends on it, as dl-115 did. The 68 tests in the 1-2 s
   band are where this applies. Estimated gain, not measured: 0.8 to 1.2 s on
   each eligible probe, so 50 to 80 s of summed time. That is about 12 to 20 s
   of CI's ubuntu wall clock and nothing locally while `parallel-ranges.test.ts`
   still sets it.
3. **Stream-expecting tests still on the base wait.** Sweep the seven files for
   tests that expect a stream and still pass `quietMs: 1200`, `BASE_WAITS` or no
   waits, and give them `STREAM_WAITS`. By name, the tests in the 2-3 s band are
   nearly all negative ("is not pressed", `NO_MEDIA_FOUND`,
   `AGE_CONFIRMATION_REQUIRED`), so this step should find few. No gain is
   claimed for it, and the Log must say how many tests it moved.
4. **The F9 pair's fixed sleep becomes a poll** (Decision B). In
   `parallel-ranges.test.ts`, `pausedThenRead` (used by the two "F9" tests,
   6.3 s and 6.1 s) waits `sleep(4_000)`, "long enough for the loopback's
   buffers to fill and the pause to engage". Replace it with a poll on a
   condition that says the pause has engaged, for example the file's own
   `until` helper waiting for `feeder.stats().deliveredBytes` to stop growing
   for a few hundred ms, with a bound no longer than today's 4 s. The
   assertions after the wait do not change. dl-120 tuned this fixture after
   flakes, so run each F9 test at least ten times before and ten times after,
   under the load the machine has, and record the pass counts.
5. **Split `parallel-ranges.test.ts`** (Decision B), dl-117's way: along its
   `describe` blocks, moving code, not tests, with the shared fixture in a
   helper and each file owning its own servers. Keep the describe "dl-98: a
   progressive source throttled per connection", which holds the 3x floor,
   whole in one file. Check each moved body with `git diff --color-moved`.
   With the cache warm, the next file to finish ended 18 to 20 s before
   `parallel-ranges.test.ts` (the Log's runs 2 and 3), which bounds what the
   split can save locally.
6. **Re-measure the 3x floor after the split** (Decision B). dl-127 measured
   the ratio beside the whole suite: 40 of 40 runs at or above 3.399. Run "a
   job that measures slow switches to 4 connections and finishes at least 3x
   faster" at least ten times after the split, beside the whole project as
   dl-127 did, logging `singleMs`, `splitMs` and the ratio of every run with
   dl-127's method (an uncommitted scratch copy that prints them). Record the
   count, minimum, median and maximum in the Log. The floor stays 3 on Linux
   and 2.5 on Windows. A run below 3 is a stop: report it, do not lower the
   floor.
7. **Not in scope:** the 1200 ms base wait in negative tests (dl-115, the
   owner's rule), fake timers in browser tests (dl-115: Node, Playwright and
   Chromium timers are mixed), a pool warm-up for a cold Chromium (dl-117,
   recorded only), and the file order in a fresh worktree or on CI. That
   last one is the farm's and CI's results cache, a `repo-` matter, and was
   left alone (the Log's 2026-10-18 round 2 entry).

## Decision — answered 2026-10-18 by Bruno Labbé

Both questions were put to the owner by the owner's Fable 5.1 session with
`AskUserQuestion`, using the options below as filed. The owner chose the
recommended option for each.

**A — chosen: "allow it, defaults pinned" (option 1, recommended).** A test may
shorten the 500 ms landing settle and the 900 ms sleep between provocation
passes only when it expects a stream whose player mounts at once. The
production defaults stay as they are, pinned by a test. The other option
offered was "keep the ruling as written" (option 2).

**B — chosen: "handle it in dl-129" (option 1, recommended).** The F9 pair's
fixed `sleep(4_000)` becomes a poll, and `parallel-ranges.test.ts` is split
dl-117's way, keeping the 3x-floor describe whole and re-measuring the floor
at least ten times (Build steps 4 to 6). The other options offered were "a
separate ticket" (option 2) and "leave it" (option 3).

## Decision note — answered 2026-10-20 by Bruno Labbé

**C — chosen: "CI binds, local supports" (option 1, recommended).** Asked on
2026-10-20 by the orchestrator (session tools-11) with `AskUserQuestion`:
"How should dl-129's timing lines be proven? Done when 2 (local ≥15 % drop)
reads machine load as much as code, and two peer batches are loading the
machine now." Done when 8 (CI ubuntu, at most 85 % of 318 s) is the timing bar.
Line 2's local before/after runs are logged as supporting evidence with the
concurrent load noted (test-gate line, foreign workers, load average, which
line 1 already asks for) and are not failed on load. Lines 5 and 7 are pass
counts, not timings, and load only makes them harsher, so they bind as
written. The other options offered were "Local, only when quiet" (option 2,
line 2 binds as written and waits for the machine to go quiet) and "Reword
line 2 now" (option 3, drop the local 15 % bar). This re-confirms the same
owner's answer given in another session on 2026-10-19 ("CI ubuntu leg binds",
chosen over "Local, only when quiet"), which was never written to the ticket.
No Done when line was edited.

The question and options as filed for A and B, kept for the record:

**A. May a test shorten the two fixed sleeps that every probe pays?** dl-115
records the owner's 2026-10-12 ruling: "The two sleeps above stay: dl-55 (tests
407 and 418) proves the 500 ms, and the 900 ms covers players that mount
late." That sentence sits next to a change that left the production default
unchanged and made the quiet wait settable from tests. It can be read as
"the defaults stay" or as "no test may shorten them". The builder must not
pick a reading.

1. **Allow it, for tests that expect a stream and whose player mounts at
   once** (recommended). The defaults stay unchanged and pinned. dl-55's
   tests, the late-mount fixtures and every negative test keep both sleeps.
   Estimated 50 to 80 s of summed time, about 12 to 20 s on CI's ubuntu step
   per push. Cost: two resolver options, the same seam dl-115 added, and a
   per-test judgement, which is why this ticket is `standard`.
2. **Keep the ruling as written.** Step 2 is dropped. Steps 1 and 3 remain,
   and step 3 claims no seconds. Without step 4 this ticket buys too little
   to justify a build, and the honest move would be to drop it.

**B. `parallel-ranges.test.ts`, the file that sets the local wall clock.**

1. **In this ticket, as Build step 4** (recommended). It is the one change
   that moves the local alone-on-the-machine wall clock, by up to 18 to 20 s
   on the Log's runs. It also cuts about 5 s from the F9 sleeps, and those
   are on the critical path. Cost: dl-117's kind of move plus a re-measure of
   the 3x floor.
2. **A separate ticket.** This one stays on the browser tests, and the local
   wall clock stays at about 75 to 84 s until that ticket lands.
3. **Leave it.** Locally the project stays bound by one 72-78 s file. CI is
   not affected, because CI time follows the summed time.

## Done when

1. The Log holds the three before-runs and three after-runs of Build step 1,
   alternated, with each run's command, `test-gate:` line, foreign workers at
   start, load average, vitest `Duration`, and summed file time for the seven
   browser files and for `parallel-ranges.test.ts` from its JSON report.
2. The mean summed file time of the seven browser files over the three
   after-runs is at least 15 % below the mean over the three before-runs (325 s
   in the Log's quiet run 1; 353 s and 361 s in its loaded runs).
3. The two production defaults are unchanged: `LANDING_URL_SETTLE_MS` in
   `src/resolvers/browser.ts` is still 500, and the sleep after pass 0 in
   `provokePlayback` (`src/browser/provoke.ts`, the literal `900`, or the
   constant the builder names for it) is still 900. Neither new
   `BrowserResolverOptions` field is passed by any production caller. A test
   fails when either default changes; the Log shows it failing under a
   mutation of each.
4. Every use of the two new options is in a test that expects a stream whose
   player mounts at once. The Log lists each such test, and none of them
   expects `NO_MEDIA_FOUND`, an error, or something left unpressed or
   unrequested.
5. The F9 pair in `parallel-ranges.test.ts` no longer calls `sleep(4_000)` in
   `pausedThenRead`; it polls instead, and its assertions are unchanged. Each
   F9 test passes at least ten runs out of ten after the change, with the
   before and after pass counts and durations in the Log.
6. `parallel-ranges.test.ts` is split along its `describe` blocks, every moved
   body unchanged by `git diff --color-moved`, the describe "dl-98: a
   progressive source throttled per connection" whole in one file, and the
   project's `Tests` count the same before and after. No downloader test file
   runs longer than 60 s in any of the three after-runs' JSON reports.
7. The 3x floor test ran at least ten times after the split, beside the whole
   project; the Log holds every run's ratio with its count, minimum, median
   and maximum, and the floor in the spec is still 3 on Linux and 2.5 on
   Windows.
8. CI: the PR's own `test (ubuntu-latest)` log shows the seven browser files'
   summed time at most 85 % of 318 s (run 39126762378 at `335efcd4`). Report
   the `npm test` step time on both legs with run ids, but do not grade it.
   CI's main runs at four workers spread from 232 to 273 s (repo-99), wider
   than the 12 to 20 s this ticket expects to save.
9. No test in the Build's floor list has changed its wait, its fixture's timing
   or its assertion: `git diff` of those test bodies shows nothing but a move.
10. `npm run check` passes, and `npm test -- --project downloader` passes in
    all three after-runs.

## Log

- 2026-10-18 — Filed by an Opus 5.5 agent dispatched by the owner's session,
  measured at `335efcd4` (`origin/main`), vitest 4.1.10, on this 12-core
  machine (`nproc` 12).
  **Config read** (`vitest.config.ts`): project `downloader` includes
  `tools/downloader/*/test/**/*.test.{ts,tsx}`, `testTimeout` and
  `hookTimeout` 60 000, no `pool`, `fileParallelism` or `maxWorkers` of its
  own, so vitest's defaults hold: forks, files run in parallel, and tests
  within a file run one after another. Root `maxWorkers` is 4 only under `CI`
  (repo-99). Locally the gate sets `VITEST_MAX_WORKERS`. Every run below
  printed `test-gate: slot-0, 1 of 2 runs active (...): 11 workers`. All three
  runs were gated, and no ungated run was made. The project's default
  reporter prints a duration per file, but the per-test times and the file
  start and end offsets come from a JSON report written in the same run
  (`--reporter=default --reporter=json --outputFile.json=...`).
  **Local runs**, `npm test -- --project downloader` plus those two reporters,
  each `Test Files 124 passed | 1 skipped (125)`,
  `Tests 2590 passed | 2 skipped (2592)`:

  | run | cache                 | foreign vitest workers at start | load start → end | `Duration` | summed file time | seven browser files | `parallel-ranges.test.ts` |
  | --- | --------------------- | ------------------------------- | ---------------- | ---------- | ---------------- | ------------------- | ------------------------- |
  | 1   | none (fresh worktree) | 0                               | 10.97 → 9.02     | 84.30 s    | 658.9 s          | 324.7 s             | 71.9 s, +2.8 to +74.6     |
  | 2   | warm                  | 4                               | 8.88 → 21.43     | 104.16 s   | 851.0 s          | 352.9 s             | 78.0 s, +3.3 to +81.4     |
  | 3   | warm                  | 12                              | 13.87 → 21.30    | 101.88 s   | 826.1 s          | 361.0 s             | 78.2 s, +5.9 to +84.1     |

  The foreign workers belonged to two lg-59 gates running ungated
  single-file `vitest run`s, 12 CPU-bound forks at once, for over 30 minutes.
  The gate cannot see those runs, and nothing waited for them to finish.
  Only run 1 is near-quiet. Slowest files, run 1: `parallel-ranges.test.ts`
  71.9 s (43 tests), `browser-resolver-press-targets` 54.0 s (22),
  `-consent-and-links` 51.0 s (22), `-player-input` 50.3 s (22), `-capture`
  44.8 s (25), `-age-gate` 44.3 s (16), `-departure-and-floor` 42.2 s (17),
  `consent-scope` 38.1 s (23), `engine/test/stream.test.ts` 38.0 s (98),
  `api/test/manifest-refetch.test.ts` 29.7 s (16). The six
  `browser-resolver-*` files ran all six at once in every run. In run 1 they
  started between +13.3 and +34.0 s, and `consent-scope` started at +45.5 s
  and was the last file to end, at +83.6 s. In runs 2 and 3 (warm cache) all
  seven started between +2.3 and +6.2 s, and `parallel-ranges.test.ts` ended
  last, 20 s (run 2) and 18 s (run 3) after the next file.
  `resolvers/test/browser/` as a whole: 352.0, 384.0 and 392.2 s.
  **Per-test, run 1, the seven browser files:** 147 tests, 327.2 s, median
  1.99 s. 7 take under 1 s, 68 take 1-2 s (117.3 s), 21 take 2-2.5 s (44.7 s),
  41 take 2.5-3 s (114.8 s), 3 take 3-4 s, 5 take 4-6 s (22.5 s) and 2 take
  6 s or more (16.4 s). The first test of six files took 2.00 to 2.33 s
  (`-capture`'s first, 0.00 s, launches no probe) and
  each file's middle test 1.28 to 2.76 s, so a warm Chromium launch per file
  adds nothing measurable. The 2.5-3 s band, read by name, is almost all
  negative tests (`NO_MEDIA_FOUND`, `AGE_CONFIRMATION_REQUIRED`,
  `AUTH_REQUIRED`, "is not pressed"). Spot-checked: "ctl=%s is a press that
  counts, so the box is not clicked" expects `NO_MEDIA_FOUND`.
  **CI**, `gh run list --branch main --limit 15` then
  `gh run view 39126762378 --json jobs` (the `CI` workflow, push at
  `335efcd4`, unit matrix run) and `--job <id> --log`:
  - ubuntu: `Run npm test` 12:20:09 to 12:24:00, 231 s. `Duration 230.63s
(... tests 726.14s)`, `Tests 6071 passed | 2 skipped (6073)`. Summed
    file time by project: downloader 608 s, ledger 46, repo 46, planner 22,
    core 3. The seven browser files took 318.1 s (six 277.8 + consent-scope
    40.3). Slowest files: `parallel-ranges.test.ts` 72.7 s, press-targets
    52.2, consent-and-links 49.2, player-input 48.7, age-gate 44.9, capture
    42.4, departure-and-floor 40.3, consent-scope 40.3, `stream.test.ts`
    34.4, `manifest-refetch.test.ts` 26.4. The last downloader file ended at
    12:23:18. `consent-scope` started about 12:22:38, so it was queued late.
    The run ended on `scripts/test/review-record.test.ts` at 12:24:00.
  - Windows (informational): `Run npm test` 12:20:18 to 12:26:46, 388 s.
    `Duration 385.73s (... tests 1062.38s)`,
    `Tests 6012 passed | 61 skipped (6073)`. Downloader 706 s, repo 226 s.
    The seven browser files took 339.6 s. Slowest file
    `scripts/test/review-record.test.ts` 105.5 s, then
    `parallel-ranges.test.ts` 75.6 s.
    **Waits, by kind**, the seconds from run 1:
  - _Product floors and caps, keep_: the Build's list, about 50 s of test time
    (11.1 + 6.6 + 4.0 + 4.7 + 2.8 + 5.0 + 9.8, plus the dl-55 and r5/r5b
    tests at their probe cost).
  - _Fixed sleeps every probe pays, protected by the owner's dl-115 ruling_:
    500 ms landing settle (`waitForPageLoad` in `src/resolvers/browser.ts`)
    and the 900 ms sleep after pass 0 in `provokePlayback`. About 1.4 s across
    147 probes is roughly 200 s of the seven files' 327 s. That figure is
    inferred from dl-115's phase table and not measured per test.
  - _The 1200 ms base wait in negative tests, owner-protected (dl-115)_: about
    62 tests in the 2-3 s band. Keep.
  - _Incidental, outside the browser files_: `parallel-ranges.test.ts`'s F9
    `sleep(4_000)` in `pausedThenRead`, 12.4 s for the pair, on the local
    critical path. Others seen and not classified here: `stream-link.test.ts`
    › "an error after the first byte aborts the connection with the code on
    the job" 9.4 s (dl-112 already shortened it), and
    `manifest-refetch.test.ts` 29.7 s over 16 tests.
  - _No fake timers anywhere in the browser files_: by design, per dl-115.
    **File order** (recorded, not in scope): vitest 4.1.10's `BaseSequencer.sort`
    runs failed files first, then longer files first from
    `node_modules/.vite/vitest/<hash>/results.json`. With no cache, it runs
    larger files first. `worktree-farm.sh` gives each worktree a fresh
    `node_modules` with no `.vite`. This worktree's `.vite` was created by run
    1, at 22:56. So every builder's, gate's and lander's first run, and every
    CI run, orders the files by size. That cost run 1 about 9 s against the
    critical-path file. A shared results cache is a `repo-` change.
    **Difficulty `standard`:** every step needs a judgement about what a test
    may stop proving: which tests count as expecting a stream with an
    immediately mounted player, and whether a polled condition proves what a
    fixed F9 sleep proved. dl-115, which made the same kind of change, was
    `standard`. The decisions are rated at their recommended options.
    **`needs-decision`:** the dispatch said `ready`, but `docs/01-TICKETS.md`
    fails a `## Decision — open` heading on any status other than
    `needs-decision`. Decision A re-opens a ruling the owner made, which the
    builder must not settle.

- 2026-10-18, round 2 — The owner, Bruno Labbé, answered Decisions A and B.
  The owner's Fable 5.1 session asked with `AskUserQuestion` and relayed the
  answers to the filing agent (Opus 5.5). Both are the recommended options:
  A, "allow it, defaults pinned"; B, "handle it in dl-129". The answers, with
  the options they were chosen from, are under
  `## Decision — answered 2026-10-18 by Bruno Labbé`. `status` moved from
  `needs-decision` to `ready` in this commit. The Build now gives A's
  eligibility rule ("expects a stream whose player mounts at once") as the
  test for which tests may change, and adds B's poll, split and ten-run
  floor re-measurement as steps 4 to 6. Done when now names the two
  production defaults (`LANDING_URL_SETTLE_MS` and the 900 ms sleep in
  `provokePlayback`) and has a line for each of B's steps. `difficulty`
  stays `standard`, and no source changed.
- 2026-10-18, round 2 — The vitest duration cache in a fresh worktree and on
  CI (the "File order" note above) was left alone, with no `repo-` ticket
  filed. The owner's Fable session chose this on the filing agent's
  recommendation. It was not put to the owner.

- 2026-10-20 — Build started on branch `dl-129-trim-browser-sleeps` from
  `origin/main` 00977771. The owner's answer C (CI binds, local supports) is
  recorded under `## Decision note — answered 2026-10-20 by Bruno Labbé`; no
  Done when line was edited. `status` was already `ready`.
