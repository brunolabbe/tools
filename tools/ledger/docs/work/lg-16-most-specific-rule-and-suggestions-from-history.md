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
     outranks every `differs` candidate takes the row. **Only an amount miss
     counts** (owner, 2026-10-07, in the Log): a rule naming a category the row
     is not in does not send it to the inbox.
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
- 2026-10-07 — Built, on `origin/main` at 1aece87d.
  - **What it does.** `classify` ranks the exact matches by `score`'s `named`,
    then `literal` (one notion of narrower, as the brief asked); the top rank
    with one answer (person and bucket) takes the row, the newest by `id`; the
    top rank with two answers is `ambiguous`, `matching` listing only it. A
    pattern-matching rule the row does not fit that outranks the best exact
    match is `differs`, suggesting the nearest of those outranking rules.
    `MatchableRule` gained `bucket` and `personId`, which "same answer" needs and
    the API's `Rule` already carries. `fromHistory` is in `books/src/history.ts`;
    `InboxRow.history` is `{ personId, bucket, times }` or `null`.
  - **Ruled by the brief's silence.** "How many of the latest answers agree" is
    read as the run of latest answers equal to the newest, counting back until
    one differs (`times`), so "the last 3 times" is literally the last three. The
    answers are each row's _standing_ classification (`current_classifications`)
    with `source` `manual` or `accepted`, so a row a rule filed and a person then
    corrected counts as the person's answer, and the rule's own filing never
    does. "Latest" is by classification `id`, as the tool's other latest-wins
    reads are.
  - **`matching` under `differs`** is the exact rules at the top rank (the broad
    rule the narrower one displaced), where lg-4 left it empty; the web lists it
    only when it holds two or more, so nothing shows differently.
  - **The brief's tests.** lg-4's two-rules API tests changed to "level at the
    top with different answers", and `classify.test.ts`'s "the more specific is
    suggested" test, which asserted the behaviour this ticket removes, became
    "classified by the narrower"; two-rule tests with identical patterns and
    identical answers now differ in the person or the bucket, since they would
    otherwise classify. Done-when 2 of lg-4's own file still reads "two rules
    matching one row"; it is a finished ticket with a gate record and is not edited
    here.
  - **Not folded in.** lg-4's Done-when 2 wording (above): its file is `done`
    with a record, which a build does not touch. Nothing else made another piece
    free. lg-15 and lg-17's Build sections were amended in this change with what
    this builds under them.
  - **Proof.** `npx vitest run tools/ledger/books`: 8 files, 212 tests;
    `tools/ledger/api`: 274; `tools/ledger/web`: 52;
    `npm test -- --project ledger`: 34 files, 542 tests. Failed before the
    behaviour existed, by mutation: replacing the outranking filter in
    `classify.ts` with `false` fails 5 of 45 in `classify.test.ts`, all in the
    `differs` describe; replacing the API's `source IN ('manual', 'accepted')`
    with `1 = 1` fails 1 of 29 in `classifications.test.ts`, the rule-only
    description test.
- 2026-10-07 — Round 2, after gate 1 (PASS at 6a4afb22, six lows, three open
  decisions). **Owner decisions, 2026-10-07**, each put as a question with
  options:
  1. _A rule naming a Desjardins category outranks a broad rule on every row its
     pattern matches in other categories, so those rows go to the inbox as
     `differs`. Options: (a) keep it, the brief's literal reading; (b) only an
     amount miss outranks._ **Chosen: (b)**, overriding the build. `classify`
     now lets a candidate outrank an exact match only when the amount is the one
     thing it misses; a rule naming a category the row is not in carves that
     category out and the broad rule keeps the rest. Where the rule misses the
     category and the amount, the brief and the answer do not say; I read it as
     not outranking, since the row is outside what the rule describes. **Not
     put to the owner; recommend keeping it, and a one-line change in
     `classify.ts` if the owner reads it the other way.** With no exact match
     at all, any miss still makes a `differs`, as lg-4 had it.
  2. _"Latest" in `fromHistory`: (a) the classification id; (b) the row's place
     in the account._ **Chosen: (a)**, as built.
  3. _When the rule's suggestion and the history agree: (a) one control, the
     rule's Accept, storing `accepted` with the rule id; (b) one control storing
     `manual`._ **Chosen: (a)**, as built.
  - **Test.** "a category the row is not in outranks too" is replaced by "a
    category the row is not in does not outrank: the broad rule keeps the row"
    (both rule orders), with "a rule missing the category and the amount does not
    outrank either" and "the category matching, a miss on the amount still
    outranks". `npx vitest run tools/ledger/books tools/ledger/api`: 25 files,
    489 tests passed. The gate's `probe.mjs` against this build: line 5 reads
    "classified by #1 (alex · current-expenses)", where it was `differs`, and
    the 3,000-set invariance run still reports 0 variants over 573,716
    orderings.
  - **Lows fixed.** History reads only the standing classification, and now a
    test pins it ("a row answered twice counts once, by the answer that
    stands"); changing `FROM current_classifications c` to `FROM classifications
c` fails 1 of 30, and `history-probe.mjs` S3 still reads `times: 2`. lg-17's
    Build 8 no longer says the agreeing case has a "Use this answer"; it says
    what each case shows and stores. lg-15 and lg-17's other additions say
    nothing about which rows outrank, so they stand.
  - **Lows left as recorded.** The broad rule is not shown on a `differs` row
    where a narrower rule outranks it (the finding states the symptom, not what
    to show or where); the oldest-row-corrected ordering (decision 2); the
    accepted-versus-manual split (decision 3).
