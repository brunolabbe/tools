---
id: repo-99
tool: repo
title: CI runs vitest on three workers for a suite that spends most of its time waiting
kind: chore
status: ready
milestone: null
depends_on: [dl-117]
difficulty: mechanical
---

# repo-99 — CI runs vitest on three workers for a wait-bound suite

## Why

On 2026-10-12 the owner asked why CI's unit-test job takes more than 10 minutes.
The downloader side of the answer is
[dl-111](../../tools/downloader/docs/work/dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md)
to dl-117. This ticket is the scheduling side.

vitest's default worker count in run mode is `availableParallelism() - 1`. That
was read in vitest 4.1.10's `getDefaultThreadsCount`, in
`node_modules/vitest/dist/chunks/cli-api.*.js`. On the 4-vCPU `ubuntu-latest`
runner that means **three workers**. Run 38203804906's summary reports
`tests 1239.49s` of summed test time, so even perfectly balanced, three workers
cannot finish in much under 410 s. The suite is mostly waiting: a local run of
27 browser probes kept about 0.6 of a core busy, measured machine-wide, so that
figure is an upper bound. Timers, sockets and child processes dominate the
rest (see dl-112 and dl-116).

**The owner's constraint, and the choice (2026-10-12).** An orchestrator runs
several reviewer agents at once on one machine, so local runs must not take
more CPU. A CI runner hosts one job, so it can. The decision: **more workers on
CI only**. Local runs keep vitest's default.

## Build

1. In the root `vitest.config.ts`, set `maxWorkers` only when `process.env.CI`
   is set, to about 6 to start with. Leave it unset otherwise. A comment says
   why: CI-only, for wait-bound suites, and never on a shared developer machine.
   - Check how vitest 4 takes the setting for a `projects` config. It may need
     to sit at the root `test` level, not per project.
   - Check that `CI` is set on both legs. GitHub Actions sets `CI=true` on
     Windows and Linux runners, but confirm it from a run's environment rather
     than from this sentence.
2. Measure it on the PR's own CI run. Note `npm test`'s duration on both legs
   against the latest `main` run with the same suite, and adjust the number
   once.
   - The Windows leg (informational) spawns processes far more slowly; repo-71
     and repo-89 are the history. Watch it for new timeouts. Read it with
     `gh pr checks`, not `gh run list`.
3. If more workers make any test flaky, record which one and why. Lower the
   number before excluding the test; do not paper over it.

## Done when

1. `maxWorkers` changes only under `CI`, and a local `npm test` uses vitest's
   default. Proof: the config read back, or a printed resolved config.
2. The Log records CI's `npm test` duration on both legs before and after, with
   run ids.
3. Neither leg gains a new timeout or failure across the PR's run and the first
   `main` run after merge.

## Log

- 2026-10-12 — Filed from the suite-speed audit. Independent of the downloader
  tickets: more workers help now and help more once dl-117 splits the long file.
  Its measurement is cleanest if it lands either before dl-117 or after it, not
  in the same batch.
- 2026-10-12 — Built in draft PR #437 (head `16e62e25`, then this commit). Done
  when 1: root `test.maxWorkers` is 6 only when `CI` is set. Resolved config,
  from vitest 4.1.10's `createVitest` in the worktree: without `CI` the root
  value is `null` and a 14-suite probe ran on `VITEST_POOL_ID` 1 to 11
  (`availableParallelism` 12, so cores - 1); with `CI=1` the root value is `6`
  and the same probe ran on ids 1 to 6 only. Projects read `null` in both, and
  vitest's `resolveMaxWorkers` falls back to the root, which is why the setting
  sits there. Done when 2: `CI=true` and `availableParallelism()` 4 on both
  legs (run 38262465552). Before is `f52848a4`'s push run 38252453296, because
  `bb4d2044` is ticket files only and its matrix skipped on `changes`:
  `npm test` ubuntu 623 s (vitest Duration 622.08 s, summed test time 1237.68 s),
  Windows 626 s (Duration 625.87 s). After, run 38262465552 at `16e62e25`:
  ubuntu 626 s (Duration 625.93 s, summed 1328.40 s); Windows 639 s (Duration
  638.00 s) with one failure; `gh run rerun --failed` on Windows, attempt 2,
  656 s (Duration 654.15 s), passing.
- The wall clock is one file, not the worker count. The slowest file on every
  leg is `tools/downloader/resolvers/test/browser/browser-resolver.test.ts` (182
  tests): ubuntu 618.9 s before, 622.0 s after; Windows 623.3 s before, 633.8 s
  after (attempt 1) and 648.9 s (attempt 2). Three workers already run the other
  files in its shadow, so six have nothing to shorten. The Why's "three workers
  cannot finish in much under 410 s" is a bound on summed time; the real floor
  is that file's ~620 s on one worker. "More workers help now" does not hold:
  ubuntu is unchanged and Windows is 2 to 4 per cent slower, because
  oversubscribing four vCPUs slows that file too. This is the number dl-117
  unlocks, not this change.
