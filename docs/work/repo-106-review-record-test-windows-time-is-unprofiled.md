---
id: repo-106
tool: repo
title: review-record.test.ts takes about 121 s on the Windows leg, and nothing measured says why
kind: chore
status: done
milestone: null
depends_on: [repo-100]
difficulty: standard
---

# repo-106 — review-record.test.ts takes about 121 s on the Windows leg

## Why

[repo-100](./repo-100-review-record-formats-the-same-section-three-times-per-landing.md)
memoized `formatMarkdown` and merged four tests, and its gate read the
`Run npm test` step of each run. The Ubuntu leg dropped; the Windows leg did not
move. The owner decided on 2026-10-18 to file a profiling ticket for the Windows
time rather than leave it as an observation.

The reproduction, from repo-100's gate (`ticket-reviewer-opus`):

| Leg                            | Run and sha                         | `review-record.test.ts`        |
| ------------------------------ | ----------------------------------- | ------------------------------ |
| ubuntu-latest                  | 39086562034 at `029641b4`, 67 tests | 41,634 ms                      |
| ubuntu-latest                  | 39089135953 at `e7658afd`, 64 tests | 21,171 ms                      |
| ubuntu-latest                  | 39089694781 at `d06865b1`           | 31,289 ms                      |
| windows-latest (informational) | the same three runs                 | 121,328 / 121,660 / 124,269 ms |

Re-read by the builder on 2026-10-18 with
`gh run view 39089135953 --log | grep -i "review-record"`, ANSI codes removed:

```
test (ubuntu-latest)  Run npm test  ✓ repo scripts/test/review-record.test.ts (64 tests) 21171ms
test (windows-latest, informational)  Run npm test  ✓ repo scripts/test/review-record.test.ts (64 tests) 121660ms
```

On the same file the Windows figure is about three to six times the Ubuntu one,
and it stays near 121 s across the three shas, one of which is the repo-100
branch. The Ubuntu figure moves and the Windows one does not, so whatever
dominates Windows is not the part that moved. Nothing measured says what it is.

**Candidate causes, none of them measured:**

- **The per-test fixtures.** `scripts/test/review-record.test.ts` creates
  temporary directories for its git fixtures (`mkdtempSync` at, among others,
  `:234`, `:1067` and `:1328`). How many `git` and `oxfmt` processes each test
  spawns is not counted anywhere. A process spawn is the likely per-unit cost on
  Windows, and the count is the multiplier.
- **The whole-ticket `oxfmt` spawn.** `spliceSection` in
  `scripts/review-record.mjs` (`:416`) runs `oxfmt` in place on the whole ticket
  file, at `:492`. That is not the call repo-100 memoizes: `formatMarkdown`
  (`:712`) formats a temporary section file, at `:717`, and is what the memo
  covers. `spliceAndCommitAll` calls `spliceSection` per plan and is called from
  two sites (`:1431` and `:1484`). The dispatch that asked for this ticket
  counted two whole-ticket calls; the source has one spawn site for that call,
  and how many times a test reaches it is what a measurement would have to count.

The Windows leg runs only on CI, so the reproduction only another OS can give is
the orchestrator's to arrange as a probe pull request
(`reference/dispatching.md`, _A probe pull request_). The dispatch puts one run of
the matrix at about 17 minutes of Linux and Windows legs.

## Build

Measure, do not fix. The fix, if any, is a separate ticket that this one names.

