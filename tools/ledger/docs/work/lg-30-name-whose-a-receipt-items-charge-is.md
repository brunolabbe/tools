---
id: lg-30
tool: ledger
title: Name whose a receipt item's charge is, among more than two people
kind: work-package
status: ready
milestone: P6
depends_on: [lg-23]
difficulty: hard
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

"More than two" in lg-23's refusal counts every name the books hold, departed
ones included, so this ticket should count the household's current members
instead (owner, 2026-10-17: acceptable until lg-30).

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

**Answered: A, on each item** (owner, 2026-10-17, through `AskUserQuestion`; the
question and options are in the Log). The change to `@ledger/contract` below is
approved in this shape.

**The one choice inside A: a `chargedTo` beside `share`, not `{ theirs: personId }`
as the share.** The code settles it, so it is not left open:

- `share` is stored as text under `CHECK (share IN ('shared', 'not-shared',
'theirs'))` (`api/src/db/schema.ts`, migration 9). An object-valued share would
  need that column rebuilt or a JSON text in it; a `chargedTo` is one added
  column, and the CHECK stays.
- The three strings are compared, used as a key or a CSS class in `books`
  (`splitReceipt`), `api` (`fileReceipt`, `fileLines`) and `web`
  (`NEXT_SHARE`, `nextShare`, and the `item ${item.share}` class on each item). They keep
  compiling and working unchanged.
- The floor of this ticket says a two-person filing keeps its current request. A
  request with `share: "theirs"` and no name is valid today. With `{ theirs:
personId }` as the only form it stops being valid; keeping both makes two
  spellings of one thing. With `chargedTo` it stays valid: `chargedTo` omitted on
  a `theirs` item means "the household's one other member", as it means today.
- The cost of `chargedTo` is two combinations the type can say and must not
  accept: a name on an item that is not `theirs` (refused by the schema), and a
  `theirs` item with no name among more than one other member (refused by the
  API, which has the household).

## Build

Do not widen: the shape of the contract change is given here, and a different
one is a stop and a question, not a choice. Storage details marked _suggested_
may vary if the Log says what changed and why.

1. **`@ledger/contract`** (`contract/src/receipts.ts`, `contract/src/api.ts`).
   - `ReceiptItem` gains `chargedTo: string | null`. `receiptItemSchema` takes
     it as `z.string().min(1).max(100).nullable().default(null)`, so a request
     that omits it parses as before, and refuses a non-null `chargedTo` on an
     item whose `share` is not `theirs`. `null` on a `theirs` item means "the one
     other current member", which the API resolves (step 3).
   - `ReceiptFiling` gains `charges: ReceiptCharge[]`, with `ReceiptCharge =
{ chargedTo: string; lineId: number }`: every charge line the filing made,
     one per person, in the order each person's first `theirs` item is printed,
     including a charge that is also `periodLineId`. `chargeLineId` keeps its
     meaning exactly as documented today and is not removed: the charge filed
     beside a shared line, or the first of them when there are several, and
     `null` when nothing was shared. So a two-person filing reads as before,
     with `charges` added.
   - Nothing else in the contract changes. In particular `PeopleResponse` stays
     as it is: the owner chose on 2026-10-17 not to add a `members` field, and the
     screen counts current members from the household record (step 6).
   - Update the comments on `ItemShare`, `ReceiptDestination` and
     `ReceiptFiling.chargeLineId`, which say "the other person".
