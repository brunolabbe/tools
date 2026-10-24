---
id: lg-66
tool: ledger
title: Import a workbook the reader does not know, through a layout Haiku 5.5 describes and the person confirms
kind: work-package
status: needs-decision
milestone: P6
depends_on: [lg-38]
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
- Cost: Haiku shown $0.000998 a run (130 runs); Sonnet 14.4 times that on the
  four fixtures it was run on.

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

## Decision — open

Three questions the owner's answers do not settle. Each changes the Build
below; the Build is written for the recommended option of each, and says what
would change. Rate of the work once answered: `hard`, as filed.

### 1. Where the import runs

lg-7 made the importer "a command and not a route": run by the owner on the
machine that holds the database, with no reason to exist on the network. The
owner's answers say "confirm on screen" and "a confirmation screen".

- **(a) Recommended: a web flow.** A screen where a member of the household
  uploads the file, presses a button that sends samples to the model, reads the
  confirmation and confirms. It matches "on screen", and it is the only reading
  under which a P6 household can import its own file, since it cannot run a
  command on the host. Costs: the tool's first route that takes a spreadsheet
  (a hostile `.xlsx` is parsed by the server, hence Done when 8), a paid,
  rate-limited route, a new screen with its 360 px case, and it reverses
  lg-7's "never a route" for this path (the existing `import:ledger` command
  stays as it is).
- **(b) The existing command.** `import:ledger` gains a flag that asks the
  model, prints the confirmation in the terminal and waits for `y`. No upload,
  no route, no screen, no responsive case. Costs: only whoever runs commands on
  the host can use it, so a household cannot import its own file; "on screen"
  becomes "in the terminal". Under (b) Build steps 3 and 4 and Done when 5 to
  9 are rewritten around the command.

### 2. Which files

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
  are not served.
- **(b) Bank CSVs too, as statement rows.** The described CSV's rows are read
  and stored the way a statement paste stores them (they wait in the inbox,
  unfiled). Costs: a second feature of the same size. The CSV reader now in
  `api/test/layout/csv.ts` moves into `src`, and it does not read decimal
  commas, semicolon delimiters or thousands separators (unmeasured, below).
  What proves a CSV with no balance column, and how its rows are placed against
  rows already stored, are open design.

### 3. What `ignored` means

`ignored` is a list of sheets the contract text calls "read as none of the
above". The reader never consults it: the reading is identical whether it is
empty, holds every sheet, or holds the account sheets themselves (lg-38 gate 1,
low). In the runs, 6 of Haiku's 20 `lg7` answers (four shown, two masked) listed
`Accueil` as ignored and also named it the salaries sheet. The import was the
same as the correct description's. In a build, a description that contradicts
itself drives a real import.

- **(a) Recommended: leave the reader, correct the text.** The schema's
  description says what is true (the list is advisory and is not read). It
  keeps the behaviour that was measured, and the 6 answers keep importing
  correctly. Costs: a self-contradictory answer still passes silently.
- **(b) The schema refuses a layout that names a sheet as ignored and as an
  account, period or salaries sheet.** Costs: the 6 answers above, which
  imported correctly, would have been refused as `invalid`, which the person
  sees as a failed read.
- **(c) The reader honours `ignored`.** Costs: for the same 6 answers the
  salaries sheet is ignored and the salaries read as none. What the import
  then does is unmeasured.

## Build

Written for the recommended option of each decision above. The first commit
records the owner's answers on this page and moves `status` to `ready`, as
`docs/01-TICKETS.md` says, before any source changes.

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
   - Before moving anything, record the sha256 of `layoutRequest` for each of the
     13 fixtures at the base, and pin them afterwards with a test, so a change
     to what is sent is a deliberate edit of a pin.
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
   1. **Describe.** Takes the file and an explicit consent field. Reads the
      sheets, builds the request, makes **one** model call, validates the answer
      with `workbookLayoutSchema`, reads the file through it, and runs
      `importWorkbook` with `commit: false` so that its `report` is what the
      person is shown. Writes nothing. An answer that is not JSON, does not
      validate or stops on `max_tokens` is a typed error, with no retry and no
      second call: the model is called only by the person's explicit action.
   2. **Confirm.** Takes the file and the description again, re-validates the
      description, re-reads the file and runs every verification, and imports
      (`commit: true`) in the one transaction only when all hold. It makes no
      model call. **The server stores nothing of the upload** between the two.
   3. **Bounds**, each a named constant: the upload's bytes, the number of
      sheets, the rows and cells read, the length of a cell's text sent, and the
      request's size. The request's size is counted in the API's tokens, not in
      the four-characters estimate: lg-38's Log found the API's count at 2.2 to
      2.3 times that estimate. The builder states each value and the arithmetic
      for the largest request the bounds allow. The route has its own
      rate-limit bucket, per person, as the receipt reader's paid route has.
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
   base. The Log gives the 13 hashes.
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
6. The fake is called once per describe request, and zero times for a request
   without the consent field, for a request with no key configured, for any
   file over a bound (one test per bound of Build 3.3), and for a confirm
   request. Each refusal is a typed error.
7. The confirm request given `lg37`'s fixture and its correct description
   leaves the books as `import:ledger --write` on the same workbook leaves them
   (the same movements and the same report figures); given a description that
   fails the verifications (the pinned wrong description of `lg37` with amount
   and balance swapped, outcome `refused`), it refuses, and the books are
   unchanged.
8. The server refuses an upload over each bound of Build 3.3 before it parses
   the workbook or sends anything, with a test per bound, and logs none of the
   file's content.
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
"Decision — open": where the import runs (a web flow, against lg-7's "never a
route"), which files (workbooks only, because a CSV has no bucket column and
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
