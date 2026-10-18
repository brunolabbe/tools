---
id: lg-41
tool: ledger
title: A history screen lists every bank row, searched, filtered and sorted
kind: work-package
status: ready
milestone: P5
depends_on: []
difficulty: standard
---

# lg-41 — A history screen lists every bank row, searched, filtered and sorted

## Why

The owner asked on 2026-10-18 for a way to see the history of every transaction,
with sorting and filters. No screen lists the account. A bank row is reachable
only from:

- **Stats**, by opening one period of the spending chart
  ([lg-18](./lg-18-show-a-filed-rows-spending-category-where-it-can-be-changed.md)):
  `PeriodRows` shows that period's rows, newest first, filtered to rows the chart
  counts (`scope=spending`), with a spending-category filter and nothing else;
- **Inbox**, which holds only rows nobody has filed, and its auto-filed list,
  which holds only rows history filed and nobody has reviewed;
- **Categories**, which lists the first 50 uncategorised rows.

```bash
grep -rn "ROUTES.rows" tools/ledger/web/src
```

prints the two readers of `GET /api/rows`, both in `web/src/api/spending.ts`:
`fetchSpendingRows` (always `scope=spending`, one period) and
`fetchUncategorisedRows` (`spendingCategory=none&limit=50`). A row filed to the
mortgage, or to one person, or outside a charted period, is read by no list. The
route itself answers newest first only, and cannot search a description or narrow
by bucket, person or amount.

The local development books held 420 bank rows and 475 card lines on 2026-10-18,
from 2022-06-13 to 2026-09-26. That count is from development data, not the
household's books.

## Decision — answered 2026-10-18 by the owner

1. **What the list holds.** Options: (a) bank rows only, on the existing
   `GET /api/rows`; (b) bank rows and period (card) lines in one list with a kind
   filter, which needs a shape covering both, since a card line has no balance and
   is corrected by a whole new line rather than an override. **Chosen: (a).** Card
   lines stay where they are; a merged list is a later ticket if wanted.
2. **Which filters and sorts.** Offered: text search on the description; bucket and
   person; money in or out and an amount range; sort by date, amount or
   description. **Chosen: all four**, on top of the date range and spending
   category the route already takes.
3. **Where filtering and sorting happen.** Options: (a) on the server, by extending
   `rowsQuerySchema` in `@ledger/contract`; (b) in the browser, fetching every row
   in pages of at most 500 and filtering there, with no contract change. **Chosen:
   (a).** It is a contract change, made here with the owner's approval: new
   optional query fields only, and every existing caller's query keeps its meaning.

## Build

1. **Contract** (`contract/src/api.ts`, `rowsQuerySchema` and its doc comment).
   Add optional fields, each absent meaning "no narrowing":
   - `q`: a string, 1–100 characters after trimming. A row matches when its
     `description` contains it, ignoring case **and accents** (Desjardins writes
     `ÉPICERIE` and people type `epicerie`). Normalise both sides with NFD and strip
     combining marks; do not use SQL `LIKE`, which folds neither accents nor
     non-ASCII case in SQLite.
   - `bucket`: one of `BUCKETS`, or `unfiled` for a row with no classification
     (the inbox's rows). A row the inbox would file under a rule is still
     `unfiled` here: `classification` is what stands, and `listRows` already leaves
     it `null` for such a row.
   - `person`: a person id, or `joint` for `personId === null`. It narrows on the
     classification that stands, so an unfiled row matches only no `person` at all.
   - `direction`: `in` (amount > 0) or `out` (amount < 0).
   - `minCents` / `maxCents`: non-negative integers compared with the row's
     **absolute** amount, both inclusive, refined so `minCents <= maxCents`. The
     absolute value is what lets "over $100" mean the same thing for money in and
     out; `direction` says which way.
   - `sort`: `date` · `amount` · `description`, and `order`: `asc` · `desc`.
     Absent, the order is today's: newest first by `seq`. Sorting by `date` breaks
     ties on `seq` (two rows on one day keep the statement's order); `amount`
     sorts on the signed amount, so ascending puts the largest withdrawal first;
     `description` compares with the same folding as `q`, then by `seq`. Every
     sort breaks remaining ties on `seq` so paging is stable.

   Refuse `sort` and `q` together with `scope=spending` and a `spendingCategory`:
   that combination lists `sliceCents` entries (lg-28), and the history screen
   never sends it, so leave its meaning unchanged rather than defining it. Refuse
   with the route's existing `BAD_REQUEST` path (`parsed`), not a new code.

2. **`listRows`** (`api/src/rows.ts`). Apply the new narrowing after the rows are
   read, as the category already is, then sort, then page; `total` stays the count
   before paging. `from`/`to` stay in SQL. Keep `stats.ts`'s call
   (`spendingOnly`, `MAX_SAFE_INTEGER`) and the single-row read at `rows.ts`'s
   `rowId` caller unchanged in behaviour. The route in
   `api/src/routes/spending-categories.ts` passes the new fields through in the
   style the existing ones use.

3. **Web.** A new **History** tab in `App.tsx`'s nav, after Period, rendering a
   `history/History.tsx` screen, with a `fetchRows` in `web/src/api/` that takes the
   whole query (do not widen `fetchSpendingRows`, whose `scope=spending` is its
   point). The screen:
   - a search box (debounced, about 300 ms), date from/to, bucket, person (from
     `ROUTES.people`, labelled with `personLabel`), spending category (the
     `Picker`'s list, plus "none"), money in/out, and min/max in dollars;
   - a sort control: date, amount, description, each ascending or descending,
     default newest first;
   - each row: date, description, signed amount with `formatCents`, bucket and
     person with the labels in `labels.ts`, and spending category. Read-only: a
     row's category is changed where it already is, from Stats.
   - "Show more" pages of 50 with the same offset/limit pattern `PeriodRows`
     uses, a count of `total` matches, and a "Clear filters" control. A filter
     change starts again from offset 0 and aborts the request in flight.
   - Mobile-first: on a phone the filters fold behind one "Filters" toggle, and
     the list is one column per row rather than a wide table.

4. **Nav length.** The nav has nine buttons for everyone, plus Household for a
   member and Admin for an admin, so this makes twelve for an admin. Do not
   reorganise it in this ticket; if a test or the phone layout breaks, say so in
   the Log.

## Done when

1. `GET /api/rows` narrows by each of `q`, `bucket` (each value and `unfiled`),
   `person` (an id and `joint`), `direction`, and `minCents`/`maxCents`, alone
   and combined, and `total` counts the narrowed set before paging. An API test in
   `api/test/spending-categories.test.ts` proves each, on a fixture where every
   filter excludes at least one row the others keep.
2. `q` matches across case and accents: `epicerie` finds a row described
   `ÉPICERIE METRO`, and `IGA` finds `iga extra`. A test proves both.
3. Each `sort` and `order` returns the order specified above, ties broken on
   `seq`, and two consecutive pages of a sorted list neither repeat nor skip a row.
   A test proves it on a fixture with same-day rows and equal amounts.
4. Every query the web sends today returns exactly what it returned before: the
   existing `spending-categories` and `stats` tests pass unchanged, and a request
   combining `scope=spending`, `spendingCategory` and `sort` or `q` answers 400.
5. A web test (`web/test/history.test.tsx`) renders the History tab, types a
   search and picks a sort, and asserts the request carries both and the list
   shows the rows the stub answered, then that "Show more" asks for the next
   offset.
6. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-18 · filed from the owner's request, with the three decisions above
  answered before filing. Rated `standard`: the contract change is additive and
  decided here, and the rest follows `PeriodRows`' existing pattern.
