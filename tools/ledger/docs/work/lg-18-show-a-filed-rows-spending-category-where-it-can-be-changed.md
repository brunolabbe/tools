---
id: lg-18
tool: ledger
title: Show a filed row's spending category where a person can change it
kind: work-package
status: done
milestone: P5
depends_on: [lg-9, lg-15]
difficulty: standard
---

# lg-18 — Show a filed row's spending category where a person can change it

## Why

[lg-15](./lg-15-spending-categories-on-bank-rows.md)'s gate left this as its F9: a
filed row that has a spending category appears on no web screen, so a row the map
or a rule categorised wrongly cannot be given an override from the web. lg-15's
brief says a row's category is "shown wherever the row is, and editable there"; that
holds only because no screen shows such a row. The stats screen
([lg-9](./lg-9-history-and-stats.md)) is where a wrong category becomes visible, as
a slice of the wrong colour, and it has no way to reach the rows behind it.

**Reproduction**, on `main` as of lg-15:

```bash
grep -rn "ROUTES.rows\|fetchUncategorisedRows\|setRowSpendingCategory" tools/ledger/web/src
```

prints one reader of `GET /api/rows`, `fetchUncategorisedRows` in
`web/src/api/spending.ts:79`, which asks for `?spendingCategory=none&limit=50`; its
one caller is the Categories screen, and the other writer of an override
(`Inbox.tsx:134`, `setFiledSpending`) is on `AutoFiled.tsx`, which since lg-17 shows
and edits the category of rows filed automatically and not yet reviewed. A row filed
by a rule or by hand, and an auto-filed row once reviewed, is read by nothing on the
web.

## Build

A person looking at a period's spending (lg-9) can open the rows behind it and set a
row's own spending category from there, with `RowSpending`, which already shows
where a category came from and writes the override.

What nothing specifies yet, and the builder decides with the owner before building:

1. **The list.** Rows of one period (and one category within it), newest first, from
   `GET /api/rows`. That route takes only `spendingCategory=none` and `limit`; it
   needs a date range and a spending category filter, and paging, because it reads
   every stored row and applies `limit` last (lg-15's F10).
2. **Which rows.** The stats count joint rows filed to the buffer and stored period
   lines. A period line has no override: a correction is a new line posted to
   `/api/period-lines/:id`, so the list either covers bank rows only or both, with
   two different writes.
3. **Where it opens from.** A column or a line of the spending chart, or the table
   twin; on a phone a tap target is the 28px slot the chart already has.

## Done when

1. A row the map or a rule categorised wrongly can be given its own category from
   the web, and the stats screen then shows it under the new one. A web test proves
   it, and an API test proves the filter and the paging of `GET /api/rows`.
2. The list is reached from a period of the spending chart without leaving the
   screen's one range.
3. Gates green.

## Review

**Gate: FAIL** — 2026-10-11 · `55214e67..9e127f79` · Opus 5.5, depth full

| Done when                                                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A wrongly categorised row gets its own category from the web, and the stats then show it under the new one; a web test, and an API test of the filter and the paging | `web/test/stats-rows.test.tsx` › "a row given a category of its own is written, and the chart counts it under the new one" (the write, the stats read again, Household in the readout) ✓; `api/test/stats.test.ts` › "a row given its own category moves from one list to the other" (the stats count 80000 under Household) ✓; filter: "scope=spending lists what the chart counted in the period, and nothing else" and "days narrow the list, both ends inclusive" ✓; paging: "offset and limit page the list, and the total does not move" ✓. Both tests move an _uncategorised_ row. The "map or rule" clause rests on lg-15's `api/test/spending-categories.test.ts` › "a row with its own override gets that, over its rule's and the map's". The gate's harness checked a map-categorised row given an override (Pharmacy, 3333 in its slice) |
| The list opens from a period of the spending chart without leaving the screen's one range                                                                            | `web/test/stats-rows.test.tsx` › "the readout opens the rows of the selected period, over that period's own days" and "another period's readout opens that period's days" (from/to are the period's start/end; the list sits under the card and has no range control) ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Gates green                                                                                                                                                          | **unproven (gate)**: `test (ubuntu-latest)` and `test (windows-latest, informational)` were still running on `9e127f79` when this was written; `check` ×2, `docker`, `codeql`, `CodeQL` and `dependency-review` are green on that sha. Locally `npm test -- --project ledger` gave 816 of 816                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

- **high** · F1 · shipped text false against the code: the doc comment on
  `rowsQuerySchema` in `contract/src/api.ts` says `scope=spending` means "a list
  opened from the chart sums to the slice it was opened from". That is false for
  any slice that holds card lines, because the list carries bank rows only (the
  owner's choice). The branch's own test knows it and adds `cardCents = 4000` to
  the `none` slice. Reproduction: the gate harness (below), no range:
  `2026-10-03|1 slice=12777 list=7777 expCard=5000` and
  `2026-02-28|3 slice=3000 list=0 expCard=3000`. Fix: say the list sums to the
  slice less the card lines in it, which are not rows. One sentence, no code.
- **low** · F2 · positive control: the test "a category's list sums to its slice
  of the chart, for every category and for none" stays green when
  `countsAsSpending` returns `true` for every row
  (`npx vitest run tools/ledger/api/test/stats.test.ts -t "sums to its slice"` →
  `1 passed | 25 skipped`). Both sides read the one predicate, so the test cannot
  fail on a change to it. The predicate itself is held: 6 of 26 tests in that file
  fail under the mutation. The test's fixture also has no row on a period
  boundary, and no person-assigned row or deposit inside its range, and `OPEN` is a
  constant rather than the span the stats response names. The gate's harness
  covers all of these, and it fails 3 of 3 slice tests under the same mutation.
- **low** · F3 · `nfr:maintainability` · the "More categories" path of
  `SpendingBody`'s `onOpen` in `web/src/stats/Cards.tsx` has no test. With
  `key === "more"` removed, `npx vitest run tools/ledger/web/test` still gives
  120 of 120, and the broken path would send `spendingCategory=NaN` (400).
- **low** · F4 · a category's "Rows" button is offered whenever the slice is
  non-zero, including a slice made only of card lines (harness: Household in
  2026-02, 3000 of cards, no bank row). It opens "No bank row matches.", with a
  notice giving the whole period's card total rather than that category's.
  `SpendingStatsResponse` does not carry a slice's card share, so the clean fix
  belongs with lg-19's card list.
- **low** · F5 · the open list is kept by the period's `end`. If the stats read
  after a write fails, `useSeries` returns `failed` and `Loaded` unmounts the
  chart, the list with it. An open period ending "today" also changes `end` at
  midnight, so the list vanishes on the next reload. Found by reading only; not run.
- **low** · F6 · `rowsQuerySchema.spendingCategory` coerces `0x3`, ` 1`
  (`%201`), `1e0` and `1.0` into ids, and `offset=` (empty) into 0. All of them
  answer 200 in the harness. No live call site: the web sends `String(number)`.
- **low** · F7 · lg-19 names `GET /api/period/open`. The route is
  `/api/periods/open` (`ROUTES.periodOpen`). Its reproduction grep is otherwise
  faithful (no output at `55214e67` or at the head), `npm run status -- --show lg-19`
  parses it, and `difficulty: standard` is set.
- **low** · F8 · a11y: "Show the rows" and each "Rows" button sit inside the
  readout's `aria-live="polite"` region, so every slider step re-announces them.
  Not checked with a screen reader.
- **dropped** · a category id that does not exist answers 200 with no rows. That
  is a filter matching nothing, not a defect.
- **dropped** · a query's unknown key is reported as "check body". That comes from
  `parsed` in `routes/spending-categories.ts`, which predates this branch and is
  outside the range.
- **dropped** · a change in `spendingStats`' behaviour. There is none: the
  predicate is the old `continue` condition negated (De Morgan), `filter` keeps
  the order, the existing stats tests are unchanged and green, and the harness's
  hand-computed sums match every slice.
- **dropped** · short or duplicated pages. None: the harness pages by one over
  `scope=spending` (7), `scope=spending&spendingCategory=none` (2) and everything
  (11). Each walk equals the unpaged list, and `total` stays constant across it.
- **dropped** · touch targets. `button.small` is `min-height: 2.75rem`, and the
  chart's 28px slot is untouched.
- **findings** · the hunt returned 13: 8 carried, 5 dropped.
- NFR: security ✓ (the read limit already covers the route, and the query is
  bound by parameters in SQL) · performance: the dates narrow in SQL, but the
  category and scope narrow in JavaScript, which the Log states (lg-15's F10
  narrowed, not closed) · reliability: F5 · maintainability: F2, F3.

Harness: `zz-gate-lg18.test.ts` in the gate's scratch directory. Copy it into
`tools/ledger/api/test/` and run `npx vitest run tools/ledger/api/test/zz-gate-lg18.test.ts`.
It covers rows on both ends of three periods (`2026-01-31`, `2026-02-01`,
`2026-02-28`, `2026-03-01` and today `2026-10-03`), an override over a map, an
override withdrawn, two rule categories, a person row, a deposit, a refund, an
unfiled row, a mortgage row and five card lines. It checks every slice of every
period with no range, with `to=2026-05-01` (which cuts the open period) and with a
range inside February, against sums computed by hand. 5 of 5 at the head.

### Gate 2

**Gate: CONCERNS** — 2026-10-11 · `9e127f79..17d55468` · Opus 5.5, re-gate of the round's own commits

| Done when   | Proof                                                                                                                                                                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gates green | **unproven (gate)**: on `17d55468`, `check` ×2, `changes` and `dependency-review` are green. `test (ubuntu-latest)`, `test (windows-latest, informational)`, `docker` and `codeql` were still pending when read, once. Locally `npx vitest run tools/ledger/web/test` gave 121 of 121 and `tools/ledger/api/test/stats.test.ts` gave 26 of 26 |

The other two rows are unchanged from gate 1. The round touched no source, only a
doc comment, a test title, one new test and lg-19.

- **F1 (high)** · **fixed**. The `rowsQuerySchema` comment in `contract/src/api.ts`
  now says the list sums to the slice "less the card lines in that slice, which are
  not rows". That matches the gate 1 harness (`slice=12777 list=7777` with 5000 of
  cards). The renamed test in `api/test/stats.test.ts`, "a category's list sums to
  its slice of the chart less the card lines, for every category and for none",
  now claims what its body asserts (it adds `cardCents`). The PR #426 body carries
  the same corrected sentence. A grep of `tools/ledger` for the claim finds no
  other copy.
- **F3 (low)** · **fixed**. `web/test/stats-rows.test.tsx` › "More categories opens
  the whole period, not a category". With `key === "more"` removed from
  `Cards.tsx`, that test fails: 1 failed, 120 passed of 121. Restored, all 121 pass.
  The test's premise that nine categories fold two into "More categories" holds:
  `SLOTS` is 8, and `assignSlots` gives seven their own slot when there are more
  keys than slots.
- **F7 (low)** · **fixed**. lg-19 now names `GET /api/periods/open`, and
  `npm run status -- --show lg-19` still parses it (`fix`, `ready`, `standard`,
  blocked by lg-18).
- **F4 (low)** · **moved, recorded**. lg-19's Build now carries the card-only
  slice as a contract choice for that ticket. lg-18 has no code change for it.
- **F2, F5, F6, F8 (low)** · not in this round; they stay recorded as gate 1
  wrote them.
- **findings** · the round's lines raise nothing new: 0 carried, 0 dropped.
- Nothing here is a `high`.

## Log

- 2026-10-10 — Filed from lg-9's first gate round, at the owner's choice. The owner
  was asked what to do with lg-15's F9 and chose to file it as its own ticket over
  adding the drill-down to lg-9 and over leaving it. The cost named when it was
  asked: filters and paging that nothing specifies.
- 2026-10-10 — Reproduction corrected at lg-9's landing, from gate 2's finding: the
  first draft said no screen shows a row with a category, but `AutoFiled.tsx` (lg-17)
  does for auto-filed rows not yet reviewed. The gap is the rest. Its Build should say
  what becomes of that screen's existing editor.
- 2026-10-11 — Builder stopped before building, on the Build's own stop condition: the
  list, which rows, and where it opens from are put to the owner. Measured by reading,
  not by running: `listRows` (`api/src/rows.ts`) reads every row and applies
  `spendingCategory=none` and `limit` in JavaScript, with no date, category id or
  offset; `spendingStats` (`api/src/stats.ts`) counts only rows filed to
  `current-expenses` with no person, so a list that filtered by date and category
  alone would also show deposits and unfiled rows the slice never counted. There is no
  read route for a closed period's lines (`openPeriod` takes its start from the last
  close), and the web has no wrapper for `POST /api/period-lines/:id`, which already
  keeps a corrected line's first-entered time, so a category correction cannot move a
  line into the next close. Nothing is built.
