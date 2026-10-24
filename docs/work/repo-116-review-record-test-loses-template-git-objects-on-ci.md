---
id: repo-116
tool: repo
title: review-record.test.ts's fixture copy fails with ENOENT on a .git/objects path, twice on CI
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-116 — review-record.test.ts's fixture copy fails with ENOENT on a .git/objects path, twice on CI

## Why

`scripts/test/review-record.test.ts` builds one committed fixture repository per
file and copies it for each test that uses the default ticket (`withTicketRepo`,
from [repo-113](./repo-113-review-record-test-spawns-839-git-processes-on-windows.md)).
Twice in the last 60 `ci.yml` runs, that copy failed on `ubuntu-latest` with
`ENOENT` on a `.git/objects` path under the copy's destination, and the test
failed with it. No other test failed in either run. The failure has not been
reproduced locally.

The two readings, with ANSI codes removed, from `gh run view <run> --log-failed`
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
attempts out of the 39 runs that completed or are running.

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
