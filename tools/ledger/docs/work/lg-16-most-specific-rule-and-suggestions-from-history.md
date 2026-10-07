---
id: lg-16
tool: ledger
title: Let the most specific rule take a row, and suggest an inbox answer from history
kind: work-package
status: done
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

## Review

**Gate: PASS** — 2026-10-07 · `1aece87d..6a4afb22` · Opus 5.5, depth standard

| Done when                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Broad pattern rule + narrower fixed-amount rule: the fixed-amount rule classifies, in both insertion orders  | `books/test/classify.test.ts` › "a broad pattern rule and a narrower fixed-amount rule: the narrower takes the row" and › "the same, with the two rules in the other order" (both `toEqual({ kind: "classified", rule: narrow })`) ✓; also `api/test/classifications.test.ts` › "a narrower fixed-amount rule takes its row from a broad one, in either order" ✓ |
| 2. Level at the top, different answers: `ambiguous`; level, same answer: classified                             | `books/test/classify.test.ts` › "two rules level at the top with different answers suggest nothing" (`reason: "ambiguous"`) and › "level at the top with the same answer, the row is classified by the newest" ✓; API › "send the row to the inbox, never to the first rule" and › "with the same answer the row is classified, by the newest of them" ✓         |
| 3. Amount differs from an outranking rule's fixed amount: `differs`, even when a broader rule matches exactly   | `books/test/classify.test.ts` › "the row goes to the inbox as differs, with the outranking rule suggested" (`toEqual` with `matching: [broad]`) ✓; API › "an unusual amount is a question, though the broad rule matches it exactly" ✓                                                                                                                           |
| 4. Inbox row answered before carries the answer; one answered by a rule only carries none; API test proves both | `api/test/classifications.test.ts` › "a description answered by a person carries that answer, and one never answered none" (first clause) and › "a description a rule answered carries none, so a rule is not mistaken for a person" (second clause) ✓                                                                                                           |
| 5. A web test covers taking the history answer                                                                  | `web/test/inbox.test.tsx` › "shows what was answered before, and taking it stores that person and bucket" (`classifyRow` called with `{ rowId, personId, bucket }`, no `ruleId`) ✓                                                                                                                                                                               |
| 6. Gates green                                                                                                  | **verified** — `npm run check` exit 0; `npm test -- --project ledger` 542 of 542; PR #384 checks on `6a4afb22`: check, test (ubuntu-latest), test (windows-latest, informational), docker, codeql, CodeQL, dependency-review all pass                                                                                                                            |

Positive controls, each restored after: making the first exact match in insertion order win (dropping both sorts in `classify`) turned 8 of 45 in `classify.test.ts` red, the Done-when 1 test included; disabling the outranking filter turned 5 of 45 red; `sameAnswer` ignoring the person turned 3 red; taking the first of a tie instead of the newest turned 1 red; adding `'rule'` to the API's history `source` list turned 1 of 29 red; making "Use this answer" send a `ruleId` turned 1 of 12 in `inbox.test.tsx` red. A brute force over 3,000 random rule sets (573,716 orderings × id assignments) found no answer that changes with insertion order or rule id; the same harness on the insertion-order mutant found 305,554 changes.

