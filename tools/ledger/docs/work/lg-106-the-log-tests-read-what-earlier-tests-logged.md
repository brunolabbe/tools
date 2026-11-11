---
id: lg-106
tool: ledger
title: The two log tests read what earlier tests logged, so a shuffled run fails them
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-106 — The two log tests read what earlier tests logged, so a shuffled run fails them

## Why

Two ledger API specs end with a test that reads a module-level `LOGGED` array.
Every app a file starts pushes its log lines into that array, and the test
assumes it runs last, so that the array holds what every earlier test logged.
Both files say so in comments: `csv-import.test.ts:1110` ("Last: it reads what
every test above logged") and `workbook-describe.test.ts:789-790` ("vitest runs
a file's tests in order, and LOGGED holds every app's lines"). Under
`--sequence.shuffle` that is not true, so the log test can run before the
tests whose lines it checks. The failure is a test-order dependence inside one
file, not a leak between files: a file run alone with the file-level shuffle
passes, and the in-file shuffle fails.

Default runs keep the source order, so no CI leg reproduces it; it shows only
under a shuffled run. The repo-129 builder reported ledger seeds 3 and 4 failing
under plain `--sequence.shuffle` (repo-129, PR #783, not merged), seed 3 in
csv-import and seed 4 in workbook-describe. The owner's split files the ledger
half here, and names repo-144 (PR #788, not merged, titled "the preflight leak
spec reads shim directories other tests made") as the repo half.

`csv-import.test.ts:1005` also reads the same array, asserting that no logged
line holds a token. It is not part of this defect: its own app logs its rejected
request, so the array is never empty in any order, and a planted token line makes
its cases fail. It needs no change.

## Reproduction

Base: `origin/main` at `a100f429`, the worktree farmed and `npm run build`
run first. Every command below is run from the worktree root, with
`npx vitest run` directly, one file at a time.

**1. csv-import, in-file shuffle, seed 3.**
`npx vitest run tools/ledger/api/test/csv-import.test.ts --sequence.shuffle --sequence.seed=3`

```
 ❯ |ledger| tools/ledger/api/test/csv-import.test.ts (63 tests | 1 failed) 1836ms
   ❯ the log (lg-66's rule, for a CSV) (1)
     × no line of any request above holds a CSV's content, a file name or the key 7ms
 FAIL  |ledger| tools/ledger/api/test/csv-import.test.ts > the log (lg-66's rule, for a CSV) > no line of any request above holds a CSV's content, a file name or the key
AssertionError: expected 0 to be greater than 20
 ❯ tools/ledger/api/test/csv-import.test.ts:1113:27
      Tests  1 failed | 62 passed (63)
```

**2. workbook-describe, in-file shuffle, seed 4.**
`npx vitest run tools/ledger/api/test/workbook-describe.test.ts --sequence.shuffle --sequence.seed=4`

```
 ❯ |ledger| tools/ledger/api/test/workbook-describe.test.ts (45 tests | 1 failed) 4200ms
   ❯ the log (Done when 8) (1)
     × no line of any request above holds the upload's content, a name or the key 9ms
AssertionError: expected false to be true // Object.is equality
 ❯ tools/ledger/api/test/workbook-describe.test.ts:807:78
      Tests  1 failed | 44 passed (45)
```

**3. The file-level shuffle, as the dispatch wrote it.**
`npx vitest run tools/ledger/api/test/csv-import.test.ts --sequence.shuffle --sequence.seed=3 --sequence.shuffle.files`
exits before any test runs, because the CLI parser cannot take both flags:

```
TypeError: Cannot create property 'files' on boolean 'true'
    at setDotProp (.../vitest/dist/chunks/cac.CLrZKo1g.js:208:20)
```

The same flag without the bare `--sequence.shuffle` parses, and is the control:

`npx vitest run tools/ledger/api/test/csv-import.test.ts --sequence.shuffle.files --sequence.seed=3`
→ `Tests 63 passed (63)`

`npx vitest run tools/ledger/api/test/workbook-describe.test.ts --sequence.shuffle.files --sequence.seed=4`
→ `Tests 45 passed (45)`

The file-level shuffle with one file reorders nothing inside it, so these two
passes read the source order. The failure is therefore inside the file.

**4. The order the failing seeds ran in** (`--reporter=verbose`, each run's
test lines in run order, abridged to the position of the failing test).

csv-import, seed 3: the log test is the first test to run, and sixty-two tests
run after it. `LOGGED` is empty when line 1113 runs, which is why the assertion
reports `expected 0`.

workbook-describe, seed 4: the log test runs seventh, with six tests before it.
Those six logged more than twenty lines, so the `toBeGreaterThan(20)` at line
791 passes. The `a workbook was described` line is logged at
`tools/ledger/api/src/routes/workbook.ts:85`, when the route answers a describe
with a body, `ok` either way, and not when it refuses the request. None of the
six logged it, which the assertion at line 807 shows, and the `describing a
workbook (Done when 5)` describe, which sends describe requests, runs after the
log test.

**5. Seed sweep, each file alone, seeds 1 to 10.**

Run from the worktree root, `npx vitest run <file> --sequence.shuffle --sequence.seed=N`
for N from 1 to 10, one file at a time. Written to `scratchpad/filing-ledger-order/build/sweep.txt`
by a script run with `bash`; the counts are copied from it.

```
csv-import.test.ts      N=1 63/63   N=2 63/63   N=3 62/63 FAIL   N=4 63/63   N=5 63/63
                        N=6 62/63 FAIL   N=7 62/63 FAIL   N=8 63/63   N=9 63/63   N=10 62/63 FAIL
workbook-describe.test  N=1 45/45   N=2 45/45   N=3 45/45   N=4 44/45 FAIL   N=5..10 45/45
```

The failing test is in every case the log test of its file. The assertion that
fails differs with the seed, which says what the test saw:

- csv-import, seed 3: `csv-import.test.ts:1113:27`, `expected 0 to be greater than 20`. Nothing had logged.
- csv-import, seed 7: `csv-import.test.ts:1113:27`, `expected 0 to be greater than 20`.
- csv-import, seed 10: `csv-import.test.ts:1113:27`, `expected 7 to be greater than 20`.
- csv-import, seed 6: the count passes and `csv-import.test.ts:1127:80` fails: `a described CSV was stored` is not yet in the array.
- workbook-describe, seed 4: `workbook-describe.test.ts:807:78`, `expected false to be true`: `a workbook was described` is not yet in the array, the count at `:791` having passed.

**6. Unshuffled control, source order.**
`npx vitest run tools/ledger/api/test/csv-import.test.ts` → `Tests 63 passed (63)`
`npx vitest run tools/ledger/api/test/workbook-describe.test.ts` → `Tests 45 passed (45)`

So the defect is latent: the default order passes, and only a shuffled order
reaches it.

**7. The filter commands, at the base.** These are the `-t` lines the Done when
section names, run on the same tree, with the exit code read on its own line.

- `npx vitest run tools/ledger/api/test/csv-import.test.ts -t "no line of any request above holds a CSV"`
  → exit 1, `Tests 1 failed | 62 skipped (63)`
- `npx vitest run tools/ledger/api/test/workbook-describe.test.ts -t "no line of any request above holds the upload"`
  → exit 1, `Tests 1 failed | 44 skipped (45)`
- `npx vitest run tools/ledger/api/test/csv-import.test.ts -t "the fake is called once on describe and never on confirm"`
  → exit 0, `Tests 1 passed | 62 skipped (63)`
- `npx vitest run tools/ledger/api/test/workbook-describe.test.ts -t "lg37: a fake answering its correct description"`
  → exit 0, `Tests 1 passed | 44 skipped (45)`
- `npx vitest run tools/ledger/api/test/csv-import.test.ts -t "no such test anywhere"`
  → exit 0, `Tests 63 skipped (63)`. A pattern that matches nothing passes, so
  the counts are part of the Done when lines.
- `grep -n "tests in order\|Last: it reads" tools/ledger/api/test/csv-import.test.ts tools/ledger/api/test/workbook-describe.test.ts`
  → `tools/ledger/api/test/workbook-describe.test.ts:790` and
  `tools/ledger/api/test/csv-import.test.ts:1110`, one line per file.

## Shared state, read at `a100f429`

`tools/ledger/api/test/csv-import.test.ts`:

- `:120-121` the module-level `let app` and `const LOGGED: string[] = []`.
- `:134-149` `start()` builds each app with `logger: createLogger({ ... write: (line) => LOGGED.push(line) })`. Every test that calls `start()` fills `LOGGED`; nothing empties it.
- `:123-126` the `afterEach` shuts down `app`, not `LOGGED`.
- `:1110-1113` the failing describe and test. `:1112` is the test name; `:1113` `expect(LOGGED.length).toBeGreaterThan(20)` is the first assertion that fails under seed 3.
- `:1126-1127` two `LOGGED.some(...)` checks, which need `a workbook was described`-style lines from the earlier describes to exist.
- `:1005`, inside the `Done when 10` describe, `expect(LOGGED.filter(...)).toEqual([])` reads the same array. Its own app logs the rejected request, so the array is never empty, and the check is not part of this defect.

`tools/ledger/api/test/workbook-describe.test.ts`:

- `:144-146` the module-level `let app` and `const LOGGED: string[] = []`, with the comment at `:145` reading "Every line any app of this file logged".
- `:191` the logger's `write` pushes into `LOGGED`.
- `:787-810` the failing describe. `:788` is the test name. `:789-790` is the comment that states the order assumption. `:791` `LOGGED.length > 20` passes under seed 4; `:807` `a workbook was described` (needs the `describing a workbook (Done when 5)` describe at `:255`) fails.
- `:808` `a described workbook was imported`, logged by the `confirming (Done when 7)` describe at `:569`, is read after `:807` and is never reached under seed 4.

No shuffle is configured in `vitest.config.ts` or any `tools/ledger` config; the
order is only ever shuffled by the flag on the command line.

## Build

1. In each file, make the log test read only lines its own run produced: the
   log test makes the requests whose lines it checks, against its own app, so it
   does not need the earlier describes to have run. The owner chose this shape
   over a per-test capture on 2026-11-10; see the Log. The log test must not
   depend on the order of the describes above it.
2. The checks must not pass on an empty log. The `toBeGreaterThan(20)` and each
   `LOGGED.some(...)` precondition must hold under every seed the sweep runs,
   because they now hold by the test's own requests, not by what ran before.
3. Replace the two order comments (`csv-import.test.ts:1110`,
   `workbook-describe.test.ts:789-790`) with a statement of what the test now
   relies on. Neither may still say that vitest runs a file's tests in order.
4. Do not change `tools/ledger/api/src`, `tools/ledger/contract`, any vitest
   config, or the `.claude/` pages. Do not hide the dependence by excluding these
   files from shuffled runs or by forcing them to run in a fixed order: the
   point is that each test stands on its own. Do not add a file-level hook
   (`afterAll`, `beforeAll` or a module-level check) that reads `LOGGED`: a
   filtered run would then fail on an unrelated test that logs fewer lines than
   the hook expects, which Done when 8 catches.
5. Do not touch the repo-129 or repo-144 branches. This is ledger-only.

## Done when

1. `npx vitest run tools/ledger/api/test/csv-import.test.ts --sequence.shuffle --sequence.seed=N` reports every test passing for each N from 1 to 10, and the same for `tools/ledger/api/test/workbook-describe.test.ts`. The sweep output, with its counts, goes in the Log.
2. Each log test passes when it is the only test selected by name: `npx vitest run tools/ledger/api/test/csv-import.test.ts -t "no line of any request above holds a CSV"` exits 0 and reads `Tests  1 passed` with every other test skipped, and `npx vitest run tools/ledger/api/test/workbook-describe.test.ts -t "no line of any request above holds the upload"` does the same. The total is not pinned, so a fix that adds a test or splits a log test in two does not fail the line. At the base the same commands exit 1 and read `1 failed`, and a pattern that matches nothing reads no `passed` at all, so `1 passed` is what discriminates.
3. No `LOGGED` precondition in either file is satisfied by an empty array: the `toBeGreaterThan(20)` and each `LOGGED.some(...)` assert against lines the test's own run produced.
4. Unshuffled, both files pass in full: `npx vitest run tools/ledger/api/test/csv-import.test.ts` and `npx vitest run tools/ledger/api/test/workbook-describe.test.ts`, with the counts in the Log.
5. `grep -n "tests in order\|Last: it reads" tools/ledger/api/test/csv-import.test.ts tools/ledger/api/test/workbook-describe.test.ts` prints nothing. At the base it prints one line per file (`workbook-describe.test.ts:790` and `csv-import.test.ts:1110`), so it fails there.
6. `git diff --name-only origin/main...HEAD` lists only the two spec files and this ticket. Nothing under `tools/ledger/api/src` or `tools/ledger/contract` changes.
7. `npm run check` exits 0, and `npm test -- --project ledger` passes through the test gate, both at the fix's head.
8. A filtered run of an unrelated test passes, so a file-level hook cannot hide: `npx vitest run tools/ledger/api/test/csv-import.test.ts -t "the fake is called once on describe and never on confirm"` exits 0 and reads `Tests  1 passed` with every other test skipped, and `npx vitest run tools/ledger/api/test/workbook-describe.test.ts -t "lg37: a fake answering its correct description"` does the same, without pinning the total. Both exit 0 at the base, measured 2026-11-10 (Reproduction 7).

## Log

**2026-11-10, filed by a maintenance builder (no work built).** The
reproduction above is the deliverable: it fails at the base in both files under
the seeds the repo-129 builder reported, and the file-level control passes,
which places the dependence inside each file. The shared state and its line
numbers are read at `a100f429`. Repo-129 (PR #783, not merged) and repo-144
(PR #788, not merged) are cited as prose here, not by line.

The dispatch's own file-level command, with `--sequence.shuffle` and
`--sequence.shuffle.files` together, does not parse under vitest 5 and reaches no
test; the working spelling is `--sequence.shuffle.files` without the bare flag.

**2026-11-10, the owner's answer on gate 1's F4, recorded before any change to
the Build.**

- Question: Build option (b), where each test captures its own app's lines and
  the log test checks the captures, does not fix the failure. The captures the
  log test reads still come from the other tests. A probe of (b) on csv-import
  gave `63 passed` at seed 1, `1 failed | 62 passed` at seeds 3 and 6, and
  `1 failed | 62 skipped` for `-t` on the log test. Which remedy should the
  Build keep?
- Options: (1) delete (b) and keep (a), where the log test makes the requests
  whose lines it checks against its own app; or (2) reword (b) so the log test
  makes its own requests and captures only those.
- Choice: (1), delete (b) and keep (a). The gate recommended (1).
- Provenance: the owner, 2026-11-10, at tools-86 checkpoint 8. The orchestrator
  relayed the answer to the builder in its round-1 message; the builder records
  it as relayed and did not verify it against the owner directly.

**2026-11-10, gate 1 (narrow) on `c218b509`: CONCERNS, applied in round 1.** The
gate's findings, each with what this round did:

- F1, `Done when` 2 passed on nothing: a `-t` matching no test exits 0 with
  `63 skipped`. Done when 2 now names the exact patterns and requires the counts.
  The first pattern put an apostrophe in the `-t` text, which the sandbox refused
  to run, so the patterns are apostrophe-free substrings of the test titles.
- F2, `Done when` 5's grep could not fail on the workbook half, because the
  comment wraps. The pattern is now `tests in order\|Last: it reads`, which
  prints one line per file at the base.
- F3, no line guarded a filtered run against a file-level hook. Done when 8 is
  new, and Build 4 forbids the hook.
- F4, option (b) would not fix the failure. Answered and recorded above; (b) is
  deleted from Build 1.
- F5, the `csv-import.test.ts:1005` vacuity claim was false. The Why, the Shared
  state bullet and Build 2 now say the check is not part of the defect, and
  Done when 3 no longer names it. The gate's no-op-logger idea was not run and
  is not a Done when line.
- F6, the seed-4 workbook log test runs seventh, not sixth, and the module comment
  is quoted as written. The claim that `a workbook was described` comes only from
  the describing describe was wrong, since the route logs the line when it
  answers a describe with a body, `ok` either way, and not when it refuses the
  request; the Reproduction now says what the assertion at line 807
  shows.

**2026-11-10, the owner's answer on gate 2's two lows, recorded by the lander
before the fixes.**

- Question: gate 2 passed this filing and left two low findings, F6's remaining
  clause (the route's `a workbook was described` line is not logged for a
  refused describe) and N1 (`Done when 2` and `8` pin the files' totals, `(63)`
  and `(45)`). Neither a `Done when` line depends on the first. Fix both at the
  landing with no re-gate, fix F6 only, or fix neither?
- Options: (1) fix both at the landing, with no re-gate (recommended); (2) fix
  F6 only; (3) fix neither.
- Choice: (1), fix both at the landing, with no re-gate. The recommended option.
- Provenance: the owner, 2026-11-10, at tools-86 checkpoint 10. The
  orchestrator relayed the answer in the lander's dispatch; the lander records
  it as relayed and did not verify it against the owner directly.

- 2026-11-10 — Gate 1's and gate 2's full reports are on the pull request
  thread, #789; status unchanged.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, F6 remaining clause —
  "false text, in the safe direction". The Reproduction and the gate 1 entry
  above now say the line is logged when the route answers with a body, `ok`
  either way, and not when it refuses the request. Proof, run after the commit:
  `git diff 64c2d9a6 HEAD -- <this file> | grep -c '^-.*<fragment>'` → `1` for
  each removed fragment, `whether its answer is ok or a refusal` and
  `reaches its handler; the Reproduction`.
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N1 — "Done when 2 and 8
  pin the files' totals". Both lines now require `Tests  1 passed` with every
  other test skipped and exit 0, without pinning the total. Proof, the same
  command: → `1` for `so the counts are what discriminate` (Done when 2) and `1`
  for `never on confirm.*exits 0 with` (Done when 8).
