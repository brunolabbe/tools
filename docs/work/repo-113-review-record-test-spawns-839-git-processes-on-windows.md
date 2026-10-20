---
id: repo-113
tool: repo
title: review-record.test.ts spawns 839 git processes, which is 61 % of its Windows time
kind: chore
status: ready
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

## Log

- **2026-10-20** — Filed from [repo-106](./repo-106-review-record-test-windows-time-is-unprofiled.md)'s
  reading. The `depends_on` is because the numbers in Why live in that Log.