- 2026-10-11 — The owner answered all four, relayed by the orchestrator through
  `AskUserQuestion`, each the builder's recommended option. Asked, the options, the
  choice:
  1. **The list API.** Extend `/api/rows` / a new stats route / date and category
     only. **Chosen: extend `/api/rows`** with optional `from`, `to`,
     `spendingCategory=<id>|none`, `offset` and `scope=spending`, `RowsResponse`
     unchanged, one predicate shared with `spendingStats`. This is the owner's approval
     of the additive change to `@ledger/contract`.
  2. **Which rows.** Bank rows only / bank rows and card lines / an override table for
     lines. **Chosen: bank rows only**, with a notice on the list that the cards' lines
     are in the totals and not in it; the follow-up is [lg-19](./lg-19-correct-a-closed-periods-card-line-spending-category.md).
  3. **Where it opens from.** Button and per-category / one button / the table twin
     only. **Chosen: button and per-category**: "Show the rows" under the readout of
     the selected column, and a "Rows" button on each category of it.
  4. **`AutoFiled.tsx`'s editor.** Keep it / remove it. **Chosen: keep it**: it
     confirms a filing, this lists a period, and both write the same override.
- 2026-10-11 — Built. The list is `PeriodRows` under the spending chart, over the
  period's own days (the range only chooses which periods are drawn, so the list is
  not cut by it), fed by `GET /api/rows?scope=spending&from&to[&spendingCategory]
[&offset&limit]`. `countsAsSpending` in `api/src/rows.ts` is the one definition of
  "the chart counts this row"; `spendingStats` now asks `listRows` for
  `spendingOnly` instead of repeating it. The days narrow in SQL, so a period's list
  reads that period's rows; the category and the scope still narrow after each row has
  been read, so a list is not yet cheap on a very long account (lg-15's F10 is
  narrowed, not closed). `useSeries` takes a `reload` that `SpendingCard` bumps after a
  write, so the chart is read again. "More categories" opens the whole period, since
  it is several at once. The table twin has no way in; the chart's readout is the way
  in.
  - Proof: `npm test -- --project ledger` (`816 passed (816)`, 47 files, exit 0); the
    new API tests are the `GET /api/rows, as the spending chart opens a period (lg-18)`
    describe in `api/test/stats.test.ts`, the web ones are `web/test/stats-rows.test.tsx`.
    Made to fail first: with `countsAsSpending` returning `true` the scope tests and
    the two existing spending-stats tests fail (6 of the file); with `reload` out of
    `useSeries`'s dependencies `a row given a category of its own is written, and the
