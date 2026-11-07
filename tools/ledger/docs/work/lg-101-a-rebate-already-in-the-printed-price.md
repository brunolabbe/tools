---
id: lg-101
tool: ledger
title: A rebate already taken off the printed price is taken off a second time
kind: fix
status: done
milestone: null
depends_on: []
difficulty: hard
awaiting: Done when 6 — the owner's paid read of the four fixtures (read-rebate-fixtures.ts, four reads at Haiku 5.5, after the merge), the reading its four verdict lines all pass with exit 0, the Log recording them
---

# lg-101 — A rebate already taken off the printed price is taken off a second time

## Why

lg-89 folds a rebate into the item it reduces and reads the item's net as
`price + discount` (`books/src/receipts.ts`, `netPrice`). That assumes the
printed price is the price before the rebate. On many receipts the owner files,
it is not. The item's price is printed with the rebate already taken off, and
the rebate line (`RABAIS`, `ÉCONOMIE`) only shows what was saved. The reader
folds that line in anyway, so the rebate comes off twice and the items no longer
make the total.

**Reproduction (owner, 2026-11-03).** Most receipts with a rebate open with
"The items, deposits, rebates and taxes do not add up to the total. Correct
them to file." In synthetic form: an item printed `4.99`, a line `RABAIS -1.00`
under it, and a total of `4.99` with no tax. The reader answers
`price: 499, discount: -100`. `itemsAddUp` sums the net, `399`, against `499`
and fails, and `checkReceipt` flags `items-differ`. Clearing the Rebate field by
hand makes the receipt fileable, and that is what the owner does today.

## Decision — answered 2026-11-03 by the owner

Asked through `AskUserQuestion`: how should the ledger tell a rebate already in
the printed price from one that still has to come off?

- **The reader is told, and the arithmetic catches what it misses (chosen).**
  The prompt says some receipts print the price after the rebate. After every
  read, a deterministic check repairs a reading whose items make the total only
  with their rebates ignored.
- The arithmetic only: no paid read, but it cannot tell which item was already
  discounted when two repairs both add up.
- The reader only: if the model misreads, the error is still there.

## Build

**No contract change.** A rebate already in the printed price is not a discount
on that price, so such an item is stored as `price` = the printed price and
`discount: null`. That keeps `ReceiptItem.price`'s meaning ("as printed") and
`netPrice` unchanged, and the photo still shows the rebate line. Do not keep the
rebate as information on the item: that needs a new field, which is a change to
`@ledger/contract` and a stop and a question.

1. **`books/src/receipts.ts`.** Add `dropPrintedRebates(proposal)`, which
   returns the proposal unchanged when `itemsAddUp` already holds, or has no
   item with a `discount`. Otherwise it tries, in this order:
   - every item's `discount` set to `null`;
   - each subset of the discounted items with its discounts set to `null`,
     **only when there are at most 8 discounted items**, keeping the result only
     if **exactly one** subset makes `itemsAddUp` hold.

   It returns the first repair that adds up and is not ambiguous. If none
   does, it returns the reading unchanged, so the screen flags it as today.
   A repair must also leave `taxableFits` no worse than the reading had it. A
   repair that adds up while raising `taxable-differs` loses to no repair,
   because two wrongs can make a total. Comment why the subset search is
   bounded.

2. **`api/src/receipts.ts`.** Apply it to each proposal between `reader.read`
   and `checkReceipt` in the read route, so the flags and the screen see the
   repaired reading. Do **not** apply it in `fileReceipt`: what is filed is the
   form as the person left it, and a rebate they typed back in is theirs.
3. **`receipts/src/reader.ts`.** Add to `RECEIPT_PROMPT`'s rebate paragraph:
   when the printed price of an item already has the rebate taken off (the
   rebate line is shown for information, and the lines make the total without
   it), give the printed price and a `null` discount. Do not fold it. Update the
   file's header comment. Add a reader test on a recorded response of that
   shape.
4. **Fixture and paid read.** Add a fourth synthetic receipt beside lg-89's
   three in `receipts/test/fixtures/`: two items printed after their rebates,
   one rebate printed directly under its item and one three lines below it,
   naming its code. Extend `receipts/test/live/read-rebate-fixtures.ts` (and its
   expectations in `rebate-fixtures.ts`) to expect `discount: null` on both.
   That read is **the owner's paid read**: ask for it, do not run it. Record the
   command in the Log. lg-89's two `med` gate findings are in that script (the
   key file printed whole without a `LEDGER=` line, and `ANTHROPIC_CUSTOM_HEADERS`
   not refused). Fix both here: this ticket is the next one to run that script
   with a real key.
