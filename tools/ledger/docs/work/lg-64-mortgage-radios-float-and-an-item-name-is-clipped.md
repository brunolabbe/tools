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

**Defect 1 — the mortgage radios, Household screen at 360 px.** Under the
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
input` sets `width: 1.25rem` — and there is no counterpart for a radio.

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

**Not explained.** In `Receipt-360.png` the Items box is blank below the name
and price fields, down to its bottom rule. The deposit, taxable, shared, whose and
remove controls that the same row carries at 1280 px do not appear. The selectors
above do not account for that, and it has not been investigated. Explain it before
judging defect 2 fixed from a screenshot.

**Seams.**

- **lg-63 changes mortgage UI.** It is in flight in another session (branch
  `lg-63-mortgage-split-modes`, draft pull request #594). Its new mortgage-split
  form adds a second radio group, built from `choice` labels under a `rule-form`
  in the salaries screen, not under `.mortgage-form`. A fix scoped to
  `.mortgage-form .choice` will not reach that group, and the global `input,`
  rule still will, so that group would show defect 1 once lg-63 lands. Whichever
  of the two lands second checks the other.
- **repo-109's `layout.spec.ts` reaches both screens and can carry the
  assertions.** Its tab list opens Household, and its Receipt test fills an item's
  name ("Organic rolled oats, the large two-kilogram bag") and price at both
  widths, then takes the screenshot. The spec needs repo-109 to merge before its
  assertions exist on `main`, which is why this ticket depends on repo-109. Run
  the ledger's e2e suite with `npm run e2e:ledger`; its gate runs in
  `.github/workflows/ledger.yml`, so a local green run is not the proof.

## Build

1. Put a failing assertion for each defect into `tools/ledger/e2e/layout.spec.ts`:
   defect 1 in the Household test at 360 px; defect 2 in the Receipt test at 360 px
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
4. Explain the blank Items box in `Receipt-360.png` (see Why) before calling
   defect 2 fixed, and record the explanation in the Log.
5. Look at the new screenshots for Household and Receipt at both widths, not only
   the assertions over them: the spec's own comment asks for that.

## Done when

1. In `layout.spec.ts`'s Household test at 360 px, each mortgage radio's rendered
   box is no wider than the radio it draws, and its label starts beside it, not
   across the row. The assertion fails on `main`'s `styles.css` and passes after
   the fix.
2. In `layout.spec.ts`'s Receipt test at 360 px and at 1280 px, the name field of
   the filled item is at least as wide as the text "Organic rolled oats" set in the
   field's own font, measured in the browser. It fails on `main`'s `styles.css` and
   passes after the fix.
3. The same Receipt test at both widths finds the item's price field showing
   "12.99" in full, and its shared, taxable and remove controls inside the page
   width.
4. `npm run check` exits 0, and `npm run e2e:ledger` passes in CI's ledger workflow
   with the assertions in lines 1 to 3 green; the Household and Receipt screenshots
   at both widths are looked at, and the blank Items box is explained in the Log.

## Log

- 2026-10-21: filed from the owner's choice of 2026-10-21 to file one ticket for
  the two defects, seen in repo-109's screenshots (branch
  `repo-109-screens-fit-a-phone`, draft pull request #592). The reproduction is
  the selectors on `main` at `2d1b22bb`, read with
  `grep -n -E "^input,|^\.mortgage-form \.choice|^\.items \.item > input|^label\.check input" tools/ledger/web/src/styles.css`,
  which returns `228:input,`, `289:.mortgage-form .choice {`,
  `741:.items .item > input {` and `445:label.check input {`. The radio group
  uses `className="choice"` in `tools/ledger/web/src/household/MortgageSetting.tsx`.
  No browser run was made for this filing; the widths and the wrapping are read
  from the three screenshots.
- 2026-10-21: the brief's "about 8 characters" does not match the screenshots: the
  name field shows about 13 characters of its entry at 1280 px and about 16 at
  360 px. The ticket records the screenshot figures.
- 2026-10-21: the blank Items box in `Receipt-360.png` (no deposit, taxable,
  shared, whose or remove controls under the name and price) is not explained by
  the selectors and was not investigated.
- 2026-10-21: `depends_on` names repo-109 because the assertions live in its spec;
  the fix itself does not need it. `difficulty` is `standard`: the cause is in one
  stylesheet, but the item-row layout at two widths is a judgement about what
  wraps where.