- **low · open decision** · no `Done when` line depends on it · a Desjardins category counts as a criterion that outranks, so a rule naming a category sends every row its pattern matches in _another_ category to the inbox as `differs`, even when a broad rule fits. Probe: broad `Virement entre folios /Caisse*` → alex · current-expenses, plus `Virement*` with category `Virements` → sam; a row in category `Autres` gives `inbox differs; suggestion #2; matching [1]`. `books/test/classify.test.ts` › "a category the row is not in outranks too" asserts it. It is what the brief's ranking says, and the Log says the ranking and the `differs` trap are the filer's, not the owner's. Options: (a) keep it, the brief's literal reading; (b) only an _amount_ miss outranks, so a category-narrowed rule carves out its category and the broad rule keeps the rest. Recommend (b), put to the owner: §3's question is about amounts, and under (a) a "broad rule plus one category exception" set can never file the rows outside the exception.
- **low · open decision** · no `Done when` line depends on it · "latest" in `fromHistory` is by classification `id`, not by the row's place in the account. Correcting the _oldest_ row makes its answer the latest: three rows answered sam (July, August, September), then July corrected to alex, gives `{"personId":"alex","times":1}` for an October row. The brief's "latest answer" allows either reading. lg-17's "latest three agree" inherits whichever stands. Options: (a) keep the classification `id`, which is what the tool's other latest-wins reads use and is the cautious choice for lg-17; (b) order by the row's `seq`, which is "the last 3 times the description came up". Recommend (a) for now, with lg-17 deciding it again for auto-filing.
- **low** · `nfr:maintainability` · history reads only each row's _standing_ classification (`current_classifications`). That is a sound reading and the Log and lg-17's Build both record it, but no test pins it: changing `FROM current_classifications c` to `FROM classifications c` in `answersByDescription` (`api/src/classifications.ts`) leaves `classifications.test.ts` 29 of 29 green. Where it matters: a row answered sam twice plus another answered sam once gives `times: 2` now and would give 3 under the change.
- **low** · when the rule's suggestion and the history answer agree, the one control is the rule's **Accept**, which sends `ruleId` and stores `accepted`, not the `manual` answer that Build 3 says taking the history answer stores (`InboxItem` in `web/src/inbox/Inbox.tsx`; `inbox.test.tsx` › "a history answer that agrees with the rule's suggestion is one control, not two"). Build 4 asks for one control and does not say which. `accepted` keeps the rule id that lg-15's `classifyingRule` reads, so keeping it is defensible; it is recorded so nobody reads Build 3 as broken there.
- **low** · lg-17's new Build item 8 says "`InboxRow.history` already shows the answer and its one-tap 'Use this answer'". In the agreeing case there is no "Use this answer"; the history shows as a note under the rule's Accept. Every other statement added to lg-15 and lg-17 matches the code at head: `MatchableRule` carries `bucket` and `personId`; a tie with the same answer takes the newest `id`; the ranking is `score`'s `named` then `literal`; `fromHistory` returns `{ bucket, personId, times }` with `times` the run back from the latest; `HistoryAnswer` has `id` and no amount; `normalizeDescription` is exported; `answersByDescription` reads `current_classifications` filtered on `source IN ('manual', 'accepted')`; `InboxRow.history` exists.
- **low** · in the new `differs` case (a narrower rule outranks a broad exact match), the inbox does not show the broad rule. `matching` holds it, but `InboxItem` lists `matching` only when it has two or more entries, and the reason label still reads "A rule matches the description, but not the category or the amount." So the person is shown neither the answer the broad rule would have given nor a one-tap way to take it. The Log states this ("nothing shows differently"), and no line asks for it.
- **dropped** · `web/src/labels.ts` gains a branch in `historyLabel` and has no test file of its own. Both arms are asserted through `inbox.test.tsx` ("the last 3 times", "last time"), so the branch has a proof.
- **dropped** · lg-4's Done-when 2 is not reworded, as Build 5's first sentence says it "becomes". Build 5 is headed "What changes in lg-4's tests", lg-4 is `done` with a gate record, and the Log records the choice. Its tests did change as Build 5 asks, and the different-rank tests were added in their own describe blocks beside them.
- **dropped** · a `rule` record that supersedes a person's answer on the same row hides that answer from history (probe: `[null]`). No live call site: `classifyAdded` only classifies rows the paste just added, so nothing appends a `rule` record over a person's.
- **dropped** · "two rules with the same answer differing only in spending category" does not apply at head, because rules carry no spending category yet. lg-15's Build now names it as a decision for that rebase.
- **findings** · the hunt returned 10; 6 carried, 4 dropped.
- NFR: security n/a (no URL, header, subprocess or auth path touched; the contract change is the one Build 3 asks for) · performance ✓ (one extra query per inbox read, grouped by folded description once) · reliability ✓ (order and id invariance brute-forced above) · maintainability — the third bullet.

### Gate 2

**Gate: PASS** — 2026-10-07 · `6a4afb22..f812cbfc` · Opus 5.5, depth standard

This gate covers only this round's diff. The owner decided gate 1's three open decisions on 2026-10-07: (1) only an amount miss outranks, gate 1's option (b), overriding the build; (2) "latest" stays the classification id; (3) when the rule's suggestion and the history agree, the one control stays the rule's Accept, storing `accepted` with the rule id.

| Done when                                                                                                     | Proof                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3. Amount differs from an outranking rule's fixed amount: `differs`, even when a broader rule matches exactly | Still proven: `books/test/classify.test.ts` › "the row goes to the inbox as differs, with the outranking rule suggested" ✓, and new › "the category matching, a miss on the amount still outranks" ✓                            |
| 6. Gates green                                                                                                | **verified** — `npm run check` exit 0; `npm test` 4454 passed, 2 skipped, of 4456; PR #384 on `f812cbfc`: check, test (ubuntu-latest), test (windows-latest, informational), docker, codeql, CodeQL, dependency-review all pass |

