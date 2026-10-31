---
id: lg-69
tool: ledger
title: The ledger suite waits 4 s on a socket, asserts per trial and still checks lg-65's old search
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-69 — The ledger suite waits on a socket, asserts per trial and checks an old search

## Why

Ledger is 101 s of summed test time on CI ubuntu and 132 s on Windows (run
`40210503276`), the second-largest project. The test-suite audit of 2026-10-25
found about 23 s of it buys no coverage, and measured the largest items:

- `api/test/receipts.test.ts:733` takes 4 s, and **all 4 s is
  `app.shutdown()` waiting on the socket of a fetch the test aborted.** A
  bare-Fastify repro closed in 4001 ms, in 1 ms with
  `server.server.closeAllConnections()` before close, and in 0 ms with
  `forceCloseConnections: true`.
- `books/test/household-settlement.test.ts` runs thousands of random trials, each
  with several `expect` calls. The same 3,000 trials without `expect` take
  123–144 ms, against 1.15–1.44 s per size on CI. About 85–90 % of the time is
  assertion overhead.
- lg-65's frozen-oracle specs compare the search against a copy of the code it
  replaced. lg-65's own mutation table shows `lg-65-search.test.ts` misses M2,
  which `lg-65-search-direct.test.ts` catches. The direct spec's first failing
  case per mutant is 19, 65, 280 and 1774, so 5,000 cases still catch all four.
- Every api test migrates a fresh `:memory:` books database. Migrating costs
  9.7–17 ms; deserialising an already-migrated buffer costs 0.45 ms (measured).
  There are about 550 boots.

## Decision — answered 2026-10-25 by the owner

- **Deleting lg-65's old-search comparison and trimming the direct spec:
  approved.** `lg-65-search.test.ts` and its only helper are deleted, and the
  direct spec drops from 20,000 to 5,000 cases.
- **Clear duplicates may be deleted.**
- **Template database: a test-only seam.** Options put:
  - (a) a `createApp` or `Books` option that a test helper fills with a migrated
    buffer, leaving production paths unchanged;
  - (b) `books.ts` caches a template whenever `dataDir === ":memory:"`;
  - (c) skip it.

  **Chosen: (a).**

## Build

1. `api/test/receipts.test.ts:733`: at the end of the test, or in an `afterEach`
   for apps that `listen()`ed, call `target.server.server.closeAllConnections()`
   before shutdown. Then grep ledger's other tests that `listen()` and abort a
   `fetch`, and treat them the same. ~4 s (measured).
2. `books/test/household-settlement.test.ts:85, 124-171, 358`: collect failing
   trials in an array and assert once at the end, naming the first failing
   trial and its inputs, as `lg-65-search.test.ts` did. Keep every trial count.
   The memory note "tolerance needs a varied fixture" is why the counts stay.
   ~4 s.
3. Delete `api/test/lg-65-search.test.ts` and `api/test/helpers/paste-population.ts`
   (its only user). Keep `helpers/reference-search.ts`, which the direct spec
   still uses. ~5 s.
4. `api/test/lg-65-search-direct.test.ts:63`: `DEFAULT_CASES = 5_000`, with a
   comment citing lg-65's mutation table (first failing case 1774 for M2).
   ~4 s.
5. Template database:
   - Add a test-only option on `createApp` or the `Books` constructor
     (`api/src/books.ts:209`) that accepts a serialized, migrated database.
   - Add an `api/test/helpers` function that migrates once per worker and hands
     each boot a deserialised copy.
   - Leave file-backed tests (workbook-import, the receipt files) as they are,
     or give them a `copyFileSync` of a template file if that is simple.
   - ~5 s.
6. `web/test/history.test.tsx:58,151`: the search uses a real 300 ms debounce
   (`History.tsx:34` `SEARCH_DELAY_MS`). Use fake timers with
   `shouldAdvanceTime` and advance by 300. Replace the `setTimeout(…, 20)`
   sleep at `:269`. ~0.6–1 s.
7. `api/test/receipts.test.ts:1377, 1392, 1422, 1688, 1726, 1739, 1781` repeat
   the `splitReceipt` cases in `books/test/receipts.test.ts:709, 729, 787, 957,
   973, 988, 1003`, with the same inputs and cents. Delete them. Keep `:1663`
   (the per-person charge-line wiring) and the `test.each` at `:1703` (the
   route-level refusal message). ~0.3 s.

## Done when

