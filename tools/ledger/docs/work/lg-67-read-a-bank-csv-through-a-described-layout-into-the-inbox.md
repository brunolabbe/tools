---
id: lg-67
tool: ledger
title: Read a bank CSV the reader does not know through a layout a model describes, into the inbox
kind: work-package
status: needs-decision
milestone: P6
depends_on: [lg-66]
difficulty: hard
---

# lg-67 — Read a bank CSV through a layout a model describes, into the inbox

## Why

lg-66 builds the import of an `.xlsx` the reader does not know: a model
describes the layout, the person confirms it on screen, and the reader reads the
file through it. Its Decision 2, "Which files", was answered by the owner on
2026-10-24 as (b), bank CSVs too, over the recommendation (a), `.xlsx` only. The
owner was then asked how to carry that out and chose "Split: file lg-67 for
CSVs": lg-66 lands as the `.xlsx` build with a CSV refused "until lg-67", and
this ticket serves bank CSVs (lg-66's Decision 2 and the Log entry of
2026-10-24, "the owner's answers to the three open decisions"). lg-66's Decision 1
was answered (a), a web flow, so a CSV arrives through the same screen.

What the two measurements (lg-38, lg-56) show about CSVs, and no more:

- **Seven of the 13 measured fixtures are bank CSVs** (`csv-balance`,
  `csv-no-balance`, `empty-columns-csv`, `bank-preamble`, `bank-two-dates`,
  `bank-footer`, `bank-wide`), invented, with 32 to 40 rows each. They hold 150
  of the 300 records: Haiku 5.5 shown 70, masked 70, Sonnet 5.5 shown 10 (on
  `bank-two-dates` only).
