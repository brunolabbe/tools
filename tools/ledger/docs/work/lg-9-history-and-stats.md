---
id: lg-9
tool: ledger
title: History and stats — the charts the owner asked for
kind: work-package
status: ready
milestone: P5
depends_on: [lg-5, lg-6, lg-15]
difficulty: standard
---

# lg-9 — History and stats — the charts the owner asked for

## Why

The owner wants the history of everything, and charts of it
([00-ANALYSIS.md §9](../00-ANALYSIS.md)). Everything is already stored as dated,
append-only records, so this ticket computes and draws. It stores nothing new.

## Build

1. `books`, pure — time series, each computed from rows:
   - the mortgage payment over time, marking each change (renewals);
   - salaries and ratio by year;
   - each person's cumulative contributions per bucket, and each person's own
     money in the mortgage bucket;
   - the buffer's balance, with the rows behind its large drops;
   - spending per period and per spending category, and the fixed items month
     by month. Categories come from
     [lg-15](./lg-15-spending-categories-on-bank-rows.md)'s one list, on bank
     rows and on period lines. A joint-account row with a receipt attached
     (lg-8) is split by its receipt items' categories once
     [lg-10](./lg-10-receipt-items-exclusions-and-categories.md) lands, and its
     own category is then not counted. A row or line with no category charts
     as uncategorised; a period line stored before lg-15, or imported by lg-7,
     shows its free text in the detail. Read a row's category from what lg-15
     built and do not recompute it: `listRows` in `api/src/rows.ts` answers it
     per stored row (computed on read, with the step that gave it: the row's
     own override, its rule's, or the map's), and a period line's is its
     `spendingCategoryId`, with the free text left in `category`;
   - settlements, with their formula version.
2. `api`: one route per series, each with a date range.
3. `web`: a stats screen. Before choosing chart colours or marks, load the
   `dataviz` skill.
4. **Charts must work on a phone.** That is where both people use the tool.

## Done when

1. Each series has a unit test on a synthetic history, including one with a
   payment change and one spanning a ratio change.
2. The stats screen renders each chart from fixture data. Web tests prove it.
3. Gates green.

## Log
