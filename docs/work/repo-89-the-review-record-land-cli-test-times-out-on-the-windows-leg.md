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

- 2026-10-03 — Built on `origin/main` at `ebb808b`. **The slow step is not
  named, and cannot be from this log; it is narrowed to the real `gh`, which is
  a reading, not a Windows measurement.** What was measured:
  - The failing log has no per-step timing: vitest prints one wall time per
    test, and the CLI's own steps print only `ok`/`FAIL`
    (`gh run view 36944832854 --job 110644469545 --log-failed`, whose
    per-test lines read `× the --land CLI lands the commit and the push for
real, … 49088ms`). That log is the failing attempt's own — the timing and
    the `Test timed out in 30000ms` at `review-record.test.ts:1551` match the
    ticket — so the `--attempt 1 --log` form the Build names was not needed
    here.
  - **The test is an outlier against its own file, not just a slow leg.** The
    same file took 173,866 ms on Windows against 40,364 ms locally for the 68
    tests (`npx vitest run scripts/test/review-record.test.ts --reporter=verbose`),
    and its tests ran mostly 2–5x slower on the runner (one 7.4x); this one ran **18.3x**
    slower (49,088 ms against 2,681 ms). The next worst, `land() splices two
gates …`, was 2.7x. What this test has that its `land()` siblings do not is
    `runPreflightDefault`'s real `preflight.mjs` child.
  - **Across the windows leg of 27 `ci.yml` runs, 2026-09-30 to 2026-10-03
    (`gh run view <id> --job <windows job id> --log`, one run per id), the case
    ran 5,542 to 49,088 ms: median 9,883, 8 of 27 at 15 s or more, 5 at 19 s or
    more, and 26 of 27 under the 30 s timeout.** The sibling case in
    `preflight.test.ts` that runs the same CLI with a _fake_ `gh`
    (`"gh fails inside check 5"`) ran 661 to 3,260 ms in all 27, median 1,119 ms.
    So the preflight CLI, `node` start, `git` and the `npm` spawn together cost
    about a second on this runner when `gh` is a fake that answers; the CLI
    case's own spread is the part a fake removes.
  - **The one spawn in the case that can reach a network is `gh pr list`**
    (`scripts/preflight.mjs:1025 "the only part of check 5"`). A local trace of the whole CLI run
    (a `--require` hook timing every `spawnSync`/`execFileSync`, 69 spawns):
    `gh pr list` 65 ms, `npm run check` 122 ms, the preflight `node` child 275 ms,
    five `oxfmt` runs 280 to 375 ms each, everything else under 20 ms. On Linux
    a real `gh` answers `none of the git remotes configured for this repository
point to a known GitHub host` in 65 ms; on the Windows runner repo-71 already
    measured the same call at 41,330 ms once and 2,024 ms on a retry of the same
    sha, and found that the `PATH` fake never answered there at all.
  - **Unproven, and named so:** that the 49 s was `gh`. No Windows machine was
    available and the log has no step timings, so the claim is that `gh` is the
    only uncontrolled network spawn in the case and that a sibling with `gh`
    faked ran in a second, not that `gh` was seen taking 49 s.
- 2026-10-03 — **Fix: the case plants a fake `gh`, as repo-71 did, and asserts
  its marker** (`scripts/test/fake-gh.ts`, new; `scripts/test/review-record.test.ts:1559 "fakeGhPath(dir)"`,
  `scripts/test/review-record.test.ts:1585 "toContain(FAKE_GH_MARKER)"`).
  The timeout is not raised, per Build 2: a spawn that costs 5 to 49 s is the
  cost to remove, not to budget for. Red and green, both run:
  - Green: `npx vitest run scripts/test/review-record.test.ts` — 68 of 68; the
    case ran 2,042 ms.
  - Red, with the `vi.stubEnv` line replaced by a no-op: `npx vitest run
scripts/test/review-record.test.ts -t "the --land CLI lands"` fails with
    `AssertionError: expected '\n== setup ==\nok  zz-1 (repo) at bas…' to contain
'fake gh answered'`, the real `gh` having answered `FAIL  mergeTree threw`
    in its place — the marker is what tells a fake from a real binary, since a
    real `gh` in this fixture exits non-zero too (`.claude/rules/testing.md`).
  - **Line-neutral on purpose.** Merged records cite this file at 1577, 1586 and
    some thirty lines after; the edit keeps every line of the file where it was
    (the import costs a line, paid back from the header comment; the stub and the
    unstub replace the two blank lines around the spawn). `git diff --stat` shows
    13 insertions and 13 deletions in the test.
  - **`vi.stubEnv` and `vi.unstubAllEnvs` bracket only the spawn.** The same file
    already mutates `process.env` for `TMPDIR` (`scripts/test/review-record.test.ts:1910 "const originalTmpdir"`), so this adds no new
    hazard, and the spawn inherits `process.env` rather than a spread of it. That
    the stub reaches `gh` on Windows is **unmeasured here**; `preflight.test.ts`'s
    case, which sets `PATH` in a spawn `env`, answers from its fake there in
    in 661 to 3,260 ms across the 27 runs, and this one's marker assertion fails loudly
    if the stub does not take.
- 2026-10-03 — **Done when, as of this branch.** Named slow step: **not met**,
  narrowed as above. Reliable on the Windows leg: **unproven** — it needs three
  consecutive `windows-latest` runs of the file after this lands, and there is
  no pull request yet. The per-run read that gave the table above is a loop over
  `gh run list --workflow ci.yml` and `gh run view <id> --job <windows job id>
--log`; re-running it after the merge is the measurement (the CLI case under
  about 3 s in all of them would be the confirmation, a 5 s to 49 s spread the
  refutation). Local checks are in the branch's report.
- 2026-10-03 — **Could have been folded in, was not:** `preflight.test.ts`'s own
  `plantFakeGh` (`:921`) is now a second copy of `fake-gh.ts`'s plant. Pointing
  it at the shared module would delete 18 lines above 22 citations that merged
  records make into that file at line 900 or later, so it moves them all for no
  behaviour. It is a rename-level cleanup for whoever next edits that file
  anyway.
