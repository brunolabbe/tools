---
id: lg-30
tool: ledger
title: Name whose a receipt item's charge is, among more than two people
kind: work-package
status: ready
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
   - `PeopleResponse` gains `members: string[]`: the names the household's
     current members stand under, a subset of `people` (which keeps holding
     every name the books have, departed ones included). The Why's "count
     current members" needs it; the web has no other way to tell.
   - Update the comments on `ItemShare`, `ReceiptDestination` and
     `ReceiptFiling.chargeLineId`, which say "the other person".
2. **`books/src/receipts.ts`, `splitReceipt`.** Return
   `charges: { personId: string | null; cents: number }[]`, one entry per
   distinct `chargedTo` among the `theirs` items, in the order first printed
   (`null` is its own entry, which only the web's preview meets), and keep
   `chargedCents` as their sum so `sharedCents + notSharedCents + chargedCents`
   still equals what was paid. Each person's cents is computed the way
   `sharedAmount` computes an excluded set: that person's items together, price,
   deposit and taxes, rounded once. The sum of those can differ by a cent from
   rounding every `theirs` item together; the shared line takes the difference,
   as it does for every other rounding in this function, so the three parts
   always make the payment. **One exception, measured on `BASKET`** (Log): when
   every item of a receipt is charged, rounding apart can overshoot the payment
   (casey's items 1 and 3 are 923, sam's item 2 is 1,554, and together they are
   2,477 against 2,476 paid), which would leave the shared amount at -1 and
   `fileLines` would refuse it as "more comes off than was charged". When the
   shared amount computed with every `theirs` item rounded together (what
   `splitReceipt` returns today) is zero or has the payment's sign, but the one
   computed with the people rounded apart has the opposite sign, the excess is
   rounding and nothing else: take it off the largest charge, the earlier on a
   tie, and the shared amount is 0. That is the guard `splitByCategory` uses for
   its largest category. With one person charged the two computations are the
   same number, so nothing changes there, and an excess the together-rounding
   shows too is still the person's mistake and is still refused.
3. **`api/src/receipts.ts`, `fileReceipt` and `fileLines`.**
   - Resolve each `theirs` item's name first, inside the transaction and before
     anything is written: a given `chargedTo` is used as given; a `null` is the
     household's one current member who is not the payer, and is a `BAD_REQUEST`
     that says to name whose when there are several, and the existing "nobody
     else in the household" one when there is none. Store and answer the
     resolved name, never `null`, on a `theirs` item.
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
     line, in `split.charges` order. Each carries that person's cents, `chargedTo`
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
   builder picks and the Log says which. Backfill every stored `theirs` item
   from its filing: `charge_line_id` is `receipt_filings.charge_line_id`, else
   `period_line_id` (when nothing was shared the one line is the charge), and
   `charged_to` is that line's own `charged_to`, read from the row the filing
   names, not from a later version of it. `toFiling` builds `charges` from the
   items, distinct by line. `receipt_filings.charge_line_id` keeps being written.
5. **`PeopleResponse.members`** (`api/src/routes/rules.ts`, the `ROUTES.people`
   handler): `directory.people(household)` for the caller's household, beside
   `knownPeople`.
6. **Reader and other literals.** `receipts/src/reader.ts` builds its items with
   `chargedTo: null`; `api/src/stats.ts` builds `ReceiptItem` literals for
   `splitByCategory` and does the same. A type error names any other.
7. **`web/src/receipts/Receipts.tsx`, `web/src/api/rules.ts`.**
   - `fetchPeople` keeps its signature for the callers that want every name; the
     receipt screen takes the household's current members from a second function
     (or a changed return) reading `members`, and counts those, where it counts
     `people` today: `several`, `other`.
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
8. **Docs.** `tools/ledger/CLAUDE.md` (the receipts paragraph's sentence "With
   more than two people 'the other's' names nobody, so it is refused until an
   item can say whose (lg-23, lg-30)") says what is true afterwards.
   `tools/ledger/docs/00-ANALYSIS.md` "Charges between the two" needs a line only
   if its text says a charge is to _the_ other person of a receipt item; check
   and say in the Log either way.
9. Rewrite lg-23's two tests that pin the refusal
   (`api/test/receipts.test.ts`, "an item marked as the other's, among more than
   two"; `web/test/receipts.test.tsx`, "among three people, an item cycles…") to
   the behaviour below. Add the new tests at the end of their files.

## Done when

Test names are the builder's; a line is proved by a test that fails on the
parent of the change and passes on it, and the Log says which command showed
each.

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
   members: `BAD_REQUEST`, zero rows in `period_lines` and in `receipt_filings`.
4. **Two people keep their requests and results.** The existing lg-10 test "an
   item marked as the other's becomes a charge…" passes with its request
   unchanged except for the field `chargedTo: null` its helper now writes, and
   with `periodLineId`, `chargeLineId` and the three lines' amounts and
   `charged_to` exactly as it asserts today; `charges` is `[sam]` with
   `chargeLineId`'s id; the stored item says `charged_to` sam.
5. **Refused combinations, four requests each filing nothing** (zero rows in
   `period_lines` and `receipt_filings` after each): `chargedTo` naming the
   payer; `chargedTo` naming a name the books do not hold; `chargedTo` on a
   `shared` item and on a `not-shared` item (the schema refuses both, which are
   two requests); a `theirs` item on a `to: "row"` destination.
6. **A departed name.** A household whose books hold three names and whose
   directory holds two current members files a `theirs` item with `chargedTo:
null` as a two-person filing does (to the one other current member); and the
   same item with `chargedTo` naming the departed name files a charge to them.
7. **Nothing shared, two people charged.** `BASKET` with item 1 and item 3
   `theirs` to casey and item 2 to sam, 2,476 charged, in a household of three:
   200, two charge lines and no shared one. `periodLineId` is casey's line (923),
   `chargeLineId` is `null`, `charges` has two entries, and sam's line is 1,553
   (the cent the rounding overshot comes off the largest charge, Build 2); the
   two make 2,476. And a fixture where the excess shows with the people rounded
   together too (more is charged than was paid, with one person charged or
   several) is refused with the existing `BAD_REQUEST`, as now.
8. **`splitReceipt`** (`books/test/receipts.test.ts`): `charges` has one entry
   per distinct `chargedTo`, in first-printed order; `sharedCents +
notSharedCents + chargedCents` equals the payment in each case the existing
   `splitReceipt` tests assert, and on `BASKET` with item 2 to casey and item 3
   to sam, where the two rounded apart are 1,554 and 574 (2,128) and rounded
   together are 2,127, so the shared amount is 348, not 349. Run that case first
   against a `splitReceipt` that rounds every `theirs` item together and watch
   it fail.
9. **Migration 11** (`api/test/schema.test.ts`): a database built at version 10
   holding two filings with `theirs` items, one with a shared line and a
   charge line and one with the charge as its only line, migrates; each `theirs` item in
   those two filings then has `charged_to` and `charge_line_id` equal to its
   filing's charge line's, and `toFiling` answers `chargeLineId` as before and
   a one-entry `charges`.
10. **`GET /api/people` answers `members`**: a household whose books hold three
    names and whose directory holds two current members answers `people` with
    three and `members` with the two (the people route's tests, with the
    departed name added through `enrollPeople`).
11. **Web, three current members** (`web/test/receipts.test.tsx`): tapping an
    item through its cycle reaches `theirs`; a select named `Whose is <item>`
    offers the two other members and not the payer; choosing sam on one item and
    casey on another, and filing, calls `fileReceipt` with those two names on
    those two items; "What is shared" shows both charges; the message after
    filing names both.
12. **Web, two current members and one departed name:** the screen is the
    two-person one: no `Whose is` select, no "someone else's" checkbox, the
    cycle reaches `${other}'s`, and the request carries `chargedTo: null`.
13. **Web, whole-receipt picker, three current members:** the checkbox reads
    "This was someone else's", a "Whose it was" select offers the two other
    members, and ticking it and choosing one files `destination.chargedTo` as
    that name; the lg-23 hint ("as a line charged to them") is gone.
14. **Docs:** `grep -n "refused until an item can say whose" tools/ledger/CLAUDE.md`
    prints nothing.
15. `npm run check` and the ledger suite (`npm test -- --project ledger`) pass at
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
  - **The Why's "count current members" needs a contract addition too:**
    `GET /api/people` returns `knownPeople` (every name ever enrolled), and the
    web has no other route to the directory, so Build 1 adds
    `PeopleResponse.members`.
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
    (three additions), `books`, `api` (a migration with a backfill and a changed
    filing), `receipts`, and `web`, and the rounding and the backfill are
    judgement. `docs/01-TICKETS.md` rates a contract change by judgement, not by
    diff size. It is left at `standard` as the dispatch asked; `hard` is what
    this reads as.
