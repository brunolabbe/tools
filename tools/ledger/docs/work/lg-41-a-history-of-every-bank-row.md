---
id: lg-41
tool: ledger
title: A history screen lists every bank row, searched, filtered and sorted
kind: work-package
status: done
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

## Review

**Gate: PASS** — 2026-10-18 · `335efcd4..980eeb78` · Opus 5.5, depth full

| Done when                                                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `q`, `bucket` (each value and `unfiled`), `person` (an id and `joint`), `direction`, `minCents`/`maxCents` narrow, alone and combined; `total` counts before paging        | `api/test/spending-categories.test.ts` › "q, bucket, person, direction and the amount bounds each narrow, and total counts the narrowed set" (12 cases, each `total < 9`) and › "filters combine, and total is the count before the page" (`q=iga&limit=1&offset=1` → `["B"]`, total 2) ✓. Gate cross-check: 720 filter combinations on a 22-row fixture, page `offset=1&limit=3`, rows and `total` against an independent count, 0 wrong |
| 2. `epicerie` finds `ÉPICERIE METRO`, `IGA` finds `iga extra`                                                                                                                 | `api/test/spending-categories.test.ts` › "q ignores case and accents on both sides" (`q=epicerie` → `["A"]`, `q=IGA` → `["D","B"]`) ✓                                                                                                                                                                                                                                                                                                     |
| 3. Each `sort`/`order` in the specified order, ties on `seq`, pages neither repeat nor skip, on same-day and equal-amount rows                                                | `api/test/spending-categories.test.ts` › `"%s lists %s"` and › `"two pages of %s neither repeat nor skip a row"` (8 cases each) ✓. Positive control: the tie-break replaced by `return 0` turns 8 of them red (every `asc` case). Gate cross-check: 12 sort/order cases × 3 filters × page sizes 1–7, 252 walks on a fixture with 5-way date, 13-way amount and 5-way folded-description ties, 0 problems                                 |
| 4. Every query the web sends today answers as before; existing `spending-categories` and `stats` tests unchanged; `scope=spending` + `spendingCategory` + `sort` or `q` → 400 | `api/test/spending-categories.test.ts` › "sort, order or q on one chart slice is refused, and the chart's own lists are not" (400, `BAD_REQUEST`) ✓; the diff edits no existing test in either file. Gate cross-check: 183 requests in the shapes `fetchSpendingRows` and `fetchUncategorisedRows` build, plus `GET /api/stats/spending` and the three internal `listRows` calls, byte-identical JSON at base and head                    |
| 5. History tab: a typed search and a picked sort reach the request, the list is the stub's rows, Show more asks the next offset                                               | `web/test/history.test.tsx` › "a search and a sort reach the request, the list is what the server answered, and Show more asks for the next offset" ✓                                                                                                                                                                                                                                                                                     |
| 6. `npm run check` and `npm test -- --project ledger` pass                                                                                                                    | **verified** — check exit 0; ledger 1454 of 1454 tests in 71 files, exit 0, at 980eeb78; PR #563's `check` and `test (ubuntu-latest)` SUCCESS on 980eeb78                                                                                                                                                                                                                                                                                 |

