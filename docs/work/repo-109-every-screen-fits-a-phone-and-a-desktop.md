---
id: repo-109
tool: repo
title: Every screen of every tool fits a 360px phone and a desktop, and a check says so
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-109 — Every screen fits a 360px phone and a desktop

## Why

The owner's requirement, 2026-10-18: every tool displays properly on a computer
and on a phone. Nothing checks this today. Measured on `main@140bd78a`:

|                     | downloader     | planner                      | ledger                |
| ------------------- | -------------- | ---------------------------- | --------------------- |
| viewport meta       | yes            | yes                          | yes                   |
| width media queries | 0              | 2 (`max-width` 46rem, 34rem) | 1 (`min-width` 48rem) |
| e2e specs           | 3              | 3                            | none                  |
| Playwright projects | Desktop Chrome | Desktop Chrome               | —                     |

No spec in any tool runs at a phone viewport, so nobody knows which screens
break on a phone. The downloader has no breakpoints at all. That may be fine
for a fluid layout, or it may not; nothing has looked. The deliverable is
therefore the **check** first. The fixes are whatever it finds.

## Decision — answered 2026-10-18 by the owner

**Shape.** Options were: a repo ticket that writes the rule and adds a check,
with fixes following per tool · folding it into repo-108 (that one is a
no-visual-change refactor, so it would stop being one) · a written rule with no
check. **Chosen: this ticket, with a check.**

**Phone width.** Options were 360px · 375px · 320px. **Chosen: 360px.** A
screen that works there also works on a standard iPhone (375–393px).

## Decision — answered 2026-10-20 by the owner, at intake

**What "every screen" means.** None of the tools has a router; screens are view
states. Options were: (1) the builder's enumerated list — the builder lists each
tool's top-level views in the Log with how each is reached, the gate grades
coverage against that list and may challenge the list itself as a finding, but
cannot fail the line for a sub-state (error banner, empty variant) the list does
not name · (2) every view state, including error, empty and loading variants ·
(3) not in this batch. **Chosen: (1).**

## Build

1. **The rule.** Write `.claude/rules/responsive-layout.md`, path-scoped to
   `tools/*/web/src/**`. It says:
   - every screen works from **360px** wide up to a desktop, with no horizontal
     scroll of the page;
   - content wider than the screen (a statement table, a long URL) scrolls
     inside its own container (`overflow-x: auto`) rather than pushing the
     page sideways;
   - a new screen gets a line in its tool's `layout.spec.ts` (below) in the
     same pull request.

   One line in the root `CLAUDE.md` Rules section points at it.

2. **The check, one spec per tool.** Add `tools/<tool>/e2e/layout.spec.ts`. It
   visits every screen the tool has, at **360×740** and at **1280×800**, and on
   each it asserts that `document.documentElement.scrollWidth` is no more than
   `window.innerWidth`. It also attaches a full-page screenshot at each width
   for the gate to look at. `page.clock.install()` alone still runs in real
   time, so call `pauseAt` before stepping. Open every shot before calling it
   proof.
   - Reach screens **with data in them**: an empty state does not prove a
     populated one fits. Reuse the existing walks (planner's `intake-walk.ts` and
     `plan-walk.ts`, the downloader's specs' fixtures) rather than writing new
     ones.
   - Do **not** add a phone project that reruns every spec. That doubles e2e
     time to prove the same seams twice; the layout spec is the only thing that
     needs both widths.
3. **Ledger has no e2e yet.** `tools/ledger/e2e/README.md` says the first spec
   should come with an `e2e` job in `ledger.yml` "beside the planner's shape".
   This ticket adds both. The README's "the shell has one page" is out of date
   (`web/src` now has home, inbox, statements, spending, stats, receipts,
   periods, rules, salaries, household and admin), so rewrite that paragraph.
   Seed a household through the API in the spec's setup so each screen has
   rows.
