---
id: pl-59
tool: planner
title: Draw the plans-list border that names a colour nobody defines, and make the provenance marks readable in dark
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# pl-59 — The plans-list border and the provenance marks in dark

**Packages:** `web` only (`tools/planner/web`). No contract change. Two defects in
`tools/planner/web/src/styles.css`, both found by the repo-108 builder, both older
than repo-108: they arrived with pl-10 (commit `6291ee58`, PR #44, 2026-08-16),
which wrote the `.plans li` rule and the `.provenance .mark` colours.

## Why

**1. A border that never renders.** The `.plans li` rule declares
`border-bottom: 1px solid var(--line);`. `--line` has no fallback there and no
stylesheet defines it, so the declaration is invalid at computed-value time and
the border never draws. Reproduced on `origin/main` at `00977771`:

```
$ grep -n "var(--line" tools/planner/web/src/*.css
386:  border-bottom: 1px solid var(--line);
$ grep -rn -- "--line\s*:" tools/planner/web/src packages/
(no output; exit 1)
```

`Plans.tsx` is the only consumer (`<ul className="plans">`), so the list of kept
plans has been drawn without row separators since pl-10. Nothing fails: a
`var()` that resolves to nothing is silent in CSS, in jsdom and in every test
this tool has.

**2. The provenance marks fail contrast in the dark theme.** The two marks that
tell a reader a line was read at a source from a line the model asserted are
coloured `color: var(--ok, #2f6f4f)` (`.provenance.grounded .mark`, the "Sourced"
label) and `color: var(--warn, #8a6d1f)` (`.provenance.asserted .mark`, the
"Unverified" label). Neither `--ok` nor `--warn` is defined on `origin/main`, so
both always take the fallback, and the dark override block in `:root` has no
value for either. Both colours were chosen for a light page and are drawn on a
dark one unchanged.

Every mark is rendered inside `section.panel.plan` (`ProvenanceNote` is used by
`Item`, `TravelSources` and `RouteReading`, all inside it), whose background is
`--surface`. `--bg` is the page behind it; `--warn-bg` is the `.panel.warn`
background, which no mark sits in. The marks are 0.7rem bold uppercase, which is
not WCAG "large text", so the bar is 4.5:1. Measured with
`contrast.mts` (WCAG 2.x relative luminance; it reads the colours out of the
stylesheet, so the numbers follow the file), `origin/main` at `00977771`:

| Theme | Background  |     Value | `--ok` `#2f6f4f` | `--warn` `#8a6d1f` |
| ----- | ----------- | --------: | ---------------: | -----------------: |
| light | `--surface` | `#ffffff` |      5.99 (pass) |        4.90 (pass) |
| light | `--bg`      | `#fbfaf8` |      5.74 (pass) |        4.69 (pass) |
| light | `--warn-bg` | `#fdf5e6` |      5.53 (pass) |        4.52 (pass) |
| dark  | `--surface` | `#201d16` |  **2.81 (FAIL)** |    **3.43 (FAIL)** |
| dark  | `--bg`      | `#17150f` |  **3.05 (FAIL)** |    **3.73 (FAIL)** |
| dark  | `--warn-bg` | `#2a2415` |  **2.58 (FAIL)** |    **3.15 (FAIL)** |

Light is the control: all six clear 4.5:1, the tightest at 4.52. Dark fails on
all six, on the one that matters (`--surface`) at 2.81 and 3.43. Defect 2 is real.
The stylesheet's own comment says the marks exist so that a reader can tell a
verified line from the model talking at a glance (analysis §5); in dark both sit
below the bar.

**The sibling, unmerged: repo-108**, PR #578, branch `repo-108-share-design-tokens`.
It moves planner's shared tokens into a new `packages/ui/src/tokens.css` and
defines planner's `--ok` and `--warn` in both themes, at exactly the fallback
values above, in dark as well. So it does not fix defect 2: the dark pair still
fails, now behind a defined name instead of a fallback. **Read this ticket's Build
after repo-108 merges** (the stylesheet that defines the tokens will have moved);
there is no `depends_on`, because the ticket is valid on `main` either way and
neither defect is repo-108's to fix.

## Build

1. **The border.** In the `.plans li` rule, replace `var(--line)` with
   `var(--border)`: `border-bottom: 1px solid var(--border);`. No `var(--line)` may
   remain. The `:last-child` exclusion was named as a separate choice and the owner
   did not take it, so every row, the last included, keeps the hairline; do not add
   one.
2. **The marks in dark.** Give `--ok` and `--warn` their own dark values, so the
   dark theme stops reusing a light-page colour. Pick colours that clear 4.5:1
   against `--surface` and `--bg` in dark (`--warn-bg` is not a background any mark
   sits on, so it is not required, but clearing it too costs nothing). Keep the two
   distinguishable from each other and from `--accent` (`#7fbfa8` in dark) and
   `--bad` (`#e8836a`), because telling them apart is the marks' only job. Measured
   candidates, so the choice starts from a number (`candidates.mts`; ratios on
   `--surface` / `--bg` / `--warn-bg`):

   | Candidate | For      | `--surface` | `--bg` | `--warn-bg` |
   | --------- | -------- | ----------: | -----: | ----------: |
   | `#6fbf94` | `--ok`   |        7.65 |   8.31 |        7.02 |
   | `#5fae85` | `--ok`   |        6.31 |   6.85 |        5.79 |
   | `#d4b155` | `--warn` |        8.18 |   8.88 |        7.51 |
   | `#c9a64a` | `--warn` |        7.24 |   7.85 |        6.64 |

   Where they go depends on when this is built. Before repo-108 merges, `--ok` and
   `--warn` are defined nowhere, so add them to `:root` (light, at today's
   fallback values) and to the dark override. After it merges, they are defined
   in both themes in the shared tokens file, and only the dark values change; check
   whether another tool's stylesheet reads the same names before editing them
   there, because that file is shared and this ticket is not licence to recolour
   another tool's UI.

3. **A test that would have caught both.** `tools/planner/web/test/` runs under
   jsdom, which draws no CSS, so neither defect could fail a test today. Add one
   spec that reads the stylesheet text (and, after repo-108, the shared tokens
   file it imports) and asserts: (a) every `var(--name)` that has no fallback is
   defined as `--name:` somewhere in those files; (b) the dark `--ok` and `--warn`
   clear 4.5:1 against dark `--surface` and `--bg`, and the light pair clears it
   against light `--surface` and `--bg`. Compute luminance in the test; do not add
   a dependency. Check (a) fails on `origin/main` for `--line` before the fix.
4. Append the Log, with the three numbers that matter: the chosen border option,
   the chosen dark values, and the ratios they measure.

## Decision — answered 2026-10-20 by the owner

**The owner chose option 1, draw it with `--border`**, which was this ticket's own
recommendation; no recommendation was overridden. The answer was given in the
orchestrator's session (tools-13), asked as: "pl-59 (#582) … The open question is
the plans-list border, which reads an undefined var(--line) and has never drawn …
Which fix?", with the options _Draw it with --border (Recommended)_, _Delete the
declaration_, _Define a new --line token_ and _Leave it open_. The options as the
filing posed them:

**The border (item 1).** The fix is a visible change to the plans list, so which
fix was not the builder's to choose. Options:

1. **Draw it with `--border`** (recommended, and chosen). `--border` is the role every other
   rule in this file uses for a rule or a box edge, defined in both themes
   (`#e3ddd4` light, `#35301f` dark). The declaration shows the author wanted a
   row separator; this gives them one, with no new name. Costs: the list changes
   on screen (each row gets a hairline, including the last one, which the rule
   also draws; a `:last-child` exclusion is a second, separate choice), and the
   dark hairline is deliberately faint.
2. **Delete the declaration.** The list keeps looking exactly as it has looked
   since pl-10. Costs: nothing visible, and nothing separates the rows, which
   were evidently meant to be separated.
3. **Define a new `--line` token** (a lighter or heavier rule than `--border`).
   Costs: a second role next to `--border` that no other rule uses yet, for a
   difference nobody has asked for.

Item 2 (the dark marks) was not part of this question: it is a defect with a
measured bar, and the Build above fixes it.

## Done when

1. `.plans li` reads `var(--border)` and no `var(--line)` remains:
   `grep -rn "var(--line" tools/planner/web/src` prints nothing.
2. In dark, `.provenance.grounded .mark` and `.provenance.asserted .mark` each
   measure at least 4.5:1 against `--surface` and against `--bg`; in light they
   still do. Proven by the spec in Build step 3, naming the ratios.
3. That spec fails on `origin/main`'s stylesheet for `--line` (a no-fallback
   `var()` with no definition), and the dark-contrast check fails on `origin/main`'s
   dark `--ok` and `--warn` fallbacks: a red/green, both states recorded.
