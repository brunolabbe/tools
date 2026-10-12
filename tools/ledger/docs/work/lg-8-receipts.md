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