5. **Tests**, at the end of their suites: `books/test/receipts.test.ts` for each
   branch of `dropPrintedRebates`. Cover the all-items repair, a unique subset,
   two subsets that both add up (unchanged), nine discounted items (no subset
   search), a reading that adds up already (unchanged), and a repair that would
   raise `taxable-differs` (unchanged). Add an `api` read-route test proving a
   recorded double-counted reading comes back with no `items-differ`.

## Done when

1. `books/test/receipts.test.ts` proves each `dropPrintedRebates` case listed in
   Build step 5, including that an ambiguous or tax-worsening repair leaves the
   reading unchanged.
2. An `api` test proves that a reading of the reproduction's shape (`499`,
   `-100`, total `499`) comes back from the read route with `discount: null` and
   no `items-differ`, and that `fileReceipt` files a typed-back rebate as typed.
3. A reader test on a recorded response proves a rebate already in the printed
   price comes back with `discount: null`.
4. `read-rebate-fixtures.ts` refuses a key file of several lines with no
   `LEDGER=` line and refuses `ANTHROPIC_CUSTOM_HEADERS`, without printing
   either. A test proves both.
5. `npm run check` and `npm test -- --project ledger` pass.
6. The owner's paid read of the four fixtures leaves the fourth's two rebates
   unfolded and lg-89's three as before, and the Log records it.

## Review

**Gate: PASS** — 2026-11-07 · `1eafa0c6..b88c551e` · Sonnet 5.5, depth full

| Done when                                                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `books/test` proves each `dropPrintedRebates` case, an ambiguous or tax-worsening repair leaving the reading unchanged                                   | **proven** — `books/test/receipts.test.ts` › "a rebate already in the printed price (lg-101)", eight tests: "every rebate is taken out when that is what makes the total", "the one subset whose rebates make the total is taken out", "two subsets that both make the total leave the reading as read" (`toBe`), "searches the subsets of 8 rebated items, and not of one more", "a reading whose items already add up, or that carries no rebate, is returned as read", "a repair that would raise taxable-differs leaves the reading as read" (every-rebate path and subset path). Mutations went red on the named test: uniqueness `=== 1` → `>= 1`, the bound removed, the tax test removed from either path. The adds-up case does not discriminate (F3). 88 of 88. |
| 2. `api` test: the reproduction's shape comes back with `discount: null` and no `items-differ`; `fileReceipt` files a typed-back rebate as typed            | **proven** — `api/test/receipts.test.ts` › "a rebate the printed price already holds (lg-101)": "a read takes it back out before the check, so the reading is not flagged" (asserts `discount: null` and `flags` equal to `[]`) and "filing takes the form as the person left it: a rebate typed back in is filed as typed, and never repaired" (asserts a 422 `RECEIPT_DOES_NOT_ADD_UP` on the unrepaired reading, then a 200 with `-100` in the response and in `receipt_items`). Controls: the call removed from the read route turns the first red; the repair added to `fileReceipt` before the add-up check turns the second red (`expected 200 to be 422`); added after the check both stay green, an equivalent mutant. 82 of 82.                                 |
| 3. Reader test on a recorded response: a rebate already in the printed price comes back `discount: null`                                                    | **proven** — `receipts/test/reader.test.ts` › "the model reader's rebates already in the printed price (lg-101)" › "returns the two items of the fourth fixture whose prices hold their rebates at those prices, with no discount", and the prompt-wording test beside it. It proves the reader passes `null` through; whether the model gives it is row 6.                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4. `read-rebate-fixtures.ts` refuses a several-line key file with no `LEDGER=` and refuses `ANTHROPIC_CUSTOM_HEADERS`, printing neither; a test proves both | **proven** — `receipts/test/rebate-live-gate.test.ts` › "refuses several lines with no LEDGER= line, and repeats none of them" and "refuses ANTHROPIC_CUSTOM_HEADERS, and never repeats its value". Both pre-date the branch (lg-89's round); the branch changes one usage string in `paid-read.ts` and no logic. Also ran the script itself on both refusals: exit 2, no key or header text in the output.                                                                                                                                                                                                                                                                                                                                                               |
| 5. `npm run check` and `npm test -- --project ledger` pass                                                                                                  | **verified** — `npm run check` exit 0; ledger project 99 files, 2,208 of 2,208. PR #752's checks at `b88c551e`: check, test (ubuntu-latest), test (windows-latest, informational), e2e, docker, CodeQL, dependency-review all pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6. The owner's paid read of the four fixtures leaves the fourth's two rebates unfolded and lg-89's three as before, the Log recording it                    | **awaiting** — the owner runs the Log's command (`read-rebate-fixtures.ts --paid .claude/.keys <out.json>`, four reads at Haiku 5.5) after the merge, and the reading is its four verdict lines: `rebate-in-the-printed-price: pass` (0412 FROMAGE at 649 and 0631 LAIT at 479, both `discount: null`, no negative item left) with lg-89's three still `pass`, exit 0, recorded in the ticket's Log. Not run by this gate.                                                                                                                                                                                                                                                                                                                                                |

- **low** · F1 · no `Done when` line depends on it · `dropPrintedRebates` takes the every-rebate repair without asking whether another subset also adds up, so a reading with rebates of both signs (a returned item's positive rebate against a purchase's equal negative one) is repaired in silence when two repairs make the total, the case the ticket's Decision says the arithmetic cannot decide. Reproduced on a 3-item reading; 231 of 2,000 in a tie-heavy mixed-sign generator, 0 of 10,000 same-sign cases.
- **low** · F2 · no `Done when` line depends on it · the doc comment on `MAX_REBATES_SEARCHED` says a receipt with more rebates than the bound "is left to the person"; the every-rebate repair runs above it and repaired 568 of 1,468 such sweep cases. False in the safe direction (it repairs, it does not skip a repair).
- **low** · F3 · no `Done when` line depends on it · the "already add up" test cannot fail: with the early `itemsAddUp` return deleted `books/test/receipts.test.ts` stays 88 of 88, because for same-sign rebates the return is dead code. It matters only with rebates of both signs (141 of 2,000 mixed-sign readings changed under the mutation), which has no fixture.
- **dropped** · the rebate sign after #748: that change typed the form's Rebate field positive and negates it in `itemOf`; the contract's sign (negative on a purchase, opposite on a return) is unchanged, the repair is sign-blind on read and writes only `null`. Not a defect.
- **dropped** · the builder's claim that the typed-back half of Done when 2 cannot fail alone: it holds. No adding reading was changed in 12,000 cases, and `fileReceipt` is untouched by the diff.
- **dropped** · an in-price rebate line the model lists as its own negative item is not repairable by `dropPrintedRebates`; out of the ticket's scope (the paid read's `wrong()` fails it), not a defect.
- **sweep** · 12,000 readings (six generators, seeds 1 to 2,000 each): unchanged 3,779 already adding up, 210 with no rebate, 1,789 where no subset adds up, 629 ambiguous, 175 refused for `taxable-differs`, 900 over the limit; repaired 2,897 every-rebate, 1,621 by subset. Five planted mutations each turned the sweep red, so it can fail.
- **findings** · the hunt returned 6; 3 carried, 3 dropped.
- NFR: security ✓ (no new input; both paid-read refusals intact) · performance ✓ (1.3 ms worst case, 200 items, 8 rebated) · reliability ✓ (no throw on 12,000 readings and six hostile shapes) · maintainability — F2, F3.

