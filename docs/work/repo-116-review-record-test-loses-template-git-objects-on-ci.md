---
id: repo-116
tool: repo
title: review-record.test.ts's fixture copy fails with ENOENT on a .git/objects path, three times on CI
kind: fix
status: done
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

## Review

**Gate: FAIL** — 2026-10-24 · `89a38d30..524d6352` · Opus 5.5, depth standard

| Done when                                                                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The Log holds the probe's count of failing runs out of 20 on `main`, with its contention; a 0 is recorded as 0 and the ticket stays open                                    | **verified** by reading. The Log holds `0 of 20`, 6 busy loops, git 2.43.0, and `status: ready` at this head. Two things this does not settle. The count was taken with a git that cannot produce the failure (the gate measured 0 of 8000 copies on 2.43.0). And the line's "stays open" clause binds whoever lands it: see the open decision below                                                                                                                                                                                                           |
| 2. The Log names each hypothesis in "What the code shows" as confirmed or refuted, with its command and output                                                                 | **not met.** The Log calls the outside-remover hypothesis "**Not confirmed, and not needed**", which is neither confirmed nor refuted. Two of the cited commands come with a paraphrase where the output should be (`grep -n afterAll …`, `grep -rn "review-record-" …`). See the high finding below                                                                                                                                                                                                                                                           |
| 3. At the fixed head the same probe reports 0 of 20 ENOENT runs, and `npx vitest run scripts/test/review-record.test.ts` passes 64 of 64 with test names unchanged from `main` | **unproven (scope)** for the 0-of-20 clause: the dispatch caps the gate at three whole-file runs, and the gate ran one. The other clauses are **verified**. With git 2.55.0 first on `PATH`: `Tests 64 passed (64)`, exit 0, 32 s. `git diff 89a38d30 HEAD -- scripts/test/review-record.test.ts` changes 0 `test(` lines, and both trees have 64. CI's `test (ubuntu-latest)` passed on `524d6352` (runner git 2.55.0). The Log's 0 of 8000 against 7 of 8000 is stronger evidence for the fix than the line asks for, but it is not the probe the line names |

- **high** · Done when 2 depends on it · The Log's hypothesis 2 (_a remover outside the repo_) is graded "Not confirmed, and not needed". The line allows only "confirmed" or "refuted". Evidence to refute it as the cause does exist. The gate's own reproduction got the CI error's exact shape (`ENOENT path=<copy>/.git/objects syscall=cp`) 14 times in 8000 builds, with nothing else touching the directories, and 0 times in 8000 once the fix's one config line was added. The Log has to say "refuted" and cite that. In the same entry, the Log replaces the output of `grep -n afterAll …` and `grep -rn "review-record-" …` with a description. The real outputs are `322:afterAll(() => {` plus the import line, and 11 `mkdtemp`/comment hits, none of which removes `review-record-<random>`.
- **med** · Done when 1 depends on it · **open decision.** Read literally, line 1 keeps the ticket open because the count on `main` was 0. Line 1's own probe cannot see this failure at the observed rate. The gate's control rate is 14 in 8000 copies, so 20 runs without the fix would show at least one ENOENT about 3.4% of the time. The `main` count was also taken on git 2.43.0, which never fails (0 of 8000). The cause was found by a different probe, and the brief's Build step 3 says to "fix the cause the probe names". Options: (a) **recommended**: the owner accepts the build's micro-reproduction, and gate 1's (14 of 8000 → 0 of 8000), in place of line 1's count, and the ticket closes at no further cost. (b) Land it `in-flight` with an `awaiting` reading: no `ENOENT` in `review-record.test.ts` across the next 40 `ci.yml` runs on `main`. At the roughly 5–7% per-run CI rate, that leaves about a 5% chance of a false pass. (c) Keep it open and run line 1's probe on `main` with git 2.55.0 until it counts one failure: about 570 runs, roughly 7 hours of machine time.
- **dropped** · `land()`'s scratch clone does not inherit `maintenance.auto`, and it commits before `fs.rmSync`. Under git 2.55.0, the `gc.auto 0` that `land()` already sets means that commit starts no maintenance child (a `GIT_TRACE2_EVENT` trace shows no `child_start`). Nothing copies the clone. Not a defect.
- **dropped** · `git clone <bare> <other>` straight after a push: the two "second clone" tests in this file, plus the peers in `next-id.test.ts` and `preflight.test.ts`. Under git 2.55.0, receive-pack does start `maintenance run --auto --detach` in the bare repository, and the lock was still there when `push` returned in 4 of 100 rounds. Even so, 0 of 4000 clones failed (8 processes, 10 busy loops, 110 s). Not exposed at the measured rate.
- **findings** · the hunt returned 4: 2 carried, 2 dropped.
- NFR: security n/a (the new code writes a fixed config line, with no shell) · performance ✓ (one `appendFileSync`, no spawn) · reliability ✓ for the fixed copy path. The fix took the gate's reproduction from 14 failures in 8000 to 0 in 8000 · maintainability ✓ (the comment beside `disableAutoMaintenance` is accurate: the trace shows 2.55.0 passes `--detach` and 2.43.0 does not).