- Done when 3, flake: Windows attempt 1 failed
  `tools/downloader/engine/test/parallel-ranges.test.ts`, "dl-98: the feeder's
  own limits", "bytes held ahead never exceed 4 x 4 MB, measured at the defaults
  with ffmpeg not reading", with `AssertionError: expected 'fallen-back' to be
'parallel'`. The test's own comment names the mechanism: a 50 ms throughput
  window falls back when four connections are not 1.5 times one that the CPU
  already limits. Attempt 2 passed (the file took 110.9 s). Not reproduced on
  Linux. One failure in two Windows attempts at six workers; the three-worker
  baseline has one pass. The number is not lowered and the test is not
  excluded; that choice is open and sits with the orchestrator.
- Not met before merge: the first `main` run after merge (Done when 3, second
  half) cannot exist yet; it is an `awaiting` row at landing. Not ticked.
- Not folded in: nothing this change makes free is small enough to fold. The
  split of `browser-resolver.test.ts` is dl-117's, and the speed-up waits on it.
- 2026-10-12 — The owner decided the open question above, relayed by the
  orchestrator. Question: what happens to PR #437, given that six workers
  measured no faster because `browser-resolver.test.ts` sets the wall clock.
  Options offered: hold behind dl-117 (recommended); land at six as specified;
  fold into dl-117; lower to four and re-measure. Chosen: **hold behind dl-117**.
  Consequences: `depends_on` now names dl-117; the `maxWorkers` change is
  reverted, so the branch's only net change is this ticket file; the
  measurements above stay here as the record for whoever measures the number
  once dl-117 has split the file. `status` stays `ready`, so the ticket reads as
  blocked by its dependency rather than done.
- 2026-10-17 — The owner answered the open choice above, asked through
  AskUserQuestion on 2026-10-17. Question, verbatim: "repo-99: dl-117 has now
  split the long file, so six CI workers can be measured for real. The open
  point is the Windows flake in parallel-ranges.test.ts (dl-98 feeder limits: 1
  failure in 2 Windows attempts at six workers). What should the builder do?"
  Options offered: **"Measure at 6, report, then decide"** (recommended), which
  sets `maxWorkers` to 6 under `CI`, takes before and after CI runs on both legs
  once dl-117 is in, and reports the durations and any flake before landing;
  **"Land at 6 as the brief says"**, which builds to Done when as written and
  files a recurring Windows flake as a new ticket rather than blocking; and
  **"Lower to 4 and measure"**, which matches CI's 4 vCPUs. Chosen: **"Measure
  at 6, report, then decide"**. dl-117 is done, merged as #499 on 2026-10-17, so
  `depends_on` is satisfied and the ticket is no longer blocked. `status` stays
  `ready`. For whoever builds it next: the `maxWorkers` change reverted with the
  hold above has to be applied again. Set it to 6 under `CI` only, measure
  `npm test` on both CI legs against the latest `main` run of the same suite,
  and report the durations with their run ids, plus any flake and the test it
  names, before landing. The owner picks the number and whether to land from
  those figures; the builder does not choose either.
- 2026-10-17 — Built at the owner's answer above: `maxWorkers` is 6 under `CI`
  only, at the root of `vitest.config.ts`, in `4d72b248`. Draft PR #514, head
  `4d72b248`, `mergeTree` probe conflicts with #513 (see below). Done when 1:
  the resolved config from `createVitest` (vitest 4.1.10), read back in both
  states. Unset, `CI` absent: root `test.maxWorkers` is `undefined` and every
  project's is `undefined`. `CI=1`: root `6`, projects `undefined`. Done when 2:
  the `npm test` step, read per leg with `gh run view <id> --json jobs`, and
  the vitest `Duration` line from `--job <id> --log`.
  - Baseline is `main` at `6b42ee19`, run 39058961193, the latest push run
    whose unit jobs ran on both legs (`9e157902`'s run 39048517864 is the
    earlier one; `b9f01370`, `8e50f0d4`, `38e9b541` and `99e7f72d` skipped
    their unit matrix; `2ec0be09`'s run was cancelled). Same tests as the
    PR: 5819, 285 files. Two reruns were taken on it, one per leg, so its
    figures rest on two samples per leg, not one.
  - `npm test`, `main` `6b42ee19` (no `maxWorkers`): ubuntu 274 s (attempt 1,
    18:40:47 to 18:45:21) and 266 s (attempt 3, 19:08:36 to 19:13:02); Windows
    472 s (attempt 1, 18:41:09 to 18:49:01) and 428 s (attempt 2, 18:57:04 to
    19:04:12).
  - `npm test`, PR #514 run 39059607797 at `4d72b248` (`maxWorkers` 6): ubuntu
    222 s (attempt 1, 18:48:09 to 18:51:51) and 229 s (attempt 2, a rerun of
    the ubuntu leg, 18:56:33 to 19:00:22); Windows 363 s (attempt 1, 18:48:17 to
    18:54:20) and 304 s (attempt 3, a rerun of the Windows leg, 19:02:04 to
    19:07:08). The vitest Duration lines are 221.26, 228.05, 356.65 and 303.19 s,
    within 7 s of the step times above.
  - Means: ubuntu 270 s to 226 s (about 16 per cent less); Windows 450 s to 334 s
    (about 26 per cent less). Each side's two samples do not overlap on either
    leg, but two samples a side is thin, and the spread on Windows is wide: the
    earlier `main` run `9e157902` (run 39048517864, 5772 tests, a smaller tree)
    measured 359 s on Windows, inside the PR's range, and 262 s on ubuntu.
  - Summed test time rose on ubuntu with six workers, 670 s on `main` against
    894 s and 912 s on the PR: each test runs slower while sharing four vCPUs.
    The wall clock still fell.
  - Done when 3, the flake: none. All four PR attempts passed on both legs. The
    test named on 2026-10-12, `parallel-ranges.test.ts` ("dl-98: the feeder's
    own limits"), passed on Windows attempt 1 (80.9 s) and attempt 3 (77.0 s),
    and on ubuntu attempt 2 (77.2 s). The 2026-10-12 Windows failure does not
    recur in two Windows attempts at six workers, which is two samples, not a
    rate. The first `main` run after merge is still owed (Done when 3, second
    half), so Done when 3 stays unticked.
  - What the brief had wrong, after dl-117: the slowest file is no longer the
    one that set the wall clock. On the PR, the slowest file on ubuntu is
    `tools/downloader/engine/test/parallel-ranges.test.ts`, 77 s, and on Windows
    it is `scripts/test/review-record.test.ts`, 111 s (attempt 3). The "~620 s
    one-file floor" and "three workers cannot finish under 410 s" lines describe
    the suite before dl-117 and no longer hold.
  - `CI=true` on this run is not re-read here: no step in `ci.yml` prints the
    environment, and the 2026-10-12 entry's reading (run 38262465552) is the
    only one. The ubuntu leg's six-worker effect on summed time is consistent
    with it, but that is an inference, not a reading.
  - `mergeTree` in `npm run preflight` conflicts with #513 (`log-2026-10-17-pl-56`)
    on `.claude/skills/orchestrate-tickets/reference/history.md`. That file is
    not touched by this branch: #513's base predates `fff14d54` (#512), which
    edits the same file on `main`, so the conflict is #513's to resolve. The
    rest of preflight passes at `4d72b248`: `npm run check` and `npm test` ok,
    `ciCommands` ok, `review` ok, `title` ok (`ci` is hidden in
    `release-please-config.json`).
- 2026-10-17 — Correction to the entry above, on Done when 3, the flake. It
  says "none", which holds for the four attempts on `4d72b248` and no others.
  The Log commit `761ceba7` pushed the same config under a docs-only change;
  its diff against `main` still carries `vitest.config.ts`, so the unit matrix
  ran (PR run 39061881142, attempt 1). Windows failed on the same test the
  2026-10-12 entry names: `tools/downloader/engine/test/parallel-ranges.test.ts`,
  "dl-98: the feeder's own limits" > "bytes held ahead never exceed 4 x 4 MB,
  measured at the defaults with ffmpeg not reading", `AssertionError: expected
