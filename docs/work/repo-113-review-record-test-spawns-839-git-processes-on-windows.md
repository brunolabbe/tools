---
id: repo-113
tool: repo
title: review-record.test.ts spawns 839 git processes, which is 61 % of its Windows time
kind: chore
status: done
milestone: null
depends_on: [repo-106]
difficulty: standard
---

# repo-113 — review-record.test.ts spawns 839 git processes, which is 61 % of its Windows time

## Why

[repo-106](./repo-106-review-record-test-windows-time-is-unprofiled.md) measured
where `scripts/test/review-record.test.ts` spends its time on the Windows leg,
from a probe pull request (#577, run `39344302919`, closed unmerged). Its Log
holds every number below.

- On `windows-latest` the file takes 86 s alone and 112 s inside the matrix; on
  `ubuntu-latest`, 24 s and 25 s.
- **`git` spawns are 61.4 % of the Windows time**: 839 spawns, 54,201 ms, 64.6 ms
  each. One `git --version` is 37.7 ms on Windows and 1.8 ms on Ubuntu. On Ubuntu
  the same 839 spawns are 11.5 % of the file.
- **`oxfmt` is 34.2 %**: 81 spawns, 30,203 ms, 373 ms each. That is 1.5 times its
  Ubuntu cost, so it does not explain the gap between the legs; `git` does
  (79.7 % of the 64.6 s difference).
- The probe's row of `git init`, `git config`, `git add` and `git commit` is 299
  spawns and 21,648 ms (24.5 %), and it is not a bound on fixture setup: 131 of
  the 299 are not fixture setup, and `withLandRepo` adds four more subcommands
  outside the row. Counted from the code, fixture setup is 240 spawns, an
  **estimate** of about 19.3 s (21.9 %) at the Windows means; the spawns a
  copied template can replace are the 30 `withTicketRepo` runs' `init`,
  `config` x 2, `add` and `commit`, about 10.6 s.
- The file is the longest of 292 timed test files on the Windows leg in the matrix run (112,084 ms
  of a 407 s vitest `Duration`).

The file spawns real `git` and `oxfmt` on purpose: its header says the CLI tests
are the only thing that proves the process boundary. This ticket keeps every one
of those spawns that an assertion depends on and removes the ones that only build
a fixture.

Whether the saving shortens the Windows leg's wall time is **not measured**: the
file is that leg's longest, but how vitest schedules it across four workers was
not read. That leg is informational (`continue-on-error`), so nothing gates on
it.

## Build

Do not change an assertion, a test name or the number of tests (64).

1. **Count before changing.** Spy on `spawnSync` the way the file's repo-100 test
   already does, for the 25 tests that take 1 s or more on Windows, and write the
   `git` spawn count per test and per subcommand into the Log. Counts do not
   depend on the OS; price each by the Windows means in repo-106's Log
   (`init` 88 ms, `config` 40.5 ms, `add` 65 ms, `commit` 118 ms, `push` 259 ms,
   `rev-parse` 41.6 ms) before building anything.
2. **Drop the `git config` spawns that set an identity.** The fixtures run
   `git config user.email` and `git config user.name` per repository; the probe
   counted 110 `git config` spawns in the test file's own process, 4,451 ms,
   5.0 % of the file, and did not split them by key. Pass the
   identity through `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`
   and `GIT_COMMITTER_EMAIL` on the spawn's `env` instead. Check first that no
   test runs a `git commit` through the CLI under test that relies on the
   repository's config; three of the `config` spawns are made inside the CLI.
3. **Build the committed fixture repository once per file and copy it per test**
   (`fs.cpSync`), in place of `init`, `config`, `add` and `commit` per test: an
   estimate of up to about 10.6 s (30 runs at 352 ms on the Windows means),
   less the copy, which is unmeasured on Windows. A `.git` directory
   with no remote is relocatable; the fixtures that add a bare remote or a clone
   keep doing that per test. Time the copy on Windows in the draft's own leg
   before keeping this step.
4. **Leave alone** the spawns an assertion is about: the CLI children, `oxfmt`,
   `git push` to the bare remote, and the `--land` and `--verify` cases. A fake
   `git` there would make the file pass on a process boundary it no longer
   crosses.

Stop after step 2 if step 1 prices step 3 at less than it costs to review.

## Done when

1. The Log holds the file's `git` spawn count before and after, from the same
   spy, for the whole file; before is 839 on the probe's reading.
2. `npx vitest run scripts/test/review-record.test.ts` passes 64 of 64, with the
   test names unchanged from `main`.
3. The Log holds the draft's own Windows-leg line for the file next to repo-106's
   112,084 ms (matrix, run `39344302900`), reported whichever way it moved. One
   reading each side is not a significant difference: say so beside it.

## Review

**Gate: PASS** — 2026-10-21 · `93bfa1f1..09ded818` · Opus 5.5, depth standard

| Done when                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The Log holds the whole file's `git` spawn count before and after, from the same instrument; before is 839                  | **verified**: the Log reads 839 → 691 from one `PATH` shim on both sides. The gate re-ran it with its own counting shim first on `PATH` and got **839 at `93bfa1f1`, 691 at `09ded818`**, and all 17 per-subcommand rows match the Log's (`init` 48/20, `add` 72/44, `commit` 73/45, `config user.name` and `user.email` 48/16 each; every other subcommand unchanged, `push` 35/35 and `clone` 18/18 included) |
| 2. `npx vitest run scripts/test/review-record.test.ts` passes 64 of 64, test names unchanged from `main`                       | **verified**: 64 of 64 at the head with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`. The `--reporter=json` `fullName` lists at base and head are 64 of 64 identical, in the same order. Also 64 of 64 in 7 `--sequence.shuffle` runs (seeds 1–5, then 1–2 again with the execution order recorded, and the two orders differ)                                                                           |
| 3. The Log holds the draft's Windows-leg line next to repo-106's 112,084 ms, and says one reading each side is not significant | **verified** by reading the Log, with its number checked against CI: run `39516664093` (sha `2b8b3f37`), job `118950394147`, prints `review-record.test.ts (64 tests) 77252ms`, as the Log says. The caveat is in the Log. The CI run on this head, `39517467113` at `09ded818`, gives a second reading of **57,122 ms**, which the Log does not hold. The line does not ask for it                             |

- **low** · no `Done when` line depends on it · `nfr:reliability`. `ticketRepoTemplateDir` in `scripts/test/review-record.test.ts` assigns `ticketRepoTemplate` before `buildTicketRepo` runs. A build that throws partway therefore leaves a half-built template, and every later test copies it without rebuilding. Reproduction: refuse every commit with a failing `pre-commit` hook (`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=<dir>`), then run the spec at the head (`gate-1/broken-commit.sh`). 28 of 64 fail. Only **2** report the cause (`git commit -qm the ticket, before any review / refused-by-gate-probe`). 17 report `git rev-parse HEAD … unknown revision`, and 9 report assertion or `bad revision 'HEAD'` messages. One fixture test, "refuses to run when the ticket is not tracked by git yet, and touches nothing", passes on the repository with no `HEAD`. The file still goes red, so nothing turns green falsely. The cost is diagnosis. Direction, not run: build into a local directory and assign it to `ticketRepoTemplate` only after `buildTicketRepo` returns.
- **low** · no `Done when` line depends on it · `nfr:maintainability`. The `withTicketRepo` docblock still says the fixture is "the same shape `citations-gate.test.ts` builds", and no `scripts/test/citations-gate.test.ts` exists (`ls scripts/test | grep -i citation`: nothing). The text was already there at the base, and the branch moved it. It is false in the safe direction: nothing relies on it.
- **dropped** · Build step 2 says to pass the identity as `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, but the branch writes it into `.git/config` with `fs`. This is not a defect. Positive control: with the two `run(scratchDir, ["config", "user.email"|"user.name", …])` lines deleted from `scripts/review-record.mjs` and no global or system config, **13 of 64 fail at the head, and the same 13 at the base** (sets compared by name: identical). The fixture identity therefore hides no `--land` that stopped setting its clone's identity. Without the deletion, 64 of 64 pass under the same isolation. Separately, `git config user.name` reads back the exact text `setIdentity` appends, a commit succeeds with it, and the same repository without it fails with `unable to auto-detect email address`.
- **dropped** · Suspected state shared between tests through the template. Refuted. In the 5 shuffled runs, a fingerprint of the template taken right after the build (every path, mode, mtime and content) equals the one taken in `afterAll` before removal, so nothing writes to the template after it is built. The `TMPDIR`-redirecting test calls `withLandRepo` before it redirects, so the template is never built in, or removed with, its private directory.
- **dropped** · Suspected that step 3 fakes a spawn an assertion depends on. Refuted. The diff touches only the fixture helpers (`setIdentity`, `buildTicketRepo`, `ticketRepoTemplateDir`, `withTicketRepo`) and the two `otherDir` identity pairs. `withLandRepo` still runs `init --bare`, `remote add` and `push` for each test, and the shim counts for every subcommand outside `init`/`add`/`commit`/`config user.*` are unchanged between base and head.
- **findings** · the hunt returned 5: 2 carried, 3 dropped.
- CI on `09ded818`: every check succeeded in run `39517467113`, including `test (windows-latest, informational)` (job `118953022224`, `Run npm test` success, file 57,122 ms) and `test (ubuntu-latest)` (file 26,364 ms).
- Invariants: no shell ✓ (every spawn is still `shell: false`), style ✓. Errors, SSRF, redaction, contract, test registration and Dockerfile were skipped because a test-helper-only diff cannot reach them.
- NFR: security n/a (test fixtures, constant identity strings) · performance ✓ (839 → 691 spawns; Windows file 112,084 → 77,252 / 57,122 ms, one reading each) · reliability: the low above · maintainability: the low above.

## Log

- **2026-10-20** — Filed from [repo-106](./repo-106-review-record-test-windows-time-is-unprofiled.md)'s
  reading. The `depends_on` is because the numbers in Why live in that Log.

- **2026-10-20** — Built, branch `repo-113-fewer-git-spawns` (commits `3f0f9d33`
  for step 2, `b7d392a0` for step 3). `main` at `93bfa1f1`. The Windows reading
  (Done when 3) is a separate entry below once the draft's leg has finished.

  **Step 1: the count.** Two readings, both run on `ubuntu` locally, because
  counts do not depend on the OS.
  - _The whole file, 839 before_ — a `git` shim first on `PATH` that appends the
    subcommand to a file and `exec`s the real `git`, so it also sees the CLI
    children's spawns. `wc -l` of its log: **839 before, 691 after.** The 839 is
    the probe's number exactly. By subcommand, before then after: `rev-parse`
    257 / 257, `diff` 90 / 90, `commit` 73 / 45, `add` 72 / 44, `init` 48 / 20,
    `config user.name` 48 / 16, `config user.email` 48 / 16, `ls-files` 44 / 44,
    `push` 35 / 35, `show` 23 / 23, `checkout` 22 / 22, `status` 21 / 21,
    `remote` 18 / 18, `clone` 18 / 18, `config gc.auto` 16 / 16, `log` 5 / 5,
    `config --get` 1 / 1. The 16 `config user.*` that remain are the three
    `config` spawns `--land` makes in its scratch clone (`review-record.mjs`
    lines 1448-1455), which is production code under test and stays.
  - _The test process only, per test_ — the repo-100 `spawnSync` spy, plus a
    temporary `beforeEach`/`afterEach` pair in an uncommitted copy of the file
    that read `mock.calls` per test (the copy is deleted; the script is
    `build/mkcount.mts` in the scratch directory). It sees 588 `git` spawns
    before and 440 after; the other 251 of the 839 are CLI children's. The 30
    fixture-building tests, `git` spawns in the test process, before then after,
    priced at the Windows means from repo-106 (`init` 88, `config` 40.5, `add`
    65, `commit` 118, `push` 259, `rev-parse` 41.6 ms; other subcommands
    unpriced, so these are floors):

    | before | after | priced before (ms) | priced after (ms) | test                                                                                             |
    | -----: | ----: | -----------------: | ----------------: | ------------------------------------------------------------------------------------------------ |
    |     63 |    53 |               3307 |              2603 | land() after a successful push says the landing is pushed and prints no reset command            |
    |     49 |    44 |               2203 |              1851 | land() splices two gates, sets status, pushes and verifies                                       |
    |     41 |    36 |               1958 |              1606 | land() leaves no scratch directory behind                                                        |
    |     38 |    33 |               1858 |              1506 | land() reports a scratch-clone cleanup failure as a warning                                      |
    |     36 |    29 |               2352 |              1919 | land() names "push" when the remote already holds a commit                                       |
    |     36 |    29 |               2352 |              1919 | land() prints the reset command on a push failure too                                            |
    |     32 |    27 |               1871 |              1519 | land() pushes a detached HEAD to the branch --branch names                                       |
    |     31 |    26 |               1695 |              1343 | land() keeps the reset command on a verify failure after the push                                |
    |     31 |    26 |               1654 |              1302 | land() after a halted merge-tree failure names every check still open                            |
    |     30 |    25 |               1611 |              1259 | land() creates its scratch clone with gc.auto=0                                                  |
    |     26 |    21 |               1395 |              1043 | land() validates every section against a scratch clone                                           |
    |     24 |    19 |               1311 |               959 | land() names the failing section file in a splice failure's detail                               |
    |     17 |    12 |               1007 |               655 | land() never touches the real repository while validating                                        |
    |     16 |    11 |                907 |               555 | land() refuses a detached HEAD with no --branch                                                  |
    |     13 |     8 |                824 |               472 | the --land CLI lands the commit and the push for real                                            |
    |     13 |     8 |                824 |               472 | land() refuses at setup when a tracked file has an uncommitted change                            |
    |     11 |     6 |                535 |               183 | spliceSection and verifySection are what main() and verifyMain() now call                        |
    |     10 |     5 |                836 |               484 | --verify passes a committed record, then fails naming the line                                   |
    |     10 |     5 |                741 |               389 | the --land CLI refuses a missing flag before touching git                                        |
    |      7 |     5 |                535 |               454 | a gate appended later lands inside the existing "## Review" block (builds the template)          |
    |      7 |     2 |                535 |               183 | three more tests: second first-review call, disclosure diff bound, re-appended gate number       |
    |      5 |     3 |                352 |               271 | splices the first review above "## Log" (its own prose: built directly)                          |
    |      5 |     0 |                352 |                 0 | five more tests: formatter re-pad, dirty ticket, stash advice, untracked ticket, restore to HEAD |

    Total, all 64 tests: **588 before, 440 after** in the test process, and
    **33,491 ms before, 23,311 ms after** at the Windows means for the six priced
    subcommands. That is **10.2 s** saved on the 112 s the file takes in the
    matrix, 9 %: step 2 is 64 spawns, about 2.6 s; step 3 is 84 spawns (28 each
    of `init`, `add`, `commit`), about 7.6 s before the copy. The copy is 27
    files and measured 2.3 ms median on Linux (`build/names.mts`), unmeasured on
    Windows; one Windows reading cannot split it from the rest, so the draft's
    leg gives the total only.

  **Step 3 was built, not stopped before.** Step 1 priced it at about 7.6 s of an
  informational leg for about 60 lines of a test helper that the file's other
  tests do not depend on, and it is its own commit (`b7d392a0`), so dropping it
  is a `git revert` of that one. The ticket's "stop if it costs more than it
  saves" is a call on review cost; I judged one helper cheaper to review than
  7.6 s of every Windows run is to keep, and the orchestrator can overrule.

  **What the brief had wrong.** Step 2 says to pass the identity in
  `GIT_AUTHOR_*` and `GIT_COMMITTER_*`. Its own precondition fails: `--land`
  runs `git commit` in the fixture repository through that repository's config
  (`review-record.mjs` line 1134, `run(repoRoot, ["commit", ...])`), and there
  are 17 tests built on `withLandRepo`. A process-wide environment identity would also reach
  the scratch clone, which sets its own identity at lines 1448-1449 because a
  clone does not inherit the source's local config, and would make a `--land`
  that dropped those two lines still pass. So `setIdentity` appends the
  `[user]` section a `git config` pair writes to `.git/config` with `fs`: the
  same repository-local config, no spawn. The developer's global git identity
  would have hidden a missing fixture identity here (this container has one), so
  the 64 of 64 runs after steps 2 and 3 below were also run with `GIT_CONFIG_GLOBAL=/dev/null` and
  `GIT_CONFIG_NOSYSTEM=1`, as CI's runner has no identity (`build/noid.sh`).

  **Checks.**
  - `npx vitest run scripts/test/review-record.test.ts` after step 2:
    `Tests  64 passed (64)`, 35.4 s. After step 3: `Tests  64 passed (64)`,
    31.7 s; the same with no global identity: `64 passed (64)`, 32.0 s. These
    are single readings in a shared container, not a benchmark; the shim runs,
    36.3 s before and 31.7 s after, carry the shim's own cost.
  - Test names: the two `afterEach` copies' `name` lists, `before.jsonl` and
    `after.jsonl`, are 64 names each and identical in order
    (`build/names.mts`: `identical in order: true`).
  - `npm run check`: exit 0. `npm run build` fails in the three `web`
    workspaces on `@webtools/ui/tokens.css` (unresolved import in the farm),
    which this branch does not touch and `scripts/test` does not read.

- **2026-10-20** — **Done when 3: the draft's own Windows leg.** PR #590 at
  `2b8b3f37` (its code is `b7d392a0`; the later commit is the Log), ci.yml run
  `39516664093`, `test (windows-latest, informational)` job `118950394147`,
  finished `pass`. The `Run npm test` line, ANSI codes removed:
  `✓ repo scripts/test/review-record.test.ts (64 tests) 77252ms`, inside a
  vitest `Duration` of 310.09 s.

  | Leg, ci.yml matrix `Run npm test` line | repo-106, run `39344302900` | this draft, run `39516664093` |
  | -------------------------------------- | --------------------------: | ----------------------------: |
  | windows-latest                         |                  112,084 ms |                     77,252 ms |
  | ubuntu-latest                          |                   25,462 ms |                     27,935 ms |
  | windows `Duration` (whole vitest run)  |                    407.24 s |                      310.09 s |

  **One reading each side is not a significant difference.** The Windows file is
  34.8 s shorter (31 %), which is more than the 10.2 s the spawn counts price,
  and the Ubuntu file is 2.5 s _longer_ on a change that cannot slow it, so the
  matrix's contention between test files moves the number by more than the
  change does (the other files' timings were not compared). Read it as "did not get slower, and probably faster", not as 31 %.
  The copy's own cost on Windows is not separable from one reading and is
  unmeasured; the total did not rise. Whether the saving shortens the leg's wall
  time is still the open question the ticket named: the `Duration` fell, but one
  run does not say by how much of that this file is.

- 2026-10-21 — Fixed at landing by owner choice: gate 1, first low (`nfr:reliability`)
  — "`ticketRepoTemplateDir` in `scripts/test/review-record.test.ts` assigns
  `ticketRepoTemplate` before `buildTicketRepo` runs. A build that throws partway
  therefore leaves a half-built template, and every later test copies it without
  rebuilding." The template now builds into a local directory and is assigned
  only after `buildTicketRepo` returns (a throwing build removes its directory
  and rethrows). The gate's probe, every `git commit` refused by a failing
  `pre-commit` hook, run on the spec at `09ded818` and on the fixed spec: before,
  `failed 28 of 64`, 2 naming `git commit -qm the ticket, before any review /
refused-by-gate-probe`, 17 `git rev-parse HEAD … unknown revision`, 9 other
  messages; after, `failed 29 of 64`, `29 x Error: git commit -qm the ticket,
before any review / refused-by-gate-probe` and no other message (the 29th is
  the no-`HEAD` test that used to pass). With the real config,
  `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run
scripts/test/review-record.test.ts` → `Tests  64 passed (64)`, the test names
  unchanged (the diff touches no `test(`/`it(`/`describe(` line).

- 2026-10-21 — Fixed at landing by owner choice: gate 1, second low
  (`nfr:maintainability`) — "The `withTicketRepo` docblock still says the fixture
  is "the same shape `citations-gate.test.ts` builds", and no
  `scripts/test/citations-gate.test.ts` exists." The clause is dropped from the
  docblock (nothing exists to point it at). `ls scripts/test | grep -i citation`
  → no output; `grep -c citations-gate scripts/test/review-record.test.ts` → `0`;
  `awk '/^## Log/{exit} {print}' <this ticket> | grep -c citations-gate` → `0`
  (scoped above `## Log`, because this entry quotes the phrase).
