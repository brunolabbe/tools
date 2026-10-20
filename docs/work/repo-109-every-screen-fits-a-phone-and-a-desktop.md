---
id: repo-109
tool: repo
title: Every screen of every tool fits a 360px phone and a desktop, and a check says so
kind: work-package
status: ready
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
