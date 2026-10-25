---
id: dl-135
tool: downloader
title: The downloader reset onto the shared base layer, its body text at 16px
kind: work-package
status: ready
milestone: null
depends_on: [repo-130]
difficulty: standard
---

# dl-135 — The downloader reset onto the shared base layer

## Why

The owner chose on 2026-10-25 to reset every tool onto one shared look before
deciding what needs to differ. The decision and the baseline are on
[repo-130](../../../../docs/work/repo-130-one-card-and-one-stack-in-the-shared-ui.md),
which builds `@webtools/ui/base.css` and moves the planner first. lg-73 moves
the ledger. This ticket is the downloader's move, last, because it is the most
restructuring: the downloader styles almost nothing by element and does
everything through BEM classes.

Two of its differences were defects, not looks:

- **Body text at 15px.** The URL field (`.urlform__input`, `font: inherit`)
  takes the body's 15px, which is under the 16px iOS Safari needs not to zoom
  the page when a field takes focus, and that field is the tool's main input.
  The base keeps body text at 16px. This is iOS's documented behaviour applied
  to the stylesheet, not measured on a device.
- **`.visually-hidden`** is a copy of the shared `.sr-only`.

## Build

1. Import `@webtools/ui/base.css` in `web/src/main.tsx`, after the tokens and
   before `styles.css`.
2. Delete what the base now owns from `styles.css`:
   - both `body` rules, and the `--font-size-base: 15px` and `--font-sans`
     overrides in `:root`;
   - `:focus-visible`, `.muted` (its margin goes too), `.visually-hidden`;
   - `.button`, `.button:hover`, `.button:disabled`;
   - `.card`'s surface, border, radius and padding;
   - `.layout`, and `.app`'s column.
3. Renames, in `web/src`:
   - `.button--primary` becomes `.primary` (4 uses);
   - `.visually-hidden` becomes `.sr-only` (4 uses, and 1 in `e2e`);
   - `<main className="layout">` becomes `stack`, and `<div className="app">`
     becomes `shell`, both in `App.tsx`.

   `.button` stays on the elements that carry it: the base styles
   `button, .button` alike, so a link drawn as a button still works.

4. **Card titles.** The base titles a card through
   `.card > :is(h2, h3):first-child`. The downloader's five titles are
   `h2.card__title` inside a `.card__head` row, so that rule does not reach
   them. Keep `.card__head` and `.card__title` local, and set `.card__title`
   to the base's title size, `1.125rem`, so the three tools match.
5. **The shadow.** The base card has none. The downloader's `--shadow` comes
   back only as `--card-shadow: var(--shadow)` in its `:root`, and only if the
   owner, looking at the screenshots, says the downloader needs it. Ask.
6. **Inside the cards.** The base card is a grid with `gap: 0.75rem`, and its
   children carry no margin. The downloader's cards are blocks spaced by their
   children's margins. Remove the margins that now double the gap, one card at
   a time, against the screenshots.
7. Fields: `.urlform__input` keeps only its right padding, the room for the
   clear button, and the base does the rest. `.options__row
   input[type="number"]` loses its own rule.
8. Run `e2e/layout.spec.ts` before and after, and **open both sets of
   screenshots**, in both themes.

**Seam with repo-131** (the shared header, footer and theme control, filed in
#666). It moves the downloader's `.topbar`, `.themetoggle` and `.footer` into
`@webtools/ui`, and touches the same `main.tsx`, `App.tsx` and `styles.css`.
Land the two one after the other. If repo-131 lands first, the theme control is
already out of this stylesheet, and should already use `.sr-only` (repo-130's
seam note).

## Done when

1. `styles.css` declares none of the base's selectors, sets no
   `--font-size-base`, and has no `.visually-hidden`. repo-130's test, extended
   to the downloader, says so.
2. The URL field's computed font size is 16px. The layout spec says so at
   360 px.
3. `e2e/layout.spec.ts` and the e2e suite pass. The before and after
   screenshots are compared in the Log, screen by screen, in both themes.
4. The shadow question is answered by the owner and recorded here.
5. `npm run check` and `npm test -- --project downloader` pass.

## Log
