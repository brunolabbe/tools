---
id: repo-130
tool: repo
title: One card and one stack in `@webtools/ui`, now that all three tools draw both
kind: work-package
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-130 — One card and one stack in the shared UI

## Why

`.claude/rules/ui-package.md` says a component moves into `@webtools/ui` once a
second tool needs it. On 2026-10-18 only `.muted` was in all three stylesheets.
On 2026-10-25, while finding why the ledger's Admin cards stood flush
(lg-70), the owner asked for the shared-style gaps to be filed. Reading the three
stylesheets at `origin/main@01e80b71` shows each tool now draws a card and a
vertical stack of them, under three names and with three sets of numbers:

| Tool       | Card                                      | Padding                             | Shadow          | Inside the card      | Title                                    | Stack of cards                                             |
| ---------- | ----------------------------------------- | ----------------------------------- | --------------- | -------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| downloader | `.card` (+ `.card--quiet`, `.card__head`) | `1.1rem 1.2rem`                     | `var(--shadow)` | block                | `.card__title`: `0 0 0.25rem`, `1.05rem` | `.layout`, flex column, `gap: 1.25rem`                     |
| ledger     | `.card`                                   | `var(--gap)` (1rem)                 | none            | grid, `gap: 0.75rem` | `.card h2`: no margin, `1.125rem`        | `main`, grid, `gap: var(--gap)` (and `.stack`, from lg-70) |
| planner    | `.panel` (+ `.panel.warn`, `.status`)     | `1.25rem` (`.status`: `var(--gap)`) | none            | block                | `.panel h2`: `0 0 0.5rem`, `1.15rem`     | `.main`, `.aside`, grid, `gap: var(--gap)`                 |

All three take `--surface`, `--border` and `--radius` from the shared names. They
differ only in the numbers. The stack is where the ledger's flush cards came
from: a grid gap reaches only the grid's own children, and a screen that kept
its cards one wrapper deeper lost it. One shared stack, documented once, is
where that lesson should live.

## Decision — open

**Question 1 — open. What moves: the names, or the look?**

1. **The names and the structure, and each tool keeps its numbers.**
   (Recommended.) `@webtools/ui` gets `.card` (surface, border, radius) and
   `.stack` (grid, `gap: var(--gap)`). A tool sets its own padding, shadow and
   title in its stylesheet, which loads after the tokens and wins. The planner
   renames `.panel` to `.card` (13 `className` uses across six web files, and 11 `.panel` locators across six e2e files). The downloader
   swaps `.layout` for `.stack`. This is the rule repo-108 applied to colours: names
   are shared, palettes are not. No screen should change by more than the
   downloader's stack gap, from 1.25rem to `--gap`, unless the downloader sets
   its own `--gap`.
2. **One look for all three.** Pick one padding, shadow and title, and every tool
   changes. Each tool's layout spec must then be re-read screen by screen.
   Choosing the look is the owner's call, so the ticket would need one more
   answer saying which.
3. **Leave them per tool.** Close this ticket as dropped, with this table as the
   reason it was looked at.

## Build

Written for option 1. Re-write it if another is chosen.

1. `packages/ui`: add `src/card.css` (or put the rules in `tokens.css`, if one
   import per tool is still worth more than one file per component). It holds
   `.card` and `.stack`, plus a comment saying why the stack must sit on the
   cards' own parent (lg-70).
2. Each tool's `main.tsx` imports it after the tokens and before its own
   stylesheet. `ui-package.md`'s three steps for a new web package then list it.
3. Planner: `.panel` becomes `.card`, and `.main` and `.aside` take `.stack`.
   Its e2e locators move with it: `section.panel.*` in `plan-walk.ts`,
   `intake-walk.ts`, `layout.spec.ts`, `intake.spec.ts`, `revise.spec.ts` and
   `pin.spec.ts`, and the comment in `web/test/stylesheet.test.ts`. The planner's
   e2e job is the only thing that would catch a locator left behind.
   Downloader: `.layout` becomes `.stack`. Ledger: delete its own `main` grid
   rule (with `.stack`, if lg-70 has merged) and put `.stack` on `main` in
   `App.tsx`. Keep `main`'s gap. lg-70's layout check, once merged, holds it.
4. Run each tool's `e2e/layout.spec.ts` and open the screenshots before and
   after. A difference is a finding, not noise.

## Done when

1. `@webtools/ui` exports the card and the stack, and all three tools import it.
2. No tool's stylesheet declares its own card's surface, border and radius, or
   its own stack grid. A test in `packages/ui/test` finds the old selectors
   gone.
3. Each tool's layout spec passes, and its screenshots match the ones from
   before, bar the difference the Decision names.
4. `npm run check` and `npm test` pass.

## Log

**2026-10-25 — filed.** Filed on the branch that removes the nine scale tokens
nothing read (`--space-1` to `--space-6`, `--font-size-sm`, `--font-size-lg`,
`--font-size-xl`). That branch also adds a guard, in
`packages/ui/test/tokens.test.ts`, that fails on a name in `tokens.css` that no
tool reads. A token for the card's padding should therefore arrive in the same
change as the tool that first reads it. lg-70, open as pull request #664 when this
was filed, adds the ledger's `.stack`, which step 3 replaces.
It is not in `depends_on` because the id does not exist on this branch, so
`npm run status -- --json` fails on it here and in CI.

**2026-10-25 — gate 1 on the filing, CONCERNS.** One `med`: Option 1 priced the
planner rename without its 11 e2e locators. Option 1 and Build step 3 now name
them. Two `low` corrections to the table: the downloader's title is
`.card__title`, not `.card__head`, and `.status` pads `var(--gap)`. The ledger
cell now says `.stack` comes from lg-70. The gate's report is on the pull
request thread.
