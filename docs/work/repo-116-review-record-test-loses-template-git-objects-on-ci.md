---
id: repo-116
tool: repo
title: review-record.test.ts's fixture copy fails with ENOENT on a .git/objects path, three times on CI
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-116 — review-record.test.ts's fixture copy fails with ENOENT on a .git/objects path, three times on CI

## Why

`scripts/test/review-record.test.ts` builds one committed fixture repository per
file and copies it for each test that uses the default ticket (`withTicketRepo`,
from [repo-113](./repo-113-review-record-test-spawns-839-git-processes-on-windows.md)).
Three times in four days, that copy failed on `ubuntu-latest` with `ENOENT` on a
`.git/objects` path under the copy's destination, and the test failed with it:
twice in the 60 `ci.yml` runs the filing counted, and a third time on a `push` to
`main` after it (below). No other test failed in any of the three runs. The
failure had not been reproduced locally when this was filed.

The three readings, with ANSI codes removed, from `gh run view <run> --log-failed`
(the first with `--attempt 1 --job 120728098807`):

Run `40046099052` (PR #604, head `db204337`, branch `lg-64-radios-and-name-field`):

```
FAIL  repo scripts/test/review-record.test.ts > a gate appended later lands inside the existing "## Review" block, after gate 1
Error: ENOENT, No such file or directory '/tmp/review-record-EzRxCH/.git/objects'
 ❯ withTicketRepo scripts/test/review-record.test.ts:323:8
 ❯ scripts/test/review-record.test.ts:386:39
 Test Files  1 failed | 304 passed | 1 skipped (306)
      Tests  1 failed | 6522 passed | 2 skipped (6525)
Serialized Error: { errno: 2, code: 'ENOENT', path: '/tmp/review-record-EzRxCH/.git/objects', syscall: 'cp' }
```

Run `39531046583` (branch `release-please--branches--main--components--planner`, created 2026-10-21T02:05:22Z):

```
FAIL  repo scripts/test/review-record.test.ts > a gate appended later lands inside the existing "## Review" block, after gate 1
Error: ENOENT, No such file or directory '/tmp/review-record-PjNSKN/.git/objects'
 ❯ withTicketRepo scripts/test/review-record.test.ts:323:8
 ❯ scripts/test/review-record.test.ts:386:39
 Test Files  1 failed | 299 passed | 1 skipped (301)
      Tests  1 failed | 6323 passed | 2 skipped (6326)
Serialized Error: { errno: 2, code: 'ENOENT', path: '/tmp/review-record-PjNSKN/.git/objects', syscall: 'cp' }
```

Run `40059133782` (a `push` to `main`, head `a99bde49be56d441de166a76a6602902418c6982`,
created 2026-10-24T03:38:33Z, job `test (ubuntu-latest)` `120768938189`, attempt 1;
filed into this ticket by the builder, read with `gh run view 40059133782 --log-failed`):

```
FAIL  repo scripts/test/review-record.test.ts > a gate appended later lands inside the existing "## Review" block, after gate 1
Error: ENOENT, No such file or directory '/tmp/review-record-74LOcr/.git/objects'
 ❯ withTicketRepo scripts/test/review-record.test.ts:323:8
 ❯ scripts/test/review-record.test.ts:386:39
 Test Files  1 failed | 307 passed | 1 skipped (309)
      Tests  1 failed | 6525 passed | 2 skipped (6528)
Serialized Error: { errno: 2, code: 'ENOENT', path: '/tmp/review-record-74LOcr/.git/objects', syscall: 'cp' }
```

Line 323 is `fs.cpSync(ticketRepoTemplateDir(), dir, { recursive: true });` and line
386 is the failing test's `withTicketRepo()` call, both at `8a6dcf9a`. The path is
the copy's destination (`review-record-<random>`), not the template
(`review-record-template-<random>`).

**What the code shows.** These are observations, not a cause. None of the
hypotheses below is confirmed.

- The failing test (line 385) is the first in the file to call `withTicketRepo()`
  with the default prose. The template is memoised (lines 288–303) and built on
  that first call, so in declaration order it is the first copy of a template
  built moments before. `vitest.config.ts` sets no `sequence.shuffle` and no
  `concurrent`. The file has 12 such calls (`grep -c 'withTicketRepo()'`), and in
  both failing runs the other 11 copies passed. A bad template would fail every
  copy, so the template's content is not the whole story.
- The template's `afterAll` (line 306) runs after the file's last test, so it
  cannot be what removed the template during this test.
- Nothing in the repo removes a `review-record-<random>` directory except its own
  test's `cleanup`. `grep -rn "review-record" scripts packages tools` finds this
  file and `land()`'s scratch prefix `review-record-land-`, not this prefix. A
  remover outside the repo, on the runner, is not ruled out, and nothing in the
  repo would show it.
- A `git` process still writing into the template or the copy would explain a
  recursive copy that reads a directory which changes under it. Neither the test
  nor `buildTicketRepo` starts one, and the template holds a few objects, far
  below git's default auto-gc threshold. Not tested.
- Node's recursive copy might create `.git` and `.git/objects` in an order that
  fails for a freshly written source. Not tested. CI runs Node 22; this container
  runs `v22.23.3`.

**History.** The template was introduced by `c686254e` (repo-113 step 3, PR #590),
authored 2026-10-20 22:03 −0400 (02:03Z). The first failing run was created two
minutes later. That is the author date, not the merge time, so the gap is only
indicative.

**Frequency.** `gh run list --workflow ci.yml --limit 60` (2026-10-21T02:05Z to
2026-10-24T02:19Z): 37 success, 21 cancelled, 1 completed failure
(`39531046583`), and `40046099052` with an empty conclusion because its attempt 2
is running after attempt 1 failed. The 21 cancelled runs are not read. So 2 failed
attempts out of the 39 runs that completed or are running. The third failure,
`40059133782`, was created at 2026-10-24T03:38:33Z, after that window closed, and
the filing's "twice" counted only inside it.

## Build

This is a reproduction-first ticket. Do not change the test until the probe below
names a cause.

1. **Reproduce.** Write a probe script in the scratch directory that runs
   `scripts/test/review-record.test.ts` repeatedly, under CPU contention, and
   counts runs whose output names `ENOENT`. Record the contention used.
2. **Test each hypothesis** in "What the code shows" with its own probe, and
   record it in the Log as confirmed or refuted, with its command and output.
3. **Fix only the cause the probe names.** A retry around the copy, or a copy per
   test (dropping `ticketRepoTemplateDir`), is a workaround and undoes repo-113's
   step 3. Neither is chosen here. If the cause stays unnamed, stop and put the
   options to the owner, with their costs, instead of shipping a retry.

## Done when

1. The Log holds the probe's count of failing runs out of 20 on `main`, with the
   contention it ran under. A count of 0 is recorded as 0 and the ticket stays
   open.
2. The Log names each hypothesis in "What the code shows" as confirmed or
   refuted, with its command and output.
3. At the fixed head, the same probe reports 0 of 20 runs naming `ENOENT`, and
   `npx vitest run scripts/test/review-record.test.ts` passes 64 of 64 with the
   test names unchanged from `main`.

## Log

- **2026-10-24** — Filed by the orchestrator's maintenance dispatch. **The owner
  chose to file this on 2026-10-24**, rather than only re-running or fixing it
  now. `difficulty: standard` was set by the filer: the format requires a value at
  filing, and the owner may re-rate it.

  Commands and their output. Nothing in the source was changed.
  - `gh run view 40046099052 --attempt 1 --job 120728098807 --log-failed`: the
    lines quoted in Why, with `/tmp/review-record-EzRxCH/.git/objects`, `Test Files
1 failed | 304 passed | 1 skipped (306)` and `Tests 1 failed | 6522 passed | 2
skipped (6525)`.
  - `gh run view 39531046583 --log-failed`: the same test, `/tmp/review-record-PjNSKN/.git/objects`,
    `Test Files 1 failed | 299 passed | 1 skipped (301)` and `Tests 1 failed | 6323
passed | 2 skipped (6326)`.
  - `gh run list --workflow ci.yml --limit 60 --json databaseId,conclusion,headBranch,createdAt`:
    37 success, 21 cancelled, 1 `failure` (`39531046583`), 1 empty (`40046099052`).
  - `gh pr checks 604`, head `db204337c6510ec44e085c3dd93cf76ce71dc9f0`, read after
    the re-run: `test (ubuntu-latest)` **pending** (job `120751355964`, attempt 2 of
    run `40046099052`); attempt 1's job `120728098807` failed. `test (windows-latest,
informational)` and the other checks pass.
  - `npx vitest run scripts/test/review-record.test.ts` at `8a6dcf9a`, one run
    (Node `v22.23.3`): `Test Files 1 passed (1)`, `Tests 64 passed (64)`, exit 0,
    33.80 s. This is one reading, and it does not reproduce the failure.
  - `grep -c 'withTicketRepo()' scripts/test/review-record.test.ts`: `12`.

- **2026-10-24 — built (builder; no ship authority).** **Cause named and fixed.**
  `git commit` in git 2.55.0, the version the runner has, ends by starting `git
maintenance run --auto --quiet --detach`. That process takes
  `objects/maintenance.lock`, forks into the background and removes the lock when the
  child next gets the CPU, so `git commit` returns with a regular file in
  `.git/objects` that is gone a moment later. `fs.cpSync` lists `objects`, then
  copies each entry, and a file that was listed and then vanished is the `ENOENT`.
  Hypothesis 3 below is the one confirmed, with a correction to how the brief put it.
  The fix is one line of fixture config, `[maintenance] auto = false`, written to
  `.git/config` before the template's commit (`disableAutoMaintenance` in
  `scripts/test/review-record.test.ts`). It is not a retry and not a copy per test.

  The probes are `.mjs` files in the builder's scratch directory
  (`/tmp/claude-1000/-workspaces-tools/f72d6af1-5b10-4e8c-b0e5-2fd8b586a66c/scratchpad/repo-116/build/`:
  `probe.mjs`, `micro.mjs`, `stress.mjs`, `burn.mjs`, `mechanism.mjs`, `lockwatch.mjs`,
  `trace.mjs`); they are not committed, and each command below says what it did.

  **Third occurrence.** `gh run view 40059133782 --log-failed`: a `push` to `main`
  at `a99bde49`, `test (ubuntu-latest)`, the same test, `ENOENT ...
'/tmp/review-record-74LOcr/.git/objects'`, `Test Files 1 failed | 307 passed | 1
skipped (309)`, `Tests 1 failed | 6525 passed | 2 skipped (6528)`. The title and the
  Why said "twice"; they now say three times (the filing counted inside a 60-run
  window that closed before this run).

  **Load applied.** The machine has 12 cores and a live peer session. Every
  contention figure below is `burn.mjs`: N busy loops, each ending itself at a
  deadline (60 to 300 s) and killed by pid when its run ended. Nothing outlived a
  sweep. Load before the first sweep: `uptime` 2.66 3.64 2.38.

  **Reproduction.** The same fixture steps and the same `fs.cpSync` as
  `buildTicketRepo` and `withTicketRepo`, without vitest (`micro.mjs fresh`: build a
  template, copy it once, repeat; 8 processes in parallel under 10 busy loops for
  90 to 120 s, driven by `stress.mjs`):

  | git                                                                            | `maintenance.auto`                                                                  | failures / builds                                     | error                                                                                 |
  | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
  | 2.43.0 (this container's)                                                      | default                                                                             | 0 / 8000 under load; 0 / 100 builds with no load      | none                                                                                  |
  | 2.55.0 (built from the kernel.org tarball with `NO_RUST=1 NO_CURL=1`, scratch) | default                                                                             | 7 / 4800, 4 / 4800 (90 s load), 7 / 8000 (120 s load) | `ENOENT, No such file or directory '/tmp/rr-probe-XXXXXX/.git/objects'`, syscall `cp` |
  | 2.55.0                                                                         | `-c maintenance.auto=false`                                                         | 0 / 8000 (120 s load)                                 | none                                                                                  |
  | 2.55.0                                                                         | `[maintenance] auto = false` in `.git/config` before the commit: the fix's own line | 0 / 8000 (120 s load)                                 | none                                                                                  |

  The 2.55.0 rows have the message and path shape of the three CI failures. The last
  two rows ran under the same 10 busy loops for 120 s as the 7 / 8000 row.

  **Why the message names `objects`.** `src/node_file.cc` at `v22.23.3` (read with
  WebFetch, summarised, not quoted whole) reports the destination directory of the
  level being copied, not the file, for a failed regular-file copy. `mechanism.mjs 100`
  (a child creating and renaming `tmp_obj_*` files in `src/objects` while the parent
  copies `src`): `rounds=100 [ [ 'ENOENT path=objects syscall=cp', 40 ] ]`. So the
  error means a regular file directly in `.git/objects` was listed and then gone. A
  finished fixture has only directories there (`15 7e 9d cb info pack`), so the file
  is transient.

  **What the file is.** `git-2.55.0/builtin/gc.c`, `maintenance_run_tasks`: it holds
  `<objects>/maintenance.lock` (`hold_lock_file_for_update(&lk, lock_path, ...)`), runs
  the foreground tasks, calls `daemonize()` when `--detach`, runs the background tasks,
  then `rollback_lock_file(&lk)`. `GIT_TRACE2_EVENT` on the fixture's `commit`
  (`trace.mjs`): git 2.43.0 has `child_start ["git","maintenance","run","--auto","--quiet"]`,
  which the commit waits for; git 2.55.0 has `child_start
["git","maintenance","run","--auto","--quiet","--detach"]`, and that process
  records `region_enter "maintenance"` and then `exit 0` in the parent. Seen
  directly: `lockwatch.mjs <git> 150 40` (build the fixture, then poll `.git/objects`
  for 40 ms after `commit` returns, under 10 busy loops): git 2.55.0 `regular files
seen directly in objects/ after commit returned: [["maintenance.lock",71]]`, so in
  71 of 150 builds; git 2.43.0 `[]`, run straight after under the same loops. With no
  load, 60 builds of each were `[]`: the window is milliseconds, and the runner is
  slower than this machine.

  **The hypotheses in "What the code shows".**
  1. _The template's `afterAll` removed it during the test._ **Refuted.** `grep -n
afterAll scripts/test/review-record.test.ts`, run at `524d6352` (line numbers
     differ from the `8a6dcf9a` ones in Why, which this build moved):

     ```
     20:import { afterAll, expect, test, vi } from "vitest";
     322:afterAll(() => {
     ```

     The one hook (322) removes only `ticketRepoTemplate` (`fs.rmSync(ticketRepoTemplate,
{ recursive: true, force: true })`, lines 323 to 325), and vitest runs it after the
     file's last test. The failure also names the copy's path, not the template's.

  2. _A remover outside the repo deleted `review-record-<random>`._ **Refuted**, as the
     cause. Nothing in the repo removes it, and the failure reproduces with nothing
     outside the copying process touching the directories; it stops when the fix's one
     config line is added.
     - `grep -rn "review-record-" scripts packages tools --include=*.ts --include=*.mjs`,
       run at `524d6352` (14 lines; the three `scripts/review-record.mjs` lines are other
       prefixes, `-diff-`, `-fmt-` and `-land-`; the 11 in `scripts/test/review-record.test.ts`
       are `mkdtemp` prefixes, a prefix constant and its `startsWith`, a regex and two
       comments):

       ```
       scripts/review-record.mjs:344:  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-diff-"));
       scripts/review-record.mjs:738:  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-fmt-"));
       scripts/review-record.mjs:1441:    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-land-"));
       scripts/test/review-record.test.ts:307:      fs.mkdtempSync(path.join(os.tmpdir(), "review-record-template-")),
       scripts/test/review-record.test.ts:337:  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "review-record-")));
       scripts/test/review-record.test.ts:1157:  const bareDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "review-record-origin-")));
       scripts/test/review-record.test.ts:1394:    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-other-"));
       scripts/test/review-record.test.ts:1689:  // `review-record-land-*` entry there is racy the moment a second session
       scripts/test/review-record.test.ts:1703:    fs.mkdtempSync(path.join(os.tmpdir(), "review-record-private-tmp-")),
       scripts/test/review-record.test.ts:1712:    const prefix = "review-record-land-";
       scripts/test/review-record.test.ts:1769:    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-other-"));
       scripts/test/review-record.test.ts:1899:    // The clone is identified by its name, `review-record-land-*`, never by
       scripts/test/review-record.test.ts:1910:        if (path.basename(repo).startsWith("review-record-land-")) {
       scripts/test/review-record.test.ts:2178:        Array.isArray(args) && args.some((a) => /review-record-fmt-.*section\.md$/.test(String(a))),
       ```

       None of them removes a `review-record-<random>` directory; the copy's own
       `cleanup` removes it through a variable the grep cannot match.

     - The refuting evidence is gate 1's reproduction (gate 1's full report, section
       "### 1. The causal claim, with my own reproduction"; the builder's own table
       above agrees). `node gate-1/repro.mjs driver <git 2.55.0 bin> on 8000 8 10 …`
       builds the fixture and copies it with `fs.cpSync` in a private `TMPDIR`, in 8
       processes under 10 busy loops, with no other process touching those
       directories: `"builds":8000,"failures":14,…"seconds":86.204`, every failure
       `ENOENT path=…/g1-copy-X/.git/objects syscall=cp`, the CI error's shape. The same
       command with `[maintenance] auto = false` in `.git/config` before the commit (the
       fix's line): `"builds":8000,"failures":0,…"seconds":71.375`. With git 2.43.0 and
       the default: `"failures":0` of 8000. A remover outside the repo would not be
       stopped by a config line git reads, so it is not the cause.
  3. _A `git` process still writing into the template._ **Confirmed, in a changed
     form:** not a process writing objects but the detached `git maintenance` child
     holding `objects/maintenance.lock`. The brief said neither the test nor
     `buildTicketRepo` starts one; `git commit` does, in git 2.55.0.
  4. _Node's recursive copy creating `.git` and `.git/objects` in an order that fails
     for a freshly written source._ **Refuted.** Node 22.23.3 copies the same freshly
     written fixture 0 / 8000 times under the same load with git 2.43.0 and 0 / 8000
     with git 2.55.0 and `maintenance.auto=false`. The only variable that moved the
     count was the maintenance child.

  The first bullet there (a bad template would fail every copy) is an observation and
  stands: the template is good, and a transient file in it is not.

  **Done when.**
  1. _Probe count on `main`, with its contention._ `probe.mjs <tree> 20 6 <out>` runs
     `vitest run scripts/test/review-record.test.ts` 20 times one after another, with 6
     busy loops for the length of each run, git 2.43.0: `probe: 0 of 20 runs named
ENOENT; 0 of 20 exited non-zero`, every run `Tests 64 passed (64)`, 908 s in all.
     Also `vitest run scripts/test/` (14 files, no added load, 10 runs): `0 of 10`,
     `Tests 571 passed (571)`, 409 s. A 0 is recorded as 0. This probe cannot see the
     failure: one exposed event per run at roughly 0.1 % per event (the 7 / 8000 above)
     is not visible in 20 runs. **The same probe against `main` with git 2.55.0 was not
     run.**
  2. _Each hypothesis_: above.
  3. _The fixed head._ `probe.mjs <tree> 20 6 <out> <scratch git 2.55.0 bin>` (git 2.55.0
     first on `PATH`; the probe prints `git on the probe's PATH: git version 2.55.0`):
     `probe: 0 of 20 runs named ENOENT; 0 of 20 exited non-zero`, every run `Tests 64
passed (64)`, 829 s in all. As uninformative as the sweep on `main`; the evidence
     that the line removes the failure is the last row of the table, 0 / 8000 against 7
     / 8000 for the same load, the same git and the same copy. The test names are
     unchanged: no `test(` line was added, removed or renamed.

  **Not done.**
  - Other places that run `git commit` and then copy or clone a repository are not
    changed. In this file only `withTicketRepo` copies one. `land()` in
    `scripts/review-record.mjs` clones the fixture with `--no-hardlinks`, which also
    copies `objects/`; whether `git clone` tolerates a vanished `maintenance.lock` is
    not measured here, so it is not claimed exposed or safe. The fixtures it clones are
    built by `buildTicketRepo` and now carry the setting; a real checkout carries none.
    That needs its own reproduction before it is a ticket.
  - The setting is in `buildTicketRepo` only: the bare and `otherDir` repos the `land()`
    tests build are untouched, and nothing copies them.

- **2026-10-24 — gate 1's round applied, and the owner's three answers (fixer; no ship
  authority).** Gate 1 (`89a38d30..524d6352`, FAIL) carried one high. It is fixed in the
  built entry above: hypothesis 2 now reads **Refuted**, with gate 1's reproduction
  (14 of 8000 without the fix, 0 of 8000 with it) cited by command and output, and
  hypotheses 1 and 2 carry the real output of `grep -n afterAll …` and `grep -rn
"review-record-" …` run at `524d6352`. The second grep printed 14 lines (3 in
  `scripts/review-record.mjs`, 11 in the test file); gate 1's finding counted "11
  `mkdtemp`/comment hits", which is the test file's share only, and 2 of those 11 are not
  `mkdtemp` or comment lines (the prefix constant and the `startsWith` and regex uses).
  None removes `review-record-<random>`, as the finding said. No `Done when` line,
  `status` or code changed.

  **The owner's answers, 2026-10-24.** Each was the orchestrator's recommendation, and
  nothing was overridden.
  1. _Done when 1._ Gate 1's open decision. **Question:** Done when 1, read literally,
     keeps the ticket open because the 20-run count on `main` was 0, taken on git 2.43.0,
     which cannot fail; a 20-run sweep has about 3.4% power at the measured rate. What
     closes it? **Options:** (a) accept the build's and gate 1's micro-reproductions
     (14 of 8000 to 0 of 8000) in place of line 1's count, and the ticket closes; (b) land
     `in-flight` with an `awaiting` reading of no ENOENT across the next 40 `ci.yml` runs
     on `main`; (c) keep it open and run line 1's probe on `main` with git 2.55.0 until it
     counts a failure (about 570 runs, about 7 h). **Chosen: (a).**
  2. _Done when 3's "0 of 20 at the fixed head" clause_, graded `unproven (scope)` by gate
     1 because the dispatch capped it at three whole-file runs. **Options:** accept the
     builder's logged sweep (0 of 20, git 2.55.0 on `PATH`, 6 busy loops, 829 s),
     corroborated by gate 1's 0 of 8000 and CI on runner git 2.55.0; or have gate 2 re-run
     20 whole-file runs. **Chosen:** accept the builder's sweep.
  3. _The builder's follow-up question._ Whether to file a ticket for `land()`'s `git
clone --no-hardlinks` being exposed to the same lock. Gate 1 measured no exposure
     (`gc.auto 0` in `land()` leaves the clone's commit with no `child_start` on git
     2.55.0, and nothing copies the clone). **Options:** no ticket; file one anyway.
     **Chosen:** no ticket. The probe scripts stay uncommitted in scratch. The "Not done"
     bullet above about `land()` therefore stands as written, with gate 1's measurement
     as its answer.
