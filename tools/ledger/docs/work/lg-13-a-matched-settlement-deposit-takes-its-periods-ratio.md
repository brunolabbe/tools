---
id: lg-13
tool: ledger
title: A matched settlement deposit is weighed at the ratio of the period it settles
kind: fix
status: ready
milestone: P3
depends_on: [lg-6]
difficulty: hard
---

# lg-13 — A matched settlement deposit is weighed at the ratio of the period it settles

## Why

lg-6 weighs every deposit into the buffer at the ratio of the period its
**date** falls in ([00-ANALYSIS.md §5](../00-ANALYSIS.md), _Cumulative, not
per period_). A settlement's own deposit is always dated after the period it
settles, so when the ratio changes at that boundary, paying exactly what the
close asked leaves the next open period owing money: the deposit is weighed at
the new ratio, though it settles a debt computed at the old one.

The owner decided on 2026-10-06, answering lg-6's gate 1, to keep §5 as built in
lg-6 and to file this: **a deposit matched to a closed period's settlement is
weighed at that period's ratio.**

## Reproduction

Through the API (`lg-6`'s routes), clock 2026-10-03: a ratio of 0.6 for alex
from 2026-01-01; sam spends 100.00 on 2026-09-10; the period closes on
2026-09-30 and asks alex for 150.00; a new ratio takes effect on 2026-10-01;
alex's 150.00 is pasted, dated 2026-10-02, and is `matched`. Then
`GET /api/periods/open`:

| Ratio from 2026-10-01 | Open period says            |
| --------------------- | --------------------------- |
| unchanged (0.6)       | nobody owes                 |
| 0.5                   | sam deposits 30.00, net 15  |
| 0.7                   | alex deposits 50.00, net 15 |

With nothing spent since the close, all three should say nobody owes. Measured
on lg-6's branch at `0862fd3` by its gate 1, and re-run by lg-6's builder (see
the Log).

## Build

1. **`books`**: `cumulativeSettlement` takes, besides each deposit, the closed
   period it was matched to, if any (lg-6's `matchDeposits` decides that). A
   matched deposit goes into **that period's stretch**, weighed at its recorded
   ratio; every other deposit stays where its date puts it, as §5 says.
2. **`api/src/periods.ts`**: `settlementFor` computes the matches it already
   computes for `GET /api/periods` and passes them in. The match is recomputed
   on every read from the rows' current classification, so a reclassified row
   moves with it; keep it that way.
3. **What does not change.** A deposit paid short or long by more than a cent
   is not matched and stays weighed by its date; a `folded` expectation has no
   deposit; lg-6's rounding (once, half-up) and "a residue under half a cent
   names nobody" stand.
4. **`docs/00-ANALYSIS.md` §5**: one sentence saying which ratio weighs a
   settlement's own deposit.

## Done when

1. The reproduction above, as an API test with the ratio changed to 0.5 and to
   0.7, leaves the next open period owing nothing (`payerId: null`,
   `depositCents: 0`).
2. A books test: the same deposit unmatched (90.00 paid where 150.00 was asked,
   r = 0.6 then 0.5) is still weighed at the ratio of the period its date falls
   in — `payerId` alex, `depositCents` 3000, `netCents` 1500 — as lg-6 computes
   it.
3. Every lg-6 settlement test passes unchanged.
4. §5 of the analysis names the ratio a matched deposit is weighed at.
5. Gates green.

## Log

- 2026-10-06 — Filed by lg-6's builder, from the owner's answer to lg-6's gate
  1 (options: keep §5 as built; settle a matched deposit at the closed period's
  ratio in lg-6; keep now and file a ticket — the last chosen). Not built.
  Reproduction re-run through lg-6's built API (`api/dist/server.js`, a
  scratch script; salaries 6.00 and 4.00, then the new ratio's), printing for
  no change, 0.5 and 0.7:
  `asked 15000 of alex; deposit matched; open period: payer null, deposit 0, net 0`,
  `… payer sam, deposit 3000, net 1500`,
  `… payer alex, deposit 5000, net 1500`.
- 2026-10-07 — Built on `1aece87`. **The rule, as built:** a deposit is
  _counted_ when its date says, as before, and a deposit matched to a closed
  period is _weighed_ in that period's stretch, at the ratio its settlement
  recorded. Why it is exact, to within the rounding of the figure asked: a
  close asks for its cumulative net divided by the recipient's share at its own
  ratio, so the same amount weighed at that ratio cancels the net, whatever
  ratio follows.
  - **`books`.** `DepositInput` gains an optional `settles`: the last day of the
    closed period the deposit was matched to. `cumulativeSettlement` puts it in
    the stretch holding that day (`periodIndexOf`), so the books need no period
    ids. Optional, so every lg-6 caller and test is untouched. A date after the
    open period's last day still leaves the deposit out, matched or not.
    Without that, `GET /api/periods/open?end=` a day before the deposit would
    have counted a deposit dated after it.
  - **`api`.** `settlementFor` now runs `matchDeposits` over the same buffer
    rows it weighs, through `depositMatches`, which `closedPeriods` shares. The
    match is still recomputed on every read from the current classification.
    There is no schema change.
  - **The brief had nothing wrong.** Its "always dated after the period it
    settles" is nearly always: `matchDeposits` accepts a row dated on the
    period's last day, which falls in that period anyway. The comment and §5
    say "nearly always".
  - Red, then green. `npx vitest run tools/ledger/books` with `periods.ts`
    reverted: `4 failed | 193 passed (197)` (the 0.5 and 0.7 cases, at 100.00
    and at 100.01). Restored: `197 passed (197)`. `npx vitest run
tools/ledger/api/test/periods.test.ts` against the books `dist` built
    before the change: `2 failed | 25 passed (27)` (0.5 and 0.7). After
    rebuilding books (`grep -n "deposit.settles"` in
    `books/dist/periods.js` finds lines 130 and 132), `npx vitest run
tools/ledger/api` passes `269 passed (269)`. `npm test -- --project
ledger` passes `519 passed (519)`. `git diff --numstat` shows 0 lines
    removed from either test file, so every lg-6 test stands unchanged.
  - **Sub-cent residue, measured, not changed.** I ran a seeded sweep (a scratch
    script over `books/dist`) of 20 000 trials. Each draws a random share
    (0.05–0.95) and one card line of up to 5 000.00, closes, pays exactly the
    asked figure, matches it, and reads the next period. With a new random
    ratio, 4 506 of 20 000 name a payer, worst deposit 8 cents, net 0 in every
    case. With the ratio unchanged, 2 843 of 20 000 name one, worst deposit 9
    cents, net 0. lg-6 already asks for a deposit of a few cents whose net
    rounds to nothing, by gate 2 low 12's rule that a deposit of 0, not a net of
    0, names nobody. lg-13 adds no new kind of outcome. Before lg-13 the same
    exact payment across a change named 30.00 or 50.00.
  - **For lg-7's builder.** Done-when 3's buffer balance is `bufferAsOf`
    (`books/src/buckets.ts`), a sum of rows. No settlement weighing reaches it,
    so lg-13 does not move it. lg-13 does move the cumulative catch-up that
    Build 8 reports, and any v3 close after the import. Each imported v1/v2
    period is a closed period with a recorded payer and deposit, so
    `matchDeposits` matches its historical deposit if one was paid within a
    cent, dated on or after the period's end, filed to the payer. That deposit
    is then weighed at the ratio the period records, which is the
    `periods.ratio_id` the import writes. Import each period with the ratio its
    historical settlement used, or a matched deposit is weighed wrong. Compute
    the catch-up through `settlementFor` (or `cumulativeSettlement` with
    `settles` filled from `matchDeposits`), never by date alone. A historical
    deposit paid off by more than a cent stays weighed by its date. If the
    workbook's ratio changed at a period boundary, its own catch-up figure
    followed neither rule necessarily, so a difference there is not a defect in
    the import.
  - **Fold-in:** none was free. No open ledger ticket touches the settlement's
    weighing, and lg-6's unfiled lows (a third person's buffer row) are not
    specified work.
- 2026-10-07 — Round 2, on `0132e35` (gate 1: CONCERNS), by the fixer. Added a books case at the end of `books/test/settlement.test.ts` for two closed periods (0.6, then 0.5) with period 1 paid after close 2: `settles` 2026-09-30 reads alex 83.33 / 25.00, `settles` 2026-10-31 reads 33.33 / 10.00, no `settles` reads 133.33 / 40.00. Mutant `periods.length - 2` in place of `periodIndexOf(periods, deposit.settles)`: `1 failed | 29 passed (30)` (8333 expected, 3333 received); restored: `30 passed (30)`. Qualified "exactly" as "to within the rounding of the figure asked" in the `periods.ts` header comment, §5 of `00-ANALYSIS.md` and "Why it is exact" above. Added lg-13 to lg-7's `depends_on` and a sentence to its Build 8. Left as recorded: gate 1's low on two asks within a cent of each other (a coincidence of lg-6's matcher, no live call site) and its open decision on `netCents === 0` (recommended: leave).
