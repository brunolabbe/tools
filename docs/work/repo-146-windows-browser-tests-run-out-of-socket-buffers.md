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

1. The Log records the step 1 failure rate on `windows-latest`, with run ids.
2. With the change, the same number of runs shows no `ERR_NO_BUFFER_SPACE`,
   or the Log records the owner's answer on which mitigation to take.
3. `npm run check` and `npm test -- --project downloader` pass on Linux.
   The change does not slow `test (ubuntu-latest)` by more than its normal
   run-to-run spread.

## Log

- 2026-11-11 — Filed at the owner's choice, after #777's only red check
  turned out to be the fourth occurrence. A re-run of that job was started at
  e44644ad.
