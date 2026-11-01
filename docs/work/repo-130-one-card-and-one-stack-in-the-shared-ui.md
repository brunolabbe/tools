---
id: repo-130
tool: repo
title: A shared base layer in `@webtools/ui`, every tool reset onto it, the planner first
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-130 — A shared base layer, and the planner moved onto it

## Why

`.claude/rules/ui-package.md` says a component moves into `@webtools/ui` once a
second tool needs it. On 2026-10-18 only `.muted` was in all three stylesheets.
On 2026-10-25, while finding why the ledger's Admin cards stood flush (lg-70),
the stylesheets were read side by side at `origin/main@01e80b71`. Every tool now
draws the same base elements, each in its own way:

| What           | downloader                                               | planner                                               | ledger                                                    |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| Body text      | `15px` / 1.55                                            | `16px` / 1.55                                         | unset (16px) / 1.5                                        |
| `h1`           | `1.5rem`, `-0.01em`                                      | `1.9rem`, `-0.02em`                                   | `1.5rem`, accent colour                                   |
| Plain button   | quiet (`.button`, surface background)                    | quiet (`button`, surface background)                  | **accent** (`button`); quiet is `.secondary`              |
| Main button    | `.button--primary`                                       | `button.primary`                                      | the plain one                                             |
| Button height  | padding only, about 37px                                 | padding only, about 40px                              | `min-height: 2.75rem` (44px)                              |
| Text fields    | one rule per field, `--surface-2` background             | **unstyled**: the browser's form font, not the page's | `min-height: 2.75rem`, `1rem` text, `--bg` background     |
| Keyboard focus | `:focus-visible`, 2px accent outline                     | the browser's                                         | the browser's                                             |
| Card           | `.card`, padding `1.1rem 1.2rem`, `var(--shadow)`, block | `.panel`, padding `1.25rem`, no shadow, block         | `.card`, padding `1rem`, no shadow, grid `gap: 0.75rem`   |
| Card title     | `.card__title`: `0 0 0.25rem`, `1.05rem`                 | `.panel h2`: `0 0 0.5rem`, `1.15rem`                  | `.card h2`: no margin, `1.125rem`                         |
| Stack of cards | `.layout`, flex column, `gap: 1.25rem`                   | `.main`, `.aside`, grid, `gap: var(--gap)`            | `main` (and `.stack` from lg-70), grid, `gap: var(--gap)` |
| Page column    | `.app`, padding `1.5rem 1rem 4rem`                       | `.shell`, padding `3rem 1.25rem`                      | `.shell`, padding `var(--gap)`, doubled from 48rem        |
| Hidden text    | `.visually-hidden`, a copy of the shared `.sr-only`      | `.sr-only`                                            | `.sr-only`                                                |

Two of these are defects in their own right, and the reset fixes both. The
planner's text fields (17 inputs, 3 textareas, 3 of 4 selects) have no rule, so
they take the browser's form font. Chromium's is 13.33px; this is the browser's
documented default, not measured here. That is smaller than the page text, and
under the 16px iOS Safari needs not to zoom the page when a field takes focus.
The downloader's URL field inherits the body's 15px, which also falls under that
threshold, and that field is the downloader's main input.

The stack is where the ledger's flush cards came from: a grid gap reaches only
the grid's own children. One shared stack, with that sentence beside it, is
where the lesson should live.

## Decision — answered 2026-11-01 by the owner

**Question 1 — answered 2026-10-25 by the owner. Share the names, or the look?**
The look, reset first. Every tool is moved onto one shared base layer in a first
pass, so all three look alike, and then whatever really needs to differ comes
back. The other options were: share only the names and structure and keep each
tool's numbers, or leave all three as they are. The reasoning: today every
difference exists by default and nobody has to argue for it. After a reset, a
difference has to be argued for, and it is written as a token, not a forked rule.

**Question 2 — answered 2026-10-25 by the owner. Does "alike" include colour?**
No: everything but colour. Each tool keeps its palette, as decided on
2026-10-18. The other option was one palette for all three.

