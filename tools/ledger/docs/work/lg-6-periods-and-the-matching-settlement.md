---
id: lg-6
tool: ledger
title: Periods of personal-card spending, closed with the matching rule
kind: work-package
status: ready
milestone: P3
depends_on: [lg-5]
difficulty: hard
---

# lg-6 — Periods of personal-card spending, closed with the matching rule

## Why

Shared spending on a personal card is gathered in periods, and closing a period
says who tops up the buffer and by how much. The workbook computed that amount
two different wrong ways. The owner decided to use the **matching rule**,
computed **cumulatively**, which is exact
([00-ANALYSIS.md §5](../00-ANALYSIS.md), which derives it and holds the worked
example).

## Build

1. Migration: `periods` (start, end, closed-at); `period_lines` (person, date,
   amount in cents, category, note, source); `recurring_items` (payer, monthly
   amount, start date, optional end date, label). All are append-only; a line is
   corrected by superseding it.
2. **A recurring item generates one dated line per month.** A period holds the
   lines dated inside it, so the month arithmetic in §6 of the analysis cannot
   happen.
3. `books`, pure: `settlement(contributions, charges, ratio)`, per analysis
   §5, _Charges between the two_.
   - **Contributions** are everything each person has put toward shared costs
     since the last point where they were even: shared period lines plus
     **every deposit into the current-expenses bucket**. Payments out of the
     buffer are **not** inputs.
   - **Charges** are amounts one person owes the other outright. The manual
     form is here; receipt items marked as the other's arrive with lg-10.
   - Net direct value is `r × (A + B) − A + charges A owes B − charges B owes
A`.
   - Returns: whoever owes deposits `net / (recipient's share)` into the
     buffer, rounded half-up to the cent once, at the end. With no charges, this
     is the matching rule `max(0, B × r/(1 − r) − A)`.
   - Also return `net` itself, so the screen can offer a direct transfer
     instead.
4. **The ratio in effect at the period's end applies.** A new ratio takes effect
   only at a period boundary, and what is owed across a boundary carries over as
   money (§5 of the analysis).
5. **Closing a period records the settlement it computed:** amount, payer, ratio
   and formula version. The tool then expects that deposit, and matches it when
   a paste brings it in: same person, same bucket, amount within a cent.
6. `web`:
   - the open period, with its lines per person, a manual line entry, and a
     manual charge ("this was the other person's");
   - the recurring items;
   - the close button, showing who deposits what;
   - the list of expected deposits not yet seen in a paste.

## Done when

1. The analysis's §5 table reproduces in a unit test: at r = 0.6, B spends 100
   and A spends nothing, so A deposits 150.00.
2. A cumulative case in which one earlier settlement under-asked produces the
   catch-up in the next close, and the result stands exactly at the ratio
   afterwards. A test asserts the shares to parts-per-million precision.
3. A recurring item produces one line per month, and a period spanning a new
   year holds the right months.
4. A closed period's settlement is matched when a later paste brings in the
   deposit.
5. A simulation-style test: random mixes of card spending and charges in both
   directions. After the computed deposit, with the buffer owned at the ratio,
   each person's cash out minus their buffer share equals what they consumed,
   to the cent.
6. Gates green.

## Log
