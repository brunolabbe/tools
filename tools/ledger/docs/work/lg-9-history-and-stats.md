---
id: lg-9
tool: ledger
title: History and stats — the charts the owner asked for
kind: work-package
status: done
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

## Review

**Gate: FAIL** — 2026-10-10 · `7709411e..043d5df8` (lg-9's own diff read as `e97df6f7...043d5df8`, since the branch merged `main` at `e97df6f7`) · Opus 5.5, depth full

| Done when                                                                                                                  | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Each series has a unit test on a synthetic history, including one with a payment change and one spanning a ratio change | `books/test/stats.test.ts`: one `describe` per series, all eight. The payment change is in `mortgagePayments` › "lists the payments, marking the one that changed with the one before it". The ratio change is in `salariesByYear` › "a year holding a ratio change lists both, and ends on the later". Four mutations each turned the suite red: the change flag, the boundary of a drop, the date of the ratio at the year's end, and taking the rate-limit hook off ✓ |
| 2. The stats screen renders each chart from fixture data. Web tests prove it                                               | **unproven** for one of eleven charts. `web/test/stats.test.tsx` › "draws every chart from its series…" draws ten of them. "Put into the buffer" has `points: []` in the fixture, so no web test ever draws it (see the med below). The other ten ✓                                                                                                                                                                                                                      |
| 3. Gates green                                                                                                             | PR #416 at `043d5df8`: all 9 checks SUCCESS. That includes `CodeQL`, which reads "No new alerts in code changed by this pull request", and the Windows leg. Locally, `npm run check` exits 0 and `npm test -- --project ledger` passes 793 of 793 in 45 files ✓. This line is not `awaiting`, because the check is already green on this head                                                                                                                            |
| Build 1, the receipt split (lg-8, lg-10)                                                                                   | **unproven (scope)**: removed from scope by the dispatch. It arrives with lg-10, and the comment on `spendingStats` says where the split goes                                                                                                                                                                                                                                                                                                                            |

- **high** · no `Done when` line depends on it · **A fixed item changes colour when the range drops an earlier item.** Shipped text says it cannot, in three places:
  - `tools/ledger/CLAUDE.md`: "a fixed item … keep[s] the colour their place in a list gives them whatever range is chosen, so the API sends the whole list".
  - The comment on `fixedItemsByMonth` in `books/src/stats.ts`: "a range that leaves one out must not move the others".
  - The Log: "a test holds each".

  `fixedItemsByMonth` orders the labels over every item. But it returns only the lines that generated something inside the range, and `FixedBody` in `web/src/stats/Cards.tsx` calls `assignSlots` over `data.series`.

  Reproduction: `node --import tsx <scratch>/history.mts <worktree>`. The fixture has Gym from 2025-01-05 to 2025-02-28 and Internet from 2025-02-05 with no end. It prints:
  - `fixed items all: ["Gym","Internet"]`
  - `fixed items from 2025-04-01: ["Internet"]`
  - `FAIL fixed items: Internet keeps its place when the range drops Gym: 0 !== 1`

  Chromium at 360px on the same data (`phone.mts`) shows `Internet=var(--series-2)` for "All of it", and its bars as `["var(--series-1)"]` from 2025-04-01.

  The test `fixedItemsByMonth` › "the lines come in the order their labels started, whatever the range" passes because none of its three ranges drops a line. Its title claims more than its assertions check.

  Fix, recommended: do what spending does. The response sends every label in the order they started, and `FixedBody` assigns slots over that list. A test then takes a range that drops an earlier item. The alternative is to strike the claim from all three places.

- **med** · Done when 2 depends on it · The "Put into the buffer" chart is never drawn from fixture data. `CONTRIBUTIONS` in `web/test/stats.test.tsx` gives `current-expenses` no points, so the card only ever shows its empty message. The fix is one point in the fixture and one assertion on that card's readout.
- **med** · no `Done when` line depends on it · Nothing guards Build 4, "Charts must work on a phone", at the layout level:
  - The Log records that every chart was drawing 736px wide on a 360px page. That was fixed in `styles.css` (`.chart-card`, `.chart-box`), and no test would fail if the fix regressed. jsdom has no layout.
  - "on a 360px phone a line chart is drawn 360px wide…" stubs `clientWidth` to 360 on every element. It does fail if a line chart sets a width other than the one measured: mutating `width={measured + 100}` made it red, 1 of 14. It cannot see CSS overflow. On a real 360px viewport the chart box is 294px, not 360px.
  - Measured in Chromium at 360×780 with `phone.mts`: no horizontal page scroll (`docScroll 360 / 360`). On all ten chart cards the SVG ends at x=327, inside the card's right edge at 344. Only "Fixed items by month" scrolls, starting at the newest.

  The candidate guard is the ledger's first e2e spec.

- **low** · Salary and ratio colours are assigned over the people present in the years of the range (`SalaryBody`), not over the API's people list. If a range held a year with only sam's salary, sam would take alex's colour. No such case occurs today, because a salary entry carries both people.
- **low** · `nfr:maintainability` · The doc comment on `spendingByPeriod` says that half a period "would be a different number from the one the settlement used". A line entered late is counted under its own date's closed period, while the settlement counted it at the next close. My history's 2025-03-20 line shows it: the closed period reads `cardCents` 7000, but the close saw 5000. The comment states a match the code does not keep. The behaviour itself is a fair choice.
- **low** · A `minDropCents` that fails validation (`0`, `abc`, `1.5`) answers `BAD_REQUEST` with the copy "from and to are days, written yyyy-mm-dd, from first." The copy describes a different field.
- **low** · The register comment in `api/src/routes/stats.ts` has all five of adr/005's fields:
  - query `js/missing-rate-limiting`;
  - file `api/src/routes/stats.ts`;
  - date 2026-10-10;
  - reasoning;
  - test `api/test/route-limits.test.ts`. Its "8 of 49" re-measured exact: with the hook off, 8 failed and 41 passed out of 49, the eight `stats…` rows.

  `printRoutes({ includeHooks: true })` shows `rateLimit()` on all 16 stats handlers, 8 GET and 8 HEAD.

  There are two problems:
  - **Rule 1 placement.** The `// codeql[…]` line covers exactly the next line, which is the `for`. The `app.get` call sits two lines below it.
  - **Reasoning.** It repeats the other ledger routes' claim that the query does not model the `read` hook. adr/005's "What the merge showed" records that the query did read `{ onRequest: rateLimit }`.

  The PR's `CodeQL` check raised nothing on this head. Whether that is because no alert was raised or because a suppressed one is not counted, I could not tell: the alert list for `pr:416` returned 404 to WebFetch. The owner's excusal stands; this bullet only grades the comment.

- **low** · The Log says "CodeQL: pending the owner … has **not been given**". The owner excused it on 2026-10-10, and the Log should record that decision, its options and who gave it.
- **low** · `nfr:performance` · Each range change sends 8 reads against a default budget of 120 per minute per person. That is 15 changes a minute before a 429, and superseded requests that were aborted still count against the budget.
- **open decision** · What a "large drop" is. The brief does not define it. The branch chose a single buffer row of 500.00 $ or more out (`DEFAULT_LARGE_DROP_CENTS`, inclusive), overridable with `?minDropCents=`. It is pinned by `bufferSeries` › "a drop exactly the size asked for is listed" (mutating `<=` to `<` turned it red) and by `api/test/stats.test.ts` › "the buffer lists the rows behind its large drops…". The Log says it was not put to the owner. Options:
  1. Keep the fixed 500.00 $ per row. Recommended: it can be changed later.
  2. Make the threshold relative, for example a share of the balance before the drop.
- **dropped** · The open period is cut at `to` and not held whole. Its span ends at `through` by construction and the Log states it, so it is consistent with itself.
- **dropped** · The edit to the contract: Build 2's "one route per series" requires the routes in `ROUTES`, and the edit only adds.
- **dropped** · "Today" is the UTC date in both api and web. That is the ledger's existing convention and not new here.
- **findings** · the hunt returned 12: 9 carried (1 high, 2 med, 6 low), 3 dropped, plus 1 open decision.
- Checked against the synthetic history the branch's tests do not use: the payment changes, the odd cent, every own-money point against `mortgageAsOf`, the contributions against `bufferAsOf`, a ratio change inside 2025, settlements against `/api/periods`, and 165 rows. The 150 joint rows beyond `listRows`' default of 100 are all counted. The only figure that failed is the fixed-items one above.
- NFR: security ✓ (8 routes limited, the range refused as `BAD_REQUEST` from core) · performance — above · reliability ✓ (one read transaction per series, nothing written) · maintainability — above.

### Gate 2

**Gate: CONCERNS** — 2026-10-10 · `043d5df8..b388d30d`, the round being `3d649edc` (`15adb4f7` is `main`'s #414, brought in by the merge `b388d30d`, and is not the round) · Opus 5.5, depth full

| Done when                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Each series has a unit test on a synthetic history, including a payment change and a ratio change | `books/test/stats.test.ts`, unchanged in meaning, plus "a range that drops an earlier item keeps its line, of zeros, so the later ones keep their place" ✓                                                                                                                                                                                                      |
| 2. The stats screen renders each chart from fixture data. Web tests prove it                         | `web/test/stats.test.tsx` › "draws every chart from its series…" now also reads the "Put into the buffer" readout (`2026-02-10`, `1000.00 $`, `300.00 $`). All eleven charts ✓                                                                                                                                                                                  |
| 3. Gates green                                                                                       | **unproven (gate)**. On `b388d30d`, `test (ubuntu-latest)` and `test (windows-latest, informational)` were still pending when read. The other seven checks are SUCCESS, including `CodeQL`, which reads "No new alerts in code changed by this pull request". Locally, `npm run check` exits 0 and `npm test -- --project ledger` passes 802 of 802 in 46 files |
| Build 1, the receipt split (lg-8, lg-10)                                                             | **unproven (scope)**: removed by the dispatch; it arrives with lg-10                                                                                                                                                                                                                                                                                            |

**Gate 1's findings**

- **high, a fixed item's colour across ranges · fixed.**
  - The gate-1 `history.mts`, re-run on this head: `fixed items from 2025-04-01: ["Gym","Internet"]` and `ok   fixed items: Internet keeps its place when the range drops Gym`.
  - Chromium at 360px: Internet's bars are `var(--series-2)` from 2025-04-01, as they are for "All of it".
  - Restoring `books/src/stats.ts` and `web/src/stats/Cards.tsx` from `043d5df8` fails both new tests, 2 of 44 across the two files.
- **med, "Put into the buffer" never drawn · fixed.** The fixture has a point and the test reads the card's readout. The empty state has its own test.
- **med, the phone layout unguarded · not fixed as a layout guard.** Recorded, and no `Done when` line depends on it.
  - `web/test/stats-layout.test.ts` holds the declarations as written. It reads the first rule whose selector is exactly `.chart-card` or `.chart-box`, so it cannot see a later or more specific rule that undoes them.
  - Reproduction: append `.card > .chart-box { min-width: auto; }` and `.card.chart-card { min-width: auto; grid-template-columns: none; }` to `web/src/styles.css`. `npx vitest run tools/ledger/web/test/stats-layout.test.ts` still passes 3 of 3. After `npm run build -w @ledger/web`, `phone.mts` at 360px measures `"docScroll": 419`, cards ending at 419 and SVGs 369 wide: the page scrolls sideways.
  - So the test fails when a declaration is deleted, which the Log says was checked and I did not re-run. It does not fail when a chart is drawn wider than its card.
  - The test's header and the Log both say this, accurately. A layout guard remains the ledger's first e2e spec.
- **low, salary colours by the range's people · fixed in code, not held by a test.**
  - Mutating `SalaryBody` back to colour over only the people with a salary in range leaves `web/test/stats.test.tsx` at 15 of 15. The fixture has both people in every year.
  - The API test does assert the `people` list.
  - The Log's "and the web fixture's colours" claims a guard that does not exist (new low below).
- **low, the `spendingByPeriod` comment · fixed.** It now says a late line sits under its own date's period while the settlement counted it at the next close.
- **low, `minDropCents` copy · fixed.** `api/test/stats.test.ts` › "a drop size of %s is BAD_REQUEST, and says it is the size" covers `0`, `abc` and `1.5`. The day message on the same route is kept by "a bad day on the buffer's route still says it is the day".
- **low, the register comment · fixed.**
  - `// codeql[js/missing-rate-limiting]` is now the line directly above `app.get`.
  - The reasoning no longer asserts that the query ignores the hook, and says the comment may be excusing nothing.
  - On this head `printRoutes` was not re-run, but the route body is unchanged apart from the buffer's error branch. `route-limits.test.ts` passes inside the 802.
- **low, the Log stale on CodeQL · fixed.** The round-1 entry records all five owner answers, each with its options and the chosen one: the CodeQL excusal, lg-15's F9 filed as lg-18, a large drop at 500.00 $ per row, texture and end-labels left unbuilt, and a one-off payment marked twice.
- **low, 8 reads per range change · not fixed, reason recorded** in the Log. It stays recorded.
- **open decision, a large drop · answered by the owner**: 500.00 $ per row, overridable. It is recorded in the Log.

**New in this round**

- **med** · no `Done when` line of lg-9 depends on it · **lg-18's reproduction misreads its own grep at the time of filing.**
  - The grep prints `Inbox.tsx:134`, which is `setFiledSpending` on an `AutoFiledRow`. `web/src/inbox/AutoFiled.tsx` renders `RowSpending` for every row filed automatically and not yet reviewed (`autoFiled` in `api/src/classifications.ts`, `WHERE c.source = 'auto'`).
  - So this sentence is false against the code: "the other writers of an override (`Inbox.tsx`) are on rows still in the inbox. Every row with a category, filed or not, is read by nothing on the web".
  - It was true "on `main` as of lg-15" (`git cat-file -e d55a1f42:tools/ledger/web/src/inbox/AutoFiled.tsx` reports it absent). lg-17 added the screen, and lg-17 is in lg-9's base `7709411e`.
  - The gap that remains is rows filed by a rule or by hand, and auto-filed rows once reviewed.
  - Fix: reword the reproduction's two sentences to name that population, and let lg-18's Build say what happens to the auto-filed screen's existing editor.
- **low** · The register comment says "Measured 2026-10-10 on lg-9's first round, base 15adb4f7". `15adb4f7` is not an ancestor of the round's commit: `git merge-base --is-ancestor 15adb4f7 3d649edc` fails, and it entered with the later merge. The round's base is `043d5df8`.
- **low** · The Log's salary-colour entry cites "the web fixture's colours" as a test. As above, no web test fails when the colours are scoped to the range again.
- **lg-18 as filed:**
  - The frontmatter parses: `npm run status -- --show lg-18` prints the fields and "blocked by lg-9 (ready)", and `npm run status -- --json` exits 0.
  - The id is free: not on `origin/main`, and `gh pr list --search lg-18` returns `[]`.
  - `depends_on: [lg-9, lg-15]` blocks it for the right reason: lg-18 opens from lg-9's spending chart, so it waits for lg-9's merge, and lg-15 is done.
  - `status: ready` and `difficulty: standard` are honest for a ticket whose Build leaves three choices to the owner.
  - The roadmap row is added. Its `web/src/api/spending.ts:79` citation resolves to `fetchUncategorisedRows` on this head.
- **Contract:** `people: string[]` is a required field on `SalariesStatsResponse`. That type is new in lg-9 and unmerged, and its only consumers are lg-9's own: `api/src/stats.ts`, `web/src/api/stats.ts`, `Cards.tsx`, and the fixtures in `api/test/stats.test.ts`, `web/test/stats.test.tsx` and `web/test/app.test.tsx`, all updated. `SalaryYear` is untouched, and no other ledger package or test names the type.
- **findings** · gate 1's 9 findings and 1 open decision graded: 6 fixed, 1 fixed in code but not held by a test, 1 med not fixed as a layout guard (recorded), 1 low not fixed with its reason recorded, and the decision answered. 3 new: 1 med, 2 low. None dropped. **None is a high.**
- NFR: security ✓ · performance — the recorded low · reliability ✓ · maintainability — the lows above.

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
