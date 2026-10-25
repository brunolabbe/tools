---
id: lg-19
tool: ledger
title: Correct the spending category of a closed period's card line from the web
kind: fix
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-12 · `0484ae71..1f8bc481` · Opus 5.5, depth full

| Done when                                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A card line in a closed period can be given another spending category from the web, and the stats screen then shows it under the new one. A web test proves it. | `web/test/stats-rows.test.tsx` › "a closed period's card line is listed, and given another category it is filed again whole and the chart counts it there" ✓: it asserts `correctLine` gets the whole line with only `spendingCategoryId` changed, that the chart is read again (`fetchSpendingStats` twice) and that Household is then offered in the closed period. The chart reads mocked stats, so the "shows it under the new one" half on the server is carried by `api/test/periods.test.ts` › "a closed period's line given another spending category leaves the settlement and the next close alone" (Household 4 500, Groceries 1 500 in September). It fails with `onChanged()` removed from `PeriodLines`. Caveat: a line the workbook imported past the draft's bounds cannot be corrected (F1). |
| 2. The correction does not change the period's settlement. An API test proves it.                                                                                  | `api/test/periods.test.ts` › "a closed period's line given another spending category leaves the settlement and the next close alone" ✓: the closed periods read back equal, the open period lists only its own line with `late: false`, its `settlement` is unchanged, and `period_lines` gains one row while the first keeps its old category. It fails under both planted mutations (below).                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3. Gates green                                                                                                                                                     | **unproven (gate)**: `npm run check` exit 0 and `npm test -- --project ledger` 883 of 883 locally. On PR #449 at `1f8bc481`, `check`, `codeql`, `CodeQL`, `docker` and `dependency-review` pass, but `test (ubuntu-latest)` was still pending when this gate finished.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- **F1 · med** · **open decision** · Done when 1 depends on it only for the lines it
  covers, and whether the books hold any is unmeasured · A line the workbook
  imported cannot be corrected from the web when its text is past
  `periodLineDraftSchema`'s bounds (`category` max 100, `note` max 500). The
  import stores whatever the sheet holds (`writeAll` in
  `api/src/workbook-import.ts`; `label` joins every label column), and
  `PeriodLines` sends the stored text back as the draft. Reproduction: a gate
  probe imports `helpers/workbook.ts`' `history()` through `runImportCommand`
  with the first sheet's lines set to a 134-character label and a 600-character
  note. It then lists the period with `GET /api/period-lines` and posts each line
  back the way `PeriodLines.setSpending` does. Output:
  `correct 3 cat len 13 note len -> 200` ·
  `correct 2 cat len 8 note len 600 -> 400 "The line is not valid: check note."` ·
  `correct 1 cat len 134 note len 6 -> 400 "The line is not valid: check category."`.
  The picker changes only the category, so the person cannot get past this
  refusal from the web. The branch's Log records the defect as an observation
  and not as a decision. Options:
  (a) **Recommended: measure first.** Run
  `SELECT count(*) FROM period_lines WHERE length(category) > 100 OR length(note) > 500`
  on the household's books. If the count is 0, record the defect and file nothing.
  (b) Add a narrow correction, `spendingCategoryId` only, that copies the stored
  line on the server. That is additive in the contract, it fixes the bounds and
  F3 together, and the web stops sending text back.
  (c) Let a correction keep a field that is unchanged from the line it
  supersedes even when it is past the bound. That is a looser schema in a
  contract package.
- **F2 · med** · no `Done when` line depends on it (the gate checked the wire
  by hand, below) · `fetchSpendingLines` (`web/src/api/spending.ts`) and
  `correctLine` (`web/src/api/periods.ts`) add branches to files that have no
  test file of their own, and `stats-rows.test.tsx` mocks both. If a query
  parameter were misnamed, every test would still pass. Verified by a gate probe
  instead: it runs the web's own wrappers with `fetch` forwarded to
  `server.inject` and logs
  `GET /api/period-lines?to=2026-09-30&spendingCategory=1&offset=0&limit=25`,
  `POST /api/period-lines/1` and
  `GET /api/period-lines?to=2026-09-30&spendingCategory=none&offset=0&limit=25`.
  Each answered 200, and September's slice then read `[{"categoryId":3,"cents":4500}]`.
  lg-18's `fetchSpendingRows` has the same gap.