1. `npm test -- --project ledger` passes, and this pull request's CI shows
   ledger's summed file time at least 15 s below run `40210503276`'s 101 s. The
   Log states the measured difference.
2. `receipts.test.ts`'s signal case takes under 500 ms on CI.
3. `household-settlement.test.ts` still fails, naming the trial, when the
   settlement is broken. Prove it with one deliberate mutation in a scratch run,
   recorded in the Log.
4. The direct lg-65 spec at 5,000 cases still fails on each of lg-65's mutants
   M1–M4. Re-run them in a scratch run and record the result in the Log.
5. No production code path changes. The template is reachable only through the
   test-only option (test).

## Log

- 2026-10-25: Filed from the test-suite audit; see
  [repo-127](../../../../docs/work/repo-127-pull-requests-run-every-project-whatever-they-touch.md).
  Checked and kept: `layout.test.ts` and `layout-live-gate.test.ts` (lg-66
  reuses the harness), and `lg-65-alternating-dates.test.ts`, the performance
  regression spec. All helpers and fixtures are imported, and nothing is skipped.
  Not measured and not in scope: happy-dom for the 16 jsdom files. repo-129
  covers `isolate: false`.
- 2026-10-31: Built on `lg-69-ledger-test-waits` from `f05108d2`. Every
  cited line resolved to the same test at `f05108d2` except `receipts.test.ts:1703`,
  a blank line there, with the `test.each` at 1704 (kept).
  - **Build 1.** `afterEach` in `api/test/receipts.test.ts` calls
    `app?.server.server.closeAllConnections()` before `shutdown()`. It is the only
    spec in ledger that `listen()`s (`grep -rln "\.listen(\|createServer("
    tools/ledger` finds it and `api/src/main.ts`), so no other test needed it. The
    signal test: 4064 ms in the base run (`base.json`, the whole ledger project) to
    198 ms (`npx vitest run tools/ledger/api/test/receipts.test.ts -t signal
    --reporter=verbose`).
  - **Build 2.** `books/test/helpers/trials.ts` (`trials()`: `begin`, `holds`,
    `equal`, `assertNone`) collects what a loop finds and fails once, naming the
    first failing trial, its inputs and how many failed. All three loops of
    `household-settlement.test.ts` use it; every trial count is unchanged (5,000,
    3,000 each for 3, 4 and 5 people, 5,000). The file ran in 3,638 ms in the
    base run and 1,614 ms in mine (1.28 s alone).
  - **Build 3 and 4.** `api/test/lg-65-search.test.ts` and
    `api/test/helpers/paste-population.ts` are deleted (nothing else imported the
    helper). `DEFAULT_CASES` is 5,000 with the comment citing lg-65's table. The
    direct spec: 5,334 ms to 2,794 ms in the same two runs (1.2 s alone).
  - **Build 5, the seam.** `CreateAppOptions.booksTemplate?: Buffer`
    (`api/src/server.ts`), passed as `Books`'s `template` (`api/src/books.ts`),
    used only when the books are `:memory:`: `new Database(template)` instead of
    `new Database(":memory:")`. better-sqlite3 copies the buffer, so households do
    not share one. `main.ts` and `ApiConfig` do not carry it. **The call shape for
    lg-67 and lg-74:** `import { migratedBooks } from "./helpers/template.ts";`
    then `createApp({ ..., booksTemplate: migratedBooks() })`. `migratedBooks()`
    builds the template from the app's own `configure` and `applyMigrations`, once
    per test file (vitest gives each file its own module registry; under
    repo-129's `isolate: false` it would be once per worker). It is added to every
    `createApp({` in the api specs and helpers except `books.test.ts` (it tests the
    migration path), `health.test.ts` (its boots are the health probe's) and
    `config-access.test.ts` (its boots refuse before the books open); file-backed
    boots ignore it. Measured with a scratch script, 150 boots, three rounds:
    13.3 to 14.4 ms a boot without it, 8.1 to 8.7 with it, about 5 ms a boot and
    about 2.8 s over the 550 boots, not the audit's 5 s: a boot also builds Fastify.
    `api/test/books-template.test.ts` pins it: used when given, equal in schema,
    version and enrolled people to a migrated boot, not used when not given and
    not a config key, ignored for files, and a copy per household and per app.
  - **Build 6.** `web/test/history.test.tsx`: `fakeClock()` is
    `vi.useFakeTimers({ shouldAdvanceTime: true })` in the three tests that wait
    on the pause or on a late answer, `pass(ms)` advances inside `act`, and the
    `setTimeout(…, 20)` sleep is `pass(20)`; `afterEach` restores real timers.
    **What the brief had wrong:** I first asserted nothing sent at 299 ms and one
    request at 300, and the full run failed it once (`expected … length 2 but got
    3`): `shouldAdvanceTime` also moves the clock by real time, which a loaded run
    makes more than 1 ms. The test keeps the original's claim (three keystrokes, one
    request after the pause) and no more. File: 2,928 ms of test time in the
    base run (1697+272+406+152+87+32+282 ms over its 7 tests) against 987 ms in
    one run alone.
  - **Build 7.** Seven tests deleted from `api/test/receipts.test.ts`, each
    compared with its `splitReceipt` twin in `books/test/receipts.test.ts` for the
    inputs and the cents: 1377 to `:709` (922 and
    1,554), 1392 to `:729` (shared -7 at 2,470), 1422 to `:787` (the coupon,
    565), 1688 to `:957` (-923 and -1,553), 1726 to `:988` (11,58 $ to sam), 1739
    to `:1003` (a cent under the total) and 1781 to `:973` (casey 1,554, sam 574). The
    `test.each` at 1704 keeps the route's refusal message and the zero rows;
    1663 stays. Their helpers `BASKET_REFUND` and `twoTaxed` were unused after
    and are deleted. `api/test/receipts.test.ts`: 75 tests to 68.
  - **Done when 3.** `mutate-settle.mjs` (scratch) plants one break in
    `books/src/settlement.ts` at a time and runs `npx vitest run
    tools/ledger/books/test/household-settlement.test.ts`. S1, every deposit two
    cents too large: `Tests 8 failed | 3 passed`, the first failure
    `3 people, trial 0, alex stands -1034680 millionths of a cent off after the
    deposits`, with the inputs printed; the two-person loop names `trial 0,
    settleHousehold as a pair` (expected `depositCents` 440374, got 440376).
    S2, the last transfer dropped for three or more people: `Tests 5 failed | 6
    passed`, `3 people, trial 0, blair is 116296565484 millionths of a cent off
    the transfers`. The file was restored in-process; `git status --short` empty
    after.
  - **Done when 4.** `mutate-search.mjs` (scratch) plants lg-65's M1 to M4 in
    `api/src/workbook-days.ts` one at a time and runs the direct spec at 5,000
    cases. All four fail (`Tests 1 failed (1)`), at the first cases lg-65's table
    gives: M1 case 280, M2 case 1774, M3 case 65, M4 case 19. The file was
    restored; `git status --short` empty after.
  - **Done when 5.** The template is reachable only through `booksTemplate`:
    `books-template.test.ts` › "is reachable only through the option: not given,
    not used, and not a config key". No other `src` line changed: `git diff
    f05108d2 --stat -- tools/ledger/api/src` is the two files above.
  - **Not folded in:** nothing small and already specified came free. The
    unmeasured happy-dom idea and `isolate: false` stay with repo-129.
- 2026-10-31: **Done when 1, read on this pull request's CI** (#679, head
  `ed231483`, run `41207755705`, job `124556257761`, `test (ubuntu-latest)`, all
  checks green). Summing every `ledger` project line's time in the job log with
  the same script on both logs (`sumlog.mjs`, scratch: it strips the colour codes,
  counts each file once and adds its `NNNms`): run `40210503276`'s job
  `121220542726` reads 81 files, 1,687 tests, **100,827 ms** (the ticket's 101 s);
  this run reads 86 files, 1,840 tests, **75,092 ms**. That is **25.7 s lower**
  against the 15 s asked, with 153 more tests in the later run (main grew between
  them, and `books-template.test.ts` adds 5). The files this ticket touched, from
  the same log: `api/test/receipts.test.ts` 6,608 to 2,352 ms,
  `lg-65-search-direct.test.ts` 5,444 to 1,702 ms,
  `household-settlement.test.ts` 5,240 to 1,513 ms, `history.test.tsx` 2,787 to
  1,551 ms, and `lg-65-search.test.ts` (5,083 ms) is gone.
  The Windows leg (informational) passed, 3m20s.
  **Done when 2 on CI is not read directly**: the default reporter prints a time
  per file, not per test, so the signal case has no CI figure. Its file lost
  4,256 ms (6,608 to 2,352), which is the 4 s the ticket measured, and the case ran
  198 ms locally (`--reporter=verbose`, against 4,064 ms in the base run).
