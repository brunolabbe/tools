---
id: lg-18
tool: ledger
title: Show a filed row's spending category where a person can change it
kind: work-package
status: ready
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
