---
id: lg-8
tool: ledger
title: Photograph a receipt, confirm what a model read, and file it
kind: work-package
status: ready
milestone: P4
depends_on: [lg-3, lg-6]
difficulty: hard
---

# lg-8 — Photograph a receipt, confirm what a model read, and file it

**Packages:** a new `tools/ledger/receipts`, scoped `@ledger/receipts` — the only
package that talks to a model.

## Why

Receipts arrive both ways: on a personal card they are period lines, and on the
joint account's card they document a row that is already stored
([00-ANALYSIS.md §6](../00-ANALYSIS.md)). A model does the reading, and a person
confirms before anything is filed.

**Reads the total only.** Reading line items, taking out what is not shared,
and categorising are
[lg-10](./lg-10-receipt-items-exclusions-and-categories.md), which builds on
this ticket's seam.

## Build

1. `receipts`: `readReceipt(image, provider)` returns merchant, date, total and
   taxes as cents, each with the model's confidence or `null`.
   - It takes its provider and model as arguments; `api` reads the key.
   - Before choosing a model id, load the `claude-api` skill rather than
     working from memory.
   - A tool never imports another tool, so this does **not** reuse the
     planner's provider. It builds the small seam it needs.
2. **The model never classifies, never computes a share, and never files
   anything.** Its output is a proposal the person edits.
3. `api`: upload a photo, and get the proposal back.
   - Store the image on the data volume, keyed by id. Never log it and never
     store it in a path taken from the request.
   - Cap the size.
   - Accept only image types, checked by content, not by extension.
4. **Filing:**
   - if a stored joint-account row matches the amount within a few days, offer
     it, and on confirmation attach the receipt to it;
   - otherwise it becomes a line in the open period for **the Access identity
     that uploaded it** (lg-3).
5. `web`, mobile first: the camera button, the proposal as an editable form,
   the match offer, and filing. **The capture screen says the photo is sent to
   the model provider.**
6. **The provider is a seam, and tests never call it.** A fake provider returns
   fixture proposals.

## Done when

1. A fake-provider proposal, edited and confirmed, becomes a period line for the
   uploading person.
2. A proposal matching a stored joint-account row is offered as a match, and
   confirming it attaches the receipt without creating a period line.
3. A non-image upload and an oversized upload are both refused.
4. Nothing is filed without a confirmation. An API test proves it.
5. Gates green.

## Log