'fallen-back' to be 'parallel'`. Vitest's summary on that leg: `Test Files 1
failed | 282 passed | 2 skipped (285)`, `Tests 1 failed | 5757 passed | 61
skipped (5819)`. The leg is informational, so the run's conclusion reads
  `success`. Its `npm test` step ran 378 s (19:19:40 to 19:25:58). The ubuntu
  leg of the same run passed in 231 s (19:19:44 to 19:23:35), a third ubuntu
  sample at six workers beside 222 s and 229 s.
- Windows flake, counted at six workers on the PR's config: 2 failures in 5
  attempts. 38262465552 (2026-10-12, the earlier draft, same setting) failed
  attempt 1 and passed attempt 2; 39059607797 passed attempts 1 and 3; 39061881142
  failed attempt 1. At the three-worker default on `main`: 0 failures in 3
  attempts (39048517864 attempt 1; 39058961193 attempts 1 and 2). These are
  the attempts this ticket has read, not a sample from a controlled run, and
  the ubuntu leg passed every attempt on both settings. The test's own comment
  names the mechanism: a 50 ms throughput window falls back when four
  connections are not 1.5 times one that the CPU already limits, and six
  workers share four vCPUs on Windows. Done when 3 is therefore not met for the
  Windows leg at six workers. The number is not lowered and the test is not
  excluded here, as Build step 3 requires; both choices sit with the owner.
- 2026-10-17 — The head's own run, read after the correction above: PR run
  39062702374 at `1b680c5c`, attempt 1, both unit legs. Ubuntu `npm test` 235 s
  (19:30:55 to 19:34:50), passed. Windows `npm test` 362 s (19:31:01 to
  19:37:03), Duration 360.73 s, `Tests 5758 passed | 61 skipped (5819)`, and
  `parallel-ranges.test.ts` passed in 81.1 s. Six-worker tally, Windows: 2
  failures in 6 attempts, the last one a pass. Ubuntu at six workers, four
  samples: 222 s, 229 s, 231 s and 235 s, against 274 s and 266 s on `main`.
  Done when 3 is still not met on the Windows leg, for the reason in the
  correction above.
- 2026-10-17 — The owner answered the open decision in the 2026-10-17 entry
  above, relayed by the orchestrator, from AskUserQuestion. Question: the
  six-worker Windows leg failed `parallel-ranges.test.ts` in 2 of 6 attempts
  (the entry above), so what should the number be before landing. Options
  offered: **"Lower to 4, re-measure"** (recommended), which sets `maxWorkers`
  to 4 under `CI` and measures both legs again against the same `main`
  baseline; **"Land at 6, file the flake"**, which lands the six-worker setting
  and files the Windows flake as a new ticket; **"More samples at 6"**, which
  takes more six-worker runs before deciding; and **"Close it"**, which makes
  no change and records the figures. Chosen: **"Lower to 4, re-measure"**. The
  owner picks the number and whether to land from the four-worker figures; the
  builder does not. `maxWorkers` is 4 under `CI` from this commit, and the
  measurement that follows is recorded in the next entry.
- 2026-10-17 — Measured at four workers under `CI`, on `c21900ea` (run
  39070012677, attempt 1) and its whole-run rerun (attempt 2). Resolved config,
  read back as before: `CI=1` gives root `test.maxWorkers=4`; unset gives
  `undefined`. `npm test` step durations, start to completion, from
  `gh run view --attempt <n> --json jobs`, with the vitest Duration in brackets:
  - ubuntu: 273 s (attempt 1, 21:14:19 to 21:18:52) [272.70 s]; 232 s (attempt
    2, 21:22:02 to 21:25:54) [231.91 s]. Both `Test Files 284 passed | 1 skipped
