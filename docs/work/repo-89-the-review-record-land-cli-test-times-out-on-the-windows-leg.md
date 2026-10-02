---
id: repo-89
tool: repo
title: The review-record --land CLI test times out on the Windows CI leg
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-89 — the review-record `--land` CLI test times out on the Windows CI leg

## Why

`scripts/test/review-record.test.ts` `"the --land CLI lands the commit and the
push for real, then fails naming "preflight" against a fixture with no
package.json"` timed out on the `test (windows-latest, informational)` leg of
PR #330. The test is at
`scripts/test/review-record.test.ts:1551 "the --land CLI lands"`:

- **49,088 ms against a 30,000 ms timeout**, `Error: Test timed out in 30000ms.`
  — Actions run 36944832854, job 110644469545, PR #330 at `59c2ed6`
  (`gh run view 36944832854 --job 110644469545 --log-failed`).
- The same leg **passed** on #331, #332, #333, #334 and #335 in the same batch
  (2026-10-01), so this is intermittent, like `repo-71`'s timeout before it.

The leg is `informational` (`continue-on-error`), so it blocked nothing, and
nothing reads it: the next failure starts from zero.

**What is known and what is not.** The test runs the real `preflight.mjs` in a
fixture repository, and `repo-80`'s gate 1, F4, recorded that the same test runs
the real `gh pr list` of preflight's merge-tree check from a unit test, and
"fails fast only because the fixture remote is not a GitHub host"
(`docs/work/repo-80-land-records-one-command.md`, its Review section). That is
a reading, not a measurement on Windows: the cause of the 49 s is **not
identified**. `repo-71` does not cover it — that ticket is `done` and is one
test in `scripts/test/preflight.test.ts`, with no mention of
`review-record.test.ts`.

## Build

1. Read the failing run's log for where the 49 s went (`gh run view 36944832854
--attempt 1 --log`, not `--job <id> --log` alone, which `repo-71`'s gate
   found returns the wrong attempt's log on a retried run): which of the test's
   steps — splice, push, verify, preflight and its `npm run check`, or the
   real `gh` — was slow, and whether other tests on the leg stalled in the same
   run as `repo-71` found.
2. If the real `gh` or `npm` spawn is the cost, take it out of the test rather
   than raising the timeout. `land()` takes an injectable `runPreflight`
   (`scripts/review-record.mjs:1302 "runPreflight?: (repo: string"`), but this
   test goes through the CLI, which cannot inject it; a fake planted on `PATH`
   has to be a real executable on Windows, per `.claude/rules/testing.md`.
3. If the leg is simply slow that run, say so with the numbers and decide
   whether a timeout is the honest fix.

## Done when

- The slow step is named, with the command and the output that showed it.
- The test is reliable on the Windows leg: three consecutive `windows-latest`
  runs of `scripts/test/review-record.test.ts` complete without a timeout, or
  the cause is shown to be the runner and this ticket says so.
- `npm run check` and `npx vitest run scripts/test/review-record.test.ts` pass
  locally.

## Log

- 2026-10-02 — Filed from the 2026-10-01 batch close-out (the fix round on
  PR #336), on the owner's choice via `AskUserQuestion` of "file a ticket"
  over "leave it recorded". Reproduction as above; the run, job and timing were
  re-read with `gh run view 36944832854 --job 110644469545 --log-failed`.
