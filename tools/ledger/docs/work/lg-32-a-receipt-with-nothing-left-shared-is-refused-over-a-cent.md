---
id: lg-32
tool: ledger
title: A receipt with nothing left shared is refused over a cent of rounding
kind: fix
status: done
milestone: P6
depends_on: []
difficulty: standard
---

# lg-32 — A receipt with nothing left shared is refused over a cent of rounding

## Why

lg-10 files a receipt as a shared line plus a charge, after taking off what is not
shared and what is the other's. `splitReceipt` (`books/src/receipts.ts`) rounds
each of those parts once and leaves the shared amount as the remainder. The parts
are rounded apart, so on a receipt where every item is taken off, the remainder
can come out as a cent of the wrong sign. `fileLines` (`api/src/receipts.ts`)
then refuses it as "More comes off this receipt than the card was charged", which
is false: the person marked every item, and the receipt adds up.

lg-30's gate 1 found it (F8), while checking a guard lg-30 adds for the same
rounding among more than one charged person.

## Reproduction

In the household of two (alex and sam, alex paying), with lg-10's `BASKET` in
`api/test/receipts.test.ts` (`PAIN` 349, `BIERE` 1,299 + 60 deposit, `SAVON`
499, 2,476 charged) and `marked("not-shared", "theirs", "not-shared")` as the
proposal, filed as a line for 2,476:

```
PROBE 400 {"error":{"code":"BAD_REQUEST","message":"More comes off this receipt than the card was charged. Check the amount charged and the items.","retryable":false}}
```

Measured on `origin/main` at `6b42ee19`, with a probe test run as
`npx vitest run tools/ledger/api/test/receipts.test.ts -t "<probe>"` and then
removed. And on `splitReceipt` itself, with the gate's `measure.mts`:
`split 1,3 not-shared, 2 theirs: {"sharedCents":-1,"notSharedCents":923,"chargedCents":1554}`.
The two groups rounded together come to 2,476, which is the receipt's total
(`sharedAmount` with every item excluded gives 0 shared), so the -1 is rounding
and nothing else.

## Build

1. `splitReceipt`: when excluding every item that is not shared or is the other's
   **together** (as `sharedAmount` does today for one excluded set) leaves the
   shared amount at zero or at the payment's sign, but the groups rounded apart
   (the not-shared items, and the `theirs` items) leave it at the opposite sign,
   the difference is rounding and nothing else. Take it off the **not-shared**
   amount when there is one: that part is the payer's own, no line records it and
   nobody owes it, so the cent costs no one anything. With no not-shared items,
   take it off the charge that is largest in size, the earlier on a tie. **This
   is the rule lg-30's Build 2 states, word for word** (owner, 2026-10-17, Log):
   the two tickets do not differ, in either merge order. Whichever merges second
   extends the one guard already there; there are never two.
2. The shared amount is then 0 and `fileLines` files the charge alone, with no
   shared line, as it already does for a receipt of which only the other's part
   is left.
3. An excess that the together-rounding shows too (more is taken off than was
   charged) is still refused, with the same message.

**Why not leave the refusal.** The person has done nothing wrong and cannot fix
it: the message says to check the amount charged and the items, and both are
right. **Why the not-shared part first.** Taking the cent off the charge would
change what the other person owes by a cent to fix the payer's own rounding.

## Done when

1. An API test: the reproduction above files, with 200, and the filing has one
   line, the charge to sam of 1,554, with no shared line; `chargeLineId` is
   `null`. On `6b42ee19` the same request is `BAD_REQUEST` with the message in
   the reproduction.
2. A `splitReceipt` test (`books/test/receipts.test.ts`) on the same proposal:
   `sharedCents` 0, `notSharedCents` 922, `chargedCents` 1,554, which make the
   2,476 paid. On `6b42ee19` it answers -1, 923 and 1,554.
3. The refund of it: every price, deposit, tax and the total of `BASKET` negated, the
   same marks, -2,476 charged: `sharedCents` 0, `notSharedCents` -922,
   `chargedCents` -1,554.
4. _Regression:_ a receipt that really charges more than was paid (the same
   marks and a smaller amount charged, by more than the rounding) is still
   `BAD_REQUEST` with the same message.
5. `npm run check` and `npm test -- --project ledger` pass at the branch's head.

## Review

