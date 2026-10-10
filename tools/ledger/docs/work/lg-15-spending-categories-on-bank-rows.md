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
     second rebases; neither depends on the other. What lg-16 built, for the
     rebase: `MatchableRule` now also carries `bucket` and `personId`, because
     two rules level at the top **share an answer** when those two agree, and
     the row then takes the newest by `id`; `classify` ranks by `score`'s
     `named` and `literal`, so a rule that only differs by its spending
     category is level with the other and the newest wins. A rule's spending
     category is therefore not part of "the same answer": decide whether it
     should be before two rules differing only in it classify silently.
     `InboxRow` gained `history`, and `classifyingRule` for `spendingCategory`
     is the rule `classify` returned, which is what `classifications.rule_id`
     already stores.
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
- 2026-10-10 — Built, on `lg-15-spending-categories` from `ad51f0b8`. Gate
  pending; the status stays `ready`.
  - **Storage.** Migration 6 (`api/src/db/schema.ts`): `spending_categories`
    (versions; a rename or a retirement supersedes), `spending_category_map`,
    `spending_category_overrides`, and a nullable `spending_category_id` on
    `rules` and `period_lines`. Everything that picks a category stores the id
    of its **first** version, because a rename files a new version and a
    reference to the version id would go stale; `root_id` is `NULL` on a first
    version and the id of the first on every later one (CHECK-tied to
    `supersedes`). Six generic names are seeded; no rule and no map line is.
  - **`books`.** `spendingCategory(row, classifyingRule, map, override)` and
    `spendingMap(versions)` in `books/src/spending.ts`; the four-step order is
    asserted in `books/test/spending.test.ts` (override over rule over map over
    none). `api/src/rows.ts` lists stored rows with theirs (`GET /api/rows`,
    `?spendingCategory=none` is the filter, capped by `limit`) and writes the
    override; `inbox()` answers `InboxRow.spendingCategory`.
  - **Item 7 was already written.** #380, which filed this ticket, wrote the
    receipt-split and uncategorised notes into lg-9's Build; this change only
    adds to that bullet where to read the category from. A short note on what
    lg-15 touched was added to lg-17's item 8, since it shares the files.
  - **What the brief had wrong.** Nothing in the design; two things about the
    surroundings. (1) I first re-created `current_rules` and
    `current_period_lines` in the migration on the belief that a `SELECT *`
    view keeps the columns the table had when it was made. It does not in
    SQLite: deleting those lines left every test green (45 of 45 in
    `spending-categories.test.ts` and `rules.test.ts`), so they were taken out
    and the test that reads the new column through the view stays as the
    regression. (2) The "1 of its N tests" counts in the CodeQL comments in
    `routes/periods.ts`, `routes/rules.ts` and `routes/salaries.ts` were stale
    (22, 22, 31 against a file that had 31); six new routes make it 37, and
    each was re-measured by taking `{ onRequest: read }` off its route and
    running `route-limits.test.ts` (1 failure each, named as the comment says),
    then restored. That is the fold-in exception: the comment says what to
    measure, and adding the routes changed the number.
  - **Words.** The rule form's "Category" label became "Bank category" and the
    period-line form's free-text input became a "Spending category" select, so
    the two are never read for each other. A new line sends `category: null`;
    the free-text column and every stored line's text are untouched, and the
    web lists a line by its spending category, else its text.
  - **Open decisions, for the owner (not settled here).**
    1. _Is a rule's spending category part of "the same answer" in `classify`?_
       Built: **yes**, `sameAnswer` compares it (`null` counts as a value), so
       two rules level at the top that differ only in it are `ambiguous` and the
       row waits. Pinned by `books/test/classify.test.ts`, "classify, with
       spending categories (lg-15)": changing the one line in `sameAnswer` to
       ignore it fails 2 of 51 (the first and third tests), and nothing else.
       The other choice classifies silently by the newest `id`. Cost of yes: a
       row asks where two equally specific rules disagree on the category only.
    2. _Does a filed row follow its rule's later edits?_ Built: **no**, a
       classified row takes the category of the rule **version** its
       classification cites (`rule_id`), as the brief said; editing a rule to
       add a category leaves rows it already filed on the map's. Pinned by
       `api/test/spending-categories.test.ts`, "editing a rule's category files
       a version, and a row keeps the version it was filed by". The alternative
       follows the rule's chain to its latest version, retirements included
       (they copy the category), so past rows follow an edit as they follow a
       map fix; about 15 lines of recursive SQL and the assertion above flips.
    3. _The override's `null` withdraws it; it cannot say "none"._ A row whose
       map or rule gives a category cannot be made uncategorised by hand.
       Built so because a withdrawal has to be expressible and the brief lists
       no third state; a separate "explicitly none" record is the alternative.
  - **Not run.** No browser or end-to-end run: `e2e/README.md` says there is
    still no spec, and the screens are covered by the web unit tests only.
