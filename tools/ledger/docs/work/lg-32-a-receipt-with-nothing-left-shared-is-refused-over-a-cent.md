---
id: lg-32
tool: ledger
title: A receipt with nothing left shared is refused over a cent of rounding
kind: fix
status: ready
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
