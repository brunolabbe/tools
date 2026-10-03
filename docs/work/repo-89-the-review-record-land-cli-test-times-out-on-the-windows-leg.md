---
id: repo-89
tool: repo
title: The review-record --land CLI test times out on the Windows CI leg
kind: fix
status: in-flight
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

## Review

### Gate 1 — 2026-10-03

**Gate: CONCERNS** — 2026-10-03 · `ebb808b...c78f33d` (base `origin/main` at `ebb808b`, unmoved after `git fetch`) · code-review at medium · citations into this branch's own lines resolve against `c78f33d`

| Done when                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The slow step is named, with the command and the output that showed it | **unproven (gate)** — narrowed to the preflight step, not named inside it. In the failing run 36944832854 the case ran 49,088 ms while `land() lands every commit and the push…` (the same splice, push and verify, `runPreflight` injected) ran 5,622 ms and `preflight.test.ts`'s fake-`gh` CLI case ran 994 ms (`gh run view <id> --job <windows job> --log`). So the excess is the case's real preflight child; `gh` inside it is named by elimination only. The fix changes nothing but `gh`, so the pull request's windows-latest runs are the experiment: the case falling to about its `land()` sibling plus 1–2 s names `gh`; a 5–49 s spread that persists refutes it. |
| Reliable on the Windows leg: three consecutive windows-latest runs     | **unproven (gate)** — no windows-latest run exists for `c78f33d`; three consecutive runs of the ci.yml Windows leg, read per test, are the proof.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run check` and the file pass locally                              | **verified** — `npm run check` exit 0; `npx vitest run scripts/test/review-record.test.ts` 68 of 68, the case 2,409 ms. Positive control: `scripts/test/review-record.test.ts:1559 "fakeGhPath(dir)"` replaced by a bare `fakeGhPath(dir);` (plant, no `PATH` stub) fails at `scripts/test/review-record.test.ts:1585 "toContain(FAKE_GH_MARKER)"`, the real `gh` answering `none of the git remotes configured…` in its place.                                                                                                                                                                                                                                                  |

- **low** · F1, two sites, one mechanism: the branch credits repo-71 with a measurement repo-71 says it did not make. `scripts/test/fake-gh.ts:10 "41 s once in repo-71"` gives the 41 s as the real `gh`'s latency, and the Log's first 2026-10-03 entry says repo-71 "measured the same call at 41,330 ms". repo-71 timed the _test_ at 41,330 ms, measured an unauthenticated `gh` in an Actions-like env making 0 requests (`docs/work/repo-71-a-preflight-test-times-out-on-the-windows-ci-leg.md@ebb808b:272 "half is refuted where it could be"`), and concluded `docs/work/repo-71-a-preflight-test-times-out-on-the-windows-ci-leg.md@ebb808b:280 "So the 41 s is not explained"`; `ci.yml` sets no `GH_TOKEN`. `scripts/test/review-record.test.ts:1583 "the one spawn here that can reach a network"` repeats that network premise. Failure: the next reader of a Windows timeout takes "gh latency, 41 s" as measured and skips the measurement Done-when 1 still lacks. Remedy: "a test that timed out at 41 s, cause unexplained" and "the one uncontrolled binary".
- **low** · F2: the unstub at `scripts/test/review-record.test.ts:1571 "vi.unstubAllEnvs();"` is outside the `finally`, unlike the file's own precedent at `scripts/test/review-record.test.ts@ebb808b:1959 "if (originalTmpdir === undefined) delete process.env.TMPDIR"`, so the Log's "adds no new hazard" does not hold. Measured: a throw planted before the unstub, plus a probe in the next test, gives `PATH leaked from the --land CLI case: expected '/tmp/…' not to contain '.fake-gh'` (2 failed, 66 passed); without the probe 1 failed, 67 passed, because the leaked entry names a deleted fixture. Inert today and near-unreachable: only `runCli`'s `spawnSync` sits between stub and unstub, and vitest's timeout cannot interrupt a synchronous body.
- **low** · F3: the Log's 2026-10-03 Fix entry, its `vi.stubEnv` sub-bullet, reads "answers from its fake there in / in 661" — a doubled "in".
- **dropped** · the plant leaves untracked `.fake-gh/` and `pr.js` in a fixture that `--land` commits and pushes; not a defect, the splice stages only the ticket (`scripts/review-record.mjs@ebb808b:1219 "result.relative]);"`), and the case's subject assertion stays green.
- **dropped** · the rule's "anything that runs `preflight.mjs` for real reaches `gh pr list`" is false for a run that exits at setup (`--base` unresolvable); in context it plainly means a full run. Not misleading.
- **findings** · code-review at medium returned 5; 3 carried, 2 dropped.
- **premise** · 18 windows-latest logs of `ci.yml`, 2026-10-02 to 2026-10-03, the failing run plus 17 of the 27 completed runs among the 40 most recent (three more had no Windows job; seven release-please PR runs were not read). The case: 5,542–49,088 ms, median 11,266, 7 of 18 at 15 s or more, 17 of 18 under 30 s. Its `land()` sibling: 3,987–15,537, median 5,770. The fake-`gh` preflight CLI case: 557–3,260, median 1,055. Case minus `land()` sibling, per run: −4,325 to 43,466, median 4,641. In the failing run the file took 173,866 ms against a median near 120 s, and `preflight.test.ts` 62,627 ms against near 52 s: the leg was slow, but the excess sat in this case. The branch's 27-run figures (median 9,883) agree in shape.
- **mechanism, POSIX, measured** · `fakeGhPath` into a scratch directory: `.fake-gh/gh` is a symlink to `/usr/bin/node` (mode 755, equal to `process.execPath`); `which gh` under the returned `PATH` resolves to it; `spawnSync("gh", ["pr", "list", …], { shell: false })` from the fixture exits 1 with `fake gh answered`. The case's `PATH` reaches `gh` through two inherited `node` hops, the CLI and `scripts/review-record.mjs@ebb808b:1247 "[preflightCli,"`, both spawned without `env`.
- **mechanism, Windows, inference, not run** · `scripts/test/fake-gh.ts:47 "fs.linkSync(process.execPath, ghPath)"` names the plant `gh.exe`, which libuv's search finds by appending `.exe` (it does not read `PATHEXT`). The bytes match `preflight.test.ts`'s `plantFakeGh`, whose marker assertion `scripts/test/preflight.test.ts@ebb808b:870 "fake gh answered/"` passed on windows-latest in 18 of 18 sampled runs, so the link-or-copy branch is proven by proxy. Unproven there: `PATH` arriving through `vi.stubEnv` on a case-insensitive `process.env` rather than an explicit `env`, and the copy fallback's cost if a link is refused.
- **line-neutrality** · base and head both 2,119 lines; positions differ only at 2–29, 1559, 1571 and 1579–1585. 46 of 46 `## Review` citations into `scripts/test/review-record.test.ts` across six records (repo-46 2, repo-55 15, repo-62 4, repo-64 1, repo-80 23, repo-82 1) report `ok`; repo-67 and repo-77 cite it only outside Review. `fake-gh.ts` is new and cited by no merged record; every merged citation into `.claude/rules/testing.md` is pinned. `node scripts/citations-gate.mjs --against origin/main` at `c78f33d`: exit 0, 148 enforced, 0 failing.
- **sibling repo-86** · `d787b325` edits `scripts/review-record.mjs` (+4 −1). `git merge-tree --write-tree c78f33d d787b325`: exit 0, clean. Citations gate over the scratch merge (an unpushed `commit-tree`): exit 0, 148 enforced, 0 failing.
- **repo gates** · `npm run check` exit 0; `packages/core/test/spawn-safety.test.ts` 18 of 18 (`fake-gh.ts` links or copies, spawns nothing); `node scripts/preflight.mjs --base origin/main --title "…(repo-89)"` exit 0, all six checks ok.
- **rule edit** · `.claude/rules/testing.md`, under `# Testing`, the paragraph opening "The same gap swallows a fake command planted on PATH": accurate (check 5 does spawn `gh pr list`, `scripts/preflight.mjs@ebb808b:1025 "the only part of check 5"`, and every other `land()` case injects `runPreflight`) and in the page's scope.
- **Windows leg** · **unproven (gate)**: no Windows machine here and no CI result for `c78f33d`.
- NFR: security n/a (test-only, no shell) · performance ✓ (removes a real binary from the case) · reliability — F2 · maintainability — a second copy of the plant, disclosed in the Log.

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
- 2026-10-03 — **How this lands: in-flight, by the owner's decision.**
  - **The question.** Done-when 1 (name the slow step) and 2 (three consecutive
    `windows-latest` runs without a timeout) can only be proven on CI, so how
    does the ticket land?
  - **The options put through AskUserQuestion.** Land in-flight and close later
    (recommended); land done now; an instrumented commit first.
  - **The answer.** The owner chose in-flight, the recommendation.
  - **What closes it.** Read the `--land` CLI case's per-test duration on the
    next three `windows-latest` runs (this pull request's, then main's after the
    merge), comparing it against its `land()` sibling as the gate did. If all
    three are under the 30 s timeout and the excess is about 1 to 2 s, set
    `status: done`. If the 5 s to 49 s spread persists, the cause was not `gh`
    and the ticket stays open.
  - **Disclosed, not fixed.** Gate 1's three lows. F1: the 41 s attributed to
    the real `gh` in a comment and a Log entry was repo-71's timing of its
    test, whose cause repo-71 did not explain. F2: the unstub sits outside a
    `finally`. F3: a doubled "in" in the `vi.stubEnv` sub-bullet above. They are
    in the gate's record below as the reviewer wrote them.
