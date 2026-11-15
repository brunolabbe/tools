---
id: repo-147
tool: repo
title: Script tests leave their temp directories behind
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-147 — Script tests leave their temp directories behind

## Why

Four spec files under `scripts/test/` make a directory with `fs.mkdtempSync` for
each case and never remove it. One run of the first three, into an empty private
`TMPDIR`, leaves 166 directories there, and the fourth (`status-gate-record.test.ts`,
found by gate 1) leaves 17 more:

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
| `status`                                                                 | 133     | `repoWith` in `status.test.ts` (98 calls, some in loops)                                                                                                                                      |
| `next-id-edit`                                                           | 24      | `copyOfMergedRemote` in `next-id.test.ts`                                                                                                                                                     |
| `next-id-shallow`, `-remote`, `-path`, `-partial`, `-outside`, `-orphan` | 1 each  | six cases in `next-id.test.ts`                                                                                                                                                                |
| `main-writes`                                                            | 3       | `checkoutOn` in `hooks.test.ts`                                                                                                                                                               |
| `node-compile-cache`                                                     | 1       | Node's own module compile cache, under `os.tmpdir()`; no test or config in the repo names it (`grep -rn "compile-cache\|COMPILE_CACHE" scripts vitest.config.ts package.json` prints nothing) |

`status-gate` is the fourth file's, 17 entries from its own `repoWith`, and is not
in the table because the first reading ran three files. `next-id-template` is not in the list: `mergedRemoteTemplate` already removes its
directories in an `afterAll`. That is the one fixture in these files that cleaned
up, and it is what the others should have copied.

It was found out of its range by repo-144's gate 1 (133/31/3 per file), which
dropped it; the owner chose on 2026-11-15 to fix it as its own ticket.

