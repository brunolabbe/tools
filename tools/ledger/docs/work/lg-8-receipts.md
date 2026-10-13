---
id: lg-8
tool: ledger
title: Photograph a receipt, read it with a model, confirm, and file it
kind: work-package
status: ready
milestone: P4
depends_on: [lg-3, lg-6]
difficulty: hard
---

# lg-8 — Photograph a receipt, read it with a model, confirm, and file it

**Packages:** a new `tools/ledger/receipts`, scoped `@ledger/receipts` — the
receipt reader, and the only package that talks to a model.

## Why

Receipts arrive both ways: on a personal card they are period lines, and on the
joint account's card they document a row that is already stored
([00-ANALYSIS.md §6](../00-ANALYSIS.md)). A model reads the photo when the
person asks it to, and a person confirms before anything is filed.

**Reads the total only.** Reading line items, taking out what is not shared,
and categorising are
[lg-10](./lg-10-receipt-items-exclusions-and-categories.md), which builds on
this ticket's seam.

## Build

1. **Measured — done 2026-10-12.** Fourteen real photos went through
   `ppu-paddle-ocr`, `tesseract.js` and two Claude models. The table and the
   owner's choice are on the Log: **Claude Haiku 5.5 alone, no local OCR.**
2. **`receipts`: one `ReceiptReader` seam, one implementation, the model.**
   - It takes its provider and model id as arguments, with `claude-haiku-5-5`
     as the default, and `api` reads the key. A tool never imports another
     tool, so this does **not** reuse the planner's provider. Load the
     `claude-api` skill before writing the call, rather than working from
     memory.
   - It returns a **list** of proposals, because one measured photo held two
     receipts side by side. Each is `{ merchant, date, subtotal, gst, qst,
total }` in cents, each field `null` when not read.
   - The photo goes as sent. The models read rotated photos without help, so
     there is no rotation step.
3. **The arithmetic check is pure and lives in `books`.** It checks subtotal +
   GST + QST = total, GST at 5 % and QST at 9.975 % of the taxable part, to the
   cent. It flags a proposal and never corrects one. A receipt with no tax
   lines, which is the measured case for zero-rated groceries, passes when
   subtotal equals total.
4. **Reading is a step the person takes.**
   - The screen names where the photo goes before it is sent, and nothing is
     sent silently.
   - The person can always type the proposal by hand instead, and the model is
     never called for that.
   - lg-10 extends this same call to items and categories.
5. **No reader classifies, computes a share or files anything.** Its output is
   a proposal the person edits.
6. `api`: upload a photo, and get the proposal back.
   - Store the image on the data volume, keyed by id. Never log it and never
     store it in a path taken from the request.
   - Cap the size.
   - Accept only image types, checked by content, not by extension.
7. **Filing:**
   - if a stored joint-account row matches the amount within a few days, offer
     it, and on confirmation attach the receipt to it;
   - otherwise it becomes a line in the open period for **the Access identity
     that uploaded it** (lg-3).
   - The measurement found two things filing must survive. A tip printed under
     the total (one receipt) makes the card charge differ from the total. A
     date missing from the photo (three of thirteen) means the proposal's date
     is `null`, and the form starts it at the upload date.
8. `web`, mobile first: the camera button, the "read it" step, which says the
   photo will leave the house, the proposal as an editable form, the match
   offer, and filing.
9. **Tests never call a real model.** A fake reader returns fixture proposals.
   The arithmetic check is tested on synthetic proposals.

## Done when

1. The measurement table is on the Log, and the owner's choice of engine is
   recorded beside it.
2. A fake-reader proposal, edited and confirmed, becomes a period line for the
   uploading person.
3. A proposal matching a stored joint-account row is offered as a match, and
   confirming it attaches the receipt without creating a period line.
4. The arithmetic check passes a proposal whose parts add up, and flags one a
   cent off, one with a wrong tax, and one with a `null` field.
5. The model is never called without the person asking. An API test proves it.
6. A non-image upload and an oversized upload are both refused.
7. Nothing is filed without a confirmation. An API test proves it.
8. Gates green.

## Log

### 2026-10-12 — the measurement, and the owner's choice

