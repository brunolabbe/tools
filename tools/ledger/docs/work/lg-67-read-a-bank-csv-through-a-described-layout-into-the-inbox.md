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

**The build edits no fixture's text** (Build 1, on the owner's answer at the
landing, Log): the 7 CSV fixtures stay as lg-56 measured them, so the 150 records
still describe them and lg-66's 13 `layoutRequest` pins stand. A file not in
UTF-8 is tested with `csv-balance` re-encoded and one synthetic file (Done when
3).

**Two defects found while writing this**, both reproduced at lg-66's base
(`834006f0`), the first also on `main` (`7a2a0f61`):

- **A number in a detail cell reads as an empty detail**, because `textOf` in
  `books/src/workbook.ts` reads only text cells. This is live on `main`, on the
  `.xlsx` path of the household's `import:ledger`: a workbook whose detail cell
  is the number 42 imports with exit 0, the same report as the text control, and
  stores `description` `""` (Log, round 1). Per the owner (Log, round 1) it is
  filed as lg-68 and built on its own pull request from `main`, branch
  `lg-68-numeric-detail-cell`, which adds `detailOf` to the books reader
  (`books/src/workbook.ts`) and leaves `textOf` as it is; lg-68's final scope is
  not claimed here. It is not this ticket's, and this ticket depends on it **in
  prose only** (lg-68 is not on this branch's base, so there is no
  `depends_on`; `lg-68` goes into `depends_on` once it is on `main`): the CSV
  path of this ticket must not be built before lg-68 has landed.
- **`api/test/layout/csv.ts` reads a field of plain digits as a number**, so
  `007` becomes the number 7 and its leading zeros are gone before any detail
  role reads it. Nothing at the base calls that reader outside the test
  harness. This half is Decision 6.

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

Under (b), (c) or (d), Build 4's second bullet and Done when 6 are rewritten,
and (b) adds a field to the confirmation (Decision 4).

### 2. How its rows are placed against rows already stored

A paste is placed by `statements.ts`: the first paste into an empty database is
the anchor; a later paste must overlap the stored tail exactly, row by row
field for field, or continue from it; and "a pasted row that disagrees with a
stored one is refused with both named, not reconciled". The workbook's rows are
compared day by day, amounts only (lg-40). A CSV is a third source, with
another bank's wording and **no category**: `statement_rows.category` is
`NOT NULL`, and the paste parser itself refuses an empty one
(`books/src/statement.ts`, "an empty category").

Measured offline (Log), 8 invented rows stored and then a paste of rows 5 to 9
(`importStatement`, in memory):

- Rows stored in AccèsD's own wording, an identical overlapping paste: 2 stored,
  3 already present. With row 6's category changed and nothing else:
  `STATEMENT_ROW_CONFLICT`, fields `["category"]`.
- **Rows stored in another bank's wording**, which is a CSV's case, then an
  AccèsD paste of rows 5 to 9 in its own wording with the same dates, amounts
  and balances: `STATEMENT_CHAIN_BROKEN`, "A row is missing between the two, so
  paste a longer stretch that overlaps what is stored". `candidates` in
  `statements.ts` matches on date, description, amount and balance, so no stored
  row is found, and **no longer paste can satisfy that advice**. A paste of rows
  8 and 9 only, starting after the stored tail: 2 stored.

- **(a) Recommended: after the stored tail, or into an empty history; never
  overlapping.** The first CSV into an empty history is the anchor. Otherwise
  its oldest row must open from the stored tail's balance (the paste's `k = 0`
  case), and a CSV that overlaps rows already stored is refused with the tail
  named (its date and balance), nothing stored. Rows are stored with source
  `paste` (no migration), oldest lowest, in one `IMMEDIATE` transaction with
  the tail read inside it. Costs: a person whose export overlaps what is stored
  must cut the file first; the refusal says where. **And the other direction is
  not solved, and fails with advice that cannot be followed**: rows stored from a
  CSV are stored as pastes and compared as pastes, so a later AccèsD paste that
  overlaps them is refused `STATEMENT_CHAIN_BROKEN` as measured above, telling
  the person to paste a longer stretch. The way out the measurement found is to
  paste only the rows after the stored tail. That is a cost this ticket leaves
  to a later one, and the Notes record it. An empty category on a stored row is
  also new (no paste can store one); what the spending-category map and the
  history make of it is unmeasured.
