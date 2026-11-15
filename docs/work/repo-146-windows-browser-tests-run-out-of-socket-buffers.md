---
id: repo-146
tool: repo
title: Windows browser tests run out of socket buffers on page.goto
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# repo-146 — Windows browser tests run out of socket buffers on `page.goto`

## Why

`test (windows-latest, informational)` in `ci.yml` has gone red at least four
times on `net::ERR_NO_BUFFER_SPACE`. Each time it was one Playwright
`page.goto` to a fixture server on `127.0.0.1`, in a different downloader
browser-resolver test, and in code the change under test could not reach:

| Where it was recorded                                                                                     | Run                                      | Failing file › case                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [repo-99](./repo-99-ci-runs-vitest-on-three-workers-for-a-wait-bound-suite.md) Log, 2026-10-18            | 39091589866 attempt 1 (`main`, 140bd78a) | `browser-resolver-press-targets.test.ts` › the dl-100 cross-site frame press                                    |
| lg-71 gate, `CI` bullet (`tools/ledger/docs/work/lg-71-…`)                                                | 40247237333 (#669, bd9972ac)             | `browser-resolver-capture.test.ts`                                                                              |
| [repo-134](./repo-134-glob-and-minimatch-advisories-have-no-in-range-fix.md) gate, first `dropped` bullet | #766 head                                | `consent-scope.test.ts` › c12                                                                                   |
| #777 (dl-130), recorded in the tools-34 batch log                                                         | 42731587914 job 129550734387 (e44644ad)  | `provoke.test.ts` › "SCROLL_SCRIPT targets the largest candidate (dl-81)" › "brings the large shell into view…" |

Every time, a re-run passed. On a Windows host, `ERR_NO_BUFFER_SPACE` (WSAENOBUFS)
usually means ephemeral ports or socket buffers ran out. That fits the
CI setup: four vitest workers on the runner (`vitest.config.ts`, `maxWorkers: 4`
under `CI`), each starting browsers and fixture servers. But nothing has measured
it yet. repo-99 chose not to file after one sample. There are four now, so this is
the pattern repo-99 was waiting for.

The job is `continue-on-error`, so it never blocks a merge. What it does cost is
that each red run has to be read and set aside by a gate or by the owner, and a real
Windows regression in a browser test would look the same as this flake.

## Decision — answered 2026-11-15 by the owner

Asked at intake by the orchestrator, which first measured two things. Over 8
nightlies (2026-11-08 to 2026-11-15) `ERR_NO_BUFFER_SPACE` appeared 0 times;
the two red Windows legs, on 11-14 and 11-11, were other flakes (dl-98
parallel-ranges-limits and lg-98 stats-rows). Over 2026-10-18 to 2026-11-15,
`ci.yml` completed about 675 runs (555 `pull_request`, 98 `push`, 22
`schedule`; not every one runs a Windows test leg), against the 4 known
occurrences above.

1. **How many downloader-only Windows runs to measure before and after.**
   Options: (a) 10 before and 10 after, stopping if the before count is 0/10
   (the orchestrator's recommendation); (b) 5 and 5; (c) no reproduction runs:
   skip Build step 1, do step 2's static search, fix any leak found, and reword
   Done when 1 to record the nightly history instead of a measured rate.
   **The owner chose (c)**, overriding the recommendation.
2. **What "normal run-to-run spread" means in Done when 3.** Options: (a) one
   `workflow_dispatch` run of `ci.yml` at the final head, which runs every
   project and so compares with the nightly; `test (ubuntu-latest)` ≤ 295 s,
   the maximum of 7 green nightlies 2026-11-08..15 (range 235–295 s); if it is
   over, two more runs and the median decides (recommended); (b) an `awaiting`
   line read on the first nightly after merge; (c) drop the timing half.
   **The owner chose (a).**
3. Then the owner asked "if it does not repeat, why fix it?" and followed with
   **"anyway, check if you see anything worth improving."** Those two
   sentences are all the owner said on this. **The rest of this paragraph is
   the orchestrator's reading of "check if you see anything worth
   improving", not the owner's words:** the scope is Build step 2's static
   look at `tools/downloader/resolvers/test/browser/` — fixture servers and
   browser contexts closed in `afterEach`/`afterAll`, a server started per case
   where per file would do, keep-alive connections never released, anything
   else holding sockets past its test. Fix a real cause with a test or a
   measurement showing the resource is released. Add no mitigation that cannot
   be measured: no `page.goto` retry and no Windows worker cut. If nothing is
   worth improving, change no code and record what was checked. The owner did
   not rule a mitigation out; Build step 3's last sentence still stands, so if
   a mitigation is ever the only choice left, stop and put the options with
   their measured rates to the owner.

So Build step 1 does not apply (answer 1(c)), nor does step 4 or step 3's
mitigation half while the static look finds nothing, which is the
orchestrator's reading. The reworded Done when lines below are the
orchestrator's derivation from these answers, not the owner's words, except
Done when 3's "no dispatch run" clause, which the owner confirmed (answer 5).

Answered 2026-11-15, after gate 1 (its finding F2 and its note on Done when
3), by the owner, to the orchestrator:

4. **Who excluded the mitigations.** The ticket had credited the owner with
   ruling out a `page.goto` retry and a Windows worker cut. The owner never said
   that; the orchestrator wrote it into the build dispatch under the owner's
   answers. Options: (a) not the owner's: attribute the exclusion to the
   orchestrator's reading of "check if you see anything worth improving", and
   keep Build step 3's stop-and-put-the-options-to-the-owner (recommended, and
   the gate's fix); (b) record it as the owner's decision. **The owner chose
   (a).** Applied in answer 3's paragraph above, in the struck Done when 2 and
   in the Log.
5. **Done when 3 with no code change.** The owner had chosen 2(a), one
   `workflow_dispatch` run at the final head with `test (ubuntu-latest)` ≤ 295 s.
   No code changed, so the ticket says no dispatch run is made; that was the
   orchestrator's derivation, and the gate noted it departs from the option's
   text. Options: (a) no run, since nothing changed (recommended); (b) run one
   anyway. **The owner confirmed (a): no run.**

## Build

1. **Reproduce before changing anything.** Use `workflow_dispatch` on `ci.yml`
   (or a throwaway branch) to run only the downloader project on
   `windows-latest` several times. Count `ERR_NO_BUFFER_SPACE` failures per run.
   The fix has to be measured against that rate, so record it.
2. **Find what holds the sockets.** Check whether the fixture servers and
   browser contexts in `tools/downloader/resolvers/test/browser/` are closed in
   `afterEach`/`afterAll`. Check whether a server is started per case instead of
   per file, and whether connections are left keep-alive. On the runner, a
   `netstat -an | find /c "TIME_WAIT"` step taken during the suite shows whether
   ports are being used up.
3. **Fix the cause if one is found:** leaked servers or contexts, or keep-alive
   connections that are never released. Otherwise, pick the narrowest
   mitigation and measure it the same way as step 1. Candidates are fewer
   workers for the browser files on Windows only, or a single retry of
   `page.goto` on this one error code in the shared test helper. Never retry
   on every error, and never change what `classify.ts` raises in production
   code. **If the only choice left is between mitigations, stop and put the
   options with their measured rates to the owner** rather than choosing.
4. Append the before and after rates to the Log.

## Done when

Reworded 2026-11-15 from the owner's answers above (the orchestrator's
derivation, except Done when 3's "no dispatch run" clause, which the owner
confirmed on 2026-11-15, answer 5); each superseded line is kept, struck.

1. The Log records the nightly history (0 of 8 nightlies 2026-11-08..15) and
   the 4 known occurrences against the run count, instead of a measured rate
   (owner, 2026-11-15).
   - ~~The Log records the step 1 failure rate on `windows-latest`, with run
     ids.~~ Superseded by answer 1(c).
2. A cause found by the static look is fixed and shown released by a test or a
   measurement, or the Log records what was checked and that nothing was found.
   - ~~With the change, the same number of runs shows no
     `ERR_NO_BUFFER_SPACE`, or the Log records the owner's answer on which
     mitigation to take.~~ Superseded by answer 1(c) and the orchestrator's reading of answer 3.
3. `npm run check` and `npm test -- --project downloader` pass on Linux. If
   code changed, one `workflow_dispatch` run of `ci.yml` at the final head reads
   `test (ubuntu-latest)` ≤ 295 s; if over, two more runs and the median
   decides. If no code changed, the Log says so and there is no dispatch run.
   - ~~The change does not slow `test (ubuntu-latest)` by more than its normal
     run-to-run spread.~~ Superseded by answer 2(a).

## Log

- 2026-11-11 — Filed at the owner's choice, after #777's only red check
  turned out to be the fourth occurrence. A re-run of that job was started at
  e44644ad.
- 2026-11-15 — Built under the owner's answers above, on base 4e040577. **No
  code changed: the static look found nothing holding sockets past its test.**

  **Done when 1, the history.** From the orchestrator's intake measurement, not
  re-run here: 0 `ERR_NO_BUFFER_SPACE` in 8 nightlies 2026-11-08..15 (the red
  Windows legs on 11-11 and 11-14 were dl-98's parallel-ranges-limits and
  lg-98's stats-rows); 4 known occurrences (the table above) in about 675
  completed `ci.yml` runs 2026-10-18..11-15 (555 `pull_request`, 98 `push`, 22
  `schedule`), not all of which run a Windows test leg. All 4 occurrences predate
  dl-134's `closeAllConnections()` in `fixture-server.ts` (3b61895c, merged
  2026-11-10 21:06 -0500, which is 2026-11-11T02:06Z): run 39091589866 was
  created 2026-10-18, run 40247237333 2026-10-26, #766 merged 2026-11-08
  (18:34Z) and run 42731587914 attempt 1 was created 2026-11-10T00:52Z. The
  date is the test, not head ancestry, because three of the four are
  `pull_request` runs, which build a merge with the base. That is a
  coincidence of dates, not a cause: the call runs in `afterAll`, and every
  failure was a `page.goto` in the middle of a file.

  **Done when 2, what was checked in `tools/downloader/resolvers/test/browser/`:**

  - _Fixture servers closed._ `helpers/fixture-server.ts` closes both origins
    with `closeAllConnections()` then `close()`; so do
    `helpers/chunk-server.ts` and `helpers/progressive-server.ts`. Every
    starter is paired: the six `browser-resolver-*` files through
    `startBrowserHarness`/`closeBrowserHarness` in `beforeAll`/`afterAll`;
    `provoke`, `consent-scope` and `chunk-streams` directly in the same hooks;
    `browser-resolver-capture`'s progressive server in its describe's hooks.
  - _Browsers and contexts closed._ `BrowserPool.close()` closes the shared
    browser and a dedicated one is closed in `withBrowser`'s `finally`
    (`src/browser/pool.ts`). `BrowserResolver.#probe` opens one context per
    probe and closes it in `finally` under a timeout
    (`src/resolvers/browser.ts`). Every hand-made context in `provoke.test.ts`
    (13) and `consent-scope.test.ts` (1) is closed in a `finally`. `pool.test.ts`
    closes its pool in `afterEach`; `pool-stages.test.ts` mocks Playwright and
    opens nothing.
  - _A server per case where per file would do._ Only in
    `manifest-fetch.test.ts` (21 `serve` calls) and `size-probe.test.ts` (8).
    Each serves a handler specific to its case, is closed in `afterEach` with
    `closeAllConnections()`, and is reached by Node's client, never by
    Chromium's `page.goto`, which is what failed. Every Playwright file already
    shares one server per file.
  - _Keep-alive never released._ The Node client in
    `src/browser/manifest-fetch.ts` tracks every socket, request and response
    it opens and destroys them all in `run`'s `finally`; the tunnel `CONNECT`
    uses `agent: false`. Chromium's connections belong to the probe's context,
    which is closed per probe. One client is on the default agent: the fake
    proxy in `manifest-fetch.test.ts` (`fakeProxy`) forwards with
    `http.request` and no `agent`, so it uses `http.globalAgent`, which keeps
    connections alive on this Node (`keepAlive` reads `true`). Its idle socket is
    released when the target's `closeAllConnections()` in that test's
    `afterEach` ends the other half; the gate read this and did not isolate it.
  - _A measurement on Linux, which sizes churn and shows less than it looks
    like._ Loopback sockets sampled every 0.5 s with `ss` while `npx vitest run
    tools/downloader/resolvers/test/browser` ran (20 of 20 files, 759 of 759
    tests, 48.2 s, exit 0): ESTABLISHED read 6 before, peaked at 42 and read 6
    again 2 s after the run; TIME_WAIT rose from 13 to 399, about 390 loopback
    connections closed in 48 s. Against Windows' default dynamic range of
    16,384 ports that churn is about 2.4 % even if every connection sat in
    TIME_WAIT at once, and that bears on ports only, not on the socket buffers
    `ERR_NO_BUFFER_SPACE` also names. What it shows: no process outlived the
    run holding sockets. What it cannot show: that a file released what it
    opened, because every file in this directory is its own forked worker
    (`stayIsolated`) and a worker's exit releases its sockets either way (gate 1
    ran a spec that leaked one server and 20 connected clients past its test:
    ESTABLISHED read 6, then 46–52 during, then 12 two seconds after the worker
    exited, the box's ambient reading a minute later), or anything about a
    Windows release path. The sampler kept a count, not a list, and the box's
    ambient moved from 6 to 12 between two runs. The static sweep above is what
    carries "nothing found". The Windows leg also runs every project at the
    same time, which this run does not.

  Nothing was worth changing, so there is no fix to show released. A
  `page.goto` retry and a Windows worker cut were not tried: the
  orchestrator's reading of answer 3 left mitigations out of scope, which is
  not the owner's ruling, and Build step 3's stop-and-put-the-options-to-the-
  owner still stands if a mitigation is ever the only choice left.

  **Done when 3.** `npm run check` exit 0, and `npm test -- --project
  downloader` exit 0: 127 files passed and 1 skipped of 128, 2,622 tests passed
  and 2 skipped of 2,624, 54.3 s, at 4e040577 plus this ticket's edits. No
  code changed, so there is no `workflow_dispatch` run.

  **What the brief had wrong.** `maxWorkers: 4` under CI does reach the browser
  files, but through `splitProject` in `vitest.isolation.ts`, where the
  isolated half that `tools/downloader/vitest.config.ts`'s `stayIsolated` puts
  this directory in inherits it, not through `vitest.config.ts` as the Why
  says. Whether the shared and isolated halves run at the same time was not
  measured. The 2026-10-18 case "the dl-100 cross-site frame press" is not a
  test name. repo-99's Log names the case: "a Play press in a frame from
  another site that only isPlayPress counts", which is the icon-button test in
  `browser-resolver-press-targets.test.ts`, "a Play press in a frame from
  another site that only isPlayPress counts (an icon button) still holds back
  the box click, whose centre is that frame". The file held the same two
  cross-site frame tests, under the same names, at 140bd78a. Fold-in: none. Nothing already specified became free.

- 2026-11-15 — Round 1, after gate 1 at 30a15b0c (CONCERNS, five findings, all
  wording in this file; no code changed). F1: the Linux measurement's sentences
  reworded to what it shows, since each file is its own forked worker. F2: the
  mitigation exclusion is attributed to the orchestrator's reading of answer
  3, not to the owner, at the owner's choice (Decision answer 4). F3: the
  2026-10-18 case is named. F4: the date replaces head ancestry as the test
  for dl-134's `closeAllConnections()`. F5: the fake proxy's default-agent
  `http.request` is in the keep-alive list, with its release path. The owner
  also confirmed that Done when 3 makes no dispatch run when no code changed
  (Decision answer 5).