**The set.** There were 14 photos, taken by the owner. Twelve held 13 printed
receipts from grocers, hardware and electronics stores and a small shop,
including one refund and one too faded to name. One of those photos held
two receipts, and one was a second, rotated shot of another. The other two
photos were handwritten notes of 11 amounts. Ten of the photos were sideways
and none carried an EXIF rotation. The photos, the transcription, the harness
and every engine's raw output are in `~/ledger-receipts-lg8/` on the dev box,
**outside the repository**. Nothing here names an item or an amount from them.

**What counts as right.** Every receipt was transcribed by hand from upright,
full-resolution crops. Each transcription adds up from items and deposits to
the subtotal, and from the subtotal and taxes to the total. Two values are not
on the paper: one GST is too faded to read and was derived from the
arithmetic, and two items are struck through in pen.

**How each engine ran.**

- The local engines tried 0°, 90° and 270° and kept the most confident
  orientation. A throwaway keyword parser read their totals, and it tolerates
  `O`/`0`, `PARIIEL` and `TUQ`.
- For the local engines, "item prices" means the price appears in the OCR
  text, which is an upper bound for a parser that would still need writing.
- The models ran as Claude Code subagents, one photo each, on the
  1568-pixel image the API would receive, with the same prompt and schema as
  the API harness. **No API key was used, by the owner's choice.** Their cost
  is therefore estimated from tokens: 2,469 for the image and about 330 for the
  prompt in, about 140 out, with up to three times that out for thinking.

| Engine                | All four right | Subtotal | GST   | QST   | Total | Wrong but adds up | Item prices | Invented items | Tax flags | Deposits | Handwritten | Seconds per receipt        | Cost per receipt      |
| --------------------- | -------------- | -------- | ----- | ----- | ----- | ----------------- | ----------- | -------------- | --------- | -------- | ----------- | -------------------------- | --------------------- |
| PaddleOCR v6 tiny     | 9/13           | 10/13    | 10/13 | 9/13  | 10/13 | 0                 | 60/64       | n/a            | 59/64     | 5/5      | 1/11        | 1.3 upright (4.6 trying 3) | 0                     |
| PaddleOCR v6 small    | 7/13           | 9/13     | 8/13  | 9/13  | 8/13  | 0                 | 60/64       | n/a            | 57/64     | 5/5      | 2/11        | 3.8 upright (9.6 trying 3) | 0                     |
| tesseract.js 6, `fra` | 0/13           | 6/13     | 7/13  | 5/13  | 4/13  | 0                 | 36/64       | n/a            | 35/64     | 4/5      | 0/11        | 3–22 trying 3, under load  | 0                     |
| Claude Haiku 5.5      | 13/13          | 13/13    | 13/13 | 13/13 | 13/13 | 0                 | 62/64       | 0              | 62/64     | 5/5      | 10/11       | not measured (no API)      | ≈ $0.0004–0.0005, est |
| Claude Sonnet 5.5     | 13/13          | 13/13    | 13/13 | 13/13 | 13/13 | 0                 | 64/64       | 1              | 62/64     | 5/5      | 8/11        | not measured (no API)      | ≈ $0.007–0.010, est   |

- **"Wrong but adds up" is zero for every engine.** Every misread failed the
  arithmetic check, so the check is the safety net whichever engine reads.
- **The seconds are medians from the dev box** (Ryzen 5 3600, 12 threads), not
  the deploy machine. They were taken on a second pass started at load 2.9,
  but the OCR's own threads pushed the load to 9–21 while it ran. Tesseract's
  figure is from the first pass, at load 26.
- **Local OCR carries weight.** It adds 45 MB of onnxruntime for linux-x64 (the
  npm package ships 288 MB, every platform) and 6–37 MB of model files.

**What went wrong, per engine.**

- **PaddleOCR tiny** misread both receipts in the two-receipt photo, which a
  single-text parser cannot split. It also missed every item on the faded
  receipt, and on a blurred receipt it set the tax values one line
  below their labels.
- **Haiku** returned no items for the faded receipt, though it read all four
  totals. It left the two pen-struck items out. In both cases the items no
  longer summed to the subtotal, which lg-10's reconciliation catches. It
  also read a crossed-out amount on a handwritten note.
