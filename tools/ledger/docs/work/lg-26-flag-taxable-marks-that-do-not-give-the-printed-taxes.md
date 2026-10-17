---
id: lg-26
tool: ledger
title: Flag a receipt whose taxable items do not give its printed GST and QST
kind: fix
status: done
milestone: P4
depends_on: [lg-10]
difficulty: standard
---

# lg-26 — Flag a receipt whose taxable items do not give its printed GST and QST

## Why

A misread taxable mark moves money between the shared and the not-shared
amounts, and nothing flags it. lg-10 computes what an item takes off the shared
amount, including GST and QST on its price when the item is marked taxable. The
two checks do not look at that mark:

- the reconciliation, `itemsAddUp` in `tools/ledger/books/src/receipts.ts`, sums
  prices, deposits and the printed taxes, so it is blind to the mark;
- `taxesFit` asks only whether _some_ part of the subtotal gives both printed
  taxes, never whether the items marked taxable are that part.

The model's reading of a receipt's tax codes is unmeasured on real photos
(lg-10's Log). lg-10's gate 1 found this (finding F2), and on 2026-10-17 the
owner chose to correct the reader's comment, which had claimed the check catches
an item misread, and to file this ticket.

## Reproduction

The basket from lg-10's tests, with the six-pack not shared:

- bread 3,49 $, untaxed;
- a six-pack 12,99 $, taxable, with a 0,60 $ deposit;
- soap 4,99 $, taxable.

The printed taxes are GST 0,90 $ and QST 1,79 $, and the total is 24,76 $. This
is `BASKET` in `tools/ledger/books/test/receipts.test.ts`. Run `checkReceipt`
and `splitReceipt` from `books` on it, with the six-pack marked `not-shared`:

```
as printed (beer T, soap T)      flags [] split {"sharedCents":922,"notSharedCents":1554,"chargedCents":0}
beer misread as not taxable      flags [] split {"sharedCents":1117,"notSharedCents":1359,"chargedCents":0}
```

With the six-pack's mark misread, 1,95 $ moves to the shared side, and the
screen still says "It adds up."

**The converse, with no tax lines** (lg-10's gate 2, N3). This is a zero-rated
grocery receipt, the case lg-8 measured as common, with both taxes `null`:

- milk 10,00 $, marked `not-shared`;
- bread 10,00 $, shared;
- total 20,00 $.

```
milk marked taxable=false:   flags [] split {"sharedCents":1000,"notSharedCents":1000,"chargedCents":0}
milk marked taxable=true:    flags [] split {"sharedCents":850,"notSharedCents":1150,"chargedCents":0}
```

With the milk misread as taxable, the not-shared part takes 1,50 $ of tax that
nobody charged, and nothing flags it.

## Build

1. **`contract`:** a new flag in `RECEIPT_FLAGS`, for example `taxable-differs`.
   It means: the prices of the items marked taxable, taken as the taxable part,
   do not give both printed taxes at the rates on the receipt's date. It is
   **non-blocking**, like every flag but `items-differ`: the person checks the
   Taxable boxes, and files.
2. **`books`:** in `checkReceipt`, when the receipt has items, raise the flag
   unless the sum of the taxable items' prices lies in both ranges
   `taxableRange` gives for the printed GST and QST. That is the same arithmetic
   `taxesFit` uses, with the taxable part fixed instead of searched for.
   - **Both taxes absent count as printed zero** when the receipt has items, so
     that an item marked taxable on a receipt with no tax lines is flagged (the
     converse in the Reproduction).
   - One tax absent is already `tax-missing`, and is left to that flag.
   - No item means no flag.
   - A refund's parts are checked as their magnitudes, as `taxesFit` checks
     them.
3. **`web`:** its label in `FLAG_LABELS`, telling the person to check which items
   are taxable.
4. **Traps.**
   - A store that rounds tax per line, not on the taxable subtotal, could raise
     the flag on a correct reading. It is non-blocking, so that costs a glance,
     not a filing. Note it in the Log if a fixture shows it.
   - `FLAG_LABELS["tax-differs"]` and the contract's doc for `tax-differs` write
     the rates out (lg-10 gate 1, F4). Do not copy that into the new label.

## Done when

1. The reproduction's misread basket (six-pack not taxable) is flagged, and the
   basket as printed is not; a `books` test asserts both.
2. A receipt with items, all untaxed, and no tax lines is not flagged.
3. The Reproduction's receipt with no tax lines and the milk marked taxable is
   flagged; a `books` test asserts it.
4. The screen shows the flag's label for the misread basket, and filing is not
   blocked by it; a `web` test proves both.
5. Gates green.

## Review

**Gate: CONCERNS** — 2026-10-17 · `8e50f0d4..f12d0e06` · Opus 5.5, depth full

| Done when                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Misread basket (six-pack not taxable) flagged, basket as printed not; a `books` test asserts both | `books/test/receipts.test.ts` › "the taxable marks (lg-26)" › "flags the six-pack misread as not taxable, and not the basket as printed" ✓ — `toEqual([])` on the printed marks and `toEqual(["taxable-differs"])` on the misread one; red with the flag's push removed                                                                |
| 2. Items all untaxed, no tax lines: not flagged                                                      | `books/test/receipts.test.ts` › "the taxable marks (lg-26)" › "does not flag items all untaxed on a receipt with no tax lines" ✓ (`toEqual([])`, a companion to the line-3 test that flags)                                                                                                                                            |
| 3. No tax lines, milk marked taxable: flagged; a `books` test asserts it                             | `books/test/receipts.test.ts` › "the taxable marks (lg-26)" › "flags a taxable mark on a receipt with no tax lines, both taxes counting as zero" ✓ — red with the flag's push removed. Not an artefact of the 10,00 $ price: any taxable sum of 0,06 $ or more is flagged; 0 to 0,05 $ passes, since 9.975 % of 5 cents rounds to zero |
| 4. Screen shows the label for the misread basket and filing is not blocked; a `web` test proves both | `web/test/receipts.test.tsx` › "shows the Taxable check when a mark does not give the printed taxes, and still files (lg-26)" ✓ — `getByText(label)`, then `fileReceipt` called once with marks `[false, false, true]`; red both with the flag removed in `books` and with `unfileable` made to block on `taxable-differs`             |
| 5. Gates green                                                                                       | **verified** — on `f12d0e06`: `check`, `test (ubuntu-latest)`, `docker`, `codeql`, `CodeQL`, `dependency-review` pass; `test (windows-latest, informational)` still pending, read and not graded. Locally `npm test -- --project ledger` 1123 of 1123 in 60 files, `npm run check` exit 0                                              |

- **med** · open decision · no `Done when` line depends on it · `checkReceipt` in `books/src/receipts.ts` does not raise `taxable-differs` whenever `tax-differs` is raised. Build 2 lists three exceptions (both taxes absent count as zero, one tax missing, no items), and this is a fourth that the Log calls a decision "the brief left open". `tax-differs` depends only on the printed taxes and the subtotal, never on the marks. So on every receipt that raises it, every misread mark is hidden. When the reader misread a tax, the mark is flagged again once the person corrects that tax: measured, and the web re-checks on every edit. When the store's printed taxes themselves raise `tax-differs`, the person cannot correct them, files, and the misread mark is never named. On a synthetic store that rounds per line (prices 0,50 to 15,49 $), 2628 of 20000 receipts raise `tax-differs` with the marks correct, and a flipped mark on those 2628 is never flagged. The shipped text overstates the coverage, which is the unsafe direction: `reader.ts` says the flag "catches a mark that does not give the printed taxes", and the contract's doc for `taxable-differs` does not state either exception. It is graded `med` with this finding, not `high`, because every reader misread measured on a receipt whose printed taxes are consistent is caught. Options:
  - **(c, recommended)** Beside `tax-differs`, raise `taxable-differs` when the marked sum fits **neither** printed tax. That catches 2628 of 2628 per-line receipts and 20000 of 20000 with a QST misread by 0,10 to 0,90 $. It adds a false flag to 218 of 2628 per-line receipts whose marks are right, and to 0 of 20000 with a misread QST. With it in place, all 39 `books` receipt tests pass unchanged.
  - **(a)** Keep the suppression, and write both exceptions into the contract's doc and the `reader.ts` comment. No code change, and the hole stays on such stores.
  - **(b)** Build 2 as written, always raising it beside `tax-differs`. That puts a false "check which items are taxable" on every misread tax, and three existing expectations change: "the check reads the same dated rates", "leaves taxes no taxable part gives to tax-differs alone" and "reads the rates in effect on the receipt's date".
- **low** · `nfr:reliability` · a store that rounds tax per line gets a false `taxable-differs` with the marks correct: 641 of 20000 synthetic receipts (2 to 9 taxable items at 0,10 to 4,09 $, rounded half-up per line). For example, items 1,54 $ and 1,22 $, both taxable, print GST 0,14 $ and QST 0,27 $, and get `["taxable-differs"]`. The flag does not block filing, as the brief's trap expected. The Log says "no fixture here rounds per line"; the brief asks for a note in the Log once a fixture shows it, and this is one.
- **low** · the Log gives the zero-tax range as "`taxableRange(0, rate)` is `[-10, 9]` cents". That is GST's range alone. QST's is `[-5, 5]`, and the check takes the intersection: 0 to 5 cents pass and 6 cents is flagged (measured). The text is false in the safe direction, because it promises more tolerance than the check gives.
- **low** · `nfr:maintainability` · a receipt whose two tax lines are printed but read as `null` gets `["items-differ","parts-differ","taxable-differs"]` with its marks correct, which sends the person to the Taxable boxes when the fix is to type in the taxes. It clears once the taxes are typed back (measured: `[]`), and `items-differ` already blocks filing. Noise in the safe direction.
- **dropped** · a small item's mark misread goes unflagged: in `BASKET`, a taxable bag of 0,08 $ or less read as untaxed passes. Cent rounding makes the GST range 20 cents wide and the QST range 10 cents wide, so at most 1 cent of tax moves. No arithmetic check could catch it, so it is not a defect.
- **dropped** · with one tax missing, or with mixed signs (`signs-differ` returns early, in the same order as before), `taxable-differs` is not raised. Both exceptions are in Build 2, and in every probe `items-differ` was raised beside them and blocks filing.
- **dropped** · `RECEIPT_FLAGS` exhaustiveness. The type's only map is `FLAG_LABELS: Record<ReceiptFlag, string>` in `web`, which the typechecker holds exhaustive. There is no `switch` or `z.enum` over it in `api`, `web`, `receipts` or `books`, the `api` computes flags per request and never stores them, and no `e2e` spec asserts on flags.
- **findings** · the hunt returned 7; 4 carried, 3 dropped.
- Invariants: contract edited as Build 1 directs; no new error code, spawn, URL, or log line; the test diff only adds (111 lines in `books`, 21 in `web`, 0 deleted), so no existing expectation changed. Skipped as untouched: tool isolation, Dockerfile closure, routes.
- NFR: security n/a · performance n/a (one reduce per check) · reliability — above · maintainability — above.

## Log

- 2026-10-17 — Fixed at landing by owner choice: lg-10's gate 2, N3 — "(i) Its
  reproduction says to run "the gate's script, `node taxable-mark.mjs <tree>`",
  which exists only in a gate's scratch directory; the basket is in the repo
  (`BASKET` in `books/test/receipts.test.ts`), so cite that. (ii) … The new flag
  should treat both taxes absent as printed zero when the receipt has items, so
  that a taxable mark with no tax printed is flagged; add it to Build 2 and a
  Done when line." Each check below reads only the section it names:
  - `sed -n '/^## Reproduction/,/^## Build/p' <this file> | grep -c "taxable-mark.mjs"`
    → `0`, and the same for `"BASKET"` → `1`;
  - `sed -n '/^## Build/,/^## Done when/p' <this file> | grep -c "Both taxes absent count as printed zero"`
    → `1`;
  - `sed -n '/^## Done when/,/^## Log/p' <this file> | grep -c "no tax lines and the milk marked taxable"`
    → `1`.
- 2026-10-17 — Built. The flag is `taxable-differs`: `RECEIPT_FLAGS` in
  `contract/src/receipts.ts`, `taxableFits` and a block at the end of
  `checkReceipt` in `books/src/receipts.ts` (`taxableRange` is reused as it is),
  and its label in `FLAG_LABELS` in `web/src/receipts/Receipts.tsx`, which names no
  rate. Non-blocking: `unfileable` still reads only `items-differ`. Decisions the
  brief left open:
  - **Not raised beside `tax-differs`.** When no taxable part at all gives the
    printed taxes, no choice of marks can fix it, and "check which items are
    taxable" would send the person to the wrong box. This also leaves the
    existing `tax-differs` expectations in `books/test/receipts.test.ts`
    (`["tax-differs"]`, with items) as they were. Not raised on `signs-differ`
    either, which returns before the tax checks, nor with one tax missing.
  - A tax `null` beside a tax present stays `tax-missing`'s alone; both `null`
    count as zero, so the zero-tax range `taxableRange(0, rate)` is `[-10, 9]`
    cents and an untaxed receipt (sum 0) passes.
  - `reader.ts`'s comment on the unmeasured lg-10 lines said the flag that would
    catch a misread mark was lg-26; it now says the flag exists (comment only, not
    the prompt). Folded in as the change this branch made stale.
  - The trap (a store that rounds tax per line) was not met: no fixture here rounds
    per line, so nothing is recorded beyond the brief's note.
    Red then green: with `proposal.items.length > 0` mutated to `< 0` and `books`
    rebuilt (`grep -c taxable-differs tools/ledger/books/dist/receipts.js` → `1`),
    `npx vitest run tools/ledger/books/test/receipts.test.ts tools/ledger/web/test/receipts.test.tsx`
    → `5 failed | 49 passed (54)` (four `books` tests in "the taxable marks (lg-26)"
    and the `web` one); restored, same command → `54 passed (54)`.
    `npm test -- --project ledger` → `Test Files 60 passed (60)`, `Tests 1123 passed
(1123)`; `npm run check` exit 0. Done when 1 is "flags the six-pack misread as
    not taxable, and not the basket as printed" (and the bread's twin); 2 is "does
    not flag items all untaxed on a receipt with no tax lines"; 3 is "flags a
    taxable mark on a receipt with no tax lines, both taxes counting as zero"; 4 is
    `web/test/receipts.test.tsx` "shows the Taxable check when a mark does not give
    the printed taxes, and still files (lg-26)".
- 2026-10-17 — Round 1, after gate 1 (Opus 5.5, `8e50f0d4..f12d0e06`, CONCERNS).
  **Decision, asked of the owner through AskUserQuestion and answered the same
  day.** The question: the build above did not raise `taxable-differs` beside
  `tax-differs`, which Build 2 does not list as an exception; `tax-differs` depends
  on the printed taxes alone, so every misread mark on such a receipt went unnamed
  (gate 1: 2628 of 20000 synthetic per-line-rounding receipts raise `tax-differs`
  with the marks right, and a flip on them was never flagged). Options: (a) keep
  the suppression and document it; (b) always raise it beside `tax-differs`, which
  puts a false "check which items are taxable" on every misread tax and changes
  three existing expectations; (c) beside `tax-differs`, raise it when the marked
  sum fits **neither** printed tax. The owner chose **(c)**, the gate's
  recommendation, which **overrides the first build's suppression** (option (a)).
  `taxableFits` in `books/src/receipts.ts` now takes whether the taxes are
  consistent: if so the marks must fit both, if `tax-differs` is raised they must
  fit at least one. The contract's doc for `taxable-differs` and `reader.ts`'s
  comment now list what remains unflagged: no items, one tax missing, mixed signs,
  and beside `tax-differs` a mark sum that fits one tax.
  - The test for the new rule is `books/test/receipts.test.ts` "still names a flipped
    mark when the printed taxes themselves raise tax-differs" (describe "the taxable
    marks beside printed taxes that disagree"). With the `fitsGst || fitsQst`
    branch mutated to `true`, `npx vitest run tools/ledger/books/test/receipts.test.ts`
    → `1 failed | 42 passed (43)`, that test; restored → `43 passed (43)`. The
    three existing expectations (b) would change, and "leaves taxes no taxable part
    gives to tax-differs alone", pass unchanged.
  - **A store that rounds tax per line does raise the flag on marks that are
    right** (the brief's trap, which the first entry said no fixture showed): items
    1,54 $ and 1,22 $, both taxable, print GST 0,14 $ and QST 0,27 $ and give
    `["taxable-differs"]`; test "a store that rounds tax per line can raise it on
    marks that are right". Gate 2 measured it on 20000 synthetic per-line receipts
    with right marks: 6483 at prices of 0,50 to 15,49 $ (6265 alone, 218 beside
    `tax-differs`), about a third of that store's receipts, and 2360 at 0,10 to
    4,09 $ (740 alone, 1620 beside `tax-differs`). It does not block filing.
  - **Correction to the first entry:** the zero-tax range is `[-10, 9]` cents for
    GST alone; QST's is `[-5, 5]` and the check takes the intersection, so 0 to 5
    cents taxable on a receipt with no tax lines passes and 6 is flagged
    ("lets 5 cents taxable pass on a receipt with no tax lines, and flags 6").
    The first entry's "not raised beside `tax-differs`" is superseded by (c).
  - Left as it is: a receipt whose tax lines are printed but read as `null` still
    gets `taxable-differs` beside `items-differ` and `parts-differ`. (c) does not
    change it, since both taxes `null` never raise `tax-differs`; it clears when the
    taxes are typed in, and `items-differ` already blocks filing.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, new low — "Gate 1
  measured 641 of 20000 synthetic receipts. That is gate 1's figure, and gate 1
  scoped it badly: it came from a small-price sample (0,10 to 4,09 $). On
  receipts priced 0,50 to 15,49 $, the branch raises `taxable-differs` on 6483 of
  20000 per-line receipts whose marks are right. The text understates how much
  noise the flag makes, but nothing is blocked and no guarantee rests on the
  figure. Fix: quote the range, or the two figures, instead of 641." The round 1
  entry now quotes both figures. The patterns below use a bracket so that this
  entry does not match its own check:
  - `grep -c "Gate 1 measured 6[4]1" <this file>` → `0`;
  - `grep -c "6483 at prices of 0,50 to 15,4[9]" <this file>` → `1`, and
    `grep -c "2360 at 0,10 t[o]" <this file>` → `1`.

  The null-tax low (a receipt whose tax lines are printed but read as `null`) is
  not fixed, and stays as the round 1 entry records it.