(285)`, `Tests 5817 passed | 2 skipped (5819)`.
  - Windows (informational): 363 s (attempt 1, 21:14:33 to 21:20:36) [361.53 s];
    340 s (attempt 2, 21:21:52 to 21:27:32) [338.13 s]. Both `Test Files 283
passed | 2 skipped (285)`, `Tests 5758 passed | 61 skipped (5819)`.
  - No failure on any of the four legs. `parallel-ranges.test.ts`, the dl-98
    flake, passed on both Windows attempts (73.9 s and 72.4 s).
  - Samples per leg: two at four workers. The same `main` baseline as the
    entries above, run 39058961193 at `6b42ee19`: ubuntu 274 s and 266 s;
    Windows 472 s and 428 s. Six-worker PR figures are in the entries above:
    ubuntu 222, 229, 231 and 235 s; Windows 363, 304, 362 s passing and 378 s
    failing.
  - Means, `npm test` step: ubuntu `main` 270 s, six workers 229 s, four workers
    253 s. Windows `main` 450 s, six workers 352 s over four attempts (343 s
    over the three that passed), four workers 352 s. At four workers, ubuntu is
    about 6 per cent under `main` against about 15 per cent at six, and Windows
    is about 22 per cent under `main`. The ubuntu four-worker samples (232 s and
    273 s) straddle the six-worker range (222 to 235 s); the Windows four-worker
    samples (340 s and 363 s) sit below both `main` samples (428 s and 472 s).
  - Summed test time, from the Duration lines: ubuntu 796 s and 716 s at four
    workers, against 670 s on `main` and 894 s and 912 s at six. Windows 985 s
    and 923 s at four, against 1070 s on `main` and 1094 to 1264 s at six.
  - Flake tally at six workers on Windows is unchanged by these runs: 2
    failures in 6 attempts. At four workers, 0 failures in 2 attempts. Two
    attempts each cannot decide whether four workers is free of the flake.
  - Main moved to `37819249` while this branch was built. The baseline is
    still `6b42ee19`, as the owner's dispatch names; the comparison is not
    against the newer `main`. The PR's merge base stays `6b42ee19`.
  - Done when 3 is still not met on the six-worker figures above. At four
    workers, the two Windows attempts and their flake result are the evidence
    the owner asked for; the first `main` run after merge is still owed.