Done when 1, 2, 4 and 5: their tests are unchanged this round, and all pass in the 545 of 545 run by `npm test -- --project ledger`.

Re-runs at `f812cbfc`, after a rebuild (`dist/classify.js` holds `amountMiss`, 4 hits):

- `probe.mjs`: line 5 now reads "classified by #1 (alex · current-expenses)"; at gate 1 it was `differs`. Lines 1a–4b are unchanged.
- New probe lines, for a rule naming a category and an amount:
  - (6a) the row misses both → classified by the broad rule;
  - (6b) the row misses only the category → classified by the broad rule;
  - (6c) the row misses only the amount → `differs`, the rule suggested, `matching [1]`;
  - (6d) no exact match at all, a category-only miss → `differs`, as lg-4 had it.
- Invariance: 3,000 rule sets, 573,716 combinations of insertion order and id assignment, **0** results that changed. The same harness on an insertion-order mutant of this head found 253,168.
- `history-probe.mjs`: S2–S7 read exactly as at gate 1.

Gate 1's findings:

- **Category miss outranks (open decision 1): fixed.** The owner chose (b).
  - The outranking filter in `classify` (`books/src/classify.ts`) now requires `amountMiss && !categoryMiss`.
  - Putting back gate 1's filter (`misses > 0`) turns 2 of 47 in `classify.test.ts` red: "a category the row is not in does not outrank: the broad rule keeps the row" and "a rule missing the category and the amount does not outrank either".
- **Latest by classification id (open decision 2): closed, kept by the owner.**
- **Standing-only history had no test: fixed.** New test: `api/test/classifications.test.ts` › "a row answered twice counts once, by the answer that stands". Changing `FROM current_classifications c` to `FROM classifications c` now turns 1 of 30 red; at gate 1 it was 0 of 29.
- **Accept stores `accepted` when the suggestion and history agree (open decision 3): closed, kept by the owner.**
- **lg-17's "Use this answer" wording: fixed.** Build 8 now says what each case shows and what it stores, and that matches `InboxItem`: "Use this answer" sends no `ruleId`; the agreeing case is a note under Accept.
- **Broad rule not shown on a `differs` row: not fixed, left recorded as a low.** The builder is right that gate 1 named only the symptom. The remedy is one of two:
  - (a) on a `differs` row whose `matching` is not empty, list that rule as "A broader rule fits: `<pattern>` → `<answer>`", with its own Accept (`onAccept(rule.id)`);
  - (b) list it with no control, and change the `differs` label so it says a broader rule fits.

  Recommend (a). No line depends on it, and it may land unfixed.

New in this round's lines:

- **The builder's reading of a rule that misses both the category and the amount: follows the owner's answer, not an open decision.**
  - Option (b) as gate 1 wrote it, which the owner chose, has two halves: "only an _amount_ miss outranks" and "a category-narrowed rule carves out its category and the broad rule keeps the rest".
  - A row outside the rule's category is in "the rest", whatever its amount. The other reading, that any miss including the amount outranks, would leave the broad rule unable to keep those rows, which contradicts the second half.
  - The brief does not reach this case: its trap says "outrank", which the owner's answer then narrowed.
  - Probes 6a and 6b and the new test pin the reading, and dropping `!categoryMiss` turns that test red (1 of 47).
  - **One contingency, for the coordinator:** the Log quotes the question as "(b) only an amount miss outranks", without its rationale. If the owner was shown only those five words, the case is still a real choice between: (i) the builder's reading, under which the broad rule files the row; and (ii) any miss that includes the amount outranks, under which the row goes to the inbox as `differs`, suggesting the rule. Recommend (i). It is one line in `classify.ts` either way.
- **dropped** · the `INBOX_REASONS` comment in `contract/src/api.ts` now has a line far over the wrapping width ("…a category the row is not in never does). `ambiguous`: …"). `npm run check` passes, oxfmt does not wrap comments, and the text is true against the code. Cosmetic.
- **dropped** · the builder added a sentence to the brief's Build 6 trap recording the owner's decision. It records a decision the Log carries with its options, and it does not loosen a Done-when line.
- **findings** · the hunt in this round's lines returned 3; 1 carried (the contingency above), 2 dropped. No `high`, no `med`.
- NFR: security n/a · performance ✓ (two booleans per candidate) · reliability ✓ (invariance re-run above) · maintainability ✓ (both new branches have tests that fail without them).

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