**Question 3 — answered 2026-10-25 by the owner. What is the baseline built
from?** A fresh one, picked rule by rule, with each choice stated below. The
other option was to copy one tool's look wholesale.

**Question 4 — answered 2026-10-25 by the owner. Which tool moves first?** The
planner, inside this ticket's pull request. It is closest to the baseline: it
styles elements, and its plain buttons are already quiet, so its diff is mostly
deletions. The ledger follows (lg-73), then the downloader (dl-135). The other
options were the ledger first, or the downloader first.

**Question 5 — answered 2026-11-01 by the owner. Are the proposed values below right?** They are proposed in
this ticket so the build starts from settled numbers (the owner's choice over
having the builder propose them in its pull request). Approve them or amend any
row on the pull request that files this. The answer moves this ticket to `ready`.

The options were: approve the table as proposed; approve with amendments; not
now. The owner chose **approve the table as proposed**, which was the
orchestrator's recommendation. The table under "The proposed baseline" stands as
written.

### The proposed baseline

**Every base selector is wrapped in `:where()`**, so it has no specificity. Any
class, from a shared component or from a tool, then beats it whatever the
load order. The case that makes this necessary: repo-131's theme control hides
its radios with a hidden-text class, and a bare `input[type="radio"]` size rule is
more specific than that class. The radios would stay clipped, but the two rules
would be fighting.

**`h1` is not here.** After repo-131 the only `h1` in every tool is inside its
shared `AppHeader`, and repo-131 lifts the downloader's `.topbar h1` (`1.5rem`,
`-0.01em`), which is what this table would have proposed. Two shared places
styling one element is the drift this ticket removes. The ledger's accent `h1`
is lg-72's question.

A tool differs from a row only by setting a custom property the shared rule
reads with a fallback, such as `var(--card-shadow, none)`. Such a property is
**not** declared in `tokens.css`: the shared rule's fallback is the default, and
a tool that needs another value declares it in its own `:root`. Keeping it out
of `tokens.css` keeps the guard from repo-130's first half meaningful. That
guard fails on a name `tokens.css` declares that no tool's `web/src` reads, and
a fallback-read override is read by the shared layer, not by a tool.