2. **`books/src/receipts.ts`, `splitReceipt`.** Return
   `charges: { personId: string | null; cents: number }[]`, one entry per
   distinct `chargedTo` among the `theirs` items, in the order first printed
   (`null` is its own entry, which only the web's preview meets) and whatever
   its cents, a zero included (step 3 files no line for it), and keep
   `chargedCents` as their sum so `sharedCents + notSharedCents + chargedCents`
   still equals what was paid. Each person's cents is computed the way
   `sharedAmount` computes an excluded set: that person's items together, price,
   deposit and taxes, rounded once. The sum of those can differ by a cent from
   rounding every `theirs` item together; the shared line takes the difference,
   as it does for every other rounding in this function, so the three parts
   always make the payment. **One exception, measured on `BASKET`** (Log): when
   rounding the parts apart (the not-shared items, and each charged person's)
   overshoots the payment, the shared amount would be -1 and `fileLines` would
   refuse it as "more comes off than was charged" on a receipt that adds up. Two
   receipts show it. Every item charged: casey's items 1 and 3 are 923, sam's
   item 2 is 1,554, and together they are 2,477 against 2,476 paid. And a mixed
   one: item 1 not shared (349), item 2 casey's (1,554), item 3 sam's (574), which
   are 2,477 again, while the three rounded together are 2,476 and the shared
   amount is 0. When the shared amount computed with every item that comes off
   (the not-shared ones and every `theirs` one) rounded together is zero or has
   the payment's sign, but the one computed with the parts rounded apart has the
   opposite sign, the excess is rounding and nothing else. **That test is
   superseded** (owner, 2026-10-17, Log, on gate 1 of lg-32, F1): the rounding is
   judged against the **printed total**, not against the items rounded together.
   The items rounded together are exact taxes rounded once, and a till prints GST
   and QST each rounded separately, so the printed total can sit a cent either
   side of that number, and the old test cannot tell a real shortfall from the
   till's rounding. The rule, for a receipt with **nothing left shared** (every
   item is not shared or `theirs`, so `itemsAddUp` guarantees the items make the
   printed total): when the payment is **at or beyond the printed total, at its
   sign**, whatever the parts rounded apart leave over the payment is rounding, up
   to 2 cents (one from printed against exact taxes, one from rounding the parts
   apart), and the shared amount is 0. When the payment is **under the total**,
   in size at its sign, nothing is adjusted and the receipt is refused with the
   existing message. Two receipts the rule must handle, each a 10,00 $ taxable
   item not shared and a taxable item `theirs`, `checkReceipt` raising nothing on
   either (measured through `splitReceipt` on lg-32's branch after its F2 fix, which still
   has the old test):
   - **10,07 $ `theirs`, GST 100, QST 200, total 2,307, paid 2,307.** The parts
     apart are 1,150 and 1,158, which is 2,308 against 2,307 paid, and the items
     together leave -1, so the old test sees a real excess and refuses it: the
     failure lg-32's Why describes. The payment is the total, so the cent is
     rounding: not shared 1,149, charged 1,158, shared 0, and the filing is 200.
   - **10,12 $ `theirs`, GST 101, QST 201, total 2,314, paid 2,313.** The old
     test files it on lg-32's branch (not shared 1,149, charged 1,164, shared 0).
     The payment is a cent under the printed total, so it is **refused**,
     `BAD_REQUEST` with the existing message.

   **Take it off the not-shared amount when there is one** (owner, 2026-10-17, Log): that part is
   the payer's own, no line records it and nobody owes it, so the cent costs no
   one anything. **With no not-shared items, take it off the charge largest in
   size** (by `Math.abs`, as `splitByCategory` compares), the earlier on a tie,
   moving that charge toward zero by the excess. Either way the shared amount is 0. So the mixed receipt gives not shared 348, casey 1,554, sam 574, shared 0;
   and the every-item-charged one, with no not-shared amount to take it from, gives
   casey 923, sam 1,553. On a refund the amounts are negative: `BASKET` negated
   (deposit included), every item `theirs`, casey on items 1 and 3 and sam on
   item 2, gives -923 and -1,554 and a shared amount of +1, and sam's is the
   largest in size, so it becomes -1,553. That is the guard `splitByCategory` uses
   for its largest category. **lg-32 builds the guard for a receipt with no charged
   person at all, with the old together test** (it merged that way on the owner's
   answer to its F1, Log), so this ticket's builder **replaces that test with the
   printed-total one above in the same guard** and does not add a second guard.
   With one person charged and nothing not shared the parts-computations are the
   same number, but the printed-total test still decides lg-32's two receipts
   above; a payment under the printed total is the person's mistake and is still
   refused. Where lg-32's own tests pin the old test, this ticket's builder keeps
   them true or rewrites them, and says which in the Log.

3. **`api/src/receipts.ts`, `fileReceipt` and `fileLines`.**
   - Resolve each `theirs` item's name first, inside the transaction and before
     anything is written: a given `chargedTo` is used as given; a `null` is the
     household's one current member who is not the payer, and is a `BAD_REQUEST`
     whose message contains "name whose" when there are several (the line's own
     words, so a test can pin them), and the existing "nobody else in the
     household" one when there is none. Store and answer the resolved name,
     never `null`, on a `theirs` item (items stored before this change whose
     charge came to nothing are the one exception, step 4).
   - The route passes the household's current members (`directory.people(household)`,
     as `books.ts` already reads it) in alongside the period context; `fileLines`
     today reads `context.people`, which holds every name ever enrolled, and that
     is what lg-23's refusal counted.
   - A name given is accepted as `POST /api/period-lines` accepts one: any name
     the books hold that is not the payer. It need not be a current member, so a
     charge to someone who has since left stays possible and the screen offers
     current members only. A name that is the payer's, or that the books do not
     hold, is a `BAD_REQUEST` (`requireLinePeople` already says both).
   - **Lift lg-23's refusal** (the `others.length > 1` branch in `fileLines`, and
     its message).
   - File one charge line per person from `split.charges`, after the shared
     line, in `split.charges` order, **except for an entry that comes to 0 cents:
     that files no line** (`period_lines.amount_cents` has `CHECK (amount_cents <>
0)`, and `fileLines`' own header says a part that comes to nothing files no
     line). A free or netted-out item marked `theirs` is stored with its resolved
     `charged_to` and no `charge_line_id`, and is not in `charges`. Each line
     carries that person's cents, `chargedTo`
     that person, and its category when all of that person's items share one,
     else the destination's, as the one charge does today. `periodLineId` is
     still the first line filed; `chargeLineId` is the first charge filed beside
     a shared line, else `null`; `charges` lists all of them.
   - A receipt on a row stays shared whole: a `theirs` item on one is refused as
     now (`to: "row"`).