chart counts it under the new one` fails.
  - The brief had nothing wrong that mattered, but it did not say the chart's slice
    and a plain `spendingCategory=none` list would disagree (deposits and unfiled rows
    are uncategorised too); `scope=spending` is what the owner chose to close that.
- 2026-10-12, after merge: gate 1's F5 and F8 fixed, on the owner's choice; F2
  and F6 stay recorded, judged not worth a change.
  - **F5.** The open list is kept by the period's `start`, not its `end`: the
    open period's end is the range's last day, today by default, so it moved at
    midnight. And a failed read of the chart after a write no longer unmounts
    the card: `useSeries` keeps this range's answer when a read of the same
    range fails after a `reload` bump the answer predates, and passes the
    failure on, which the spending card shows as an alert under its caption. Any
    other failed read — a new range, or back on an earlier one with no write
    between — still fails the card as before. The first build kept the answer
    after any failed read of a range it had held, which made the seven cards
    that never reload draw stale figures as current with no alert (gate 3's med,
    reproduced on `MortgagePaymentCard`); the answer is now tied to the `reload`
    value it was read at. Tests at the end of `web/test/stats-rows.test.tsx`;
    each fails with its source reverted.
  - **F8.** The readout's container is no longer `aria-live`. A visually hidden
    paragraph inside it carries the readout's heading, figures and notes as one
    sentence, and is the live region; the buttons are outside it. Each note in
    that sentence ends on a full stop, so two do not run together.
