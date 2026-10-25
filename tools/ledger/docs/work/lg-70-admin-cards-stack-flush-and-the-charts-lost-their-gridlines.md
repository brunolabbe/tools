---
id: lg-70
tool: ledger
title: Admin's cards stack flush, its card titles carry a browser margin, and the charts lost their gridlines
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# lg-70 — Admin's cards stack flush, and the charts lost their gridlines

## Why

The owner sent two screenshots of the Admin screen on 2026-10-25, the admin-only
shell and the Admin tab inside a household, and asked why its cards have no space
between them. They suspected the shared styling. It is not: `@webtools/ui` holds
tokens only, and `.card` and the space between cards are both the ledger's own
`tools/ledger/web/src/styles.css`. Reading that stylesheet against the shared
tokens turned up the other three defects below. The owner chose to fix all four
in one pull request.

**Defect 1 — Admin's cards touch, at 360 px and at 1280 px.** #539 spaced a
screen's cards with `main { display: grid; gap: var(--gap) }`. A grid gap
reaches only the grid's own children. Every other screen returns its cards in a
fragment, so they are children of `main`. `Admin` returns one
`<section aria-labelledby="admin-heading">` holding its heading, its note and
every card. That section is `main`'s only child, so its cards are laid out as
ordinary blocks, and flush. Measured in Chromium by the layout spec on
`origin/main`'s styles: `card 2 is 0 px below card 1` and `card 3 is 0 px below
card 2`, at both widths.

**Defect 2 — Admin's card titles carry the browser's heading margin.** Only
`.card h2` has its margin taken off. Admin's cards sit under the screen's own
`h2`, so each is titled by an `h3`, which keeps about 1em of margin above and
below. The title then sits lower in its card than every other card's does. The
screen's own "Households" `h2` keeps its default margin too. Seen in the owner's
screenshot, not measured.

**Defect 3 — the stats charts have drawn no gridlines since #539.** Before #539
the rule read `svg.chart .grid, svg.chart .baseline, svg.chart .crosshair {
stroke: var(--border); stroke-width: 1 }`. #539 inserted the `svg.chart.openable
{ cursor: pointer }` rule after the second line of that list, so `.grid` and
`.baseline` got the cursor and no stroke. A `<line>` with no stroke draws
nothing. `Chart.tsx` sets none of its own on a gridline, and the baseline was
still drawn only because a later rule gives it one. Measured on `origin/main`'s
styles: 28 gridlines on the Stats screen with a computed stroke of `none`.

**Defect 4 — text on the accent colour wore `--bg`, not `--accent-text`.** The
shared tokens name `--accent-text` for text on an `--accent` background, and the
ledger sets it in both themes. Nothing read it: `button`, the pressed tab and the
pressed range button used `color: var(--bg)`. The rendered difference is small
(`#f8f9fa` against `#ffffff` in light, `#111418` against `#0b0e12` in dark). It
is a role misused, not a visible bug.

## Build

1. `styles.css`: give `.stack` the rule `main` has, with a comment saying why it
   exists, and take the margin off a `.stack`'s own `h2`.
2. `Admin.tsx`: put `stack` on the outer section. Keep the section, because it is
   the labelled region the heading names.
3. `styles.css`: title a card whose first child is an `h3` the way `.card h2` is.
   Admin is the only screen with such a card.
4. `styles.css`: move the `openable` rule out of the selector list and restore
   the list.
5. `styles.css`: `--accent-text` for the three `color: var(--bg)`.
6. `e2e/layout.spec.ts`: on every screen, at both widths, no two cards closer
   than `main`'s gap. On Stats, every gridline has a computed stroke.

## Done when

1. On the Admin screen, at 360 px and at 1280 px, every card is at least `main`'s
   gap below the one before it, and the layout spec says so.
2. Every gridline on the Stats screen has a stroke, and the layout spec says so.
3. Admin's card titles have no margin and match other cards' titles in size.
4. No ledger rule sets `color: var(--bg)`. Text on the accent colour reads
   `--accent-text`.
5. `npm run check` and `npm test -- --project ledger` pass, and
   `npm run e2e:ledger` passes.

## Log

**2026-10-25 — built.** Built as the brief says. Measurements, all in the
Playwright Chromium that `npm run e2e:ledger` drives:

- **The new checks fail without the fix.** Run against `origin/main`'s
  `styles.css` and `Admin.tsx` with only the spec changed, using
  `-g "Admin|Stats"`, both cases failed. Admin read `card 2 is 0 px below card 1`
  and `card 3 is 0 px below card 2` at 360 px and at 1280 px. Stats read 28
  gridlines with a stroke of `none` at 360 px.
- **They pass with it.** The whole spec ran 12 passed. `npm run check` passed,
  and `npm test -- --project ledger` ran 81 files and 1687 tests, all passing.
- **The screenshots were opened.** `Admin-1280.png` shows three cards apart, each
  titled at its top edge. `Stats-360.png` shows the gridlines back, as
  hairlines in the border colour.

What the brief did not know: the cards-apart check runs on every screen through
`fitsBothWidths`, not only on Admin. Every other screen passed it on the first
run, so none of them had the defect.

Left as it was, and noted only: inside an Admin household card, the "People"
`h4` keeps its default margins, and `.members` adds `margin-bottom: 1rem`. Inside
the card's grid both add to the gap, so a wide space opens above and below
"People" (`Admin-1280.png`). Household's `h3` subheadings do the same, and there
the space reads as separating sections. Changing it was not part of what the
owner chose to fix.
