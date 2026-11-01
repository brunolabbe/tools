---
id: lg-93
tool: ledger
title: Negative amounts may have no minus key on an iPhone's decimal keypad
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# lg-93 — Negative amounts may have no minus key on an iPhone's decimal keypad

## Why

The hypothesis: an `<input inputMode="decimal">` on an iPhone opens a keypad
with digits and a decimal separator but no minus key, so a person on an iPhone
may be unable to type a negative amount such as `-2.00`. The case that matters
most is a returned item, whose price is negative (`contract/src/receipts.ts`,
the comment on `ReceiptItem.price`).

It was raised by the builder of lg-89 (draft pull request #717, branch
`lg-89-fold-rebate-into-item`) while it built a Rebate field beside each item's
Price and Deposit. Nobody has measured it. No iOS device was available to that
builder or to the filing of this ticket, so **this is a hypothesis**. Nothing
about the keypad below is a fact until Build step 1 records one. No fix is
written before that reading and the owner's answer.

The parser is not the problem. `parseTypedAmountCents`
(`books/src/amount.ts`, line 46) already reads a leading `-` or `−` in a typed
amount, and the forms that use it take a negative where the table says so. What
is in question is only what the keyboard offers.

### Where a negative is a legitimate entry

Read from the code on `origin/main` at `8ad4e91d`. The grep in
_Reproduction_ finds ten sites. Subtotal, GST, QST, Total and Charged are not
in its output as separate lines: they reach the same `inputMode={mode}` line
through the `field()` helper in `receipts/Receipts.tsx`, which defaults to
`decimal`, so they are listed here with the grep's own lines.

| Where                                    | Field                                          | Negative a legitimate entry?           | From the code                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receipts/Receipts.tsx:721`              | Price of an item                               | **Yes**                                | `contract/src/receipts.ts:57`: "A discount or a returned item is negative."                                                                                                                                                                                                                  |
| `receipts/Receipts.tsx:727`              | Deposit on an item                             | **Not settled**                        | The schema admits it (`receipts.ts:110`, `cents`, from `-MAX_CENTS`). Nothing in the contract says a deposit is ever negative, so the code does not answer it. A returned bottle's deposit refund is the case to ask about.                                                                  |
| `receipts/Receipts.tsx:668` (helper)     | Subtotal, GST (TPS), QST (TVQ), Total          | **Yes, on a refund**                   | `receipts.ts:11`: "A refund is negative, as the models measured on lg-8 read one."                                                                                                                                                                                                           |
| `receipts/Receipts.tsx:668`, used at 799 | Charged to the card (with any tip)             | **Yes, on a refund**, by the same rule | The refund rule above is stated for the receipt's amounts; the code does not name this field separately.                                                                                                                                                                                     |
| `history/History.tsx:343` and `:350`     | Filter bounds "At least ($)" and "At most ($)" | **No**                                 | `bound()` (`History.tsx:81–84`) returns `null` for a negative, and the form says "Type an amount like 12.50 in dollars." The contract bounds are `min(0)` (`contract/src/api.ts`, `rowsQuerySchema`, `minCents` and `maxCents`), and the server compares `Math.abs` (`api/src/rows.ts:182`). |
| `periods/LineForm.tsx:117`               | Amount of a period line                        | **Yes**                                | `PeriodLine.amountCents`: "Positive for a purchase; a refund on a shared purchase is negative" (`api.ts`, lines 1046–1047). `periodLineDraftSchema` takes `-MAX_CENTS` to `MAX_CENTS`, non-zero (`api.ts:1077`). The form refuses only zero (`LineForm.tsx:62`).                             |
| `periods/Recurring.tsx:148`              | Each month                                     | **No**                                 | The form refuses `monthlyCents <= 0` (`Recurring.tsx:78`). The contract is `min(1)` (`api.ts:1161`).                                                                                                                                                                                         |
| `rules/RuleForm.tsx:110`                 | Exact amount of a rule                         | **Yes**                                | Bank rows are signed, "negative for money out" (`contract/src/layout.ts:93`), and a rule matches a row on its exact amount. `ruleDraftSchema` has `amountCents: z.number().int().nullable()` with no sign bound (`api.ts:531`).                                                              |
| `salaries/Salaries.tsx:215`              | A person's salary                              | **No**                                 | The form refuses `amountCents < 0` (`Salaries.tsx:140`). `salaryEntrySchema` is `min(0)` (`api.ts:784`).                                                                                                                                                                                     |
| `salaries/MortgageSplit.tsx:159`         | A person's part, in %                          | **No**                                 | `parseShare` (`web/src/labels.ts:82`) matches digits only. `partsPerMillion` is `min(0)` (`api.ts:965`).                                                                                                                                                                                     |

So the fields where a minus key would matter are the five rows marked **Yes**
(the Price, the receipt's money fields and Charged, the period line's Amount and
the rule's Exact amount), plus Deposit once its answer is known. The rest are
not negative entries, and a keyboard change there is not needed.

**Not on `main` yet.** lg-89 (draft pull request #717) adds a Rebate input beside
each item's Price and Deposit, with `inputMode="decimal"` and the placeholder
"Rebate". Its contract comment makes a rebate negative on a purchase and the
opposite sign on a returned item. So a Rebate is a further field where a negative
is the normal entry. It lands with #717, not with this ticket, and the table does
not list it.

## Reproduction

Run on 2026-11-01 from a worktree at `origin/main` `8ad4e91d`:

```
$ git grep -n 'inputMode="decimal"\|inputMode={mode}' origin/main -- tools/ledger/web/src
origin/main:tools/ledger/web/src/history/History.tsx:343
origin/main:tools/ledger/web/src/history/History.tsx:350
origin/main:tools/ledger/web/src/periods/LineForm.tsx:117
origin/main:tools/ledger/web/src/periods/Recurring.tsx:148
origin/main:tools/ledger/web/src/receipts/Receipts.tsx:668
origin/main:tools/ledger/web/src/receipts/Receipts.tsx:721
origin/main:tools/ledger/web/src/receipts/Receipts.tsx:727
origin/main:tools/ledger/web/src/rules/RuleForm.tsx:110
origin/main:tools/ledger/web/src/salaries/MortgageSplit.tsx:159
origin/main:tools/ledger/web/src/salaries/Salaries.tsx:215
```

## Build

1. **Measure on a real iPhone first, and record it in the Log before anything
   else.** The owner, or anyone with an iPhone, opens the production ledger in
   Safari on a current iOS, names the device and the iOS version, and taps into
   each field the table marks **Yes** or **Not settled**. For each, the Log
   records whether the keypad offers a minus key. The Rebate field is included
   only if #717 has merged; until then it is recorded as not measured. An Android
   phone or a desktop browser is not this measurement.
2. **Stop there.** The owner answers the decision below with the reading in front
   of them. If every **Yes** field's keypad offers a minus key, option (d) is the
   answer.
3. **Then the answer is recorded first.** It goes under
   `## Decision — answered <date> by <who>`, with the options it was chosen from,
   in its own commit that moves `status` to `ready`, before any source change.
   The chosen option's Build steps are written into this section in that commit.

