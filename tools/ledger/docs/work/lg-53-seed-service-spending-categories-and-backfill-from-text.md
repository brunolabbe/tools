---
id: lg-53
tool: ledger
title: Seed the service spending categories and backfill rows and lines whose text names one
kind: work-package
status: done
milestone: P3
depends_on: [lg-15]
difficulty: standard
---

# lg-53 — Seed the service spending categories and backfill rows and lines whose text names one

## Why

The owner asked on 2026-10-18 why taxes, internet, electricity and Netflix have
no spending category. Measured on a copy of the household's books that day:

- **The list is the six [lg-15](./lg-15-spending-categories-on-bank-rows.md)
  seeded** (Groceries, Alcohol, Household, Pharmacy, Restaurant, Other), and
  nothing was added since.
- **None of the 420 bank rows has a category, and no step could give one.** Every
  row came from the workbook import ([lg-7](./lg-7-import-the-workbook.md)) with
  an empty Desjardins category, so the map (step 3 of `spendingCategory`) never
  matches. Every row was filed `manual`, with no rule, so a rule's category
  (step 2) never applies. The map, the rules' categories and the overrides are all
  empty.
- **The rows' descriptions name the spending anyway.** The spending rows the
  chart counts (joint, current expenses, money out) include `Taxes` (~19 rows,
  ~19,000 $), `Épicerie` (9), `Frais d'utilisation` (7), `Retrait` (3) and `Autre`
  (2).
- **Of the 450 card lines, 27 carry the workbook's own word:** `Hydro Québec`,
  `Internet`, `Netflix`, `Assurances maison` (5 each), `Épicerie/Comissions` (8),
  `Voyage`, `Maison` (2 each). About 420 are bare amounts and cannot be
  categorised from anything stored.

The owner chose, from options put to them:

1. **Split services:** Electricity, Internet & phone and Subscriptions as three
   categories, not one Utilities.
2. **A migration seeds them,** as lg-15 seeded the first six. They are generic
   words, so the repository may carry them.
3. **A text-matched backfill,** a one-off command with a dry run, like the import.
   The bare card lines stay uncategorised.

## Build

- **Migration 12** adds Property taxes, Electricity, Internet & phone,
  Subscriptions, Insurance, Home maintenance, Travel, Transport, Bank fees and
  Cash. A household that already has a category of that name (case aside) that
  is not retired keeps its own and gets no second one, since two of one name is
  what `requireFreeName` refuses.
- **`spendingNameForText` in `books`**: a fixed table from folded text (the way
  `normalize` folds) to a category _name_, matched on the whole text, never a
  substring. A trip note like `Épicerie Nouvelle-Écosse` is not groceries at
  home. Pure, and it does not know the list's ids.
- **`npm run backfill-spending:ledger -- --household <id> --as <person> [--write]`**
  runs against that household's books. A dry run works on a private copy, as the
  import's does. For each bank row the chart counts (`countsAsSpending`: joint,
  current expenses, of either sign) that has no spending category, it matches
  the description and appends an override. For each current
  period line with no spending category, it matches the line's `category` text
  and corrects the line through `correctLine`, as the UI does. It never replaces
  a category a person, a rule or the map gave, and running it twice writes
  nothing the second time. The report counts what each text matched, and lists
  the texts it left alone.

The receipt reader offers the model the whole list (lg-10), so the seed also
widens what a receipt item may be proposed as. No change is needed there.

## Done when

- A fresh database and one migrated from 11 both list the sixteen names, and a
  household that had made `Insurance` itself is not given a second one.
- The dry run reports and writes nothing, and `--write` writes what the dry run
  reported. A second `--write` writes nothing.
- A row or a line that already has a category keeps it, and a row the chart does
  not count (a deposit filed to a person) is left alone.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

### 2026-10-18 — built (Claude Opus 5.5, with the owner)

- **Money back counts, a person's deposit does not.** The brief first said to
  skip every money-in row. Asked about `Ristourne` (Desjardins' yearly member
  dividend, joint, a few cents), the owner chose Bank fees for it. So the filter
  became `countsAsSpending`, either sign. That also keeps the 22 money-in `Taxes`
  rows, each filed to a person, out of it.
- **The dry run on a copy of the household's books** fills 69: 23 `Taxes`, 7
  `Frais d'utilisation`, 3 `Ristourne`, 3 `Retrait` and 1 `Épicerie` bank rows,
  and 32 card lines (Assurances maison, Internet, Netflix, Hydro Québec,
  Épicerie/Comissions, Maison, Voyage). It leaves `Autre` (2), joint `Dépôt` (4),
  `Paiement` (4) and 443 card lines with no text. Only 1 of the 9 `Épicerie` rows
  is joint; the other 8 are filed to a person and the chart does not count them.
  The file's hash is the same before and after the dry run.
- **A corrected line becomes `source: manual`,** as a correction from the
  Period screen does (`correctLine`). The version it supersedes keeps
  `workbook`, and nothing in `web` reads a line's source.
- **The table matches the whole text only.** A future AccèsD paste writes
  `Taxes /Ville Exemple`, which it does not match. That is for the map and the
  rules, which already exist, and not for this one-off.
- `copyBooks` and `directoryPeople` in `import-command.ts` are exported for the
  command, not copied.
- Tests that pinned `user_version` 11 or the six seeded names now expect 12 and
  sixteen.
