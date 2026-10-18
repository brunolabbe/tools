---
id: lg-40
tool: ledger
title: A paste cannot overlap rows the workbook imported, and the refusal asks for a longer paste that cannot help
kind: fix
status: ready
milestone: null
depends_on: [lg-2, lg-7]
difficulty: hard
---

# lg-40 — A paste cannot overlap rows the workbook imported

## Why

lg-2 places a paste against the stored rows by position, field for field
(`sameRow` in `api/src/statements.ts`: date, category, description, amount,
balance). lg-7 assumed the pastes would already be stored when the workbook
was imported, and placed the workbook _below_ them. But the import also
accepts empty books (`place` in `api/src/workbook-import.ts`, `head ===
undefined`), and that is how the owner ran it on 2026-10-18: the whole history
is workbook rows, and the first paste has to meet them.

It cannot. Workbook rows differ from the bank's in three ways, and the owner's
first paste ran into all three. The paste reached back three weeks into the
workbook's last stretch:

- **Wording.** The workbook's description is its own `Labels` detail
  (`Paiement`, `Dépôt`, `Taxes`), and its category is empty. The bank's are the
  bank's.
- **A date a day off.** One row the bank dates the 25th, the workbook dates the
  26th. §8 of `00-ANALYSIS.md` already records one such row.
- **A different order within a day.** On a day with three movements, the
  workbook lists them in the reverse of the bank's order. The day ends on the
  same balance, but the two rows before the last carry different running
  balances.

No pasted row matches a stored one, so `fail` falls through to `gap`, and the
refusal reads: _"A row is missing between the two, so paste a longer stretch
that overlaps what is stored."_ Nothing is missing, and no longer paste can
succeed. The only paste that works starts on the first row after the
workbook's newest row, so it reads as a `k = 0` continuation.

Reproduction, synthetic (not the owner's figures). Workbook rows imported into
empty books, oldest first:

| date       | description | amount  | balance  |
| ---------- | ----------- | ------- | -------- |
| 2026-03-01 | Dépôt       | +100.00 | 1 100.00 |
| 2026-03-01 | Dépôt       | +50.00  | 1 150.00 |
| 2026-03-01 | Taxes       | −200.00 | 950.00   |
| 2026-03-10 | Paiement    | −300.00 | 650.00   |

Then a paste in the bank's words. 1 March holds the same three movements in
another order (−200, +100, +50: balances 800, 900, 950), 10 March's payment is
dated the 9th, and one new row follows (2026-03-12, −20.00, 630.00). Today this
is refused with `STATEMENT_CHAIN_BROKEN` and "paste a longer stretch". It
should add the one new row.

## Build

1. Recognise which stored rows came from the workbook:
   `statement_imports.source = 'workbook'`, joined through `import_id`.
2. In `readings` (`api/src/statements.ts`), where the overlapping stored rows
   are workbook rows, compare them the way lg-7 compares a workbook with a
   paste: **never by description or category**, and with a date one day off
   reported rather than refused. Within one day's run of rows, allow the order
   to differ: the run must hold the same amounts and end on the same balance.
   Work out the exact rule against the cases in Done when, and record it in
   the Log and in the file's header comment. The ambiguity refusal must keep
   working: a reading this tolerance makes possible counts like any other.
3. The overlapping rows are not stored again, and **a stored row is never
   edited**. The workbook's wording stays on its rows. Only the rows past the
   tail are inserted.
4. When nothing fits and the tail is a workbook row, the refusal says so. It
   names the newest workbook row and the first pasted row that would continue
   from it (if the paste holds one), and never says "paste a longer stretch".
   Keep the code (`STATEMENT_CHAIN_BROKEN`), and keep `details` free of
   anything the logs would carry (the ledger `CLAUDE.md`'s rule on `details`).
5. Check whether lg-7's own placement (`readings` in
   `api/src/workbook-import.ts`) has the same reordered-day blind spot when
   pastes come first. If it does, fix it with the same rule here, or file it
   separately and say which in the Log.

## Done when

1. A test in `api/test/statements.test.ts` imports the synthetic workbook rows
   above, pastes the synthetic paste, and gets `rowsAdded: 1`, with the four
   workbook rows unchanged.
2. A test proves each tolerance alone: wording only, a one-day date only, a
   reordered day only. Each is accepted.
3. A test proves a date two days off is still refused, and so is a reordered
   day whose amounts differ by one row.
4. A test proves an overlap with _pasted_ rows still compares every field, as
   before.
5. A test proves a paste whose tail is a workbook row and which fits nowhere is
   refused with a message that names the workbook and does not contain "paste a
   longer stretch".
6. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-18 — filed from the owner's first paste after the workbook import.
  Measured on a scratch copy of their local books: the same paste starting on
  the first row after the workbook's newest row was accepted (3 rows added), and
  one starting a row earlier was refused with the gap message.
- 2026-10-18 — **Build item 5, the owner's answer.** Asked by the orchestrator
  on 2026-10-18, before the build: "if lg-7's own placement (`readings` in
  `workbook-import.ts`) has the same reordered-day blind spot, what should the
  builder do?" Options: (a) fix it here, (b) file it as a new lg- ticket, (c)
  the builder's call as written. **The owner chose (a), fix it here**: reproduce
  first, and if it exists fix it with the same rule as item 2, with a test in
  the workbook-import suite.