- **low** · no `Done when` line depends on it · `nfr:reliability` — a `q` made only of combining marks matches every row. `q=%CC%81` (U+0301 alone) passes `rowsQuerySchema` (one character after trim), `fold` in `api/src/rows.ts` strips it to `""`, and `"".includes` is true: 22 of 22 rows, the same as no `q`. `%`, `_`, `\`, `[` and `.` each match only their literal row (1 of 22). Harmless in the safe direction: it returns the unnarrowed list a person would get with an empty box.
- **low** · no `Done when` line depends on it · open decision · the slice refusal covers `sort`, `order` and `q`, but `bucket`, `person`, `direction`, `minCents` and `maxCents` are accepted on `scope=spending&spendingCategory=<id>` and narrow on the row's whole amount, not the `sliceCents` the list shows: `minCents=2400` keeps row A, listed at 349 ¢, and `maxCents=500` drops it. The branch's own test asserts `direction=out&minCents=1` on a slice answers 200. No live call site: History never sends `scope`, and Stats sends none of these fields. Options: (a) **refuse every lg-41 field on that combination**, the same refinement widened to five more fields, which keeps the brief's "leave its meaning unchanged" (recommended); (b) keep it, and say in `rowsQuerySchema`'s doc comment that on a slice list the bounds compare the row's amount, not the slice.
- **low** · `nfr:maintainability` — no branch test protects Show more's late-answer guard (`controller.signal.aborted` in `showMore`, `web/src/history/History.tsx`). With that one line removed, all 6 tests in `web/test/history.test.tsx` stay green, and the old filter's page is appended to the new list. The first-page guard is covered: removing it turns "the search waits for a pause in typing, and a filter change drops the request in flight" red.
- **dropped** · `person=joint` cannot name a person whose id is `joint`. The brief's Build chose the `joint` sentinel, and the Log records the limit. Not a build defect.
- **dropped** · a failed `fetchPeople` message is cleared by the next filter change (`setProblem(null)` in the list's effect). Found by reading, not reproduced, and cosmetic: the list still works.
- **dropped** · NFD does not decompose `œ`, so `coeur` would not find `CŒUR`. Not measured. The brief prescribed NFD.
- **findings** · the hunt returned 6; 3 carried, 3 dropped.
- NFR: security ✓ (`q` never reaches SQL or a RegExp; every field is checked by the schema) · performance ✓ (5,022 rows: `q`+`sort` page in 16.8–34.2 ms against 11.3–14.8 ms unfiltered, 5 runs each) · reliability ✓, with the low above · maintainability: the low above.

## Log

- 2026-10-18 · filed from the owner's request, with the three decisions above
  answered before filing. Rated `standard`: the contract change is additive and
  decided here, and the rest follows `PeriodRows`' existing pattern.
- 2026-10-18 · built. `rowsQuerySchema` gained `q`, `bucket` (the buckets and
  `unfiled`), `person`, `direction`, `minCents`, `maxCents`, `sort` and `order`,
  all optional, plus `ROW_SORTS`, `ROW_ORDERS`, `ROW_BUCKET_FILTERS`,
  `JOINT_PERSON_FILTER` and a `RowsQuery` type for the web. `listRows` narrows
  and orders after the rows are read (`narrowRows`, `orderRows` in
  `api/src/rows.ts`), folding with NFD, combining marks stripped and
  `toLowerCase`, and compares with `<`, not `localeCompare`, so the order does not
  depend on the host's ICU data. The History tab sits after Period; its screen is
  `web/src/history/History.tsx`, its client `web/src/api/rows.ts`.
  - **Choices the brief left open**, all in the schema's doc comment: `order`
    absent with `sort` present is `desc`; `order` alone sorts by date; the tie on
    `seq` runs in the same direction as `order` (so `date asc` is the statement's
    order and `date desc` is today's default); the 400 for the slice list covers
    `order` as well as `sort` and `q`, since `order` alone would sort too. A
    crossed `minCents`/`maxCents` is a 400 as the brief asked.
  - **Defect the web test found in my first draft:** an answer arriving after its
    request was dropped replaced the newer list (`setLoad` ran without checking
    `controller.signal.aborted` on the success path). The test "the search waits
    for a pause in typing, and a filter change drops the request in flight" failed
    with the late row on screen; the check is in, and it passes.
  - **A limit, not fixed:** a person whose id is literally `joint` cannot be
    filtered to, because `joint` means `personId === null`. Nothing in the
    directory refuses such a name (`grep -rni '"joint"' api/src contract/src
books/src` finds only report strings and the new constant). Left as the brief
    decided; it earns a ticket only if a household has such a member.
  - **Nav:** ten buttons for a member without Household, twelve for an admin. At
    360 px they wrap to three rows, with no horizontal overflow
    (`document.documentElement.scrollWidth - clientWidth` was 0 at 360 px folded,
    360 px with the filters open, and 1000 px), from a Playwright run against
    `vite` with `/api/*` stubbed; `app.test.tsx` passed unchanged apart from the
    one test added. Not measured: a real device, or the API's data.
  - Fold-in: none. Nothing the build made free was already specified.
- 2026-10-18 · gate 1 (Opus 5.5) passed with three lows; the owner answered the
  question "lg-41 passed gate 1 (#563) … What do you want?". Options: "Refuse
  slice fields + F3 test, at landing", "Same, with a narrow re-gate", "Document
  the bounds only (F2b)", "Land as built; lows recorded". Chosen: **"Same, with
  a narrow re-gate"**. Fixed on that answer:
  - `rowsQuerySchema` now refuses `bucket`, `person`, `direction`, `minCents`
    and `maxCents` on `scope=spending` with a `spendingCategory`, as `q`, `sort`
    and `order` already were (the gate's option (a)): the bounds compared the
    row's whole amount, not the `sliceCents` the list shows. The brief's "leave
    its meaning unchanged" holds for every lg-41 field. The test that expected
    200 for a slice with `direction=out&minCents=1` now expects 400
    `BAD_REQUEST` for each of the eight fields alone on a slice, and 200 for the
    chart's own lists (`scope=spending` alone with narrowing fields, a category
    alone with narrowing fields, the slice alone).
  - A web test pins `showMore`'s `controller.signal.aborted` check: a Show more
    answer released after a filter change is not appended to the new list. With
    that line removed it fails on "Réponse tardive" in the list.
  - **Recorded, not fixed:** a `q` made only of combining marks (`q=%CC%81`)
    folds to `""` and matches every row, the same list as no `q`; harmless in the
    safe direction. The `person=joint` limit stays as the brief chose.