4. `npm run check` and `npx vitest run tools/planner/web/test` pass.

## Log

- **2026-10-20 — filed.** Two defects found by the repo-108 builder (branch
  `repo-108-share-design-tokens`, PR #578), both older than repo-108. **Filed as one
  ticket on the owner's decision of 2026-10-20**, asked as: file both in one pl-59
  (recommended) / file the `--line` defect only / file neither; the owner chose
  **file both in one pl-59**. The ticket is `needs-decision` only for the border's
  fix (item 1), which is a visible change; the dark-contrast fix has a measured bar
  and no open question.
- **2026-10-20 — reproduction, `origin/main` at `00977771`.** Defect 1:

  ```
  $ grep -n "var(--line" tools/planner/web/src/*.css
  386:  border-bottom: 1px solid var(--line);
  $ grep -rn -- "--line\s*:" tools/planner/web/src packages/
  (no output, exit 1)
  ```

  Defect 2, `node contrast.mts tools/planner/web/src/styles.css` (the script and
  `candidates.mts` are in the filing builder's scratch directory,
  `/tmp/claude-1000/-workspaces-tools/9c0cd8ed-02db-419f-9cc6-1e3275126a50/scratchpad/pl-59/build/`):

  ```
  light on --surface  #ffffff  #2f6f4f  5.99:1  PASS (4.5)  Sourced
  light on --surface  #ffffff  #8a6d1f  4.90:1  PASS (4.5)  Unverified
  light on --bg       #fbfaf8  #2f6f4f  5.74:1  PASS (4.5)  Sourced
  light on --bg       #fbfaf8  #8a6d1f  4.69:1  PASS (4.5)  Unverified
  light on --warn-bg  #fdf5e6  #2f6f4f  5.53:1  PASS (4.5)  Sourced
  light on --warn-bg  #fdf5e6  #8a6d1f  4.52:1  PASS (4.5)  Unverified
  dark  on --surface  #201d16  #2f6f4f  2.81:1  FAIL (4.5)  Sourced
  dark  on --surface  #201d16  #8a6d1f  3.43:1  FAIL (4.5)  Unverified
  dark  on --bg       #17150f  #2f6f4f  3.05:1  FAIL (4.5)  Sourced
  dark  on --bg       #17150f  #8a6d1f  3.73:1  FAIL (4.5)  Unverified
  dark  on --warn-bg  #2a2415  #2f6f4f  2.58:1  FAIL (4.5)  Sourced
  dark  on --warn-bg  #2a2415  #8a6d1f  3.15:1  FAIL (4.5)  Unverified
  ```

  Both defects entered with pl-10: `git log --oneline -S"var(--line)" --
tools/planner/web/src/styles.css` prints only `6291ee58`, and the same for the
  `var(--ok, ` and `var(--warn, ` fallbacks.

- **2026-10-20 — what repo-108 does and does not do.** Read from its branch
  (`repo-108-share-design-tokens`, PR #578, draft when this was filed): it defines
  `--ok: #2f6f4f` and `--warn: #8a6d1f` in the light block **and** the dark block,
  so dark still fails 2.81 and 3.43 on `--surface`; it leaves `var(--line)` alone.
  Cited as prose because a file:line into an unmerged branch fails the citations
  checker.
- **Not measured.** Rendered pixels (no browser was run; the ratios are computed
  from the stylesheet's hex values with the WCAG 2.x formula, not read off a
  screenshot), and whether any browser's forced-colors or high-contrast mode
  overrides the marks.
- **2026-10-20 — decision answered, `status` set to `ready`.** The owner chose
  **draw the plans-list border with `--border`** (option 1, the ticket's own
  recommendation) over deleting the declaration, defining a new `--line` token, or
  leaving it open. Asked in the orchestrator's session (tools-13); the question and
  options are under _Decision — answered_. The Build now says to write
  `border-bottom: 1px solid var(--border);` and leaves out the `:last-child`
  exclusion, which was named as a separate choice and not taken. Recorded in this
  commit, which changes no source.