- **F3 · low** · `nfr:maintainability` · A correction is stored with
  `source: 'manual'`, because `insertLine` in `api/src/periods.ts` writes the
  literal. A corrected workbook line therefore loses its provenance at the head
  of its chain. Probe output: `{"id":3,"source":"workbook",...}` stays as it
  was, and `{"id":8,"source":"manual","supersedes":3}` is appended. A correction
  appends and does not overwrite. The search for consumers of a line's `source`
  covered all of `api/src`, `contract/src` and `web/src`, and nothing reads it
  beyond `toLine` and the contract type. So no export, rule, dedupe or lateness
  behaviour moves. No live consumer.
- **F4 · low** · the branch's `## Log`, "Not folded in" · it says lg-18's F5 and F8
  "stay recorded on lg-18". Both were fixed by #431 ("keep the open spending
  rows through a failed read and past midnight (lg-18)"), which merged before the
  base the Log names as built on (`git merge-base --is-ancestor` confirms it), and
  lg-18's own Log says so. Only lg-18's F2 and F6 stay recorded.
- **dropped** · a second category change on a line before the list has re-read
  posts to the superseded id. Probe: `200 404 PERIOD_LINE_NOT_FOUND "… It may
  have been corrected or removed since it was loaded."`. The code and its copy
  were written for this case, and the web shows the message as an alert, so it
  is not a defect.
- **dropped** · the slice and the list disagree. They were enumerated over
  every slice of a closed and an open period, with a refund line, a card-only
  slice (Household in September, 3 000) and a line dated after today in the open
  period. In each case the list sum equals `slice.cents`
  (`null 2026-09-30 … 1 slice 3500 list 3500`, `… 3 slice 3000 list 3000`,
  `2026-10-01 2026-10-03 true 3 slice 200 list 200`). Both read
  `current_period_lines`, and the chart's open span ends where the list's `to`
  does.
- **findings** · the hunt returned 6: 4 carried, 2 dropped.
- Positive controls, each planted on the detached tree and restored. (1) In
  `firstEntered`, the chain is no longer followed (`earliest = step` → `void 0`):
  `npx vitest run tools/ledger/api/test/periods.test.ts` fails 3 of 47, the
  settlement test among them. (2) `correctLine` re-dates the line into the open
  period (`{ ...draft, date: "2026-10-03" }`): 3 of 47 fail, the settlement test
  among them. (3) `onChanged()` is removed from `PeriodLines.setSpending`:
  `stats-rows.test.tsx` fails 1 of 17, the Done when 1 test.
- The real path, by a second method: the gate closed September, entered a late
  September line, corrected the categories of an on-time line and of the late
  one, then closed October. It compared that against a twin that never corrected.
  The closed settlements are equal field for field (closedAt aside),
  `[["2026-09-25",700,true],["2026-10-02",900,false]]` is the same in both (the
  late line stays late and is not doubled), and the next close is equal.
- Route: `periodLinesQuerySchema` takes digits only (`/^\d{1,15}$/`), and `limit`
  is 1–500, which is stricter than `rowsQuerySchema`'s `z.coerce`. It is limited
  by `read`, and `route-limits.test.ts` › "GET periodLines refuses the second
  request in a minute too" asserts 429. `CodeQL` passes on `1f8bc481`. Web: no
  reader of `cardCents` on `PeriodRows`, or of the removed notice, is left
  (grep of `tools/ledger`), and the list keeps the filter (`stats-rows.test.tsx`
  › "choosing a category in the list asks for the card lines of it too, from
  the first").
- Invariants checked: AppError codes, contract change sanctioned by the brief
  (additive, the choice assigned to lg-19), rate limit on the new verb, no
  `UPDATE` of a stored row, synthetic fixtures, style. Skipped as not touched:
  shell and process trees, redaction, SSRF, progress, Dockerfile closure, test
  registration (no new test file).
- NFR: security ✓ (strict query, rate limited, no new data exposed beyond the
  household's own lines; household scoping via `context.db` is lg-21's) ·
  performance ✓ (narrowed in SQL, paged, `period_lines_date` index) ·
  reliability — F1 · maintainability — F2, F3, F4.

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
- 2026-10-12, at landing: gate 1's F4 (the sentence above saying F5 and F8 "stay
  recorded on lg-18") fixed by the lander in f2ae0c89, without a re-gate.
