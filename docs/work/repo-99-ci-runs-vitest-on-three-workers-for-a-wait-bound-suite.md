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