- 2026-10-18 — built (builder, branch `lg-40-paste-overlaps-workbook-rows`,
  base `960f4b26`).

  **The rule**, in `api/src/workbook-days.ts` and used by both files. The
  workbook's rows are cut into runs, each a stretch of consecutive rows on one
  date (cut on the workbook's dates); the other side's rows at the same
  positions are the run's counterpart. A run and its counterpart must (1) hold
  the same amounts, counted with repeats, (2) end on the same balance, and (3)
  for a paste, have every bank row dated the run's date or a day either side;
  the workbook import keeps lg-7's "any date, reported" instead. Wording is
  never compared. Since every run ends where the other side's does and holds
  the same amounts, it also opens where it does, so the balances agree at every
  day boundary and only the order within a day may differ. In `statements.ts`,
  a stored row is a workbook row when its `statement_imports` row has
  `source = 'workbook'`; a row a paste stored is compared field for field, in
  order, as before. The same comparison serves the `k`-row overlap and the
  paste-inside-the-history reading, whose start candidates now include every
  workbook row dated within a day of the paste's oldest row. A day the workbook
  both re-dated and reordered is two runs and does not match.

  **Item 5 reproduced on the base**, then fixed. Pasted rows `−20, +10, +5` on
  2024-03-01 and the workbook listing the same day `+10, +5, −20`, with
  `workbook-import.ts` as at `960f4b26` and only the new test added:
  `npx vitest run tools/ledger/api/test/workbook-import.test.ts -t "lg-40"` →
  1 failed | 1 passed, the import refusing with `2024 row 2, 2024-03-01 "Achat"
-20.00 $ (balance 1599.99 $) moves the same day and amount as the oldest
stored row, but leaves 1599.99 $ where it leaves 1584.99 $: -15.00 $ is
unexplained.` Fixed in `readings` and `place`, not in `run()`. `place` now
  pairs each movement with its own stored row within a day, not the row in its
  position, so "dated differently" names the right row, and `lastSeq` is the
  position the overlap reaches.

  **The ticket's reproduction on the base**: `npx vitest run
tools/ledger/api/test/statements.test.ts` with the source at `960f4b26` and
  the new tests added → 8 failed | 42 passed (50), the first with "A row is
  missing between the two, so paste a longer stretch that overlaps what is
  stored." After the fix, 50 of 50.

  **Mutations**, each from commit `1ef52779` and restored from it, both spec
  files (81 tests): no date window for a paste → 2 fail (two days off, and the
  refusal naming the workbook); amounts not compared → 3 fail; end balance not
  compared → 7 fail; pasted rows compared day by day as well → 3 fail (two lg-2
  tests and "rows a paste stored above the workbook's"); the workbook refusal
  replaced by the gap message → 1 fails; no workbook start candidates for a
  paste inside the history → 1 fails; lg-7's pairing back to positional → 1
  fails.

  **What the brief had wrong, or left open.**
  - "A date one day off reported rather than refused": the paste's answer,
    `ImportStatementReport`, has no field to report it on, and adding one is a
    contract change and a screen change. Built as accepted and not reported:
    the stored row keeps the workbook's date and the paste's is dropped. Left to
    the orchestrator as an open decision.
  - The tolerance had to reach the paste-inside-the-history reading too, or a
    paste lying wholly inside the workbook's rows would be refused; done here,
    with its own test.
  - `fail`'s two "the paste departs from a stored row" refusals find stored
    rows by date, description, amount and balance, which a workbook row could
    match only by accident, and would then name its empty category as the
    difference. They now consider rows a paste stored only, and a paste whose
    shared rows sit just above the workbook's gets the workbook refusal.
  - The refusal cannot promise that no longer paste helps: a paste starting
    partway through a reordered day compares only the part of the day it holds.
    So it says what was compared and names the pasted row that opens from the
    workbook's last balance (`continuesAt` in `details`, or `null`), and never
    asks for a longer stretch.
  - `run()`'s report line "one for one, by amount and balance" now reads day by
    day; left as it is, since `run()` is the seam with lg-38 (#542).

  Fold-in: none. lg-54 is the only other ready ticket on the paste, and its work
  is the screen and possibly the report's contract, not free here.

- 2026-10-18 — **Gate 1's decisions, the owner's answers.** All asked by the
  orchestrator on 2026-10-18.
  - F1/F2, a paste starting partway through a reordered day. Options: (A) admit
    a partial first day, the gate's recommendation; (B) reword the message and
    header and record F2 as a known limit; (C) land as built and file F2.
    **The owner chose A**, and to fix F3 and F6 in the same round. F4 and F5 stay
    recorded unfixed.
  - The builder's open decision on a date a day off, which the paste's answer
    has no field to report. Options: file a new lg- ticket (the builder's
    recommendation), add it in this branch, or leave it unreported. **The owner
    chose to file a new lg- ticket**, filed by the lander, not in this round.
- 2026-10-18 — round 1 (builder), on `cea53bf7`.

  **The rule, as it now stands.** Inside one of the workbook's days only its
  opening and closing balances are real; the balances it shows between them
  follow its own order, and nothing is compared with them any more. A paste's
  rows that fall in one of the workbook's days are weighed against the whole day
  (`matchPart` in `api/src/workbook-days.ts`), the rows its stretch leaves out
  included (`restOfDay` in `statements.ts`). Placed as the bank's rows `b` to
  `b + n` of that day, they must be among the day's amounts, counted with
  repeats, each dated within a day of it, and must open from a balance the bank's
  day reaches after `b` of its other amounts: the day's opening when `b` is 0,
  the day's closing after their last row when they run to the day's end, and
  otherwise some `b` of the remaining amounts adding up to the difference, found
  by a search over sums for days of up to 20 rows (`LONGEST_SEARCHED_DAY`; a
  longer day admits no part that starts and ends inside it). A whole day reduces
  to the old comparison. The workbook import keeps cutting a day where its own
  listing puts the edge (`alignDays`): it adds the workbook's rows before the
  pastes, so those must be the rest of the day, which only the workbook's listing
  can say, and admitting a part the way a paste does would let it add the wrong
  ones.

  **F1 reproduced, then fixed.** The gate's grid ported to
  `statements.test.ts` › "a paste partway through one of the workbook's days" ›
  "a day the workbook lists as %s, pasted from the bank's row %i of it on, adds
  only the new row (F1)": 5 non-identity orders × 2 mid-day starts. With the
  source at `cea53bf7`, `npx vitest run tools/ledger/api/test/statements.test.ts
tools/ledger/api/test/workbook-import.test.ts` → 10 failed | 88 passed (98): 8
  of the 10 F1 cases (the gate's count), F2 and F6. At `b4bcb94b`, all pass.

  **F2 reproduced, then fixed.** The gate's probe `gate-lg40g`: at `cea53bf7`
  the bank's last two rows were `ACCEPT add=0 present=2 tail=101000`, the
  follow-up with the next day's row `REFUSE STATEMENT_CHAIN_BROKEN`. At
  `725722ea` and `b4bcb94b`: `REFUSE STATEMENT_ROW_CONFLICT` naming two readings
  (0 new, or 1 new), and the follow-up `ACCEPT add=2 present=1 tail=101750`, the
  truth. The gate expected the ambiguity refusal; it is what happened. Ported as
  "a paste whose rows fit a reordered day two ways is refused, not stored as one
  of them (F2)".

  **The exhaustive probe** (`gate-lg40d`, every one-day history of up to six
  rows, every workbook order, every paste start; split by start here, as
  `gate-lg40d2`). It hits vitest's 20 s timeout and still writes both alphabets.

  | ±10.00                    | `cea53bf7` | `b4bcb94b` |
  | ------------------------- | ---------- | ---------- |
  | same order, correct       | 1 358      | 1 048      |
  | same order, ambiguous     | 562        | 872        |
  | reordered, correct        | 24 474     | 15 960     |
  | reordered, ambiguous      | 18 946     | 43 376     |
  | reordered, refused        | 9 280      | 0          |
  | reordered, wrong (skip)   | 2 636      | 0          |
  | reordered, wrong (double) | 4 000      | 0          |

  With +10.00/−5.00: wrong 1 284 skips and 2 340 doubles → 0, refused 13 252 →
  0, ambiguous 8 976 → 26 364, correct 35 404 → 34 892. **No wrong answer and no
  refusal remains; the cost is ambiguity.** The workbook's balances inside a day
  used to break ties, sometimes rightly and sometimes, as in F2, wrongly, so
  every tie they broke is now a refusal naming both readings. Split by where the
  paste starts, ±10.00: same-order pastes from the day's first row 368 correct
  and 148 ambiguous before, 300 and 216 after; reordered 6 084 and 4 420
  before, 4 024 and 6 480 after. Those are histories of one day, where no
  earlier row exists to settle a reading; with an earlier day, a stretch that
  starts on it settles one.

  **The randomised probe** (`gate-lg40c`, seed 11, 1 500 trials a cell), wrong
  accepts `cea53bf7` → `b4bcb94b`: distinct amounts 0 → 0 in every mode;
  repeated amounts, reordered 10 → 0 and reordered with dates moved 29 → 22;
  ±10.00, reordered 17 → 0 and reordered with dates moved 38 → 31. Refused
  correct pastes, reordered, 98, 69, 41 → 0. Ambiguous, rows in the bank's own
  order: 134 → 167 (repeated) and 296 → 364 (±10.00), the same cost as above.
  **What is left wrong** is the case this ticket already named: a day the
  workbook both re-dated and reordered is two runs, the true reading is not
  admitted, and a shorter overlap or a `k = 0` continuation on a balance that
  happens to match is then the only reading, and stores rows twice. The six
  wrong cases the probe prints (three per cell) are all of that shape: three
  `k = 0`, two `k = 1`, one `k = 2`. The gate measured the base, before lg-40, storing rows
  twice the same way (256 of 1 920 same-order one-day cases). Not fixed here; it
  needs runs that span a re-dated row.

  **F3.** `api/test/workbook-days.test.ts`, 16 tests: `dayBefore` across a month,
  a leap day and a year; `dayRuns`; `matchDay`; `matchPart` at a day's start,
  its end and its middle, an amount the day lacks, the window, and the search
  bound; `alignDays`. In `statements.test.ts`: "a paste wholly inside the
  workbook's rows, in the bank's order and dated %s, a day off, adds nothing
  (F3)" for 2026-02-28 and 2026-03-02, "… but dated %s, two days off, is refused
  (F3)" for 2026-02-27 and 2026-03-03, and "a pasted row dated before the
  workbook's newest day is not named as continuing it, whatever its balance
  (F3)". Mutations, each restored from `b4bcb94b`, over the three suites (114
  tests): the gate's three — `dayBefore` two days back → 5 fail, `workbookStarts`
  on the pasted date only → 2 fail, `continuesAt` without its earliest date → 1
  fails; and this round's — a day's start unchecked → 1, its end unchecked → 8,
  its middle unchecked → 1, no search bound → 1, amounts unchecked → 3,
  `restOfDay` empty → 9.

  **F6.** `workbook-import.ts`: `place`'s refusal and `run()`'s report line say
  "day by day" where they said "one for one" (the one-line change in `run()`,
  the seam with #542). `contract/src/errors.ts`: the note on
  `STATEMENT_CHAIN_BROKEN` now names the workbook refusal's details; no type and
  no code changed. Test: `workbook-import.test.ts` › "the report and the refusal
  say the rows are compared day by day (gate 1, F6)".

  **The refusal and the header, against the new rule.** The workbook refusal no
  longer says "it is not their wording, their order or a date a day off that
  differs", which was false for F1 and stays unprovable for a re-dated and
  reordered day. It now says how the rows are compared, that a paste may start or
  end partway through a day, and that wording is never compared. The header
  says the refusal does not ask for a longer stretch because the paste reached
  the stored rows, not that a longer one could not help.

- 2026-10-18 — Fixed at landing by owner choice: gate 2, F7 — "Three pieces of
  the fix are asserted by no test, though their absence has a live effect."
  Three tests added at the end of their suites, each run red against its mutant
  and green on the clean source, the source restored from a copy after each:
  `npx vitest run tools/ledger/api/test/workbook-days.test.ts
tools/ledger/api/test/statements.test.ts` → clean 92 passed (92); `later`
  emptied in `overlaps` → 7 failed | 85 passed, in "a paste wholly inside a
  reordered day the workbook lists between two others (F7)" › "a day of three
  listed as %s, pasted from any of the bank's rows to any other inside it, adds
  nothing" (five of its six orders) and "a day of five listed as %s, pasted from
  a row with two or three before it, adds nothing" (4,3,2,1,0 and 2,3,4,0,1);
  `restOfDay` not reversed → 3 failed | 89 passed, all three orders of the
  five-row test; `>` made `>=` at `LONGEST_SEARCHED_DAY` → 1 failed | 91 passed,
  "matchPart: the longest day that is searched (F7)" › "a day of exactly the
  longest the search allows admits a part that starts and ends inside it".
- 2026-10-18 — Fixed at landing by owner choice: gate 2, F9 — "The workbook
  refusal and the `statements.ts` header promise the tolerances without their
  two exceptions." The refusal's sentence "…and a paste may start or end partway
  through a day. Their wording is never compared." now reads "…and a paste may
  start or end partway through a day, except that a day the workbook both
  re-dated and reordered is refused, and so is a paste that starts and ends
  inside a day of more than 20 rows. Their wording is never compared."; the
  `statements.ts` header and the `workbook-days.ts` header name both.
  `npx vitest run tools/ledger/api/test/statements.test.ts
tools/ledger/api/test/workbook-import.test.ts
tools/ledger/api/test/workbook-days.test.ts` → 3 files, 124 passed (124); no
  test asserts the refusal's text.
- 2026-10-18 — **Gate 2's decisions, the owner's answers.** Asked by the
  orchestrator on 2026-10-18.
  - "A day the workbook both re-dated and reordered can still store rows twice"
    (gate 2's open decision). Options: file a new lg- ticket (the builder's
    recommendation), leave it recorded only (the gate's), fix it in this branch.
    **The owner chose to file a new lg- ticket**: lg-59, filed separately, in a
    pull request of its own. It is not fixed here.
  - "Remedy A's cost, more ambiguity refusals" (gate 2, F8). Options: accept as
    built (the recommendation), file a wording follow-up. **The owner chose to
    accept as built.** F8 stays recorded, unfixed.
  - The one-day-off date the paste's answer cannot report, gate 1's decision:
    filed as lg-58 (PR #555), as the owner chose after gate 1. Round 1's entry
    left it to the lander ("filed by the lander, not in this round"); this entry
    is the only place the Log names the ticket.
