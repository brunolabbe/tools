---
id: lg-91
tool: ledger
title: Leave an item out of a joint-account row's receipt, as a charge owed to the pot
kind: work-package
status: ready
milestone: null
depends_on: [lg-90]
difficulty: hard
---

# lg-91 — Leave an item out of a joint-account row's receipt, as a charge owed to the pot

## Why

A receipt filed on a joint-account row (a purchase made with the joint card)
is shared whole. `fileReceipt` refuses any item that is not `shared`
(`api/src/receipts.ts`, "A receipt on a joint-account row is shared whole"),
and so does the screen. This is lg-10's decision 3: when the money left the
joint account, nobody had decided who owes whom for an item that is one
person's.

The owner reopened it on 2026-11-01. A grocery run on the joint card often
carries one person's own things, and today the only way to record that is a
charge line typed by hand.

## Decision — answered 2026-11-01 by the owner

Both questions were asked through `AskUserQuestion`.

1. **What unchecking an item on a joint row does.** Chosen: **assign it to a
   person**. The other options were a person or "drop", and filing the question
   undecided. A joint row has no payer, so there is no **Mine**. An unchecked
   item must name whose it is, and there is no option to drop it, because the
   money still left the pot.
2. **How the books record it.** A charge today is one person owing another
   (`PeriodLine.chargedTo`, `docs/00-ANALYSIS.md` §5, _Charges between the
   two_). Nothing can say "owes the pot". Chosen: **a charge to the pot**. This is
   a new kind of charge whose creditor is the joint account. At the close, the
   settlement shares it out to the other members at that period's ratio, so a
   change of salaries before the close counts.
   - The other option was to write ordinary person-to-person charges at filing,
     each at that member's ratio share. That needs no settlement change, but it
     freezes the ratio at filing time and shows several lines for one item.
   - The third option was to file this question undecided.

## Build

The shape of the change to `@ledger/contract` and to the settlement is given
here. A different shape is a stop and a question.

1. **The math first, in `books/src/settlement.ts`.** Say `c` is the cost of
   person X's items, charged to the pot, and `r_i` is each member's ratio for
   the stretch.
   - The pot paid `c`, and the members funded it at their ratios.
   - If X had paid their own item, X would bear the whole of `c`.
   - So X owes each other member `i` the amount `r_i × c`, which totals
     `(1 − r_X) × c`.

   In `netsOf`, a pot charge adds `r_i × c` to each other member `i` and the sum
   of those to X, at the stretch's ratio, rounded so the nets still sum to zero.
   Write the case with numbers in the header comment, as the file does for the
   matching rule. Prove it the way `docs/00-ANALYSIS.md` §5 proves the rule: by
   simulation over random mixes, where each person's cash out minus their share
   of the buffer equals what they consumed.

2. **`@ledger/contract`.** A charge's creditor becomes either a person or the
   pot. Suggested: `PeriodLine` gains `owedToPot: boolean`, `true` only on a
   charge line, with `personId` the person charged and `chargedTo` that same
   person. Choose the representation that changes the fewest readers, and say
   in the Log which one and why. `ReceiptFiling.charges` names pot charges as
   such.
3. **`api/src/receipts.ts`, `fileReceipt`.** On a row destination:
   - allow `theirs` items, each naming a current member (`chargedTo` required;
     `null` is refused, since a row has no payer to be "the other" of);
   - refuse `not-shared` (`BAD_REQUEST`, saying a joint purchase has no payer
     to keep it);
   - file one pot charge line per person, dated the row's date, for that
     person's items' cost from `splitReceipt`, in the period that holds the
     row's date.

   The row itself is unchanged.

4. **Stats** (`api/src/slices.ts`, `receiptsOnRows`, lg-27). A joint row's
   spending by category leaves out items charged to a person, so they do not
   chart as joint spending twice. Today that cannot happen (lg-27's Log: "no
   live call site"). This ticket creates the call site, so the test comes with
   it.
5. **`web/src/receipts/Receipts.tsx`.** On a row destination, lg-90's select
   has no **Mine**. It offers the current members, and nothing is chosen until
   the person picks. Remove the "shared whole" refusal from `fileAs`. The split
   line names "owed to the pot by `<name>`".
6. **The period screen** shows a pot charge distinctly from a charge between
   two people, and the settlement screen's figures include it.

## Done when

1. ~~`books/test` proves the pot-charge settlement on a two-person and a
   three-person household with unequal ratios, and on a stretch where the
   ratio changes. The nets sum to zero, and the simulation in Build 1 finds 0
   mismatches.~~ _Superseded 2026-11-01 by the line below, which fixes the
   simulation's trial count and household sizes._
   **1.** `books/test` proves the pot-charge settlement on a two-person and a
   three-person household with unequal ratios, and on a stretch where the
   ratio changes. The nets sum to zero. The seeded simulation in
   `books/test/settlement.test.ts` (`the settlement's promise, simulated`) is
   extended with pot charges and runs 2,000 trials each for a two-person and a
   three-person household, ratios and amounts drawn as the existing test draws
   them, and finds 0 mismatches.
2. An `api` test files a receipt on a joint row with one item charged to a
   person and proves:
   - one pot charge line in the row's period, at that item's cost;
   - the row unchanged;
   - the settlement moved by `(1 − r_X) × c` in the other members' favour.
3. An `api` test proves a row filing with a `not-shared` item, or with a
   `theirs` item naming nobody, is refused and files nothing.
4. An `api` test proves the stats for a joint row leave out the charged item's
   category amount.
5. Web tests prove a row destination offers no **Mine** and files the person
   chosen.
6. `npm run check`, `npm test -- --project ledger` and `npm run e2e:ledger` pass.

## Log

**2026-11-01 — the owner's answer at intake to Done when 1, relayed by the
orchestrator in the build dispatch.** Question: "the simulation in Build 1 finds
0 mismatches" names no trial count, so a gate cannot grade it; the existing test
`the settlement's promise, simulated` in `books/test/settlement.test.ts` uses a
seeded `generator` and 2,000 trials for two people. Options: (a) the same
convention for two and three people: extend the seeded simulation with pot
charges, 2,000 trials each for a two-person and a three-person household,
ratios and amounts drawn as the existing test draws them, 0 mismatches; (b) a
fixed, enumerated grid; (c) leave the line as written. Chosen **(a)**, the
orchestrator's recommendation. Done when 1 is reworded above, the old line left
beside it and marked superseded.
