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