The cost is a temp directory that grows by 183 entries per run of the four files
(and `npm test -- --project repo` leaves the fourth's 17 on its own): disk on a long-lived machine, and a
count that `.claude/rules/testing.md` already warns about — a test that lists the
temp directory reads every earlier run's leftovers.

## Build

1. **One shared helper**, `scripts/test/temp-dirs.ts`: `createTempDirs()` returns
   `{ make(prefix), cleanup() }` — `make` is `fs.mkdtempSync` under `os.tmpdir()`
   that remembers the directory, `cleanup` removes each with
   `fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })` — and
   `tempDirs()` is that plus an `afterEach(cleanup)`, called once at the top of a
   spec. Removal is per case, so a failing case's directory goes too.
2. **The four specs go through it.** `status.test.ts`'s `repoWith`,
   `hooks.test.ts`'s `checkoutOn`, and `next-id.test.ts`'s seven direct
   `mkdtempSync` calls (`partial`, `path`, `shallow`, `outside`, `remote`,
   `orphan`, `edit`) and `status-gate-record.test.ts`'s `repoWith` use
   `temp.make(prefix)`. Declare `tempDirs()` before any
   other hook in the file: repo-144 found a file-level `afterAll` declared after
   another skips the earlier ones when it fails.
3. **Leave `mergedRemoteTemplate` alone.** Its directory outlives the case that
   asked for it by design and has its own `afterAll`; `afterEach` would delete it
   under the next case.
4. **A guard that must be red while the fix is absent**, `scripts/test/temp-dirs.test.ts`:
   `make` then `cleanup` leaves nothing and tolerates a directory already gone;
   `cleanup` attempts every removal when one throws and throws the failures
   together; `tempDirs()` registers its `afterEach` (a case that makes a directory,
   then one that finds it gone, in a `describe` with shuffling off); and a scan
   that holds the four specs at their count of `mkdtemp*(` calls and `tmpdir`
   mentions (0, 2 — the template's one call and its `os.tmpdir()` —, 0, 0), with a
   planted control for each spelling, and requires each to call `tempDirs()`.
5. Touch nothing else: `scripts/test/preflight.test.ts` and
   `.claude/rules/testing.md` are repo-144's.

## Done when

1. The reproduction above, run again with `TMPDIR`, `TEMP` and `TMP` set to an
   empty private directory, leaves no entry the tests made: the only entry is
   Node's `node-compile-cache`.
2. Each file on its own does the same: `status.test.ts` leaves 0 of the 133
   entries it left, `next-id.test.ts` 0 of 30, `hooks.test.ts` 0 of 3,
   `status-gate-record.test.ts` 0 of 17, and the four together leave 0 of 183.
3. With the cleanup disabled (the body of `cleanup` emptied), the four specs
   together leave 183 again — the count is what shows a planted leak — and
   `scripts/test/temp-dirs.test.ts` goes red on its removal case.
4. With one call site turned back into a bare `fs.mkdtempSync`, a
   `mkdtempDisposableSync`, or a `mkdirSync` under `os.tmpdir()`, the scan in
   `temp-dirs.test.ts` goes red naming the file.
5. With the `afterEach` line deleted from `tempDirs()`, `temp-dirs.test.ts` goes
   red; with one `rmSync` throwing, `cleanup` still removes the others.
6. Each of the four files, and `temp-dirs.test.ts`, passes in file order, with
   `--sequence.shuffle.files` and with plain `--sequence.shuffle`;
   `npm test -- --project repo` and `npm run check` pass.

## Review

**Gate: CONCERNS** — 2026-11-15 · `e7d791d6..d7a1f0d8` · Opus 5.5, depth standard

The branch both files and builds repo-147, so the filing checks the dispatch supplied are traced as acceptance below the `Done when` rows. Build skipped: the diff touches only `scripts/test` files whose imports are `node:` builtins, `vitest` and scripts beside them. Every count is from a private, empty `TMPDIR`, `TEMP` and `TMP`, Linux.

| Done when                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. The three files together leave only `node-compile-cache`                  | **verified** — measured 1 entry, `node-compile-cache`, 241 of 241 passing. The same command against the base's three specs gave 167: 133 `status-`, 24 `next-id-edit-`, 6 other `next-id-*`, 3 `main-writes-` and the cache. No test in `npm test` asserts the count (see the second `med`)                                                                                                                        |
| 2. Each file alone: 0 of 133, 0 of 30, 0 of 3                                | **verified** — `status.test.ts` 1 entry (the cache), 155 tests; `next-id.test.ts` 1 entry, 52 tests; `hooks.test.ts` 1 entry, 34 tests. The base figures come from the three-file run's prefixes, and each prefix belongs to one file                                                                                                                                                                              |
| 3. Emptying `cleanup` brings back 166, and `temp-dirs.test.ts` goes red      | **verified** with a planted leak (body of `cleanup` emptied): 167 entries, 166 of them made by the tests, and the three specs stay green (241 of 241). `temp-dirs.test.ts` exit 1, `2 failed \| 1 passed (3)`. The red half is proven by `scripts/test/temp-dirs.test.ts` › "a directory made through the registry is under the temp directory and removed by cleanup" (`existsSync(made)` is false)               |
| 4. One bare `fs.mkdtempSync` turns the scan red, naming the file             | **proven** — `scripts/test/temp-dirs.test.ts` › "the three specs that leaked make their directories through the registry", whose `toEqual` on the per-file counts prints the file. Positive controls on two call sites the builder did not use: `status.test.ts` `repoWith` gives `"status.test.ts": 1`, and `next-id.test.ts` `next-id-outside-` gives `"next-id.test.ts": 2`. Each is `1 failed \| 2 passed (3)` |
| 5. File order, `--sequence.shuffle.files`, `--project repo`, `npm run check` | **verified** — each file alone in file order passes. With `--sequence.shuffle.files` and seed 4, 244 of 244 pass. With plain `--sequence.shuffle`, seeds 1 to 10, 244 of 244 pass each time and each run leaves 1 entry. `npm test -- --project repo` passes 719 and skips 1 (720), exit 0. `npm run check` was not run locally: the CI `check` (workflow `CI`) is SUCCESS at `d7a1f0d8`                           |

| Check (from the dispatch)            | Proof                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reproduction holds at `e7d791d6` | **verified** — 167 entries, 166 from the tests, 241 of 241 passing. The per-prefix counts match the table entry for entry                                                                                                                                                                                             |
| `Done when` lines can be enumerated  | **verified** — five lines, each settled by a count or a test above                                                                                                                                                                                                                                                    |
| `difficulty: standard`               | **verified** — `docs/01-TICKETS.md` names "a test clean-up inside one package" as `standard`                                                                                                                                                                                                                          |
| The id is free                       | **verified** — `node scripts/next-id.mjs repo` lists `PR#807 repo-147` as the only claim, and `origin/main` has no `repo-147` file                                                                                                                                                                                    |
| Line citations resolve               | **verified** — the ticket cites no lines. Its `compile-cache` grep prints nothing (exit 1), as the ticket says                                                                                                                                                                                                        |
| Windows leg                          | `test (windows-latest, informational)` is SUCCESS at `d7a1f0d8`. It covers `next-id.test.ts` (52 tests, none skipped) and `temp-dirs.test.ts` (3). It does not cover `status.test.ts`, which the leg excludes, or `hooks.test.ts`, whose 34 tests are all skipped there. Leftover counts on Windows were not measured |

- **med** · no `Done when` line depends on it · A fourth spec leaks in the same way, and the scan cannot see it. `scripts/test/status-gate-record.test.ts` has its own `repoWith`, which makes a directory with a bare `fs.mkdtempSync` (prefix `status-gate-`) and never removes it. Run alone it leaves 17 entries, and `npm test -- --project repo` leaves the same 17. The scan reads a fixed list of three files, and the Why says "Three spec files". All 18 `scripts/test` specs were run one at a time, and this is the only other spec that leaves anything. Measured fix: change the helper to `temp.make("status-gate-")` with `const temp = tempDirs()`. The file then passes 16 of 16 and leaves 0 entries (file order only). How to guard it is an open decision; see the report.
- **med** · no `Done when` line depends on it · Nothing tests `tempDirs()`'s `afterEach` registration. Deleting the line `afterEach(() => dirs.cleanup())` from `scripts/test/temp-dirs.ts` brings back 167 entries, yet `temp-dirs.test.ts` passes 3 of 3 and the three specs pass 241 of 241. The guard tests `createTempDirs` and that each file calls `tempDirs()`. It never tests that the hook removes anything. The new export is effectively untested.
- **low** · `nfr:reliability` · When one removal fails, `cleanup` skips the rest and loses track of them. `made.splice(0)` empties the list before the loop, so if `rmSync` throws on one directory, the later ones stay on disk, and a second `cleanup` call removes nothing. A probe gave `EACCES` on the first directory and left all three. The throw fails the case, so the leak is not silent. No run has hit it, including the 52 `next-id` cases on the Windows leg.
- **low** · `nfr:maintainability` · The scan's regex `\bmkdtemp(?:Sync)?\(` misses other ways of making a temp directory. A planted `fs.mkdtempDisposableSync(...)` in `status.test.ts` left `temp-dirs.test.ts` green, 3 of 3. It also misses `mkdirSync` under `os.tmpdir()`. Nothing calls either today.
- **low** · The filing says `repoWith` has "99 call sites, some in loops". 99 is the count of `repoWith(` occurrences at `e7d791d6`, and one of them is the `function repoWith(` definition, so there are 98 calls. Nothing depends on the number.
- **low** · Build 4 asks for "a guard that cannot be red while the fix is absent". The meaning is inverted: the guard must be red while the fix is absent. A reader would take the intent, and the build follows it.
- **dropped** · Could `afterEach` remove a directory a later test still needs? No. Every `temp.make`, `repoWith`, `checkoutOn`, `pathWithout` and `copyOfMergedRemote` call runs inside a test body, none in a `describe` body or at module level. Plain `--sequence.shuffle` with seeds 1 to 10 passed 244 of 244 every time.
- **dropped** · Could `rmSync` fail on Windows (read-only `.git` objects, open handles, long paths)? Nothing shows it. The Windows leg ran `next-id.test.ts`'s 24 `copyOfMergedRemote` git trees and the remote and orphan repos green, and a throw in `afterEach` would have failed the case. Whether the directories are actually gone on Windows was not measured.
- **dropped** · Does repo-144's hook-ordering trap apply? No. `tempDirs()` registers an `afterEach` and is declared above `next-id.test.ts`'s only `afterAll`, as Build 2 asks.
- **findings** · the hunt returned 9; 6 carried, 3 dropped.
- NFR: security n/a · performance ✓ (three files 3.59 s at head against 3.77 s at base) · reliability — above · maintainability — above.

## Log

- 2026-11-15 — Filed and built in one dispatch: the owner chose on 2026-11-15 to fix
  it now, as a third ticket in the batch, rather than only file it. Rated
  `standard` per `docs/01-TICKETS.md` ("a test clean-up inside one package").
- 2026-11-15 — Built at `49149802`. Every number below is a private empty `TMPDIR`,
  `TEMP` and `TMP`, `node-compile-cache` excluded (Node's own).
  - Before, three files together at `e7d791d6`: 166 test-made entries (133 `status`,
    24 `next-id-edit`, 6 one-offs, 3 `main-writes`), 241 of 241 tests passing.
  - After, the same command: 0 test-made entries, 241 of 241 passing. In file order,
    `--sequence.shuffle.files --sequence.seed=1` and `=2`: 0 each. The three specs
    plus `temp-dirs.test.ts` together, seed 3: 0.
  - Per file, alone, after: `status.test.ts` 0 (155 tests), `next-id.test.ts` 0 (52),
    `hooks.test.ts` 0 (34), `temp-dirs.test.ts` 0 (3).
  - Done when 3, `cleanup`'s loop emptied (`for (const dir of [] as string[])`),
    each file alone: `status` 133, `next-id` 30, `hooks` 3 (sum 166), and
    `temp-dirs.test.ts` exit 1, `2 failed | 1 passed (3)`. The three specs stay
    green with the cleanup disabled, so the helper's own test and the count are
    what catch it, not the specs. Restored from commit `49149802`.
  - Done when 4, `hooks.test.ts`'s `checkoutOn` turned back into a bare
    `fs.mkdtempSync`: `hooks` leaves 3, `temp-dirs.test.ts` exit 1, `1 failed | 2
    passed (3)`, the diff reading `"hooks.test.ts"` expected 0, found 1.
  - `npm test -- --project repo`: 18 files, `719 passed | 1 skipped (720)`, exit 0.
    `npm run check`: exit 0.
- 2026-11-15 — The brief had nothing wrong. Not folded in: `preflight.test.ts` and
  `.claude/rules/testing.md` are repo-144's, and the second is a rules page. The
  other `scripts/test` specs were not surveyed for the same leak, so none is claimed
  clean. `mergedRemoteTemplate` keeps its own `afterAll`; `tempDirs()`'s `afterEach`
  is a different hook kind, so repo-144's skipped-`afterAll` trap does not apply.
- 2026-11-15 — Owner's answers after gate 1 (CONCERNS at `d7a1f0d8`), relayed by the
  coordinator and recorded before the work they change.
  - **The fourth spec.** `scripts/test/status-gate-record.test.ts` leaves 17
    `status-gate-` directories and the scan read only three files. Options: (a)
    convert it to `temp.make("status-gate-")` and add it to the scan with count 0,
    (b) make the scan read every `scripts/test/*.test.ts` with an allowlist, (c)
    file it separately. **The owner chose (a), 2026-11-15.** Superseded by it, and
    left here: Why's "Three spec files", Build 2's "The three specs go through it",
    Done when 1 and 2 as filed ("the reproduction above … leaves no entry the tests
    made"; "`status.test.ts` leaves 0 of the 133 …, `hooks.test.ts` 0 of 3"), now
    covering four files.
  - **The rest.** Options: a round fixing every finding then a second gate, fix only
    the fully stated findings at landing, or record all. **The owner chose the round,
    2026-11-15**, a departure from the severity floor's default of no round below
    it. The findings are M2 (nothing tests that `tempDirs()` registers its
    `afterEach`), L1 (`cleanup` empties its list before the loop, so one throwing
    `rmSync` skips the rest), L2 (the scan misses `mkdtempDisposableSync` and
    `mkdirSync` under `os.tmpdir()`), L3 ("99 call sites" is 98) and L4 (Build 4's
    "cannot be red while the fix is absent" is inverted). Done when 3 to 6 and Build
    4 above are reworded for them.
- 2026-11-15 — Round 1 built at `729f744f` (code) after `045fc0c4` (the answers). Every
  count is a private empty `TMPDIR`, `TEMP` and `TMP`, `node-compile-cache` excluded.
  - **Fourth spec.** `status-gate-record.test.ts` goes through `temp.make`, and the scan
    holds it at 0. The import block changes by net zero lines (the `os` import and the
    blank separator out, the `temp-dirs` import and `const temp` in), so the lines
    repo-73's and repo-76's records cite (56, 68, 113, 135) still read what they cited.
    Alone: 16 of 16 passing, 0 entries (17 before, as gate 1 measured and a bare
    `mkdtempSync` put back reproduces below).
  - **M2.** `describe("tempDirs registers its afterEach", { shuffle: false })` makes a
    directory in one case and asserts it gone in the next. Deleting the `afterEach`
    line from `tempDirs()`: `temp-dirs.test.ts` exit 1, `1 failed | 11 passed (12)`,
    "the next case finds it gone"; the four specs then leave 184 (183 plus that case's
    own directory).
  - **L1.** `cleanup` attempts every removal and throws the failures together (the one
    failure itself when there is one). The case makes `rmSync` throw for two of three
    directories with a spy rather than `chmod`, so it holds as root and on Windows.
    With the old loop back, that case is the one red: `1 failed | 11 passed (12)`.
  - **L2.** The scan counts `mkdtemp\w*(` and any `tmpdir`, so `next-id.test.ts` is held
    at 2 (the template's call and its `os.tmpdir()`). Planted in an uncalled function:
    `mkdtempDisposableSync` in `status.test.ts` and `mkdirSync(path.join(os.tmpdir(), …))`
    in `hooks.test.ts` each turn the scan red (`1 failed | 11 passed (12)`); a case
    per spelling asserts the pattern matches it.
  - A bare `mkdtempSync` put back in `status-gate-record.test.ts`: the four specs leave
    17, and the scan is red.
  - **L3, L4.** "99 call sites" is 98 calls; Build 4 reads "must be red".
  - Four specs together: 257 of 257, 0 entries. Alone: `status` 155, `next-id` 52,
    `hooks` 34, `status-gate-record` 16, `temp-dirs` 12, each 0 entries. Plain
    `--sequence.shuffle` seeds 1 to 5 over those five files, 269 of 269 each, 0 entries
    each; `--sequence.shuffle.files --sequence.seed=3` the same. `npm test -- --project
    repo`: 18 files, `728 passed | 1 skipped (729)`. `npm run check`: exit 0.
- 2026-11-15 — Owner's answer after gate 2 (PASS at `51db3759`), relayed by the
  coordinator and recorded before the fixes it orders. Question: what the lander
  does with gate 2's four lows (N1, N3, L2's remainder, N2). Options: fix N1 and N3
  at landing with no re-gate (recommended), record all four, or also close L2's
  remainder, which would need a round. **The owner chose to fix N1 and N3 at
  landing**; L2's remainder and N2 stay recorded and unfixed.
- 2026-11-15 — Fixed at landing by owner choice: gate 2, N1 — "claims more than the test checks". The test is renamed to say what it excludes, the registry's own call and a backticked mkdtemp with no open parenthesis; the pattern and the assertions are unchanged. `git diff 51db3759 HEAD -- scripts/test/temp-dirs.test.ts | grep -c '^-.*or a prose mention'` → `1`.
- 2026-11-15 — Fixed at landing by owner choice: gate 2, N3 — "the same command leaves 183 again" can be read two ways. Done when 3 now names the four specs together, the reading that leaves 183. `git diff 51db3759 HEAD -- docs/work/repo-147-script-tests-leave-temp-directories-behind.md | grep -c '^-.*the same command'` → `1`.
- 2026-11-15 — Gate 2's other two lows stay recorded and unfixed, by the owner's choice: N2 (the repo-73 and repo-76 citations that were already off by one before this branch) and the two scan spellings left from gate 1's L2.