- **Sonnet** invented an item on the longest receipt, so the items no longer
  summed to the subtotal, which reconciliation also catches. It gave the
  faded receipt's two items plausible names that are not on the paper, and
  read a grocer's `*` promotion mark as a tax flag. It inferred the struck items'
  prices from the arithmetic, correctly.
- **Both models** read the two-receipt photo as two receipts, and the refund
  as negative. Neither was ever wrong on a printed total or tax.

**Decided by the owner, 2026-10-12: Claude Haiku 5.5 alone, with no local
OCR.** The options put were:

- Haiku alone, the one chosen;
- the hybrid as first written, with PaddleOCR tiny first and Haiku when the
  arithmetic fails or items are wanted;
- Sonnet alone.

The reasons that decided it:

- Haiku matched Sonnet on totals, at about a twentieth of the price: about 5¢
  per 100 receipts.
- lg-10 reads items line by line, so most grocery receipts would reach the
  model anyway.
- The local path would have added a runtime, a parser and a second code path.

**Also decided: the estimates stand.** The owner chose to accept the
subagent-based cost estimate rather than add a live API run to Done-when.
Seconds per model read remain unmeasured until the reader is built.

**Brief corrections made with this entry.**

- Build steps 2–3 dropped the local implementation, the parser and the
  routing.
- The reader returns a list, because of the two-receipt photo.
- Filing must survive a tip and a missing date.
- Done-when 4 now tests the arithmetic check, not an OCR parser.
- The same decision is recorded in analysis §6 and the roadmap. lg-10's step 1
  no longer says the model is called only for items.

### 2026-10-13 — built: the reader, the check, three routes and a screen

**What was built.**

- `receipts`: `createModelReader({ provider: "anthropic", apiKey, model })`,
  `claude-haiku-5-5` by default, behind the `ReceiptReader` seam. It sends the
  photo as uploaded, with the measured harness's prompt less the items, the
  deposits and the handwritten amounts, and the schema as
  `output_config.format`. It validates the answer itself, and refuses a
  refusal, a reading cut short, and anything that is not a reading, as
  `RECEIPT_UNREADABLE`. It reads no environment.
- `books`: `checkReceipt`, which flags and never corrects, and `matchReceipt`,
  the rows for exactly the charge within `RECEIPT_MATCH_DAYS` (5) either way.
- `api`: `POST /api/receipts` keeps the photo and reads nothing; only
  `POST /api/receipts/:id/read` calls the reader; `GET …/matches` offers rows;
  `POST …/file` is the confirmation and the only write to the books. Migration 8
  adds `receipts` and `receipt_filings`. Photos are files at
  `<data>/receipts/<household>/<uuid>.<ext>`.
- `web`: a Receipt tab. The model is named beside "Read it", with the sentence
  that the photo leaves the house.

