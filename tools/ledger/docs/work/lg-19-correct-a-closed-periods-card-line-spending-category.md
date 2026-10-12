---
id: lg-19
tool: ledger
title: Correct the spending category of a closed period's card line from the web
kind: fix
status: ready
milestone: P5
depends_on: [lg-18]
difficulty: standard
---

# lg-19 — Correct the spending category of a closed period's card line from the web

## Why

[lg-18](./lg-18-show-a-filed-rows-spending-category-where-it-can-be-changed.md) lets a
person open the bank rows behind a period of the spending chart and give one a
category. The chart also counts the period's **card lines** (what the cards paid
toward the household), and those cannot be reached: a card line filed under the
wrong spending category, in a period already closed, is a slice of the wrong
colour that nothing on the web can fix. The owner chose on 2026-10-11, asked in
lg-18, to list bank rows only there and file this.

**Reproduction**, on `main` as of lg-18's base (55214e67):

```bash
grep -rn "ROUTES.periodLine\b\|correctLine" tools/ledger/web/src
```

prints nothing, though `POST /api/period-lines/:id` exists and is the correction
(`api/src/routes/periods.ts`). The web's only writers of a line are
`addLine` (`ROUTES.periodLines`) and `retireLine`, both in `web/src/api/periods.ts`.
And no route reads a closed period's lines: `GET /api/periods/open` takes its start
from the last close (`openPeriod`, `api/src/periods.ts`), so it lists only the open
period's lines and those entered late.

## Build

A person looking at a closed period of the spending chart can see its card lines
and correct a line's spending category.

- **Read.** A route listing the stored lines dated in a span, additive in
  `@ledger/contract`. Recurring-generated lines are not stored and are not charted
  as spending, so they are not listed.
- **Write.** Reuse `POST /api/period-lines/:id`, which takes the whole draft and
  appends a line that supersedes the old one. `firstEntered` follows that chain, so
  a correction is not counted as entered late and cannot move the line into the next
  close. A test should prove that, since it is the reason no override table is
  needed. The web needs a `correctLine` wrapper.
- **Where.** The list lg-18 opens below the spending chart, so a period shows its
  bank rows and its card lines together; replace lg-18's on-screen notice that card
  lines are corrected elsewhere.
- **A category whose slice is only card lines (lg-18's gate 1, F4).** lg-18 offers a
  category's "Rows" button whenever the slice is non-zero, so a slice made only of
  card lines opens "No bank row matches.", with a notice that gives the whole
  period's card total, not that category's. Reproduced on lg-18's branch by the gate
  harness: Household in 2026-02, 3000 of cards and no bank row. The cause is that
  `SpendingStatsResponse` does not carry a slice's card share. lg-19 settles it when
  the card lines are listed: either the list carries them, so the button always has
  something to open, or the response carries each slice's card share so the notice
  and the button can say the right thing. That is a contract choice, so it is
  lg-19's to decide, not a patch to lg-18.

## Done when

1. A card line in a closed period can be given another spending category from the
   web, and the stats screen then shows it under the new one. A web test proves it.
2. The correction does not change the period's settlement. An API test proves it.
3. Gates green.

## Log

- 2026-10-11 — Filed from lg-18's phase 1, at the owner's choice of "bank rows only"
  for that ticket. Reproduction above run on the lg-18 branch: no output.

- 2026-10-12 — Built on `07acbb86`. **Contract choice, made by the builder as the
  Build assigns it: the list carries the card lines, and `SpendingStatsResponse` is
  unchanged.** The alternative put each slice's card share in the response so the
  notice and the button could say the right thing. It was not taken for three
  reasons. (1) The list is needed anyway, and once it carries the lines a slice made
  only of card lines opens something real, so the share would only have served a
  notice that no longer exists: F4's message ("No bank row matches", beside the whole
  period's card total) is gone, and the card total is not shown on the list at all.
  (2) `SpendingStatsResponse` is read by every chart, and the stats screen's other
  consumers would carry a field they do not draw; the new route is additive and
  touches nothing that exists. (3) The list and the slice cannot drift, because both
  read `current_period_lines`: the test "every slice of a period is a list of its card
  lines, summing to it" asserts it for each slice of a period, uncategorised
  included. The cost is two lists under one filter, one of which says "No bank row
  matches." while the other has lines; each list now says what it is.
  - **Read.** `GET /api/period-lines?from&to&spendingCategory&offset&limit`
    (`ROUTES.periodLines`, the path the `POST` already has, as `recurring` has two
    verbs), answering `PeriodLinesResponse { lines, total }`, newest first. Narrowed
    in SQL, category included, since a line's category is its own column. Generated
    lines are not stored and not listed. The query schema takes digits only, so
    `0x3`, `1e0`, ` 1` and an empty `offset` are 400 here; `rowsQuerySchema` still
    lets them through (lg-18's F6, not touched, see below).
  - **Write.** No new route. `correctLine(id, draft)` in `web/src/api/periods.ts`
    posts to `ROUTES.periodLine`; `PeriodLines` files the line again whole with only
    `spendingCategoryId` changed.
  - **The reason no override table is needed, proved.** `api/test/periods.test.ts` ›
    "a closed period's line given another spending category leaves the settlement
    and the next close alone": the closed periods read back equal to the last field,
    the open period lists only its own October line with `late: false`, its
    `settlement` is equal to what it was before the correction, one `period_lines` row
    was added and the first still carries its old category. Mutation: with
    `firstEntered` no longer following the chain (`earliest = step` removed), that
    test fails together with the two existing lateness tests (3 of 47 in the file).
  - **Where.** `web/src/stats/PeriodLines.tsx`, rendered by `PeriodRows` under the
    bank rows, keyed on the filter so a new category starts at the first page.
    `PeriodRows` no longer takes `cardCents`.
  - **Not folded in, and why.** lg-18's F6 (`rowsQuerySchema` coercion) is one line to
    fix but changes what an existing route accepts and is outside this ticket's
    contract surface; F5 (the list vanishing when the chart's re-read fails) and F8
    (the live region) are in `Cards.tsx`/`Chart.tsx` and not made free by this work.
    Both were fixed by #431 (lg-18's Log), which is already in this branch's build
    base.
  - **What the brief had wrong.** Nothing material. Its reproduction grep now prints
    the two files that hold the wrapper and its caller. Two things the brief did not
    say: a corrected line is stored with `source: 'manual'` whatever the line it
    replaces was (`insertLine` writes the literal), so a corrected workbook line loses
    that label, and a workbook line whose note is longer than 500 characters or whose
    category is longer than 100 would be refused by `periodLineDraftSchema` on
    correction (400 naming the field). Neither was measured against a real
    workbook; the import has no such limit on what it stores.