1. Arrange a **probe pull request** with the orchestrator, as
   `reference/dispatching.md` says. The orchestrator names its files in the
   dispatch; the probe adds new files only and is never merged. The measurements
   it must take are: per-test durations for `review-record.test.ts` on each leg
   (vitest's verbose reporter, in the probe run), and one timed `git` spawn and
   one timed `oxfmt` spawn on `windows-latest` from a new probe spec file that
   touches no existing file. The probe must not change what the existing test
   asserts. Its title follows the commit convention and says `DO NOT MERGE`
   after the type and scope.
2. Read the Windows leg and the Ubuntu leg of that run with
   `gh run view <run> --json jobs` for each step's conclusion, then
   `--job <id> --log | grep` for the timings. Record each number with its run
   id, sha and test count.
3. From those readings, name the dominant cost on Windows. Split the
   `review-record.test.ts` time into fixture setup (directory and repository
   creation outside the test body), `oxfmt` time (the whole-ticket spawn at
   `:492` and the section spawn at `:717`, with the number of times each test
   reaches them), and the rest. State the share of each the probe actually
   measured.
4. Time one `git` spawn and one `oxfmt` spawn on `windows-latest`, so the
   per-spawn cost is a measured Windows number, not the 330 ms and 2 ms figures
   repo-100's ticket quotes from the repo-99 audit.
5. Close the probe pull request without merging it, and delete its branch.

## Done when

1. The Log holds the Windows and Ubuntu per-test durations for
   `review-record.test.ts` from the probe run, each with its run id, sha and the
   test count the leg printed.
2. The Log names the dominant cost on Windows with a share of the file's time for
   each candidate cause above: fixture setup, the whole-ticket `oxfmt` spawn, the
   section `oxfmt` spawn, and the rest. A cause the probe did not measure is named
   as unmeasured, not as ruled out.
3. The Log holds one measured `git` spawn and one measured `oxfmt` spawn on
   `windows-latest`, in milliseconds.
4. The probe pull request is closed without merging, and its branch is deleted.
5. The Log names the fix, or says none is needed, and a follow-up ticket is filed
   for any fix.

## Review

**Gate: CONCERNS** — 2026-10-20 · `6dd274bd..709475f6` · Opus 5.5, depth standard

A measurement ticket: every acceptance line is a Log claim, checked by re-reading probe run 39344302919 (jobs 118373087447 ubuntu, 118373087677 windows) and ci.yml run 39344302900 by script.

| Done when                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Per-test durations, both legs, with run id, sha and test count | **verified** — both job logs print 64 per-test rows in step 1 and 64 in step 3, the 0 ms rows included. All 64 rows of the Log's table match the windows and ubuntu step-1 rows by name and ms (128 values). The `Duration`/`tests` figures match too (24.45/24.04/23.74 s and 86.66/86.07/88.33 s), as do the row sums 24,034 and 86,059 and run 39344302900's 25,462 and 112,084 ms, 64 tests each.                                                             |
| 2. Dominant cost named, with a share per candidate cause          | **verified** — git 839 spawns and oxfmt 81 spawns totalling 30,203 ms re-derived from the 949 trace records. Every share-table cell re-derives from the trace summary. The partition holds: 0 overlapping spawns among the vitest worker's 790 (windows) and 787 (ubuntu) sequential records, and cli-side time is subtracted from the test-side CLI rows. The fixture clause carries F1 and row 5 carries F2; neither moves the git 61.4 % / oxfmt 34.2 % split. |
| 3. One measured `git` and one `oxfmt` spawn on windows-latest, ms | **verified** — step 2 summary lines, n=10 each: `git --version` median 37.7 (36.2–43.3), `oxfmt <file.md>` median 340.9 (324.6–361.6). Ubuntu 1.8 and 221.4. All nine table rows match on both legs.                                                                                                                                                                                                                                                              |
| 4. Probe PR closed unmerged, branch deleted                       | **verified** — `gh pr view 577`: `CLOSED`, `mergedAt` null. `git ls-remote --heads origin repo-106-probe` prints nothing.                                                                                                                                                                                                                                                                                                                                         |
| 5. The fix named, follow-up filed                                 | **verified** — repo-113 filed. `npm run status -- --show repo-113` exit 0: status ready, difficulty standard, depends on repo-106. Its three Done when lines are enumerable, with no "every". The id is taken nowhere else (no branch, no other commit touches a `repo-113*` file). `npx vitest run scripts/test/status.test.ts` 139 of 139.                                                                                                                      |

- **F1 · med** · no `Done when` line depends on it, but it bears on the owner's open keep/drop decision on repo-113 · the "fixture-shaped git" row (299 spawns, 21,648 ms, 24.5 %) is called "an upper bound on fixture setup because the same four subcommands also run in test bodies". That reasoning is false: the fixtures also spawn other subcommands. `withLandRepo` runs 18 times (17 call sites, one in a two-case loop), and each run adds `remote add`, `rev-parse`, `push -u` and `checkout -qb`. That is 72 fixture spawns outside the row, about 7.2 s on Windows at the probe's subcommand means. Meanwhile 131 of the row's 299 spawns are not fixture setup: 50 `config`, 40 `add`, 41 `commit`, 45 of the 50 `config` from `land()`'s in-process scratch clone, the rest from test bodies and `land()`. Counted from the code, fixture setup is 245 spawns: 30 `withTicketRepo` runs × 5, plus 18 `withLandRepo` extras × 5. Priced at the Windows means that comes to about 19.3 s, 21.9 %. So the 24.5 % holds on means, but the probe does not establish it. repo-113 repeats the bound in Why, and its Build step 3 prices the copy-once fixture at "up to 21,648 ms". The spawns a copy can replace are the 30 `withTicketRepo` runs' `init`, `config` ×2, `add` and `commit`, about 10.6 s on means. That is half the stated ceiling, and the error runs in the unsafe direction for a keep/drop choice. Not `high`: the stated ceiling is true, only loose, and repo-113's own step 1 re-prices before building. Fix: in the Log and in repo-113's Why and step 3, replace the bound with the code count and its priced estimate, labelled an estimate.
- **F2 · low** · `nfr:maintainability` · row 5 ("the 25 CLI children's own node start … `preflight.mjs`, `gh pr`, `npm run`, `node -p`") double-counts. The 7 spawns that `preflight.mjs` makes (5 `git`, `gh pr`, `npm run`; 276.9 ms on windows, 134.3 ms on ubuntu) sit inside the cli-side `node preflight.mjs` record, and that record is counted whole. The windows trace's first record, `node -p` (137.8 ms, its own pid), starts before any test, so it lies outside the 88,320 ms denominator. Corrected, row 5 is 2,193 ms (2.5 %, not 3.0 %) and "not a spawn" is 1,723 ms (2.0 %, not 1.5 %) on windows. On ubuntu it is 1,261 (5.3 %) and 396 (1.7 %). The "test file's own other 388" git spawns include those 5 from `preflight.mjs`. The error runs in the safe direction: the headline shares are unchanged.
- **F3 · low** · "the longest of 285 files on the Windows leg" — that leg of run 39344302900 prints 292 timed file lines (`Test Files 1 failed | 291 passed | 2 skipped (294)`). The count missed the 7 files whose count reads `(N tests | M skipped/failed)`. "Longest" still holds: the largest excluded file is 49,179 ms. repo-113's Why repeats "285". Nothing relies on the count.
- **dropped** · the instrumented git total reads 54,200 ms when summed per record and 54,201 ms when summed from the summary's rounded group totals, which is the Log's figure. A rounding artifact.
- **dropped** · the probe ran on the `pull_request` merge ref, not on `17277b4f`, whose parent is one commit behind the base. The difference is three ledger and repo ticket files; `scripts/review-record.mjs` and its test are identical.
- **dropped** · a suspected double count through `execFileSync` calling `spawnSync`: the trace counts exactly 48 `git init`. That is 30 `withTicketRepo` runs plus 18 bare inits, one record per spawn.
- **findings** · the hunt returned 6; 3 carried, 3 dropped.
- Citations the Log corrects (`formatMarkdown`, the section spawn in `runOxfmtOnText`, `spliceSection` and its spawn, `spliceAndCommitAll`'s definition and two call sites, five `mkdtempSync` calls) all resolve by content at the head.
- PR #579 checks at `709475f6`: `check`, `changes`, `codeql`, `CodeQL`, `dependency-review` pass; the test matrix is skipped (all-`.md` change).
- Invariants: none reachable (two ticket files, no source); all skipped.
- NFR: security n/a · performance — the subject of the ticket, above · reliability n/a · maintainability — F2.

## Log

- **2026-10-18** — Filed by a maintenance dispatch from the reproduction in the
  table above. The builder added no code and no workflow. Source read at
  `origin/main` `960f4b26`, and the cited files are unchanged at the filing base
  `140bd78a`: the whole-ticket `oxfmt` spawn is at
  `scripts/review-record.mjs:492`, inside `spliceSection`; the section spawn that
  `formatMarkdown` makes is at `:717`. The dispatch said two whole-ticket calls;
  the source has one spawn site, and the count per test is unmeasured. The
  `depends_on` on [repo-100](./repo-100-review-record-formats-the-same-section-three-times-per-landing.md)
  is because repo-100 changes the spawn count in this same file, and a Windows
  reading taken before it lands describes the code that is about to go.
- **2026-10-20** — Measured from one probe pull request. **The dominant cost on
  Windows is `git` process spawns: 61.4 % of the file's time, 839 spawns at
  about 65 ms each. `oxfmt` is 34.2 %, 81 spawns at about 373 ms each. Creating
  the fixtures' directories and files costs nothing measurable.** The fix is
  filed as [repo-113](./repo-113-review-record-test-spawns-839-git-processes-on-windows.md);
  nothing was fixed here.

  **The probe.** Draft PR #577, `chore(repo): DO NOT MERGE time review-record's
  tests on the Windows leg (repo-106)`, head `17277b4f`, two new files only
  (`.github/workflows/repo-106-probe.yml` and
  `scripts/probe/repo-106-spawn-timing.mjs`). Run `39344302919`; jobs
  `118373087447` (ubuntu-latest) and `118373087677` (windows-latest), all steps
  green on both. The probe's source is not reproduced here: it is reachable as
  `refs/pull/577/head` on the closed pull request. The job log is the record. I
  read it with `gh run view 39344302919 --job <id> --log` and parsed it with
  `python3 -I`, ANSI codes stripped. **Closed as the next action after the reading
  was captured:** `gh pr close 577` printed `Closed pull request
  brunolabbe/tools#577`; `git push origin --delete repo-106-probe` printed
  `[deleted] repo-106-probe`; `git ls-remote --heads origin repo-106-probe | wc -l`
  printed `0`.

  Its three steps ran on both legs. (1) `npx vitest run
  scripts/test/review-record.test.ts --reporter=verbose --slowTestThreshold=0`,
  no instrumentation: the per-test reading. `slowTestThreshold=0` was dry-run
  locally first and printed a duration for 64 of 64 tests, the 0 ms ones
  included. (2) `node scripts/probe/repo-106-spawn-timing.mjs timing`: ten
  readings of each spawn in the table below. (3) `node
  scripts/probe/repo-106-spawn-timing.mjs trace scripts/test/review-record.test.ts`:
  the same spec again, with the probe file preloaded into every node process
  (`NODE_OPTIONS=--import <file url>`) to wrap `spawnSync` and `execFileSync`
  and append one line per spawn to a file. That is the only way to see the
  `oxfmt` and `git` spawns made inside the 25 `review-record.mjs` child
  processes the tests run, which the test file's own `vi.mock` spy cannot see.
  It logged 945 spawns on ubuntu and 949 on windows.

  **Done when 1 — the file, both legs, run 39344302919 at `17277b4f`, 64 tests
  each:**

  | Reading                                                              | ubuntu-latest | windows-latest |
  | -------------------------------------------------------------------- | ------------: | -------------: |
  | step 1 (plain), vitest `Duration`                                    |       24.45 s |        86.66 s |
  | step 1 (plain), `tests` figure                                       |       24.04 s |        86.07 s |
  | step 3 (instrumented), `tests` figure                                |       23.74 s |        88.33 s |
  | ci.yml matrix leg, run `39344302900` at the same sha, `Run npm test` |     25,462 ms |     112,084 ms |

  Windows is 3.58 times Ubuntu on the file alone. The instrumented run is
  within 2.6 % of the plain one on Windows and 1.3 % on Ubuntu, so the tracing
  did not move what it measured. The matrix leg's 112,084 ms is 26 s longer than
  the 86 s alone: there the file shares four vCPUs with other test files. That
  contention is named, not measured, because this probe ran the file by itself.
  The matrix line, ANSI codes removed: `test (windows-latest, informational)  Run
  npm test  ✓ repo scripts/test/review-record.test.ts (64 tests) 112084ms`. In
  that run it is the longest of 292 timed test files on the Windows leg (next:
  `tools/downloader/engine/test/parallel-ranges.test.ts`, 75,288 ms) inside a
  vitest `Duration` of 407.24 s; on ubuntu it is 25 s and outside the top six.
  That Windows leg has one red test, `browser-resolver-consent-and-links.test.ts

  > a modal over an age gate (dl-48)`, in a file this change cannot reach; it is
  > not read here.

  **Done when 3 — one spawn each, measured on windows-latest (step 2, ten readings
  each, the median with the range, ms).** A git spawn: **37.7 ms** (36.2 to 43.3,
  `git --version`). An `oxfmt` spawn: **340.9 ms** (324.6 to 361.6, `node
  <oxfmt bin> <file.md>`, in place, the invocation `review-record.mjs` uses).
  The runner CPUs differ: ubuntu was a 4-vCPU Xeon Platinum 8573C, windows a
  4-vCPU AMD EPYC 7763.

  | Spawn                                       | ubuntu median (range) | windows median (range) |
  | ------------------------------------------- | --------------------: | ---------------------: |
  | `git --version`                             |         1.8 (1.7-2.5) |       37.7 (36.2-43.3) |
  | `git -C <repo> rev-parse --show-toplevel`   |         1.8 (1.6-2.0) |       37.2 (35.9-46.1) |
  | `git -C <repo> show HEAD:t.md`              |         1.9 (1.8-2.0) |       39.2 (38.3-40.8) |
  | `git init -q -b main` in a fresh directory  |         3.3 (3.2-3.9) |       65.4 (60.6-69.0) |
  | `git add -A` plus `git commit` (two spawns) |        7.1 (6.9-11.5) |    122.1 (107.6-137.6) |
  | `node -e ""`                                |      21.0 (20.5-24.8) |       44.7 (42.8-46.6) |
  | `oxfmt <file.md>` under `process.execPath`  |   221.4 (217.1-237.3) |    340.9 (324.6-361.6) |
  | `oxfmt --version`                           |      91.8 (90.7-94.1) |    127.4 (122.7-140.8) |
  | `mkdtemp` plus one `writeFile`, no spawn    |           0.1 (0-0.3) |          0.7 (0.6-2.1) |

  A git spawn is 21 times dearer on Windows, an `oxfmt` spawn 1.5 times. The
  "about 2 ms for git and 330 ms for oxfmt" that
  [repo-100](./repo-100-review-record-formats-the-same-section-three-times-per-landing.md)
  quotes from the repo-99 audit are Linux figures: 2 ms is Linux `git`, and
  the Windows one is 38 ms.

  **Done when 2 — the share of the file's time, Windows, instrumented run
  (88,320 ms, the sum of its 64 per-test durations; the same on Ubuntu, 23,732
  ms).** Every row is a measured spawn count and the sum of the wall time of
  those spawns; the last row is what is left, so the rows add to the file.

  | Cause                                                                                                                | spawns (win / ubu) | windows ms | windows share | ubuntu ms | ubuntu share |
  | -------------------------------------------------------------------------------------------------------------------- | -----------------: | ---------: | ------------: | --------: | -----------: |
  | fixture-shaped `git`: `init`, `config`, `add`, `commit`, made by the test file                                       |          299 / 299 |     21,648 |        24.5 % |     1,034 |        4.4 % |
  | whole-ticket `oxfmt` (`spliceSection`, `:492`)                                                                       |            41 / 41 |     16,033 |        18.2 % |    10,632 |       44.8 % |
  | section `oxfmt` (`formatMarkdown`, `:742`)                                                                           |            40 / 37 |     14,170 |        16.0 % |     8,702 |       36.7 % |
  | other `git`: `push` 34 (8,820 ms), the test file's own other 388 (18,422 ms), inside the CLI children 118 (5,311 ms) |          540 / 540 |     32,553 |        36.9 % |     1,707 |        7.2 % |
  | the 25 CLI children's own node start and module load                                                                 |                n/a |      2,193 |         2.5 % |     1,261 |        5.3 % |
  | not a spawn: in-process JavaScript and filesystem work                                                               |                n/a |      1,723 |         2.0 % |       396 |        1.7 % |
  - Row 5 excludes the spawns `preflight.mjs` makes (5 `git`, `gh pr`,
    `npm run`: 276.9 ms on windows, 134.3 ms on ubuntu), which sit inside the
    CLI-side `node preflight.mjs` record already counted whole, and the first
    `node -p` record (137.8 ms on windows, before any test). The 5 `git`
    spawns are among the "test file's own other 388" in row 4.
  - **Fixture setup** is two things. The directories and files are not a cost:
    the whole non-spawn remainder is 2.0 %, and one `mkdtemp` plus a write is
    0.7 ms. The probe does not tell the fixtures' git commands from the same
    subcommands in test bodies, and the first row is not a bound on them: its
    299 spawns (24.5 %) include 131 that are not fixture setup (50 `config`,
    40 `add`, 41 `commit`; 45 of the 50 `config` come from `land()`'s
    in-process scratch clone, the rest from test bodies and `land()`), and
    `withLandRepo` adds `remote add`, `rev-parse`, `push -u` and `checkout -qb`
    outside the row. Counted from the code, fixture setup is 240 spawns: 30
    `withTicketRepo` runs (12 direct call sites and the 18 inside
    `withLandRepo`) at 5 each, plus 18 `withLandRepo` runs at 5 more each.
    Priced at the Windows means below, an **estimate**, that is about 19.3 s,
    21.9 % of the file. The spawns a copied template could replace are the 30
    runs' `init`, `config` x 2, `add` and `commit`: about 10.6 s on means.
  - **The whole-ticket `oxfmt` spawn** is 18.2 % on Windows: 41 spawns, 28 of
    them made in the vitest worker itself (the tests that call `land()` or
    `spliceSection` in-process), 13 inside the CLI children, mean 391 ms. There is one spawn site and 41 reach
    it per run of the file. The dispatch counted two whole-ticket calls; that
    is the number of call sites of `spliceAndCommitAll`, and the spawn count is
    what the trace gives.
  - **The section `oxfmt` spawn**, the one repo-100 memoized, is 16.0 %: 40
    spawns (21 in the vitest worker, 19 in CLI children), mean 354 ms. `oxfmt`
    as a whole is 34.2 % (30,203 ms, 81 spawns, mean 373 ms), and a little over
    half of that is the whole-ticket call.
  - **Why Windows is 3.58 times Ubuntu.** The two legs differ by 64,588 ms.
    `git` accounts for 51,460 ms of that (79.7 %), `oxfmt` for 10,869 ms
    (16.8 %), everything else for 2,259 ms (3.5 %). On Ubuntu `oxfmt` is 81.5 % of the
    file and `git` 11.5 %, which is why repo-100 moved the Ubuntu figure and
    left the Windows one.
  - **Where the time sits among tests:** 25 of the 64 take 1 s or more on
    Windows and add up to 81,408 ms of the 86,059; 32 take under 100 ms and
    add up to 58 ms. The slowest are `land()` tests (7,387, 7,224, 5,440,
    4,366, 4,276 ms) and the `--verify` CLI case (5,726 ms).

  **`git` by subcommand, spawns made by the test file's own process, windows
  instrumented run (count, total ms, mean ms; ubuntu mean in brackets):**
  `add` 70, 4,550, 65.0 (2.8); `checkout` 22, 1,113, 50.6 (3.1); `clone` 17,
  2,608, 153.4 (9.8); `commit` 71, 8,404, 118.4 (5.5); `config` 110, 4,451, 40.5
  (2.3); `diff` 60, 2,436, 40.6 (2.3); `init` 48, 4,243, 88.4 (4.0); `log` 5,
  200, 40.0 (2.1); `ls-files` 28, 1,105, 39.5 (2.0); `push` 34, 8,820, 259.4
  (12.6); `remote` 18, 843, 46.9 (2.9); `rev-parse` 204, 8,477, 41.6 (2.0);
  `show` 14, 788, 56.3 (2.1); `status` 20, 852, 42.6 (2.7). Inside the CLI
  children, 118 more: 5,311 ms on windows, 300 on ubuntu. The `init` mean carries
  one 1,231.6 ms outlier; its median was not recorded.

  **Unmeasured, not ruled out.** Spawn counts per test: the trace is per
  process, so it gives the totals above and not which test made which spawn.
  Why `git` spawn cost is 21 times Linux's (process creation, the runner's
  antivirus, `git`'s own start-up): the probe timed the spawn, not its parts. The
  3 extra section `oxfmt` spawns on Windows (40 against 37; 21 against 18
  in-process): not explained. Whether a smaller file shortens the Windows
  leg's wall time: the file is its longest, but vitest's scheduling across four
  workers was not read. The 26 s of contention in the matrix leg.

  **Citations in this ticket, re-found by content on `6dd274bd`.** The body's
  line numbers moved when repo-100 landed. `formatMarkdown` is `:722` (ticket:
  `:712`); the section `oxfmt` spawn is inside `runOxfmtOnText`, `:742` (`:717`);
  `spliceSection` is `:416` and its spawn `:492`, both unchanged;
  `spliceAndCommitAll` is defined at `:1104` and called at `:1456` and `:1509`
  (`:1431`, `:1484`). The fixture `mkdtempSync` lines in
  `scripts/test/review-record.test.ts` are `:243`, `:1076` and `:1313` (`:234`,
  `:1067`, `:1328`); `:1623` and `:1689` are two more `mkdtempSync` calls in
  tests that the ticket did not name. The body is left as filed.

  **Done when 5 — the fix, and what I did not fold in.** Reducing `git`
  spawns in the file's fixtures and `land()` tests is the one fix the reading
  names, filed as repo-113 with this Log's numbers as its baseline. None is
  needed for the Ubuntu leg. I considered folding in the corrected citations
  above as an edit to this ticket's body and did not: a filed ticket's body is a
  record of what its filer saw, and the Log is where the dispatch asked for them.

  **Per-test durations, plain run (step 1), ms.** Sums: 24,034 ubuntu and 86,059
  windows, the two `tests` figures above. The instrumented run's own 64 rows
  are in the same job logs.

  |   # | Test                                                                           | ubuntu ms | windows ms |
  | --: | ------------------------------------------------------------------------------ | --------: | ---------: |
  |   1 | parseArgs reads the ticket, the section file, and an absent --gate             |         2 |          4 |
  |   2 | parseArgs reads --gate as a number, wherever it falls in argv                  |         0 |          0 |
  |   3 | parseArgs refuses a --gate that is not a positive integer                      |         1 |          1 |
  |   4 | parseArgs refuses an unknown flag and the wrong number of positionals          |         0 |          1 |
  |   5 | validateFirstLine requires exactly "## Review" when --gate is absent           |         1 |          1 |
  |   6 | validateFirstLine matches "### Gate <n>" on a digit boundary, not a prefix     |         0 |          1 |
  |   7 | planInsertion anchors the first review on "## Log", by heading form            |         1 |          1 |
  |   8 | planInsertion is not fooled by "## Log" quoted inline in prose above the re... |         0 |          0 |
  |   9 | planInsertion refuses a first review when "## Review" already exists           |         0 |          1 |
  |  10 | planInsertion refuses --gate when there is no "## Review" yet                  |         0 |          0 |
  |  11 | planInsertion appends a later gate at the end of the existing "## Review" b... |         0 |          0 |
  |  12 | insertSection followed by locateInsertedBlock recovers exactly what was ins... |         0 |          1 |
  |  13 | normalizeForDiff treats differently padded tables as equal                     |         0 |          0 |
  |  14 | normalizeForDiff leaves a non-table line untouched                             |         0 |          0 |
  |  15 | normalizeForDiff trims trailing blank lines only                               |         0 |          0 |
  |  16 | splices the first review above "## Log" even when prose quotes "## Review" ... |       557 |       1404 |
  |  17 | a gate appended later lands inside the existing "## Review" block, after ga... |      1074 |       2599 |
  |  18 | a table the formatter re-pads reports an empty normalised diff                 |       538 |       1374 |
  |  19 | refuses a second first-review call once "## Review" already exists on disk     |       598 |       1627 |
  |  20 | refuses to run when the ticket has uncommitted changes against HEAD, and to... |        73 |        595 |
  |  21 | the disclosure diff is bounded to the end of "## Review", not a gate's own ... |      1107 |       2666 |
  |  22 | refuses to re-append a gate number that already exists under "## Review"       |       596 |       1651 |
  |  23 | planInsertion refuses a gate number that already exists under "## Review" (... |         0 |          0 |
  |  24 | locateInsertedBlock bounds a gate's block to the end of "## Review", past i... |         0 |          1 |
  |  25 | the dirty-ticket refusal advises committing, never stashing                    |        72 |        625 |
  |  26 | refuses to run when the ticket is not tracked by git yet, and touches nothing  |        63 |        584 |
  |  27 | parseVerifyArgs reads --gate and --rev around the positionals, HEAD by default |         1 |          2 |
  |  28 | locateGateBlock ends an earlier gate at the next gate heading, not at the e... |         1 |          1 |
  |  29 | compareRecord accepts what the formatter rewrites and rejects a reworded bu... |       225 |        412 |
  |  30 | differingLines maps the diff's new side onto the ticket's own line numbers     |         3 |         40 |
  |  31 | --verify passes a committed record, then fails naming the line once a lande... |      2578 |       5726 |
  |  32 | a splice whose block does not come back as the section file is restored to ... |       559 |       1441 |
  |  33 | a gate body quoting a '### Gate <n> …' heading moves neither end of any gat... |       478 |        725 |
  |  34 | differingLines skips git's no-newline marker without miscounting the lines ... |         0 |          0 |
  |  35 | locateGateBlock matches the right 'Gate 1' heading when the section text is... |         1 |          0 |
  |  36 | detectGate reads gate 1 from "## Review" and a later gate from its own heading |         0 |          0 |
  |  37 | detectGate refuses a section file that opens with neither shape                |         0 |          0 |
  |  38 | setStatus replaces the frontmatter status line and nothing else                |         0 |          0 |
  |  39 | setStatus refuses a ticket with no frontmatter, or with no status line         |         0 |          0 |
  |  40 | parseLandArgs reads a ticket, one or more sections in order, and the three ... |         0 |          0 |
  |  41 | parseLandArgs refuses a missing flag, an unknown one, and a bad --status       |         0 |          1 |
  |  42 | land() splices two gates, sets status, pushes and verifies — one call, a fi... |      2294 |       7224 |
  |  43 | land() validates every section against a scratch clone before any commit, s... |       591 |       2736 |
  |  44 | land() never touches the real repository while validating — an unrelated un... |        82 |       1333 |
  |  45 | land() names "push" when the remote already holds a commit this branch has ... |       889 |       4198 |
  |  46 | spliceSection and verifySection are what main() and verifyMain() now call      |       532 |       1619 |
  |  47 | the --land CLI refuses a missing flag before touching git, naming it on stderr |        84 |        940 |
  |  48 | the --land CLI lands the commit and the push for real, then fails naming "p... |      1085 |       4234 |
  |  49 | setStatus closes a CRLF frontmatter correctly, and keeps its line endings CRLF |         0 |          0 |
  |  50 | runPreflightDefault passes --title through to the real preflight.mjs argv (... |         1 |          1 |
  |  51 | land() refuses at setup when a tracked file has an uncommitted change, befo... |        58 |       1361 |
  |  52 | land() names the failing section file in a splice failure's detail (gate 2,... |       581 |       2872 |
  |  53 | land() leaves no scratch directory behind, whether validation passes or fai... |      1406 |       5440 |
  |  54 | land() prints the reset command on a push failure too, not only on prefligh... |       937 |       4366 |
  |  55 | parseLandArgs reads --branch                                                   |         0 |          0 |
  |  56 | land() refuses a detached HEAD with no --branch before it commits anything     |       246 |       1167 |
  |  57 | land() pushes a detached HEAD to the branch --branch names                     |       880 |       3773 |
  |  58 | land() creates its scratch clone with gc.auto=0, so a commit there cannot s... |       908 |       3610 |
  |  59 | land() reports a scratch-clone cleanup failure as a warning naming the left... |       915 |       4276 |
  |  60 | land() after a successful push says the landing is pushed and prints no res... |      1780 |       7387 |
  |  61 | land() keeps the reset command on a verify failure after the push, and says... |       905 |       3594 |
  |  62 | failedChecks reads the checks off preflight's last line, and none off a lin... |         0 |          1 |
  |  63 | land() after a halted merge-tree failure names every check that is still op... |       869 |       3730 |
  |  64 | formatMarkdown spawns oxfmt once for repeated identical input, and again fo... |       462 |        712 |

- 2026-10-20 — Fixed at landing by owner choice: gate 1, F1 — "the 'fixture-shaped
  git' row (299 spawns, 21,648 ms, 24.5 %) is called 'an upper bound on fixture
  setup because the same four subcommands also run in test bodies'. That
  reasoning is false". The bound is replaced, in the Fixture setup bullet above
  and in repo-113's Why and Build step 3, by the count from the code and its
  priced estimate, labelled an estimate. **One figure differs from the finding:**
  it writes 245 spawns, but its own formula (30 `withTicketRepo` runs x 5 plus
  18 `withLandRepo` runs x 5) is 240, its own subtraction (299 - 131 = 168 in
  row, plus 72 outside) is 240, and its price (about 19.3 s, 21.9 %) is the
  price of 240; 240 is what is written. Before, at `709475f6`: `git show
  709475f6:<repo-106> | grep -c "that is an \*\*uppe[r]"` → 1, and the same
  pattern for `21,64[8]` on repo-113 → 2. After: `bash <scratch>/land/prove.sh` →
  `fixture setup is 24[0] spawns => 1 ; 1` (repo-106 whole file ; repo-113 above
  its `## Log`), `estimate of up to about 10.[6] s => 0 ; 1` (the 0 is that
  repo-106 does not carry step 3), and for the old wording, counted above this
  first Fixed-at-landing entry, `an upper bound => 0 ; 0` and `upper bound => 0 ; 0`.
- 2026-10-20 — Fixed at landing by owner choice: gate 1, F2 — "row 5 ... double-counts.
  The 7 spawns that `preflight.mjs` makes ... sit inside the cli-side `node
  preflight.mjs` record, and that record is counted whole. The windows trace's
  first record, `node -p` ..., starts before any test". Row 5 and the
  not-a-spawn row are corrected in the table to the finding's figures, the rows
  still add to 88,320 ms and 23,732 ms, and a bullet under the table says what
  row 5 excludes and that the 5 `git` spawns sit in row 4's "other 388". Before,
  at `709475f6`: the grep for the old row-5 figure `2,60[7]` → 1 and for the old
  not-a-spawn figure `1,30[9]` → 1. After: `bash <scratch>/land/prove.sh` →
  `2,19[3] .*2.5 % => 1 ; 0`, `1,72[3] .*2.0 % => 1 ; 0`, and for the old text above
  this entry `2,607 => 0 ; 0`, `1,309 => 0 ; 0`, `module load, .preflight => 0 ; 0`.
- 2026-10-20 — Fixed at landing by owner choice: gate 1, F3 — "'the longest of 285
  files on the Windows leg' — that leg of run 39344302900 prints 292 timed file
  lines". Corrected here and in repo-113's Why, which repeated it. Before, at
  `709475f6`: `longest of 28[5]` → 1 in repo-106 and 1 in repo-113 above its Log.
  After: `bash <scratch>/land/prove.sh` → `longest of 29[2] timed => 1 ; 1` and, for
  the old text above this entry, `longest of 285 => 0 ; 0`. The patterns that
  find the new text carry a bracket so this entry does not match itself; the
  old-text counts stop at the first Fixed-at-landing entry with `awk
  '/Fixed at landing by owner choice/{exit} {print}'`, because these entries
  quote what they removed; repo-113's are taken above its `## Log` with `awk
  '/^## Log/{exit} {print}'`.
- 2026-10-20 — Owner's answer on repo-113, asked with the options "keep it ready
  (Recommended, the builder's) / drop it / keep but park it": **keep it ready**.
  repo-113's status stays `ready`.
