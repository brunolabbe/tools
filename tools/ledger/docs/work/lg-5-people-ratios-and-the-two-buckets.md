---
id: lg-5
tool: ledger
title: People, salaries and ratios over time, and what each bucket owes whom
kind: work-package
status: ready
milestone: P2
depends_on: [lg-4]
difficulty: hard
---

# lg-5 — People, salaries and ratios over time, and what each bucket owes whom

## Why

This is the screen the workbook exists to produce: is the mortgage even, and
what is in the buffer ([00-ANALYSIS.md §4–5](../00-ANALYSIS.md)). It also lays
down the salary and ratio history the owner wants charted (§9).

## Build

1. Migration:
   - `people`, holding the display names. The email mapping stays in lg-3's
     configuration.
   - `salaries`: person, amount in cents, year, entered-at.
   - `ratios`: parts per million per person, effective-from date, and the
     salary records it came from, if any.
     All three are append-only, and a correction supersedes the earlier record.
2. `books`, pure:
   - **mortgage:** each person's own money in the bucket, which is their
     deposits − ½ × payments, as of any date.
     - The bucket is **not** shared (analysis §4). The two amounts sum to its
       balance exactly, and nothing in it is common.
     - Rounding: an odd-cent payment's halves differ by a cent. Give the extra
       cent to one person by a fixed rule, and assert that the sum still
       equals the balance.
   - **buffer:** the current-expenses balance as of any date, and each person's
     cumulative contributions to it.
   - **ratio from salaries:** parts per million, rounded half-up, with the two
     people summing to exactly 1 000 000.
3. Money is integer cents throughout. No `number` holding dollars crosses a
   function boundary.
4. `web`:
   - the home screen: each person's own money in the mortgage bucket, who has
     paid extra and by how much, and the buffer's
     balance;
   - a screen for entering a year's salaries, which proposes the derived ratio
     and its effective date for the person to confirm.

## Done when

1. Unit tests on a synthetic history prove:
   - each person's own money in the mortgage bucket, and that the two sum
     to its balance to the cent, including after an odd-cent payment;
   - the buffer's balance as of a past date, where a later row changes the
     present one;
   - that a derived ratio's two halves sum to 1 000 000.
2. Entering a corrected salary keeps the earlier one, and the earlier ratio
   still reads as in effect for its own dates.
3. The home screen shows both figures. A web test proves it.
4. Gates green.

## Log
