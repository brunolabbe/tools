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
  - **CodeQL.** The eight routes are registered at one call in
    `api/src/routes/stats.ts` (a loop over the series), each taking
    `{ onRequest: read }`, with the register comment `docs/adr/005` asks for above
    it and `// codeql[js/missing-rate-limiting]`. Taking the hook off that call
    fails 8 of the 49 tests in `api/test/route-limits.test.ts` — the eight "stats…
    refuses the second request in a minute, as RATE_LIMITED" rows (measured
    2026-10-10, base `7709411e`). Whether to excuse the alert was put to the owner;
    the answer is in the round-1 entry below.
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
    list of rows under a period with its own filters and paging, so it was put to
    the owner; the answer is in the round-1 entry below. The two items lg-17
    recorded and did not fix (the older register comments' dated counts,
    `amountFits`' dead `Math.sign` clause) are not made free by this work.
- 2026-10-10 — Round 1, after gate 1 (Opus 5.5) failed `043d5df8`: one high, two
  med, several low, one open decision. Fixed on the same branch.
  - **Owner answers, 2026-10-10**, each asked with its options:
    1. _"Do you excuse the CodeQL alert on the stats routes?"_ — "Excuse it, as for
       the other ledger routes" (chosen, the builder's recommendation) over "Refuse
       it". The gate read PR #416's `CodeQL` check as SUCCESS, "No new alerts in code
       changed by this pull request", on `043d5df8`, and could not tell whether no
       alert was raised or a suppressed one is not counted; so the comment may be
       excusing nothing, and says so. The register comment stays.
    2. _"What to do with lg-15's F9 (a filed row's category is on no web screen)?"_ —
       "File it as its own ledger ticket" (chosen, the builder's recommendation) over
       "Add the drill-down to lg-9 now" and "Leave it". Filed in this branch as
       [lg-18](./lg-18-show-a-filed-rows-spending-category-where-it-can-be-changed.md),
       with F9 as its reproduction.
    3. _"What should a large drop be?"_ — "500.00 $ per row, overridable" (chosen;
       the builder's and the gate's recommendation) over "Relative to the balance".
       No code change.
    4. _"Texture fills and direct end-labels?"_ — "Leave them unbuilt, noted in the
       Log" (chosen, the builder's recommendation) over "File a ledger ticket" and
       "Build them in this round". Both stay unbuilt, as the entry above says.
    5. _"A one-off larger payment is marked changed twice: keep that?"_ — "Keep it"
       (chosen) over "Mark only lasting changes". No code change.
  - **High: a fixed item changed colour when the range dropped an earlier one.**
    Reproduced with the gate's `history.mts`: `FAIL fixed items: Internet keeps its
place when the range drops Gym: 0 !== 1`; after the fix, the same line reads
    `ok   fixed items: Internet keeps its place when the range drops Gym`.
    `fixedItemsByMonth` now returns a line for every label (zeros where the range
    holds none of it), in the order the labels first started, and `FixedBody` assigns
    slots over that whole list and draws only the lines with an amount. The claim in
    three places (the ledger `CLAUDE.md`, the comment on `fixedItemsByMonth`, the Log)
    now holds. Tests: `books/test/stats.test.ts` › "a range that drops an earlier item
    keeps its line, of zeros, so the later ones keep their place" and
    `web/test/stats.test.tsx` › "an item the range drops keeps its place, so the ones
    after it keep their colour". Mutated back to the old behaviour, the first fails 4
    of 29 and the second 2 of 15 (slots over only what is drawn). The earlier test's
    title claimed more than it checked, and the claim was mine.
  - **Med: "Put into the buffer" was never drawn from fixture data.** The fixture now
    has a point and `stats.test.tsx` › "draws every chart…" reads that card's
    readout (`2026-02-10`, `1000.00 $`, `300.00 $`); the empty message has its own
    test with the buffer emptied.
  - **Med: nothing guards the phone layout.** Chosen: a test that holds the two
    declarations, and a measured statement of what it cannot hold — not the e2e spec.
    `web/test/stats-layout.test.ts` (3 of 3) reads `styles.css` and asserts
    `grid-template-columns: minmax(0, 1fr)` and `min-width: 0` on `.chart-card` and
    `min-width: 0` on `.chart-box`; with either removed it fails (checked: each
    removal fails 1 of 3). jsdom cannot hold more: its `getComputedStyle` answers an
    empty string for these properties (tried first, abandoned), and the test runner
    turns a `?raw` import of the stylesheet into an empty string, so the file is
    read with `node:fs`. It guards the declarations and not the layout, which was
    measured once, in Chromium at 360px (every chart 294px, none 736px, no sideways
    scroll, re-run this round on the rebuilt bundle). A standing layout guard is the
    ledger's first e2e spec, which `e2e/README.md` says wants its own job in
    `ledger.yml`: that is a CI change, not a fix to this branch, and no Done when
    line depends on it.
  - **Low: salary and ratio colours** were assigned over the people in the range's
    years. The salaries response now carries `people` (everyone the books know) and
    the cards colour over it and draw only the people the range has. Test:
    `api/test/stats.test.ts` › "names everyone the books know, whatever years the
    range holds". No web test holds the colours: scoping them back to the range's
    people leaves `web/test/stats.test.tsx` green, whose fixture has both people in
    every year.
  - **Low: the `spendingByPeriod` comment** claimed a period's figure is the one its
    settlement used. It now says it is where the dates fall, and that a line entered
    after its period closed is here under its own date's period while the settlement
    counted it at the next close.
  - **Low: `minDropCents` error copy.** A size that fails validation now answers
    "minDropCents is a whole number of cents, 1 or more." and a bad day on the same
    route still says it is the day. Tests: `api/test/stats.test.ts` › the three sizes
    `0`, `abc`, `1.5`, and "a bad day on the buffer's route still says it is the day".
  - **Low: the register comment** — the `codeql[…]` line covers exactly the next
    line, which was the `for`; the comment now sits inside the loop directly above
    `app.get`. Its reasoning no longer states as fact that the query ignores the
    `read` hook: adr/005's "What the merge showed" records that it did read
    `{ onRequest: rateLimit }`, and the gate's reading of the PR check is that
    nothing was raised on this head. The "8 of 49" was re-measured on this round's
    tree: with the hook off, 8 failed (`statsBuffer`, `statsContributions`,
    `statsFixedItems`, `statsMortgageOwn`, `statsMortgagePayments`, `statsSalaries`,
    `statsSettlements`, `statsSpending`) and 41 passed.
  - **Low: each range change sends 8 reads against 120 a minute per person.** Not
    changed: the gate states no fix. Fifteen changes in a minute is more than a
    person makes, and the aborted ones still count; a shared fetch of all eight in
    one route would change the contract's "one route per series".
  - **Filed:** lg-18, above. Its id was reserved with `node scripts/next-id.mjs lg`
    and re-checked before the commit: `next free: lg-18`.
- 2026-10-10 — Landing, after gate 2 (Opus 5.5) found `b388d30d` CONCERNS with no
  high. Three of its findings were fixed at landing, by the owner's choice of "The
  text fixes only" over "Text fixes plus a salary-colour test" and over "Land as
  gated, all recorded": (1) lg-18's reproduction now says that auto-filed rows not
  yet reviewed already show and edit their category in `AutoFiled.tsx` (since
  lg-17), and that the gap is rows filed by a rule or by hand and auto-filed rows
  once reviewed; (2) the register comment in `api/src/routes/stats.ts` says "base
  043d5df8", the round's base, not `15adb4f7`; (3) the salary-colour entry above no
  longer cites "the web fixture's colours" as a test. Recorded unfixed, as gate 2
  lists them: the phone-layout med (the declaration test cannot see an override),
  salary colours held by no test, and the 8-reads-per-range low.