4. **What the check finds.** For each screen that overflows at 360px:
   - mark that case `test.fixme` with a comment naming a new **per-tool** fix
     ticket (`dl-`, `pl-`, `lg-`), and file that ticket with the failing case
     as its reproduction and the screenshot described in its Why;
   - do **not** fix screens here. A visible fix in three tools is three
     changelog lines, and the root `CLAUDE.md` puts those in separate pull
     requests;
   - **exception:** a fix that is one rule (for example `overflow-x: auto` on a
     table's wrapper) can land here, labelled as such in the Log. Fold it in
     only if it changes nothing at desktop width.

   Push each filed ticket before returning, as `docs/01-TICKETS.md` asks, so the
   next id is held.

5. **Commit type.** Specs and a rule are `test`/`docs`, both hidden in
   `release-please-config.json`. One pull request across the three tools writes
   no changelog line. A folded-in fix from step 4 changes that, so if any lands,
   the title's type is decided by it.

## Done when

1. `.claude/rules/responsive-layout.md` exists with the three points in step 1,
   and the root `CLAUDE.md` points to it.
2. Each tool has `e2e/layout.spec.ts` covering every screen on the builder's
   enumerated list (the Log names each tool's top-level views and how each is
   reached; owner, 2026-10-20), at both widths, with data on the page. A
   sub-state the list does not name is not a failure of this line.
3. The check can fail: the Log shows it red at 360px with a planted
   `width: 400px` on one container, in one tool.
4. Ledger's `e2e` job runs in `ledger.yml`, and its README describes the specs
   it now has.
5. Every overflowing screen is either fixed here under step 4's exception or
   carries a `test.fixme` naming a filed per-tool ticket. The Log lists both.
6. `npm run check` passes, and each tool's e2e suite passes in CI.

## Review

**Gate: FAIL** — 2026-10-21 · `2d1b22bb..b78867d2` · Opus 5.5, depth standard

| Done when                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `responsive-layout.md` has the three points, and the root `CLAUDE.md` points to it            | **verified** by reading: the 360 px / no page scroll point, the `overflow-x: auto` point and the new-screen point are all there, `paths: tools/*/web/src/**`, and the pointer is in the Rules section. `.tablewrap` and `ui-package.md`'s "Breakpoints are not tokens" exist as cited                                                                                                            |
| 2. A `layout.spec.ts` per tool covers every listed screen, at both widths, with data on the page | **unproven**: every listed screen has a case at 360×740 and 1280×800. CI's `e2e` legs are green on `b78867d2` (ledger, planner, `e2e (direct)`), and locally 12/12 ledger, 5/5 planner and 5/5 downloader passed. But the "with data on the page" clause has no assertion for ledger's Stats and Categories cases (F1). The CI screenshots show data today, and nothing fails when it is missing |
| 3. The check can fail with a planted `width: 400px`                                              | **verified**: the Log shows the planner run red. Reproduced on ledger: `.card { width: 400px; }` gave `12 failed`, each "… is 416 px wide in a 360 px window". `.panel { width: 400px; }` is inert in ledger because no element there has that class (`12 passed`)                                                                                                                               |
| 4. Ledger's `e2e` job runs in `ledger.yml`, and its README describes the spec                    | `ledger.yml` › `e2e` ✓ on `b78867d2` (job 118972171633). README ✓, apart from one false count (F5)                                                                                                                                                                                                                                                                                               |
| 5. Every overflowing screen is fixed or carries `test.fixme` and a ticket                        | **proven**: no screen overflows. All 22 cases are green, locally and in CI on `b78867d2`, so both lists are empty                                                                                                                                                                                                                                                                                |
| 6. `npm run check` passes, and each tool's e2e passes in CI                                      | `npm run check` exited 0 locally. CI's `check`, ledger `e2e`, planner `e2e`, downloader `e2e (direct)` and `e2e (sniffer)` are all ✓ on `b78867d2`                                                                                                                                                                                                                                               |

- **F1 · high** · Done when 2 depends on it · `tools/ledger/e2e/layout.spec.ts` › `TABS`. Its comment says each regex "is a row or a figure from the seed, so a screen is not measured while it is still asking for its books". That is false for three entries, which match headings:
  - Stats `/Settlements/` matches the `Loaded` card's `<h2>`, which also renders while loading and on failure. With every `**/api/stats/**` request aborted, the assertion passes and the screen measured is a column of "The ledger API is not answering." It also passes over empty books.
  - Categories `/Rows with no spending category/` matches a static `<h2>`, and passes over empty books.
  - Admin `/Addresses to admit/` matches an `<h3>`. It does prove the screen loaded, and the serve script always puts alex and sam in the directory.

  The falsehood runs in the unsafe direction: a reader trusts the screen was measured with its books in it. Direction for the fix (not run): assert a seeded figure or row on each, as Home's `1550.50` does.

- **F2 · med** · no `Done when` line depends on it · the check cannot see a page that clips instead of scrolling. Ledger with `.card { width: 400px; } html, body { overflow-x: hidden; }` gave `12 passed`, with content cut off at the right edge. With `body` alone hidden it stayed red (416 px). The rule page presents the spec as "the check that keeps it true". This is an open decision, in the full report.
- **F3 · low** · `nfr:reliability` · `tools/ledger/playwright.config.ts`: the `TEST_WORKER_INDEX` guard protects workers (measured `TEST_WORKER_INDEX=0` in the worker). Any other process that loads the config still deletes a running server's storage: a `playwright test --list` mid-run left `storage exists=false`. No live call site in CI.
- **F4 · low** · `e2e:ledger:serve` takes `DATABASE_PATH` from the Playwright config. Run by hand, it would add household `home` and two `example.test` members to the developer's default directory. Read from `household:ledger`'s description and not run, so **unverified**. No live call site: only the Playwright config runs it.
- **F5 · low** · `tools/ledger/e2e/README.md` says the seed adds "two rules". `seed` posts three, and the Log says three. The error is in the safe direction.
- **F6 · low** · the ledger's enumerated list leaves out two top-level views that `App.tsx` renders outside the tabs: `NoHousehold` (lg-20) and the admin-only shell (lg-22). Neither can be reached under this harness, because the API refuses a `DEV_IDENTITY` the directory does not hold.
- **dropped** · lead 1, the blank region in `Receipt-360.png`: not reproduced. At 360 px every named control is visible and opaque, has its own box, and `elementFromPoint` hits it (self). The full-page shots from the spec's run, from a run with Pixel 7 emulation left on, and from CI's `ledger-layout-shots` artifact on `b78867d2` all show every control.
- **dropped** · planner `RATE_LIMIT_RUNS_PER_MINUTE=0` loses no coverage: no planner e2e spec at `2d1b22bb` asserts a limit. `DEV_IDENTITY` and `LEDGER_ADMINS` appear only in `tools/ledger/playwright.config.ts`. The three `if: always()` uploads carry only `.artifacts/layout` screenshots of synthetic data (seeded books, `example.test` addresses, a local fixture origin).
- **findings** · the hunt returned 8: 6 carried, 2 dropped.
- NFR: security ✓ (nothing sensitive uploaded, `DEV_IDENTITY` confined) · performance n/a · reliability: F3 · maintainability: F1, F5.

### Gate 2

**Gate: CONCERNS** — 2026-10-21 · `b78867d2..45af85bd` (round 1: `c5baea2e`, `45af85bd`) · Opus 5.5, depth standard

| Done when                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2. A `layout.spec.ts` per tool covers every listed screen, at both widths, with data on the page | **proven** for the clause F1 left open. `tools/ledger/e2e/layout.spec.ts` › `"<tab> fits a phone and a desktop"` now asserts each `TABS` pattern in turn, and every pattern is seeded data or directory data, not a heading. I aborted each API route the Stats, Categories and Admin tabs request, one per run. Each data route turned the case red. Stats: 8 of 8 series, each losing its own card's figure. Categories: 3 of 3 (`/api/rows`, `/api/spending-categories`, `/api/spending-category-map`). Admin: 1 of 1 (`/api/admin/households`). Empty books turn Stats and Categories red. CI ledger `e2e` passed on `45af85bd` (run 39526876908). Planner and downloader are unchanged this round, and their `e2e` legs passed on `45af85bd` |
| 1, 3, 4, 5, 6                                                                                    | Not touched by this round's code. For 4, the README count is now right (F5). For 6, all 15 checks pass on `45af85bd`, `check` included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Gate 1's findings:

- **F1 · high: fixed.** This is gate 1's reproduction, re-run on `45af85bd`. With every `**/api/stats/**` request aborted, all 9 Stats patterns are missing and the case fails. Over empty books, Stats fails (9 of 9 missing) and Categories fails (2 of 2 missing). The figures are not tied to the time zone or the locale. The whole ledger spec gave `12 passed` under `TZ=Pacific/Kiritimati` and again under `TZ=America/Adak`, and the browser reported each zone. Money and ratio text is built by integer arithmetic (`formatCents`, `formatShare`), with no `Intl`.
- **F2 · med: fixed, as the owner chose (option A).** `responsive-layout.md` now carries the sentence. The new finding F7 is about how far that sentence reaches.
- **F5 · low: fixed.** The README now says "three rules", and `seed` posts three.
- F3, F4 and F6 stay recorded and unfixed, under the owner's severity floor, and are not regraded here.

New findings in the lines this round touched:

- **F7 · med** · no `Done when` line depends on it · **open decision** · the new sentence in `.claude/rules/responsive-layout.md` names `html` or `body`. The hazard it describes is wider than that, and narrower in one way:
  - Ledger with `.card { width: 400px; } main { overflow-x: hidden; }` gave `2 passed` with the content clipped. So did `.card { width: 400px; } .shell { overflow-x: hidden; }`.
  - `html { overflow-x: hidden; }` on its own gave `2 failed` ("416 px wide in a 360 px window"). Gate 1 measured `body` on its own as red too.

  So the check goes blind when any wrapper below the viewport clips. `html` and `body` together are one case of that. Either one alone is not a case.

  Direction: a reader who trusts the sentence believes clipping `main` or the app shell is still caught, and it is not. That is the unsafe direction, on the same mechanism as F2. The options and their costs are in the full report.

- **F8 · low** · the new comment on `TABS` in `tools/ledger/e2e/layout.spec.ts` is false in two places. The comment's stated guarantee, that a series that did not arrive fails the case, holds for 8 of 8 series. So the falsehood runs in the safe direction:
  - It says every entry is "a figure the seed put there", and excepts only Admin. Household's `sam@example.test added as sam` also comes from the serve script's directory. Run over empty books, the Household case passed. The Log says so too.
  - It says "Stats has one figure per card". Stats renders 10 cards, and the patterns cover 9 of them. "Put into the mortgage" shows "Nothing was filed to a person in this range." over the seed. Its series is `contributions`, which "Put into the buffer"'s `750.50 $` already covers.
- **dropped** · Admin's patterns also match over empty books. That is not a defect: Admin's data is the directory, and aborting `/api/admin/households` loses both patterns.
- **dropped** · no dependence on the time zone or the locale (measured above). No dependence on the run date was found by reading: every seeded date is fixed, and the range is "All of it". Running on another date was not measured.
- **dropped** · `openTab`'s `waitForLoadState("networkidle")` returns at once when the page has already reached that state. It is in lines the round did not touch, and it is harmless now that each pattern waits up to 15 s.
- **findings** · the hunt returned 5: 2 carried, 3 dropped.
- NFR: security n/a · performance n/a (the ledger spec still takes 22 s) · reliability ✓ (F1's route-by-route aborts) · maintainability: F7, F8.

Nothing here is `high`. F7 is a `med` that no `Done when` line depends on, so it does not open a round. It goes to the owner as an open decision.

## Log

- 2026-10-18 — Filed from the owner's request, beside repo-108 (design tokens),
  in the same pull request. The two are independent: the check needs no tokens,
  and repo-108's no-visual-change acceptance holds whether this lands first or
  second. Measurements on `main@140bd78a`.

- 2026-10-20 — Built (model: Sonnet 5.5). Owner's answer at intake recorded above
  (option 1, the builder's enumerated list); Done-when 2 reworded to match.

  **The screens, per tool, and how each is reached** (the list the gate grades
  coverage against; none of the three has a router, so each is a view state). Every
  case reaches its screen once, then measures it at 360×740 and 1280×800 on the same
  page, and writes a full-page screenshot of each to `e2e/.artifacts/layout/`.
  - **downloader** (`tools/downloader/e2e/layout.spec.ts`, 5 cases): the address
    form, with a 192-character address typed into it; the analysing panel, with the
    probe request held so it stays up, over the same long address; the renditions
    table (the fixture master playlist, two renditions) and probe panel; a finished
    download's card (a real download through ffmpeg, "Saved by your browser") with
    the table above it; `terms.html`, the page beside the bundle. Not listed: the
    error panel and the job card's other states (sub-states).
  - **planner** (`tools/planner/e2e/layout.spec.ts`, 5 cases): the trips and plans
    list with a trip and a drafted plan in it; a question; the checkpoint, with
    "The trip so far" and "Your answers" beside it; a finished run ("Done", the
    unchecked list); a plan (six days, items, the re-plan and dates forms). Reached
    with `intake-walk.ts` and `plan-walk.ts`, naming no question and no plan. Not
    listed: the discard warning and a running run (sub-states).
  - **ledger** (`tools/ledger/e2e/layout.spec.ts`, 12 cases): the twelve tabs of
    `App.tsx` — Home, Stats, Period, History, Receipt, Paste, Inbox, Rules,
    Categories, Salaries, Household, Admin — each opened onto a household seeded
    through the API (three rules, the three-month paste, 2026 salaries and their
    ratio, a closed period with three lines and an open one with one, a recurring
    item). Paste is measured twice (previewed, then stored) and Receipt with a photo
    kept, "Type it in" pressed, and a long merchant and item typed. Not listed: the
    history's open filter panel, the auto-filed list (empty here), the receipt's
    read-by-model path (no model is configured in e2e).

  **Result: no screen overflows at 360 px.** Every case is green at both widths, so
  there is no `test.fixme`, no per-tool ticket was filed and no step-4 fix was
  folded in (Done-when 5 holds with both lists empty). Every one of the 46
  screenshots was opened by hand; none is an empty page. Two things looked wrong in
  them and are not overflow, so they are not this ticket's: the household screen's
  mortgage radio group (`Household-360.png`) lays its three radios out centred, away
  from their labels, and the receipt form's item text field (`Receipt-360.png`,
  `Receipt-1280.png`) is about 8 characters wide, so the entry is clipped in it. Both
  are in the report as open decisions rather than filed here.

  **The check can fail (Done-when 3).** A planted `.panel { width: 400px; }` in
  `tools/planner/web/src/styles.css`, reverted after (`git status` shows the file
  clean), run as `npx playwright test -c tools/planner/playwright.config.ts
layout.spec.ts`: `5 failed`, each of the form `Error: Trips and plans is 420 px
wide in a 360 px window` (likewise Question, Checkpoint, Run, Plan). The 1280 px
  measurement of each passed, so it is the width that fails, not the page.

  **What the brief had wrong or left out.**
  - Ledger's server could not serve the spec as it stood: every route but health
    answers 403 until the caller is a member, `DEV_IDENTITY` is refused unless the
    directory already holds that address, and the e2e config set neither. The
    `e2e:ledger:serve` script now adds the household and two members through the
    household command before the API boots, and the config sets `DEV_IDENTITY` and
    `LEDGER_ADMINS` so the household and admin tabs exist. The config also cleared
    its storage directory in every worker (Playwright imports the config again in
    each), which would delete the household under a running server; it now clears it
    only where `TEST_WORKER_INDEX` is unset.
  - The planner's API refuses a sixth run in a minute (`RATE_LIMIT_RUNS_PER_MINUTE`
    is 5): with this spec drafting two plans, `revise.spec.ts` failed on "Too many
    requests" mid-run. Reproduced by running the suite (9 passed, 1 failed, 1.4
    minutes) and fixed by setting the limit to `0` in `playwright.config.ts`, as the
    downloader's config already does. The limiter has its own API tests.
  - Ledger's Playwright project is a Pixel 7 (mobile emulation), so the spec turns
    `isMobile`, `hasTouch` and `deviceScaleFactor` off: one device model at both
    widths and only the width differs. The project itself is untouched.
  - A passing test's attachments are deleted with its output directory, so the
    screenshots are also written to `e2e/.artifacts/layout/` (already ignored) and
    each tool's e2e job uploads them (`if: always()`, 7 days), or a gate has nothing
    to open.
  - The farm links no `@webtools/ui` (the shared checkout has none), so `npm run
build` failed on `@webtools/ui/tokens.css`; linked by hand with
    `ln -s ../../packages/ui node_modules/@webtools/ui` and built clean.

  **Locally, `download.spec.ts` fails on a line this branch does not touch**:
  `expect(job).toBeInViewport()` (dl-109), "viewport ratio 0", in `npx playwright
test -c tools/downloader/playwright.config.ts download.spec.ts` (3 passed, 1
  failed), and the same in the full run. `main`'s own downloader run is green at
  `6b4c85cc` (run 39362113102), and no downloader source changed here, so it reads as
  this sandbox's rendering; unproven against `main` in a second tree, and CI on this
  branch is the reading.

  **Folded in, and not.** Folded: the ledger README rewrite and the stale comment in
  `tools/ledger/e2e/tsconfig.json` that said the suite had no spec. Not folded, each
  for the stated reason: `tools/ledger/CLAUDE.md` lines 27 and 57 ("none yet", "No
  tests found until the first spec") are now stale, and a tool's `CLAUDE.md` is
  edited only when the Build names it, so they are proposed lines in the report; the
  planner-e2e rule's "five specs over three paths" was already not a count of the
  three specs there and is left for whoever owns that page.

  **Not a fix to any screen, so no changelog line**: this branch touches no
  `web/src` file.

- 2026-10-21 — Two fold-ins, on the owner's answers of 2026-10-21 (each asked as
  "fold into repo-109 now (recommended)" or "leave for the review session";
  **chosen: fold in**, both). This reverses the "Not folded" paragraph of the
  entry above.
  - `tools/ledger/CLAUDE.md`, the two lines the branch made false: the layout line
    now reads `Playwright specs — the layout spec; e2e/README.md says what earns the
next`, and the command line `# the layout spec: every screen at 360px and
1280px`. A tool's `CLAUDE.md` is otherwise edited only when the Build names it;
    this edit is the owner's.
  - `.claude/rules/planner-e2e.md`, "five specs over three paths": recounted from
    the tree, it is four spec files (`intake` 2 tests, `pin` 2, `revise` 1, and
    `layout` 5), three of them paths, so the old "five" was a count of tests. The
    lead sentence now says four files and which three are paths, and a paragraph
    says what `layout.spec.ts` is; the rule's intent is untouched. The planner
    e2e README's "Five specs over three paths" is reworded the same way.
  - The household radio group and the receipt item field (the defects in the entry
    above) are not touched on this branch: the owner chose to file one `lg-` ticket,
    which is dispatched separately.

