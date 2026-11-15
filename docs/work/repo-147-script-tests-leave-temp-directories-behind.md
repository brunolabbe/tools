---
id: repo-147
tool: repo
title: Script tests leave their temp directories behind
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-147 — Script tests leave their temp directories behind

## Why

Three spec files under `scripts/test/` make a directory with `fs.mkdtempSync` for
each case and never remove it. One run of the three, into an empty private
`TMPDIR`, leaves 166 directories there:

```
TMPDIR=<empty private dir> npx vitest run scripts/test/status.test.ts scripts/test/next-id.test.ts scripts/test/hooks.test.ts
 Test Files  3 passed (3)
      Tests  241 passed (241)
```

Re-measured at `e7d791d6` (the orchestrator's first reading was at `4e040577`):
167 entries, 166 of them the tests' own, grouped by prefix with the random suffix
stripped:

| Prefix                                                                   | Entries | Made by                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                                 | 133     | `repoWith` in `status.test.ts` (99 call sites, some in loops)                                                                                                                                 |
| `next-id-edit`                                                           | 24      | `copyOfMergedRemote` in `next-id.test.ts`                                                                                                                                                     |
| `next-id-shallow`, `-remote`, `-path`, `-partial`, `-outside`, `-orphan` | 1 each  | six cases in `next-id.test.ts`                                                                                                                                                                |
| `main-writes`                                                            | 3       | `checkoutOn` in `hooks.test.ts`                                                                                                                                                               |
| `node-compile-cache`                                                     | 1       | Node's own module compile cache, under `os.tmpdir()`; no test or config in the repo names it (`grep -rn "compile-cache\|COMPILE_CACHE" scripts vitest.config.ts package.json` prints nothing) |

`next-id-template` is not in the list: `mergedRemoteTemplate` already removes its
directories in an `afterAll`. That is the one fixture in these files that cleaned
up, and it is what the others should have copied.

It was found out of its range by repo-144's gate 1 (133/31/3 per file), which
dropped it; the owner chose on 2026-11-15 to fix it as its own ticket.

The cost is a temp directory that grows by 166 entries per run of three files
(more, with the rest of `scripts/test`): disk on a long-lived machine, and a
count that `.claude/rules/testing.md` already warns about — a test that lists the
temp directory reads every earlier run's leftovers.

## Build

1. **One shared helper**, `scripts/test/temp-dirs.ts`: `createTempDirs()` returns
   `{ make(prefix), cleanup() }` — `make` is `fs.mkdtempSync` under `os.tmpdir()`
   that remembers the directory, `cleanup` removes each with
   `fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })` — and
   `tempDirs()` is that plus an `afterEach(cleanup)`, called once at the top of a
   spec. Removal is per case, so a failing case's directory goes too.
2. **The three specs go through it.** `status.test.ts`'s `repoWith`,
   `hooks.test.ts`'s `checkoutOn`, and `next-id.test.ts`'s seven direct
   `mkdtempSync` calls (`partial`, `path`, `shallow`, `outside`, `remote`,
   `orphan`, `edit`) use `temp.make(prefix)`. Declare `tempDirs()` before any
   other hook in the file: repo-144 found a file-level `afterAll` declared after
   another skips the earlier ones when it fails.
3. **Leave `mergedRemoteTemplate` alone.** Its directory outlives the case that
   asked for it by design and has its own `afterAll`; `afterEach` would delete it
   under the next case.
4. **A guard that cannot be red while the fix is absent**, `scripts/test/temp-dirs.test.ts`:
   `make` then `cleanup` leaves nothing and tolerates a directory already gone;
   and a scan that holds the three specs at their `mkdtemp` count (0, 1, 0 — the
   one is the template) and requires each to call `tempDirs()`.
5. Touch nothing else: `scripts/test/preflight.test.ts` and
   `.claude/rules/testing.md` are repo-144's.

## Done when

1. The reproduction above, run again with `TMPDIR`, `TEMP` and `TMP` set to an
   empty private directory, leaves no entry the tests made: the only entry is
   Node's `node-compile-cache`.
2. Each file on its own does the same: `status.test.ts` leaves 0 of the 133
   entries it left, `next-id.test.ts` 0 of 30, `hooks.test.ts` 0 of 3.
3. With the cleanup disabled (the body of `cleanup` emptied), the same command
   leaves 166 again — the count is what shows a planted leak — and
   `scripts/test/temp-dirs.test.ts` goes red on its removal case.
4. With one call site turned back into a bare `fs.mkdtempSync`, the scan in
   `temp-dirs.test.ts` goes red naming the file.
5. Each of the three files, and `temp-dirs.test.ts`, passes in file order and with
   `--sequence.shuffle.files`; `npm test -- --project repo` and `npm run check`
   pass.

## Log

- 2026-11-15 — Filed and built in one dispatch: the owner chose on 2026-11-15 to fix
  it now, as a third ticket in the batch, rather than only file it. Rated
  `standard` per `docs/01-TICKETS.md` ("a test clean-up inside one package").