## Log

### 2026-11-03 — filed (Claude Opus 5.5)

Filed from the owner's report on the receipt screen, with lg-102. lg-89 is not
wrong for receipts that print the price before the rebate; it never asked which
kind of receipt it had.

### 2026-11-07 — built (Claude Opus 5.5, builder)

Branch `lg-101-rebate-in-printed-price` from `1eafa0c6`.

- **Build 1.** `dropPrintedRebates` and `MAX_REBATES_SEARCHED = 8` in
  `books/src/receipts.ts`, exported from `books`. `npx vitest run
  tools/ledger/books/test/receipts.test.ts`: 88 of 88, eight of them the new
  `a rebate already in the printed price (lg-101)` block at the end of the suite.
  Mutations, each restored from the commit: the bound raised to 9 failed the
  `searches the subsets of 8 rebated items, and not of one more` test; `=== 1`
  made `>= 1` with no tax test failed the ambiguity test and the subset half of
  the tax test; the tax test dropped from the every-rebate repair failed `a
  repair that would raise taxable-differs leaves the reading as read`.
- **Build 2.** The read route runs `dropPrintedRebates` on each proposal
  before `checkReceipt`; `fileReceipt` does not. `npx vitest run
  tools/ledger/api/test/receipts.test.ts`: 82 of 82. With the call taken out of
  the read route, `a read takes it back out before the check` failed (`expected
  [ { price: 499, discount: -100 } ] to deeply equal [ { price: 499, discount:
  null } ]`); with it added to `fileReceipt`, the filing test failed (`expected
  200 to be 422`).
- **Build 3.** `RECEIPT_PROMPT`'s rebate paragraph and the header comment;
  two reader tests at the end of `receipts/test/reader.test.ts`.
- **Build 4.** `receipts/test/fixtures/rebate-in-the-printed-price.html` and
  its `.png`, rendered with `node --import tsx
  tools/ledger/receipts/test/live/render-rebate-fixtures.ts`, which re-rendered
  lg-89's three byte for byte (`git status` showed no change to them). The
  expectation is a new `unfolded` field on `RebateFixture`: each named item at
  its printed price with `discount: null`, and no negative item left. Three
  tests of it at the end of `receipts/test/rebate-live-gate.test.ts`.