4. **Storage** (a migration 11 in `api/src/db/schema.ts`; _suggested_). Two
   columns on `receipt_items`: `charged_to TEXT REFERENCES people (id)` and
   `charge_line_id INTEGER REFERENCES period_lines (id)`, set on `theirs` items
   only. `ALTER TABLE … ADD COLUMN` cannot carry a CHECK that every `theirs`
   item has a name over rows that do not yet, so either keep the invariant in
   `fileReceipt` and test it, or rebuild the table as migration 7 did; the
   builder picks and the Log says which. A `theirs` item with no
   `charge_line_id` means its charge came to nothing. Backfill every stored
   `theirs` item from its filing: `charge_line_id` is
   `receipt_filings.charge_line_id`; else `period_line_id` **only when that
   line's own `charged_to` is not null** (when nothing was shared the one line
   is the charge, and it is charged to the other person; a shared line, which
   lg-10 filed alone when the `theirs` items came to 0, has `charged_to` null
   unless the whole receipt was marked as the other's, and must not be taken
   for a charge); else the item keeps both columns null. `charged_to` is that
   line's own `charged_to`, read from the row the filing names, not from a later
   version of it. The residual this leaves, a whole-receipt `chargedTo` on a
   filing whose `theirs` items cost nothing, reads its shared line as the
   charge; the Log names it. `toFiling` builds `charges` from the items that
   have a `charge_line_id`, distinct by line. `receipt_filings.charge_line_id`
   keeps being written.
5. **Reader and other literals.** `receipts/src/reader.ts` builds its items with
   `chargedTo: null`; `api/src/stats.ts` builds `ReceiptItem` literals for
   `splitByCategory` and does the same. A type error names any other.
6. **`web/src/receipts/Receipts.tsx`.**
   - Current members come from the household record that lg-22 built, not from a
     contract change: the screen calls `fetchMe` from
     `web/src/api/me.ts` (it answers `MeResponse`, so `person.household`; not the
     `fetchMe` in `web/src/api/periods.ts`, which `periods/Periods.tsx` imports and
     which answers a bare person id) and then `fetchHousehold(person.household)`
     (`GET /api/households/:id`, which answers a member their own household), and
     takes the distinct `members[].person` as the current members. It uses
     those, in place of `fetchPeople`'s every name, where it counts `people`
     today (`several`, `other`), and offers them in both pickers. The tests in
     `web/test/receipts.test.tsx` that mock `fetchPeople` mock `fetchMe` and
     `fetchHousehold` instead.
   - **With one other current member** the screen is as it is now: an item cycles
     shared, not shared, `${other}'s`, and sends `share: "theirs", chargedTo: null`.
   - **With more than one**, the cycle includes `theirs` again (remove the
     `nextShare` guard and its lg-23 comment), and an item marked `theirs` shows a
     select, labelled `Whose is <item name>`, offering the other current members
     and not the payer; it starts on the first. The item's button reads
     `${chosen}'s`. The request carries the chosen name on that item.
   - **"What is shared"** shows each person's charge, one per person, in the
     order of `split.charges`, and the "said" message after filing names each
     person charged, from `filing.charges`.
   - **The whole-receipt `chargedTo`.** With more than one other current member,
     the "This was someone else's" checkbox and a "Whose it was" select, as
     `periods/LineForm.tsx` has them, replace the lg-23 hint that sends the person
     to the period screen; with one, the existing checkbox is unchanged. The API
     already takes `destination.chargedTo`, so this is the screen only.
     (Unchanged and not widened: a whole-receipt `chargedTo` and a `theirs` item
     to the same person file a shared line and a charge both to them, as now.)
