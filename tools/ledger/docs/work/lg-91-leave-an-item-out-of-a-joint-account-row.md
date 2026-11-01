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

### 2026-11-01, build

**Build 2's representation: the suggested one.** `PeriodLine.owedToPot: true`,
with `personId` and `chargedTo` both naming the person who owes the charge.
`OpenPeriodLine` carries the same field, and `ReceiptCharge.owedToPot` names a
pot charge in `ReceiptFiling.charges`. It changes the fewest readers because
every reader that asks `chargedTo === null` for "shared" already leaves a pot
charge out. That covers the period screen's "Paid by" total and the
contributions in `periodStretches`. A reader that ignores the field and takes
the line as a person-to-person charge fails loudly: `netsOf` throws "A charge
is owed by one person to another". The alternative, `chargedTo: null` with the
flag, would count the charge as that person's shared card spending in every
reader not updated, and nothing would say so.

The database cannot store `charged_to = person_id`, because migration 4's CHECK
refuses it. So migration 17 adds `owed_to_pot` with `charged_to` left NULL, and
`toLine` in `api/src/periods.ts` answers `chargedTo` as `person_id` on such a
line. Rebuilding `period_lines` would have meant rebuilding a table three
others reference, for one read site.

**Readers changed**:

- `periodStretches` (books);
- `toLine`, `insertLine`, `correctLine`, `retireLine` and `linesThrough` (api
  periods);
- `chargesOf` and `fileReceipt` (api receipts);
- `receiptsOnRows` and `chartedAs` (api slices);
- `Periods.tsx`, `stats/PeriodLines.tsx` and `Receipts.tsx` (web).