**Gate: CONCERNS** — 2026-10-17 · `a04a1c96..f72a51c0` · Opus 5.5, depth full

| Done when                                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The reproduction files with 200: one line, the charge of 1,554 to sam, no shared line, `chargeLineId` `null`. BAD_REQUEST before the change | `api/test/receipts.test.ts` › "files the charge alone, where the parts rounded apart come to a cent over" ✓. It asserts the 200, `chargeLineId` `null` and `storedLines` equal to `[{1554, sam}]`. With the base `splitReceipt` rebuilt into `dist`, the same test gets 400 `BAD_REQUEST` "More comes off this receipt than the card was charged. Check the amount charged and the items." `6b42ee19` and `a04a1c96` have the same `books/src/receipts.ts` and `api/src/receipts.ts`. |
| 2. `splitReceipt`: 0 / 922 / 1,554, and -1 / 923 / 1,554 before the change                                                                     | `books/test/receipts.test.ts` › "takes the cent the parts were rounded apart by off the not-shared amount" ✓. It asserts the whole object with `toEqual`. At the base source it gets `sharedCents: -1`.                                                                                                                                                                                                                                                                               |
| 3. The refund, negated with its deposit: 0 / -922 / -1,554                                                                                     | `books/test/receipts.test.ts` › "does the same for the refund of it, negated" ✓. The `REFUND` fixture negates the prices, the deposit, the taxes and the total. At the base source it gets `sharedCents: 1`.                                                                                                                                                                                                                                                                          |
| 4. _Regression:_ a real excess is still BAD_REQUEST with the same message                                                                      | `api/test/receipts.test.ts` › "still refuses a receipt that charged less than the items came to" ✓. At 2,470 it asserts 400, the code, the message, and zero `period_lines` and `receipt_filings`. `books/test/receipts.test.ts` › "still shows more than was charged, where the parts together come to more" also covers it, at 2,475 and 2,470. Both go red when the `together` condition is mutated to `true`.                                                                     |
| 5. `npm run check` and the ledger project pass at the head                                                                                     | **verified**. `npm run check` exits 0. `npm test -- --project ledger`: 1190 of 1190 tests in 62 files. The pull request's CI on `f72a51c0`: all 9 checks are SUCCESS, the Windows leg included.                                                                                                                                                                                                                                                                                       |

- **med** · open decision · no `Done when` line depends on it · `nfr:reliability`. **The rule's test for "rounding" checks the amounts taken off, with their taxes computed exactly, against the payment. It never checks them against the printed total.** About half of the ticket's own symptom is left, and a card charged a cent under the printed total now files.
  - The rule decides rounding with `together` (the payment less `sharedAmount` of every item taken off). That is exact taxes rounded once. A till prints GST and QST each rounded separately, so the printed total can sit a cent either side of `together`.
  - Measured on 180,000 two-item receipts with every item taken off. Each has one not-shared and one `theirs` item, both taxable, prices 1..300 and 1001..1300, and `checkReceipt` raises no flag on any of them.
    - Paid exactly the total: the guard newly files 13,825, and 12,890 are still refused.
    - Paid a cent under the total: the guard newly files 7,985 that the base refused.
  - Reproduced through the API, at the head and at the base:
    - **Still refused at the total.** 10,00 $ not shared and 10,07 $ `theirs`, both taxable. GST 100, QST 200, total 2,307, paid 2,307. Head: `400 BAD_REQUEST "More comes off this receipt than the card was charged…"`. Base: the same. This is the failure the ticket's Why describes: every item marked, and the receipt adds up.
    - **Newly filed a cent under.** 10,00 $ not shared and 10,12 $ `theirs`. GST 101, QST 201, total 2,314, paid 2,313. Head: `200`, one line `{1164, sam}`, not-shared 1,149. Base: `400`, the same message.
  - **The definition cannot tell a real 1-cent shortfall from rounding.** Whether paying the total, or a cent under it, counts as "excess" depends on which way the printed taxes rounded.
  - Options:
    - **(A, recommended)** Widen the rule in this branch. When nothing is left shared, judge against the printed total, which `itemsAddUp` guarantees the items make. A payment at or beyond the total, at its sign, makes whatever the parts leave over rounding: up to 2 cents, one from printed against exact taxes and one from rounding the parts apart. That amount comes off the not-shared amount, or else off the largest charge. A payment under the total is refused. This rewords Build 1 and Done when 4. lg-30's Build 2 states the same `together` test, so per `gate.md` the same rewording goes into lg-30's Build 2 in the same pull request.
    - **(B)** Land as built and file a follow-up ticket, with the 2,307 receipt above as its reproduction.
    - **(C)** Accept the refusal for a printed-tax cent.
  - The owner chose where the cent goes ("not-shared first"). The `together` test itself came from the filing, so (A) does not reopen the owner's answer.
