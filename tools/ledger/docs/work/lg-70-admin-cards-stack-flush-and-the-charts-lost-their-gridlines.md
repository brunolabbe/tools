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
styles: 26 gridlines on the Stats screen with a computed stroke of `none`.

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

## Review

**Gate: CONCERNS** — 2026-10-25 · `01e80b71..a9701966` · Sonnet 5.5, depth medium

The branch is one commit directly on `01e80b71` (the merge base is `01e80b71`), so the range carries no `main` files. The only thing keeping this from PASS is that the two e2e-asserted lines have no pull request yet to carry ledger.yml's e2e job; I ran the same spec locally, on the head, and it passed (below).

| Done when                                                                                                           | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Admin, at 360 px and 1280 px, every card at least `main`'s gap below the one before, and the layout spec says so | `tools/ledger/e2e/layout.spec.ts` › "Admin fits a phone and a desktop", through `cardsStandApart` (`toBeGreaterThanOrEqual(gap - 0.5)`, gap read from `main`'s computed `rowGap`). Ran locally at the head: passes; Admin has 3 top-level cards and 2 pairs at each width, `main` gap 16 px. With `origin/main`'s `styles.css` and `Admin.tsx` swapped in it fails 4 ways: card 2 and card 3 are `0 px` below the card before, at both widths (`Expected: >= 15.5, Received: 0`). **unproven (gate)** for the CI leg only: no pull request exists for the branch (`gh pr list --head lg-70-admin-card-spacing` is `[]`), so ledger.yml's `e2e` job has not run on this head |
| 2. Every gridline on Stats has a stroke, and the layout spec says so                                                | `tools/ledger/e2e/layout.spec.ts` › "Stats fits a phone and a desktop", through `gridlinesDrawn`: the `toBeGreaterThan(0)` companion on the gridline count, then the `"none"` filter `toEqual([])`, at both widths. Ran locally at the head: passes. With `origin/main`'s files swapped in it fails at 360 px with 26 strokes of `none`. **unproven (gate)** for the CI leg only, as row 1                                                                                                                                                                                                                                                                                  |
| 3. Admin's card titles have no margin and match other cards' titles in size                                         | **verified** by a probe of mine on the head (a patched copy of the spec, restored): all 3 Admin `.card > h3:first-child` read `margin 0px 0px`, `18px`, at both widths; Home's, Salaries' and Household's card `h2` read `0px 0px`, `18px`. No standing test holds it, and the brief asks for none                                                                                                                                                                                                                                                                                                                                                                          |
| 4. No ledger rule sets `color: var(--bg)`; text on the accent colour reads `--accent-text`                          | **verified** by `git grep -n "var(--bg)" a9701966 -- tools/ledger`: only `background: var(--bg)` in `styles.css` (the `textarea` and `input, select` rules) and the ticket's prose. `button`, `.tabs button[aria-pressed="true"]` and `.range button[aria-pressed="true"]` read `--accent-text`; every other button variant sets its own `color` (`.tabs button`, `button.secondary`). The built CSS has 5 `accent-text` references at the head, 2 at the base                                                                                                                                                                                                              |
| 5. `npm run check`, `npm test -- --project ledger` and `npm run e2e:ledger` pass                                    | **verified**: `npm run check` exit 0; `npm test -- --project ledger` 81 of 81 files, 1687 of 1687 tests; `npm test -- packages/ui` (reads each tool's `styles.css`) 26 of 26; `npm run e2e:ledger` 12 of 12 passed (19.4 s), the whole of the ledger's e2e (one spec file)                                                                                                                                                                                                                                                                                                                                                                                                  |

**The premise the dispatch asked about holds.** Against `origin/main`'s `styles.css` and `Admin.tsx` (swapped in with `git checkout 01e80b71 -- <both>`, built CSS checked to lack `.stack`, restored from `a9701966` afterwards), `npm run e2e:ledger -- --reporter=line -g "Admin|Stats"` failed 2 of 2: Stats on `gridlines with no stroke` and Admin on the four `0 px` gaps. On the head the same command passes 2 of 2. Both checks can fail, so neither is a tautology. One number in the ticket is wrong (F1).

- **low** · no `Done when` line depends on it · The ticket's Why (Defect 3) and its Log both say **28** gridlines had a stroke of `none`. The run prints 26: the `Array [` the check received holds 26 `"none"` entries, and `28` is the `+ Received + 28` line of Playwright's diff header (26 entries and the two bracket lines). Shipped text that is false about a detail nothing relies on. Reword both to 26.
- **low** · no `Done when` line depends on it · `nfr:maintainability` — `cardsStandApart` has no companion that fails on empty. A screen with fewer than two top-level `.card`s compares nothing, so a screen whose cards lost the class passes silently. My enumeration of the 26 measurement points (13 screens or states, two widths): 14 have at least one pair (Home 2 cards, Stats 11, Period 4, Categories 3, Salaries 2, Household 2, Admin 3); 12 have one card and cannot fail (History, Inbox, Rules, Paste preview, Paste stored, Receipt). Admin is guarded in practice by its `arrived` patterns, and the base-swap run shows the check is not vacuous there, so no live call site. A direction, not a remedy: pass the expected card count for the screens known to have two or more, as `radiosBesideTheirLabels` does for radios.
- **dropped** · a long unbreakable household name (80 characters) and address make Admin scroll the page sideways at 360 px. True, and not this diff's: `scrollWidth` 1230 px at the head against 1276 px at the base, with the same overflow in both. Pre-existing, outside the range, and a hostile input.
- **dropped** · `.card > h3:first-child` over-matching other screens. The probe found 3 matches in 26 measurement points, all on Admin; the source has no other `.card` whose first child is an `h3` (Household's `h3`s follow its `h2`). Household's own `h3`s still read an 18.72 px margin, untouched, as the Log says.
- **dropped** · Done when 3 and 4 have no standing check. The brief's Build 6 names two checks, and the lines are verified above by measurement and grep. Not a defect.
- **dropped** · the admin-only shell (the owner's first screenshot, `App.tsx`'s `<main><Admin /></main>`) is not a case in the layout spec. It renders the same `Admin` under the same `main`, so the fix reaches it; I did not measure it, because it needs an admin who belongs to no household and the spec's identity is a member.
- **findings** · the hunt returned 6; 2 carried (F1, F2), 4 dropped.
- NFR: security n/a (CSS, a test, one class name) · performance n/a (no script, no new request; one more `getBoundingClientRect` pass per width in the spec) · reliability ✓ (checks are geometry, not wall-clock; the base swap and the 12 of 12 run show they separate broken from fixed) · maintainability — F2.
- Invariants checked: tests registered (`layout.spec.ts` was already in `tools/ledger/e2e/tsconfig.json`; the typecheck in `npm run check` covers the new code), style (no `any`, no `console`). Skipped: tool boundaries, errors, shell, redaction, SSRF, progress, contract, Dockerfile, routes (the diff reaches none of them).

**Dispositions, by the builder:**

- F1 (low), 28 against 26: **fixed.** The base run's own log holds 26 `"none"` entries in the array; 28 was the diff header's line count. The Why and the Log now say 26.
- F2 (low), no companion for an empty card list: **fixed.** `CARDS` in the spec gives each screen that draws more than one card its count at least (Home 2, Stats 11, Period 4, Categories 3, Salaries 2, Household 2, Admin 3, the gate's own enumeration), and `cardsStandApart` fails a screen that draws fewer. The whole spec ran 12 passed after the change.
- The four dropped findings: no change, for the reasons given above. The long-name overflow on Admin is pre-existing and was not filed.

## Log

**2026-10-25 — built.** Built as the brief says. Measurements, all in the
Playwright Chromium that `npm run e2e:ledger` drives:

- **The new checks fail without the fix.** Run against `origin/main`'s
  `styles.css` and `Admin.tsx` with only the spec changed, using
  `-g "Admin|Stats"`, both cases failed. Admin read `card 2 is 0 px below card 1`
  and `card 3 is 0 px below card 2` at 360 px and at 1280 px. Stats read 26
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

**2026-10-25 — gate 1, CONCERNS, both findings fixed.** Sonnet gated `a9701966` and re-ran the premise itself. With `origin/main`'s two files swapped in, both new checks failed; at the head, both passed. CONCERNS rests only on the e2e job, which has no pull request to run on yet. F1 and F2 were fixed as the dispositions say.