A correction of a pot charge keeps it one. The stats screen's category picker
and lg-53's backfill both send the line back with `chargedTo` equal to
`personId`. A correction that would make it a card line is refused ("A charge
to the pot stays owed to the pot. Remove it instead, if it was a mistake."), and
`POST /api/period-lines` still refuses a line charged to whoever paid it.

**Build 3.** On a row, `requireRowItems` checks every item before anything is
written:

- `not-shared` is refused, saying a joint-account purchase has no payer to keep
  it.
- A `theirs` item naming nobody is refused.
- A name the books do not hold is refused, as on a line.
- A name the books hold but the directory's current members do not is refused
  too.

`filePotCharges` splits with `splitReceipt(proposal, undefined, -row.amount_cents)`,
so a tip on the row stays shared, as on a line. It files one pot charge per
person:

- dated the row's date;
- under the person's items' category when they share one, and none otherwise;
- with the merchant as its note;
- with source `receipt`.

`periodLineId` and `chargeLineId` stay `null` on a row filing. The charges are
in `charges`.

**Build 4.** `receiptsOnRows` leaves a `theirs` item out of the row while its
charge line stands, and gives each row a `chargedCents`: what its charges'
standing versions hold, followed along `supersedes` with a depth guard. That
way the row and its card lines chart the row's amount between them, whatever is
corrected. `chartedAs` splits `amount − chargedCents` among the shared items,
or keeps it whole. A removed charge gives its item back to the row. A row that
gave anything up is `split`, so the list opened from the chart carries the
slice.

**Build 5.** The brief did not say how the screen knows the destination is a
row: the row is only chosen at the end, from the matches. The open decision in
the build report has the options. As built, **"Paid with the joint card?"**
turns the form to the joint account. Once it is tapped:

- an unchecked item becomes `theirs` naming nobody, and one that was Mine names
  nobody too;
- the select offers every current member, whoever took the photo included,
  with a disabled "Whose?" until one is picked;
- the line button gives way to **"Paid with my own card"**, which turns the
  form back: an item charged to the photo's taker, or to nobody, becomes Mine
  again;
- the whole-receipt "This was …'s" box is hidden;
- the split line reads "Owed to the pot by `<name>` … · Shared …", or "Whose not
  chosen yet …";
- the receipt is held, with the reason shown, until every item left out names a
  person.

Picking whose an item is no longer clears the rows already found, since it
moves no amount the lookup reads. `fileAs`'s "shared whole" refusal is gone.

**Build 6.** On the period screen, a pot charge leaves its person's "Paid by"
list and is listed under **"Owed to the pot"**, with its total, a one-line
hint, "…, owed to the pot by `<name>`" and Remove. The stats card lines read
"Owed to the pot by `<name>`." The settlement figures are the API's, which
count the charge.

- **Tests that cover it:** `web/test/periods.test.tsx`, "lists a charge to the
  pot apart from what each person paid, and closes on the settlement that counts
  it (lg-91)", and the API side in `api/test/receipts.test.ts`, "files one
  charge to the pot in the row's period … moves the settlement by (1 − r) × c".
- **Not covered:** `e2e/layout.spec.ts`. Its seed files no receipt, so the new
  block's fit at 360 px is unmeasured. That is an open decision in the report.

**For lg-94**, what this changed in its functions, all in `Receipts.tsx`:

- **`whose`** has a new first branch, used only when paid jointly. It answers
  `item.chargedTo` when it is a current member, and `null` otherwise. It never
  falls back to `other`. The line branch is unchanged.
- **`itemOf`** is unchanged.
- **`unfileable`** gains a `NOBODY_CHOSEN` branch when paid jointly, and its
  `NOBODY_ELSE` branch now applies only when not paid jointly.
- **The select** is now two: a new joint one, and lg-90's, unchanged, rendered
  only when not paid jointly.

In the API, a departed member named on a row is refused by `requireRowItems`
("An item on a joint-account row is charged to a current member of the
household."). On a line, `chargedToOf` still takes one.

**What the brief and the dispatch had wrong:**

- **The trial count.** The intake entry above says `the settlement's promise,
  simulated` uses 2,000 trials. It runs 500 seeds,
  `for (let seed = 1; seed <= 500; seed++)`. The 2,000-trial loop is
  `after the asked deposit is paid`. The new simulation follows the owner's
  wording: 2,000 seeded trials each for two and three people. It is in a new
  `describe` at the end of the file, so the merged records' lines do not move.
- **Rounding.** Build 1's "rounded so the nets still sum to zero" needs no
  rounding. `r_i` is parts per million and `c` is cents, so every term is a
  whole number of millionths of a cent, and the sum is exact.
- **A stale line in `tools/ledger/CLAUDE.md`.** Line 259 still says "on a row
  every item is shared". It is not edited here, because the Build does not name
  it. The report proposes the replacement.

**Fold-ins: none.** The only free piece in reach was that `CLAUDE.md` line, and
the dispatch forbids folding into a `CLAUDE.md`.

**Checks** (worktree, branch `lg-91-pot-charges` off `83eac952`):

```
npx vitest run tools/ledger/books/test/settlement.test.ts   Tests  41 passed (41)
  mutation: each other member's share + 1 ppm in netsOf's pot loop
    for 2 people: 10 trials failed; the first was seed 20208, off by 578285, -578285
    for 3 people: 1 trials failed; the first was seed 30883, off by 1001548, -601940, -399608
    (and 4 of the worked examples failed; restored from 7d15295a)
npx vitest run tools/ledger/api/test/receipts.test.ts \
  …/schema.test.ts …/stats.test.ts …/periods.test.ts        Tests  175 passed (175)
npx vitest run tools/ledger/web/test/receipts.test.tsx      Tests  51 passed (51)
npx vitest run tools/ledger/web/test/periods.test.tsx \
  …/stats-rows.test.tsx …/generated-ids.test.tsx           Tests  56 passed (56)
npm run check                                               exit 0
npm test -- --project ledger                                Test Files 99 passed (99), Tests 2159 passed (2159)
E2E_PORT=8118 npm run e2e:ledger                            33 passed (43.7s), exit 0
```

`Period-360.png` was opened. The per-person lists drew as before, with no
charge to the pot in the seed.

### 2026-11-01, the owner's answers to the build's open decisions

Relayed by the coordinator after the build report.

1. **How the receipt screen switches to paying jointly.**
   - Options: (a) as built, through the "Paid with the joint card?" button;
     (b) an explicit "Paid with" switch; (c) ask whose each item is at "Attach
     to this row".
   - **Chosen: (a)**, the builder's recommendation. No change.
2. **E2e coverage of the "Owed to the pot" block.**
   - Options: (a) leave it unmeasured, the builder's recommendation; (b) seed a
     receipt filed on a joint row in `e2e/layout.spec.ts`'s seed, and measure
     the block at 360 px and 1280 px.
   - **Chosen: (b)**, on the coordinator's recommendation, because the repo's
     360 px rule is checked by `layout.spec.ts` and this is a new block.
   - The answer also asks for three things:
     - any other screen's layout case whose seeded figures move is updated;
     - the new case is shown to fail on a seed without the receipt, or the
       reason it cannot be is given;
     - the 360 px screenshot is opened and described.
   - Built in the entry below.
3. **Done when 1's trial count.**
   - The premise was wrong: the dispatch's relay said
     `the settlement's promise, simulated` runs 2,000 trials, and it runs 500
     seeds. The intake entry above repeats the mistake.
   - Options: (a) keep 2,000 trials each, as built, measured at 65 ms and 48 ms
     on the build's head; (b) drop to 500 seeds, the existing convention.
   - **Chosen: (a), keep 2,000.** Done when 1 stays as reworded.

### 2026-11-01, round: the e2e case for "Owed to the pot" (answer 2)

**The seed.** `seed` in `e2e/layout.spec.ts` now ends with `fileOnJointRow`.
It uploads the spec's PNG and files a receipt on the paste's September
insurance row (−89.99 $):

- "Habitation", 60.00 $, shared;
- "Automobile", 29.99 $, sam's.

It is filed after the September close. That way the charge is late into the
open period, and the closed period's recorded settlement (`29.27 $` on Stats)
does not move. The row stays in the inbox, unfiled, so nothing charts it, and
the charge charts as a September card line.

**The new case** is
`Period fits a phone and a desktop with a charge to the pot listed apart`, at
the end of the file. It checks:

- the "Owed to the pot" list has one item, with the full label and `29.99 $`;
- at each width, the label, the amount and Remove each lie inside the window,
  besides `fitsBothWidths`' own measures.

**Other cases whose seeded figures moved: none.** Two figures did move:

- The open period's settlement on the Period screen went from "sam deposits
  38.57 $ / Or pays alex 22.04 $ directly" to "68.56 $ / 39.18 $". That is
  22.04 $ plus 0.571429 × 29.99 $, which is 39.18 $.
- Stats' September spending gained a 29.99 $ uncategorised card line.

No case asserts either figure. The first full run passed every case unchanged.

**Red, on a seed without the receipt.** The filing call was guarded off
(`if (sam === "")`), and the new case was run alone:
`E2E_PORT=8118 npm run e2e:ledger -- --grep "charge to the pot listed apart"`.
It failed, exit 1:

```
✘ … layout.spec.ts:1294:1 › Period fits a phone and a desktop with a charge to the pot listed apart (16.4s)
  Error: expect(locator).toHaveCount(expected) failed
  Expected: 1
  Received: 0
  > 1299 |   await expect(owed.getByRole("listitem")).toHaveCount(1);
```

The file was then restored from `f0b0860d`.

**Green.** `E2E_PORT=8118 npm run e2e:ledger` passed 34 of 34 (43.6 s), exit 0.

**`Period (owed to the pot)-360.png`, opened.**

- The open-period card shows "Paid by alex 119.73 $" with its three lines,
  then "Paid by sam 0.00 $ / Nothing yet.", then the new block.
- The block is "Owed to the pot 29.99 $", the hint in muted type, and one line.
  Its label "2026-09-01 · Assureur Exemple, habitation et automobile, owed to
  the pot by sam, entered after its period closed" wraps to six lines in the
  left column, with "29.99 $" and the Remove button on the right.
- Nothing runs past the card's right edge.
- The close card reads "sam deposits 68.56 $ into the buffer. / Or pays alex
  39.18 $ directly."

- 2026-11-01 — At the owner's direct instruction, the orchestrator replaced `tools/ledger/CLAUDE.md`'s "on a row every item is shared" with the builder's wording. The builder had declined the edit on a relayed instruction, as its role page requires.