- `npm run check`: exit 0. `npx oxlint tools/ledger/books tools/ledger/api
  tools/ledger/receipts`: exit 0.

**What the brief had wrong.**

- **Build 4's two lg-89 findings were already fixed**, on `main` with lg-89
  itself (#717, `25ef6ac7`): `receipts/test/live/paid-read.ts` has `keyFrom`
  (the `LEDGER=` line, refusing several lines without one) and
  `assertPaidReadConsent` (refusing `ANTHROPIC_CUSTOM_HEADERS`), which
  `read-rebate-fixtures.ts` imports, and `receipts/test/rebate-live-gate.test.ts`
  proves both: `refuses ANTHROPIC_CUSTOM_HEADERS, and never repeats its value`
  and `refuses several lines with no LEDGER= line, and repeats none of them`.
  Done when 4 is met by those; nothing was rebuilt.
- **Done when 2's "`fileReceipt` files a typed-back rebate as typed" cannot
  tell the two apart on its own.** `dropPrintedRebates` returns any reading that
  adds up as it is, and `fileReceipt` refuses any that does not, so a typed-back
  rebate that adds up files the same whether or not filing repairs. What filing
  without the repair changes is that the reproduction, filed unrepaired, is
  refused (`RECEIPT_DOES_NOT_ADD_UP`) rather than quietly filed without its
  rebate. The api test proves both halves, and the mutation above is what it
  catches.
- **Three things the brief left open, settled in the code's comments.** A
  rebate of `0` is no rebate to the search: counted, it would double every
  subset and make every repair ambiguous. The subset search includes the whole
  set, so a whole set refused for its taxes still makes a second subset that
  adds up ambiguous. And ambiguity is counted on `itemsAddUp` alone, before the
  tax test, as the owner's decision words it ("cannot tell which item was
  already discounted when two repairs both add up"): the tax test then decides
  only whether the one repair is taken.

**Fold-in.** Nothing else was made free by this work.

**Done when 6, for the owner.** Four paid reads at Haiku 5.5, from the root of
a checkout of this branch, with the key file holding a `LEDGER=` line:

    node --import tsx tools/ledger/receipts/test/live/read-rebate-fixtures.ts \
      --paid .claude/.keys <out.json>

It prints one verdict line per receipt and exits 0 only when all four pass;
those lines are what this Log records. It reads the reader's own answer, before
the read route's repair, so it measures the prompt. Not run by the build.

### 2026-11-07 — owner's answers at gate 1's checkpoint (Claude Sonnet 5.5, fixer)

The owner answered three questions through `AskUserQuestion` on 2026-11-07,
after gate 1 passed at `b88c551e` with three lows (F1, F2, F3).

- **F1, the every-rebate repair is taken without asking whether another subset
  also adds up.** Chosen: record it and leave the code (the gate's
  recommendation). Not chosen: check uniqueness on the every-rebate path too,
  applied at landing. It shows only with rebates of both signs: on items A
  `(1000, -50)`, B `(1000, -100)` and C `(-1000, +100)` with total 1000, the head
  returns `[null, null, null]` where dropping only A also adds up (231 of 2,000
  tie-heavy mixed-sign cases, 0 of 10,000 same-sign cases, per the gate). Left
  as it is.
- **F2 and F3.** Chosen: fix both at landing with no re-gate (the lander's
  recommendation). Not chosen: fix F2 only and record both.
- **Done when 6, the owner's paid read.** Chosen: land with it awaiting (the
  lander's recommendation). Not chosen: hold #752 until the owner runs it. The
  ticket's `awaiting:` line names it, and the Log records the four verdict lines
  once the owner has run the command above.

- 2026-11-07 — Fixed at landing by owner choice: gate 1, F2 — "the comment on MAX_REBATES_SEARCHED says a receipt with more rebates than the bound is left to the person". The comment now says the bound limits the subset search only and that the every-rebate repair still runs above it. `git diff b88c551e HEAD -- tools/ledger/books/src/receipts.ts | grep -c '^-.* more rebates than this is left to the person'` → `1`.
- 2026-11-07 — Fixed at landing by owner choice: gate 1, F3 — "deleting the early itemsAddUp return leaves books/test at 88 of 88". Added `a reading whose mixed-sign rebates already add up is returned as read` at the end of the lg-101 block in `books/test/receipts.test.ts`: items `A 1000 -100` and `B -1000 +100`, total 0. Red with the early `if (itemsAddUp(proposal)) return proposal;` removed from `dropPrintedRebates` (committed tree, `npx vitest run tools/ledger/books/test/receipts.test.ts`): `1 failed | 88 passed (89)`, `expected { merchant: null, …(6) } to be { merchant: null, …(6) } // Object.is equality`. Green with it restored from the commit: `89 passed (89)`.
