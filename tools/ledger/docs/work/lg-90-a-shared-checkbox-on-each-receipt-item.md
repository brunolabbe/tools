---
id: lg-90
tool: ledger
title: A shared checkbox on each receipt item, and a picker for whose it is once unchecked
kind: work-package
status: ready
milestone: null
depends_on: [lg-89]
difficulty: standard
---

# lg-90 — A shared checkbox on each receipt item, and a picker for whose it is once unchecked

## Why

Today a person leaves an item out of the shared amount by tapping a button that
cycles through three states: shared, not shared, someone else's
(`web/src/receipts/Receipts.tsx`, `NEXT_SHARE`). On a phone, with twenty items,
it is hard to scan which items are left out. And reaching "someone else's"
takes two taps through "not shared". The owner asked on 2026-11-01 to be able to
"uncheck some items of the receipt list so these items are not part of the
total to share".

## Decision — answered 2026-11-01 by the owner

Asked through `AskUserQuestion`: a checkbox, or keep the cycling button?
**Chosen: a checkbox plus whose.** Each item gets a `Shared` checkbox, checked
by default. Unchecking it shows a choice of **mine** (`not-shared`, it stays
with whoever paid) or a person (`theirs`, a charge to them). The other option
was to keep the three-way button.

## Build

This is web only. `ItemShare`, `chargedTo` and `splitReceipt` do not change.
The screen maps onto them exactly as the button does today.

1. In `web/src/receipts/Receipts.tsx`, replace the share button with:
   - a checkbox, `aria-label` "`<item>` is shared", checked when `share` is
     `shared`;
   - once it is unchecked, one `select` labelled "Whose is `<item>`". Its first
     option is **Mine** (`not-shared`), followed by each other current member
     (`theirs`, with that `chargedTo`). With one other member, that is two
     options; with several, the select replaces today's separate `several`
     picker.
   - Checking the box again sets `share: "shared"` and `chargedTo: null`.
2. Unchecking defaults the select to **Mine**. A charge to someone is always
   the person's choice, never a default.
3. The live line "Not shared · `<name>` · Shared" stays, computed by
   `splitReceipt` as it is now. Each unchecked item shows what it takes off
   (price, deposit, rebate from lg-89, and taxes, through `sharedAmount` on that
   item alone), so the person can see why the total moved.
4. Leave the joint-row refusal (`fileAs`, "A receipt on a joint-account row is
   shared whole") as it is. lg-91 changes it.
5. Drop `NEXT_SHARE` and `nextShare`. Rewrite the web tests that tap the button
   (`web/test/receipts.test.tsx`, `generated-ids.test.tsx`) to use the checkbox
   and the select. Keep what they assert about the split.
6. Update `e2e/layout.spec.ts`'s receipt case so it unchecks an item and opens
   its select at 360 px, and the page must not scroll sideways.

## Done when

1. A web test unchecks an item and proves the item is `not-shared` and the
   split moves by that item's cost. It then picks a person and proves `theirs`
   with that `chargedTo` reaches `fileReceipt`'s request. Checking the item again
   proves it is back to `shared` with `chargedTo: null`.
2. A web test proves that an unchecked item on a household of two offers Mine
   and the one other person, and on a household of three offers Mine and both
   others.
3. A web test proves each unchecked item shows what it takes off, and the sum
   shown matches the "Not shared" and charge totals for one person's items.
4. `e2e/layout.spec.ts` covers an unchecked item with its select open at 360 px
   and 1280 px, with no horizontal page scroll.
5. `npm run check`, `npm test -- --project ledger` and `npm run e2e:ledger` pass.

## Log

### 2026-11-01, build

Web only, as the brief said: `ItemShare`, `chargedTo` and `splitReceipt` are
untouched. In `web/src/receipts/Receipts.tsx` the share button, `NEXT_SHARE` and
`nextShare` are gone. Each item has a `Shared` checkbox (`aria-label` "`<item>`
is shared"), and an unchecked one a `Whose is <item>` select: **Mine**
(`not-shared`) first, then each other current member (`theirs`). Unchecking
starts on Mine; checking again sets `shared` and `chargedTo: null`. The separate
`several` picker is the same select now. A household of one gets a select with
Mine alone; a read item that is `theirs` in such a household shows a disabled
"Someone else's" option, so the existing "nobody else in the household" refusal
reads on the screen, and picking Mine clears it. Each unchecked item shows
"Takes off `<amount>`", `sharedAmount(proposal, [index]).excludedCents`, and only
while the items make the total (otherwise there is no split to read it against).
`fileAs` and its joint-row refusal are as they were (lg-91).

What the brief had wrong or left open:

- **`web/test/generated-ids.test.tsx` taps no item button.** Its Receipts case
  only reads "File as Alex's line"; the brief's Build 5 names it, and nothing in
  it needed a rewrite. The tests that tapped the button were all in
  `web/test/receipts.test.tsx`.
- **Done when 3's "the sum shown matches the totals" is not always true to the
  cent.** Each item is rounded alone through `sharedAmount`, as Build 3 says,
  and the split rounds one person's items together once. The basket's six-pack
  (15.54 $) and soap (5.74 $) show 21.28 $ apart and the live line says "Not
  shared 21.27 $". The test with the bread and the soap (3.49 $ and 5.74 $)
  sums exactly, and a second test pins the one-cent case. If the owner wants
  the figures on the items to always sum to the line, the items would share the
  person's rounded total between them (largest remainder), which needs new
  code and is not what Build 3 names.
- The e2e household has sam, so the Receipt case's select offers Mine and sam.
  To show "Takes off" at 360 px the case now types a subtotal, taxes and total
  that the one item makes.

Checks, in the worktree at the base `686b213c` plus this change:

```
npx vitest run tools/ledger/web/test/receipts.test.tsx   Tests  44 passed (44)
npm run check                                             exit 0
npm test -- --project ledger                              Test Files  99 passed (99), Tests  2132 passed (2132)
npm run e2e:ledger                                        31 passed (41.6s), exit 0
```

`Receipt-360.png` and `Receipt-1280.png` under `e2e/.artifacts/layout/` were
opened: the item shows the unchecked box, the Mine select, and "Takes off 12.99
$", and nothing runs past the right edge at 360 px.
