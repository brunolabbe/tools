---
id: lg-8
tool: ledger
title: Photograph a receipt, read it locally or with a model, confirm, and file it
kind: work-package
status: ready
milestone: P4
depends_on: [lg-3, lg-6]
difficulty: hard
---

# lg-8 — Photograph a receipt, read it locally or with a model, confirm, and file it

**Packages:** a new `tools/ledger/receipts`, scoped `@ledger/receipts` — the
receipt readers, and the only package that talks to a model.

## Why

Receipts arrive both ways: on a personal card they are period lines, and on the
joint account's card they document a row that is already stored
([00-ANALYSIS.md §6](../00-ANALYSIS.md)). A local OCR engine reads first, a model
only when needed, and a person confirms before anything is filed.

**Reads the total only.** Reading line items, taking out what is not shared,
and categorising are
[lg-10](./lg-10-receipt-items-exclusions-and-categories.md), which builds on
this ticket's seam.

## Build

1. **Measure before building the router.** This follows the owner's decision
   in analysis §6, _Who reads the receipt_.
   - Ask the owner for 10–20 real receipt photos. They stay in a directory
     **outside the repository**, and nothing about their content is committed.
   - Run each photo through `ppu-paddle-ocr`, `tesseract.js` (with `fra`), and
     a Claude model, on the machine the tool deploys to. Before choosing a
     model id, load the `claude-api` skill rather than working from memory.
     The Claude runs cost well under a dollar of Console credits, which a Max
     plan does not cover, so confirm the key is funded first.
   - Record per engine, against the printed receipt:
     - whether subtotal, GST, QST and total are right;
     - whether each item's price is right;
     - whether each taxable flag is right;
     - whether the deposits are right;
     - seconds per receipt, and cost.
   - Put the aggregate table on this ticket's Log, never the receipts, and
     bring it to the owner as a decision with options.
2. **`receipts`: one `ReceiptReader` seam, with two implementations.**
   - **Local:** `ppu-paddle-ocr`, or whichever engine the measurement picks.
     Its text goes through a Québec receipt parser, which is pure and belongs
     in `books`. The parser finds subtotal, taxes and total by keyword, and
     handles comma decimals and `O`/`0`, `l`/`1` confusions.
   - **Model:** takes its provider and model id as arguments, and `api` reads
     the key. A tool never imports another tool, so this does **not** reuse
     the planner's provider.
   - Both return `{ merchant, date, subtotal, gst, qst, total }` in cents, each
     field `null` when not read. Never `scribe.js-ocr` (AGPL) or `ocrad.js`.
3. **Routing, pending the measurement:**
   - local first;
   - if the arithmetic check fails, offer the model;
   - lg-10 adds calling the model when the person wants items or categories.
     Every call to the model is a visible step, the screen names where the photo
     goes, and nothing is sent silently.
4. **No reader classifies, computes a share or files anything.** Its output is
   a proposal the person edits.
5. `api`: upload a photo, and get the proposal back.
   - Store the image on the data volume, keyed by id. Never log it and never
     store it in a path taken from the request.
   - Cap the size.
   - Accept only image types, checked by content, not by extension.
6. **Filing:**
   - if a stored joint-account row matches the amount within a few days, offer
     it, and on confirmation attach the receipt to it;
   - otherwise it becomes a line in the open period for **the Access identity
     that uploaded it** (lg-3).
7. `web`, mobile first: the camera button, the proposal as an editable form,
   the match offer, filing, and the "read it with the model" step, which says
   the photo will leave the house.
8. **Tests never call a real model, and never run OCR on a real receipt.** A
   fake reader returns fixture proposals. The parser is tested on synthetic OCR
   text, including misread digits.

## Done when

1. The measurement table is on the Log, and the owner's choice of engine is
   recorded beside it.
2. A fake-reader proposal, edited and confirmed, becomes a period line for the
   uploading person.
3. A proposal matching a stored joint-account row is offered as a match, and
   confirming it attaches the receipt without creating a period line.
4. The parser reads synthetic OCR text into subtotal, GST, QST and total, and
   flags a receipt whose parts do not add up, including one with an `O`
   misread for `0`.
5. The model is never called without the person asking. An API test proves it.
6. A non-image upload and an oversized upload are both refused.
7. Nothing is filed without a confirmation. An API test proves it.
8. Gates green.

## Log
