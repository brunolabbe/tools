---
id: lg-15
tool: ledger
title: Give bank rows and period lines a spending category from one shared list
kind: work-package
status: ready
milestone: P3
depends_on: [lg-4, lg-6]
difficulty: standard
---

# lg-15 — Give bank rows and period lines a spending category from one shared list

## Why

The owner wants spending by type charted ([00-ANALYSIS.md §9](../00-ANALYSIS.md)),
and until now only receipt items were to carry a category (lg-10, in Phase 4).
A pasted row already carries Desjardins' own category, which is enough to give
most rows a spending category without reading anything else, and a rule can
say what Desjardins' grouping gets wrong for one merchant. lg-6's period lines
carry a free-text category, which would chart "groceries" and "épicerie" as two
slices. The owner settled the design on 2026-10-06
([00-ANALYSIS.md §6](../00-ANALYSIS.md), _Categories_, amendment).

**Two words, two things.** `category` on a row and on a rule is already
Desjardins' own text (`Virements`, `Hypothèque`). The new thing is a **spending
category**, and every table, column, type and screen this ticket adds says so,
so the two can never be read for each other.

## Build

1. **Migration: the list.** `spending_categories`, append-only and versioned the
   way `rules` is (a new version supersedes; a retirement is a version). Seeded
   with groceries, alcohol, household, pharmacy, restaurant, other — generic
   words, so seeding them from the repository is allowed, unlike rules. Editable
   from a screen.
2. **Migration: the map.** `spending_category_map`: Desjardins' category text
   (folded the way `classify` folds it) to a spending category, append-only, the
   latest version per Desjardins text winning. Nothing seeded: the Desjardins
   texts are not all known (§2 lists what the sample showed).
3. **Migration: the overrides.**
   - `rules` gains a nullable spending category. A rule version that names one
     overrides the map for every row it classifies.
   - A row may carry its own override, as an append-only record with who and
     when, latest winning — never a column on the row (the lg-4 rule).
   - `period_lines` gains a nullable spending category. A new line, and a new
     version of a line, picks from the list. The free-text `category` column
     stays, and lines already stored keep their text untouched.
4. **`books`, pure: `spendingCategory(row, classifyingRule, map, override)`.**
   Order: the row's own override, then the classifying rule's, then the map's
   entry for the row's Desjardins category, then none. Computed when read, so
   fixing a map entry recategorises every row it covers; the map's own history
   is kept by its versions.
5. **Uncategorised never blocks.** A row with no spending category is filed by
   person and bucket exactly as today. It never enters the inbox for want of a
   category. The API answers its category as `null`, and a filter lists those
   rows.
6. `web`:
   - the list screen, and the map screen (one line per Desjardins category seen
     in stored rows, with its spending category or none);
   - the rule form gains the optional spending category;
   - a row's spending category is shown wherever the row is, and editable there
     (writing the override);
   - the period-line form picks from the list.
7. **What lg-9 reads**, written into its Build in the same change: a joint-account
   row with a receipt attached (lg-8) is split by its receipt items' categories
   (lg-10) and its own spending category is not counted; a period line with no
   list category, which is every line stored before this ticket and every line
   lg-7 imports, charts as uncategorised, its text shown in the detail.
8. **Traps.**
   - `lg-16` changes `classify` and the inbox in the same files. Whichever lands
     second rebases; neither depends on the other.
   - The rule form's spending category is part of a rule version, so editing it
     supersedes the rule like any other field.

## Done when

1. A row whose Desjardins category is mapped gets that spending category; a row
   classified by a rule naming one gets the rule's; a row with its own override
   gets the override; each asserted in one `books` test over the four-step order.
2. A row with no spending category is classified and does not enter the inbox.
   An API test proves it.
3. Changing a map entry changes the spending category of rows already stored,
   and the earlier map version is still stored.
4. A new period line takes a spending category from the list; a line stored
   before the migration keeps its text. An API test proves both.
5. Web tests cover setting a map entry, a rule's spending category, a row's
   override and a period line's.
6. Gates green.

## Log

- 2026-10-06 — Filed from a conversation with the owner, who chose every design
  point above through questions: the map as default with a rule overriding it,
  uncategorised never blocking, this ticket creating the list (lg-10 now reuses
  it), and period lines picking from the list. The lg-9 split for receipt rows
  was stated to the owner as the filer's default and not objected to. The
  per-row override and computing the category when read are the filer's own
  defaults, not put to the owner; a builder who finds either wrong says so.
