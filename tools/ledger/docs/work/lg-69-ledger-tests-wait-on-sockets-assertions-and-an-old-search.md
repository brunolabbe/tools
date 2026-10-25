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
