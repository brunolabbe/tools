---
id: lg-106
tool: ledger
title: The two log tests read what earlier tests logged, so a shuffled run fails them
kind: fix
status: done
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
3. No `LOGGED` precondition in either file is satisfied by an empty array: the `toBeGreaterThanOrEqual(4)` floor, one per request the test makes, and each `LOGGED.some(...)` assert against lines the test's own run produced.
4. Unshuffled, both files pass in full: `npx vitest run tools/ledger/api/test/csv-import.test.ts` and `npx vitest run tools/ledger/api/test/workbook-describe.test.ts`, with the counts in the Log.
5. `grep -n "tests in order\|Last: it reads" tools/ledger/api/test/csv-import.test.ts tools/ledger/api/test/workbook-describe.test.ts` prints nothing. At the base it prints one line per file (`workbook-describe.test.ts:790` and `csv-import.test.ts:1110`), so it fails there.
6. `git diff --name-only origin/main...HEAD` lists only the two spec files and this ticket. Nothing under `tools/ledger/api/src` or `tools/ledger/contract` changes.
7. `npm run check` exits 0, and `npm test -- --project ledger` passes through the test gate, both at the fix's head.
8. A filtered run of an unrelated test passes, so a file-level hook cannot hide: `npx vitest run tools/ledger/api/test/csv-import.test.ts -t "the fake is called once on describe and never on confirm"` exits 0 and reads `Tests  1 passed` with every other test skipped, and `npx vitest run tools/ledger/api/test/workbook-describe.test.ts -t "lg37: a fake answering its correct description"` does the same, without pinning the total. Both exit 0 at the base, measured 2026-11-10 (Reproduction 7).

## Review

