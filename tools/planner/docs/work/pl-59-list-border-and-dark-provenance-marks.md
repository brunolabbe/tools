---
id: pl-59
tool: planner
title: Draw the plans-list border that names a colour nobody defines, and make the provenance marks readable in dark
kind: fix
status: done
milestone: null
depends_on: [repo-108]
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

**The sibling: repo-108**, PR #578, branch `repo-108-share-design-tokens`. It
moves the names planner shares into a new `packages/ui/src/tokens.css`, which
holds no colour value, and defines planner's `--ok` and `--warn` in both themes
in planner's own `styles.css`, at exactly the fallback values above, in dark as
well. So it does not fix defect 2: the dark pair still fails, now behind a
defined name instead of a fallback. **This ticket depends on repo-108** (the
owner's instruction of 2026-10-20), so the Build below describes the state after
it merges; neither defect is repo-108's to fix.

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
   `--danger` (`#e8836a`, formerly `--bad`), because telling them apart is the marks' only job. Measured
   candidates, so the choice starts from a number (`candidates.mts`; ratios on
   `--surface` / `--bg` / `--warn-bg`):

   | Candidate | For      | `--surface` | `--bg` | `--warn-bg` |
   | --------- | -------- | ----------: | -----: | ----------: |
   | `#6fbf94` | `--ok`   |        7.65 |   8.31 |        7.02 |
   | `#5fae85` | `--ok`   |        6.31 |   6.85 |        5.79 |
   | `#d4b155` | `--warn` |        8.18 |   8.88 |        7.51 |
   | `#c9a64a` | `--warn` |        7.24 |   7.85 |        6.64 |

   Where they go: after repo-108, `--ok` and `--warn` are defined in both themes in
   planner's own `tools/planner/web/src/styles.css` (its `:root` and its dark
   override), and only the two dark lines change. `packages/ui/src/tokens.css` is
   not edited: it holds names and no colour value, and repo-108's test asserts
   that. Read `--bad` as `--danger`, which is what repo-108 renames it to.