| Rule            | Proposed                                                                                                                                                                                                                        | Taken from, and why                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body            | `font: var(--font-size-base) / 1.55 var(--font-sans)`; `--font-size-base` stays `1rem`                                                                                                                                          | Downloader and planner wrote this exact rule. 16px, because the downloader's 15px puts its URL field under iOS's no-zoom size                                              |
| Font stack      | `--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` in `tokens.css`, and the tools drop their own                                                                                                           | The downloader's, the longest of the three. `-apple-system` covers older Safari, `Roboto` older Android                                                                    |
| `code`          | `font-family: var(--font-mono); font-size: 0.88em`                                                                                                                                                                              | Downloader's, the only one                                                                                                                                                 |
| Keyboard focus  | `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`                                                                                                                                                      | Downloader's. Planner and ledger had none of their own                                                                                                                     |
| Buttons         | `button, .button`: quiet (`--surface` background, 1px `--border`, `--text`), `min-height: 2.75rem`, `padding: 0 1rem`, `border-radius: var(--radius)`, `font: inherit`, `cursor: pointer`                                       | Quiet by default, the convention of two of three. 44px tall from the ledger: the phone floor. `.button` kept so a link styled as a button (downloader) still works         |
| Main button     | `.primary`: `--accent` background and border, `--accent-text`, `font-weight: 600`                                                                                                                                               | Planner's name, downloader's weight                                                                                                                                        |
| Button states   | `:disabled { opacity: 0.5; cursor: not-allowed }`; `:hover:not(:disabled) { border-color: var(--accent) }`                                                                                                                      | Downloader's. The ledger's opacity                                                                                                                                         |
| Text fields     | `input` (not checkbox or radio), `select`, `textarea`: `width: 100%`, `min-height: 2.75rem`, `font: inherit`, `font-size: 1rem`, `padding: 0 0.75rem`, `--surface-2` background, 1px `--border`, `border-radius: var(--radius)` | The ledger's rule, the only complete one. `--surface-2`, because it is the role for a well (the downloader uses it, the ledger used `--bg`). `1rem` keeps iOS from zooming |
| Invalid field   | `[aria-invalid="true"] { border-color: var(--danger) }`                                                                                                                                                                         | Downloader's                                                                                                                                                               |
| Radio, checkbox | `width: 1.25rem; min-height: 1.25rem`                                                                                                                                                                                           | Ledger's (lg-64)                                                                                                                                                           |
| Card            | `.card`: `--surface`, 1px `--border`, `border-radius: var(--radius)`, `padding: var(--card-padding, var(--gap))`, `box-shadow: var(--card-shadow, none)`, `display: grid`, `gap: 0.75rem`, `min-width: 0`                       | Ledger's grid: children are spaced by the card, not by their own margins. No shadow, two of three; the downloader may keep `--card-shadow`. `1rem` padding suits 360px     |
| Card title      | `.card > :is(h2, h3):first-child { margin: 0; font-size: 1.125rem }`                                                                                                                                                            | Ledger's, between the other two (`1.05rem`, `1.15rem`). Includes `h3` for a card under a screen's own `h2` (lg-70)                                                         |
| Card children   | `.card > :is(p, ul, ol, dl, h2, h3, h4) { margin: 0 }`                                                                                                                                                                          | The card's gap does the spacing, so a child's own margin would add to it, which is how the ledger's "People" gap opened (lg-70's Log)                                      |
| Stack           | `.stack { display: grid; gap: var(--gap) } .stack > * { min-width: 0 }`                                                                                                                                                         | Ledger's and planner's grid. `min-width: 0`, because a grid item will not shrink below its content (lg-9's charts). The comment says the gap reaches only its own children |
| Page column     | `.shell`: `max-width: var(--page-width)`, `margin: 0 auto`, `padding: var(--gap)`, and `calc(var(--gap) * 2)` from `48rem`                                                                                                      | Ledger's, the only one that pads less on a phone                                                                                                                           |
| Muted text      | `.muted { color: var(--text-muted) }`                                                                                                                                                                                           | All three. The downloader's added margin goes                                                                                                                              |
| Hidden text     | `.sr-only`, already shared                                                                                                                                                                                                      | The downloader's `.visually-hidden` is a copy, and goes                                                                                                                    |

**Not in the first pass:** form labels, tables, tabs, notices, the ledger's
`.small` button and the downloader's `.card--quiet`. Each is used by one tool or
styled too differently to pick from at a glance. They stay local, and each moves
when a second tool needs it, as the rule says.

## Build

1. `packages/ui/src/base.css`, exported as `@webtools/ui/base.css`, holds the
   rules in the table, each with a comment giving its reason if the reason is
   not obvious. `tokens.css` keeps the names. The font stack moves into
   `tokens.css`.
2. `.claude/rules/ui-package.md`: a web package imports `tokens.css`, then
   `base.css`, then the shared components' stylesheet (repo-131's header and
   footer, once it lands), then its own. State that a tool differs from the base
   by declaring a fallback-read property in its own `:root`, never by re-declaring
   a base rule. `packages/core/test/image-closure.test.ts` already holds the
   Dockerfile's copy of `packages/ui`. Check that it still does once there is a
   second CSS file.
3. A test in `packages/ui/test`: every tool's `main.tsx` imports `base.css`
   after `tokens.css` and before `styles.css`. A tool that has been moved (the
   planner here; lg-73 and dl-135 add theirs) declares none of the base's
   selectors in its own `styles.css`.
4. **The planner.**
   - Import `base.css`.
   - Delete its `body`, `button` and `button.primary` rules. Its `h1` goes with
     pl-65, when the shared header replaces it.
     `button.link` stays, and now overrides the base button.
   - `.panel` becomes `.card`: 13 `className` uses across six web files. Move
     the e2e locators with it: the 11 `section.panel.*` locators in
     `plan-walk.ts`, `intake-walk.ts`, `layout.spec.ts`, `intake.spec.ts`,
     `revise.spec.ts` and `pin.spec.ts`, and the comment in
     `web/test/stylesheet.test.ts`. The planner's e2e job is the only thing that
     would catch a locator left behind.
   - `.panel.warn` becomes `.card.warn`. `.status` stays local.
   - `.main` and `.aside` take `.stack`, and `.shell` uses the base column.
   - Its text fields pick up the base rule.