**Gate: FAIL** — 2026-11-15 · `4e040577..c13b7559` (the branch merges `origin/main` `e7d791d6`, three downloader `.md` files only; diffed from `e7d791d6` for the branch's own files) · Opus 5.5, depth medium plus the dispatch's four attacks

| Done when                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Seeds 1–10 pass for both files under `--sequence.shuffle`      | **verified** — seeds 1–20 run, one file at a time: csv-import `Tests 63 passed (63)` 20 of 20, workbook-describe `Tests 48 passed (48)` 20 of 20. At the base, csv-import fails at seeds 3 and 10 and workbook-describe at 2, 9 and 10, each on its log test                                                                                                                                                    |
| 2. Each log test passes alone under `-t`                          | **verified** — `-t "no line of any request above holds a CSV"` exit 0, `1 passed \| 62 skipped (63)`; `-t "no line of any request above holds the upload"` exit 0, `1 passed \| 47 skipped (48)`                                                                                                                                                                                                                |
| 3. No `LOGGED` precondition is satisfied by an empty array        | **verified** in property — `csv-import.test.ts` and `workbook-describe.test.ts` › the log test, `expect(logged.length).toBeGreaterThanOrEqual(2)` over `LOGGED.slice(first)`, plus the two `logged.some(...)`. Silencing the three route lines, or the whole logger, turns both red at `expected 0 to be greater than or equal to 2`. The line names `toBeGreaterThan(20)`, which no longer exists (low, below) |
| 4. Both files pass unshuffled                                     | **verified** — `63 passed (63)` and `48 passed (48)`                                                                                                                                                                                                                                                                                                                                                            |
| 5. The order-comment grep prints nothing                          | **verified** — grep exit 1, no output                                                                                                                                                                                                                                                                                                                                                                           |
| 6. Only the two specs and the ticket change                       | **verified** — `git diff --name-only e7d791d6...c13b7559` lists `csv-import.test.ts`, `workbook-describe.test.ts` and the ticket. Nothing under `api/src`, `contract`, a vitest config or `.claude/`                                                                                                                                                                                                            |
| 7. `npm run check` exits 0, `npm test -- --project ledger` passes | **verified** — PR #805 at `c13b7559`: `check` (CI) success; `test (ubuntu-latest)` ran `--project ledger --project repo --project core`, `Test Files 136 passed (136)`, `Tests 3119 passed (3119)`. Not run locally, as the dispatch directed                                                                                                                                                                   |
| 8. A filtered run of an unrelated test passes                     | **verified** — `-t "the fake is called once on describe and never on confirm"` exit 0, `1 passed \| 62 skipped (63)`; `-t "lg37: a fake answering its correct description"` exit 0, `1 passed \| 47 skipped (48)`                                                                                                                                                                                               |

- **high** · **open decision** · no `Done when` line depends on it, since every line is met as written · **The log tests no longer read a refused request's line, and the CSV half lost a guard against a real leak.** The base test read every line its file logged. Those lines included the error handler's `request rejected` lines from refused confirms, and the head test reads only one successful describe and one successful confirm. The plant was the `request rejected` fields in `registerErrorHandling` (`api/src/server.ts`) given `message: appError.message, details: appError.details`. With it, the base csv-import file in source order reads `Tests 1 failed | 62 passed (63)`: the log test catches three `CSV_NOT_AFTER_TAIL` lines whose message carries a CSV row's text (`2024-01-02 \"DEPOT PAIE\" 1823.45 $`). At head, `-t` on the same test reads `1 passed | 62 skipped (63)`, and no other test in the file catches the leak (62 of 62 passed under the plant at the base). The workbook half also goes from red at the base (`1 failed | 47 passed (48)`) to green at head. Its base catch, however, was the generic `.xlsx` substring in the `WORKBOOK_NOT_XLSX` message, not upload content. So for that half this measures a lost reading, not a lost content guard. The titles still say "no line of **any request above**", which promises coverage the body no longer keeps. A reader who trusts that title is unsafe. Options: (1) **recommended** — each log test also makes, against its own app, the refused requests whose lines it used to read. For csv-import that is at least a confirm refused with `CSV_NOT_AFTER_TAIL` (overlap and gap). For workbook-describe it is a refused describe and a refused confirm. The test stays order-free. This is a direction: the gate did not run it. (2) Accept the narrower test: reword both titles and their comments to say they cover their own successful describe and confirm, and file the refused-line coverage as a ticket. A title reword also changes Done when 2's `-t` patterns.
- **med** · no `Done when` line depends on it · pre-existing: the secret list is unchanged from the base · **The CSV log test passes when the route logs the whole request body.** For the plant, `context.logger.info("body", { body: request.body })` went before the describe route's `a workbook was described` line, or before the confirm route's `if (body.kind === "csv")`. At head, `-t` reads `1 passed | 62 skipped (63)` for both plants. At the base, the full file reads `63 passed (63)` for both. The base64 upload holds none of the plain-text secrets, and the CSV list has no base64 entry, although the workbook list does. Remedy, run: add `bytesOf("csv-balance").toString("base64").slice(0, 40)` to the CSV test's `secrets`. Unplanted, that reads `1 passed | 62 skipped (63)`, and both body plants read `1 failed | 62 skipped (63)`. This is graded `med` rather than `high` only because the branch did not introduce it.
- **low** · `workbook-describe.test.ts` › the log test keeps `fileOf("lg37").toString("base64").slice(0, 40)` as its body secret, but it now uploads only `lg7`. A plant that logs 60 base64 characters of the describe body still goes red (`1 failed | 47 skipped (48)`), which the gate infers comes from the two `.xlsx` files sharing their first 30 bytes (the zip header). The gate did not measure those bytes directly. Direction: name `lg7`, the file the test sends.
- **low** · Done when 3 names `toBeGreaterThan(20)`, which the branch replaced with `toBeGreaterThanOrEqual(2)`. The Log explains why: the test's own two requests log exactly two lines, which the gate's dump confirmed. The property holds, so the wording is the owner's to reword.
- **low** · false text in the safe direction · `.claude/rules/testing.md` still names `csv-import.test.ts` and `workbook-describe.test.ts` as failing under plain `--sequence.shuffle`, which is now false (40 of 40). Build 4 forbids the `.claude/` edit on this branch, and the Log proposes the line instead.
- **dropped** · three controls whose plants did not reach their file's kind of upload: `confirm-row` on workbook-describe decodes `.xlsx` bytes as text, and `describe-cells` on csv-import reads sheets from a CSV. Both passed because they planted nothing readable. Also dropped: two `base-describe-cells` rows in the gate's own `controls.txt` that ran on head specs. A restore step in the gate's script had reverted the base copies.
- **dropped** · the slice boundary (attack 2): neither file uses `concurrent`. Every `inject` and `start()` is awaited, `afterEach` awaits `app.shutdown()`, and the core logger's `write` is synchronous. Under `-t` the slice holds exactly the two route lines (`first=0 n=2` in both files). Nothing can enter the slice from another test. This is backed by 40 of 40 shuffled runs, not a proof over every order.
- **findings** · the hunt returned 7; 5 carried, 2 dropped.
- NFR: security — the high and med above (log-leak guards) · performance n/a (two requests per test) · reliability ✓ (order dependence gone, 40 of 40 seeds) · maintainability — the lows above.

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

**2026-11-15, built (builder, Sonnet 5.5), base `4e040577`.** Option (a), as the
owner chose on 2026-11-10 (the Log above): each log test now makes its own
requests against its own app and reads only the lines that app logged.

- `csv-import.test.ts`, the log test: starts an app, describes and confirms
  `csv-balance`, and reads `LOGGED.slice(first)`, `first` being `LOGGED.length`
  before its own `start()`. `workbook-describe.test.ts`, the log test: the same
  with `lg7` (describe, then confirm, both 200). The secret search, the
  `a workbook was described` check and the `a described CSV was stored` /
  `a described workbook was imported` checks all read that slice, so none can
  be met by another test's lines. Both order comments are replaced (the csv one
  by a statement that the test stands alone and why it slices).