3. **A test that would have caught both.** `tools/planner/web/test/` runs under
   jsdom, which draws no CSS, so neither defect could fail a test today. Add one
   spec that reads the stylesheet text (and the shared tokens
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

## Review

**Gate: PASS** — 2026-10-21 · `2d1b22bb..1d4f1537` · Opus 5.5, depth standard

| Done when                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `.plans li` reads `var(--border)`, no `var(--line)` remains                                 | **verified** — `grep -rn "var(--line" tools/planner/web/src` printed nothing, exit 1; the `.plans li` rule in `web/src/styles.css` reads `border-bottom: 1px solid var(--border);`. A returning undefined `var(--line)` also fails `web/test/stylesheet.test.ts` › "a var() with no fallback names a custom property someone declares" (red on the base, row 3)                                                                                                                                                                                                                                            |
| 2. Both marks ≥ 4.5:1 on `--surface` and `--bg`, dark and light, ratios named                  | **proven** — `web/test/stylesheet.test.ts` › "dark --ok on --surface clears 4.5:1" and the seven siblings (`{light,dark} × {--ok,--warn} × {--surface,--bg}`), each `toBeGreaterThanOrEqual(4.5)` on colours read out of the stylesheet. Ratios named in the Log; recomputed by a second script (WCAG 0.03928 threshold): dark `--ok` `#6fc77a` 8.11 / 8.80, dark `--warn` `#d4b155` 8.18 / 8.88, light `--ok` 5.99 / 5.74, light `--warn` 4.90 / 4.69, all equal to the Log. That `.provenance.grounded .mark` / `.asserted .mark` read `--ok` / `--warn` is checked by reading, not asserted (low below) |
| 3. Spec red on `origin/main`'s stylesheet for `--line` and dark contrast; both states recorded | **verified** — reproduced: the head's spec over `2d1b22bb`'s `styles.css` fails 5 of 16: `expected [ '--line' ] to deeply equal []` and the four dark checks at 2.81, 3.05, 3.43, 3.73; restored to the head, 16 of 16. Both states are in the Log                                                                                                                                                                                                                                                                                                                                                         |
| 4. `npm run check` and `npx vitest run tools/planner/web/test` pass                            | **verified** — `npm run check` exit 0; `npx vitest run tools/planner/web/test` 127 of 127, 7 files. PR #591's CI is green on `1d4f1537`, every check, `e2e`, `docker` and the Windows leg included                                                                                                                                                                                                                                                                                                                                                                                                         |

- **low** · `nfr:maintainability` · no `Done when` line depends on it · `web/test/stylesheet.test.ts` › "the two marks stay apart from each other and from the accent and the danger colour" asserts only that the four hex strings are unequal (`new Set(colours).size`). Its title claims distinguishability, and the falsehood runs in the unsafe direction: `--ok: #7fbfa9` beside `--accent: #7fbfa8` passes. No live case: the head's dark `--ok` sits 30.6 ΔE76 and 31° of hue from the accent. Direction, not a remedy: a minimum colour distance in the assertion.
- **low** · no `Done when` line depends on it · the contrast tests read the `--ok` / `--warn` tokens, not the mark rules. If `.provenance.grounded .mark` were recoloured with a literal or with another token, Done when 2's subject would break with the spec still green. At the head both rules read `var(--ok)` / `var(--warn)` (read, above). Direction: one assertion that each mark rule's `color` is that token.
- **low** · check (a) is narrower than CSS, one bullet for three mechanisms, each planted and green at 16 of 16: an upper-case `VAR(--nonexistent)` (CSS function names are case-insensitive, the regex is not); a name defined only in a rule that never reaches the consumer (`.nothing-matches-this { --only-here: red; }`) counts as defined; and `packages/ui/src/tokens.css`'s own two no-fallback uses (`var(--bg)`, `var(--text)`) are never scanned, since `undefinedVars` scans only `styles.css`, against Build step 3(a)'s "in those files". No live case for any of them: neither file uses upper case, and both tokens uses are planner roles that `packages/ui/test/tokens.test.ts` requires in both themes.
- **low** · `themeValues` reads the first bare `:root` block and the first `@media (prefers-color-scheme: dark) { :root` block only. A later `:root { --ok: #9fd0b0; }` that wins the cascade passes 16 of 16, and so does a `[data-theme="dark"]` block. No live case: planner has one block per theme and no `data-theme` anywhere in `web/src` or `index.html`.
- **dropped** · the stated gap that check (a) misses a dark-only missing definition. It is not a defect. A name missing only in dark is not undefined in CSS (the light `:root` value cascades), so check (a) is right to pass it. A missing dark canonical role fails `packages/ui/test/tokens.test.ts` › "every stylesheet sets every canonical colour role, in light and in dark": I removed the dark `--ok` (4 of 42 fail, that test included) and the dark `--border` (1 of 42, that test). No `Done when` line depends on it.
- **dropped** · `--ok` is not one of the brief's candidates. Build step 2 offers the candidates "so the choice starts from a number" and does not bind the builder to them. It does say "distinguishable … from `--accent`": the candidates `#6fbf94` and `#5fae85` sit 12.6 and 14.0 ΔE76 (11° and 10°) from dark `--accent` `#7fbfa8`, and `#6fc77a` sits 30.6 (31°). The choice follows the brief's words more closely than either candidate does.
- **findings** · the hunt returned 6; 4 carried (all low), 2 dropped.
- NFR: security n/a (stylesheet and a text-reading spec) · performance n/a (the spec runs in about 13 ms) · reliability ✓ (positive controls fail as they should) · maintainability, the lows above.

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
- **2026-10-20 — gate 1 (narrow, `ticket-reviewer-opus`).** Its full report is on
  the thread of PR #582, not spliced here: this pull request files the ticket and
  leaves it `ready`, so it carries no `## Review` and no `--land`
  (`reference/records.md`). Its one **med** finding is the entry below; its one
  **low** is moot, see the entry after.
- **2026-10-20 — Fixed at landing by owner choice: gate 1, med —** "no `Done when`
  line depends on it · `nfr:maintainability` — Build step 2 tells the builder how
  to proceed once repo-108 has merged, and that part is wrong. It says the tokens
  'are defined in both themes in the shared tokens file' and that the builder
  should check other tools 'before editing them there'. The sibling paragraph adds
  that 'the stylesheet that defines the tokens will have moved'. At repo-108's tip
  neither is true: the shared tokens file holds names and no colour value, and
  planner's `--ok`/`--warn` values stay in `tools/planner/web/src/styles.css`'s
  own `:root` and its dark override. Repo-108 also renames `--bad` to `--danger`."
  Applied as the gate's suggested fix states it: after repo-108 only the two dark
  lines in planner's own stylesheet change, the shared tokens file is not edited,
  `--bad` reads as `--danger`, and the parenthetical is dropped. The Why paragraph
  that said repo-108 "defines" the pair, with the tokens file as the only file
  named, now says where. Proof, scoped above `## Log`:
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "will have moved"` → 0,
  the same with `"shared tokens file"` → 0, and the same with `-e "--danger"` → 2.
- **2026-10-20 — Added at landing by the owner's instruction, not a gate fix:
  `depends_on: [repo-108]`.** The owner chose "F1 + depends_on repo-108" over "F1
  only" and "land as gated". That makes the gate's **low** moot (built before
  repo-108 merges, Build step 2 would add the same `--ok`/`--warn` lines in the
  same block as repo-108, so the second to merge conflicts; a merge-order cost,
  not a defect). With the dependency in place the Build describes only the state
  after repo-108 and carries no "if built before" branch. repo-108 is cited as
  prose: PR #578, branch `repo-108-share-design-tokens`. No re-gate. The gate's
  section is untouched.
- **2026-10-20 — built** (branch `pl-59-list-border-dark-marks`, from `93bfa1f1`,
  which carries repo-108). Three numbers:
  - **Border: option 1.** `.plans li` now reads `border-bottom: 1px solid var(--border);`,
    every row including the last. `grep -rn "var(--line" tools/planner/web/src`
    prints nothing (exit 1).
  - **Dark values:** `--ok: #6fc77a`, `--warn: #d4b155`, only the two dark lines
    in `tools/planner/web/src/styles.css`; `packages/ui/src/tokens.css` is not
    edited. `--ok` is **not** one of the brief's candidates: `#6fbf94` and
    `#5fae85` sit 11 and 10 degrees of hue from the dark `--accent` (`#7fbfa8`),
    which is close enough that a "Sourced" mark and a link read as one colour,
    and the brief asks that they stay apart. `#6fc77a` is 31 degrees away. `--warn`
    is the brief's `#d4b155` (115 degrees from the accent, 32 from `--danger`).
  - **Ratios** (WCAG 2.x, the spec's own formula; `--surface` / `--bg` /
    `--warn-bg`): dark `--ok` 8.11 / 8.80 / 7.44, dark `--warn` 8.18 / 8.88 / 7.51.
    Light, unchanged and still passing: `--ok` 5.99 / 5.74, `--warn` 4.90 / 4.69
    (on `--surface` / `--bg`).
- **Red/green, both states recorded.** The new spec is
  `tools/planner/web/test/stylesheet.test.ts`. Against the stylesheet as it stood
  at `93bfa1f1` (spec added, source untouched),
  `npx vitest run tools/planner/web/test/stylesheet.test.ts` failed **6 of 16**:
  five on the stylesheet and a sixth that was a bug in the spec's own synthetic
  fixture (a `#fff` the colour parser refuses), fixed before the green. The five:
  - `a var() with no fallback names a custom property someone declares`:
    `expected [ '--line' ] to deeply equal []`;
  - dark `--ok` on `--surface` 2.81, on `--bg` 3.05; dark `--warn` on `--surface`
    3.43, on `--bg` 3.73 (each `expected … to be greater than or equal to 4.5`),
    which are the filing's four dark numbers to the second decimal.

  After the edit, `npx vitest run tools/planner/web/test/stylesheet.test.ts packages/ui`:
  2 files, 42 of 42 passed (the second is repo-108's `tokens.test.ts`, run to
  prove the new dark values break none of its checks).

- **Folded in:** the comment above planner's light `:root` said dark values "are
  a visible change and a ticket of their own"; this is that ticket, so the
  sentence now says what happened and points at the spec.
- **Not folded in: the `var(--ok, #2f6f4f)` / `var(--warn, #8a6d1f)` fallbacks** on
  the `.provenance` rules. Both names are defined in both themes now, so the
  fallbacks are dead code, and build step 3(a) skips a `var()` that carries a
  fallback, so they would hide a future missing definition from the spec. Dropping
  them is a choice the brief does not make; it is stated as an open decision in
  the report, not settled here.
- **What the brief had wrong.** Its line number for `var(--line)` is 387 at
  `93bfa1f1`, not 386 (the earlier base). And the worktree farm does not link
  `packages/ui`, so `npm run build` failed on
  `Rollup failed to resolve import "@webtools/ui/tokens.css"` until
  `ln -s ../../packages/ui node_modules/@webtools/ui` was done by hand (the farm
  links only what the shared checkout has).
- **Not measured.** Rendered pixels (no browser), forced-colors mode, and whether
  `#6fc77a` and `#d4b155` look distinguishable to a reader with colour-vision
  deficiency; the hue figures above are HSV degrees computed from the hex values,
  not a perceptual metric.
- **2026-10-21 — the fallbacks dropped, on the owner's answer.** The builder's
  open decision was whether to drop `var(--ok, #2f6f4f)` and
  `var(--warn, #8a6d1f)` on the `.provenance` marks (dead since repo-108, and
  skipped by build step 3(a)). Options as asked: (1) drop both in this PR
  (recommended); (2) keep them and widen the spec so a name used with a fallback
  must be defined; (3) leave both. **The owner chose (1)**, on 2026-10-21,
  relayed by the orchestrator. This supersedes the "Not folded in" entry above.
  Commit `f94a64ef`: the two rules read `var(--ok)` and `var(--warn)`, and the
  comment above the light `:root` no longer says the fallbacks are in use.
  - **Check (a) now reaches those two uses.** Renaming `--ok`'s definition to
    `--okx` in both the light and the dark block and running
    `npx vitest run tools/planner/web/test/stylesheet.test.ts`: at `f94a64ef`,
    **6 of 16 fail**, among them `a var() with no fallback names a custom property
someone declares` (`expected [ '--ok' ] to deeply equal []`). The same rename on
    the previous commit's stylesheet (`4c27d4db`, fallbacks present) fails **5 of
    16** and that check is **not** among them: it was blind to the fallback use,
    the contrast checks alone caught it. Both mutations were restored with
    `git checkout f94a64ef -- tools/planner/web/src/styles.css`; the spec is 16 of
    16 again and the tree clean.
  - **A limit of check (a), not fixed here:** it asks that a name be defined
    _somewhere_, so renaming only the dark `--ok` (light still defined) does not
    fail (a); the dark contrast checks fail instead (3 of 16, `dark --ok is
undefined, not a #rrggbb colour`). A missing dark definition is therefore
    held by the contrast tests, for `--ok` and `--warn` only.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, low "no `Done when` line
  depends on it" — "the contrast tests read the `--ok` / `--warn` tokens, not the
  mark rules. [...] Direction: one assertion that each mark rule's `color` is that
  token." `stylesheet.test.ts` gains "each mark rule is coloured by the token the
  contrast tests measure". Planted `.provenance.grounded .mark { color: #2f6f4f; }`
  → 1 failed | 19 passed, `expected '#2f6f4f' to be 'var(--ok)'`; planted
  `.provenance.asserted .mark { color: var(--accent); }` → 1 failed | 19 passed,
  `expected 'var(--accent)' to be 'var(--warn)'`; both restored with
  `git checkout 1d4f1537 -- tools/planner/web/src/styles.css` → 20 passed (20).
- 2026-10-21 — Fixed at landing by owner choice: gate 1, low "check (a) is
  narrower than CSS", the first and third mechanisms only — "an upper-case
  `VAR(--nonexistent)` (CSS function names are case-insensitive, the regex is
  not)" and "`packages/ui/src/tokens.css`'s own two no-fallback uses (`var(--bg)`,
  `var(--text)`) are never scanned". `varsWithoutFallback` now matches `var(`
  with the `i` flag, and a new test scans `undefinedVars(tokens, styles)`. Planted
  `.zz { color: VAR(--nonexistent); }` in `styles.css` → 1 failed | 19 passed
  (`expected [ '--nonexistent' ] to deeply equal []`); the same plant with the `i`
  flag removed leaves the real-stylesheet test green (only the synthetic case
  fails), which is the gap. Planted `.zz { color: var(--zz-nope); }` in
  `packages/ui/src/tokens.css` → 1 failed | 19 passed (`expected [ '--zz-nope' ]
to deeply equal []`); restored with `git checkout 1d4f1537 -- <path>`. The
  second mechanism (a name defined only in a rule that never reaches the
  consumer) is not fully stated and stays recorded as the gate wrote it.
  `npx vitest run tools/planner/web/test/stylesheet.test.ts` → 20 passed (20);
  `npx vitest run tools/planner/web/test` → 7 files, 131 passed (131).
