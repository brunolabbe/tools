---
id: repo-93
tool: repo
title: Planner and ledger tests that open a SQLite file time out on the Windows CI leg, at the same 5 s as busy_timeout
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-93 — planner and ledger tests that open a SQLite file time out on the Windows CI leg

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
  `grounding-cache.test.ts` 314–1200 ms. The failing case alone ran past
  5000 ms.
- **`migrate` sets `busy_timeout = 5000`** in both tools
  (`tools/ledger/api/src/db/schema.ts`, `tools/planner/api/src/db/schema.ts`),
  and the planner and ledger vitest projects ran on vitest's default 5000 ms. A
  lock held on the new file by something outside the process — antivirus or the
  indexer are the usual suspects on Windows — makes SQLite wait exactly as long
  as the test is allowed to live, so vitest kills it at the moment SQLite would
  have answered, and the log can never say which it was.

That last point is a hypothesis. The logs cannot tell a busy wait from slow
file I/O, and neither reproduces off a Windows runner.

## Build

Give the `planner` and `ledger` projects in `vitest.config.ts` a
`testTimeout` well above `busy_timeout`: 20 s, three back-to-back busy waits.
That is the mitigation and the measurement at once. If the stall is the busy
handler, the next one fails with `SQLITE_BUSY` naming its cause. If it is I/O, the case passes slowly and its
duration appears in the log, since vitest prints any case over 300 ms.

Not the alternative of lowering `busy_timeout` in tests: it is production
config, and `statements.test.ts` already lowers it per-case where contention is
the subject.

## Done when

1. `testTimeout: 20_000` on the `planner` and `ledger` projects, with a comment
   giving the reason.
2. `npm run check` and both projects' suites pass.

## Log

- 2026-10-03 — Filed and built together. The analysis is in Why, from
  `gh run view --log-failed` on the three jobs and `gh run view --job <id>
--log` on 14 passing ones. **Where to look next:** the planner or ledger
  files on a red Windows leg, for `SQLITE_BUSY` or a case slower than 5 s that
  passed. Either one answers the hypothesis; nothing else will.
  Same run, for `repo-89`: its `--land` CLI case passed in 4209 ms against
  3919 ms for `land()`, about 0.3 s more, which counts toward that ticket's
  three runs.