- **(b) Overlap allowed, compared as a paste compares.** Costs: it cannot work
  as measured: a CSV row has another bank's wording and no category, and
  `candidates` matches on date, description, amount and balance, so an
  overlapping row is never found (the second measurement above, from the CSV's
  side). It would need `statements.ts`'s comparison changed for CSV rows (a rule
  shared with every paste, tuned by lg-2, lg-40, lg-58, lg-59 and lg-61), or a
  wording and a category invented for the row.
- **(c) Overlap allowed, compared as the workbook's rows are** (day by day,
  amounts counted with repeats, dates a day off). Costs: new code in the most
  tuned module of the tool, ambiguity refusals to design for a source with no
  real example, and the 7 fixtures have 0 repeated (date, amount) pairs to test
  it with (a test would add one).
- **(d) Always stored as a new batch, never compared.** Costs: a CSV that
  overlaps stored rows double-books them; with a balance column the chain
  would break at the seam and nothing would say so. Not recommended.
- **(e) (a), plus a `source` value for CSV rows that a later paste compares day
  by day, as it compares the workbook's.** It addresses the later-paste
  direction. Costs: a table rebuild
  (`statement_imports.source` is a `CHECK`, which SQLite cannot alter in place),
  and the matcher of `workbook-days.ts` and `statements.ts` taught a third
  source, in the code lg-40, lg-59 and lg-61 tuned, for a case (a CSV, then a
  paste over it) not yet seen and with no real example to tune on.
- **(f) (a), with CSV rows stored under the existing `workbook` source.** It
  addresses the later-paste direction with no migration. Measured by gate 2
  (offline, its report on the pull request thread): rows stored in another
  bank's wording with their import's `source` set to the existing `'workbook'`,
  then an AccèsD paste of rows 5 to 9, gives `stored 2, already present 3`, and a
  companion paste with one amount 1.00 $ off is still refused. **Its costs are
  unmeasured:** the refusal wording says "rows imported from the workbook", so a
  person told that of CSV rows is told something untrue; nobody has checked how
  code that reads `source = 'workbook'` treats CSV rows; and the rows'
  categories are empty (as under (a)).

**Why (a) is still first.** The later-paste cost is shared by (a), (b), (c) and
(d), and (e) and (f) remove it, (e) at the price above and (f) at the unmeasured
costs above. What changed with the measurement is what (a) is said to cost: not
"a conflict the person can read" but a refusal whose own advice cannot be
followed, with a way out (paste only the rows after the tail). If the owner
expects households to paste AccèsD rows over CSV rows, (e) or (f) is the option
to take.

Under (b), (c), (d) or (e), Build 4's third bullet, Build 5, Build 6.2's report
line and Done when 8 are rewritten; (b), (c) and (e) also change
`statements.ts`. Under (f), only Build 5's third bullet changes: the source it
names is `workbook`, not `paste`.

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
a tab-delimited file and a file that is not UTF-8 (a sixth and a seventh shape,
not among the 35; and 6 of the 7 fixtures hold no non-ASCII character, so a
re-encoding of them is the same bytes, which is why Done when 3 re-encodes only
`csv-balance` and one synthetic file).

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

Under (b) or (c), Build 2 and Done when 3 are rewritten.

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

Under (b), Build 6.2 and Done when 11 gain the totals.

### 5. What the CSV's sheet is called in what is sent

A CSV has no sheet name of its own, so the reader names its one sheet. The
fixtures name it as a bank file would (`releve-2024.csv`), the view prints it
(`## Sheet "releve-2024.csv": …`), and the description selects the sheet by it:
**69 of the 70 Haiku shown answers on the 7 fixtures select the sheet by
name** (`names`), the 70th by `prefix`.