- 2026-10-21 — Gate 1 round (graded FAIL at `b78867d2`; model: Sonnet 5.5).
  - **F1 (high), fixed.** The ledger spec's `arrived` list matched a heading for
    Stats, Categories and Admin, which renders while loading, on a failed request
    and over empty books. Every tab now waits for rows or figures the seed put there
    (`TABS` is a list of patterns per tab), and Stats for one figure per card
    (`700.00 $`, `-1050.00 $`, `750.50 $`, `1550.50 $`, `72000.00 $`, `57.1429 %`,
    `-60.25 $`, `89.99 $`, `29.27 $`), so one series that did not arrive fails the
    case. Categories waits for `12 rows, newest first` and a row, Admin for
    `Test household` and `sam@example.test`. **Admin has no seed of the spec's own**:
    what it lists is the household directory, which the `e2e:ledger:serve` script
    fills before the API boots, so those two entries are the script's. Checked every
    other pattern in all three specs against the same standard: ledger Home,
    Period, History, Inbox, Rules, Salaries and Household already match a seeded row
    or figure; the planner waits on a seeded plan title, a plan's items, and the
    states themselves (a question, the checkpoint, "Done"); the downloader waits on
    the two-rendition table, "Saved by your browser" and "Stop waiting". Nothing else
    matched a heading over data.
  - Proved the way the gate proved the defect, each at `c5baea2e`, with the
    mutation reverted from that commit afterwards (the working tree was clean):
    - **`**/api/stats/**` aborted** (`await page.route("**/api/stats/**", (route) =>
route.abort())` at the top of `openTab`), `npm run e2e:ledger`: `1 failed, 11
passed`; Stats red with `Expected pattern: /700\.00 \$/u` against `Mortgage
paymentThe ledger API is not answering.Own money in the mortgage…`.
    - **Empty books** (the seed's guard flipped so it returns before posting):
      `8 failed, 4 passed`. Home, Stats, Period, History, Inbox, Rules, Categories and
      Salaries red, each `toContainText` against `getByRole('main')`. Household and
      Admin passed: their rows come from the directory the serve script fills, not
      from the seed. Paste and Receipt are forms and pass over empty books too.
    - Unmutated: `12 passed (22.0s)`.
  - **F2 (med), owner's answer 2026-10-21: option A of three** (A: one rule
    sentence; B: make `fitsBothWidths` fail on an element past the right edge with no
    sideways-scrolling ancestor; C: record only). `.claude/rules/responsive-layout.md`
    now says never to put `overflow-x: hidden` on `html` or `body`, because the check
    cannot see content clipped that way (the gate measured `.card { width: 400px; }
html, body { overflow-x: hidden; }` giving `12 passed`). The specs are not changed
    for it.
  - **F5 (low), fixed.** The ledger README said "two rules"; the seed posts three.
  - **Left recorded and not fixed, as the coordinator directed:** F3 (any process
    that loads the ledger config deletes its storage directory), F4 (running
    `e2e:ledger:serve` by hand seeds the dev directory; unverified) and F6
    (`NoHousehold` and the admin-only shell are not on the enumerated list and are
    unreachable under this harness, which signs in as a member who is also an admin).
    No disagreement with any of the three.
