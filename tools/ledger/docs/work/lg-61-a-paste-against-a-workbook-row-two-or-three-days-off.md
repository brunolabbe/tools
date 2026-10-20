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

   _Superseded 2026-10-20 by the owner's answer in the Log: the two narrowing
   directions above made the residual worse when measured, and the owner chose
   "wide 2/3", a direction not listed here, over leaving the rule._

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

- 2026-10-20 — builder (Opus 5.5), **stopped at Build step 3's stop condition;
  no source changed on this branch.** Neither direction the Build names removes
  the residual: each one doubles it or worse. The one direction that removes it
  is not in the Build, and it costs ambiguity and time. The choice is the
  owner's, as options below.

  **Harnesses.** Gate 1's were still on disk and were used as they were, from
  `/tmp/claude-1000/-workspaces-tools/196311b6-27e1-4ec1-a958-40fd27d0130d/scratchpad/lg-59/gate-1/`.
  `gate-lg59-exh.test.ts` was copied with one change: the base's outcomes are
  cached per shard, so an experiment re-runs the head only. `gate-lg59-repro.test.ts`
  and `gate-lg59-time.test.ts` were copied unchanged. Probes c and c2 are lg-59's
  (sha256 `e461a876…d26de3` and `2c8fc618…577ebc`, matching lg-59's Log), run at
  `GATE_SEED=11`. The base is `335efcd4` in a second worktree. Each probe's vitest
  run exits 1 on the 20 s timeout after every cell line is written, as lg-59
  recorded; every enumeration shard exits 0. The copies and every output are in
  this session's scratch directory, which is not durable:
  `/tmp/claude-1000/-workspaces-tools/6f7039e2-424c-4a51-93b9-04dd90792f37/scratchpad/lg-61/build/`.

  **Step 1, at `00977771` (`main`, lg-59 merged), against `335efcd4`.** Each
  enumeration has one workbook row moved −3, −2, +2 or +3 days. A cell reads
  `correct / wrongAccept / ambiguous / refused`. "Drop" counts the wrong accepts
  that store fewer rows than the bank adds, and "head only" counts the wrong
  accepts the base refuses.

  | space          | variants | `main`                            | head only (drop) | drop | base                             | base drop |
  | -------------- | -------- | --------------------------------- | ---------------- | ---- | -------------------------------- | --------- |
  | 4 rows, ±5/±10 | 163,840  | 106,716 / 5,280 / 16,164 / 35,680 | 224 (32)         | 96   | 78,182 / 11,776 / 3,738 / 70,144 | 128       |
  | 5 rows, ±10    | 81,920   | 39,802 / 4,912 / 24,678 / 12,528  | 626 (194)        | 400  | 33,744 / 11,424 / 7,940 / 28,812 | 420       |

  The 4-row space matches gate 1's at `5349ba45` in every count. In the 5-row
  space, 6 correct readings became ambiguous with lg-59's gate-1 round, and the
  wrong-accept counts did not change. Probes c and c2 at seed 11 match
  `69d2470c`'s column in lg-59's Log, cell for cell: `wrongAccept` 0 and
  `refusedOther` 0 everywhere. R1 and R8 reproduce at `00977771` as the ticket
  quotes them (`R1 … accepted rowsAdded=3 rowsAlreadyPresent=1`,
  `R8 … accepted rowsAdded=0 rowsAlreadyPresent=2`). Both are refused
  `STATEMENT_CHAIN_BROKEN` at `335efcd4`.

  **Step 2, the shapes.**
  - **R8 is let in by the window around the block's dates.** The false reading
    takes the workbook's first two rows, +10.00 dated 22 Feb (1,010.00) and
    −10.00 dated 20 Feb (1,000.00), as one block. The block spans two days, so
    each pasted row may be dated from the 19th to the 23rd. The pasted −10.00 on
    the 22nd and +10.00 on the 23rd hold the block's amounts and open from its
    opening, 1,000.00, so the paste reads as wholly inside the history. Row for
    row, the only pairing puts the bank's −10.00 on the 22nd against the
    workbook's on the 20th, two days apart. No reading within the tolerance
    gives this outcome: a row is dated against the block's whole span, not
    against the row it is.
  - **R1 is let in by the partial-block reading at the stretch's start,
    through a block spanning two dates.** The false reading has `k = 1`. Its
    stretch is the workbook's +5.00 on the 21st (995.00), and `nearby` adds the
    −5.00 on the 20th (990.00) before it. Together they are one block, one day
    wide. The pasted −5.00 on the 20th (995.00) is read as the block's last row
    in the bank's order (`before = 1`), which only has to close on 995.00. Every
    pairing is within a day: the pasted −5.00 is the workbook's −5.00 on the
    20th. The window is not what lets R1 in. **This input is also a correct
    paste within the tolerance.** Take the bank 17 Feb −5.00, 20 Feb +5.00,
    −5.00, −5.00, 21 Feb +5.00, +10.00. The workbook holds the first three,
    with the 20th reordered and its +5.00 dated a day late. That gives the same
    three stored rows, and the paste from the bank's third row is R1's paste
    exactly. There the true answer is 1 present and 3 new, which is what `main`
    stores. No rule that is right on every in-tolerance paste can refuse R1 as a
    whole: a rule that refuses it refuses that paste too. It can only refuse
    both as ambiguous. The head-only drop
    `{"truth":[[0,1000],[1,-1000],[1,-1000],[1,1000]],"wb":[[0,1000],[1,-1000],[-2,-1000]],"j":3,"i":2}`
    from the 4-row space has the same shape: the true reading is outside the
    tolerance and the false one is inside it.

  **Step 3, the directions**, each tried uncommitted in a third worktree behind
  an environment switch. Its two source files are in the scratch directory, at
  `build/exp/`.
  - **narrow**: a pasted row must be within a day of some row of its block with
    its amount.
  - **pair**: the block's rows and the pasted rows must pair one for one, amount
    for amount, each pair dated within a day.
  - **wide S/W**, not in the Build: once the rule finds exactly one reading,
    the readings are searched again with blocks up to S days wide and each
    pasted row allowed W days from its block's dates. Any other reading found
    makes the paste ambiguous. A wider reading is never stored, so this can only
    turn an accepted paste into an ambiguous one. `workbookStarts` and `nearby`
    widen to match.
  - **pairwide S/W**: pair, with the wide pass under pair too.
  - **leave**: `main` as it is.

  The enumerations, then probes c and c2 summed. "No such day" means probe c's
  plain, reorder and shift cells plus probe c2: 18,000 trials, none with a day
  re-dated two days off. `both` is probe c's three `both` cells, 4,500 trials.
  "Distinct" is the `distinct` cells of both probes, 7,500 trials.

  | direction    | 4 rows: c / W / a / r             | head only (drop) | 5 rows: c / W / a / r             | head only (drop) | ambiguous, no such day | `both` | distinct |
  | ------------ | --------------------------------- | ---------------- | --------------------------------- | ---------------- | ---------------------- | ------ | -------- |
  | leave        | 106,716 / 5,280 / 16,164 / 35,680 | 224 (32)         | 39,802 / 4,912 / 24,678 / 12,528  | 626 (194)        | 3,781                  | 951    | 9        |
  | narrow       | 86,864 / 11,380 / 7,984 / 57,612  | 1,100 (12)       | 38,948 / 9,412 / 17,298 / 16,262  | 1,154 (66)       | 3,225                  | 808    | 5        |
  | pair         | 81,712 / 12,340 / 6,928 / 62,860  | 1,388 (12)       | 35,142 / 10,916 / 15,180 / 20,682 | 1,754 (74)       | 3,139                  | 786    | 5        |
  | wide 2/2     | 105,470 / 4,176 / 18,514 / 35,680 | 152 (24)         | 37,136 / 3,960 / 28,296 / 12,528  | 480 (152)        | 4,201                  | 1,065  | 9        |
  | wide 3/1     | 102,778 / 1,104 / 24,278 / 35,680 | 72 (8)           | 34,816 / 880 / 33,696 / 12,528    | 142 (38)         | 4,137                  | 1,059  | 10       |
  | **wide 2/3** | 105,180 / 0 / 22,980 / 35,680     | 0                | 36,380 / 0 / 33,012 / 12,528      | 0                | 4,255 (+474)           | 1,085  | 9        |
  | wide 3/3     | 101,784 / 0 / 26,376 / 35,680     | 0                | 32,478 / 0 / 36,914 / 12,528      | 0                | 4,511 (+730)           | 1,158  | 10       |
  | pairwide 2/3 | 79,352 / 0 / 21,628 / 62,860      | 0                | 29,982 / 0 / 31,256 / 20,682      | 0                | 4,164 (+383)           | 1,052  | 9        |
  | pairwide 3/3 | 76,970 / 0 / 24,010 / 62,860      | 0                | 27,002 / 0 / 34,236 / 20,682      | 0                | 4,353 (+572)           | 1,108  | 10       |

  Under every direction, every cell of both probes has `wrongAccept` 0 and
  `refusedOther` 0. Cell by cell, each as `correct / wrongAccept / ambiguous /
refusedOther`:

  | cell                  | leave (`main`)     | narrow             | pair               | wide 2/3           | pairwide 2/3       |
  | --------------------- | ------------------ | ------------------ | ------------------ | ------------------ | ------------------ |
  | c distinct/plain      | 1498 / 0 / 2 / 0   | 1500 / 0 / 0 / 0   | 1500 / 0 / 0 / 0   | 1498 / 0 / 2 / 0   | 1498 / 0 / 2 / 0   |
  | c distinct/reorder    | 1499 / 0 / 1 / 0   | 1500 / 0 / 0 / 0   | 1500 / 0 / 0 / 0   | 1499 / 0 / 1 / 0   | 1499 / 0 / 1 / 0   |
  | c distinct/shift      | 1498 / 0 / 2 / 0   | 1499 / 0 / 1 / 0   | 1499 / 0 / 1 / 0   | 1498 / 0 / 2 / 0   | 1498 / 0 / 2 / 0   |
  | c distinct/both       | 1499 / 0 / 1 / 0   | 1499 / 0 / 1 / 0   | 1499 / 0 / 1 / 0   | 1499 / 0 / 1 / 0   | 1499 / 0 / 1 / 0   |
  | c repeating/plain     | 1154 / 0 / 346 / 0 | 1200 / 0 / 300 / 0 | 1206 / 0 / 294 / 0 | 1118 / 0 / 382 / 0 | 1131 / 0 / 369 / 0 |
  | c repeating/reorder   | 1156 / 0 / 344 / 0 | 1206 / 0 / 294 / 0 | 1210 / 0 / 290 / 0 | 1121 / 0 / 379 / 0 | 1131 / 0 / 369 / 0 |
  | c repeating/shift     | 1164 / 0 / 336 / 0 | 1227 / 0 / 273 / 0 | 1233 / 0 / 267 / 0 | 1133 / 0 / 367 / 0 | 1137 / 0 / 363 / 0 |
  | c repeating/both      | 1172 / 0 / 328 / 0 | 1214 / 0 / 286 / 0 | 1216 / 0 / 284 / 0 | 1133 / 0 / 367 / 0 | 1151 / 0 / 349 / 0 |
  | c tiny/plain          | 899 / 0 / 601 / 0  | 975 / 0 / 525 / 0  | 990 / 0 / 510 / 0  | 826 / 0 / 674 / 0  | 838 / 0 / 662 / 0  |
  | c tiny/reorder        | 858 / 0 / 642 / 0  | 947 / 0 / 553 / 0  | 968 / 0 / 532 / 0  | 777 / 0 / 723 / 0  | 792 / 0 / 708 / 0  |
  | c tiny/shift          | 923 / 0 / 577 / 0  | 1015 / 0 / 485 / 0 | 1023 / 0 / 477 / 0 | 833 / 0 / 667 / 0  | 846 / 0 / 654 / 0  |
  | c tiny/both           | 878 / 0 / 622 / 0  | 979 / 0 / 521 / 0  | 999 / 0 / 501 / 0  | 783 / 0 / 717 / 0  | 798 / 0 / 702 / 0  |
  | c2 distinct/disjoint  | 1497 / 0 / 3 / 0   | 1497 / 0 / 3 / 0   | 1497 / 0 / 3 / 0   | 1497 / 0 / 3 / 0   | 1497 / 0 / 3 / 0   |
  | c2 repeating/disjoint | 1196 / 0 / 304 / 0 | 1236 / 0 / 264 / 0 | 1238 / 0 / 262 / 0 | 1154 / 0 / 346 / 0 | 1165 / 0 / 335 / 0 |
  | c2 tiny/disjoint      | 877 / 0 / 623 / 0  | 973 / 0 / 527 / 0  | 997 / 0 / 503 / 0  | 791 / 0 / 709 / 0  | 804 / 0 / 696 / 0  |

  **What the table says.**
  - **narrow** and **pair** lower ambiguity within the tolerance: 3,781 →
    3,225 and → 3,139 in the cells with no such day. Out of it, they make the
    residual worse: head-only wrong accepts go 224 → 1,100 and → 1,388 with 4
    rows, and 626 → 1,154 and → 1,754 with 5. Narrowing removes false readings
    that had been making other false readings ambiguous, so more false readings
    are left alone and get stored. Both fix R8 and neither fixes R1, as step 2
    predicts.
  - **wide 2/3** is the narrowest wide pass that leaves no wrong accept in
    either space. Widening by 2 days, or by 3 days of span alone, leaves some.
    It refuses R1, R6 (lg-59's Log observation) and R8 as "two ways" and changes
    no other repro. Its cost within the tolerance is +474 ambiguous in the
    18,000 trials with no such day (+12.5 %) and +134 in `both`. With distinct
    amounts the cost is 0.
  - **lg-59's in-tolerance enumeration** (gate 1's `tolerance` mode, head only)
    under wide 2/3: with 4 rows over ±10.00 and −5.00, 123,876 / 39,420 → 122,191
    / 41,105 (`correct / ambiguous`; wrong and refused 0 both times). With 4 rows
    over ±10.00, 13,106 / 14,446 → 12,192 / 15,360. The 5-row space was not run.
  - **Time.** Gate 1's timing harness, 54 cases from 200 to 8,000 pasted rows at
    40 and 200 rows a date. `main`, wide 2/3 and pairwide 2/3 ran side by side
    on a machine at load 15, so the absolute figures run above lg-59's. The
    totals are 735,857 ms, 1,367,069 ms (×1.86) and 1,652,049 ms (×2.24). Wide
    2/3's worst ratios are on alternating amounts with the paste inside the
    history: 4,236 → 21,763 ms at 1,000 rows (×5.1), and 58,530 → 184,958 ms at
    2,000 rows and 200 a date (×3.2). The cost is a second search whenever the
    first finds exactly one reading, which is the case for every paste that is
    stored. Wide 2/3 changes 2 of the 54 outcomes, both from a correct accept to
    "two ways": 200 rows of alternating amounts at 40 a date, inside the history
    and missing it.
  - **What wide 2/3 does not cover.** A workbook row dated four or more days
    off still has the residual. Neither enumeration moves a row that far, so it
    was not measured.

  **Open decision, for the owner.**
  - **A. Wide 2/3** (recommended). Store a paste only when no reading with
    dates up to three days off disagrees with the one found. It meets Done when
    1–3: 0 wrong accepts in both spaces, and probes c and c2 at 0 `wrongAccept`
    and 0 `refusedOther`. It costs +474 ambiguous in 18,000 adversarial
    in-tolerance trials and none with distinct amounts. It runs about twice as
    long overall, and up to ×5 on large pastes of alternating amounts. A paste
    it refuses stores nothing; one it leaves out stores rows twice or drops a
    new row and says nothing. The refusal is the "two ways" one, so its message
    should say that one reading pairs rows up to three days apart: as it stands
    it says "the same rows come round again".
  - **B. Pairwide 2/3.** Also meets Done when 1–3, with +383 ambiguous in place
    of +474. It stores 25,828 fewer of the 4-row one-off pastes correctly than A
    does (79,352 against 105,180), and refuses 27,180 more as
    `STATEMENT_CHAIN_BROKEN`. It runs about ×2.2 overall.
  - **C. Leave the rule and record the residual** (Done when 2's escape): 850
    head-only wrong accepts in 245,760 one-off variants, 226 of them dropping a
    new row. No cost.
  - **D. Pair alone**, a Build direction. 642 fewer ambiguous in tolerance, but
    the residual grows: 3,142 head-only wrong accepts in place of 850. R1 is
    still stored wrongly, so Done when 1 has to be rewritten.

  Narrow alone falls between leave and pair on both measures (556 fewer
  ambiguous in tolerance, 2,254 head-only wrong accepts). Like pair it still
  stores R1 wrongly, so it is not offered separately.

  With wide 2/3 switched on, the existing ledger `api` suite passes in the
  experiment tree: 934 of 934, `npx vitest run tools/ledger/api/test/`.

  **The seam lg-58 builds on.** Under A, the reading stored is the one the
  rule finds now. The wider search only adds refusals, so the pairing
  `matchStretch` accepts stays where it is, in `matchBlock`'s call to
  `matchPart`. B moves it into the pairing function, which computes it
  explicitly. (Added at landing, gate 1's first low: under A the pairing is
  decided there but not returned. lg-58 must make `matchPart` and
  `matchStretch` return it, and record only from the stored pass, since the
  rival pass runs through the same code.)

  **Fold-in:** none. No source changed, so nothing was made free.

- 2026-10-20 — **the owner's answer**, relayed by the orchestrator. The
  question was the Build step 3 stop above, as the builder reported it. The
  options as put:
  - **A, wide 2/3** (the builder's recommendation): 0 wrong in both spaces,
    +474 "two ways" in 18,000 in-tolerance trials, about ×1.9 overall, worst
    case 4.2 s → 21.8 s at 1,000 alternating rows and 58.5 s → 185 s at 2,000
    rows at 200 a date, measured under load;
  - **B, pair + wide 2/3**: +383 ambiguous, but 25,828 fewer one-off 4-row
    pastes stored correctly, about ×2.2;
  - **C, leave the rule** and record the 850-case residual through Done when
    2's escape, with Done when 1 rewritten.

  Option D, "pair alone", was not put as an option; the question's text named
  it as leaving 3,142 wrong and still storing R1 wrongly. The owner chose **A,
  wide 2/3**, which overrode no recommendation. Build step 3's named
  directions are marked superseded by this answer.

- 2026-10-20 — builder (Opus 5.5), **A built** in `b8f3db26`, on `main` at
  `da4673e1` (merged in `900b1d4f`; repo-108's `packages/ui` linked by hand into
  this worktree's farm, which lacked it).

  **The rule as written.**
  - `workbook-days.ts`: a `DateTolerance` (`widestBlockDays`, `daysOff`), with
    `STORED_TOLERANCE` (2, 1), lg-59's rule unchanged, and `RIVAL_TOLERANCE`
    (2, `RIVAL_DAYS_OFF` = 3). `matchBlock` and `matchStretch` take one, and
    default to `STORED_TOLERANCE`.
  - `statements.ts`: `readings`, `overlaps`, `nearby` and `workbookStarts` take
    the tolerance. `workbookStarts` reaches `widestBlockDays + daysOff`: 3 days
    as before on `STORED_TOLERANCE`, and 5 on `RIVAL_TOLERANCE`. `store` reads
    the paste on `STORED_TOLERANCE` as before. When that finds exactly one
    reading, it reads the paste again on `RIVAL_TOLERANCE`, and any other
    reading found throws `ambiguousAcrossDays`. Nothing is ever stored on a
    rival reading. Both files' headers say so.
  - **The final message**, as R1 gets it: `The paste starting at 2026-02-20
"Virement 0" -5.00 $ (balance 995.00 $) can be read two ways: as 1 already
stored and 3 new, which fits what is stored, or as 3 already stored and 1 new,
which fits it too if the workbook dated a row up to 3 days from the bank's
date, pairing rows that far apart. The books cannot tell which was meant, so
nothing was stored. Paste a stretch that starts on an earlier row, or on the
first row not stored yet, so only one reading fits.` Its code is
    `STATEMENT_ROW_CONFLICT`, and its `details` have the shape the in-tolerance
    refusal's have (`readings`, most stored first, and the oldest row). The
    in-tolerance "two ways" message is unchanged. Its advice to paste a longer
    stretch holds there, but not here: R1's true reading never fits, so no
    longer paste is stored. A paste starting on the first row not yet stored
    is, as a test shows.
  - **The lg-58 seam.** The pairing a stored paste rests on is decided in
    `matchBlock`'s call to `matchPart`. That is the one reading `STORED_TOLERANCE`
    found; the rival pass only refuses. The pairing is decided there but not
    returned: `matchPart` answers a boolean and `matchStretch` keeps only which
    cuts are reachable. lg-58 must make both return it, and must record only
    from the stored pass, since the rival pass runs through the same code with
    its 3-day readings and the cuttings that did not win. (Reworded at landing,
    gate 1's first low; this bullet had said the doc comment names the pairing
    as `matchPart`'s.)

  **Tests**, appended to `api/test/workbook-days.test.ts`:
  - R1 and R8 (Done when 1). Each asserts that the outcome is the true reading,
    or a refusal that is `STATEMENT_ROW_CONFLICT` with "two ways" or
    `STATEMENT_CHAIN_BROKEN`, and that the workbook's rows are unchanged. Both
    are now refused as "two ways". R1 also pins its two readings and "up to 3
    days".
  - `matchBlock` on `RIVAL_TOLERANCE`: a row 3 days off is weighed, and one 4
    days off is not.
  - The refusal's advice: R1's workbook and the bank's one new row alone are
    stored as 0 present and 1 new.
  - Mutants, each restored from `b8f3db26`. With the rival throw disabled
    (`rivals.length > 99`), R1 and R8 fail, 2 of 38. With `RIVAL_TOLERANCE`'s
    `daysOff` at 2, R1 and the `matchBlock` test fail, 2 of 38.

  **Done when 2 and 3, at `b8f3db26`.** Run as in step 1; the base's outcomes
  were read from the cache step 1 wrote at `335efcd4`.

  | space          | variants | this branch                   | head only | base                             |
  | -------------- | -------- | ----------------------------- | --------- | -------------------------------- |
  | 4 rows, ±5/±10 | 163,840  | 105,180 / 0 / 22,980 / 35,680 | 0         | 78,182 / 11,776 / 3,738 / 70,144 |
  | 5 rows, ±10    | 81,920   | 36,380 / 0 / 33,012 / 12,528  | 0         | 33,744 / 11,424 / 7,940 / 28,812 |

  These match experiment A's row in the entry of 2026-10-20 above, count for
  count. Probes c and c2 at seed 11 are byte-identical to the "wide 2/3" column
  of that entry's cell table (`cmp` exit 0 on both files): `wrongAccept` 0 in
  every cell and `refusedOther` 0 in the `both` cells, and in every other cell.
  Against `main`, each cell's change is that column's against "leave (`main`)":
  - `distinct`: no change in any cell.
  - `repeating`: plain +36, reorder +35, shift +31, `both` +39, c2 +42
    ambiguous.
  - `tiny`: plain +73, reorder +81, shift +90, `both` +95, c2 +86 ambiguous.

  Each of the 16 enumeration shards exits 0, and both probe runs exit 1 on the
  20 s timeout, as before. The gate's R1–R8 repro at `b8f3db26`:
  - R1, R6 and R8 are refused as "two ways".
  - R3 and R7 are refused as "two ways", as on `main`.
  - R4 and R5 are accepted with their true counts, as on `main`.

  **Time, at `b8f3db26` against `main` (`00977771`)**, gate 1's harness, 54
  cases, the two trees side by side. The 1-minute load average was sampled every
  30 s, 16 samples from 02:26:54 to 02:33:59: mean 5.8, 2.7 to 11.7, on 12
  cores. Totals: 460,426 ms on `main` and 790,953 ms here (×1.72).
  - The worst ratio is ×3.30, at 1,000 rows of constant amounts at 40 a date,
    pasted onto the tail: 1,731 → 5,707 ms. No case is worse than ×5.
  - The cases the owner was quoted: 1,000 alternating rows inside the history,
    5,929 → 8,462 ms (×1.43); 2,000 alternating rows at 200 a date inside,
    32,325 → 84,998 ms (×2.63).
  - The slowest case here is that last one, at 85.0 s.
  - Outcomes changed: 2 of 54, 200 alternating rows at 40 a date, inside the
    history and missing it, both from a correct accept to "two ways", as
    measured in the experiment.

  **Checks.** `npm run check` exits 0. `npm test -- --project ledger`: 1,566 of
  1,566 in 71 files.

  **Fold-in:** the in-tolerance `ambiguous` and the new refusal share two
  helpers, `described` and `said`. Nothing else was made free.

- 2026-10-20 — Fixed at landing by owner choice: gate 1, first low
  (`nfr:maintainability`, lg-58's seam) — "`matchBlock`'s comment ("the pairing
  a stored paste rests on is `matchPart`'s") overstates it." `matchBlock`'s doc
  comment in `workbook-days.ts` now says the pairing is decided there but not
  returned, that lg-58 must make `matchPart` and `matchStretch` return it, and
  that lg-58 must record only from the stored pass, since the rival pass runs
  through the same code. This Log's two statements of the seam (experiment A's
  "The seam lg-58 builds on" and the builder's "The lg-58 seam") say the same.
  Fixed together with the next entry, in one commit, as both are comment edits
  to `workbook-days.ts`. `grep -c "not returned: .matchPart. answers a boolean"
tools/ledger/api/src/workbook-days.ts` → 1 (0 at the gated head).

- 2026-10-20 — Fixed at landing by owner choice: gate 1, second low (text) —
  "the code states what the rival pass covers and not what it leaves: a
  workbook row dated 4 days off still stores R1's wrong split (3 added, 1
  present) in all six date contexts I ran, on `main` and on the head alike."
  A comment at `RIVAL_DAYS_OFF` in `workbook-days.ts` now says a workbook row
  dated 4 or more days off is not weighed, and that a paste like R1 against
  such a row is still stored with the wrong split, as on `main`. Same commit as
  the previous entry. `grep -c "4 or more days off is not weighed"
tools/ledger/api/src/workbook-days.ts` → 1 (0 at the gated head).

- 2026-10-20 — Fixed at landing by owner choice: gate 2, low 1 (text, false in
  the safe direction) — "the Log's step-3 paragraph says "`both` is probe c's
  four `both` cells, 6,000 trials". Probe c has three `both` cells (one per
  alphabet), 4,500 trials." In that sentence, in the experiment entry's
  enumeration paragraph, "four" is now "three" and "6,000" is now "4,500".
  `sed -n 220p` on this ticket → "re-dated two days off. `both` is probe c's
  three `both` cells, 4,500 trials." (the gated head's line 220 had "four" and
  "6,000").