- **What the brief had wrong.** (1) The `toBeGreaterThan(20)` cannot hold on the
  test's own run: a describe and a confirm log two lines (the route's `info`
  line each, nothing else at `debug`), measured as `expected 2 to be greater
  than 1000` in both files. The 20 came from every app of the file adding up.
  It is now `toBeGreaterThanOrEqual(2)`, which is not met by an empty slice, and
  the two `some` checks cover the specific lines. (2) The Reproduction's totals
  (63/45), line numbers and base `a100f429` are stale: at `4e040577`
  workbook-describe has 48 tests, its log test is at `:797` and `LOGGED` is
  declared at `:152`; csv-import has 63. Seed 4 no longer fails workbook-describe
  at the base; seeds 2, 9 and 10 do (below). (3) The old comment's premise that the log test is last was already
  false in `workbook-describe.test.ts` (the
  web's fixture describe follows it); the new test does not care.
- **Base, same files copied under another name** (`git show 4e040577:<path>`,
  run with `--sequence.shuffle --sequence.seed=N`, copies deleted): csv-import
  seed 3 `expected 0 to be greater than 20`, seed 6 `expected false to be true`,
  seed 7 `expected 0 to be greater than 20`, each `Tests 1 failed | 62 passed
  (63)`; workbook-describe seed 2 and 9 `expected false to be true`, seed 10
  `expected 0 to be greater than 20`, each `1 failed | 47 passed (48)`. `-t` on
  the log test: `Tests 1 failed | 62 skipped (63)` and `1 failed | 47 skipped
  (48)`.
- **Head, Done when 1.** `npx vitest run <file> --sequence.shuffle
  --sequence.seed=N`, N from 1 to 20 (the ticket asks 1 to 10): csv-import
  `Tests 63 passed (63)` for all twenty, workbook-describe `Tests 48 passed
  (48)` for all twenty.
- **Done when 2.** `-t "no line of any request above holds a CSV"` reads
  `Tests 1 passed | 62 skipped (63)`; `-t "no line of any request above holds the
  upload"` reads `Tests 1 passed | 47 skipped (48)`.
- **Done when 4.** Unshuffled: csv-import `63 passed (63)`, workbook-describe
  `48 passed (48)`.
- **Done when 5.** `grep -n "tests in order\|Last: it reads"` on the two files
  prints nothing (grep exit 1).
- **Done when 8.** `-t "the fake is called once on describe and never on
  confirm"` reads `1 passed | 62 skipped (63)`; `-t "lg37: a fake answering its
  correct description"` reads `1 passed | 47 skipped (48)`.
- **Not folded in.** `csv-import.test.ts:1005`'s read of `LOGGED` needs no
  change (its own app logs its rejected request). `.claude/rules/testing.md`
  says plain `--sequence.shuffle` fails these two files; after this change it
  no longer does, but that page is the owner's, so the line is proposed in the
  report and not edited here.

**2026-11-15, the owner's answers on gate 1's findings at `c13b7559`, recorded
before round 1's changes.**

- Question (gate 1, high): the log tests no longer read a refused request's
  line (`request rejected`), so the CSV half lost a guard against a real leak.
  The gate's plant, `message` and `details` added to that line in
  `registerErrorHandling`, turned the base csv-import log test red on
  `CSV_NOT_AFTER_TAIL` lines carrying a CSV row's text, and left the head test
  green. Options: (1) each log test also makes, against its own app, the
  refused requests whose lines it used to read; (2) accept the narrower test,
  reword both titles and file the refused-line coverage, which would also
  change Done when 2's `-t` patterns.
- Choice: (1). The recommended option (the gate's and the builder's). The
  titles stay, so Done when 2's `-t` patterns keep matching.
- Also decided: `.claude/rules/testing.md`'s parenthesis naming
  `csv-import.test.ts` and `workbook-describe.test.ts` as shuffle-order
  dependent will be dropped by a separate `docs(repo)` pull request after #805
  merges, on the owner's instruction. Nothing under `.claude/` changes on this
  branch (Build 4, Done when 6).
- Not in this round, by the owner's instruction: Done when 3 still names
  `toBeGreaterThan(20)`; it is not reworded.
- The med (CSV secrets lack a base64 entry) and the low (workbook names `lg37`
  while sending `lg7`) are fixed with the high, without a question.
- Provenance: the owner, 2026-11-15; the orchestrator relayed it in the round-1
  message, and the builder records it as relayed, not verified against the owner.

**2026-11-15, round 1 (builder, Sonnet 5.5), gate 1's findings on `c13b7559`,
fixed in `d4448884`.**

- High, fixed (owner's option 1). Each log test now also makes its refusals
  against its own apps and checks them. csv-import: the same file confirmed a
  second time (overlap), and a confirm onto a stored tail it does not follow
  (gap), in a second app started after the first is shut down; both are
  `CSV_NOT_AFTER_TAIL`, and the test requires exactly two `request rejected`
  lines carrying that code. workbook-describe: `PK\u0003\u0004` plus text,
  refused by Describe and by Confirm as `WORKBOOK_NOT_XLSX`, and exactly two
  such lines. The line-count floor is now 4 in both files, one line per request made
  (describe, confirm and two refusals). The titles
  are unchanged, so Done when 2's patterns match.
- Med, fixed. The CSV secrets gain
  `bytesOf("csv-balance").toString("base64").slice(0, 40)`.
- Low, fixed. The workbook test's base64 secret names `lg7`, the file it sends.
- The gate's plants, run at `d4448884` with the gate's own `mutate3.mjs` and
  `mutate2.mjs`, each restored with `git checkout HEAD -- <path>` and the tree
  clean after (`-t`, one file, each reading `1 failed | N skipped`):
  - `request rejected` carrying `message` and `details`: csv-import red,
    `expected [ …(2) ] to deeply equal []`, the two lines `CSV_NOT_AFTER_TAIL`
    with `2024-01-02 \"DEPOT PAIE\" 1823.45 $` in `message`; workbook-describe
    red, `expected [ …(2) ] to deeply equal []`.
  - `describe-body` (the whole body logged before the describe line): both red,
    `expected [ Array(1) ] to deeply equal []`.
  - `confirm-body`: both red, the same message.
  - Unplanted: `1 passed | 62 skipped (63)` and `1 passed | 47 skipped (48)`.
- Done when 1 to 20 seeds, each file alone: csv-import `63 passed (63)` for
  all twenty and unshuffled, workbook-describe `48 passed (48)` for all twenty
  and unshuffled. Done when 2, 8: exit 0 for the four `-t` commands, with
  `1 passed` and the rest skipped. Done when 5: grep exit 1, no output. Done
  when 6: `git diff --name-only origin/main...HEAD` lists the two specs and this
  ticket. `npm run check` exit 0.
- Not changed, on the owner's instruction: Done when 3 still names
  `toBeGreaterThan(20)`; the property it states holds (`>= 4`
  over the slice, never over an empty array).
- Proposed, for the owner, not edited: `.claude/rules/testing.md`'s parenthesis
  naming `csv-import.test.ts` and `workbook-describe.test.ts` as
  shuffle-order dependent. The owner has said a separate `docs(repo)` pull
  request drops it after #805 merges.

**2026-11-15, round 2 (fixer, Sonnet 5.5), gate 2's finding on `481a23fe`, fixed
in `c0757103`.**

- Finding, fixed. The workbook log test's refusals upload `notOne`, and neither
  its bytes nor its base64 were in `secrets`, so a `request rejected` line
  carrying the refused upload passed. The test lost a guard the base had: at the
  base spec the base64 plant is red on 12 refusal lines. The workbook test's
  `secrets` now also hold `notOne.toString("base64")` and `"this is not a
  workbook"`, the change gate 2 measured as its remedy; nothing else moved. Gate 2's
  other remedy (refusing a real `lg7` upload as well) is not part of this
  round.
- Reproduced before the fix, gate 2's `controls5.sh` at `481a23fe`: under both
  plants the workbook log test read `Tests 1 passed | 47 skipped (48)` and the
  CSV log test `1 failed | 62 skipped (63)`.
- After, `controls5.sh` at `c0757103`, under `-t`: `rejected-b64` and
  `rejected-text` each give the workbook test `1 failed | 47 skipped (48)`
  (`expected [ …(2) ] to deeply equal []`) and the CSV test `1 failed | 62
  skipped (63)`. At the base spec the b64 plant is `1 failed | 47 passed (48)`
  with 12 lines. `git status --short` empty after the restore.
- Unplanted: `-t "no line of any request above holds the upload"` reads `1 passed
  | 47 skipped (48)`, the whole file `48 passed (48)`. Seeds 1 to 20 with
  `--sequence.shuffle --sequence.seed=N`, workbook-describe alone: `Tests 48
  passed (48)` for all twenty. `git diff --name-only origin/main...HEAD` lists
  the two specs and this ticket. `npm run check` exit 0.
- Recorded unfixed, not touched: gate 2's N1 (the CSV floor comment says "four
  requests", the slice holds 6), gate 1's F4 (Done when 3's wording) and F5
  (`.claude/rules/testing.md`, a separate pull request).

**2026-11-15, three below-floor findings the owner chose to fix at the landing,
with no re-gate.**

- 2026-11-15 — Fixed at landing by owner choice: gate 3, P1 — "A .slice(0, 40) on the notOne secret would make the two consistent". The workbook log test's `notOne.toString("base64")` secret now carries `.slice(0, 40)`, as the `lg7` secret does. Proof, `controls5.sh` of gate 2 with `mutate4.mjs` copied to the lander's out directory: under `rejected-b64` the workbook log test reads `1 failed | 47 skipped (48)` and the CSV log test `1 failed | 62 skipped (63)`, and unplanted `workbook-describe.test.ts` reads `48 passed (48)`; `git status --short` is empty after the restore.
- 2026-11-15 — Fixed at landing by owner choice: gate 2, N1 — "A line for each of the four requests". The CSV log test's floor comment now says the slice holds at least a line for each of the four requests plus the first app's shutdown lines, so `>= 4` is a floor; no assertion changed. Proof, run after the commit: `git diff b34060c9 HEAD -- tools/ledger/api/test/csv-import.test.ts | grep -c '^-.*A line for each of the four requests'` → `1`, and `-t "no line of any request above holds a CSV"` reads `1 passed`.
- 2026-11-15 — Fixed at landing by owner choice: gate 1, the low on Done when 3 — "Done when 3 names toBeGreaterThan(20)". Done when 3 now names the floor as it stands, `toBeGreaterThanOrEqual(4)`, one per request the test makes, and nothing else in that line changed. Proof, run after the commit: `git diff b34060c9 HEAD -- <this file> | grep -c '^-.*precondition in either file is satisfied'` → `1`.
