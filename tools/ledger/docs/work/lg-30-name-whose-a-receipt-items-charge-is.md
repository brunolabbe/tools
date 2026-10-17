---
id: lg-30
tool: ledger
title: Name whose a receipt item's charge is, among more than two people
kind: work-package
status: needs-decision
milestone: P6
depends_on: [lg-23]
difficulty: standard
---

# lg-30 — Name whose a receipt item's charge is, among more than two people

## Why

A receipt item can be marked `theirs`: the other person's, so it becomes a charge
they owe in full (lg-10). The contract's `ItemShare` and the filing name nobody
for it. With two people, "the other" is one person. With more, it is no one.
`fileLines` in `api/src/receipts.ts` picked the first person who was not the
payer, and `web/src/receipts/Receipts.tsx` did the same.

lg-23's gate 1 found it (F2). Its reproduction: run lg-10's test "an item marked
as the other's becomes a charge…" with alex, casey and sam in the household. The
charge went to casey, and the test, which expects sam, failed.

On 2026-10-17 the owner chose to refuse that case in lg-23 and file this ticket
for naming whose. lg-23 now refuses a `theirs` item when the household has more
than two people (`BAD_REQUEST`, "With more than two people in the household, an
item cannot be marked as the other's…"), and the screen does not offer it. A
charge among more than two people is filed instead as a line on the period
screen, which names whose it was.

The whole-receipt `chargedTo` on a line destination already names a person in
the contract. The screen hides that choice too among more than two, so this
ticket can give it a picker as well.

## The decision

Naming whose is a change to `@ledger/contract`, so it is the owner's to approve.

- **A. On the item (recommended).** The item becomes `share: "shared" |
"not-shared" | { theirs: personId }`, or it gains a `chargedTo` beside `share`.
  Each item can be charged to a different person, so a receipt shared by three
  can charge one item to casey and another to sam. The cost is that
  `ReceiptProposal`, its schema, `receipt_items` (a column, or a rebuild for the
  CHECK) and `splitReceipt` all change. `splitReceipt` returns a charge per
  person instead of one `chargedCents`, and the filing names a charge line per
  person.
- **B. On the filing.** Every `theirs` item on a receipt is charged to one person
  named on the request. That is smaller: one field on `FileReceiptRequest` and
  the same single charge line. The cost is that a receipt with items belonging
  to two different people has to be filed twice, or partly as lines by hand.

## Build

To be written once the decision is answered.

## Done when

To be written once the decision is answered. At the least: in a household of
three, an item marked as casey's files a charge to casey and one marked as sam's
a charge to sam, and lg-23's refusal is lifted. Two-person filings keep their
current requests and results.

## Log

- 2026-10-17 — Filed by lg-23's builder in round 1, from the owner's answer to
  gate 1's F2. The status is `needs-decision` because the contract change is the
  owner's to approve.