- 2026-10-21 — Fixed at landing by owner choice: gate 2, F7 — "the new sentence in
  `.claude/rules/responsive-layout.md` names `html` or `body`. The hazard it
  describes is wider than that". Owner's choice A′ of three (A′: reword the rule
  sentence at landing; B: detect clipping in the spec; C: keep the sentence and
  record F7). The sentence now says never to put `overflow-x: hidden` (or `clip`) on
  any element that wraps the page — `html` and `body` together, `main`, the app
  shell — because the layout check cannot see content clipped that way, and that wide
  content scrolls in its own container instead. No spec is changed.
  `grep -c "on any element that wraps the page" .claude/rules/responsive-layout.md`
  → `1`; `grep -c "hidden. on .html" .claude/rules/responsive-layout.md` → `0`.
- 2026-10-21 — Fixed at landing by owner choice: gate 2, F8 — "the new comment on
  `TABS` in `tools/ledger/e2e/layout.spec.ts` is false in two places". The comment
  now says what the gate measured: Admin and Household both take their entries from
  the directory the serve script fills (Household passes over empty books), Stats
  renders 10 cards and the patterns cover 9, "Put into the mortgage" shows "Nothing
  was filed to a person in this range." and its series `contributions` is covered by
  "Put into the buffer", and each of the 8 series is asserted.
  `grep -c "the seed put there\|one figure per card" tools/ledger/e2e/layout.spec.ts`
  → `0`.