### Gate 2

**Gate: PASS** — 2026-10-24 · `524d6352..b96cf98d` (round 1; base `89a38d30`) · Opus 5.5, depth narrow

| Done when                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The Log holds the probe's count out of 20 on `main`, with its contention; a 0 is recorded as 0 and the ticket stays open | **verified** by reading, against the owner's answer of 2026-10-24. The Log holds `0 of 20`, 6 busy loops, git 2.43.0. The "stays open" clause is replaced by the owner's choice (a): the micro-reproductions (14 of 8000 → 0 of 8000) stand in for the count, and the ticket closes. The Log records that answer with its question, its three options and its date                                                                                                                                                |
| 2. The Log names each hypothesis as confirmed or refuted, with its command and output                                       | **verified** by reading and by re-running the greps. Hypotheses 1, 2 and 4 read **Refuted** and 3 reads **Confirmed**. Hypotheses 3 and 4 are unchanged since gate 1. The pasted outputs of `grep -n afterAll scripts/test/review-record.test.ts` (2 lines) and `grep -rn "review-record-" scripts packages tools --include=*.ts --include=*.mjs` (14 lines) are byte-identical to what the commands print at this head. Hypothesis 2 also quotes gate 1's `repro.mjs` output, which matches gate 1's full report |
| 3. At the fixed head the probe reports 0 of 20 ENOENT runs, and the file passes 64 of 64 with names unchanged               | **verified**, against the owner's answer of 2026-10-24. The owner accepted the builder's logged sweep for the 0-of-20 clause: 0 of 20, git 2.55.0, 6 busy loops, 829 s. The 64-of-64 and names-unchanged clauses are as gate 1 verified them at `524d6352`. `git diff --stat 524d6352 b96cf98d` touches only the ticket, so that tree's code is this head's code                                                                                                                                                  |

Gate 1's findings:

- **high** (hypothesis 2 graded neither confirmed nor refuted; two outputs replaced by descriptions) · **fixed**. Hypothesis 2 now reads "Refuted, as the cause". It cites gate 1's reproduction by command and output. The two grep outputs are pasted, and `gate-2/compare-pastes.sh` diffs each against a fresh run at this head: `rr: identical`, `afterAll: identical`.
- **med** (open decision on Done when 1) · **fixed**. The owner chose (a) on 2026-10-24, and the round records it in the Log with its options.

The round's own lines:

- **low** · no `Done when` line depends on it · The counts in the round's prose are wrong about the grep it pastes. The paste itself is correct. The fixer's entry says "2 of those 11 are not `mkdtemp` or comment lines (the prefix constant and the `startsWith` and regex uses)". That parenthesis names three things, and the count is 3: 6 `mkdtempSync` lines + 2 comments + 3 = 11. Hypothesis 2's gloss calls the `startsWith` line "its `startsWith`", meaning the prefix constant's. That is also wrong: `startsWith("review-record-land-")` in `scripts/test/review-record.test.ts` › "land() creates its scratch clone with gc.auto=0, so a commit there cannot spawn a detached gc (repo-94)" uses a literal. The constant's own use, `n.startsWith(prefix)`, has no `review-record-` in it, so the grep does not print it. The error is in the safe direction, about a detail nothing relies on.
- **low** · no `Done when` line depends on it · Two phrases in hypothesis 2's refutation contradict hypothesis 3: "nothing outside the copying process touching the directories" and "with no other process touching those directories". Hypothesis 3 says a detached `git maintenance` child does touch them, and that child is the cause. The refutation does not depend on those phrases. It rests on the config-line control: 14 of 8000 → 0 of 8000, which a remover outside git could not produce. Suggested wording: "no process other than the fixture's own `git` commands". The error is in the safe direction.
- **low** · no `Done when` line depends on it · Done when 1's words still say "the ticket stays open". The owner's dated answer in the Log now says it closes. No test reads either way, and the dispatch says to grade against the answer, so this is not the dl-125 stale-line `med`. The lander may reword the line or leave the Log to carry the answer.
- **low** · no `Done when` line depends on it · **unverified attribution.** The owner's answer 3 in the Log reads "**Chosen:** no ticket. The probe scripts stay uncommitted in scratch." The relay of the owner's answers that I was given says only "No follow-up ticket for land()'s clone". If the owner did not say the second sentence, it belongs outside "Chosen". The fact itself is already in the builder's entry ("they are not committed").
- **settled** · the dispatch's disagreement over the grep count. The Log's exact command prints **14 lines** at `b96cf98d`. The same holds at `524d6352`, because the round changes no file the grep reads. The 14 are 3 in `scripts/review-record.mjs` (`-diff-`, `-fmt-`, `-land-`) and 11 in the test file. The fixer's account of the 14 matches the Log as written. Gate 1's "11 `mkdtemp`/comment hits" was the test file's share only, and 3 of those 11 are neither `mkdtemp` nor comment lines.
- **findings** · the hunt returned 4: 4 carried as `low`, 0 dropped. Both gate-1 findings got verdicts above.
- Scope · `git diff --stat 524d6352 b96cf98d` touches one file, the ticket (+88/−9). Every hunk is under `## Log`, and no frontmatter or `Done when` line changed. `oxfmt --check` on the ticket: "All matched files use the correct format". PR #620 at `b96cf98d`: `check` pass. `test (ubuntu-latest)` and the Windows leg were still running when read. Gate 1 read both green on `524d6352`, and that tree differs from this head only by the ticket.
- NFR: security n/a · performance n/a · reliability n/a (no code changed) · maintainability: the lows above.

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
     cause. Nothing in the repo removes it, and the failure reproduces with no process
     touching the directories but the copy and git's own detached maintenance child
     (hypothesis 3); it stops when the fix's one
     config line is added.
     - `grep -rn "review-record-" scripts packages tools --include=*.ts --include=*.mjs`,
       run at `524d6352` (14 lines; the three `scripts/review-record.mjs` lines are other
       prefixes, `-diff-`, `-fmt-` and `-land-`; the 11 in `scripts/test/review-record.test.ts`
       are `mkdtemp` prefixes, a prefix constant, a `startsWith` on a literal prefix (in the test "land() creates its
       scratch clone with gc.auto=0, so a commit there cannot spawn a detached gc (repo-94)"), a regex and two
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
       processes under 10 busy loops, with no process touching those
       directories but the copy and git's own detached maintenance child: `"builds":8000,"failures":14,…"seconds":86.204`, every failure
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
  `mkdtemp`/comment hits", which is the test file's share only, and 3 of those 11 are not
  `mkdtemp` or comment lines (the prefix constant, the `startsWith` and the regex).
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
     **Chosen:** no ticket. The chosen option was labelled "No ticket
     (Recommended)", and its description read: "The gate's trace shows no exposure. The
     builder also recommended leaving it until a reproduction exists. The probe scripts
     stay uncommitted in scratch." The "Not done"
     bullet above about `land()` therefore stands as written, with gate 1's measurement
     as its answer.

- 2026-10-24 — Fixed at landing by owner choice: gate 2, lows 1, 2 and 4, applied as
  the gate states them. The owner left low 3 recorded unfixed. Gate 2's section is not
  touched.
  - Low 1 — the fixer's entry said "2 of those 11" were not `mkdtemp` or comment lines,
    then named three, and hypothesis 2 called the `startsWith` line the prefix
    constant's own. The count is 3, and the `startsWith` line uses a literal, inside the
    test "land() creates its scratch clone with gc.auto=0, so a commit there cannot
    spawn a detached gc (repo-94)".
  - Low 2 — hypothesis 2 said nothing outside the copying process touched the
    directories, which hypothesis 3 contradicts: git's own detached maintenance child
    does. Both sentences now name the copy and that child as the only processes.
  - Low 4 — the second sentence of owner answer 3's "Chosen" was the chosen option's
    description, not the owner's words. It is now attributed to the option "No ticket
    (Recommended)", as the orchestrator's session gave it.

  The commands, run at the landing. Each `awk` reads the ticket only up to this entry,
  since the entry quotes what it removed.

  ```
  $ grep -rn "review-record-" scripts packages tools --include=*.ts --include=*.mjs | grep -v mkdtemp | grep -vc '^[^:]*:[0-9]*: *//'
  3
  $ awk '/Fixed at landing by owner choice/{exit} {print}' <ticket> | grep -c "2 of those 11"
  0
  $ awk '/Fixed at landing by owner choice/{exit} {print}' <ticket> | grep -c "and its .startsWith"
  0
  $ awk '/Fixed at landing by owner choice/{exit} {print}' <ticket> | grep -c "outside the copying process"
  0
  $ awk '/Fixed at landing by owner choice/{exit} {print}' <ticket> | grep -c "no other process touching those"
  0
  $ awk '/Fixed at landing by owner choice/{exit} {print}' <ticket> | grep -c "but the copy and git's own detached maintenance child"
  2
  $ awk '/Fixed at landing by owner choice/{exit} {print}' <ticket> | grep -c "No ticket"
  1
  ```
