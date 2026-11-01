---
id: lg-88
tool: ledger
title: A merged range costs memory in proportion to its area, past every size bound
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# lg-88 — A merged range costs memory in proportion to its area

## Why

`xlsx.ts` gives every cell a merge covers, other than its first, a `null` place in
its row, as `exceljs` did before lg-84. The cost is the merge's area, not the
file's size, so none of `workbook-zip.ts`'s bounds (bytes, entries, inflated
size) sees it, and the rows-and-cells bound in `workbook-describe.ts` runs only
after the grid is built. Found by lg-87's gate; owner chose on 2026-11-01 to file
it rather than fix it in lg-87.

## Reproduction

Measured by lg-87's gate on `14f6fe59` (`mergecost.mts` in that gate's scratch
directory): a 2 513-byte workbook holding one merge, read through `readSheets`.

| Merge       | Memory  | Time   |
| ----------- | ------- | ------ |
| `A1:XFD100` | +76 MB  | 0.23 s |
| `A1:XFD400` | +227 MB | 0.9 s  |

`bac81e33`, before lg-87, cost the same (+226 MB at `A1:XFD400`). Linear in area,
so `A1:XFD1000` is about +570 MB, over the 512 MB the ledger's container has
(`compose.ledger.prod.yaml`) and the 4 MiB inflated bound is sized against.

## Decision — open

**Open: how to bound it.**

1. **Clip a merge's places to the stored cells' extent.** A merge then holds
   places only where the sheet holds something to its right or below. Changes what
   `xlsx.test.ts`'s `a merge past the last stored row holds its places to its own
   end` asserts.
2. **Refuse a workbook whose merges cover more than a cell cap**, before the grid
   is built, as `WORKBOOK_TOO_LARGE` with a new `details.bound`. Keeps the place
   semantics; needs a bound and a contract-adjacent detail value.
3. **Stop giving merged places at all.** Only the first part is a cell; the rest
   are absent. Simplest, and changes row widths for every merged layout, which the
   books' column positions may rely on — unverified.

## Done when

1. The owner's choice is recorded here with its options, and `status` moves on.
2. A merge of `A1:XFD1000` read through the describe route stays under the memory
   the 4 MiB bound was sized for (+110 MB a request), measured.

## Log

- 2026-11-01: filed from lg-87's gate (its F5 bullet), on the owner's choice.
