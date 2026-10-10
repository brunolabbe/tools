---
id: lg-9
tool: ledger
title: History and stats — the charts the owner asked for
kind: work-package
status: ready
milestone: P5
depends_on: [lg-5, lg-6, lg-15]
difficulty: standard
---

# lg-9 — History and stats — the charts the owner asked for

## Why

The owner wants the history of everything, and charts of it
([00-ANALYSIS.md §9](../00-ANALYSIS.md)). Everything is already stored as dated,
append-only records, so this ticket computes and draws. It stores nothing new.

## Build

1. `books`, pure — time series, each computed from rows:
   - the mortgage payment over time, marking each change (renewals);
   - salaries and ratio by year;
   - each person's cumulative contributions per bucket, and each person's own
     money in the mortgage bucket;
   - the buffer's balance, with the rows behind its large drops;
   - spending per period and per spending category, and the fixed items month
     by month. Categories come from
     [lg-15](./lg-15-spending-categories-on-bank-rows.md)'s one list, on bank
     rows and on period lines. A joint-account row with a receipt attached
     (lg-8) is split by its receipt items' categories once
     [lg-10](./lg-10-receipt-items-exclusions-and-categories.md) lands, and its
     own category is then not counted. A row or line with no category charts
     as uncategorised; a period line stored before lg-15, or imported by lg-7,
     shows its free text in the detail. Read a row's category from what lg-15
     built and do not recompute it: `listRows` in `api/src/rows.ts` answers it
     per stored row (computed on read, with the step that gave it: the row's
     own override, its rule's, or the map's), and a period line's is its
     `spendingCategoryId`, with the free text left in `category`;
   - settlements, with their formula version.
2. `api`: one route per series, each with a date range.
3. `web`: a stats screen. Before choosing chart colours or marks, load the
   `dataviz` skill.
4. **Charts must work on a phone.** That is where both people use the tool.

## Done when

1. Each series has a unit test on a synthetic history, including one with a
   payment change and one spanning a ratio change.
2. The stats screen renders each chart from fixture data. Web tests prove it.
3. Gates green.

## Log

