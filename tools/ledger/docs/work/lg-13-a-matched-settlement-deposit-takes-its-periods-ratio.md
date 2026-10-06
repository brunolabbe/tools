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