- **(a) Recommended: a fixed name, `statement.csv`.** Nothing about the uploaded
  file's name goes to Anthropic or into a log. Costs: the request for a CSV then
  differs from the measured one by that string, so the seven CSV fixtures get
  seven new `layoutRequest` pins beside lg-66's seven, which stand, and the
  effect of the new name on what Haiku answers is unmeasured. Re-measuring the
  70 Haiku shown runs on the 7 fixtures would cost about $0.053 (the 70 old
  records' `costUsd` sum to $0.0532), with the owner's key; Done when 13 is that,
  awaiting.
- **(b) The uploaded file's name, cut and cleaned.** Costs: whatever the bank
  or the person put in the name leaves the house, so lg-66 Build 4.1's statement
  must name it; it reaches the request, so it needs the same cleaning as a cell's
  text; and no log line may hold it (lg-66 Build 3.6). The request is the
  measured kind, so lg-66's pins stand.

Under (b), Build 3, Build 6.1 and Done when 10 are rewritten, and Done when 13's
clause "under Decision 5 (a), with the fixed sheet name" goes, and with it the
repeat of the 70 runs, since the request is then the measured one (the live read
stays).

### 6. What the CSV reader does with a field of digits that starts with a zero

Only the CSV half of the digits-only detail defect is open here; the `.xlsx`
half, lg-68's `detailOf` in the books reader, is lg-68's (Why, above). Reproduced (Log, round 1): the CSV reader turns a
field of plain digits into a number cell, so `007` becomes the number 7 and its
leading zeros are gone before the books read it. Nothing at the base calls that
reader outside the test harness, and the 13 fixtures read 0 rows with an empty
detail. The reader's number rule is `^-?\d+(\.\d+)?$`, so `0.50` and `-0.5` are
numbers and `007` and `-007` match it too.

- **(a) Recommended: a field that starts with a zero followed by a digit stays
  text** (`007` stays `007`; `0.50` is still a number). Costs: an amount written
  with a leading zero (`007.50`) would be text and the reading would report a
  problem rather than a figure, which is a refusal and not a misreading; the
  model's view prints such a field quoted where it printed it bare, for any field
  of that shape (whether any measured fixture holds one is settled by the 13
  pins of Done when 2, which must pass unchanged); and a detail of plain digits
  with no leading zero (`42`) still becomes a number cell, which reads as the
  detail `"42"` only once lg-68's `detailOf` in the books reader has landed, so
  this ticket's CSV path waits for lg-68.
- **(b) Leave the reader as it is.** Costs: with lg-68 landed, `007` is stored as
  `"7"`: the detail differs from the file's, silently.
- **(c) The reader keeps every field as text and the layout says which are
  figures.** Costs: the model's view changes for every figure of every CSV
  (quoted text instead of bare numbers), so all seven CSV pins move and the 150
  records no longer describe what the model is sent; the reader needs the layout
  before it can read, which it does not have at the describe step.

Under (b) or (c), the change Build 1 makes under this Decision is rewritten and
Done when 5 changes with it.

### 7. Whether the stored rows pass through the rules

A paste's rows are run through `classifyAdded` in the same transaction that
stores them (lg-4, lg-17): a row the most specific matching rules agree on is
filed, a row whose description three person-given answers agree on is filed
from history, and every other row waits in the inbox. lg-66's Decision 2 (b),
the option the owner chose, reads "stored the way a statement paste stores them
(they wait in the inbox, unfiled)": that is lg-66's text, not words the owner
wrote.

- **(a) Recommended: as a paste does.** The same call, in the same transaction;
  `rowsInInbox` is the rows nothing filed. Costs: a rule or a history answer
  keyed on a description files a CSV row whose bank wording happens to equal it,
  which is the paste's own behaviour, and whether two banks' identical wording
  can mean different things is unmeasured.
- **(b) None filed: every CSV row waits in the inbox.** Costs: the person files
  each row by hand, including those their own rules would have filed; it is the
  literal reading of "unfiled", and a store path without `classifyAdded`.

Under (b), Build 5 drops its classification bullet and Done when 9 is rewritten.

## Build

Written for the recommended option of each Decision above: no-balance CSVs
refused (1 a), placement after the tail or into an empty history (2 a), the
unread shapes refused plainly (3 a), the date column alone (4 a), a fixed sheet
name (5 a), a leading-zero field kept as text (6 a), and the rules run as for a
paste (7 a). **It is not built before lg-68 has landed** (Why): the build merges
`main` in first and checks that a number cell in a detail column reads as its
digits. It reuses lg-66's flow and does not restate it: "lg-66 Build 3.1"
is that ticket's describe request, "Build 3.2" its confirm request, "Build 3.3"
its bounds, "Build 4" its confirmation screen. Everything not named here is as
lg-66 builds it, including the consent field, the single model call, nothing
stored between the two requests, the error taxonomy, and the rule that no log
line holds the upload's content, its name or the key. **This build amends
lg-66's Done when 13**, which refuses a CSV "until lg-67": Done when 1 below
replaces that line's three CSV cases (i) to (iii), its sentence "That holds
until lg-67", and the second half of its last sentence ("a CSV renamed `.xlsx`
is still refused"). Its 0-sheet clause, and "an `.xlsx` that is renamed `.csv`
is still read", stand. lg-66's Build 3.1 sentence "A CSV is refused this way
until lg-67" goes with them.

1. **Move the CSV reader from `api/test/layout/csv.ts` into `api/src`**, taking
   bytes as well as text: a leading byte-order mark is dropped, and the bytes
   are decoded as UTF-8 only when they are valid UTF-8 (Build 2 says what
   happens otherwise). The fixtures and the harness import it back, so there is
   one copy. The quoted-field rule, the number rule and the date rule are the
   ones measured; one change is made (Decision 6 (a)): a field that starts with
   a zero followed by a digit stays text. **No fixture's text is edited** (the
   owner's choice at the landing, Log): the 7 CSV fixtures in
   `api/test/layout/fixtures.ts` stay as lg-56 measured them, and the 13
   `layoutRequest` pins of lg-66 and its schema pin pass unchanged (Done when 2).
   Only `csv-balance` holds a character from U+0080 to U+00FF today (`é` and `ô`;
   the other six hold none, the gate's `latin1.mts`), which is why Done when 3
   re-encodes `csv-balance` as Latin-1 and adds one synthetic non-UTF-8 file.
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
   `layoutRequest` pins (the CSV fixtures' text under the fixed name), beside
   lg-66's 7 for the same fixtures, which stand.
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
   1. The upload accepts a CSV, and lg-66 Build 4.1's statement names what leaves the
      house for a CSV: the one sheet's first 12 rows, 6 from the middle and last
      3, with their figures; the file's name is not sent.
   2. lg-66 Build 4.2 shows the date column element and the dry run's report, and no
      bucket section. The report adds, from the placement check, either "first
      import: no history is stored" or "continues from the stored balance of
      <amount> on <date>".
   3. Confirm and Cancel as lg-66. When a verification or the placement fails the
      screen shows the reason and has no confirm control. `e2e/layout.spec.ts`
      gets the CSV state of the screen at 360 px and 1280 px.
7. **No test calls a model.** The tests use lg-66's fake. The one live check is
   the owner's (Done when 13).

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
2. `npm test -- --project ledger` passes, with the seven CSV fixtures built from
   the moved reader (Build 1). A test fails when the sha256 of `layoutRequest`
   for any one of lg-66's 13 fixtures (the 6 workbooks and the 7 CSVs, text
   unedited) differs from lg-66's value, or the format schema's differs from
   lg-66's. `api/test/layout/csv.ts` is gone, and a recursive grep for
   `layout/csv` under `tools/ledger/api` finds nothing.
3. Seven unread shapes are refused, in 44 files. For each of the 7 CSV fixtures,
   the file re-serialised six ways (with a semicolon delimiter, with quoted
   decimal commas, with a semicolon and decimal commas, with quoted thousands
   commas, with dd/mm/yyyy dates, and with a tab delimiter: 42 files), and, as
   the seventh shape, `csv-balance` re-encoded as Latin-1 (1 file) and one
   synthetic non-UTF-8 file (1 file, invented text the builder writes and names
   in the Log), get the typed error of Build 2, naming their shape, on the
   describe request and on the confirm request, with the fake uncalled and the
   books unchanged. For each of the 2 non-UTF-8 files a test first asserts that
   its bytes differ from its UTF-8 bytes and that decoding them as UTF-8 with
   `fatal` set throws, before its refusal is asserted, so neither is a vacuous
   case. The 6 other fixtures hold no non-ASCII character, so no re-encoding is
   asserted for them. The 7 files as written are not refused for their shape.
4. Each of the 7 CSV fixtures as written, with a UTF-8 byte-order mark in front,
   reads as the same sheet as without it (deep-equal) and gives the same
   `layoutRequest` sha256.
5. `007` in a CSV's detail column reads as the detail `"007"`, `0.50` in an
   amount column as the number 0.5, `007.50` in an amount column as a reading
   problem, and, on a base that carries lg-68, `42` in a detail column as `"42"`.
   `books/test/workbook.test.ts` and `api/test/workbook-import.test.ts` pass with
   no case edited, and the Log gives, for each of the 13 fixtures, the count of
   rows read with an empty detail after Build 1's change (0 of 13 at the base).
6. `csv-no-balance` read through its correct description is refused on the
   describe request with the missing-balance reason in plain words, and a
   confirm request is refused; the fake is called once on the first and the books
   are unchanged on both.
7. With the fake answering each correct description in turn, the describe
   request on `csv-balance`, `empty-columns-csv`, `bank-preamble`,
   `bank-two-dates`, `bank-footer` and `bank-wide` (six) returns the
   description, the date column's letter, header text and 3 + 3 dates with each
   row's detail and amount, and a report, and the books database is unchanged:
   `dump` in `api/test/workbook-import.test.ts` (every row of every table that
   `sqlite_master` lists as a table) is deep-equal before and after. A
   description naming each of the eight parts of Build 4's first bullet is
   refused with the fake called once (eight tests).
8. Placement, in `api/test/` against a real in-memory database: (i) a CSV into an
   empty history stores its rows with `seq` from 0 and the file's balances;
   (ii) a CSV whose oldest row opens from the stored tail's balance stores after
   the tail; (iii) a CSV that overlaps one stored row is refused, and (iv) one
   that leaves a gap is refused, each naming the tail's date and balance with the
   rows unchanged; (v) `bank-wide`, listed newest first, is stored oldest first;
   (vi) two confirm requests on the same file, one after the other, store the
   rows once and refuse the second as (iii) does. One test each.
9. Rules: `csv-balance` has 7 distinct details over its 40 rows, each repeated.
   With a rule keyed on one of those details, the confirm request files exactly
   the rows that carry it (the number the test counts from the fixture), leaves
   the other rows in the inbox, and reports `rowsInInbox` equal to 40 less that
   number. A test that makes the classification throw finds no statement row
   stored, since both run in the one transaction.
10. The request for each of the 7 CSV fixtures carries `statement.csv` and nothing
    of the uploaded file's name: a test uploads each under a name holding a
    distinctive token and finds the token in neither the request the fake was
    given nor any line the logger received. The seven new pins are in the Log,
    and the 13 pins of Done when 2 are unedited by this line's change.
11. The web tests show, for a fake describe response on `csv-balance`: the
    statement of Build 6.1 before the button is pressed, with the fake uncalled
    until it is; the date column's letter, header text and 3 + 3 dates with
    detail and amount; no bucket section; the report line of Build 6.2; the
    confirm control present when the verifications and the placement hold and
    absent when either fails. `e2e/layout.spec.ts` has the CSV state at 360 px
    and 1280 px.
12. On `bank-two-dates` with the model's wrong description (the date read from
    column B, pinned in `layout.test.ts`), the confirmation shows the header
    `Date of transaction` and dates that differ from the correct description's in
    3 of the 6 positions, and a test pins it.
13. **Awaiting, the owner's, after the merge:** one live read of a synthetic CSV
    through the web screen with the owner's key returns a description that
    confirms and stores its rows, and the Log records the request's input tokens
    and cost against the measured mean of about a tenth of a cent. The 70 Haiku
    shown runs on the 7 CSV fixtures, under Decision 5 (a), with the fixed sheet
    name, are repeated, and the Log gives the table beside lg-56's (about $0.053
    for the 70 old runs). A builder has no key.
