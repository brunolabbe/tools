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
