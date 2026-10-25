---
id: lg-73
tool: ledger
title: The ledger reset onto the shared base layer, its buttons quiet by default
kind: work-package
status: ready
milestone: null
depends_on: [repo-130]
difficulty: standard
---

# lg-73 — The ledger reset onto the shared base layer

## Why

The owner chose on 2026-10-25 to reset every tool onto one shared look before
deciding what needs to differ. The decision and the baseline are on
[repo-130](../../../../docs/work/repo-130-one-card-and-one-stack-in-the-shared-ui.md),
which builds `@webtools/ui/base.css` and moves the planner first. This ticket is
the ledger's move, in a pull request of its own so its changelog line names one
tool.

The ledger is the second tool to move because its structure is closest after
the planner's: it styles elements, and its card and stack are where the base's
come from. The one change that needs judgement is its buttons. A plain ledger
`button` is the accent-coloured main action, and the quiet one is
`.secondary`. The base makes the plain one quiet and marks the main one
`.primary`, the convention of the other two tools. At `origin/main@01e80b71`
the ledger draws 80 `<button>` elements. 30 carry `secondary`, and 50 do not.
Of those 50, 12 are the screen tabs, which have a rule of their own, so about
38 are accent-coloured today because nobody marked them.

## Build

1. Import `@webtools/ui/base.css` in `web/src/main.tsx`, after the tokens and
   before `styles.css`.
2. Delete what the base now owns from `styles.css`:
   - `body`, `button`, `button:disabled`, `button.secondary`;
   - `input, select`, `textarea`, `input[type="radio"]` and
     `label.check input`'s size;
   - `.card` and `.card h2`, with lg-70's `.card > h3:first-child`;
   - `main, .stack` and `.stack > h2`, `.shell` and its `48rem` padding, and
     `.muted`.

   Keep what is the ledger's own: `.small`, `.tabs`, `.range`, `label.check`'s
   row, `.figures`, `.rows`, the charts, and every screen-specific block.

3. **Buttons, one at a time.** Remove `secondary` everywhere, since quiet is now
   the default. Read each of the roughly 38 unmarked buttons and mark it
   `primary` only if it is the action its card exists for (Preview, Confirm and
   store, Save, Add member, Create household, Close the period). **At most one
   `primary` per card.** A Remove or a Cancel is never primary. The pressed tab
   and the pressed range button keep their own accent rule. Write the list of
   buttons marked `primary` into the Log, by screen.
4. `main` takes `className="stack"` (`App.tsx` has three shells), and Admin's
   section keeps the `stack` it got in lg-70, now the shared one.
5. Fields move from `--bg` to `--surface-2`, the well colour. Check both themes
   in the screenshots.
6. Run `e2e/layout.spec.ts` before and after, and **open both sets of
   screenshots**. Every difference is a row of repo-130's table or a finding.
   lg-70's cards-apart and gridline checks stay, and must still pass.

**Seam with lg-72** (the shared header and footer, filed in #666). It touches
the same `main.tsx`, `App.tsx` and `styles.css`. Land the two one after the
other, in either order. The ledger's accent-coloured `h1` is lg-72's question,
not this ticket's: after it, the shared header draws the only `h1`.

## Done when

1. `styles.css` declares none of the base's selectors. repo-130's test, extended
   to the ledger, says so.
2. No ledger source carries `secondary`, and each card has at most one
   `primary`. The Log lists them.
3. `e2e/layout.spec.ts` passes at 360 px and 1280 px. The before and after
   screenshots are compared in the Log, screen by screen.
4. `npm run check` and `npm test -- --project ledger` pass.

## Log