## Decision — open

**Open: what a person on an iPhone types for a negative amount.** Nothing here is
chosen. Build step 1 comes first, and each option is priced from the code in
_Why_.

1. **(a) A keyboard that offers a minus key** on each field the table marks
   **Yes**, by an `inputMode` the measurement shows gives one (`inputMode="text"`
   is the obvious one). Costs: the full keyboard replaces the number pad on those
   fields for every phone, so every amount is typed more slowly, not only the
   negative ones. Whether a `pattern` attribute changes the iOS keypad at all is
   part of the measurement and is not assumed.
2. **(b) Unsigned entry on the Rebate field only**, with the sign implied by the
   field. Costs: it applies only to lg-89's Rebate field, which is not on `main`
   yet. It leaves Price, where a returned item's negative price is typed, and every
   other **Yes** field as they are, so it does not answer the iPhone problem for
   them. And a rebate's sign is not always the same: lg-89's contract comment
   makes a rebate on a returned item the opposite sign, which a field that only
   sees the typed number cannot tell apart.
3. **(c) A sign toggle beside each field where a negative is legitimate.**
   Costs: a new control on each **Yes** field, and on the Rebate once it lands.
   It works on any keypad, so it does not depend on the measurement, and desktop
   users get the same control, so no keyboard hint changes. It is the largest UI
   change of the four.
4. **(d) Close it, if the measurement shows iOS offers a minus key** on each
   **Yes** field. Costs: nothing to build. The reading recorded in the Log is the
   whole deliverable, and it holds only for the device and iOS version measured.

## Done when

1. The Log records, for each field the table marks **Yes** or **Not settled**,
   the keypad an iPhone showed: the device, the iOS version, and whether it
   offers a minus key. A field not measured is named as not measured.
2. The owner's answer is recorded under `## Decision — answered <date> by <who>`,
   with the options it was chosen from, and `status` is `ready`.
3. When the answer is recorded, the chosen option's check is added here as line
   3, before any source change. Until then this line does not exist.

## Log

- 2026-11-01: filed from the builder of lg-89 (draft pull request #717, branch
  `lg-89-fold-rebate-into-item`), which saw the iOS keypad in its own build and
  could not measure it. Reproduction run on `origin/main` `8ad4e91d`, output in
  _Reproduction_ above: ten lines. The table in _Why_ was read from `main`'s
  source, not from the grep alone. It adds Subtotal, GST, QST, Total and Charged,
  which the `field()` helper renders through `inputMode={mode}`, and it covers
  both `salaries/` files, which the grep also matches. No iOS device was used, so
  nothing in the keypad column is measured. Status is `needs-decision` on the
  owner's pending answer; difficulty is `standard`, rated for the work once an
  option is chosen, all four options being within it.