5. Run the planner's `e2e/layout.spec.ts` before and after, and **open both sets
   of screenshots**. Every difference is either a row of the table or a finding.
   Expect the fields to grow, buttons to reach 44px and the page padding to
   shrink on a phone. Write each into the Log.

**Seams with repo-131** (filed in #666; not started when this was
written).

- Both edit `packages/ui/package.json`'s `exports` and
  `.claude/rules/ui-package.md`. Neither blocks the other, and whichever lands
  second rebases.
- On each tool, this reset and that tool's header adoption (pl-65 here, then
  lg-72 with lg-73, and the downloader inside repo-131 with dl-135) touch the
  same `main.tsx`, `App.tsx` and `styles.css`. Land them one after the other,
  in either order.
- repo-131 moves the theme control, which hides its radios with the
  downloader's `.visually-hidden`. In the package it should use the shared
  `.sr-only` instead, so the copy this table retires does not move with it.

## Done when

1. `@webtools/ui/base.css` exists, holds the table's rules, and the planner
   imports it after `tokens.css`.
2. The test in Build 3 passes, and fails when a moved tool re-declares a base
   selector.
3. The planner's `styles.css` declares no `body`, `button`, `.panel`,
   field or column rule of its own.
4. Every planner text field shows the page font at 16px. The planner's layout
   spec says so at 360px and at 1280px.
5. The planner's layout spec and e2e suite pass. The before and after
   screenshots are compared in the Log, screen by screen.
6. `npm run check` and `npm test` pass.

## Log

**2026-10-25 — filed, and the token half built.** The branch that files this
also removes the nine scale tokens nothing read (`--space-1` to `--space-6`,
`--font-size-sm`, `--font-size-lg`, `--font-size-xl`). It adds a guard, in
`packages/ui/test/tokens.test.ts`, that fails on a name in `tokens.css` that no
tool reads. That guard is why the override properties above live in a fallback
rather than in `tokens.css`. lg-70, open as pull request #664 when this was
filed, adds the ledger's `.stack`. lg-73 replaces it with the shared one.

**2026-10-25 — gate 1 on the filing, CONCERNS.** One `med`: the planner rename
was priced without its 11 e2e locators. Two `low` corrections to the table: the
downloader's title is `.card__title`, and `.status` pads `var(--gap)`. All three
are carried into this rewrite. The gate's report is on the pull request thread.

**2026-10-25 — re-scoped.** The ticket first asked whether to share names or a
look. In discussion, the owner chose to reset all three tools onto one look
first and let differences come back as tokens (Questions 1 to 4). The values
went into the ticket so they could be reviewed before any build (Question 5).
The per-tool moves after the planner are lg-73 and dl-135, because a pull
request here touches one tool.

**2026-10-25 — fitted to repo-131.** #666 filed one shared header and footer
(repo-131, with pl-65 and lg-72) while this was being re-scoped. The `h1` row is
gone, because the shared header owns the only `h1`. Base selectors are wrapped
in `:where()`, the stylesheet order names the components layer, and the seams
are listed above `Done when`.

**2026-11-01 — Question 5 answered; ready.** The owner chose approve the table
as proposed, the orchestrator's recommendation, from the three options under
Question 5 (approve as proposed; approve with amendments; not now). Status is
`ready`; `difficulty` stays `standard`. Questions 1 to 4 were already answered on
2026-10-25, so this is the only answer the ticket was waiting on.

Fold-in: the 2026-10-25 entry above says lg-70 is "open as pull request #664",
which is stale. lg-70 merged as `f69e9b2c`. `git log --oneline -1 f69e9b2c`
prints `f69e9b2c fix(ledger): space Admin's cards and restore the stats gridlines
(lg-70) (#664)`. The old sentence is left as it was written.
