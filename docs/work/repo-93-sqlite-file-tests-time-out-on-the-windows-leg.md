---
id: repo-93
tool: repo
title: Planner and ledger tests that open a SQLite file stall past 5 s on the Windows CI leg
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-93 — planner and ledger tests that open a SQLite file stall past 5 s on the Windows CI leg

## Why

The `test (windows-latest, informational)` leg has failed three times in the
last 100 `ci.yml` runs (2026-09-30 to 2026-10-03, about 58 finished Windows
jobs, counting the attempt a rerun hides). All three were timeouts, each in a
different test:

| Run                                        | Test                                                                                                                    | Timeout            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 36944832854, PR #330 (lg-1), 2026-10-02    | `review-record.test.ts` `--land` CLI case                                                                               | 30 s — `repo-89`'s |
| 37050613876 attempt 1, lg-1, 2026-10-02    | planner `grounding-cache.test.ts` "on boot, because a process that was down for a month comes up holding stale answers" | 5 s                |
| 37146480247, PR #350 (repo-92), 2026-10-03 | ledger `health.test.ts` "never says where the database is"                                                              | 5 s                |

The two 5 s ones are this ticket. They share a shape and nothing else:

- **Each opens a fresh SQLite _file_** under `os.tmpdir()` through `createApp`.
  The in-memory cases beside them in the same failed run passed in 122, 9 and
  6 ms.
- **It is a stall, not a slow runner.** Over 14 passing Windows jobs the whole
  `health.test.ts` file took 105–261 ms (one 1319 ms), and
  `grounding-cache.test.ts` 314–1200 ms; the gate's census of all 54 passing
  jobs in the window widened that to 93–1319 ms and 314–1954 ms. The failing
  cases alone ran 5082 ms (ledger) and 6779 ms (planner).
- **better-sqlite3 is synchronous**, so vitest cannot interrupt the stall. It
  fails the case once the stall ends, for having run past the project's
  timeout — and the planner and ledger projects ran on vitest's default 5 s.

The cause of the stall is **not identified**. It is not a lock that outlasted
`busy_timeout = 5000` in `migrate`: that fails as `SQLITE_BUSY` under the 5 s
timeout too (see the gate entry in the Log), and neither log says it. It fits
slow file I/O on a new file in the temp directory (antivirus is the usual
suspect on Windows), or a busy wait that _succeeded_ just short of 5 s. Neither
reproduces off a Windows runner.

## Build

Give the `planner` and `ledger` projects in `vitest.config.ts` a
`testTimeout` of 20 s, a third of the downloader's minute. A stall of 5 to 20 s
then passes with its duration in the log, since vitest prints any case over
300 ms, instead of failing the leg. It is a mitigation, not a diagnosis: a slow
pass cannot tell I/O from a busy wait.

Not the alternative of lowering `busy_timeout` in tests: it is production
config, `statements.test.ts` already lowers it per-case where contention is the
subject, and a lock is not what these logs show.

## Done when

1. `testTimeout: 20_000` on the `planner` and `ledger` projects, with a comment
   giving the reason.
2. `npm run check` and both projects' suites pass.

## Log

- 2026-10-03 — Filed and built together. The analysis is in Why, from
  `gh run view <run> --attempt <n> --log-failed` on the three failed jobs and
  each passing job's `--log`. For a rerun's first attempt, `--job <id> --log`
  returns the _latest_ attempt's log, so pass `--attempt`. Same run, for
  `repo-89`: its `--land` CLI case passed in 4209 ms against 3919 ms for
  `land()`, about 0.3 s more, which counts toward that ticket's three runs.
- 2026-10-03 — **The brief as first written was wrong about the mechanism**,
  and gate 1 (Sonnet) showed it with a reproduction I re-ran: a child process
  holding `BEGIN EXCLUSIVE` on the file, the case opening it as `migrate` does.
  Held 8000 ms under a 5 s timeout, the case fails `SqliteError: database is
locked` at 5057 ms. Held 4975 ms, the open succeeds and the case fails "Test
  timed out in 5000ms" at 5038 ms. So the first draft's claim — that vitest
  killed the case as the busy wait expired, hiding `SQLITE_BUSY`, and that 20 s
  would make the next one name it — was false; an exhausted busy wait was
  always visible. The comment, Why and Build were corrected before merge. The
  change is the same, and is a mitigation only. **Where to look next**, if the
  leg goes red in these files again: a `SQLITE_BUSY` would be a lock held over
  5 s, a new finding; a slow pass here says only that the stall recurs.