- 2026-10-10 — Built, on `lg-9-history-and-stats-charts` from `7709411e`. Gate
  pending; the status stays `ready`.
  - **Shape.** `books/src/stats.ts` (pure): `mortgagePayments`, `salariesByYear`,
    `contributionSeries`, `mortgageOwnSeries`, `bufferSeries`, `spendingByPeriod`,
    `fixedItemsByMonth`, `settlementsInRange`. `api/src/stats.ts` gathers their
    input in one read transaction each and `api/src/routes/stats.ts` answers one
    `GET /api/stats/<series>` per chart, all with `?from=&to=`. The contract
    carries the eight routes, the range and buffer query schemas and the response
    types. `web/src/stats/` is the screen: `Stats.tsx` (the one range row),
    `Cards.tsx` (a card per series), `Chart.tsx` (a line chart, a column chart,
    the frame), `scale.ts` (the arithmetic of a chart), `useSeries.ts`. No
    charting library and no new dependency. Nothing is stored; a test reads
    every stats route and counts the books' rows before and after.
  - **What the series mean, where the brief left it open** (the builder's own
    choices, none put to the owner). A _payment_ is a joint row in the mortgage
    bucket that takes money out; any amount that differs from the payment before
    it, found over the whole history and not only the range, is marked changed,
    so a one-off larger payment is marked twice (it, and the return to the usual).
    _Large_ is `DEFAULT_LARGE_DROP_CENTS` = 500.00 $, a single row out of the
    buffer, and the caller may ask for another size with `?minDropCents=`.
    _Spending_ is the stored period lines plus the joint rows filed to the buffer
    (a refund nets against its category), at the category `listRows` answers; a
    row nobody has filed is not counted, a person's deposit is not spending, and
    the recurring items' generated lines are charted on their own and not in the
    period totals. The open period ends on `to`, or today. A cumulative total and
    the mortgage's own-money split start at the first row ever; a range only
    chooses which points come back.
  - **The receipt split is not built.** No receipt is stored (lg-8, lg-10 have not
    landed), so every joint row is counted whole under its own category. The
    comment on `spendingStats` says where the split goes. Not folded in: there is
    nothing to read yet.
  - **Colour, with the `dataviz` skill.** The ledger web package had tokens for
    chrome and ink and none for series, so `--series-1..8` and `--series-none` were
    added in `web/src/styles.css`, in the skill's fixed order. The skill's reference
    palette was validated against this page's own surfaces, not its defaults:
    `node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948" --mode light --surface "#ffffff"`
    → lightness band, chroma floor, CVD (worst adjacent #eda100↔#1baf7a ΔE 9.1) and
    normal-vision floor (worst #e87ba4↔#eda100 ΔE 19.6) PASS, contrast WARN on aqua,
    yellow and magenta (2.82, 2.17, 2.69 : 1), "ALL CHECKS PASS". Dark, with the
    skill's dark column against `#1a1e23`: all five PASS (worst CVD ΔE 8.4, worst
    normal 19.3). The WARN obliges a table view or visible labels; every chart has
    the table. The hex values are the only thing taken from the skill; nothing
    under its directory was copied into the repository.
  - **Skill items not built.** Texture (the opt-in fill for full CVD, print and
    forced colours) is not drawn: identity there is the legend, the readout that
    always prints the selected date's figures, and the table. Line charts carry no
    direct end-labels (converging lines would need leader lines); the legend and
    readout do that job. Neither is hidden behind a decision: say so if either is
    wanted.
  - **Phone.** Drawn at the container's measured width, so 12px is 12px; a column
    chart wider than the screen (28px a column at least) scrolls sideways from the
    newest, its value labels held at the left edge; the figures for the selected
    date are printed under the chart, the latest by default, and a tap, a pointer
    or the arrow keys move them. Looked at in Chromium at 360×800, light and dark,
    on invented series through a throwaway server in the scratch directory (not
    committed; the e2e README says no spec yet): ten charts, none made the page
    scroll sideways. **Looking found three things no test had:** every chart drew
    736px wide on a 360px page, because a grid item will not shrink below its
    content and the SVG was being measured at the width it set (fixed in
    `styles.css`, `.chart-card` and `.chart-box`; the web tests cannot see it, as
    jsdom has no layout); an axis label such as `50,000 $` was clipped by a fixed
    52px margin (now the widest label); and a scrolled column chart lost its value
    axis (now a sticky second SVG).
  - **Tests.** `books/test/stats.test.ts` 28 of 28: each series on a synthetic
    history, with a payment that changes at a renewal and a year holding two ratio
    changes, and the own-money series checked against `mortgageAsOf` on every
    day it moved. `api/test/stats.test.ts` 16 of 16, through the routes.
    `web/test/stats.test.tsx` 14 of 14 and `stats-scale.test.ts` 17 of 17: every
    chart from fixture data, the table twin, the arrow keys, the range, the stale
    dimming, one chart failing alone, and a 360px width. `app.test.tsx` 7 of 7.
    `npm test -- --project ledger`: 45 files, 793 tests passed. Eleven mutations,
    each run against its spec, every one fails it: the change flag inverted, the
    odd cent split per day, the uncategorised detail dropped, a joint-only day made
    a contribution point, the first payment dropped, a person's deposit counted as
    spending, `from` after `to` accepted, the stale mark removed, the change marker
    removed, the this-year range off by a day, the eighth colour slot not shared.
    **One survived at first** — `from` after `to` accepted — because `api`
    resolves `@ledger/contract` through `dist` and the mutation was in `src`;
    rebuilt with `npx tsc --build tools/ledger/contract` it fails "refuses from
    after to as BAD_REQUEST".
  - **CodeQL: pending the owner.** The eight routes are registered at one call in
    `api/src/routes/stats.ts` (a loop over the series), each taking
    `{ onRequest: read }`, with the register comment `docs/adr/005` asks for above
    it and `// codeql[js/missing-rate-limiting]`. Taking the hook off that call
    fails 8 of the 49 tests in `api/test/route-limits.test.ts` — the eight "stats…
    refuses the second request in a minute, as RATE_LIMITED" rows (measured
    2026-10-10, base `7709411e`). Whether the owner excuses the alert is the
    owner's to give, and has **not been given**; if it is refused the comment goes
    and the routes are what they were.
  - **What the brief had wrong.** (1) "Read a row's category from what lg-15
    built": `listRows` returns 100 rows unless told otherwise, so reading every row
    needs an explicit limit (`Number.MAX_SAFE_INTEGER` here; the route's own cap is
    500). (2) The brief wrote "salaries and ratio by year" as if a year had one
    ratio; a year can hold several, so a year carries the ratio in effect on its
    last day and the list of those that took effect inside it. (3) Colour is by
    place in a list, which the brief did not say: the first version sent only the
    categories with an amount, so a range that left Groceries out moved Pharmacy up
    a colour. The API now sends the whole list and the fixed items come in the
    order their labels first started, whatever the range; a test holds each.
  - **Not folded in.** The gate's F9 on lg-15 (a filed row that has a category
    appears on no web screen, so a wrongly mapped one cannot get an override) names
    this screen as its natural home. It is not small and not specified: it is a
    list of rows under a period with its own filters and paging, so it is left as
    an open decision in the report. The two items lg-17 recorded and did not fix
    (the older register comments' dated counts, `amountFits`' dead `Math.sign`
    clause) are not made free by this work.
