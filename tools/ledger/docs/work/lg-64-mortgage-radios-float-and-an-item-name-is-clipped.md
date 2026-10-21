---
id: lg-64
tool: ledger
title: Two layout defects — the mortgage radios float away from their labels, and an item's name field clips its entry
kind: fix
status: ready
milestone: null
depends_on: [repo-109]
difficulty: standard
---

# lg-64 — Two layout defects in the ledger's web UI

## Why

Both defects were seen in screenshots taken by repo-109's new
`tools/ledger/e2e/layout.spec.ts`. That spec is on the unmerged branch
`repo-109-screens-fit-a-phone` (draft pull request #592), not on `main`. Neither
defect overflows the page, so the spec's width check passes on both: it reads
`scrollWidth` only, and cannot see either one. The three screenshots,
`Household-360.png`, `Receipt-360.png` and `Receipt-1280.png`, are the spec's own
output for those screens at those widths; they are described here because a
screenshot cannot be committed to a ticket.

**Defect 1 — the mortgage radios, Household screen at 360 px and at 1280 px.** Under the
Mortgage card, the "What the household says" group draws its three radio buttons
in the middle of a box about half the row wide, with each label pushed to the
right and wrapping ("The mortgage is / still being paid"). The radio and its words
are far apart, and the eye has to cross the gap to pair them. Builder's reading
from the source on `main`, not measured in a browser: the global rule `input,`
(with `select`) in `tools/ledger/web/src/styles.css` gives every input
`width: 100%`, `min-height: 2.75rem`, padding, border and a background, and a
radio is an input. The `.mortgage-form .choice` rule makes each label a flex row,
so the radio takes the row's width and the text is squeezed beside it. The
stylesheet already narrows that same global rule for checkboxes — `label.check
input` sets `width: 1.25rem` — and there is no counterpart for a radio. The gate measured the defect at 1280 px too:
the radios are 375, 398 and 413 px wide in a 542 px fieldset and "The mortgage is
still being paid" wraps to two lines.

**Defect 2 — the receipt's item name, Receipt screen at 1280 px and at 360 px.**
In the Items box, the first field of an item row, the name ("Text of …" in its
label), shows the start of the entry and cuts the rest off: "Organic rolle" at
1280 px, "Organic rolled o" at 360 px. Read from the screenshots, not measured:
the field is about 96 px wide at 1280 px and about 126 px at 360 px. The brief
that filed this said "about 8 characters"; the screenshots show about 13 at
1280 px and about 16 at 360 px, so that figure undercounts. Builder's reading
from the source: `.items .item > input` sets `flex: 1 1 6rem; min-width: 0`.
The flex basis of 6rem (96 px at the default root size) is the width the row
starts from, and it applies to every input in an item row — the name, the price
and the deposit alike. The name is the one that clips because its entry is long.
At 360 px the field is wider than the basis, which fits a row that has free
space after wrapping and grows its fields to fill it; that is the mechanism the
selectors give, not something observed in a browser.

**Seams.**

- **lg-63 changes mortgage UI.** It is in flight in another session (branch
  `lg-63-mortgage-split-modes`, open pull request #594). Its new mortgage-split
  form adds a second radio group, built from `choice` labels under a `rule-form`
  in the salaries screen, not under `.mortgage-form`. A fix scoped to
  `.mortgage-form .choice` will not reach that group, and the global `input,`
  rule still will. The result is not the same float: measured on lg-63's tip,
  the labels are `display: inline` (nothing outside `.mortgage-form` makes
  `.choice` a flex row), so each radio is a full-row box (262 px of 290 at 360 px,
  510 of 538 at 1280 px) with its text on the line below, at both widths. A
  radio-only rule, `input[type="radio"] { width: 1.25rem; min-height: 1.25rem }`,
  leaves the three labels running together on one line; adding
  `label.choice { display: flex; align-items: center; gap: .5rem }` stacks them
  with each radio beside its label. So that group also needs `.choice` out of
  `.mortgage-form`'s scope. Per tools-cc, lg-63's session, 2026-10-21, #594 will
  merge with its `MortgageSplit` radios unchanged and makes no CSS change, so
  lg-64's fix covers both radio groups: lg-55's `.mortgage-form .choice` in
  `MortgageSetting.tsx`, and lg-63's `<label className="choice">` under
  `.rule-form` in `web/src/salaries/MortgageSplit.tsx`. lg-63 may already be on
  `main` when lg-64 is built.
- **repo-109's `layout.spec.ts` reaches both screens and can carry the
  assertions.** Its tab list opens Household, and its Receipt test fills an item's
  name ("Organic rolled oats, the large two-kilogram bag") and price at both
  widths, then takes the screenshot. The spec needs repo-109 to merge before its
  assertions exist on `main`, which is why this ticket depends on repo-109. Run
  the ledger's e2e suite with `npm run e2e:ledger`; its gate runs in
  `.github/workflows/ledger.yml`, so a local green run is not the proof.

## Build

1. Put a failing assertion for each defect into `tools/ledger/e2e/layout.spec.ts`:
   defect 1 in the Household test at 360 px and at 1280 px; defect 2 in the Receipt test at 360 px
   and at 1280 px. Each must fail on `main`'s stylesheet before any fix. Their
   shape is the builder's choice, within the Done-when lines below.
2. Fix defect 1 in `tools/ledger/web/src/styles.css`: each radio is sized as a
   radio and sits beside its own label at 360 px. The global `input, select` rule
   must keep covering every text, date and select field; if you narrow it for
   radios, follow the `label.check input` precedent rather than removing the rule.
   Check the result against lg-63's radio group if that has landed.
3. Fix defect 2 in the same file: the item's name field is wide enough for its
   entry's first words at both widths. The price and deposit fields keep the size
   they need, and every control in the item row stays reachable at 360 px.
4. Look at the new screenshots for Household and Receipt at both widths, not only
   the assertions over them: the spec's own comment asks for that.

## Done when

1. In `layout.spec.ts`'s Household test at 360 px and at 1280 px, each mortgage
   radio's rendered box is no wider than its own height, and its label starts
   beside it, not across the row. The same holds for each radio of lg-63's
   mortgage-split group on the Salaries screen (`web/src/salaries/MortgageSplit.tsx`),
   once lg-63 is on `main`. The assertion fails on `main`'s `styles.css` and passes
   after the fix.
2. In `layout.spec.ts`'s Receipt test at 360 px and at 1280 px, the name field of
   the filled item is at least as wide as the text "Organic rolled oats" set in the
   field's own font, measured in the browser. It fails on `main`'s `styles.css` and
   passes after the fix.
3. The same Receipt test at both widths finds the item's price field showing
   "12.99" in full, measured as Done when 2 measures: the text "12.99" set in the
   field's own font is no wider than the field's content box, in the browser. It
   also finds the item's shared, taxable and remove controls inside the page
   width.
4. `npm run check` exits 0, and `npm run e2e:ledger` passes in CI's ledger workflow
   with the assertions in lines 1 to 3 green; the Household and Receipt screenshots
   at both widths are looked at, and the Log names what each one showed.

## Log

- 2026-10-21: filed from the owner's choice of 2026-10-21 to file one ticket for
  the two defects, seen in repo-109's screenshots (branch
  `repo-109-screens-fit-a-phone`, draft pull request #592). The reproduction is
  the selectors on `main` at `2d1b22bb`, read with
  `grep -n -E "^input,|^\.mortgage-form \.choice|^\.items \.item > input|^label\.check input" tools/ledger/web/src/styles.css`,
  which returns `228:input,`, `289:.mortgage-form .choice {`,
  `445:label.check input {` and `741:.items .item > input {`. The radio group
  uses `className="choice"` in `tools/ledger/web/src/household/MortgageSetting.tsx`.
  No browser run was made for this filing; the widths and the wrapping are read
  from the three screenshots.
- 2026-10-21: the brief's "about 8 characters" does not match the screenshots: the
  name field shows about 13 characters of its entry at 1280 px and about 16 at
  360 px. The ticket records the screenshot figures.
- 2026-10-21: WITHDRAWN — do not cite this entry. The filing's earlier Log entry,
  that the Items box in `Receipt-360.png` was blank below the name and price
  with no deposit, taxable, shared, whose or remove controls, is withdrawn by
  owner choice, and the matching Why paragraph, Build step and Done-when clause
  are removed. It came from one bad local screenshot (sha 0deb86dc). CI's
  `ledger-layout-shots` artifact and two gates' runs show every control.
- 2026-10-21: `depends_on` names repo-109 because the assertions live in its spec;
  the fix itself does not need it. `difficulty` is `standard`: the cause is in one
  stylesheet, but the item-row layout at two widths is a judgement about what
  wraps where.
- 2026-10-21: the gate's full report for this filing is on pull request #595:
  https://github.com/brunolabbe/tools/pull/595#issuecomment-6305770204. The ticket
  stays `ready`; no `## Review` is committed.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, the lg-63 seam understates the symptom — "Direction for the ticket: say the lg-63 group also needs `.choice` out of `.mortgage-form`'s scope." The Seams bullet now states the measured layout and that.
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "so that group would show defect 1"` → 0 (was 1);
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "group also needs"` → 1.
- 2026-10-21 — Added to that fix at the coordinator's relay, not an owner decision: per tools-cc, lg-63's session, 2026-10-21, #594 will merge with its `MortgageSplit` radios unchanged and no CSS change (the coordinator read #594 as `OPEN` with `gh pr view 594 --json state`). The Seams bullet now says lg-64's fix covers both radio groups and that lg-63 may already be on `main`; Done when 1 names the Salaries group, once lg-63 is on `main`.
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "MortgageSplit"` → 3.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, "draft pull request #594" is false. `gh pr view 594 --json isDraft,state` → `{"isDraft":false,"state":"OPEN"}`; the Seams bullet now says "open pull request #594".
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "open pull request #594"` → 1. The remaining "draft pull request" above the Log is #592, which is a draft.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, defect 1 is also there at 1280 px. The Defect 1 heading, Build step 1 and Done when 1 now say 360 px and 1280 px, and the Defect 1 text gives the gate's 1280 px measurement.
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "360 px and at 1280 px"` → 4 (those three, plus Done when 2's Receipt line, which already said it).
- 2026-10-21 — Fixed at landing by owner choice: gate 1, Done when 1's "no wider than the radio it draws" has no DOM referent — direction: "the box's width against its own height". Done when 1 now says "no wider than its own height".
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "no wider than the radio it draws"` → 0 (was 1);
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "its own height"` → 1.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, Done when 3's natural measure is false on `main` — direction: "measure the text in the field's font, as Done when 2 does". Done when 3 now says the text "12.99" set in the field's own font is no wider than the field's content box, in the browser.
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "no wider than the field's content box"` → 1.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, Done when 4's "are looked at" cannot be checked by someone else — direction: "the Log names what each screenshot showed". Done when 4 now ends "and the Log names what each one showed".
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "Log names what each one showed"` → 1.
- 2026-10-21 — Fixed at landing by owner choice: gate 1, the Log lists the reproduction grep's output out of order. The first Log entry now lists `228`, `289`, `445`, `741`, the order `grep -n` prints them.
  `grep -n -E "^input,|^\.mortgage-form \.choice|^\.items \.item > input|^label\.check input" tools/ledger/web/src/styles.css` → `228:input,`, `289:.mortgage-form .choice {`, `445:label.check input {`, `741:.items .item > input {`.
- 2026-10-21 — Removed at landing by owner choice: the gate's "to remove at the landing" text about the blank Items box (the Why paragraph, Build step 4 and the tail of Done when 4); the Log's own entry about it is replaced by the dated WITHDRAWN entry above rather than deleted.
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c -i "blank"` → 0 (was 3).
