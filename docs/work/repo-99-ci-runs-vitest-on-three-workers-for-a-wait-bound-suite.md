---
id: repo-99
tool: repo
title: CI runs vitest on three workers for a suite that spends most of its time waiting
kind: chore
status: ready
milestone: null
depends_on: []
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