- **low** · no `Done when` line depends on it. **Build 1's second branch can be reached, and the comment saying it cannot is false.** Not-shared items whose amount rounds to 0 are still refused.
  - The guard runs only when `notSharedCents !== 0`. Not-shared items of mixed sign and opposite tax treatment can be present and still round to 0 cents.
  - Reproduction, through the API at the head and the base: 1,00 $ untaxed not shared, a -0,87 $ taxed coupon not shared (-0,028 $ exactly), and 4,91 $ taxed `theirs`. GST 20, QST 40, total 564, paid 564. `together` is 0 and the parts apart are -1. Head: `400 "More comes off…"`. Base: the same.
  - Build 1 says to take the cent off the not-shared amount, or with none, off the largest charge. Either one files it.
  - Shipped text that is false:
    - The `splitReceipt` header says "that case cannot arise yet".
    - The Log says the branch "cannot be reached here" and describes a zero not-shared amount as "every not-shared item priced 0".
    - The falsehood runs in the safe direction: the receipt is refused as it was at the base, and no amount is wrong. The trigger is contrived.
  - Mutation: deleting `&& notSharedCents !== 0` leaves all 1190 ledger tests passing, so nothing pins that condition.
  - Seam with lg-30: both tickets say "the not-shared amount when there is one" and "with no not-shared items". This branch reads the first as the amount, and in the gap between amount and items neither rule runs. lg-30's extension has to choose between them. Nothing in either ticket is contradicted.
- **dropped** · a tip with the same marks (2,776 charged) leaves 299 shared apart and 300 together. That is at the payment's sign, and the rounding stays shared as the header says. Not a defect.
- **dropped** · mixed-sign lines, deposits and refunds where the not-shared amount is not zero. A random search of 400,000 receipts, each at the total and with a 1-cent tip, found no receipt the head refuses where `together` is 0 or at the payment's sign. The guard covers them.
- **dropped** · the size of the adjustment. When the guard fires the parts apart are exactly -1 and `together` is 0, because the two roundings differ by at most a cent. The Log's "at most a cent" holds.
- **dropped** · there is no web test for the preview: `Receipts.tsx` calls the same `splitReceipt`. No Done when line asks for one, and the books and API tests prove the function.
- **findings** · the hunt returned 6; 2 carried, 4 dropped.
- NFR: security n/a · performance ✓ (one more `sharedAmount` call per split) · reliability: F1 · maintainability: F2 (an unpinned condition, a false comment).

## Log

- 2026-10-17 — Filed from lg-30's gate 1 (F8), with the owner's answer to file it
  rather than leave it. The reproduction was run on this tree
  (`6b42ee19`): the 400 above, from an API probe test that was then removed. The
  Build's choice of where the cent goes (not-shared first, then the largest
  charge) is the filing's recommendation, not an owner decision; a builder who
  finds a reason against it raises it.