7. **Docs.** `tools/ledger/CLAUDE.md` (the receipts paragraph's sentence "With
   more than two people 'the other's' names nobody, so it is refused until an
   item can say whose (lg-23, lg-30)") says what is true afterwards.
   `tools/ledger/docs/00-ANALYSIS.md` "Charges between the two" needs a line only
   if its text says a charge is to _the_ other person of a receipt item; check
   and say in the Log either way.
8. Rewrite lg-23's two tests that pin the refusal
   (`api/test/receipts.test.ts`, "an item marked as the other's, among more than
   two"; `web/test/receipts.test.tsx`, "among three people, an item cycles…") to
   the behaviour below. Add the new tests at the end of their files.

## Done when

Test names are the builder's; a line is proved by a test that fails on the
parent of the change and passes on it, and the Log says which command showed
each. **Two kinds of clause are outside that**, because the parent already
satisfies them, and are marked _regression_ where they occur: a refusal the
parent already makes, and a refusal the parent makes with the same words. A
`strictObject` item schema refuses any `chargedTo` today as `unrecognized_keys`
(`The filing is not valid: check proposal.`), so a request carrying `chargedTo`
is refused with zero rows on the parent whatever it names; a refusal is proved
new only by its message, or by a paired request that is accepted.

1. **API, three people, two names.** Alex, casey and sam in the household, alex
   uploaded, `BASKET` marked with item 2 `theirs` to casey and item 3 `theirs` to
   sam, 2,476 charged: 200, and `period_lines` holds exactly three rows, all paid
   by alex: 348 shared, 1,554 `charged_to` casey, 574 `charged_to` sam, summing
   to 2,476; `charges` is `[casey, sam]` with those two line ids; the stored
   items carry `charged_to` casey and sam and the response's items carry them.
2. **lg-23's refusal is lifted.** `grep -rn "more than two people in the
household" tools/ledger/api/src tools/ledger/web/src` prints nothing, and
   the lg-23 refusal test is gone or inverted to line 1.
3. **A `theirs` item with no name among three: refused.** The same request with
   `chargedTo: null` on a `theirs` item, in a household of three current
   members: `BAD_REQUEST` whose message contains "name whose" (on the parent the
   message is "The filing is not valid: check proposal."), zero rows in
   `period_lines` and in `receipt_filings`.
4. **Two people keep their requests and results.** The existing lg-10 test "an
   item marked as the other's becomes a charge…" passes with its request
   unchanged except for the field `chargedTo: null` its helper now writes, and
   with `periodLineId`, `chargeLineId` and the two lines it asserts (348 shared
   and 1,554 `charged_to` sam) exactly as it asserts them today; `charges` is `[sam]` with
   `chargeLineId`'s id; the stored item says `charged_to` sam.
5. **Refused combinations, each filing nothing** (zero rows in `period_lines`
   and `receipt_filings` after each), pinned by message:
   - `chargedTo` naming the payer: "A charge is owed by the other person, not by
     whoever paid." (`requireLinePeople`).
   - `chargedTo` naming a name the books do not hold: "That person is not one of
     the household." (`requireKnownPerson`).
   - `chargedTo` on a `shared` item and on a `not-shared` item, two requests:
     "The filing is not valid: check proposal." Same words as the parent's, so
     each of these two is proved only as a pair with line 1: the same name on a
     `theirs` item is accepted, on these two it is refused.
   - _Regression:_ a `theirs` item on a `to: "row"` destination: "A receipt on a
     joint-account row is shared whole: every item on it stays shared." The
     parent refuses it with the same words.
6. **A departed name.** A household whose books hold three names and whose
   directory holds two current members files a `theirs` item with `chargedTo:
null` as a two-person filing does (to the one other current member); and the
   same item with `chargedTo` naming the departed name files a charge to them.
7. **Nothing shared, two people charged.** `BASKET` with item 1 and item 3
   `theirs` to casey and item 2 to sam, 2,476 charged, in a household of three:
   200, two charge lines and no shared one. `periodLineId` is casey's line (923),
   `chargeLineId` is `null`, `charges` has two entries, and sam's line is 1,553
   (the cent the rounding overshot comes off the charge largest in size, Build
   2); the two make 2,476. The same on the refund: every `BASKET` price, deposit,
   tax and the total negated, `-2,476` charged, the same marks: casey's line is -923 and
   sam's is -1,553, which make -2,476 (sam's is the largest in size, casey's the
   largest by value). _Regression:_ a payment under the printed total (with one
   person charged or several) is refused with the existing `BAD_REQUEST` ("More comes
   off this receipt than the card was charged. …"), as now.
8. **`splitReceipt`** (`books/test/receipts.test.ts`): `charges` has one entry
   per distinct `chargedTo`, in first-printed order; `sharedCents +
notSharedCents + chargedCents` equals the payment in each case the existing
   `splitReceipt` tests assert, and on `BASKET` with item 2 to casey and item 3
   to sam, where the two rounded apart are 1,554 and 574 (2,128) and rounded
   together are 2,127, so the shared amount is 348, not 349. Run that case first
   against a `splitReceipt` that rounds every `theirs` item together and watch
   it fail.
9. **Migration 11** (`api/test/schema.test.ts`): a database built at version 10
   holding three filings with `theirs` items migrates: one with a shared line
   and a charge line, one with the charge as its only line, and one whose
   `theirs` item is priced 0 (lg-10 filed only a shared line, with
   `charge_line_id` null and `charged_to` null on it). After it, each `theirs`
   item in the first two filings has `charged_to` and `charge_line_id` equal to
   its filing's charge line's, and `toFiling` answers `chargeLineId` as before
   and a one-entry `charges`; the third has both columns null and `charges` is
   `[]`, and its shared line is not listed as a charge.
10. **The screen counts current members from the household record**
    (`web/test/receipts.test.tsx`): opening the receipt screen calls `fetchMe`
    (the one in `web/src/api/me.ts`) and then `fetchHousehold` with the
    `household` that `fetchMe` answered, and does not call `fetchPeople`; the
    people it counts are the distinct `members[].person` of that answer.
    `ROUTES.people` and `PeopleResponse` are unchanged: an API test shows `GET
/api/people` answers exactly the one key `people`, and `PeopleResponse` in
    `contract/src/api.ts` has the one field it has today. (No clause pins a file
    diff: `api/src/routes/rules.ts` holds `ruleContext`, which Build 3 may extend
    to pass the current members in.)
11. **Web, three current members** (`web/test/receipts.test.tsx`): tapping an
    item through its cycle reaches `theirs`; a select named `Whose is <item>`
    offers the two other members and not the payer; choosing sam on one item and
    casey on another, and filing, calls `fileReceipt` with those two names on
    those two items; "What is shared" shows both charges; the message after
    filing names both.
12. **Web, two current members and one departed name:** the household record's
    `members` answers two names while its `history` also names a third who has
    left. The screen is the two-person one: no "Whose is" select, no "someone
    else's" checkbox, the cycle reaches `${other}'s`, and the `theirs` item in
    the request carries `chargedTo: null`.
13. **Web, whole-receipt picker, three current members:** the checkbox reads
    "This was someone else's", a "Whose it was" select offers the two other
    members, and ticking it and choosing one files `destination.chargedTo` as
    that name; the lg-23 hint ("as a line charged to them") is gone.
14. **Docs:** `grep -n "refused until an item can say whose" tools/ledger/CLAUDE.md`
    prints nothing.
15. **A `theirs` item that costs nothing files no charge line** (API): `BASKET`
    with a fourth item priced 0, not taxable, no deposit, marked `theirs` to
    casey in a household of three, the other three items shared: 200, one line
    (the shared one), `charges` is `[]`, `chargeLineId` is `null`, and the stored
    item says `charged_to` casey with `charge_line_id` null. On the parent the
    same request is refused, since the item carries `chargedTo`, so this is
    proved new.
16. **A cent of rounding on a mixed receipt comes off the not-shared amount**
    (`books/test/receipts.test.ts`, and an API filing of it): `BASKET` with item
    1 not shared, item 2 `theirs` to casey and item 3 `theirs` to sam, 2,476
    charged, in a household of three. `splitReceipt` answers `notSharedCents` 348,
    casey 1,554, sam 574 and `sharedCents` 0, which make the 2,476 paid (the parts
    rounded apart are 349, 1,554 and 574, which is 2,477). The filing is 200 with
    two charge lines, casey's 1,554 and sam's 574, and no shared line. (The
    parent's `splitReceipt` rounds the `theirs` items together and answers
    `notSharedCents` 349 and `chargedCents` 2,127, measured; a filing that names
    casey and sam is refused there, so the filing is proved new.)
17. `npm run check` and the ledger suite (`npm test -- --project ledger`) pass at
    the branch's head; the pull request's own CI is green.

## Log

- 2026-10-17 — Filed by lg-23's builder in round 1, from the owner's answer to
  gate 1's F2. The status is `needs-decision` because the contract change is the
  owner's to approve.
- 2026-10-17 — The owner answered, through `AskUserQuestion`, and the ticket
  moves to `ready` in this commit. The question, the options and the choice, as
  they were put:
  - Question: "lg-30 (needs-decision): with more than two people, where should
    the contract name who a 'theirs' receipt item is charged to? Your answer
    makes lg-30 buildable in a later batch. It does not join this one."
  - **"A. On each item" (recommended by the ticket and the orchestrator):** share
    becomes { theirs: personId }, or gains chargedTo. Each item can go to a
    different person. ReceiptProposal, its schema, receipt_items and
    splitReceipt all change, and the filing names one charge line per person.
  - "B. On the filing": one field on FileReceiptRequest names the person for
    every 'theirs' item, keeping a single charge line. Smaller, but a receipt
    with items for two different people has to be filed twice, or partly by hand.
  - "Not now": stays needs-decision.
  - **Chosen: "A. On each item".**
- 2026-10-17 — Build and Done when written from the code at `6b42ee19`, by the
  builder that recorded the answer. No source changed. What the code settled:
  - **`chargedTo` beside `share`, not `{ theirs: personId }`.** The reasons are
    in the decision section. In short: `share` is a text column under a CHECK
    (migration 9), its three strings are compared in `books`, `api` and `web`,
    and a request with a bare `share: "theirs"` is valid today and is the
    two-person floor. So no question is open and the status is `ready`.
  - **The brief's "a charge per person" has a second consequence it did not
    name:** `ReceiptFiling.chargeLineId` is one number, and a filing can now
    make several charges. Done when's floor (two-person results as they were)
    rules out replacing it, so Build adds `charges` and keeps `chargeLineId`'s
    meaning. This is a contract addition the owner's answer covers in direction
    but not in its exact shape; it is written into Build 1 for the gate to see.
  - **The brief's "count current members" was wrong that the web had no other
    route to the directory** (this entry first claimed it needed a
    `PeopleResponse.members` addition). `GET /api/people` returns `knownPeople`,
    every name ever enrolled, but `GET /api/households/:id` (lg-22) answers a
    member their own household's current members. Withdrawn by gate 1's F1; see
    the later entry.
  - **A rounding point the brief did not mention**, measured with
    `splitReceipt` on `BASKET` (`PAIN` 349, `BIERE` 1,299 + 60 deposit, `SAVON`
    499, 2,476 paid), run through `npx tsx` against `books/src/receipts.ts`:
    items 2 and 3 `theirs` together give `chargedCents` 2,127 and `sharedCents`
    349; item 2 alone gives 1,554 and item 3 alone 574, which is 2,128 apart. So
    per-person rounding moves the shared line by a cent, and `BASKET` is itself
    the fixture for Done when 8. All three items `theirs` together give
    `sharedCents` 0, but split casey 1 and 3 (923), sam 2 (1,554) they are 2,477
    against 2,476 paid, so a shared amount of -1 would trip `fileLines`' "more
    comes off than was charged" refusal on a receipt that is wholly charged.
    Build 2 therefore takes that cent off the largest charge, as
    `splitByCategory` does, and Done when 7 is that case. This is a judgement
    the brief did not make; it is not an open choice with two readings, since
    the refusal would be wrong about a cent of rounding, but the gate should
    read it.
  - **`difficulty: standard` is probably low now.** Build touches `contract`
    (two additions, after F1), `books`, `api` (a migration with a backfill and a changed
    filing), `receipts`, and `web`, and the rounding and the backfill are
    judgement. `docs/01-TICKETS.md` rates a contract change by judgement, not by
    diff size. It was left at `standard` as the dispatch asked; `hard` is what
    this reads as. (Superseded in the next entry.)
- 2026-10-17 — Gate 1 (round 1) returned FAIL on `f0d197d3`, and the owner
  answered its decisions through `AskUserQuestion`. Recorded as put:
  - **F1, `PeopleResponse.members`.** The gate found it was a contract addition
    beyond the owner's answer, and that the screen can count current members
    from the household record (lg-22). Options: "Drop members" (recommended by
    the gate), "Approve members", "Back to needs-decision". **Chosen: "Drop
    members".** Build 1's `members` bullet and the old Build 5 are removed; Build
    6 (the screen) reads `fetchMe` then `fetchHousehold`; Done when 10 now asks
    for that. The only contract changes left are the two option A covers
    (`ReceiptItem.chargedTo`, `ReceiptFiling.charges`).
  - **F6, difficulty.** Options: "Re-rate to hard" (recommended by the
    orchestrator), "Keep standard". **Chosen: "Re-rate to hard"**, and the
    frontmatter now says `difficulty: hard`. The dispatch that told the first
    builder not to change it was wrong: `docs/01-TICKETS.md` says to rate the
    judgement the work needs "once the decision is answered", and that is when
    the answer is recorded.
  - **F8, a defect found on the way.** Options: "File as lg-32/lg-33", "Leave
    it". **Chosen: file it**, as lg-32 (the id was assigned by the orchestrator;
    `node scripts/next-id.mjs lg` names lg-31 as next free on this branch, held
    elsewhere). It is in this pull request. lg-30's Build keeps the case
    refused, as the floor requires; lg-32 is the fix.
- 2026-10-17 — The gate's other findings, applied as stated. Each was
  reproduced on this tree first:
  - **F2** (`node --import tsx strict.mts $PWD`, the gate's script): today's
    `fileReceiptRequestSchema` refuses every item carrying `chargedTo`, null
    included, as `unrecognized_keys proposal.items.0`, so Done when 3 and 5
    passed on the parent. The preamble of Done when now names the two clauses the
    parent already satisfies; 3 pins the new "name whose" message; 5 pins each
    refusal's message and marks the row case as a regression clause; 7's second
    clause is marked _regression_. The two non-`theirs` refusals have the
    parent's own words, so they are proved only as a pair with line 1.
  - **F3**: Done when 4 says two lines (348 shared, 1,554 to sam); the 574 was
    arithmetic. Fixed.
  - **F4** (`measure.mts`: "zero-priced theirs item" gives `chargedCents` 0,
    `sharedCents` 2,476): Build 3 files no line for a 0-cent entry
    (`period_lines.amount_cents` has `CHECK (amount_cents <> 0)`), Build 4's
    backfill links the period line as the charge only when its `charged_to` is
    not null, and Done when 9 and 15 test both. **A residual the Build names:** a
    whole-receipt `chargedTo` on a filing whose `theirs` items cost nothing still
    has a shared line with `charged_to` set, and the backfill reads it as the
    charge. Three conditions at once; not tested.
  - **F5** (`measure.mts`: "refund idx0,2" -923, "refund idx1" -1,554, together
    -2,476): Build 2 says "largest in size", works the refund (casey -923, sam
    -1,554 to -1,553, shared +1 to 0), and Done when 7 tests it.
  - **F7**: Done when 12 says "the `theirs` item in the request carries".
  - Not applied: nothing was refuted.
- 2026-10-17 — Gate 2 (round 2) on `baa2a910`, and the owner's answer to its G4.
  Gate 1's and gate 2's full reports are on pull request #516's thread, as
  comments (no record is committed here: the ticket stays `ready`, so none is
  landed, and `--land` is not run). Each finding was reproduced on this tree
  first:
  - **G4, where a leftover rounding cent goes** (`measure2.mts`, "mixed": item 1
    not shared 349, casey 1,554, sam 574 are 2,477 against 2,476 paid; the three
    together are 0 shared). lg-30's Build 2 took it off casey and lg-32 off the
    not-shared part, so the answer depended on merge order. The owner answered
    through `AskUserQuestion`, as put:
    - Question: "lg-30 and the new lg-32 disagree on where a leftover rounding
      cent goes … Which rule should both tickets state?"
    - **"Not-shared first" (recommended by the gate and by lg-32's filer):** off
      the payer's not-shared amount when there is one, else off the charge largest
      in size. The cent costs nobody, since no line records the not-shared part.
    - "Always the largest charge": one rule for every case, but it moves what
      someone owes by a cent to fix the payer's own rounding.
    - "Keep the refusal": the receipt stays refused over a cent.
    - **Chosen: "Not-shared first".** Build 2 now says it, and Done when 16 pins
      the mixed receipt: not shared 348, casey 1,554, sam 574, shared 0. Those
      four numbers were checked, not copied: `measure2.mts` gives the parts 349,
      1,554 and 574 and the together-shared 0, so taking the one cent off 349 gives 348. lg-32 says the same rule and that its build is the same guard.
  - **G1:** Done when 10 no longer pins `git diff origin/main --
…/routes/rules.ts` is empty. `rules.ts` holds `ruleContext`, which every
    `ruleContext(context, request)` caller uses, including the filing route's;
    Build 3 may extend it. The clause asks for `GET /api/people` answering exactly
    the key `people`, and `PeopleResponse` as it is.
  - **G2:** Build 6 and Done when 10 name `web/src/api/me.ts`
    (`grep -n "fetchMe" tools/ledger/web/src/api/*.ts`: `me.ts` answers
    `MeResponse`, `periods.ts` a string). The gate's parenthetical, that
    `App.tsx` already holds `me` and could pass `household` down, is left as the
    author's call, as the dispatch said.
  - **G3:** Done when 7's refund negates every price, deposit, tax and the total.
    `measure2.mts`: with the deposit not negated, `RECEIPT_DOES_NOT_ADD_UP`.
  - Not applied: nothing was refuted. Done when 17 is the old 16, renumbered by
    the new 16.
- 2026-10-17 — Build 2's rounding test reworded to judge against the printed
  total, on lg-32's gate 1, F1, and the owner's answer (through `AskUserQuestion`,
  as put). This entry is in lg-32's pull request; only the ticket text changed
  here, the rule is this ticket's builder's to write.
  - **The finding (F1, `med`, no `Done when` line depends on it).** lg-32's
    guard decides "rounding" by the items taken off, taxes exact, against the
    payment, never against the printed total. Measured by the gate on 180,000
    two-item receipts with every item taken off: paying exactly the total, 13,825
    are newly filed and 12,890 are still refused; paying a cent under it, 7,985
    are newly filed that the base refused. The two receipts in Build 2 are its
    reproductions (F1 ran them through the API at lg-32's gated head).
  - Options as put: **(A, the gate's recommendation)** widen lg-32's rule in its
    own branch, with the same rewording here; **(D, offered by the orchestrator)**
    land lg-32 as built and fix it in this ticket; **(B)** land lg-32 and file a
    follow-up; **(C)** accept the refusal for a printed-tax cent.
  - **Chosen: D, which overrides the gate's A.** lg-32's code is unchanged for
    F1 and its gate record keeps F1 as written, unfixed; this ticket's Build 2
    now states the printed-total rule and the two receipts. Where the cent goes is
    still "not-shared first" (the earlier answer stands).
  - **Done when, checked and not edited.** 16's numbers (not shared 348, casey
    1,554, sam 574, 2,476 paid against a 2,476 total) and 7's (923 and 1,553; the
    refund) are unchanged by the rule: each pays the printed total. 7's regression
    clause names "the excess shows with the people rounded together too (more is
    charged than was paid)": its parenthetical is a payment under the total, which
    the new rule still refuses, but the lead phrase names the test this entry
    supersedes, since lg-32's 2,307 receipt shows its excess together and now
    files. A builder pins the regression with a payment under the printed total.
    The line is for the orchestrator to reword if it reads as wrong.
- 2026-10-17 — The owner answered Done when 7's wording, through
  `AskUserQuestion` (relayed by the orchestrator to this ticket's builder, who
  records it here before any source changes):
  - Question: "lg-30's Done when 7 regression clause reads 'a fixture where the
    excess shows with the people rounded together too (more is charged than was
    paid, with one person charged or several) is refused'; after the
    printed-total rule, the 2,307 receipt shows an excess rounded together yet
    must file, so should the line change?"
  - **"Reword to printed total" (recommended by lg-32's lander):** the lead
    phrase becomes "a payment under the printed total (with one person charged
    or several) is refused…", so the line cannot be read as the superseded
    together test.
  - "Leave as is".
  - **Chosen: "Reword to printed total".** Done when 7's regression clause now
    reads so; nothing else in the line changed.
- 2026-10-17 — Built, on `495a5b7a` (lg-32 merged as #519), in `6bf1a453`
  (contract and `splitReceipt`) and `c6e7cec1` (API, migration 11, screen, docs).
  What the brief had wrong, and the choices it left to the builder:
  - **"Up to 2 cents" holds to four parts, not past them.** Each part rounded
    once is off by at most half a cent and the printed total by under a cent, so
    `k` parts overshoot by under `k / 2 + 1`: at most `ceil(k / 2)` cents. Measured
    on random receipts whose printed taxes are the rates' own (`checkReceipt`
    clean), paid the total, every item taken off: 2 parts never over 1 cent; 3
    parts reach 2 (50 of 49,500); 6 to 10 parts, each item its own, reach 3 (4 to
    52 receipts in about 80,000 each). The gate's "2 cents with four or more
    parts" was low by one part: three reach it. `splitReceipt` takes
    `ceil(parts / 2)` (`roundingBound`), which is the Build's 2 for three or four
    parts and 3 for five or more; past it the excess is refused, so printed taxes
    that are not the marks' (an item marked taxable on a receipt with no tax
    lines) are not absorbed. "five people's parts can round 3 cents over the
    total, and that is still rounding" fails under a fixed 2-cent cap, and "an
    excess larger than rounding can make is not adjusted" fails with no cap
    (mutations below). **Open for the orchestrator:** the bound is arithmetic, not
    an owner's answer; a fixed 2 cents is the other reading.
  - **"Nothing left shared" is read by items**, as Build 2 defines it: no item
    is `shared`. A receipt with a `shared` item that costs nothing beside the
    2,307 receipt is refused, as lg-32 refused it ("a receipt with something
    still shared takes no adjustment"). Whether some receipt with a shared item
    that lg-32's together test filed is now refused was not measured.
  - **lg-32's tests, kept true.** In `books/test/receipts.test.ts`: "takes the
    cent the parts were rounded apart by off the not-shared amount", "does the
    same for the refund of it, negated", "still shows more than was charged,
    where the parts together come to more" and the COUPON test each gained the
    one `charges` entry their `toEqual` now meets, and nothing else; the third's
    2,475 is under the printed total, which a comment now says is the reason. The
    two API tests are unchanged and pass. lg-32's together test is gone from the
    guard, replaced in place, not beside it.
  - **Build 5 named `api/src/stats.ts`**; the `ReceiptItem` literal is in
    `api/src/slices.ts` (lg-28 moved it there). And "a type error names any
    other" missed one: `receipts/test/reader.test.ts`'s "returns each item as
    read, shared, …" compares the reader's items with `toEqual` on untyped
    literals, so only the ledger suite found it (1 failed of 1229); it now
    expects `chargedTo: null`.
  - **Storage: a rebuild, migration 7's pattern.** The header of
    `api/src/db/schema.ts` says nothing issues an `UPDATE`, and a backfill of two
    added columns is one; the rebuild copies with `INSERT … SELECT`, proves the
    copy, and carries two CHECKs: a name only on a `theirs` item, and a line only
    with a name. "Every `theirs` item has a name" is not a CHECK (a free one filed
    before this has none) and is kept by `fileReceipt`.
  - **Members reach `fileReceipt` as a fourth argument** from the route
    (`context.directory.people(household)`), not through `ruleContext`.
  - **lg-23's two tests rewritten in place**, the rest added at the end: API "is
    refused, and nothing is filed" is now "files a charge to each person the
    items name (lg-30)" (Done when 1); web "among three people, an item cycles
    between shared and not shared only, and the receipt is nobody's" is now
    "among three people, an item cycles to someone else's and names whose it is"
    (Done when 11).
  - **Words that changed for two people too.** The "said" line after filing is
    built from `filing.charges`, so a two-person receipt whose only line is the
    charge now ends "…and sam's items as a charge." where it said only "Filed as
    alex's line in the period."; and "Nothing on this receipt is shared or the
    other's" reads "…or someone else's". The "nobody else in the household"
    refusal now meets any `theirs` item, a free one included, as Build 3 says.
  - **A given name is checked before anything is written** (`chargedToOf`), not
    only by `addLine`: a free `theirs` item files no line for `addLine` to check.
    For a priced item the two give the same words, so Done when 5's payer and
    unknown-name tests cannot tell them apart.
  - **Residual, as Build 4 named it, untested:** a whole-receipt `chargedTo` on a
    filing before this whose `theirs` items cost nothing has its shared line read
    as the charge by the backfill.
  - **Docs.** `CLAUDE.md`'s receipts paragraph says what a `theirs` item names.
    `00-ANALYSIS.md` "Charges between the two" does call a receipt item's charge
    the other person's, so it gains one sentence pointing to lg-30.
  - **Fold-in: none.** `npm run status -- --tool ledger`: 1 open of 30, this one.
  - **Measured.** The branch's four touched specs against the parent's source
    (the source diff reversed, `contract` and `books` rebuilt, `dist` grepped for
    `roundingBound`: 0): 57 failed | 114 passed of 171, every new test among the
    failures; the API ones fail first on the parent's strict item schema
    (`The filing is not valid: check proposal.`), which the Done when preamble
    expects. Restored and rebuilt: 171 passed of 171. `splitReceipt` with every
    `theirs` item rounded together: Done when 8's case answers `sharedCents` 349
    and `chargedCents` 2,127 against 348 and 2,128. Mutations, each undone:
    no `notShared.length > 0` condition, 5 failed of 70; no largest-charge
    branch, 6 failed; largest by value, 1 failed (the refund); no printed-total
    test, 1 failed (the 2,313 payment); no nothing-shared test, 1 failed; a
    2-cent cap, 1 failed; no cap, 1 failed; the route passing every name the books
    hold, 1 failed (the departed member); a 0-cent charge filing a line, 1 failed
    (500); `chargeLineId` always the first charge, 4 failed; the backfill taking
    any line, 3 failed of 11. lg-32's `notShared.length > 0` is no longer an
    equivalent mutant.