**How a receipt files into lg-21's per-household books.** The code left one
answer: every step runs on `booksOf(request)`, the caller's household's books.
The photo goes in that household's directory, which `personOf(request)`
names. The isolation sweep now takes all four routes, and it compares each
household's photo directory with the photos its own receipts name. With the
household hard-coded to `home` in `routes/receipts.ts`, that comparison fails
(`npx vitest run tools/ledger/api/test/isolation.test.ts` → 1 failed, "home's
photos are …, away's photos are ,"). Every read still passed, since every
photo's name is new.

**The key.** `ANTHROPIC_API_KEY`, read in `api/src/config.ts`
(`loadReceiptReaderConfig`) and passed to the reader. With none set, a read is
refused as `RECEIPT_READER_UNCONFIGURED` (503) and typing still files. No
checked-in compose file names it. It reaches the container the way the
planner's does, through a host-only override file. `docs/02-DEPLOYMENT.md`
gained a "Reading receipts with a model" section, in place of the sentence
that promised one. `ANTHROPIC_CUSTOM_HEADERS` beside a key refuses to boot,
as it does for the planner.

**Done-when, with the test that proves each.**

1. The measurement table and the owner's choice are on this Log (2026-10-12).
2. `api/test/receipts.test.ts`, "a read proposal, edited and confirmed, becomes
   a period line for whoever uploaded it". Sam confirms Alex's receipt with a
   tip, and the line is Alex's, `source = 'receipt'`, entered by Sam.
3. Same file, "a proposal matching a stored joint-account row is offered, and
   confirming it attaches the receipt and adds no line".
4. `books/test/receipts.test.ts`: "passes a proposal whose parts add up…",
   "flags a total a cent off", "flags a wrong tax, even when the parts still
   add up", and "flags %s not read, and guesses nothing" (three cases).
5. `api/test/receipts.test.ts`, "reaches the model only when the person asks…".
   The counting reader stays at 0 calls through the upload and the matches,
   and reaches 1 on the read.
6. Same file, "refuses %s as RECEIPT_NOT_AN_IMAGE…" (four cases) and "refuses
   a photo over the cap…". Setting the route's `bodyLimit` to 1 MiB fails "takes
   a photo past the 1 MiB…" (1 of 24); dropping the byte check fails 4 of 24.
7. Same file, "files nothing: a read proposal waits for the person", and the
   first upload test.

**Measured.**

- `npx vitest run` on the four new receipt suites, one file at a time: 18 of 18
  (`books`), 15 of 15 (`receipts`), 24 of 24 (`api`), and 8 of 8 (`web`).
- `npm test -- --project ledger`: 56 files, 978 of 978.
- `npx vitest run packages/core/test/image-closure.test.ts`: 7 of 7. With the
  runtime `receipts/dist` line deleted from the `Dockerfile`, it fails 1 of 7,
  naming that line.

**What the brief had wrong, or left open.**

- **The upload answers with the model**, as `reader` (`UploadedReceipt`). The
  screen has to name where the photo goes before it is sent, and only the API
  knows which model reads, or whether one does.
- **A handwritten note gives no proposal.** The measured prompt listed its
  amounts, but a note is not a receipt, and there is no total to propose. The
  person types it in. lg-10 can add `handwritten_amounts` back if wanted.
- **The check flags; it does not block filing.** Step 3 says it "flags a
  proposal and never corrects one". A typed receipt with no subtotal, or a
  note, would otherwise be impossible to file. This is put to the owner as an
  open decision in the builder's report.
- **"Within a few days" is 5 days either way** (`RECEIPT_MATCH_DAYS`), and the
  match is on the amount charged, which the form starts at the total. A tip
  changes the charge, and the person edits it there.
- **A row a receipt already documents is not offered again.** A receipt is
  filed once (`RECEIPT_ALREADY_FILED`, 409).
- **Five error codes arrived:** `RECEIPT_NOT_AN_IMAGE` (415),
  `RECEIPT_NOT_FOUND` (404), `RECEIPT_ALREADY_FILED` (409),
  `RECEIPT_READER_UNCONFIGURED` (503) and `RECEIPT_UNREADABLE` (422). A model
  that is busy or unreachable answers core's `UNREACHABLE`, and a key the API
  refuses answers `INTERNAL`, with its status logged.
- **Seconds per read are still unmeasured**: no key was used here either, and
  no test reaches a model.
- **The photo is never served back**, and there is no list of receipts not yet
  filed. Neither is in the brief. An unfiled receipt is a kept photo, and the
  person takes it again.

**Fold-ins.** None was free. lg-10 extends this reader and is left to its own
ticket, as the dispatch said.

### 2026-10-13 — the owner's answers, and gate 1's findings repaired

**Decided by the owner, 2026-10-13.**

1. _Can a proposal the check flags be filed once the person confirms it?_ The
   options were that the flags stay advisory, or that filing is blocked until
   nothing is flagged. **Chosen: advisory, fileable once the person confirms.**
   The builder recommended this. A typed receipt with no subtotal, or a note,
   could not be filed otherwise.
2. _Gate 1, F2: a photo of two receipts could file only one._ The options were:
   - (A) one filing per proposal, by changing `receipt_filings` while migration
     8 is unmerged;
   - (B) one filing per photo, with the filed screen saying another receipt is
     in it;
   - (C) recording it on lg-10.

   **Chosen: (A).** The gate recommended it.

3. _Gate 1, F3 and F4, both low._ The options were to fix them now or to leave
   them recorded, which is the severity floor's default. **Chosen: fix both
   in this round.** The orchestrator recommended it.

**What changed.** Each new test failed before its change and passes after it.

- **F2.** A filing names its `part`, the receipt's place in the photo from 1,
  up to `MAX_RECEIPTS_PER_PHOTO` (10). Each part is filed once, as
  `UNIQUE (receipt_id, part)`. After one is filed, the screen goes back to the
  others, and "Type another receipt from this photo" files the next part by
  hand.
  - Red: the API test "files each receipt the photo holds, each once" failed,
    with every `part` refused by the old schema (13 of 31 red). The web test
    "files each receipt in a photo of two…", run against the committed screen,
    failed with `Unable to find role="button" and name "Marché Exemple, 26.50 $"`
    (4 of 9 red).
- **F3.** `receipt_filings_row` is now a partial unique index, and attaching a
  receipt to a row that already has one is refused as the new
  `ROW_ALREADY_DOCUMENTED` (409).
  - Red: with the index alone the API answered `500`, and without it `200`.
- **F4.** A receipt read takes a bucket of its own, five a minute a person
  (`RATE_LIMIT_RECEIPT_READS_PER_MINUTE`), and a receipt with anything filed
  from it is refused a read as `RECEIPT_ALREADY_FILED`. The route also passes
  the request's signal to `reader.read`, aborted when the response closes
  unsent. That was three lines, so it is in.
  - Red: the bucket test got `[200, 200, 200, 200, 200, 200]`. The filed test
    got `200`. The signal test got `expected undefined to be an instance of
AbortSignal`.
  - With the abort call removed, the signal test still fails:
    `expected false to be true`.
- **F1.** "filing as a line and onto a row calls no reader" files both ways
  and asserts no call. With the gate's mutation, a `reader.read` call at the
  top of the file handler, it fails with `expected 2 to be +0`.
- **F6.** The ledger's vitest project clears every `ANTHROPIC_*` variable and
  `RECEIPT_MODEL` before each file (`api/test/helpers/no-model-environment.ts`,
  from `setupFiles` in the root `vitest.config.ts`). Twelve test files build an
  app directly, so a helper would not have reached them all.
  - Red: with both variables set, `npx vitest run --project ledger
tools/ledger/api` gave 17 of 28 files and 332 of 525 tests failed.
  - After: 28 of 28 files, 525 of 525 tests.
- **F7.** "never the photo, and never the key" now builds the real reader from
  a configured key against a `401` that quotes the key back. It asserts that
  the key, `sk-ant` and the photo are absent from a non-empty log.
  - Red: adding `message: error.message` to the reader's failure log line fails
    it, with `not to contain 'KEY-MARKER'`.

**Left recorded, unfixed, as the dispatch said:** F5, the photos accumulating
with no cap, and F8, a provider `400` or `408` answering `INTERNAL`.

**What the first entry said that is no longer so.** "A receipt is filed once"
now means once per part. A row a receipt documents is refused a second one,
where before it was only left out of the offers.

### 2026-10-13 — gate 2's four lows, fixed at landing

**Decided by the owner, 2026-10-13.** _Gate 2 passed with four lows, N1–N4.
Should they be fixed?_ The options were to apply them at landing with no
re-gate, or to leave them recorded. **Chosen: apply them at landing, with no
re-gate.** The orchestrator recommended it.

- **N1 — the server does not know how many receipts a photo holds.** _Fixed at
  landing._ The contract's comment on `ReceiptFiling` now says that "once" is
  per part. It also says the part is the person's word, since a read stores
  nothing, and that storing the count would buy nothing.
- **N2 — a reader can propose more receipts than can be filed.** _Fixed at
  landing._ The read route answers at most `MAX_RECEIPTS_PER_PHOTO` (10)
  proposals.
  - Red: "answers no more proposals than a photo can file", with a fake reader
    returning 11, failed with `expected [ …(11) ] to have a length of 10 but
got 11`.
- **N3 — nothing asserts the unique index on `row_id`.** _Fixed at landing._
  `api/test/schema.test.ts` now has "refuse a second filing on a row a receipt
  already documents", which inserts two filings for one row.
  - Red: with a plain index in place of the unique one, it failed with
    `expected [Function] to throw an error`.
- **N4 — stale words on `RECEIPT_ALREADY_FILED`.** _Fixed at landing._ Its
  comment and its default message now speak of one receipt in the photo being
  filed, and of a read refused for a photo with one filed.
