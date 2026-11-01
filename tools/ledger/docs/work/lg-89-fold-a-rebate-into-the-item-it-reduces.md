---
id: lg-89
tool: ledger
title: Fold a rebate into the item it reduces, wherever it is printed
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
awaiting: Done when 7 — the owner's paid read of the three rebate fixtures (`read-rebate-fixtures.ts --paid`) after the merge and `npm run build`, its three verdict lines recorded in a dated Log entry
---

# lg-89 — Fold a rebate into the item it reduces, wherever it is printed

## Why

A receipt's rebate (`RABAIS`, `ÉCONOMIE`, a coupon) is read today as an item of
its own with a negative price (`receipts/src/reader.ts`, `RECEIPT_PROMPT`: "A
discount is an item with a negative price"). It is linked to nothing. When a
person leaves an item out of the shared amount (lg-10), its rebate stays
shared unless they find the rebate's line and tap it too, so the shared part
is wrong by the rebate and the taxes on it.

The owner asked on 2026-11-01 for leaving an item out to take off the item's
price, its consigne, its taxes and the rebate applied to it, together. The
consigne already works that way: the reader folds it into the item it follows
(`ReceiptItem.deposit`). This ticket does the same for a rebate. Most rebates
are printed directly under their item, but not all of them, so the reader has
to match a rebate to its item by text or product code, not by position.

## Decision — answered 2026-11-01 by the owner

Asked through `AskUserQuestion`. When an item is left out, how should its
rebate follow?

- **Fold into the item (chosen).** The reader folds a rebate into the item it
  applies to, as it does with consigne, wherever the rebate is printed.
- Auto-follow on screen: rebates stay separate lines, and a negative line under
  an item follows that item's share. Web only, but it guesses the link from the
  order of the lines.
- Leave it manual.

The owner's follow-up: a rebate is seldom printed away from its item, so the
reader should be "somewhat intelligent or flexible" about where it is printed.
**A rebate the reader cannot place stays a negative item of its own**, as today.
It is shared by default and can be left out by hand, so it is never lost.

Taxes (the owner asked): a folded rebate follows its item's `taxable` mark. A
rebate on a taxable item lowers the taxed amount, and the taxes taken off with
the item are computed on its net price.

## Build

This is a change to `@ledger/contract`, approved in this shape. A different
shape is a stop and a question.

1. **`@ledger/contract`** (`contract/src/receipts.ts`). `ReceiptItem` gains
   `discount: number | null`, in cents, `null` when none is folded in. It is
   negative for a rebate on a purchase and has the opposite sign on a returned
   item. `price` stays as printed. The item's **net** is `price + (discount ?? 0)`.
   `receiptItemSchema` takes it as `cents.nullable().default(null)`, so a request
   that omits it parses as before. Update the comment on `price` ("A discount or
   a returned item is negative"): a discount that was folded in is no longer
   an item.
2. **`books/src/receipts.ts`.** Every place that reads an item's `price` for
   money reads its net instead: `itemsAddUp`, `itemsCost` (tax on the net when
   taxable), `taxableFits` (the taxable part is the taxable items' nets),
   `splitReceipt`'s nothing-shared test, and `splitByCategory`. A deposit is
   still untaxed. Add cases to `books/test/receipts.test.ts`, at the end of
   their suites (they are listed under Done when).
3. **`receipts/src/reader.ts`.** Change `RECEIPT_PROMPT` and the tool schema
   the reader asks for:
   - fold each rebate, coupon or price reduction into the item it applies to,
     matching by product code or by text when the rebate is not printed
     directly under its item;
   - several rebates on one item add up into its `discount`;
   - a rebate that applies to the whole receipt, or that cannot be placed with
     confidence, stays an item of its own with a negative price.

   Parse and bound `discount` as `deposit` is parsed. Add reader tests on
   recorded responses: a folded rebate, a rebate printed three lines below its
   item, and a whole-receipt rebate left as its own item.

4. **`api`.** Add a `discount_cents` column to `receipt_items` through a new
   migration in `api/src/db/schema.ts`, nullable, so filings already stored
   read back as `null`. `fileReceipt` stores the column and reads it back, and
   `receiptsOnRows` (`api/src/slices.ts`) passes it through to the split.
5. **`web/src/receipts/Receipts.tsx`.** Each item gets a `Rebate` input beside
   `Deposit`, which a person can correct, with the same parsing. The live split
   and the add-up hint use the net. Add a case to `e2e/layout.spec.ts` only if
   the item row's layout changes at 360 px; the extra input must not make the
   page scroll sideways.
6. **The measurement.** A prompt change is proven by a read, not by a recorded
   response. Build three synthetic receipt images:
   - a rebate directly under its item;
   - a rebate printed below other items, naming its item's product code;
   - a whole-receipt coupon.

   Keep them in `receipts/test/fixtures/` beside the existing ones. Reading them
   with the live model costs money, so it is **the owner's paid read**. Ask for
   it, do not run it. Record the command to run, and where the result goes, in
   the Log.

## Done when

1. `books/test/receipts.test.ts` proves a taxable item with a folded rebate,
   left out, takes off price + discount + deposit + GST and QST on the net. It
   also proves the shared amount plus what was left out still equals what was
   paid, on at least one receipt where the rebate is the only difference between
   the old result and the new one.
2. `itemsAddUp` and `checkReceipt` accept a receipt whose items make its total
   only once their rebates are counted, and `taxable-differs` is computed on
   the nets. Tests prove both.
3. Reader tests on recorded responses prove a rebate printed away from its item
   is folded, and a whole-receipt rebate stays its own item.
4. A filing stored before the migration reads back with `discount: null` and the
   same split as before. An `api` test proves it on a migrated database.
5. On the screen, entering a rebate on an item updates the add-up check and the
   split live. A web test proves it.
6. `npm run check` and `npm test -- --project ledger` pass.
7. The owner's paid read of the three fixtures folds the first two rebates and
   leaves the third as its own item, and the Log records the result.

## Log

### 2026-11-01 — built (builder, Claude Opus 5.5)

Built on `8ad4e91d` as the Build section says, the contract in the approved
shape: `ReceiptItem.discount: number | null`, `cents.nullable().default(null)`
in `receiptItemSchema`, and the net `price + (discount ?? 0)`.

- **`books`.** One `netPrice(item)` in `books/src/receipts.ts`, read by
  `itemsAddUp`, `itemsCost` (so `sharedAmount`, `splitReceipt` and
  `splitByCategory`), `taxableFits`, and `splitReceipt`'s nothing-shared test.
  A deposit stays untaxed. Eight cases at the end of
  `books/test/receipts.test.ts`, under "a rebate folded into its item (lg-89)".
  The receipt where the rebate is the only difference is `BASKET` with 2,00 $
  off the six-pack, read both ways: as a separate `RABAIS` item the six-pack
  left out alone takes 1 554 off (shared 692), folded it takes 1 324 (shared
  922), the 230 between them is the rebate and its taxes, both make the 2 246
  paid, and folding equals tapping the rebate's own line too.
- **`receipts`.** `RECEIPT_PROMPT` drops "A discount is an item with a
  negative price" and asks for each rebate folded into its item, matched by
  product code or text when it is not printed under it, several adding up, and
  a whole-receipt or unplaceable rebate left an item of its own. The schema
  asks for `discount` beside `deposit`, parsed and bounded by the same
  `amount`. Five tests at the end of `receipts/test/reader.test.ts`.
- **`api`.** Migration 16, `ALTER TABLE receipt_items ADD COLUMN
  discount_cents INTEGER`; `fileReceipt` stores it, `toItem` and
  `receiptsOnRows` read it. `api/test/schema.test.ts`, "migration 16's
  rebates (lg-89)", builds two filings at version 15 (a line, and a row split
  by category), migrates, and reads every item back with `discount: null` and
  the same split and slices as before. Three filing tests at the end of
  `api/test/receipts.test.ts`, one a request that omits `discount`.
- **`web`.** A `Rebate on <item>` input beside `Deposit`, parsed as the
  deposit is; the live split and the add-up hint come from `books` and so use
  the net. Two tests at the end of `web/test/receipts.test.tsx`. The item row
  already wraps (`.items .item`, `flex-wrap`), so no layout case was added:
  `E2E_PORT=8189 npx playwright test -c tools/ledger/playwright.config.ts
  layout.spec.ts -g Receipt` → `1 passed`, "Receipt fits a phone and a
  desktop, with a photo kept and an item typed".
- **The three fixtures (Build 6)**, in `receipts/test/fixtures/`:
  `rebate-under-its-item`, `rebate-away-from-its-item` (`RABAIS 1185` printed
  three lines below `1185 DETERGENT`, a taxable item) and
  `coupon-on-the-whole-receipt`, each an `.html` source and the `.png`
  rendered from it. Every amount adds up and its taxes are the rates'.
  `receipts/test/live/render-rebate-fixtures.ts` renders them through
  Playwright's Chromium (no network, no cost); `rebate-fixtures.ts` holds what
  each read must give; `read-rebate-fixtures.ts` is the paid read. None is
  named `.test.ts`, so vitest never runs them, and `tsconfig.tests.json`
  typechecks them, as the planner's `api/test/live/run.ts` is kept.

Mutation, on `113ba31b`: `netPrice` returning `item.price` alone failed 11 of
the new tests across `books`, `api` and `web` (`npx vitest run` of the three
receipt suites: `11 failed | 167 passed`). The category test passed under it
at first, since `splitByCategory` gives the remainder to the largest category
and the rebate was on the largest; it now puts the rebate on the soap, and
fails under the mutation (`-t "charts each item at its net"`: `1 failed`).

`npm run check` exits 0, and `npm test -- --project ledger` passes 2 098 of
2 098 tests in 97 files.

**Done when 7, awaiting the owner's paid read.** Not run here: it costs three
Haiku reads. From the repository root, once `npm run build` has run on the
merged tree, with `api.anthropic.com` reachable:

```bash
node --import tsx tools/ledger/receipts/test/live/read-rebate-fixtures.ts --paid .claude/.keys /tmp/lg-89-read.json
```

It reads the key from the file (the `LEDGER=` line, or the whole file), never
the environment, and refuses without `--paid` (exit 2, checked). It prints one
`<fixture>: pass` or `<fixture>: FAIL: <why>` line per receipt and exits 0 only
when all three pass; the JSON holds every item read. **The three verdict lines
go in a dated entry here**, which closes line 7; the JSON stays outside the
repository. The verdict logic was checked offline against eight made-up
readings, folded and not, 8 of 8 as expected.

What the brief had wrong:

- "Keep them in `receipts/test/fixtures/` beside the existing ones": there was
  no `receipts/test/fixtures/`, and no receipt image anywhere in the tool. The
  directory is new.
- Done when 4's "the same split as before" cannot be computed through
  `receiptsOnRows` at version 15, since its query names the new column. The
  test reads the row's receipt through `storedFiling` before the migration
  and through `receiptsOnRows` after.
- Not named: eight assertions hard-code the latest schema version (15) in
  `schema.test.ts`, `auto-file.test.ts` and `spending-backfill.test.ts`, and
  every migration has to bump them; they now say 16. The recorded reader
  responses lacked `discount`, which the output schema now requires, so they
  carry `discount: null`.

### 2026-11-01 — fixed at landing (fixer, Claude Sonnet 5.5)

Gate 1's five below-floor findings, fixed by owner choice as the gate states
them, in commit "fix(ledger): refuse custom headers and a multi-key file in the
rebate read" (the commit before the records). Each planted fault was run on
that committed tree and restored from it; `npx vitest run <spec>` fails each as
below.

- 2026-11-01 — Fixed at landing by owner choice: gate 1, the first med —
  "prints the whole key file when it has no `LEDGER=` line". `keyFrom` now
  refuses a file of several lines with no `LEDGER=` line (exit 2, no text of
  the file in the message) and the script prints only a failed read's `code`
  (`paid-read.ts`: `keyFrom`, `failureNote`; `read-rebate-fixtures.ts`).
  `rebate-live-gate.test.ts` › "refuses several lines with no LEDGER= line,
  and repeats none of them" and › "prints a failed read's code and never its
  message or cause". Planted: `keyFrom` falling back to the whole file again →
  `1 failed | 7 passed (8)`, `AssertionError: expected [Function] to throw an
  error`; `failureNote` returning the error's message and cause → `1 failed`,
  `expected 'The receipt could not be read. Type i…' to be
  'RECEIPT_UNREADABLE'`, received text holding `Bearer sk-secret`.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the second med —
  "does not refuse `ANTHROPIC_CUSTOM_HEADERS`". `assertPaidReadConsent`
  (`paid-read.ts`) mirrors `assertLiveRunConsent`: it refuses
  `--paid`-less runs and a non-blank `ANTHROPIC_CUSTOM_HEADERS`, never
  repeating its value. New `receipts/test/rebate-live-gate.test.ts`, in the
  shape of `api/test/layout-live-gate.test.ts`, pins the consent, `keyFrom`,
  `failureNote` and `wrong()` (8 tests). Planted: the custom-headers check
  removed → `1 failed | 7 passed (8)`, "refuses ANTHROPIC_CUSTOM_HEADERS, and
  never repeats its value", `expected [Function] to throw an error`; `wrong()`
  blind to a negative item left beside a folded rebate → `1 failed | 7 passed
  (8)`, "a folded rebate that is the wrong amount, absent, or left as a
  negative item fails".
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the first low —
  "pinned only for the huge case". `reader.test.ts` › "the model reader's
  malformed rebates (lg-89)": a fraction, a string, a key left out and 2^53
  each refuse the reading as `RECEIPT_UNREADABLE`, and a wrong-sign rebate
  passes through. Planted: `const cents = z.number().nullable()` in the
  reader → `2 failed | 27 passed (29)` (the fraction and the 2^53 cases),
  `AssertionError: expected [ Array(1) ] to be an instance of AppError`.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the second low —
  "the Rebate input's placeholder does not say a rebate is typed negative".
  The placeholder reads `Rebate, -2.00` and the `items-differ` label lists
  rebates. `git diff fcc71e10 HEAD -- tools/ledger/web/src/receipts/Receipts.tsx
  | grep -c '^-.*placeholder="Rebate"'` → `1`, and the same with `The items,
  deposits and taxes do not add up` → `1`. New `web/test/receipts.test.tsx` ›
  "the Rebate field's placeholder shows a rebate typed negative (lg-89)"; the
  two label assertions in that file now say "deposits, rebates and taxes".
  Planted: the placeholder back to `Rebate` → `1 failed | 27 passed (28)`,
  `expected 'Rebate' to be 'Rebate, -2.00'`.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, the third low —
  "no test takes a stored rebate to a chart amount in one piece".
  `api/test/receipts.test.ts` › "a rebate on the soap lowers the household
  slice by its net and taxes, and the remainder stays with the beer": files
  a receipt with 1,00 $ off the soap on a row, then `chartedAs` over
  `receiptsOnRows` gives 349, 1 842 and 459 (574 without the rebate). The
  rebate is on the soap, not the beer, since the largest category takes the
  remainder and would hide it. Planted: `receiptsOnRows` reading
  `discount: null` → `2 failed | 70 passed (72)`, this test and "passes a
  rebate on a row's item to the chart's split", `expected { slices: [ { …(2)
  }, …(2) ], …(1) } to deeply equal { split: true, …(1) }`.