- **The one let-through observed is on a CSV fixture.** On `bank-two-dates`
  Haiku read `Date of transaction` where `Date posted` belongs in 9 of 10 shown
  runs and 1 of 10 masked; Sonnet read the posted date in 10 of 10. The
  verifications refused none of the ten, and the reader reports 2 rows
  `outOfOrder` against 0 for the correct description (lg-56's Log, "Let through,
  and its bounds"). On the six workbook fixtures Haiku had no let-through in 120
  runs. That is why the owner's guard, the date column on the confirmation
  screen, matters to this ticket more than to the workbook one.
- **A CSV has no bucket column.** The reader returns its rows as `unfiled`
  (lg-38's Log, "A CSV has no buckets"), and `importWorkbook` refuses any
  unfiled row, so a CSV cannot go through lg-66's write. It is a statement's
  rows, which `statements.ts` stores and the inbox files.
- **A CSV with no balance column proves nothing.** The reader reports it as one
  problem, naming the missing column. Haiku named no balance column in 0 of the
  20 answers on `csv-no-balance` (correct: it has none) and named one in 120 of
  120 answers on the six fixtures that have one (offline, from the records:
  Decision 1).
- **The answers carried nothing a CSV cannot have.** Of the 150 answers, 0
  named a bucket, a bucket or person column, a carry-over label, summary rows,
  periods or salaries; 1 set `yearPerSheet` (`csv-balance-5`, masked, refused
  by the verifications with 2 problems).
- **Not measured, and the reader as it stands does not read them:** decimal
  commas, semicolon delimiters, thousands separators, dates other than
  `yyyy-mm-dd`, and any encoding other than UTF-8 (lg-56's "Not measured";
  Decision 3 prices them offline).

Nothing here speaks for a real bank's export, for a model, effort or prompt
other than the ones lg-56 measured, or for more than 13 invented fixtures.

**A defect found in the CSV reader while writing this**, reproduced at lg-66's
base (`834006f0`): `api/test/layout/csv.ts` reads a field of plain digits as a
number, so `007` in a detail column becomes the number 7, and the books' reader
returns the detail as `""` with no problem, because `textOf` reads only text
cells (`books/src/workbook.ts`). The reproduction is in the Log. Decision 6
asks where it is fixed.

## Decision — open

Seven questions the owner's answers do not settle. The Build is written for the
recommended option of each; under another, the Build steps named under the
question are rewritten. None is answered here, and the Log's entry of today
records the measurements each option's costs rest on.

### 1. What proves a CSV that has no balance column

A balance column is what proves a CSV's rows against themselves: the reader
checks that each row's balance follows from the one before. Without one,
`statement_rows.balance_cents` is `NOT NULL` (`api/src/db/schema.ts`,
migration 1), so a stored row needs a balance from somewhere, and the reader
says "nothing proves the N rows read are all of them or that their amounts are
right" (`books/src/workbook.ts`, `verifyYears`, N being the count). 6 of the 7 CSV fixtures have
a balance column; `csv-no-balance` does not.

- **(a) Recommended: refuse it, in plain words.** A CSV is served only when the
  description names a balance column; otherwise the reading's problem is shown
  and nothing is stored. Costs: a bank export without a balance column gets
  nothing from this ticket (1 of the 7 shapes measured; how common it is among
  real exports is unmeasured). Nothing new is built or stored, and no figure
  enters the books that the file did not state. A later ticket can add (b) or
  (c) with the owner's answer in hand.
- **(b) The person states the balance after the newest row, and the app derives
  each row's balance backwards.** Proof: opening plus the amounts lands on the
  figure the person read off their statement, and, when the history holds rows,
  the derived opening equals the stored tail's balance (the paste's "opens from
  the stored tail's balance" rule, `statements.ts`). Costs: a new input on the
  screen and a derivation; the proof is of the **sum** only, so a dropped row
  offset by an extra one, or two amounts swapped between rows, still passes;
  and every derived balance is stored in a column the books treat as the
  bank's, with nothing marking it as derived (`statement_rows.note` exists but
  holds the workbook's note).
- **(c) Match its rows one for one against a statement paste of the same dates**
  (the reader's own message, and `00-ANALYSIS.md` §8: "for the months a paste
  also covers, the rows match one for one"). Costs: it needs stored rows
  covering the same dates, so the household with an empty history, the first
  import, cannot use it; it needs matching on amounts and dates alone (a CSV
  has another bank's wording and no category), which is the day-wise matching
  of `workbook-days.ts` pointed at another source, in the code three tickets
  (lg-40, lg-59, lg-61) tuned; and none of the 7 fixtures can exercise a
  repeat, since none has a repeated (date, amount) pair (Log).
- **(d) Store it on the person's confirmation alone.** Costs: the confirmation
  becomes the only proof; a missing or extra row is silent, which is what the
  reader's problem exists to stop. Not recommended.

Under (b), (c) or (d), Build 4 and Done when 5 are rewritten, and (b) adds a
field to the confirmation (Decision 4).

### 2. How its rows are placed against rows already stored

A paste is placed by `statements.ts`: the first paste into an empty database is
the anchor; a later paste must overlap the stored tail exactly, row by row
field for field, or continue from it; and "a pasted row that disagrees with a
stored one is refused with both named, not reconciled". The workbook's rows are
compared day by day, amounts only (lg-40). A CSV is a third source, with
another bank's wording and **no category**: `statement_rows.category` is
`NOT NULL`, and the paste parser itself refuses an empty one
(`books/src/statement.ts`, "an empty category").

Measured offline (Log): 8 invented paste rows stored, then a paste of rows 5 to 9. Identical rows: 2 stored, 3 already present. With row 6's category changed
and nothing else: `STATEMENT_ROW_CONFLICT`, fields `["category"]`.

- **(a) Recommended: after the stored tail, or into an empty history; never
  overlapping.** The first CSV into an empty history is the anchor. Otherwise
  its oldest row must open from the stored tail's balance (the paste's `k = 0`
  case), and a CSV that overlaps rows already stored is refused with the tail
  named (its date and balance), nothing stored. Rows are stored with source
  `paste` (no migration), oldest lowest, in one `IMMEDIATE` transaction with
  the tail read inside it. Costs: a person whose export overlaps what is stored
  must cut the file first; the refusal says where. **And the other direction is
  not solved**: rows stored from a CSV have no category, so a later AccèsD paste
  that overlaps them meets the conflict measured above, since `candidates`
  compares stored paste-sourced rows field for field. That is a cost this
  ticket leaves to a later one, and the Notes record it. An empty category on a
  stored row is also new (no paste can store one); what the spending-category map
  and the history make of it is unmeasured.
- **(b) Overlap allowed, compared as a paste compares.** Costs: it cannot work
  as measured, because a CSV row has no category to equal the stored one's; it
  would need `statements.ts`'s comparison changed for CSV rows (a rule shared
  with every paste, tuned by lg-2, lg-40, lg-58, lg-59 and lg-61), or a
  category invented for the row.
- **(c) Overlap allowed, compared as the workbook's rows are** (day by day,
  amounts counted with repeats, dates a day off). Costs: new code in the most
  tuned module of the tool, ambiguity refusals to design for a source with no
  real example, and the 7 fixtures have 0 repeated (date, amount) pairs to test
  it with (a test would add one).
- **(d) Always stored as a new batch, never compared.** Costs: a CSV that
  overlaps stored rows double-books them; with a balance column the chain
  would break at the seam and nothing would say so. Not recommended.

Under (b), (c) or (d), Build 4 and Done when 8 are rewritten; (c) and (b) also
change `statements.ts`, and a new `source` value for a CSV would be a table
rebuild (`statement_imports.source` is a `CHECK`, which SQLite cannot alter in
place).

### 3. The shapes the reader does not read

`csv.ts` reads a comma delimiter, `.` decimals, no thousands separator and ISO
dates, and the models were measured on files written that way. Offline (Log):
the 7 fixtures re-serialised five other ways (a semicolon delimiter; a comma
delimiter with quoted decimal commas; a semicolon with decimal commas; quoted
thousands commas; dd/mm/yyyy dates) and read through their correct
descriptions, 35 files. **None was read wrongly: 0 of 35 gave rows with no
problem.** But at lg-66's base a semicolon file reads 0 rows, skips 0 and
reports 0 problems (14 of 14 semicolon files), the gap lg-66's Build 2.2 closes;
the rest reported at least one problem (21 of 21; a thousands-comma
`csv-no-balance` read 24 of 32 rows and reported 9 problems, the missing balance
among them). What the **model** answers on such a file is unmeasured, and so is
a file that is not UTF-8 (a sixth shape, not among the 35).

- **(a) Recommended: refuse them in plain words, naming the shape.** Before
  anything is sent, whole-field patterns find a semicolon or tab delimiter, a
  decimal comma, a thousands separator, a date that is not `yyyy-mm-dd`, or
  bytes that are not UTF-8, and the person is told which. Costs: a file in
  another shape is unserved (how many real exports are such is unmeasured); a
  field that matches a pattern by chance refuses a good file, and the message
  has to say so. It stays within lg-66's rule that shapes the measurement did
  not cover are "refused or said plainly and never guessed".
- **(b) Read them: the reader detects the delimiter, the decimal mark, the
  thousands separator and the date order, and hands the model the same kind of
  grid it was measured on.** Costs: a detection to build and trust; ambiguity
  (`1,234` is one thousand two hundred thirty-four or one and a quarter;
  `03/04/2024` is two dates), and offline all 7 fixtures hold a day above 12,
  which settles day and month for the file, while 16 to 20 of each file's 32
  to 40 dates have a day of 12 or less, so a short export might not settle it;
  and where a wrong guess scales an amount by 100, only a balance column
  catches it (Decision 1 (a) means the files served have one).
- **(c) The person states the format on the screen** (delimiter, decimal mark,
  date order). Costs: three more controls on a screen with a 360 px case, and
  the person must know them.

Under (b) or (c), Build 2 is rewritten.

### 4. What the confirmation shows for a CSV

lg-66 Build 4.2 shows the date column the description chose (letter, header,
3 oldest and 3 newest rows' dates with detail and amount) and each bucket
label. A CSV has no bucket label, so the second element has nothing to show.
The owner chose the date column as the guard (lg-38's Log); lg-66 says showing
more is "a choice for the owner, not an addition for the builder".

- **(a) Recommended: the date column element alone, as lg-66 builds it, and the
  dry run's report.** Offline (Log), on `bank-two-dates` the 3 oldest and 3
  newest rows' dates under the let-through description differ from the correct
  description's in 3 of 6 positions (for example 2024-01-04 for 2024-01-08, and
  2024-04-19 for 2024-04-20), and the header reads `Date of transaction` for
  `Date posted`, so a person who has the bank's page open can see it. Whether a
  person does is unmeasured. The same element shows the detail beside each date,
  which is where a detail read from the wrong column (`bank-wide`'s pinned
  let-through, not produced in 300 runs) would show. Costs: nothing else is on
  screen.
- **(b) The date column element plus the totals**: the count of rows, the sum in,
  the sum out, and the first and last balance. Costs: more on the screen than the
  owner chose; the totals are the file's, so they show a wrong sign only to a
  person who knows the real totals.

Under (b), Build 5 and Done when 11 gain the totals.

### 5. What the CSV's sheet is called in what is sent

A CSV has no sheet name of its own, so the reader names its one sheet. The
fixtures name it as a bank file would (`releve-2024.csv`), the view prints it
(`## Sheet "releve-2024.csv": …`), and the description selects the sheet by it:
**69 of the 70 Haiku shown answers on the 7 fixtures select the sheet by
name** (`names`), the 70th by `prefix`.

- **(a) Recommended: a fixed name, `statement.csv`.** Nothing about the uploaded
  file's name goes to Anthropic or into a log. Costs: the request for a CSV then
  differs from the measured one by that string, so the seven CSV fixtures get
  seven new `layoutRequest` pins beside the old (a deliberate addition, not an
  edit of the 13), and the effect of the new name on what Haiku answers is
  unmeasured. Re-measuring the 70 Haiku shown runs on the 7 fixtures would cost
  about $0.053 (the 70 records' `costUsd` sum to $0.0532), with the owner's key;
  Done when 12 is that, awaiting.
- **(b) The uploaded file's name, cut and cleaned.** Costs: whatever the bank
  or the person put in the name leaves the house, so lg-66 Build 4.1's statement
  must name it; it reaches the request, so it needs the same cleaning as a cell's
  text; and no log line may hold it (lg-66 Build 3.6). The request is the
  measured kind, so the 13 pins stand.

Under (b), Build 3 and Done when 10 are rewritten and Done when 12 goes.

### 6. Where the digits-only detail is fixed

Reproduced (Log): `007` in a CSV's detail column reads as the number 7, and the
books' reader returns the detail as `""` with `problems` `[]`. The cause is two
steps: the CSV reader turns a plain-digits field into a number cell (a leading
zero is gone at that step), and `textOf` in `books/src/workbook.ts` reads only
text cells, so a number cell in the detail column is empty. An `.xlsx` whose
detail cell is a number would read empty the same way (from the code; not
reproduced). Offline, 0 of the 13 fixtures read any row with an empty detail, so
neither a fix nor its absence moves a pin.

- **(a) Recommended: fix it here.** The CSV reader keeps a field that starts with
  a zero followed by a digit as text (`007` stays `007`; `0.50` is still a
  number), and the detail role reads a number cell as its digits (`42` reads
  `"42"`). Costs: the second change is in `@ledger/books`, which the household's
  own `import:ledger` also uses; a detail cell that is a number would then be read
  where it was read as empty, and the import's own report would differ for a
  workbook that has one (unmeasured: the household's workbook is not in the
  repository, and none of the 13 fixtures has one).
- **(b) File it as its own `fix` ticket, and have the CSV path refuse an empty
  detail for now.** Costs: an intake slot, a dispatch, a gate and a merge for a
  reproduction already in hand, and a good file with a digits-only reference is
  refused until it lands.
- **(c) Leave it.** Costs: a digits-only detail is stored empty, silently.

Under (b) or (c), the change Build 1 makes under this Decision goes and Done
when 4 is rewritten.

### 7. Whether the stored rows pass through the rules

A paste's rows are run through `classifyAdded` in the same transaction that
stores them (lg-4, lg-17): a row the most specific matching rules agree on is
filed, a row whose description three person-given answers agree on is filed
from history, and every other row waits in the inbox. The owner's words for a
CSV were "stored the way a statement paste stores them (they wait in the inbox,
unfiled)".

- **(a) Recommended: as a paste does.** The same call, in the same transaction;
  `rowsInInbox` is the rows nothing filed. Costs: a rule or a history answer
  keyed on a description files a CSV row whose bank wording happens to equal it,
  which is the paste's own behaviour, and whether two banks' identical wording
  can mean different things is unmeasured.
- **(b) None filed: every CSV row waits in the inbox.** Costs: the person files
  each row by hand, including those their own rules would have filed; it is the
  literal reading of "unfiled", and a store path without `classifyAdded`.

Under (b), Build 4 drops the classification call and Done when 9 is rewritten.

## Build

Written for the recommended option of each Decision above: no-balance CSVs
refused (1 a), placement after the tail or into an empty history (2 a), the
unread shapes refused plainly (3 a), the date column alone (4 a), a fixed sheet
name (5 a), the digits-only detail fixed here (6 a), and the rules run as for a
paste (7 a). It reuses lg-66's flow and does not restate it: "lg-66 Build 3.1"
is that ticket's describe request, "Build 3.2" its confirm request, "Build 3.3"
its bounds, "Build 4" its confirmation screen. Everything not named here is as
lg-66 builds it, including the consent field, the single model call, nothing
stored between the two requests, the error taxonomy, and the rule that no log
line holds the upload's content, its name or the key. **This build amends
lg-66's Done when 13**, which refuses a CSV "until lg-67": Done when 1 below
replaces it, and lg-66's Build 3.1 sentence "A CSV is refused this way until
lg-67" goes with it.

1. **Move the CSV reader from `api/test/layout/csv.ts` into `api/src`**, taking
   bytes as well as text: a leading byte-order mark is dropped, and the bytes
   are decoded as UTF-8 only when they are valid UTF-8 (Build 2 says what
   happens otherwise). The fixtures and
   the harness import it back, so there is one copy. lg-66's 13 `layoutRequest`
   pins and its schema pin stay as they are and must pass unchanged: the seven
   CSV fixtures are built from the moved reader. The quoted-field rule, the
   number rule and the date rule are the ones measured; one change is made
   (Decision 6 (a)): a field that starts with a zero followed by a digit stays
   text, and `textOf` in `books/src/workbook.ts` reads a number cell as its digits
   for the detail role. The Log records the 13 fixtures' count of rows read with
   an empty detail before and after (0 of 13 before).
2. **Judge a CSV from the bytes** (lg-66 Build 3.1's judgement is for an `.xlsx`).
   A file that is a workbook by lg-66's zip test is read as one. Otherwise it is
   a CSV candidate when it holds no NUL byte and its first line holds a comma, a
   semicolon or a tab; anything else is refused with one plain message that only
   an `.xlsx` workbook or a comma-separated CSV is read (this replaces lg-66's
   "only an `.xlsx`" wording; a zip that is not a workbook still gets it). A file
   named `.csv` that is a workbook is read as one, and a CSV named `.xlsx` as a
   CSV. **The shapes that are not read** (Decision 3 (a)) are found in a
   candidate after the byte bound and before anything is sent, by whole-field
   patterns the builder states in the Log with the tests: a semicolon or tab
   where a comma delimits; a decimal comma; a thousands separator; a date that
   is not `yyyy-mm-dd`; bytes that are not valid UTF-8. Each is refused with a
   typed error whose message names the shape.
3. **A CSV is one sheet**, named `statement.csv` (Decision 5 (a)). lg-66 Build
   3.3's bounds apply except the inflated size, which a CSV has none of: the
   upload's bytes, the rows and cells read, the length of a cell's text sent
   (cut, not refused) and the request's size estimate. The builder says in the
   Log whether the sheets bound is moot. The Log records the 7 new
   `layoutRequest` pins (the CSV fixtures' text under the fixed name).
4. **The describe request for a CSV** is lg-66 Build 3.1, then these refusals,
   each typed, before the dry run is shown, with the fake uncalled again:
   - the description names a part a CSV cannot have: a bucket mapping, a bucket
     or person column, a carry-over label, summary rows, periods, salaries, or
     `yearPerSheet` (eight cases; 0 of the 150 answers had the first seven, 1 of
     the 150 had the eighth);
   - the reading has a problem, which includes the missing balance column
     (Decision 1 (a), the reader's own problem shown in plain words);
   - the placement of Build 5 would refuse the rows (the dry run runs the same
     check against the books, writing nothing).
5. **The confirm request for a CSV** is lg-66 Build 3.2: it re-reads the file
   and the description, runs every verification, and stores the rows only when all
   hold, with no model call. Storing, in one `IMMEDIATE` transaction with the
   stored tail read inside it (Decision 2 (a)):
   - an empty history: the rows are the anchor;
   - otherwise the oldest row's balance minus its amount equals the stored
     tail's balance, else the typed refusal names the tail's date and balance and
     says the file overlaps or leaves a gap (the paste's two messages are the
     model);
   - rows are inserted oldest first with `seq` after the highest stored one,
     `category` empty, `description` the detail, in a `statement_imports` row of
     source `paste`, imported by the caller; the note column, when the description
     names one, goes to `statement_rows.note`;
   - then `classifyAdded` in the same transaction (Decision 7 (a)), and the
     response reports rows added, `rowsInInbox`, and the tail balance.
     The builder says in the Log how the insert is shared with `importStatement`
     rather than copied.
6. **The screen** is lg-66 Build 4 with the differences below.
   1. The upload accepts a CSV, and Build 4.1's statement names what leaves the
      house for a CSV: the one sheet's first 12 rows, 6 from the middle and last
      3, with their figures; the file's name is not sent.
   2. Build 4.2 shows the date column element and the dry run's report, and no
      bucket section. The report adds, from the placement check, either "first
      import: no history is stored" or "continues from the stored balance of
      <amount> on <date>".
   3. Confirm and Cancel as lg-66. When a verification or the placement fails the
      screen shows the reason and has no confirm control. `e2e/layout.spec.ts`
      gets the CSV state of the screen at 360 px and 1280 px.
7. **No test calls a model.** The tests use lg-66's fake. The one live check is
   the owner's (Done when 12).

## Done when

1. Decision 2 of lg-66 is served: the describe request and the confirm request,
   given as the upload (i) `csv-balance`'s text, (ii) a CSV whose first header
   is `PK ID`, (iii) a zip that is not a workbook (one text entry), (iv) a text
   file whose first line holds no comma, semicolon or tab, return: for (i) and
   (ii), read as CSVs, the fake called once on the describe request and zero times
   on the confirm request; for (iii) and (iv) the one typed error with the plain
   message of Build 2, the fake and the sheet reader uncalled, the books
   unchanged. An `.xlsx` renamed `.csv` is read as a workbook, and a CSV renamed
   `.xlsx` as a CSV. One test each.
2. `npm test -- --project ledger` passes with lg-66's 13 `layoutRequest` pins and
   its schema pin unchanged, and with the seven CSV fixtures built from the
   moved reader (Build 1); `api/test/layout/csv.ts` is gone and `grep -rn
"layout/csv" tools/ledger/api` finds nothing.
3. The six unread shapes are refused: for each of the 7 CSV fixtures, the file
   re-serialised with a semicolon delimiter, with quoted decimal commas, with a
   semicolon and decimal commas, with quoted thousands commas, with dd/mm/yyyy
   dates, and re-encoded as Latin-1 (42 files), gets the typed error of Build 2,
   naming its shape, on the describe request and on the confirm request, with the
   fake uncalled and the books unchanged. The 7 files as written are not refused
   for their shape.
4. `007` in a CSV's detail column reads as the detail `"007"`, `42` as `"42"`,
   and `0.50` in an amount column as the number 0.5. `books/test/workbook.test.ts`
   and `api/test/workbook-import.test.ts` pass with no case edited, and the Log
   gives the count of rows read with an empty detail for each of the 13 fixtures
   before and after (0 of 13 before).
5. `csv-no-balance` read through its correct description is refused on the
   describe request with the missing-balance reason in plain words, and a
   confirm request is refused; the fake is called once on the first and the books
   are unchanged on both.
6. With the fake answering each correct description in turn, the describe
   request on `csv-balance`, `empty-columns-csv`, `bank-preamble`,
   `bank-two-dates`, `bank-footer` and `bank-wide` (six) returns the
   description, the date column's letter, header text and 3 + 3 dates with each
   row's detail and amount, and a report, and the row count of each table the
   household's books database lists in `sqlite_master` is the same before and
   after. A description naming each of the eight parts of Build
   4's first bullet is refused with the fake called once (eight tests).
7. Placement, in `api/test/` against a real in-memory database: (i) a CSV into an
   empty history stores its rows with `seq` from 0 and the file's balances;
   (ii) a CSV whose oldest row opens from the stored tail's balance stores after
   the tail; (iii) a CSV that overlaps one stored row is refused, and (iv) one
   that leaves a gap is refused, each naming the tail's date and balance with the
   rows unchanged; (v) `bank-wide`, listed newest first, is stored oldest first;
   (vi) two confirm requests on the same file, one after the other, store the
   rows once and refuse the second as (iii) does. One test each.
8. Rules: with a rule keyed on one description of `csv-balance`, the confirm
   request files that row, leaves the others in the inbox, and reports
   `rowsInInbox` equal to the number of rows not filed. A test that makes the
   classification throw finds no statement row stored, since both run in the one
   transaction.
9. The request for each of the 7 CSV fixtures carries `statement.csv` and nothing
   of the uploaded file's name: a test uploads each under a name holding a
   distinctive token and finds the token in neither the request the fake was given
   nor any line the logger received. The seven new pins are in the Log, and the
   13 old ones are unedited.
10. The web tests show, for a fake describe response on `csv-balance`: the
    statement of Build 6.1 before the button is pressed, with the fake uncalled
    until it is; the date column's letter, header text and 3 + 3 dates with
    detail and amount; no bucket section; the report line of Build 6.2; the
    confirm control present when the verifications and the placement hold and
    absent when either fails. `e2e/layout.spec.ts` has the CSV state at 360 px
    and 1280 px.
11. On `bank-two-dates` with the model's wrong description (the date read from
    column B, pinned in `layout.test.ts`), the confirmation shows the header
    `Date of transaction` and dates that differ from the correct description's in
    3 of the 6 positions, and a test pins it.
12. **Awaiting, the owner's, after the merge:** one live read of a synthetic CSV
    through the web screen with the owner's key returns a description that
    confirms and stores its rows, and the Log records the request's input tokens
    and cost against the measured mean of about a tenth of a cent. With the
    fixed sheet name (Decision 5 (a)), the 70 Haiku shown runs on the 7 CSV
    fixtures are repeated with it, and the Log gives the table beside lg-56's
    (about $0.053). A builder has no key.
13. `npm run check` and `node scripts/check-lockfile-sync.mjs` exit 0, and
    `packages/core/test/image-closure.test.ts` passes.

## Notes for the builder

- **Builders have no Anthropic key.** Done when 12 is the owner's.
- **Real bank data never enters the repository**, including what a test or a
  fixture is modelled on (lg-38). Use the 7 synthetic CSV fixtures; add one only
  to test a repeated (date, amount) pair or a same-day pair, and name it in the
  Log.
- **What the confirmation does not guard.** A date column wrong in a way the 3 + 3
  sample does not show; a detail and a note swapped (lg-66's Notes list it as
  let through). Only the date column is on screen for a CSV (Decision 4).
- **A footer total under the amount column** is reported by the reader as `an
amount with no date` whatever a model says, so such a file will not import
  (lg-56). `bank-footer` keeps it in the balance column.
- **Stored from a CSV, then pasted over.** Decision 2 (a) leaves a later AccèsD
  paste that overlaps CSV-stored rows meeting the category conflict. File it when
  it is hit.
- **Depends on lg-66's Build 2.2** (reading no rows is a problem): without it a
  semicolon file reads 0 rows and 0 problems (Decision 3).
- A new `scripts/*.mjs` needs an `include` line in `scripts/test/tsconfig.json`.

## Log

### 2026-10-24 — filed, on the owner's "Split: file lg-67 for CSVs"

Filed from lg-66's Decision 2 and its Log entry of this date ("the owner's
answers to the three open decisions"), both read at `834006f0` (PR #623, stacked
on PR #621; neither is merged, so this branch is cut from lg-66's branch and its
`depends_on: [lg-66]` resolves).

**The owner's answers, 2026-10-24, as the dispatch gave them.** On lg-66's
Decision 2, "Which files", the options were (a) `.xlsx` only, recommended, and
(b) bank CSVs too. The owner chose (b), overriding the recommendation. The
follow-up asked "How should 'bank CSVs too' be carried out?", with three options:
"Split: file lg-67 for CSVs" (recommended), "Fold into lg-66", "Re-pick Decision
2". The owner chose "Split". Nothing on this page is an owner's answer beyond
those two; the seven Decisions are open and `status` is `needs-decision`.

**Measured offline for the Decisions.** All of it reads the repository at
`834006f0` and the lg-56 records (`~/ledger-layout-lg56-shown/claude-haiku-5-5/`,
`-masked/claude-haiku-5-5/`, `-shown/claude-sonnet-5-5/`), read-only; no model
was called, and the scripts were written to the session scratch directory and are
not committed, so each is described by what it does.

- **The CSV fixtures' shapes.** Each of the 7 read through its correct
  description (`readWorkbook` over `layoutFixtures()`): unfiled rows 40, 32, 32,
  32, 32, 32, 32 (`csv-balance`, `csv-no-balance`, `empty-columns-csv`,
  `bank-preamble`, `bank-two-dates`, `bank-footer`, `bank-wide`); a balance column
  in 6 of 7 (not `csv-no-balance`); newest first in 2 of 7 (`csv-no-balance`,
  `bank-wide`); **0 repeated (date, amount) pairs and 0 repeated (date, detail,
  amount) in 7 of 7**, and as many distinct dates as rows.
- **The records.** 150 on the 7 CSV fixtures. Answers naming a balance column: 10
  of 10 in each of the six balance fixtures in both Haiku sets (120 of 120), and
  0 of 20 on `csv-no-balance`; `problems` was 1 in all 20 of those. Parts a CSV
  cannot have, counted over the 150: buckets 0, bucket column 0, person column 0,
  carry-over label 0, summary 0, periods 0, salaries 0, non-empty `ignored` 0,
  `yearPerSheet` true 1. Sheet selection by Haiku shown on the 7: `name` 69,
  `prefix` 1 of 70; their `costUsd` sum to $0.0532 ($0.000759 a run).
- **Other shapes** (Decision 3). The 7 fixtures re-serialised 5 ways and read
  through their correct descriptions; counts are movements, unfiled, skipped,
  problems for `csv-balance` (40 rows): semicolon with dot decimals 0, 0, 0, 0;
  quoted decimal commas 0, 0, 0, 40; semicolon with decimal commas 0, 0, 0, 0;
  quoted thousands commas 0, 0, 0, 40; dd/mm/yyyy 0, 0, 0, 40. Over the 7 files:
  both semicolon variants read 0 rows with 0 problems in 14 of 14; every other
  variant reported at least one problem in 21 of 21, and for `csv-no-balance`
  the thousands variant read 24 of 32 rows and reported 9 problems (the missing
  balance among them; the other 8 were not itemised). Days: every fixture has a date with a day
  above 12; the dates with a day of 12 or less are 20 of 40 (`csv-balance`) and
  16 of 32 in the other six.
- **Overlap** (Decision 2). `importStatement` on an in-memory database, 8
  invented rows stored, then a paste of rows 5 to 9:

  ```
  first paste, rows 0-7: stored 8, already present 0
  overlap, identical rows 5-9: stored 2, already present 3
  first paste, rows 0-7 (second database): stored 8, already present 0
  overlap, row 6's category differs only: STATEMENT_ROW_CONFLICT fields=["category"]
  ```

- **The digits-only detail** (Decision 6). `csvSheet("a.csv", "Date,Detail,Amount,Balance\n2024-01-01,007,-5.00,95.00\n2024-01-02,Cheque 0042,-1.00,94.00\n")`
  read through a four-column layout (date A, detail B, amount C, balance D):

  ```
  [{"value":{"kind":"date","date":"2024-01-01"},"formula":null},{"value":{"kind":"number","number":7},"formula":null},...]
  ["","Cheque 0042"] []
  ```

  The details are `""` and `"Cheque 0042"` and `problems` is `[]`. The 13 fixtures
  read 0 rows with an empty detail each (lg7 0 of 17, lg37 0 of 233, moved 0 of 130,
  english 0 of 115, csv-balance 0 of 40, csv-no-balance 0 of 32, swapped-labels 0
  of 75, empty-columns-carry 0 of 95, and 0 of 32 for the five other CSVs).

- **The date column as a guard** (Decision 4). `bank-two-dates` read through the
  correct description and through the let-through (date in column B), the 3 oldest
  and 3 newest rows by file order: correct, oldest 2024-01-02, 2024-01-04,
  2024-01-08 and newest 2024-04-20, 2024-04-24, 2024-04-28; let-through, oldest
  2024-01-02, 2024-01-03, 2024-01-04 and newest 2024-04-19, 2024-04-24,
  2024-04-28. Different in 3 of 6 positions; 2 rows out of order under the
  let-through against 0.

**What the brief's pages leave open for the build, and where lg-66 should be
read with care** (lg-66 is not edited here):

- lg-66 Build 3.6 says no log line holds a file name, and Build 4.1 says the
  sheets' names are sent. For a CSV the sheet's name would be the file's name,
  and the answers select the sheet by it (69 of 70): Decision 5.
- lg-66 Done when 13 and Build 3.1 say the message is that "only an .xlsx is
  read". This ticket's Build 2 changes the wording to name the CSV as well; the
  amendment is made by this build, not before.
- lg-66's Build 2.2 is what turns a semicolon file's silent 0 rows into a problem
  (Decision 3); lg-67 relies on it.

**Fold-in exception.** Nothing was folded in. The digits-only detail is a
reproduced defect in code `@ledger/books` shares with the household's own
importer, so whether it is fixed here or filed is a decision (6), not a free
piece of work. lg-66 has no row in `02-ROADMAP.md`, so none is added for this
ticket.
