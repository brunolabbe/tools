---
id: lg-61
tool: ledger
title: A paste against a workbook row dated two or three days off is stored with the wrong split
kind: fix
status: ready
milestone: null
depends_on: [lg-59]
difficulty: hard
---

# lg-61 — A paste against a workbook row dated two or three days off is stored with the wrong split

## Why

lg-59 lets a paste read the workbook's rows a block at a time: rows whose dates
are at most two days apart, each pasted row dated within a day of its block's
dates (`api/src/workbook-days.ts`, `matchStretch`). Its tolerance is a workbook
row dated a day off the bank's. lg-59's gate 1 (Sonnet 5.5, at `5349ba45` on PR
#564, cited as prose) measured what happens **outside** that tolerance, where a
workbook row is dated two or three days off.

- At lg-59's head, some pastes the base before lg-59 refused are accepted with
  the wrong split. In 108,000 random trials with offsets of up to two or three
  days, there were 1,116 wrong accepts at lg-59's head against 2,852 at the base.
  172 of them happen at the head only, and 17 of those store fewer rows than the
  bank adds: a new bank row is never stored.
- Enumerated, with exactly one workbook row dated 2 or 3 days off and nothing
  else reordered or re-dated:

  | space          | variants | wrong at lg-59's head | head only | wrong at the base |
  | -------------- | -------- | --------------------- | --------- | ----------------- |
  | 4 rows, ±5/±10 | 163,840  | 5,280                 | 224       | 11,776            |
  | 5 rows, ±10    | 81,920   | 4,912                 | 626       | 11,424            |

The cause is lg-59's trade, not a slip. A block admits rows up to two days apart,
so a row the workbook dated two or three days off can fall in a block with rows
that are not its day's. The amounts and the closing balance can then fit a
shorter overlap when the true one is refused. The base refused the whole paste in
those cases, because it cut on the workbook's dates alone. The owner chose to
accept the net gain in lg-59 (2026-10-18, on lg-59's gate 1, F2) and to file this
probe.

The gate's harnesses are in a session scratch directory, which is not durable:
`/tmp/claude-1000/-workspaces-tools/196311b6-27e1-4ec1-a958-40fd27d0130d/scratchpad/lg-59/gate-1/`
(`gate-lg59-wide.test.ts` for the random trials, `gate-lg59-exh.test.ts` with
`GATE_MODE=oneoff` for the enumeration). If they are gone, Build step 1 rebuilds
the enumeration from this paragraph. It walks every bank history of `m` rows over
the amounts, each day boundary either way. It takes as the workbook every prefix
of `j` rows, in the bank's order, with exactly one row moved by −3, −2, +2 or +3
days, and pastes from every row `i ≤ j`. The truth is `j − i` present and
`m − j` added.

### Reproductions

Amounts in dollars; the opening is 1,000.00.

- **R1, stored twice.** Bank: 20 Feb −5.00, −5.00; 21 Feb +5.00, +10.00. The
  workbook holds the first three rows, in the bank's order, with the first dated
  17 Feb. Paste all four. The truth is 3 present and 1 new. lg-59's head stores
  1 present and 3 added; the base refuses with `STATEMENT_CHAIN_BROKEN`.
- **R8, a new row dropped.** Bank: 20 Feb +10.00, −10.00; 22 Feb −10.00; 23 Feb
  +10.00. The workbook holds the first three rows, listed +10.00 on 22 Feb,
  −10.00 on 20 Feb, −10.00 on 24 Feb. Paste the bank's rows 3 and 4, from
  1,000.00. The truth is 1 present and 1 new. lg-59's head reports 0 added and 2
  present, so the +10.00 on the 23rd is never stored. The base refused it (the
  gate's reducer, run on both trees).

Both still reproduce after lg-59's gate-1 round (the cut where the bank's day
ends), by the gate's `gate-lg59-repro.test.ts`: `R1 … accepted rowsAdded=3
rowsAlreadyPresent=1`, `R8 … accepted rowsAdded=0 rowsAlreadyPresent=2`.

## Build

1. **Measure before any change.** At `main` with lg-59 merged, run the
   enumeration above for the two spaces in the table, at lg-59's head and at the
   lg-40 base (`335efcd4`'s `statements.ts`). Record each space's `correct`,
   `wrongAccept` (and how many store fewer rows than the bank adds), `ambiguous`
   and `refused`, with the head-only count. Then run lg-59's probes c and c2
   (seed 11; their sources are named in lg-59's Log) as the in-tolerance baseline.
2. **Name the shape.** Reduce R1 and R8 by hand to the block that admits the
   false reading. Say which part of the rule admits it: the block's two-day span,
   the window of a day either side of the block's dates, or the partial-block
   reading at the stretch's edges.
3. **Measure the directions before choosing one.** At least:
   - narrow the window a block allows a pasted row, for instance to a day of
     the dates of the rows that row could be;
   - refuse a block whose rows' dates and the pasted rows' dates disagree by
     more than a day row for row, in some pairing;
   - leave the rule and record the residual.

   Try each as an uncommitted experiment. Record its effect on the enumeration,
   and on probes c and c2, beside step 1's numbers. A direction that brings back
   any of lg-59's in-tolerance wrong accepts, or that raises probe c's or c2's
   ambiguity in a cell with no day re-dated two days off, is a cost to state. If
   the costs are large against what it removes, **stop and put the options to the
   owner**; this ticket does not set the threshold.

4. Implement the chosen direction in `api/src/workbook-days.ts`, keeping lg-40's
   and lg-59's guarantees: a stored row is never edited, the workbook's wording
   and category stay on its rows, only rows past the tail are inserted, and a
   reading the rule makes possible counts like any other.

## Done when

1. R1 and R8 are tests in `api/test/workbook-days.test.ts`. Each asserts that the
   paste is either read truly or refused (`STATEMENT_CHAIN_BROKEN`, or
   `STATEMENT_ROW_CONFLICT` saying "two ways"), never stored with the wrong
   split, and that the workbook's rows are unchanged afterwards.
2. The enumeration of step 1, at this branch's head, has no wrong accept that
   the lg-40 base does not also make, or the owner's recorded decision names the
   residual that stays.
3. lg-59's probes c and c2 at seed 11 show `wrongAccept` 0 in every cell, and
   `refusedOther` 0 in the `both` cells.
4. The tallies of steps 1 and 3 are in the Log, with each cell's change named.
5. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-18 — filed by lg-59's builder (Opus 5.5), in lg-59's branch, on the
  owner's answer of 2026-10-18 to lg-59's gate 1, F2. The question put: record
  the residual and file a two- and three-day probe (recommended), narrow the
  block window in lg-59's branch, or record it and file nothing. The owner
  chose to record it and file this probe. The figures in Why are the gate's, from
  its full report `gate-1@5349ba45.full.md` in the directory named above; they
  were not re-derived in this filing. R1 and R8 were re-run on lg-59's gate-1
  round as quoted under Reproductions.
