---
id: lg-66
tool: ledger
title: Import a workbook the reader does not know, through a layout Haiku 5.5 describes and the person confirms
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: hard
---

# lg-66 — Import a workbook the reader does not know, through a layout a model describes

## Why

The importer (lg-7, lg-37) reads one household's workbook, laid out the way
`00-ANALYSIS.md` §8 describes it. Each household P6 brings in arrives with a
file of its own, and a reader hand-coded per file does not scale (lg-38's Why).

lg-38 built the answer's contract (`workbookLayoutSchema` in `@ledger/contract`)
and the reader that takes a description (`readWorkbook`'s `layout` option), and
measured whether a model can fill the description in. **The model proposes a
layout, never rows**; the reader then reads the cells through it and runs the
verifications the importer already has. lg-56 measured again on harder
fixtures. What those two measurements show, and no more:

- **300 runs on 13 invented fixtures** (six workbooks and seven bank CSVs):
  Haiku 5.5 with figures shown 130, with figures masked 130, Sonnet 5.5 shown
  40 (on the four fixtures Haiku shown did not match every run).
- **Haiku 5.5, shown: 120 of 130 runs imported the right thing** (matched or
  the same import). 9 were let through, all on one fixture, `bank-two-dates`:
  the answer filed `Date of transaction` where `Date posted` belongs. The
  verifications (`problems`) refused none of them. The books did notice: read
  through each of those answers the fixture reports 2 rows `outOfOrder`
  against 0 for the correct description. Masked: 1 such run in 130. Sonnet
  shown read the posted date in 10 of 10.
- Both refusals in the 260 Haiku runs were of answers that would have been
  wrong (2 of 2).
- **0 let-through changed an amount, balance or detail** in 300 runs over 13
  fixtures. As an estimate, about 1% at the rule of three if the runs were
  independent (3/300), about 23% counted by fixture (3/13), which lg-56's Log
  calls the closer reading, because the ten runs of a fixture read one
  workbook.
- No model made the two mistakes lg-56 added fixtures to invite: swapped
  bucket labels (0 of 30 runs on `swapped-labels`) and an amount column
  pointing at an empty one (0 of 20 runs on `empty-columns-carry` and 0 of 20
  on `empty-columns-csv`). Those 0s say the models did not make the mistakes on
  these fixtures, not that the reader can stop them.
- Cost: Haiku shown $0.000998 a run (130 runs). On the four fixtures Sonnet
  was run on, Haiku shown cost $0.001089 a run and Sonnet $0.015646, 14.4 times
  as much (15.7 times $0.000998).

Nothing here speaks for a real household's workbook, for the shapes lg-56 lists
as not measured (below), or for a model, effort or prompt other than the ones
measured. The measurement is of Haiku 5.5, effort `medium`, the prompt and the
view in `api/test/layout/view.ts`, and the answer's schema as the structured
output's format.

**The owner decided on 2026-10-24 to build it** (lg-38's Log, "the owner's build
decision"), from these options: Haiku + the date column on the confirmation
screen (chosen); Haiku + the reader's `outOfOrder` list put to the user; Sonnet
5.5; drop. Together with the answers of 2026-10-18 this fixes:

- **Haiku 5.5** (over Sonnet 5.5, and over Haiku with a Sonnet retry on
  refusal).
- **Figures shown** in what is sent (over masked).
- **The person confirms on screen** (over a sign check, and over both), and the
  confirmation shows **the date column the description chose, with a few rows'
  dates**, beside the bucket labels the 2026-10-18 preference covered.

## Decision — answered 2026-10-24 by the owner

Three questions the owner's earlier answers did not settle, answered by the
owner on 2026-10-24 (the Log's entry of that date has each question, its
options and the one chosen). The options stay as they were put, and the answer
is marked under each question. The Build is written for the answers given. Rate
of the work: `hard`, as filed.

### 1. Where the import runs

**Answered: (a), a web flow** (the recommendation).

lg-7's Build made the importer "A command, not a route": "It is a one-off, and
it has no reason to exist on the network." The owner's answers say "confirm on
screen" and "a confirmation screen".

- **(a) Recommended: a web flow.** A screen where a member of the household
  uploads the file, presses a button that sends samples to the model, reads the
  confirmation and confirms. It matches "on screen", and it is the only reading
  under which a P6 household can import its own file, since it cannot run a
  command on the host. Costs: the tool's first route that takes a spreadsheet
  (a hostile `.xlsx` is parsed by the server). **The byte bound does not
  bound that parse**: at the base, `readSheets` (exceljs) inflates every entry
  of the zip whole, so a real one-sheet workbook of 210,368 bytes whose sheet
  XML holds 200 MiB of spaces reads in full in 1,823 ms with the process's
  resident memory up 215 MB (gate 4's `upload.mts`; 40 MiB of padding in 47,297
  bytes: +79 MB, 416 ms, on this branch). The parse is bounded by the sixth
  bound of Build 3.3, the workbook's inflated size, which Done when 8 tests. A
  paid,
  rate-limited route, a new screen with its 360 px case, and it reverses
  lg-7's "a command, not a route" for this path (the existing `import:ledger` command
  stays as it is).
- **(b) The existing command.** `import:ledger` gains a flag that asks the
  model, prints the confirmation in the terminal and waits for `y`. No upload,
  no route, no screen, no responsive case. Costs: only whoever runs commands on
  the host can use it, so a household cannot import its own file; "on screen"
  becomes "in the terminal". Under (b) Build steps 3 and 4 and Done when 5 to
  9, 11 and 13 are rewritten around the command.

_Note, 2026-10-26 (lg-66's round 1, gate 1's F2 and F6; the answer above is
unchanged)._ Two things (a) says turned out otherwise. **The inflated size is
the second bound Build 3.3 lists, not the sixth**, and the build refuses on
seven (bytes, the zip's entries, the inflated size, sheets, rows, cells, the
request's estimate) and cuts one (a cell's text). **And the inflated-size bound
did not bound the parse as cheaply as (a) implies:** the 40 MiB figure was
whitespace, which `exceljs` reads for little, while cells cost it 20 to 27 MB
of memory per MiB inflated. At the build's 16 MiB, a 1.7 MB upload of dense
cells cost +301 MB and 2.4 s through the describe route before the cells bound
refused it, a 3-column sheet +335 MB and 2.5 s, and 44,016 one-byte entries
8.4 s; the ledger's container holds 512 MB. By the owner's answer B of
2026-10-26 the bound is now 4 MiB and a zip holds 1,000 entries at most: those
four uploads are refused in 60 to 84 ms, before `exceljs`, and a sheet just
under the new bound costs +99 to +109 MB and 0.7 to 1.1 s. The Log's entry of
2026-10-26 has the measurement.

### 2. Which files

**Answered: (b), bank CSVs too** (this overrode the recommendation, (a)). The
owner was then asked how to carry it out, and chose **"Split: file lg-67 for
CSVs"**: lg-66 is the `.xlsx` build below, and a CSV is refused with the plain
message until lg-67, which serves bank CSVs (filed, `ready`; it depends on
lg-66 and is not in this ticket's `depends_on`).

Of the 13 measured fixtures, six are workbooks and seven are bank CSVs. A CSV
has no bucket column: the reader returns its rows as `unfiled`, and
`importWorkbook` refuses any unfiled row (lg-38's Log, "A CSV has no
buckets"). A CSV with no balance column cannot prove itself at all; lg-38 says
it would need matching one for one against a statement paste of the same dates
(`00-ANALYSIS.md` §8).

- **(a) Recommended: `.xlsx` workbooks only.** A CSV is refused with a plain
  message. The build is the workbook import the title says. Costs: a household
  arriving with a bank CSV gets nothing from this ticket, and seven of the
  thirteen measured shapes (including `bank-two-dates`, the one let-through)
  are not served. **And the failure the owner's guard answers was seen only on
  a CSV.** The date-column let-through (9 of Haiku's 10 shown runs on
  `bank-two-dates`, 1 of 10 masked) is a CSV fixture. On the six workbook
  fixtures Haiku had 0 let-through in 120 runs: shown, 59 right and 1 refused
  by the verifications; masked, 60 right. Under (a) the date column and the
  bucket labels are still shown, as the owner chose, but the measurement
  observed no workbook failure for either to guard against (no model swapped
  the bucket labels either).
- **(b) Bank CSVs too, as statement rows.** The described CSV's rows are read
  and stored the way a statement paste stores them (they wait in the inbox,
  unfiled). Costs: a second feature of the same size. The CSV reader now in
  `api/test/layout/csv.ts` moves into `src`, and it does not read decimal
  commas, semicolon delimiters or thousands separators (unmeasured, below).
  What proves a CSV with no balance column, and how its rows are placed against
  rows already stored, are open design.

### 3. What `ignored` means

**Answered: (a), leave the reader and correct the text** (the recommendation).

`ignored` is a list of sheets the contract text calls "read as none of the
above". The reader never consults it: the reading is identical whether it is
empty, holds every sheet, or holds the account sheets themselves (lg-38 gate 1,
low). In the runs, 8 of Haiku's 260 answers contradict themselves this way: 6
of its 20 `lg7` answers (four shown, two masked) listed `Accueil` as ignored and
also named it the salaries sheet, and 2 of its 10 shown `english` answers
(`english-8`, `english-10`) listed `Home` as ignored and as the salaries sheet.
The import was the same as the correct description's in all 8. In a build, a description that contradicts
itself drives a real import.

- **(a) Recommended: leave the reader, correct the text.** The schema's
  description says what is true (the list is advisory and is not read). The
  reader's behaviour is the one measured, and the 8 answers keep importing
  correctly. Costs: a self-contradictory answer still passes silently. **And it
  changes what the model is sent.** The phrase "read as none of the above" is a
  `.describe()` text of the answer's schema, which goes to the model as the
  structured output's format (5,842 characters at the base, the phrase in it);
  `layoutRequest` contains it for 0 of the 13 fixtures. All 300 runs were taken
  with the old text, so the effect of the new text on what Haiku answers is
  unmeasured. The build's schema pin (Build 1, Done when 1) moves with it, as a
  deliberate edit. For scale, lg-56's Haiku shown run over the 13 fixtures
  cost $0.1297.
- **(b) The schema refuses a layout that names a sheet as ignored and as an
  account, period or salaries sheet.** Costs: the 8 answers above, which
  imported correctly, would have been refused as `invalid`, which the person
  sees as a failed read.
- **(c) The reader honours `ignored`.** Costs: for the same 8 answers the
  salaries sheet is ignored and the salaries read as none, and **nothing
  refuses it**. Measured offline, reading each fixture (`lg7` for six, `english`
  for two) through each of the 8 actual answers with `salaries: null` (how a
  reader honouring `ignored` reads them) scores `let-through` in 8 of 8, the same
  outcome the base suite pins for lg-37's "the salaries missed". So (c) turns 8
  correct imports into 8 wrong ones that the verifications let through. (The score compares the
  reader's `problems`; `importWorkbook`'s own further checks were not run on
  these eight.)

## Build

Written for the owner's answers above: a web flow (Decision 1 (a)), the
`.xlsx` import with bank CSVs left to lg-67 (Decision 2, split), and the text
of `ignored` corrected (Decision 3 (a)). The answers are recorded on this page
and in the Log, and `status` is `ready`, as `docs/01-TICKETS.md` says.

1. **Move what was measured from `api/test` into `src`, so the product sends
   what the harness measured and there is one copy.** That is `layoutView`,
   `LAYOUT_PROMPT`, `layoutRequest` and `DEFAULT_VIEW`
   (`api/test/layout/view.ts`) and the model call in `anthropicAsk`
   (`api/test/live/layout-run.ts`): the client options, `zodOutputFormat` of
   `workbookLayoutSchema`, `max_tokens` 16 000, `effort: "medium"`, model
   `claude-haiku-5-5`, figures shown. The harness imports them back; its
   consent, spend-stop and argument guards stay where they are.
   - The SDK is called only from `@ledger/receipts`, the one package that talks
     to a model. `receipts` gains no workspace dependency it does not declare
     (`packages/core/test/image-closure.test.ts` names a missing line). Where
     the view and prompt live, given that they take `books`' `Sheet`, is the
     builder's call, said in the Log.
   - **Do not edit `tools/ledger/CLAUDE.md`.** Its layout table says `receipts`
     is "the receipt reader: a photo in, proposals out" and that it is "the only
     package that talks to a model". The builder proposes the changed lines in
     its report.
   - Before moving anything, record at the base the sha256 of `layoutRequest`
     for each of the 13 fixtures **and** of the format schema the model is sent,
     `JSON.stringify(zodOutputFormat(workbookLayoutSchema).schema)` (5,842
     characters at the base; its `.describe()` texts, "read as none of the
     above" among them, are in it and in no `layoutRequest`). Pin all 14
     afterwards with a test, so a change to what is sent is a deliberate edit of
     a pin. An edit to a `.describe()` text in `@ledger/contract` moves the
     schema pin.
2. **The reader and the schema.**
   1. `importWorkbook` takes a `layout` option, passed to `readWorkbook`, with
      the household's layout as the default. That makes the `unfiled` guard in
      `api/src/workbook-import.ts` testable (lg-38 gate 1: "a test would need a
      `layout` option on `importWorkbook`, which does not exist"), and makes the
      out-of-order report reachable from a described layout (lg-56 gate 4, F9:
      `workbook-import.ts` passes no `layout` today).
   2. **Reading no rows is a problem.** Reproduction at the base:
      `api/test/layout.test.ts` › "empty-columns-csv: a layout that reads empty
      columns reads no row, skips none and reports no problem" reads
      `empty-columns-csv` through withdrawal and deposit pointing at empty
      columns and asserts `[0, 32]` rows read and skipped with `problems`
      equal to `[]`. (lg-38 gate 1 measured the same on `csv-balance`: 0 rows
      read, 40 skipped, 0 problems.) Across all the sheets a description
      selects as the account, 0 rows read (movements plus unfiled) is one
      problem naming the sheets and the number of dated rows skipped. The
      households' own fixtures (lg-7, lg-37) are unaffected.
   3. **Bucket labels that collide by accent.** The schema refuses labels that
      collide by case but accepts `Hypothèque` for the mortgage and
      `Hypotheque` for current expenses, and the reader, which keys on its
      accent-folding, files both under the later bucket (lg-38 gate 1, low).
      The schema refuses a collision after the same folding.
   4. **`ignored`**: as Decision 3 is answered.
3. **The two requests** (web flow, Decision 1 (a)). Both resolve the caller's
   household as the other routes do (`booksOf`, `personOf`).
   1. **Describe.** Takes the file and an explicit consent field. **Only an
      `.xlsx` is read** (Decision 2, split): both requests refuse anything
      else, a CSV included, with a typed error and a plain message, judged from
      the bytes and not from the file's name. A CSV is refused this way until
      lg-67, which serves bank CSVs (filed). The judgement is the zip's own
      structure: the file opens with `PK`, has a readable end-of-central-directory
      record and central directory, and holds the workbook's own entries,
      `[Content_Types].xml` and `xl/workbook.xml`. It is made from the central
      directory without inflating anything, after the byte bound and before the
      file is parsed or anything is sent; a file that fails any part of it gets
      the same plain message, not the parser's reason. (Opening with `PK` alone is
      not enough: a CSV whose first header is `PK ID` passes it, and a zip that is
      not a workbook reads as 0 sheets with no error.) A reading of **0 sheets**
      is a typed refusal before anything is sent. Reads the sheets, builds the request, makes **one** model call, validates the answer
      with `workbookLayoutSchema`, reads the file through it, and runs
      `importWorkbook` with `commit: false` so that its `report` is what the
      person is shown. Writes nothing. An answer that is not JSON, does not
      validate or stops on `max_tokens` is a typed error, with no retry and no
      second call: the model is called only by the person's explicit action.
   2. **Confirm.** Takes the file and the description again, re-validates the
      description, re-reads the file and runs every verification, and imports
      (`commit: true`) in the one transaction only when all hold. It makes no
      model call. **The server stores nothing of the upload** between the two.
   3. **Bounds**, each a named constant, and each handled at the one point it
      can be known, in this order:
      - **The upload's bytes** are checked before the workbook is parsed; over
        the bound is a typed refusal.
      - **The zip's entries** are counted from its end-of-central-directory
        record before the directory is walked; over the bound is a typed
        refusal. _(Added 2026-10-26 by the owner's answer B, gate 1's F2: a zip
        of many tiny entries costs time per entry whatever their size.)_
      - **The workbook's inflated size** is checked before exceljs inflates
        anything. The central directory gives each entry's declared uncompressed
        size; the total over the bound is a typed refusal. **A zip can declare
        less than it holds**, so the inflate is also stopped at the bound: the
        bytes actually inflated, summed over the entries, are counted as they
        are produced, and the parse is refused the moment the count passes the
        bound, whatever the zip declared. The builder says how (a counting
        wrapper in front of the inflate, or a parse that streams). exceljs
        offers no hook into its own inflate, so the counted pass is one the
        build adds, and it inflates every accepted file a second time. Two ways
        to do it were measured to exist, a hand parse of the central directory,
        and `node:zlib` with `maxOutputLength` or a streaming counter; both
        avoid importing jszip, a dependency the api does not declare. The
        builder states the bound with the inflated size of the largest of the
        six workbook fixtures beside it, and names the chunk by which a stop may overshoot.
      - **The number of sheets, and the rows and cells read,** need the parsed
        file. Over either is a typed refusal before anything is sent.
      - **The length of a cell's text sent** is a truncation, not a refusal: the
        view cuts the text at the bound and the file is still read in full.
      - **The request's size** is an estimate, since the API counts tokens only
        by a call. It is the four-characters estimate of the request plus the
        answer's schema (1,461 tokens at the base), multiplied by 2.32. The
        measured ratio of the API's count to that estimate is 2.2 to 2.3 in
        lg-38's Log and, in lg-56's 300 records, at most 2.317 (`lg37`; 2.314 to
        2.317); the owner's "measured 2.3 ratio" is rounded up to 2.32 because
        2.3 under-counts the largest request by about 0.7%. It is stated as an
        estimate, and over the bound is a typed refusal before the call.

      The builder states each value and the arithmetic for the largest request
      the bounds allow. The route has its own rate-limit bucket, per person, as
      the receipt reader's paid route has.

   4. **Configuration.** The key is the receipt reader's `ANTHROPIC_API_KEY`,
      with `ANTHROPIC_CUSTOM_HEADERS` refused as `loadReceiptReaderConfig`
      refuses it. With no key the route is refused with a typed error and no
      call. The model is a constant (Haiku 5.5), not `RECEIPT_MODEL`: what was
      measured is that model.
   5. **Errors** are `AppError`s with codes in `@ledger/contract`'s taxonomy:
      a reader not configured, an answer that is not a layout, a reading the
      verifications refuse, a file over a bound. The builder lists the new
      codes in the Log; none is a core code, since none would mean anything to
      another tool.
   6. **Nothing sensitive in a log line**: no key, no cell text, no file name.
4. **The confirmation screen**, with its page in the web UI.
   1. **Before anything is sent**, the screen states what leaves the house: the
      names of the sheets and, for each sheet, its first 12 rows, 6 rows from
      the middle and its last 3 (the view's sample, `DEFAULT_VIEW`), with their
      figures and any formula text, go to Anthropic when the button is pressed,
      and nothing else does. Choosing a file calls no model; the button does.
   2. **After the read, the person sees**, before any confirm control:
      - **The date column the description chose**: its letter, its header text
        from the file, and the dates of the 3 oldest and the 3 newest rows read,
        each with its detail and amount.
      - **Each bucket label the description maps to a bucket**: the label's
        text, the bucket (mortgage or current expenses) it was mapped to, the
        number of rows under it, and 3 sample rows (date, detail, amount). The
        rule for which 3 is the builder's, said in the Log; its test is the
        fixture in Done when 10.
      - The dry run's `report`.
   3. **Confirm** imports. **Cancel** writes nothing. When a verification fails
      the screen shows the problems and has no confirm control.
   4. The screen fits a 360 px phone and a desktop with no horizontal scroll of
      the page, and `e2e/layout.spec.ts` gets a case for it in the same pull
      request.
5. **The dependency.** `@anthropic-ai/sdk` is imported by
   `api/test/layout.test.ts` and `api/test/live/layout-run.ts` but declared only
   by `@ledger/receipts` (lg-38 gate 1, low). Declare it in
   `tools/ledger/api/package.json` at the version `receipts` pins, if any file
   under `api` still imports it after step 1; `npm install --ignore-scripts`
   once, `node scripts/check-lockfile-sync.mjs`, and `npm audit --package-lock-only`
   before the push.
6. **No test calls a model.** The tests use a fake that implements the ask
   function. The one live check is the owner's (Done when 11).

## Done when

1. `npm test -- --project ledger` passes, and a test fails when the sha256 of
   `layoutRequest` for any one of the 13 fixtures (`lg7`, `lg37`, `moved`,
   `english`, `csv-balance`, `csv-no-balance`, `swapped-labels`,
   `empty-columns-carry`, `empty-columns-csv`, `bank-preamble`,
   `bank-two-dates`, `bank-footer`, `bank-wide`) differs from its value at the
   base. Another test fails when the sha256 of the format schema,
   `JSON.stringify(zodOutputFormat(workbookLayoutSchema).schema)`, differs from
   the value the Log gives. The Log gives the 14 hashes at the base. The schema
   pin is the base's value until a deliberate edit of a `.describe()` text in
   `@ledger/contract` (Build 2.4 under Decision 3 (a)) moves it, and then it is
   the edited schema's value, with the new value and the reason in the Log; the
   13 `layoutRequest` pins stay the base's.
2. `importWorkbook` given no `layout` imports lg-7's and lg-37's fixtures as
   before: `api/test/workbook-import.test.ts` and `books/test/workbook.test.ts`
   pass with no case edited. Given a `layout` under which a row has no bucket
   or no balance, it refuses with the `unfiled` message; a test names that
   case.
3. Read through `empty-columns-csv`'s pinned wrong description, the reading
   reports at least one problem, and the two pins that said otherwise are
   updated: the `MISTAKES` entry `empty-columns-csv` is `refused`, and the
   test quoted in Build 2.2 expects the problem. The Log lists the outcome of
   each `MISTAKES` entry in `layout.test.ts` before and after, with the count
   that changed.
4. The schema refuses `Hypothèque` and `Hypotheque` named for two different
   buckets, and still refuses two labels that differ only in case; one test
   each.
5. With a fake model that answers each of the six workbook fixtures' correct
   descriptions in turn (`lg7`, `lg37`, `moved`, `english`, `swapped-labels`,
   `empty-columns-carry`), the describe request returns that description, the
   confirmation fields of Build 4.2 and a report, and the household's books are
   unchanged afterwards (the row count of each table before and after). With
   a fake that answers text that is not JSON, a schema-invalid object, and a
   valid object after `stop_reason: "max_tokens"`, it returns a typed error
   each time, the fake was called once each time, and the books are unchanged.
6. The fake is called once per describe request, and zero times for: a request
   without the consent field; a request with no key configured; a file over each
   of the seven bounds of Build 3.3 that refuse (bytes, the zip's entries,
   inflated size, sheets, rows, cells, the request's size estimate), one test
   per bound; a file that reads as 0 sheets; and a confirm request.
   Each refusal is a typed error. _(Reworded 2026-10-26 under the owner's
   answers B and D: gate 1's F6 found the bounds counted three ways, and B added
   the entries bound. **Superseded:** "a file over each of the five bounds of
   Build 3.3 that refuse (bytes, inflated size, sheets, rows and cells, the
   request's size estimate), one test per bound".)_
7. The confirm request given `lg7`'s fixture and its correct description
   leaves the books as `import:ledger --write` on the same workbook leaves them
   (the same rows, the same classifications and the same report figures).
   Given `lg37`'s fixture and its correct description, it is refused with
   exactly the problems `import:ledger --write` prints on the same workbook,
   and the books are unchanged; given a description that fails the
   verifications (the pinned wrong description of `lg37` with amount and
   balance swapped, outcome `refused`), it refuses, and the books are
   unchanged. _(Reworded by the owner's answer of 2026-10-26, A in the Log.
   **Superseded:** "The confirm request given `lg37`'s fixture and its correct
   description leaves the books as `import:ledger --write` on the same workbook
   leaves them (the same movements and the same report figures); given a
   description that fails the verifications (the pinned wrong description of
   `lg37` with amount and balance swapped, outcome `refused`), it refuses, and
   the books are unchanged.")_
8. An upload over the byte bound is refused before the workbook is parsed (a
   test where the sheet reader is a spy that is never called). Two tests bound
   the inflate. (i) A real one-sheet workbook whose sheet XML is padded with
   whitespace to more than the inflated-size bound, small enough to pass the
   byte bound (the inflated-size bound is under the smaller padding; tested at
   40 and at 200 MiB of padding), is refused from its declared sizes, with the
   inflate spy at 0 bytes and the sheet reader not called. (ii) A crafted zip
   holding the workbook's entries whose declared sizes understate its content,
   which would inflate to more than the bound, is refused with the inflate spy
   at no more than the bound plus the chunk the Log names and the sheet reader
   not called (the spy's count, not the process's memory, is what the test
   reads; under a streaming parse that is itself the reader, the spy wraps the
   reader's own inflate instead). One over the sheets bound, the
   rows-and-cells bound or the request-size estimate is refused before anything is sent (a test per
   bound; the fake uncalled). A cell whose text is longer than the cell-text
   bound is not refused: the request carries it cut at the bound (a test reads
   the request the fake was given), and the file is still read in full. The
   request-size estimate is the four-characters estimate plus the schema times
   2.32, and the Log says it is an estimate. In the describe and confirm
   requests of Done when 5, 8 and 13 no log line holds any of the upload's
   content, its name or the key (a test reads every line the logger received).
9. The web tests show, for a fake describe response on `lg37`'s fixture: the
   statement of Build 4.1 present before the button is pressed, and the fake
   uncalled until it is; the date column's letter, header text and 3 + 3
   dates; each bucket label with its bucket, row count and 3 sample rows; the
   confirm control present when the verifications hold and absent when they
   do not. `e2e/layout.spec.ts` has the new screen's case at 360 px and
   1280 px.
10. On `swapped-labels` with the model's mapping swapped (the wrong description
    pinned in `layout.test.ts`), the confirmation lists `Compte 2` under
    `current-expenses` with its sample rows, and the sample under each label
    holds the evidence the fixture is built to carry: the `Paiement prêt` rows
    (lg-56's Log, the fixture's three pieces of evidence) appear in the sample
    under `Compte 2`. A test pins it.
11. **Awaiting, the owner's, after the merge:** one live read of a synthetic
    fixture through the web screen with the owner's key returns a description
    that confirms and imports, and the Log records the request's input tokens
    and the cost against the measured mean of about a tenth of a cent. A
    builder has no key.
12. `npm run check` and `node scripts/check-lockfile-sync.mjs` exit 0, and
    `packages/core/test/image-closure.test.ts` passes with the moved code.
    Whichever file under `tools/ledger/api` still imports `@anthropic-ai/sdk`
    belongs to a package that declares it.
13. Decision 2, split: the describe request and the confirm request, each
    given as the upload (i) the `csv-balance` fixture's text, (ii) a CSV whose
    first header is `PK ID`, and (iii) a zip that is not a workbook (one text
    entry), return the same typed error with the same plain message that only
    an `.xlsx` is read, the fake is not called, the sheet reader is not called,
    and the books are unchanged. That holds until lg-67, which serves bank CSVs
    (filed). A zip with the workbook's two entries and no sheet
    (its `xl/workbook.xml` a valid workbook with an empty `<sheets/>`; an empty
    file or text there fails in the parser, not at the 0-sheet refusal) reads as
    0 sheets and is a typed refusal with the fake uncalled, and the test asserts
    the 0-sheet refusal's own code or message. An `.xlsx`
    that is renamed `.csv` is still read, and a CSV renamed `.xlsx` is still
    refused (the check is on the bytes).

## Notes for the builder

- **Builders have no Anthropic key**, and a live call needs the firewall opened.
  Done when 11 is the owner's.
- **Real bank data never enters the repository**, including what a test or a
  fixture is modelled on (lg-38). Use the 13 synthetic fixtures.
- **What the feature owes the person** (lg-38): a model is called only by the
  person's explicit action, and the screen states what leaves the house (Build
  4.1).
- **Shapes the measurement did not cover**, to be refused or said plainly and
  never guessed (lg-56):
  - decimal commas, semicolon delimiters and thousands separators (`layout/csv.ts`
    does not read them; numbers stored as text in a workbook are not measured
    either);
  - a footer total under the amount column: the reader reports `an amount with
    no date` whatever a model says, so such a file will not import;
  - Sonnet on the nine fixtures it was not run on, and why masking moved
    `bank-two-dates`.
- **What the confirmation does not guard, and is not asked to.** lg-38's offline
  scoring found descriptions the verifications let through: the two buckets'
  labels swapped (the bucket labels on screen are the guard the owner chose),
  the detail and note swapped, no person column (every row reads as joint),
  the period sheets missed, the salaries missed. Only the date column and the
  bucket labels are on the confirmation screen. Showing more is a choice for
  the owner, not an addition for the builder.
- **The out-of-order list is not a guard here.** The owner passed over putting
  `outOfOrder` to the user as the guard. Build 2.1 makes the existing report
  line reachable from a described layout, and the dry run's report is shown;
  that is not the chosen guard and is not tested as one.
- **`HOUSEHOLD_LAYOUT`'s salaries label is `Salaires`, narrower than the old
  reader's `salaire…`** (lg-38 gate 1, low, disclosed): the household's own
  `import:ledger` is unchanged by this ticket, and a narrower label fails closed.
- **The harness lows stay with the harness** (lg-38's gate records: the spend
  stop's bound, a stop losing `summary.md`). The product's own bounds are
  Build 3.3.
- Fixtures are the 13 in `api/test/layout/fixtures.ts`; add none unless a test
  needs one, and name it in the Log.
- A new `scripts/*.mjs` needs an `include` line in `scripts/test/tsconfig.json`;
  a new workspace costs the lines `.claude/rules/image-closure.md` lists.

## Log

### 2026-10-24 — filed on the owner's build decision

Filed with lg-38's closing entry, from the owner's choice of "Build: Haiku +
date on confirm" (lg-38's Log, "the owner's build decision"). The Why quotes
lg-56's corrected Log (its entries "2026-10-24 — Build steps 3 and 4" and "round
1 of the report"), and claims nothing beyond its 300 runs on 13 invented
fixtures.

**Why `needs-decision`.** Three questions the owner's answers leave open, in
"Decision — open": where the import runs (a web flow, against lg-7's "a command,
not a route"), which files (workbooks only, because a CSV has no bucket column and
`importWorkbook` refuses unfiled rows), and what `ignored` means (the reader
never consults it, and 6 of 20 Haiku `lg7` answers contradict themselves
through it). The Build is written for the recommended option of each. The
answers go on this page in the first commit of the build, which moves `status`
to `ready`.

**Carried in from lg-38 and lg-56, and where each landed:**

- "reading zero rows must be a problem" (lg-38 gate 1; lg-56 Notes): Build 2.2,
  Done when 3.
- the `unfiled` guard has no test because `importWorkbook` has no `layout`
  option: Build 2.1, Done when 2.
- the accent-colliding bucket labels (lg-38 gate 1, low): Build 2.3, Done when 4.
- the `ignored` list the reader never consults (lg-38 gate 1, low; lg-56's six
  `lg7` answers): Decision 3, Build 2.4.
- `@anthropic-ai/sdk` imported by `api` and declared only by `receipts`
  (lg-38 gate 1, low): Build 5, Done when 12.
- decimal commas, semicolons, thousands separators, a footer total under the
  amount column (lg-56): Notes, and Decision 2 (b).
- the statement of what leaves the house and the explicit action (lg-38 Notes):
  Build 4.1, Done when 6 and 9.
- `workbook-import.ts` passes no `layout`, so no model's answer reaches the
  out-of-order report today (lg-56 gate 4, F9): Build 2.1.
- the descriptions the verifications let through, offline (lg-38): Notes, as
  what the confirmation does not guard.

**Fold-in exception.** Nothing else was made free by this filing; lg-38's
status and Log are edited on the same branch because this filing is what meets
its Done when 4.

### 2026-10-24 — round 1: the gate on the filing returned FAIL at `571ad077`; the owner's answers

Gate 3 (on PR #623, `4081e30d..571ad077`) returned FAIL: 2 high, 3 med, 4 low.
Its record is for lg-38's `## Review`, as `### Gate 3`.

**The owner's answers, 2026-10-24.** Three questions, from the orchestrator:

1. "When should you answer lg-66's three decisions?" Options: "Fix first, then
   ask" (the gate's recommendation) and "Ask now, findings attached". **The owner
   chose "Fix first, then ask."** So no `## Decision — open` question is
   answered here, `status` stays `needs-decision`, and the options' text is
   corrected so the owner can answer them afterwards.
2. "F3: how should the round reword Done when 8?" Options: "Gate's precise
   reword" (the gate's recommendation) and "Minimal reword". **The owner chose
   "Gate's precise reword"**: refuse on the byte bound before parsing and on
   every other bound before anything is sent; make the cell-text bound a
   truncation, not a refusal; count the request's API-token size by applying the
   measured 2.3 ratio to the estimate, stated as an estimate.
3. "Fix F4, F5 and the lows F6 to F9 in the same round?" Options: "Fix all
   six" and "F4 and F5 only". **The owner chose "Fix all six."**

**F1 (high): reproduced, and it was right.** Decision 3 (c) said what the import
does with `Accueil` ignored "is unmeasured". The gate's probe, re-run on this
branch (`node --import tsx probe.mts <tree> /home/pwuser`, which reads the
fixtures and the 300 records and calls no model):

```
lg7 with salaries null: outcome=let-through problems=0 salaries=0
ledger-layout-lg56-shown/lg7-10.json: salaries={"sheet":"Accueil","label":"Salaires bruts"} -> honoured outcome=let-through
ledger-layout-lg56-shown/lg7-3.json: ... -> honoured outcome=let-through
ledger-layout-lg56-shown/lg7-6.json: ... -> honoured outcome=let-through
ledger-layout-lg56-shown/lg7-9.json: ... -> honoured outcome=let-through
ledger-layout-lg56-masked/lg7-1.json: ... -> honoured outcome=let-through
ledger-layout-lg56-masked/lg7-10.json: ... -> honoured outcome=let-through
```

(Each line is the probe's, one per file; the `...` stands for the same salaries
text as the first. Round 2 corrects the count: see N4 below.)

(c) now says so: 6 correct imports become 6 wrong ones nothing refuses. The
probe scores `problems`; `importWorkbook`'s own further checks were not run on
these six, and the text says that.

**F2 (high): reproduced, and it was right.** `node --import tsx format.mts
<tree>`:

```
format schema: 5842 chars; contains "read as none of the above": true
layoutRequest contains it for 0 of 13 fixtures
```

Build 1 and Done when 1 now also pin the sha256 of
`JSON.stringify(zodOutputFormat(workbookLayoutSchema).schema)` (14 hashes), and
Decision 3 (a) says it changes what the model is sent, that the 300 runs were
taken with the old text, and what the Haiku shown run cost ($0.1297, lg-56).

**F3 (med): fixed** as the owner chose. Build 3.3 handles each bound where it can
be known: bytes before the parse, sheets and rows-and-cells after the parse and
before anything is sent, the cell text as a truncation, and the request's size as
the four-characters estimate times 2.3, an estimate. Done when 6 and 8 follow,
with the spy on the sheet reader for the byte bound.

**F4 (med): fixed.** Build 3.1 refuses anything but an `.xlsx`, judged from the
bytes, and the new Done when 13 tests it with the `csv-balance` text.

**F5 (med): fixed.** Decision 2 (a)'s costs now say the date-column failure was
seen only on a CSV, and that on the six workbook fixtures Haiku had 0
let-through in 120 runs (shown 59 right and 1 refused, masked 60 right), from
lg-56's tables: `lg7` 6 + 4, `lg37` 10, `moved` 10, `english` 8 + 2,
`swapped-labels` 9 + 1 refused, `empty-columns-carry` 10; masked: `lg7`
8 + 2, `lg37` 8 + 2, and 10 each for the other four (matched + same import).

**F6 (low): fixed.** Haiku shown cost $0.001089 a run on the four fixtures Sonnet
was run on, so 14.4 times is against that; against $0.000998 it is 15.7
($0.015646 / $0.000998).

**F7 (low): fixed.** Decision 1 and the Log quote lg-7's Build as it reads: "A
command, not a route." and "It is a one-off, and it has no reason to exist on the
network." The filing had paraphrased it as a "never a route" that lg-7 does
not say, and had dropped its reason (a one-off); the paraphrase is gone from
Decision 1 and from the filing entry above.

**F8 (low): fixed.** Decision 1 (b) lists Done when 5 to 9, 11 and 13.

**F9 (low): fixed in lg-38's entry.** The owner was shown a description for each
option; the entry now quotes each verbatim, as the orchestrator gave them.

### 2026-10-24 — round 2: gate 4 returned FAIL at `b0788d12`; the owner's answers

Gate 4 (on PR #623, `571ad077..b0788d12`) confirmed all nine of gate 3's
findings fixed and returned FAIL on one high and six others (N1 to N7).

**The owner's answers, 2026-10-24.** Two questions, from the orchestrator:

1. "Which remedy should the brief specify for N1?" Options: "Bound the inflated
   size" (the gate's recommendation), "Parse in a worker", and "Both". **The
   owner chose "Bound the inflated size."** As put to the owner, that is a sixth
   bound: read the zip's central directory, total each entry's declared
   uncompressed size, and refuse over a limit before exceljs inflates anything;
   and "a zip that lies about its sizes needs the inflate stopped at the limit
   as well".
2. "What goes in the round?" Options: "All seven, N3 included" and "All but N3".
   **The owner chose "All seven, N3 included."** For N3: require the workbook's
   own zip entries, and refuse a 0-sheet read before any model call, plus a line
   in Done when 13.

No `## Decision — open` question is answered, and both `status:` lines are
unchanged.

**N1 (high): reproduced, and it was right.** `node --import tsx upload.mts
<tree> 40` on this branch, through the base's `readSheets`:

```
csv starting PK: 51 bytes, opensWithPK=true -> threw BAD_REQUEST: The file could not be read as an .xlsx workbook (Can't find end of central directory : is  (rss +0 MB, 1 ms)
zip, not a workbook: 123 bytes, opensWithPK=true -> read 0 sheets (rss +0 MB, 7 ms)
small workbook: 6415 bytes, opensWithPK=true -> read 1 sheets (rss +0 MB, 19 ms)
workbook inflating to 40 MB more: 47297 bytes, opensWithPK=true -> read 1 sheets (rss +79 MB, 416 ms)
```

(The gate's own run at 200 MB: 210,368 bytes, +215 MB, 1,823 ms; I ran 40.) Fixed
as the owner chose. Build 3.3 has a sixth bound, the workbook's inflated size:
the declared total refused from the central directory before any inflate, and
the inflate itself stopped at the bound, because a zip can declare less than it
holds. Done when 8 has two tests: the padded workbook (the file `upload.mts`
builds) refused from its declared sizes with the inflate spy at 0 bytes, and a
crafted zip whose declared sizes understate its content, refused with the spy at
no more than the bound plus a named chunk. Decision 1 (a)'s cost now says the
parse is bounded by that bound, not by the byte bound. The test reads the spy's
count and not the process's memory, which would measure the machine.

**N2 (med): fixed.** Done when 1 now pins "the value the Log gives": the base's
until a deliberate edit of a `.describe()` text (Build 2.4 under Decision 3 (a))
moves it, and then the edited schema's, with the new value and reason in the
Log. The 13 `layoutRequest` pins stay the base's.

**N3 (med): reproduced (the first two lines above), and fixed.** Build 3.1
judges an `.xlsx` by the zip's structure from the central directory (opens with
`PK`, a readable directory, `[Content_Types].xml` and `xl/workbook.xml`
present), gives every failure the one plain message, and refuses a reading of 0
sheets before anything is sent. Done when 13 gains the `PK ID` CSV, a zip that is
not a workbook, and a workbook-shaped zip with no sheet.

**N4 (med): reproduced, and it was right.** `node --import tsx ignored.mts
<tree> /home/pwuser` prints 8 lines ending `salaries-null outcome=let-through`:
the six `lg7` files, and `english-8` and `english-10` (shown), which list `Home` as
ignored and as the salaries sheet. Decision 3's count is now 8 in 260 Haiku
answers, in the intro and in (a), (b) and (c) (8 of 8 let through under (c)). The
round-1 entry above counts 6; this corrects it.

**N5 (low): fixed.** The ratio is 2.32, not 2.3. lg-56's 300 records give at most
2.317 (`lg37`, 2.314 to 2.317; lg-38's table 9,468 / 4,091 is 2.314), so 2.3
under-counts the largest request by about 0.7%. The owner's "measured 2.3 ratio"
is rounded up to the largest measured, and Build 3.3 and Done when 8 say so, with
the estimate defined as the four-characters estimate plus the schema's 1,461
tokens, which is what the ratio was taken against.

**N6 (low): fixed.** The round-1 entry's code block now prints the probe's lines,
one per file, with `...` for the repeated salaries text, and says so.

**N7 (low): fixed.** Done when 8's log clause is scoped to the describe and
confirm requests of Done when 5, 8 and 13, and graded by a test that reads every
line the logger received.

### 2026-10-24 — landing: gate 5 returned CONCERNS at `fac223c7`; P1 fixed, P2 to P5 fixed by owner choice

Gate 5 (on PR #623, `b0788d12..fac223c7`) returned CONCERNS: no high, one med
(P1), four low (P2 to P5). Its record is for lg-38's `## Review`, as `### Gate
5`. Each fix is the gate's own wording and direction, applied above `## Log`;
the gate's section is untouched. In the commands below `$T` is this ticket's
path, and each is `awk '/^## Log/{exit} {print}' $T | grep -c "<phrase>"`, so
the entries here do not count themselves. Nothing in the branch can fail on a
wording fix: the findings' own evidence is the gate's `order.mts` (P1) and
`inflate.mts` (P3) runs, quoted in its section.

- 2026-10-24 — Fixed at landing: gate 5, P1 (med; Done when 8 depends on it,
  so the severity floor makes the fix required) — "Done when 8's tests (i) and
  (ii) assert a refusal and the inflate spy's count. They do not assert that the
  sheet reader is uncalled". (i) and (ii) now say "and the sheet reader not
  called", and the spy wraps the reader's own inflate under a streaming parse.
  `grep -c "spy at 0 bytes. (ii) A crafted zip"` → 0 (was 1);
  `grep -c "inflate spy at 0 bytes and the sheet reader not called"` → 1 (was
  0); `grep -c "at no more than the bound plus the chunk the Log names and the sheet reader"`
  → 1 (was 0).
- 2026-10-24 — Fixed at landing by owner choice: gate 5, P2 — "Decision 3 (c)
  says `importWorkbook`'s further checks 'were not run on these six'. The
  round's count is 8." `grep -c "these six.)"` → 0 (was 1); `grep -c "these eight.)"` → 1
  (was 0).
- 2026-10-24 — Fixed at landing by owner choice: gate 5, P3 — "Done when 13 says
  'a zip with the workbook's two entries and no sheet reads as 0 sheets'. …
  that holds only when `xl/workbook.xml` is a valid workbook with an empty
  `<sheets/>`." Done when 13 now names that fixture file and asserts the 0-sheet
  refusal's own code or message. `grep -c "reads as 0 sheets and is a typed refusal with the fake uncalled. An"`
  → 0 (was 1); `grep -c "the 0-sheet refusal's own code or message"` → 1 (was 0).
- 2026-10-24 — Fixed at landing by owner choice: gate 5, P4 — "Done when 8 (i)
  points at 'the file `upload.mts` builds in gate 4's directory'. That is a
  session scratch path no later builder will have". The path is dropped and the
  line says the inflated-size bound is under the smaller padding.
  `grep -c "builds in gate 4's directory"` → 0 (was 1);
  `grep -c "(the inflated-size bound is under the smaller padding; tested at"` →
  1 (was 0).
- 2026-10-24 — Fixed at landing by owner choice: gate 5, P5 — "Build 3.3's 'a
  counting wrapper in front of the inflate' can be read as wrapping exceljs's
  own inflate, which exceljs does not offer … It does not say that the counted
  pass inflates every accepted file a second time." Build 3.3 now says so, and
  names the two paths measured to exist, neither importing jszip.
  `grep -c "wrapper in front of the inflate, or a parse that streams), states the"`
  → 0 (was 1); `grep -c "inflates every accepted file a second time"` → 1 (was 0);
  `grep -c "avoid importing jszip, a dependency the api does not declare"` → 1
  (was 0).

### 2026-10-24 — the owner's answers to the three open decisions; `status` is `ready`

Asked of the owner after gate 5, through the orchestrator. The page's `## Decision`
heading now reads `answered 2026-10-24 by the owner`, the answer is marked under
each question, and Build 3.1 and Done when 13 say that a CSV is refused until
lg-67. The options are as the Decision section states them.

1. **"Where the import runs"** — (a) a web flow: a screen to upload, a button
   that sends samples to the model, a confirmation; the tool's first route that
   takes a spreadsheet; reverses lg-7's "a command, not a route" for this path.
   (b) the existing `import:ledger` command with a flag that asks the model and
   prints the confirmation in the terminal. **Chosen: (a). It took the
   recommendation.**
2. **"Which files"** — (a) `.xlsx` workbooks only, a CSV refused with a plain
   message. (b) bank CSVs too, as statement rows, stored the way a statement
   paste stores them. **Chosen: (b). It overrode the recommendation, (a).**
   A follow-up question, "How should 'bank CSVs too' be carried out?", gave
   three options: "Split: file lg-67 for CSVs" (recommended: lg-66 lands as the
   `.xlsx` build with the CSV refusal kept "until lg-67", and lg-67 is filed
   after #623 as bank CSVs read through a described layout into the inbox,
   depending on lg-66, with its two design questions open: what proves a CSV with
   no balance column, and how its rows are placed against rows already stored);
   "Fold into lg-66"; "Re-pick Decision 2". **Chosen: "Split". It took the
   recommendation.** So lg-66's Build stays the `.xlsx` build; Build 3.1 and Done
   when 13 add that the CSV refusal holds until lg-67, and nothing else about
   the refusal or its tests changes. lg-67 is not filed in this pull request
   (`node scripts/next-id.mjs lg` printed `next free: lg-67`), and it is not in
   any `depends_on`.
3. **"What `ignored` means"** — (a) leave the reader, correct the schema's text
   (the list is advisory and is not read; changes what the model is sent, so the
   schema pin moves with a deliberate edit). (b) the schema refuses a layout that
   names a sheet as ignored and as an account, period or salaries sheet. (c) the
   reader honours `ignored`. **Chosen: (a). It took the recommendation.**

### 2026-10-25 — the build

Built on `53bb5d0f`, in five commits: `47d98627` (Build 1), `8a213224` (Build
2.4), `bda7ab3e` (Build 2.1 to 2.3), `35f876ee` (Build 3), `ad268ddd` (Build 4).
No test calls a model; Done when 11 is the owner's, after the merge.

**Corrected on this page, as fold-ins, with no older entry rewritten:**
`depends_on` named lg-38, which is done, and is now `[]`; Decision 2, Build 3.1
and Done when 13 said lg-67 was "to be filed", and it is filed and `ready`
(`npm run status -- --show lg-67`), so they now say "filed".

**Build 1: the 14 hashes at the base**, taken at `53bb5d0f` before anything
moved, by a script that imported `api/test/layout/view.ts` and
`zodOutputFormat(workbookLayoutSchema)` from that tree (characters, then sha256):

| What                  | Characters | sha256                                                             |
| --------------------- | ---------- | ------------------------------------------------------------------ |
| `lg7`                 | 5,363      | `57c9385c3f7fc1a27cb68a54b58d928d318ac3202befb017ef313b40dc4d260b` |
| `lg37`                | 10,518     | `79dc3826e8f2576897fa8b7989ac523aacce22cb2b6e9fad93414f295e007d2e` |
| `moved`               | 8,446      | `502035573fdbc86af43eb93b924c7bde8d8993b9b94eb51af696d12bb216b885` |
| `english`             | 8,161      | `e95f911fc6a89d97024dad1bb341809112a7b5b789cc4a99d224626251b69524` |
| `csv-balance`         | 3,110      | `4b6d2fdb139ba08018cd3840c711b1ad43f095392d839e0cef2aa037710ba2fe` |
| `csv-no-balance`      | 2,857      | `2e711e2626d3326d7d75af5d0902a912d583cfdf7338369bb78b5982a2b7d220` |
| `swapped-labels`      | 5,661      | `e21a2ad77293b92abfe8bcd6102934ec9ca4d1eac60107208c5f4e7e51bbb139` |
| `empty-columns-carry` | 5,841      | `13ab93b615909dee2384ef90b9357024b18762687d29b2da6a587752d12b24ea` |
| `empty-columns-csv`   | 3,115      | `9dd3898b7b7fe83a77817df4416f256f36dbc856e086b517dfc071d1daa3e8b7` |
| `bank-preamble`       | 2,975      | `bb09bba739c1a40cb0eed108469d7f92b59d3c47b664b1ff04ac10a26cc4d858` |
| `bank-two-dates`      | 3,740      | `e12bac7945aa5c645a9257b65ff1b4311fe30bf1d8367a083c99f12eb8e09c27` |
| `bank-footer`         | 3,039      | `f68253f5f453bff2395865016b207649610b3d2ed987e5f61885c77338769921` |
| `bank-wide`           | 4,861      | `6bc675ba868b27bbc853a3c56efa8265d84c59cf6e032c525ae78b878f3b54a8` |
| format schema         | 5,842      | `cbf85552e814c2f9aed91a6678ff87ff3f043c7212331edca255ebebc07ad1b6` |

`api/test/layout-pins.test.ts` pins all 14 and passed after the move (15 of 15
at `47d98627`). **The schema pin moved once, on purpose**, with Build 2.4: it is
now `e5c31565db17908aed3654c0d3e44f2eaaf0ff10124d84568ff462b76add6eb7`, 5,963
characters, because `ignored`'s `.describe()` now reads "Every other sheet, by
name. Advisory only: the reader does not consult this list, and a sheet not
named as the account, the periods or the salaries is not imported either way."
Before the pin was updated the run read 1 of 15 failed, `Expected: "cbf85552…"`,
`Received: "e5c31565…"`, the 13 request pins passing. The four-characters
estimate of the schema is 1,491 tokens now (1,461 at the base). Its effect on
what Haiku answers is unmeasured, as Decision 3 (a) says.

**Where things went.** The view, the prompt, `layoutRequest`, `DEFAULT_VIEW`
and `estimateTokens` are `api/src/layout-view.ts`: they read `books`' cell
grids, and `receipts` has no reason to know a sheet, so it is handed the text
and gains no workspace dependency. The model call is `createLayoutAsk` in
`receipts/src/layout.ts`, with the measured client options, `max_tokens` 16 000,
`effort: "medium"`, `claude-haiku-5-5` and `layoutOutputFormat()`
(`zodOutputFormat(workbookLayoutSchema)`); the harness calls it with the model
and effort it measures. The SDK failure mapping moved to `receipts/src/failure.ts`,
shared with the receipt reader, whose wording is unchanged. The view's sample
sizes (12, 6, 3) are `LAYOUT_SAMPLE_ROWS` in the contract, which `DEFAULT_VIEW`
and the screen's statement both read; the 13 request pins held after that.

**Build 5: nothing to declare.** No file under `tools/ledger/api` imports
`@anthropic-ai/sdk` any more (`grep -rln "@anthropic-ai/sdk" tools/ledger/api
--include=*.ts` prints nothing, exit 1): `layout.test.ts` reads the format
through `layoutOutputFormat()`. So no `npm install` ran, the lockfile is
unchanged, and `node scripts/check-lockfile-sync.mjs` exits 0.

**Build 2.2, and what the brief had to give.** "0 rows read is one problem"
would add a line to three of `books/test/workbook.test.ts`'s cases, whose
readings are already refused at a cell (a name nobody configured, an amount that
is text, a split amount finer than a cent): Done when 2 says that suite passes
with no case edited. So the problem is raised only when nothing else refused
the reading. It reads `The layout reads no row of the account from
"chequing-activity.csv": 32 dated rows were skipped for having no amount, and
none was read.` Done when 3's `MISTAKES`, all 27 entries of the two tables in
`layout.test.ts`, before and after:

| Fixture               | Mistake                                              | Before          | After       |
| --------------------- | ---------------------------------------------------- | --------------- | ----------- |
| lg37                  | amount and balance swapped                           | refused         | refused     |
| lg37                  | order flipped                                        | refused         | refused     |
| lg37                  | person and detail swapped                            | refused         | refused     |
| lg37                  | no summary rows                                      | refused         | refused     |
| lg37                  | no carry-overs, no year per sheet                    | refused         | refused     |
| lg37                  | periods' first line one row low                      | refused         | refused     |
| lg37                  | periods' names row wrong                             | refused         | refused     |
| lg37                  | the two buckets' labels swapped                      | let-through     | let-through |
| lg37                  | detail and note swapped                              | let-through     | let-through |
| lg37                  | no person column                                     | let-through     | let-through |
| lg37                  | the period sheets missed                             | let-through     | let-through |
| lg37                  | the salaries missed                                  | let-through     | let-through |
| lg37                  | a sheet left out of ignored                          | same-import     | same-import |
| moved                 | order flipped                                        | refused         | refused     |
| english               | amount and balance swapped                           | refused         | refused     |
| english               | deposit label wrong                                  | refused         | refused     |
| csv-balance           | withdrawal and deposit swapped                       | refused         | refused     |
| csv-balance           | order flipped                                        | refused         | refused     |
| csv-no-balance        | order flipped                                        | let-through     | let-through |
| csv-no-balance        | amount and detail swapped                            | refused         | refused     |
| swapped-labels        | the two buckets' labels swapped                      | let-through     | let-through |
| empty-columns-carry   | the amount column pointing at the empty one          | refused         | refused     |
| **empty-columns-csv** | **withdrawal and deposit pointing at empty columns** | **let-through** | **refused** |
| bank-preamble         | order flipped                                        | refused         | refused     |
| bank-two-dates        | the date read from the transaction date's column     | let-through     | let-through |
| bank-footer           | amount and balance swapped                           | refused         | refused     |
| bank-wide             | the detail read from the currency column             | let-through     | let-through |

One changed of 27: 16 refused, 10 let through and 1 the same import before; 17,
9 and 1 after. With the reader changed and the pins not yet, exactly the two
pins Done when 3 names failed (`npx vitest run tools/ledger/api/test/layout.test.ts
tools/ledger/books/test`: 2 failed, 477 passed, of 479).

**Build 2.3.** `readerFolded` in the contract is the reader's folding (accents,
case, dots, spaces), and `books`' `folded` now calls it, so the two cannot
disagree. Red: with the schema's key put back to the base's `text.toLowerCase()`,
`contract/test/layout.test.ts` read 1 failed of 9 ("refuses Hypothèque and
Hypotheque named for two different buckets"); restored from `35f876ee`, 9 of 9.

**The error codes**, all ledger codes, none core (Build 3.5):
`WORKBOOK_NOT_XLSX` (415), `WORKBOOK_NO_SHEETS` (422), `WORKBOOK_TOO_LARGE`
(413, `details.bound` one of `inflated`, `sheets`, `rows`, `cells`, `request`),
`LAYOUT_READER_UNCONFIGURED` (503), `LAYOUT_UNREADABLE` (422),
`WORKBOOK_IMPORT_REFUSED` (422, `details.problems`). The byte bound is core's
`SIZE_LIMIT_EXCEEDED` (413, `details.bound: "bytes"`), as a receipt photo's is:
it is the size of what was sent, and Fastify's body cap raises the same code
for a body far over it. A request without consent, or a confirm whose
description does not validate, is `BAD_REQUEST`.

**The bounds** (Build 3.3), in the order they are checked:

- bytes: `MAX_WORKBOOK_BYTES`, 4 MiB, decoded size computed from the base64's
  length before decoding. The six workbook fixtures are 10,782 to 21,803 bytes
  as `exceljs` writes them.
- the zip's structure, from the central directory, inflating nothing
  (`api/src/workbook-zip.ts`, a hand parse; no `jszip`).
- inflated size: `MAX_WORKBOOK_INFLATED_BYTES`, 16 MiB, first from the declared
  sizes, then counted as `node:zlib`'s `createInflateRaw` produces it, every
  chunk discarded. The largest workbook fixture, `lg37`, inflates to 90,542
  bytes. **The chunk a stop may overshoot by is `INFLATE_CHUNK_BYTES`, 16 KiB**
  (the inflater's `chunkSize`). Every accepted file is inflated once here and
  once more by `exceljs`.
- sheets: 40 (the workbook fixtures hold 2 to 9); rows: 20,000 over every sheet
  (`lg37` holds 320); cells holding a value: 200,000 (`lg37` holds 1,533).
- cell text: 40 characters, `MAX_CELL_TEXT`, the measured `maxText`, a cut
  with `…`, never a refusal.
- the request: **an estimate**, `ceil((ceil(request / 4) + ceil(schema / 4)) ×
  2.32)`, refused over `MAX_REQUEST_TOKENS`, 24,000. `lg37`'s request estimates
  at `ceil((2,630 + 1,491) × 2.32)` = 9,561 (the API counted 9,468 at the base's
  schema). The largest request the bounds allow is 24,000 estimated tokens:
  `24,000 / 2.32` = 10,344 four-character tokens, less the schema's 1,491, is
  8,853, so about 35,400 characters of request, 2.5 times `lg37`'s input, plus
  the answer's 16,000 tokens at most.

The describe route has its own bucket, `RATE_LIMIT_WORKBOOK_DESCRIBES_PER_MINUTE`,
5 a minute per person by default, as a receipt read has; confirm takes `write`.

**The client's retries.** `createLayoutAsk` keeps the measured `maxRetries: 2`
and a 180 s timeout: the SDK retries a dropped connection, a 429 or a 5xx on
its own. That is the transport, under the one model call the route makes;
nothing retries an answer.

**The confirmation (Build 4.2).** The date column's header is the nearest text
above the first row read in that column, on the first sheet that has a row read.
**The rule for a label's 3 rows**: the newest row of each of its 3 most frequent
details, most frequent first, then the newest rows not yet shown. On
`swapped-labels` that puts the monthly `Paiement prêt` in `Compte 2`'s three
(Done when 10). The field is `examples`, not `sample`: the isolation sweep
marks "sam" as the other household's person, and "sample" contains it.

**What the brief had wrong: lg37 does not import, through the command or the
screen.** lg-38's generator opens every generated workbook at 1,200.00 (mortgage)
and 300.00 (buffer), and `importWorkbook` refuses money carried in before the
books' first row. `import:ledger --write` on `lg37` written as an `.xlsx`, into
fresh books, exits 1 with three `FAILED` lines, ending "The first year carries in
1200.00 $ (mortgage) and 300.00 $ (buffer) from before the workbook, and the
books count nothing before their first row." Of the six workbook fixtures only
`lg7` imports. So Done when 7's first half, read on `lg37`, holds only
vacuously (both leave the books empty). The test does three things: `lg7`
confirmed on the screen leaves the same `statement_rows` and classifications and
the same report figures as the command (17 rows); `lg37` confirmed is refused
with exactly the problems the command prints, the books unchanged; and `lg37`
with amount and balance swapped is refused with problems of its own. Done when
5's describes return `ok: false` for the five generated workbooks for the same
reason, and the screen's web test uses the real `lg37` response and an `ok: true`
copy of it. Whether Done when 7 should be reworded to `lg7` is the
orchestrator's to put to the owner.

**Done when 8 (i): memory.** The padded workbook is deflated as it is written
(`paddedDeflate` in `api/test/helpers/xlsx-file.ts`, 1 MiB of spaces written
again and again, the CRC carried chunk by chunk), so 200 MiB is never held.
Peak RSS of the vitest worker, sampled from `/proc/<pid>/status`'s `VmHWM` every
20 ms: 197 MB running only the 200 MiB test, 188 MB running only "a request with
no key configured" from the same file (both write the six fixture workbooks in
`beforeAll`). The 200 MiB test took 1,289 ms, the 40 MiB one 275 ms.

**Folded in, besides the two corrections above:** the import's dry-run report
said "Run again with --write to import" on the screen too; `importWorkbook`
takes `via: "screen"`, which says "Confirm to import." instead. `.env.example`
names the new rate-limit variable. Nothing else was made free.

**Proposed for `tools/ledger/CLAUDE.md`**, not edited (Build 1): its layout table
says `receipts` is "the receipt reader: a photo in, proposals out; the only
package that talks to a model". Proposed: "the model calls: the receipt reader
(a photo in, proposals out) and the layout describer (a workbook's samples in, a
described layout out, lg-66); the only package that talks to a model". The
lines in the prose about `receipts` and the paid route ("The one route that
costs money, a receipt read") would say there are two.

**Awaiting:** Done when 11, the owner's live read through the screen with a key,
after the merge.

### 2026-10-26 — round 1: gate 1 returned CONCERNS at `e02ec781`; the owner's answers

Gate 1 (on PR #670, `53bb5d0f..e02ec781`) returned CONCERNS: no high, two med
(F1, F2), five low (F3 to F7). Its record is for this ticket's `## Review`.

**The owner's answers, 2026-10-26**, put by the orchestrator. The options are as
they were put; the one chosen is marked.

- **A. Done when 7.** Options: reword the positive case to `lg7` (the
  builder's recommendation); change lg-38's generator so `lg37` opens at zero.
  **Chosen: reword to `lg7`.** Done when 7 now says that `lg7` confirmed on the
  screen leaves the same rows, classifications and report figures as
  `import:ledger --write`, that `lg37` is refused with exactly the problems the
  command prints and the books unchanged, and keeps the swapped-`lg37` case. The
  superseded line is kept beside it. The tests already did this (the build's
  entry, "What the brief had wrong").
- **B. Gate 1 F2 (open decision).** Options: (a) tighten the bounds (the gate's
  recommendation); (b) keep the constants and correct the text. **Chosen:
  (a).**
- **C. Gate 1 F1.** Options: one test per `workbook-zip.ts` guard in the round
  (recommended); record only. **Chosen: in the round.**
- **D. Gate 1 lows F3 to F7.** Options: all five in the round (recommended);
  F3, F6 and F7 only; none. **Chosen: all five.**
- **E. `tools/ledger/CLAUDE.md`.** The owner chose "Yes" on the build's
  proposal: the `receipts` row of the layout table becomes "the model calls:
  the receipt reader (a photo in, proposals out) and the layout describer (a
  workbook's samples in, a described layout out, lg-66); the only package that
  talks to a model", and the prose that calls a receipt read "the one route
  that costs money" says there are two. Applied in this round, in its own
  commit.

### 2026-10-26 — round 1: the fixes for gate 1's seven findings

Continued from `e02ec781` on `53bb5d0f` (`origin/main` had not moved). Eight
commits: the answers above (`4f4e7c2d`), `tools/ledger/CLAUDE.md` (`2bd5e2b7`,
answer E, as worded there; the paragraph that introduces `receipts` as "the
receipt reader (lg-8)" was not part of the answer and is unchanged), F1's tests
(`40838f68`), F3 (`945aa851`), F2 (`c02e3506`), F4, F5 and F7's tests
(`59f904d3`), three guards gate 1 did not list (`696e0cbd`), and this entry.

**F2 (med): reproduced, and tightened as the owner chose (a).** Measured with
scratch scripts that build each upload, then read it in a fresh process
(`exceljs` alone, peak RSS sampled every 5 ms over the RSS before the read) and
send it through both routes (`createApp` with a spy reader and a fake model,
one vitest run per upload and route). What `exceljs` costs is 20 to 27 MB of
memory per MiB of cells: read alone, 100 numeric columns cost +37 MB at 1 MiB
inflated, +98 at 4, +188 at 8 and +287 at 15; 3 columns +42, +109, +231 and
+321 MB; a shared-strings table of 1, 4, 8 and 15 MiB with one cell +25, +34,
+56 and +94 MB. The gate's "about twice" was gate 4's whitespace. The ledger's
container is limited to 512 MB (`compose.ledger.prod.yaml`), and the process
measured near 100 MB before each read.

| Upload (the gate's four, then under the new bound) | At 16 MiB, no entry bound (describe / confirm)                 | At 4 MiB and 1,000 entries (describe / confirm)    |
| -------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| 100 columns, 15.0 MiB, 1,680,107 bytes             | 413 `cells`: 2,352 / 2,305 ms, +301 / +295 MB                  | 413 `inflated`, reader 0: 69 / 69 ms, +17 / +15 MB |
| 3 columns, 15.0 MiB, 1,699,024 bytes               | 413 `rows`: 2,483 / 2,662 ms, +335 / +326 MB                   | 413 `inflated`, reader 0: 60 / 69 ms, +15 / +15 MB |
| 44,016 one-byte entries, 3,988,180 bytes           | 200 (the model called) / 422: 8,388 / 9,979 ms, +188 / +184 MB | 413 `entries`, reader 0: 84 / 84 ms, +32 / +31 MB  |
| 15 MiB `sharedStrings.xml`, one cell               | 200 (the model called) / 422: 1,125 / 1,101 ms, +99 / +102 MB  | 413 `inflated`, reader 0: 60 / 68 ms, +16 / +15 MB |
| 100 columns, 4,186,894 bytes inflated              | 200 / 422: 731 / 788 ms, +100 / +99 MB                         | 200 / 422: 1,108 / 696 ms, +104 / +99 MB           |
| 3 columns, 4,188,200 inflated                      | 413 `rows`: 769 / 672 ms, +108 / +109 MB                       | 413 `rows`: 662 / 672 ms, +109 / +108 MB           |
| `sharedStrings.xml`, 4,188,216 inflated            | 200 / 422: 373 / 367 ms, +25 / +22 MB                          | 200 / 422: 393 / 475 ms, +22 / +23 MB              |
| 15,000 rows laid out as `lg37`, 4,114,119 inflated | 200 / 422: 708 / 683 ms, +73 / +85 MB                          | 200 / 422: 727 / 707 ms, +71 / +86 MB              |
| 1,000 entries                                      | 200 / 422: 288 / 319 ms, +33 / +36 MB                          | 200 / 422: 331 / 321 ms, +36 / +38 MB              |
| 1,001 entries                                      | 200 / 422: 304 / 323 ms, +35 / +36 MB                          | 413 `entries`, reader 0: 39 / 57 ms, +3 / +3 MB    |

(Confirm's 422 is the fixture's description refused on these files, not a
bound. My 44,000-entry zip holds a real sheet, so at the old bounds it reached
the model where the gate's, with none, read as 0 sheets.)

**Where the 44,000 entries' 8.4 s went:** read apart, the counted inflate took
6,131 ms of it (one inflater per entry, 0.14 ms each) and `exceljs` 1,750 ms
(+165 MB); the directory 29 ms.

**How the constants were sized.** `MAX_WORKBOOK_INFLATED_BYTES` is 4 MiB: a
request at the bound costs about +110 MB, so two people's at once stay inside
the 512 MB container beside the idle process, where 8 MiB would be +460 MB for
two. It still holds a household's workbook with room over: `lg37`, the largest
fixture, inflates to 90,542 bytes (46 times under), and a sheet laid out as
`lg37`'s, written by `exceljs`, takes about 275 bytes a row, so 15,000 rows
(47 times `lg37`'s 320) fit, at +71 to +86 MB. A real file saved by Excel
carries more per cell and styles of its own, which nothing here measures.
`MAX_WORKBOOK_ENTRIES` is 1,000: the six fixtures hold 17 to 24 entries, and a
workbook at the sheets bound with a chart and a comment on every sheet holds
about 400 by the parts Excel writes for each (a reckoning, not a measurement);
1,000 cost 0.3 s through the route. Over it is `WORKBOOK_TOO_LARGE` with
`details.bound` `entries`, checked from the end record before the directory is
walked. The bounds list in the build's entry above (16 MiB) is superseded by
this one. Decision 1 carries a dated note with the same figures; the owner's
answer there is unchanged. The test that compared the fixtures with the bound
now reads `MAX_WORKBOOK_INFLATED_BYTES / 40` (it was `/ 100`, which `lg37` is
over at 4 MiB).

New tests: `workbook-describe.test.ts` › "the zip's entries, counted before
anything is inflated" › "a workbook of more entries than the bound is refused
before the inflate and the sheet reader" (both routes, inflate spy empty, reader
0, model 0), and `workbook-zip.test.ts` › "the number of entries" (exactly the
bound is read; one more is refused naming `entries`).

**F1 (med): fixed, one test per guard**, in a new
`api/test/workbook-zip.test.ts` over a zip written byte by byte (`rawZip` in
`api/test/helpers/xlsx-file.ts`), with a control that reads the same zip
unbroken, plus the gate's stored-overlap zip through both routes in
`workbook-describe.test.ts` › "stored entries, counted before the sheet reader"
(413 `inflated`, reader 0, model 0). Sweeping the file's other checks the
same way found three more that no test reached (a central header's signature,
an entry's name running past the directory, an entry's bytes running past the
file): each now has a test, S8 to S10 below. Each guard deleted in turn at `696e0cbd`,
the five specs `workbook-zip`, `workbook-describe` (less the 200 MiB case),
`isolation`, `xlsx` and `workbook-import` run, the file restored from that
commit:

| Guard deleted (`workbook-zip.ts` unless named)                                                      | Result at `696e0cbd`  | Tests that went red                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none (the control)                                                                                  | 100 passed, 1 skipped | none                                                                                                                                                                        |
| S1 a stored entry counted (`total += size`)                                                         | 2 failed              | "stored entries are counted too" › "forty directory entries over one stored entry…"; "stored entries, counted before the sheet reader" › "…refused before the sheet reader" |
| S2 encrypted or a method other than 0 and 8                                                         | 2 failed              | "an entry encrypted (flag bit 0)…", "an entry compressed by a method exceljs does not read (12, bzip2)…"                                                                    |
| S3 the three zip64 sentinels in an entry                                                            | 3 failed              | "a zip64 sentinel in an entry's compressed size / uncompressed size / local header's offset…"                                                                               |
| S4 an inflate error turned into a resolve                                                           | 1 failed              | "a deflated entry that will not inflate is not an .xlsx"                                                                                                                    |
| S5 the split-disk and count checks                                                                  | 4 failed              | "an end record where this disk's number is not 0 / the directory's disk is not 0 / the entries on this disk are not all of them / the count is zip64's 0xffff…"             |
| S6 the directory's window                                                                           | 3 failed              | "an end record where the directory's offset is zip64's 0xffffffff / the directory's size is zip64's 0xffffffff / the directory runs into the end record…"                   |
| S7 the local header's signature and room                                                            | 2 failed              | "an entry whose local header has no signature…", "…would start past the file's last 30 bytes…"                                                                              |
| S8 a central header's signature (not in the gate's list)                                            | 1 failed              | "a directory entry whose signature is not a central header's is not an .xlsx"                                                                                               |
| S9 an entry's name past the directory (not in the gate's list)                                      | 1 failed              | "a directory entry whose name runs past the directory is not an .xlsx"                                                                                                      |
| S10 an entry's bytes past the file (not in the gate's list)                                         | 1 failed              | "an entry whose compressed bytes run past the end of the file is not an .xlsx"                                                                                              |
| F3 a stored entry counted whole again                                                               | 2 failed              | the two S1 tests                                                                                                                                                            |
| F2 the entries bound                                                                                | 2 failed              | "a workbook of more entries than the bound is refused before the inflate and the sheet reader"; "one entry more is refused as too large…"                                   |
| F5 `describeWorkbook`'s consent branch (`workbook-describe.ts`)                                     | 1 failed              | "a request without the consent field"                                                                                                                                       |
| F4 the gate's plant 3, the other household's names appended to the request (`workbook-describe.ts`) | 1 failed              | `isolation.test.ts` › "each household reads its own records through every read route, and nothing of the other's"                                                           |

**F3 (low): fixed in the code rather than the text.** A stored entry is now
counted a chunk of `INFLATE_CHUNK_BYTES` at a time, so the stop overshoots by
one chunk whichever kind of entry it falls in, as the header says. Red before
the fix: `workbook-zip.test.ts` › "stored entries are counted too" read
`expected 1200312 to be less than or equal to 1064960` (forty names over one
block of 300,000 bytes, a bound of 1 MiB); green after. The block is not a
divisor of the bound on purpose: a first try with 64 KiB blocks passed before
the fix, because sixteen of them plus the two small entries crossed the bound
by 312 bytes.

**F4 (low): fixed.** The sweep's describer keeps every request it is shown, and
the describe step reads the one its request made: the caller's word in it, and
none of the other household's marks. The prompt is cut off first: it says
"samples", which holds home's mark `sam`. The gate's plant 3 (the other
household's names appended to the request) now goes red: `expected [ 'Chalet',
'kim', 'alex@away.test' ] to deeply equal []`.

**F5 (low): kept the branch, and a test reads its sentence.** The branch is the
one place a request without consent is told why and that nothing was sent
("The workbook's samples are sent only when you agree to send them. Nothing was
sent."); without it the schema answers "Choose a workbook to send.", which says
neither. `workbook-describe.test.ts` › "a request without the consent field"
now asserts the sentence for an omitted field, `false`, `"yes"` and `null`.
With the branch deleted it goes red (`expected { code: 'BAD_REQUEST', …(2) } to
match object { code: 'BAD_REQUEST', …(1) }`), where gate 1's mutant survived.

**F6 (low): fixed in the wording.** Done when 6 counts the seven bounds the code
refuses on (bytes, the zip's entries, inflated size, sheets, rows, cells, the
request's estimate) with the superseded line beside it; Build 3.3 gains the
entries bullet, marked as answer B's; Decision 1's "sixth bound" is corrected
in a dated note under it, the option text left as it was put.

**F7 (low): fixed.** `e2e/layout.spec.ts`'s `CARDS` lists `"Import (read)": 3`
(the date column, the bucket labels, the checks). With it at 4 the spec read
1 failed, 12 passed, "Import (read) at 360 px: the cards … Expected: >= 4,
Received: 3" and the same at 1280 px; at 3, 13 passed (`E2E_PORT=8167 npx
playwright test -c tools/ledger/playwright.config.ts
tools/ledger/e2e/layout.spec.ts`).

**Memory of the large tests**, peak resident memory of the vitest worker
(`VmHWM` sampled every 20 ms, one test alone): the 200 MiB padding 196 MB (197
in the build), the stored-overlap zip 217 MB, the zip over the entries bound 209 MB,
against 193 MB for "a request with no key configured" from the same file; the
whole of `workbook-zip.test.ts` 101 MB.

### 2026-10-26 — round 2: gate 2 returned FAIL at `5db37436`; the owner's answers

Gate 2 (narrow, on PR #670, `e02ec781..5db37436`) returned FAIL: one high, F2
fixed in part (a zip whose end record states fewer entries than its directory
holds is read by `exceljs` past every bound), and F1 fixed in part (two clauses
of `workbook-zip.ts` no test reaches). F3 to F7 it graded fixed.

**The owner's answers, 2026-10-26**, put by the orchestrator. The options are as
they were put; the one chosen is marked.

1. **The remedy for the high.** Options: (a) the directory must fill exactly,
   the walk ending where the directory ends and the directory ending where the
   end record starts (gate 2's recommendation); (b) walk the directory as
   `jszip` does and cap the walked count. **Chosen: (a).** One test per input:
   an understated count with a padded sheet (gate 2's D1), 44,000 entries with
   a count of 2 (D2), and a directory placed before the end record's stated
   position, each refused with the sheet reader at 0 and each red with the line
   removed. The three sentences gate 2 names as false are corrected
   (`workbook-zip.ts`'s header; Build 3.3's "whatever the zip declared", by a
   marked note; Decision 1's dated note). A zip from a writer other than
   `exceljs`, if one is at hand without an install, is checked to still read.
2. **The round's scope.** Options: resume the builder with everything
   (recommended); a fresh fixer with the fix and the merge only. **Chosen:
   resume, all in**: the two surviving F1 clauses get tests too (the gap case
   of the walk's `at + 46 > offset + size`, and a test that the entries cap
   refuses before the directory is walked), each red under its mutant.
3. **`main` moved**: #669 (lg-71) merged as `be8d9c0e`. Merged into this branch
   (a merge, not a rebase), keeping both sides of the overlapping files. The
   merge was clean.