14. `npm run check` and `node scripts/check-lockfile-sync.mjs` exit 0, and
    `packages/core/test/image-closure.test.ts` passes.

## Notes for the builder

- **Builders have no Anthropic key.** Done when 13 is the owner's.
- **Not before lg-68** (Why): the CSV path reads a plain-digits detail as a
  number cell, which only reads as its digits once lg-68's `detailOf` in the books
  reader is on the base. Merge `main` in first and check it.
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
  paste that overlaps CSV-stored rows refused `STATEMENT_CHAIN_BROKEN`, whose
  advice to paste a longer stretch cannot be followed; pasting only the rows after
  the stored tail works (Decision 2, measured). File it when it is hit.
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

### 2026-10-24 — round 1: gate 1 returned FAIL at `0b772573`; the owner's answers

Gate 1 (on PR #625, `834006f0..0b772573`) returned FAIL: 3 high, 2 med, 4 low
(F1 to F9). Its record is this ticket's `## Review`, which the lander commits.
[Corrected at landing: a filing pull request has no `## Review`; the record is on
the pull request thread, see the landing entry.] The
brief is changed above `## Log` only; no source and no fixture is touched, both
`status:` lines are as they were, and no Decision is answered.

**The owner's answers, 2026-10-24**, three questions from the orchestrator:

1. **F1, "how is the live number-cell defect handled?"** Options: "File lg-68 and
   build it now", "File lg-68 only" (the gate's recommendation), "Fold into
   lg-66". **The owner chose "File lg-68 and build it now."** lg-68 is filed and
   built in a separate pull request from `main`, branch
   `lg-68-numeric-detail-cell`, and fixes `textOf` for the `.xlsx` path
   [corrected at landing: lg-68's branch adds `detailOf` and leaves `textOf`, see
   the landing entry]. In this
   ticket Decision 6 shrinks to the CSV leading-zero half, the `textOf` fix is
   lg-68's, and lg-67 depends on it in prose only (no `depends_on`, because lg-68
   is not on this branch's base).
2. **F2, "which fix for Done when 3's Latin-1 case?"** Options: "csv-balance + a
   synthetic" (the gate's recommendation) and "Non-ASCII in every fixture".
   **The owner chose "Non-ASCII in every fixture", overriding the gate's
   recommendation.** As put to the owner, the cost was: "Add accented text to all
   7 CSV fixtures. That moves lg-66's 13 request pins and the measured fixtures'
   text." Build 1 and Done when 3 are written for it. One correction to that
   cost line, from the code: the 6 workbook fixtures' text is untouched, so it is
   **7 of the 13 pins** that move, the CSV fixtures'; Build 1 says so.
3. **The round, "fix all, then gate 2?"** Options: "Fix all, then gate 2" and
   "Highs and meds only". **The owner chose "Fix all, then gate 2."**

**F1 (high): reproduced, and it was right.** The gate's
`xlsx-import-command.mts <tree> <outdir>` (the household's `import:ledger
--write` on the synthetic workbook, once as written and once with 2022's first
row's detail cell written as the number 42), run here at `0b772573`:

```
--- detail cell as text: exit 0
statement_rows 2022-01-05: [{"date":"2022-01-05","description":"Versement","amount_cents":50000}]
--- detail cell as number: exit 0
statement_rows 2022-01-05: [{"date":"2022-01-05","description":"","amount_cents":50000}]
```

Both runs report `imported 17`. Fixed as the owner chose: the Why separates the
two halves, names lg-68, and says this ticket is not built before it lands;
Decision 6 is now only what the CSV reader does with a field of digits that
starts with a zero, with three options priced on that basis; Build 1 loses the
`textOf` change and gains the leading-zero rule; Done when 5 says `42` is graded
"on a base that carries lg-68". The earlier entry of today ("The digits-only
detail", "Fold-in exception") is superseded by this one.

**F2 (high): reproduced, and it was right.** The gate's `latin1.mts <tree>`:

```
csv-balance: text cells 45, non-ASCII chars ["é","ô"] (sheet-name 0); details 40, distinct 7, repeated details 7
csv-no-balance: text cells 35, non-ASCII chars [] ...
(empty-columns-csv, bank-preamble, bank-two-dates, bank-footer, bank-wide: non-ASCII chars [])
```

6 of the 7 fixtures hold no non-ASCII character, so their Latin-1 bytes are their
UTF-8 bytes. Fixed as the owner chose: Build 1 gives each of the 7 a character
from U+0080 to U+00FF, says 7 of lg-66's 13 pins move as a deliberate edit by this
build (lg-66's Done when 1 constrains lg-66's own build), and says the fixtures'
text then differs from what lg-56's 300 runs measured; Done when 3 now asserts,
per file, that the Latin-1 bytes differ from the UTF-8 bytes and that decoding
them as UTF-8 with `fatal` set throws, before it asserts the refusal. Done when 13
repeats the 70 runs on the edited text.

**F3 (high): reproduced, and it was right.** The gate's `overlap-wording.mts
<tree>`, and a variant of mine (`overlap-remedy.mts`: the same, plus a second
paste of rows 8 and 9 only), run here:

```
stored rows 0-7 in another bank's wording: stored 8, already present 0
AccèsD paste, rows 5-9, its own wording: STATEMENT_CHAIN_BROKEN ... "A row is missing between the two, so paste a longer stretch that overlaps what is stored."
stored rows 0-7, other wording: stored 8, already present 0
AccèsD rows 5-9 (overlaps stored rows 5-7): STATEMENT_CHAIN_BROKEN
stored rows 0-7, other wording: stored 8, already present 0
AccèsD rows 8-9 (starts after the stored tail): stored 2, already present 0
```

Decision 2's costs are restated from this: the later-paste cost of (a) is a
refusal whose advice cannot be followed, with the way out of pasting only the rows
after the tail; (b)'s cost is now also the wording, not only the category; and an
option (e) is added, (a) plus a CSV `source` that a later paste compares day by
day, which removes that cost. **The recommendation does not
change**: the cost is shared by (a) to (d), and (e) removes it at the price of a
table rebuild and a third source taught to the most tuned matcher in the tool,
for a case not yet seen; the text says so and says when (e) is the one to take.
The earlier entry's overlap measurement (same wording, category changed) stands
as what it measured.

**F4 (med): fixed.** The pointers now name: Decision 1, Build 4's second bullet
and Done when 6; Decision 2, Build 4's third bullet, Build 5, Build 6.2's report
line and Done when 8; Decision 3, Build 2 and Done when 3; Decision 4, Build 6.2
and Done when 11; Decision 5, Build 3, Build 6.1, Done when 10 and only the
fixed-name clause of Done when 13; Decision 6, Build 1 and Done when 5; Decision
7, Build 5's classification bullet and Done when 9. Done when was renumbered by
the new line (4, the byte-order mark), so every reference was re-read.

**F5 (med): fixed.** Done when 9 (was 8) says `csv-balance` has 7 distinct details
over 40 rows, each repeated (the gate's count, reproduced above), and asserts the
rule files exactly the rows that carry the detail, the number counted from the
fixture, with `rowsInInbox` equal to 40 less that number.

**F6 (low): fixed.** The Build's amendment of lg-66's Done when 13 now replaces
its three CSV cases, its "That holds until lg-67" sentence and the second half of
its last sentence, and says its 0-sheet clause and "an `.xlsx` renamed `.csv` is
still read" stand.

**F7 (low): fixed.** Done when 7 (was 6) asserts `dump` in
`api/test/workbook-import.test.ts` (every row of every table `sqlite_master` lists
as a table) deep-equal before and after, in place of the row counts.

**F8 (low): fixed.** New Done when 4 (a byte-order mark in front of each of the 7
fixtures reads as the same sheet and gives the same `layoutRequest` hash) and a
tab delimiter in Done when 3's shapes, which are now seven and 49 files.

**F9 (low): fixed.** Decision 7 says the quoted words are lg-66's Decision 2 (b)
text, which the owner chose, and not words the owner wrote.

**The phrase checks**, above `## Log`, whitespace-normalised so a phrase that
wraps across lines is still found (the gate found that a wrapped phrase planted
nothing). `phrases.mjs <before> <after>` (session scratch, not committed) counts 13
phrases that must be gone, each present in `0b772573`'s text and absent now, and 16
that must be new, each absent then and present now:

```
all checks held   (13 gone, 16 new; e.g. "gone: before 1, after 0: meets the conflict measured above"; "new: before 0, after 3: STATEMENT_CHAIN_BROKEN")
```

and, as the positive control, the same script given the old text as both
arguments: `29 FAILED`, exit 1.

**Fold-in exception.** Nothing was folded in. lg-68 is the owner's separate
ticket; the leading-zero rule is Decision 6.

### 2026-10-24 — landing: gate 2 returned CONCERNS at `8bcbc2b6`; the owner's answers

Gate 2 (on PR #625, `0b772573..8bcbc2b6`) returned CONCERNS with no high: 1 med
(N1), 3 low (N2 to N4). This pull request only files a ticket, so both gates'
full reports are on the pull request thread (comments on #625) and not in this
ticket; there is no `## Review` here and `review-record.mjs --land` was not run.
The ticket stays `needs-decision`. The brief is changed above `## Log` only (plus
the two in-place corrections marked in round 1's entry); no source and no fixture
is touched. In the checks below, `T` is this file, and each count above `## Log`
is scoped with `awk '/^## Log/{exit} {print}' T`.

**The owner's answers at landing, 2026-10-24**, four questions from the
orchestrator:

1. **F2 re-ask, "keep the non-ASCII-in-every-fixture choice, or switch?"** In
   round 1 the owner chose "Non-ASCII in every fixture" over gate 1's
   recommendation, told that it moves 13 of lg-66's pins; gate 2 measured 7 of 13. The question was re-asked with that number. Options: "Keep my choice" and
   "Switch to the gate's". **The owner chose "Switch to the gate's"**, which is
   gate 1's direction for F2 (OD2): "use csv-balance re-encoded plus one synthetic
   non-UTF-8 file, and assert that each re-encoded file's bytes differ from its
   UTF-8 ones". As put: no fixture text changes and no pin moves. That is the
   gate's recommendation, so the owner took it; the dispatch does not say which
   option the orchestrator marked recommended in the re-ask. Applied: Build 1
   edits no fixture's text; Done when 3 re-encodes only `csv-balance` (it already
   holds `é` and `ô`) as Latin-1 and adds one synthetic non-UTF-8 file, asserts
   for each of those two that its bytes differ from its UTF-8 bytes and that a
   `fatal` UTF-8 decode throws before its refusal is asserted, and keeps the six
   other shapes over all 7 fixtures. **Done when 3 names 44 files**: 6 shapes
   times 7 fixtures is 42, plus `csv-balance` as Latin-1 (1) and the synthetic file
   (1). Done when 2 now holds all 13 of lg-66's pins and its schema pin
   unchanged; Done when 10 and 13, Decision 5 and Decision 6 lost their "7 moved
   pins" and "edited text" lines. The one "pins move" left is Decision 6 (c), a
   different option.
2. **N1, "add option (f) to Decision 2?"** Options: "Add option (f) at landing"
   (gate 2's recommendation) and "Reword only". **The owner chose "Add option
   (f)"**, so the owner took gate 2's recommendation. Applied: Decision 2 (f), "(a),
   with CSV rows stored under the existing `workbook` source", with gate 2's
   measurement and its three unmeasured costs; "the only option" struck from (e)
   and from round 1's entry; "Why (a) is still first" and the rewrite pointers
   name (f). The recommended option, (a), is as it was.
3. **N2 to N4, "fix the three low findings, or leave them recorded?"** Options:
   "Fix all three" and "Leave recorded". **The owner chose "Fix all three."** The
   dispatch does not say which was marked recommended.
4. **lg-67's seven Decisions, "answer them now, or leave them open?"** Options:
   "Leave them open" (the orchestrator's recommendation) and "Answer them now".
   **The owner chose "Leave them open"**, so the owner took the recommendation.
   They are put to the owner when lg-66 is built. None is answered here.

**Gate 2's findings.** N1 (med) and N2 to N4 (low) are fixed below. The
`depends_on` direction in N2 is not applied: lg-68 is not on this base, so a
`depends_on: [lg-66, lg-68]` would dangle and fail `node scripts/status.mjs
--json`. `lg-68` goes into `depends_on` once it is on `main`.

- 2026-10-24 — Fixed at landing by owner choice: gate 2, N1 — "(e) says it 'is
  the only option that addresses the later-paste direction', at the price of a
  table rebuild"; measured, rows stored in another bank's wording under the
  existing `'workbook'` source take an AccèsD paste of rows 5 to 9 as `stored 2,
already present 3`. `awk '/^## Log/{exit} {print}' T | grep -c "the only
option"` → 0; `awk '/^### 2026-10-24 — landing/{exit} {print}' T | grep -c -F
"the only option"` → 0 (the Log, before this entry); `awk '/^## Log/{exit}
{print}' T | grep -c -F "(f) (a), with CSV rows stored under the existing"` → 1.
- 2026-10-24 — Fixed at landing by owner choice: gate 2, N2 — "Why, Decision 6
  (a), Notes and the Log say lg-68 'fixes `textOf` for the `.xlsx` path'";
  lg-68's Build 1 says "leave `textOf` as it is" and its branch adds `detailOf`
  to `readYear` in `books/src/workbook.ts`. The text now says "lg-68's `detailOf`
  in the books reader" and claims no final scope (lg-68 is still being built).
  The Log's two round-1 sentences stand, each marked "corrected at landing".
  `awk '/^## Log/{exit} {print}' T | grep -c "textOf. fix"` → 0; `awk
'/^## Log/{exit} {print}' T | grep -c "fixes .textOf."` → 0; `awk
'/^## Log/{exit} {print}' T | grep -c "detailOf"` → 4.
- 2026-10-24 — Fixed at landing by owner choice: gate 2, N3 — "Build 1 says one
  character in U+0080–U+00FF makes the Latin-1 bytes 'not valid UTF-8'. That does
  not follow in general: the Latin-1 text `Ã©` is the valid UTF-8 for `é`." The
  sentence went with Build 1's rewrite (F2 switch); Done when 3's `fatal`-decode
  assertion, per non-UTF-8 file, is the check and no sentence infers it.
  `awk '/^## Log/{exit} {print}' T | grep -c "and are not valid UTF-8"` → 0.
- 2026-10-24 — Fixed at landing by owner choice: gate 2, N4 — "the round-1 Log
  says gate 1's record 'is this ticket's `## Review`, which the lander commits'.
  For a filing PR the record goes on the PR thread." Round 1's entry now carries
  a "corrected at landing" note, and both gates' full reports are posted on #625.
  `awk '/^### 2026-10-24 — landing/{exit} {print}' T | grep -c -F "a filing pull
request has no"` → 1.

**Cross-references.** Every "Done when N" and "Build N" above `## Log` was re-read
after the edits (no item was added, removed or renumbered): each
reference resolves to the item it names, among them Decision 2's "Build 5's third
bullet" (the rows' source), Decision 3's "Done when 3", and Done when 10's "the 13
pins of Done when 2".
