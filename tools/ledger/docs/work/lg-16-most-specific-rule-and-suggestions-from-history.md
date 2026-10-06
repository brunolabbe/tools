---
id: lg-16
tool: ledger
title: Let the most specific rule take a row, and suggest an inbox answer from history
kind: work-package
status: ready
milestone: P2
depends_on: [lg-4]
difficulty: standard
---

# lg-16 — Let the most specific rule take a row, and suggest an inbox answer from history

## Why

lg-4 sends a row matched exactly by two rules to the inbox, whatever the two
are. That stops a broad rule built on account info — `Virement entre folios
/Caisse du Lac`, the caisse naming the person — from living beside a narrower
one with that person's fixed mortgage amount: every row the narrow rule should
take is `ambiguous`. And a row no rule matches gets a suggestion only from the
rules, though the same description has usually been answered before. The owner
chose both changes on 2026-10-06; they keep classification exact, and nothing
is filed without a rule or a tap ([00-ANALYSIS.md §3](../00-ANALYSIS.md),
amendment).

## Build

1. **`books`: precedence in `classify`.** Among the rules matching a row exactly,
   rank by, in order: the more criteria it names beyond the pattern (a fixed
   amount, a Desjardins category); the longer literal part of the pattern (its
   characters other than `*`). The top rank takes the row.
   - **Level at the top with the same answer** (person and bucket): the row is
     classified; take the newest version as the rule applied.
   - **Level at the top with different answers**: `ambiguous`, as today, with
     `matching` listing only the top rank.
   - Update `classify.ts`'s header and the contract's `INBOX_REASONS` comment
     ("more than one rule matches exactly") to say this.
2. **`books`, pure: `fromHistory(row, answers)`.** Answers are the person-given
   classifications (`source` `manual` or `accepted`) of rows with the same
   description, folded and whitespace-collapsed as `classify` does. Rule-applied
   classifications are not answers. It returns the latest answer, and how many
   of the latest answers agree with it, or `null` when there is none.
3. **The inbox** (`GET /api/inbox`): each `InboxRow` gains the history answer
   beside the rule `suggestion`. Taking it is one tap and stores a `manual`
   classification by the person who tapped. No schema change.
4. `web`: the inbox shows the history answer ("answered alex · mortgage, the last
   3 times") with its own one-tap accept. When the rule suggestion and the
   history answer agree, one control, not two.
5. **What changes in lg-4's tests.** lg-4's Done-when 2 ("two rules matching one
   row send it to the inbox") becomes "two rules level at the top with different
   answers". Its tests change to that case; a test that two rules of different
   rank classify the row is added beside them, never in place of them.
6. **Traps.**
   - `lg-15` changes the rules and the inbox in the same files. Whichever lands
     second rebases; neither depends on the other.
   - **A behaviour change, not only an addition.** Today a row matching one
     rule exactly is classified by it even when another rule's pattern matches
     and its fixed amount does not (`classify` returns on `matching.length ===
1` and never looks at the `differs` candidates). With no broad rules that
     is harmless; with the broad rules this ticket makes useful, a mortgage
     transfer at an unusual amount would be filed by the broad rule in silence
     — exactly what §3 asks about. So: a `differs` candidate that would
     **outrank** the best exact match, by the ranking above, sends the row to
     the inbox as `differs`, with that rule suggested. An exact match that
     outranks every `differs` candidate takes the row.
   - The ranking's last two criteria are already computed for suggestions
     (`score`'s `named` and `literal`); reuse them rather than add a second
     notion of "narrower".

## Done when

1. A row matching a broad pattern rule and a narrower fixed-amount rule is
   classified by the fixed-amount rule. A `books` test proves it, and a test
   proves the same with the two rules' insertion order reversed.
2. Two rules level at the top with different answers send the row to the inbox
   as `ambiguous`; level with the same answer, the row is classified.
3. A row whose amount differs from an outranking rule's fixed amount goes to the
   inbox as `differs`, even when a broader rule matches it exactly.
4. An inbox row whose description was answered before carries that answer; one
   answered by a rule only carries none. An API test proves both.
5. A web test covers taking the history answer.
6. Gates green.

## Log

- 2026-10-06 — Filed from a conversation with the owner, who chose "most
  specific rule wins" and "suggest from history" together, and auto-filing as a
  separate ticket (lg-17) built on this one. The ranking order, the
  same-answer tie and the `differs` trap are the filer's, not put to the owner.
