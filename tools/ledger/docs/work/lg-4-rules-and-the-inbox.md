---
id: lg-4
tool: ledger
title: Classify rows by rule, and put everything else in an inbox
kind: work-package
status: ready
milestone: P2
depends_on: [lg-2]
difficulty: standard
---

# lg-4 — Classify rows by rule, and put everything else in an inbox

## Why

Each row belongs to one bucket, and each deposit to one person. The paste
carries enough to classify most rows exactly. The rest need a human, and a
transfer that differs from its usual amount is a question, not a guess
([00-ANALYSIS.md §3](../00-ANALYSIS.md)).

## Build

1. `books`: `classify(row, rules)`. A rule is a description pattern, an optional
   Desjardins category, an optional exact amount, and the person and bucket it
   assigns. A row takes a rule only on an **exact** match. With no match, or with
   more than one, it takes none, and the function returns the nearest rule as a
   suggestion.
2. Buckets are `mortgage` and `current-expenses`. A row with no person is
   **joint**: rebates, the sale of a shared thing, and one half of an error
   pair.
3. Migration: `rules`, and `classifications`. **A classification is a record,
   never a column on the row**, so reclassifying appends a new one with who did
   it (lg-3's person, when it lands) and when. The latest record wins.
4. Classify on paste. What no rule matches lands in the **inbox**.
5. `web`:
   - the inbox, with the suggested rule and one tap to accept it or to pick the
     person and bucket;
   - an offer to turn the answer into a rule;
   - a rules screen to add, edit and retire rules.
6. **Rules live in the database only.** Caisse names identify a household, so
   no rule is seeded from the repository.

## Done when

1. An exactly matching row is classified on paste. A row whose amount differs
   from its rule's fixed amount lands in the inbox, with that rule suggested.
2. Two rules matching one row send it to the inbox, never to the first rule.
3. Reclassifying keeps the earlier classification as history.
4. Web tests cover accepting a suggestion and creating a rule from an answer.
5. Gates green.

## Log