- 2026-10-17 — Gate 2 on lg-30 found that lg-30's Build 2 and this ticket's
  Build 1 disagreed on the same receipt (G4), and the owner chose through
  `AskUserQuestion`. As put:
  - Question: "lg-30 and the new lg-32 disagree on where a leftover rounding cent
    goes … Which rule should both tickets state?"
  - **"Not-shared first" (recommended by the gate and by this ticket's filer):**
    off the payer's not-shared amount when there is one, else off the charge
    largest in size.
  - "Always the largest charge".
  - "Keep the refusal".
  - **Chosen: "Not-shared first".** This ticket's rule is unchanged; Build 1 now
    says lg-30's Build 2 states the same one, and Done when 3 negates the deposit
    too (G3: `measure2.mts` gives `RECEIPT_DOES_NOT_ADD_UP` when the refund's
    deposit is left positive). The rule is now an owner's answer, no longer only
    the filing's recommendation.
- 2026-10-17 — Built, on `a04a1c96`. The guard is in `splitReceipt`
  (`books/src/receipts.ts`) and nowhere else; `fileLines` is unchanged, since a
  shared amount of 0 already files the charge alone.
  - **The rule as written.** Let `together` be the payment less
    `sharedAmount(receipt, [...not-shared, ...theirs])`. When the parts rounded
    apart leave the shared amount nonzero at the opposite sign to the payment, and
    `together` is zero or the payment's sign, the difference is rounding: it goes
    onto `notSharedCents` and `sharedCents` is 0. The two parts are each rounded
    once, so the difference is at most a cent. Where `together` is also over
    (`2,475` charged: -1 together, -2 apart), nothing is adjusted and the caller
    refuses it as before.
  - **Build 1's second branch is not built, and cannot be reached here.** "With no
    not-shared items, take it off the largest charge" needs two rounded charge
    amounts to disagree with their sum. This function has one `theirs` amount,
    rounded once, so with no not-shared amount `together` and apart are the same
    number. lg-30 makes the charges several; that is where the branch is
    reachable and testable, and `splitReceipt`'s comment says so. Any
    not-shared amount of 0 (every not-shared item priced 0) is treated as there
    being none, so the adjustment is not applied there either. **WITHDRAWN — do
    not cite this sentence, nor the claim above that the branch "cannot be
    reached here"** as it was written (builder's error, found by gate 1's F2): a
    not-shared amount of 0 does not mean no not-shared items. Mixed-sign items of
    opposite tax treatment can be present and round to 0 cents, and they were
    refused. The guard now runs on the items; see the "Fixed at landing" entry.
  - **Measured.** Before the change, on the three new tests that reach it:
    `npx vitest run tools/ledger/books/test/receipts.test.ts
tools/ledger/api/test/receipts.test.ts -t "lg-32"` gave 3 failed | 2 passed
    of 108: the API test `BAD_REQUEST` "More comes off this receipt…" and the two
    books tests `sharedCents: -1` (the refund `+1`). After it, both whole files:
    108 passed of 108 (api resolves books through `dist`, so `books` was rebuilt
    between the two states, and the built `receipts.js` was grepped for the new
    `sharedAmount(receipt, [...notShared` call). Mutation: with the `together`
    condition made always true, "still shows more than was charged, where the
    parts together come to more" failed (1 failed | 55 passed of 56, books file);
    the mutation was then restored by editing it back.
  - **Not asked of this ticket, seen in passing.** With a tip and the same marks
    (`2,776` charged) the parts apart leave 299 shared where together they leave
    300, a cent of the same rounding but at the payment's sign. The Build's rule
    is about the sign, so it is left alone and nothing refuses it.
- 2026-10-17 — Fixed at landing by owner choice: gate 1, F2 — "Build 1's second
  branch can be reached, and the comment saying it cannot is false. Not-shared
  items whose amount rounds to 0 are still refused." The guard runs on the
  not-shared **items** (`notShared.length > 0`), not on their amount; the cent
  comes off the not-shared amount when there are not-shared items, and off the
  largest charge when there are none, which one charge cannot reach here.
  `splitReceipt`'s header no longer says the case "cannot arise yet" for an amount
  of 0, and the Build entry's two false sentences above are withdrawn in place.
  - Reproduced first, at the gated head `f72a51c0`: `npx vitest run
tools/ledger/books/test/receipts.test.ts tools/ledger/api/test/receipts.test.ts
-t "gate 1 F2"` → 2 failed | 108 skipped of 110 (books `sharedCents: -1`, the API
    `BAD_REQUEST` "More comes off this receipt…"). After: the same two files whole →
    110 passed of 110 (`books` rebuilt between, the built `receipts.js` grepped for
    `notShared.length > 0`).
  - Mutation, on a committed tree: restoring the old condition `notSharedCents !==
0` → 2 failed | 108 passed of 110, the two new tests. Deleting the condition
    outright (`if (roundingOnly)`) → 110 passed of 110: an equivalent mutant, since
    with no not-shared items `together` and the parts apart are the same number, so
    `roundingOnly` is already false; the condition documents that, and nothing can
    pin it until lg-30 gives several charges.
  - **F1 is not fixed here, by owner choice (option D, overriding the gate's A):**
    lg-30's Build 2 now states the printed-total rule and the 2,307 and 2,314
    receipts, and its builder replaces this ticket's `together` test in the same
    guard. This ticket's code and its gate record keep F1 as the gate wrote it.
