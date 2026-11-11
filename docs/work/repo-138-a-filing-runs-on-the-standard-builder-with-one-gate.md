---
id: repo-138
tool: repo
title: A filing runs on the standard builder with one gate, not on Haiku with two
kind: chore
status: done
milestone: null
depends_on: []
difficulty: mechanical
awaiting: Done when 2 — the first three filing dispatches after this merge each have a per-agent cost row in reference/history.md, read beside this ticket's five-filing table
---

# repo-138 — A filing runs on the standard builder with one gate, not on Haiku with two

## Why

`orchestrate-tickets`' pairing table (`SKILL.md`, _Which model built it_) sends
"a filing whose reproduction is in hand" to `builder-mechanical` (Haiku 5.5) as
a maintenance dispatch, gated narrow by `ticket-reviewer-sonnet` after the pull
request opens. The row was priced on lg-24's filing at $0.10 (owner,
2026-10-14), against $0.63 and $1.17 for two filings on `builder-standard`.

The filings of the last eight batches did not run that way. Every one made
numerical claims — an option's cost, a measurement in the Why, a "only remedy"
sentence — and the first gate found at least one false, which opened a round
and a second gate. The Haiku filing is cheap; the two gates it needs are not.
The review of 2026-11-01 read it off the accounting tables and filed this.

## Reproduction

From `reference/history.md`'s entries, 2026-10-25 and 2026-10-31 (each figure
is that entry's accounting row):

| Filing                    | Filer       | Gate 1                                       | Round              | Gate 2          | Landing | Total |
| ------------------------- | ----------- | -------------------------------------------- | ------------------ | --------------- | ------- | ----- |
| lg-82 (tools-54 second)   | Haiku $1.43 | Sonnet xhigh $2.52, CONCERNS, 4 meds         | by the filer       | $2.39, PASS     | $0.51   | $6.85 |
| lg-83 (tools-54 third)    | Haiku $1.10 | $1.71, CONCERNS, 3 meds (false option costs) | by the filer       | $2.23, PASS     | $0.49   | $5.54 |
| repo-133 (tools-54 third) | Haiku $1.64 | $1.56, CONCERNS, 4 meds                      | by the filer       | $1.55, CONCERNS | $0.52   | $5.27 |
| lg-80 (tools-54)          | Haiku $0.54 | $1.10, CONCERNS, 1 med                       | fresh Sonnet $1.21 | $1.73, PASS     | $0.54   | $5.11 |
| repo-126 (tools-5e)       | Haiku $0.13 | $1.60, CONCERNS, 2 meds                      | Sonnet $1.01       | $2.33, CONCERNS | $0.50   | $5.58 |

Five of five filings in the period took two gates; the gates cost $2.83 to
$4.91 of each $5.1 to $6.9 total. The one-gate filings in the same period
(lg-81's one-line fix, pl-65's Build line) had no numerical claim to get wrong:
$1.54 and $1.14.

The `builder-standard` builds of the same period, for scale: repo-130 $2.13,
repo-133's build $1.25, repo-120 $1.25, lg-69 $2.71 — each with one gate and no
round.

## Decision — answered 2026-11-10 by the owner

Question, put by the orchestrator at the tools-86 batch checkpoint: "repo-138:
what should the pairing table's filing row read?"

**Answered by the owner, 2026-11-10: (a)**, the ticket's own recommendation; no
recommendation overridden. The options as offered, unchanged:

What the filing row should read.

- **(a) `builder-standard` (Sonnet 5.5, high), one narrow `ticket-reviewer-sonnet`
  gate after the pull request opens**, the same as the docs-only chore row.
  Expected cost about $1.50 to file plus $1.50 to gate, against $5 to $7 today;
  the bet is that a Sonnet filer gets its option costs right often enough that
  the second gate is not needed. Recommended. Risk: a filing that still fails
  gate 1 costs the same round it does today, on a dearer filer.
- **(b) Keep Haiku, drop gate 2 for filings.** A filing's round is applied by
  the filer and the ticket lands `needs-decision` with gate 1's section and
  the round's Log on the thread; the owner reads the corrected costs before
  answering. Saves one gate ($1.5 to $2.4) per filing; keeps the $0.10 filer
  for the trivial case. Risk: a round that introduces a new false cost reaches
  the owner ungated — repo-133's and repo-126's gate 2 each found one.
- **(c) Keep the row.** The two-gate pattern is the price of a correct
  `needs-decision` filing; $5 is cheap against a wrong answer.

~~The rule "a different model gates, not a cheaper one" (`SKILL.md`) holds under
(a) and (b).~~ Superseded 2026-11-10: false for (a). `builder-standard` and
`ticket-reviewer-sonnet` both pin `claude-sonnet-5-5`, so a Sonnet filer under
the Sonnet gate is the same model reviewing itself. It holds under the second
answer below.

**Second answer, owner, 2026-11-10, over (a)'s same-model pairing.** Question
as put by the orchestrator at the tools-86 checkpoint 2: "Your answer (a) pairs
a builder-standard filer with a ticket-reviewer-sonnet gate. Both agent
definitions are claude-sonnet-5-5. That breaks the rule 'a different model, not
a cheaper one' (orchestrate-tickets SKILL.md, and review-ticket's 'A different
model reviews'), and the ticket's claim that the rule 'holds under (a)' is
false. Which pairing should the filing row carry?"

Options offered:

- **(ii) Sonnet filer, Opus gate** (the orchestrator's recommendation).
- (i) Keep (a) and write an exception into the rule sentence.
- (b) Haiku filer, no gate 2.
- (c) Keep today's row.

**Chosen: (ii), the recommendation; no recommendation overridden.** Provenance:
the orchestrator's check behind the question, run by the orchestrator and not
the builder: `grep -n '^model'` on `builder-standard.md` and
`ticket-reviewer-sonnet.md`, both `claude-sonnet-5-5`; the Opus gate-1 costs
from `reference/history.md`'s #684 ($3.1060), #691 ($3.4652) and #703
($2.6522) rows.

The filing row now reads `builder-standard` (Sonnet 5.5, high) with
`ticket-reviewer-opus`, narrow, after the PR opens. The status stays `ready`.

## Build

1. Edit the filing row of the pairing table in
   `.claude/skills/orchestrate-tickets/SKILL.md` and the sentence under it that
   cites lg-24, naming this ticket and the five filings above as the
   measurement that moved it.
2. If (a): `reference/dispatching.md`, _A gate prompt carries_, needs no change;
   `roles/builder.md`'s "maintenance" paragraph loses "a filing whose
   reproduction is in hand" from its list.
3. If (b): `reference/records.md`, _When there is no ticket_, gains the
   one-gate filing shape.

## Done when

1. The pairing table's filing row reads as the answer says, and no other page
   still sends a filing to the old row (`grep -rn "filing whose reproduction"
   .claude/skills`).
2. The first three filings after the merge are logged in `reference/history.md`
   with their per-agent cost, so the next review can read the row against
   this ticket's table.

## Review

**Gate: CONCERNS** — 2026-11-10 · `a100f429..3962a6cb` · Sonnet 5.5, depth narrow

| Done when                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The pairing table's filing row reads as the answer says, and no other page still sends a filing to the old row | **verified** (docs-only, by reading). `SKILL.md`'s pairing table filing row reads `builder-standard` (Sonnet 5.5, high) with `ticket-reviewer-opus`, narrow, after the PR opens; the agent frontmatter pins `builder-standard` to `claude-sonnet-5-5` and `ticket-reviewer-opus` to `claude-opus-5-5`, so the pair is two models, which is the owner's second answer (ii). `grep -rn "filing whose reproduction" .claude/skills` at the head, read as a list: the new row, the new sentence under it, `review-ticket/gate.md`'s unrelated "filing whose reproduction does not show what it claims", and two historical records in `reference/history.md`. `roles/builder.md`'s maintenance paragraph no longer lists a filing. A second grep for the wrap-split phrases ("in hand", "builder-mechanical", "maintenance dispatch") finds no other page routing a filing to the old row |
| 2. The first three filings after the merge are logged in `reference/history.md` with per-agent cost               | **unproven (scope)** — the dispatch scopes it out (cannot be met before the merge); the orchestrator checks it, at step 12's batch entry and the next review. It also meets `gate.md`'s `awaiting` test, so the lander can copy it: event — the first three filing dispatches after this merges; reading — their per-agent rows in `reference/history.md`, set beside the ticket's five-filing table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Other checks from the dispatch (narrow depth): attack 1, every figure the branch writes into `SKILL.md`, re-derived from `reference/history.md` — the five filings' totals, the two one-gate totals, lg-24's $0.10, dl-123's $0.63 and the three PR numbers' gate costs reproduce; F1, F2 and F3 are the exceptions; attack 2, every page that routes a filing — no page still sends a reproduction-in-hand filing to `builder-mechanical`, to two gates, or to a same-model gate (F4 grades the one bullet left); attack 3, the ticket's recorded decisions — both answers carry question, options, choice and provenance, the option text is unchanged (a line diff of the ticket shows no edit inside the three options), the struck claim is marked and not deleted (F5, F6, F7 are the exceptions); `npm run -s status -- --json` gives `repo-138` as `status: ready`, `difficulty: mechanical`, `problems: []`. PR #778 at `3962a6cb`: `check`, `CodeQL`, `dependency-review` pass, the test matrix skipped (docs-only), title passes `scripts/commit-message.mjs`.

- **med** · no `Done when` line depends on it · F1 · `SKILL.md`, the sentence under the pairing table: "The Opus gate 1 on a `standard` build ran $2.65 to $3.47 (#684, #691, #703)". The three rows are right (#684 $3.1060, #691 $3.4652, #703 $2.6522) but they are 3 of the 23 `ticket-reviewer-opus` "gate 1" rows in `reference/history.md` from the tools-5e entry on, and the sentence states the sample as the range: the 23 run $2.17 to $4.26, median $3.17, and 12 of 23 fall outside $2.65 to $3.47 (7 above, 5 below). Direction: it understates the top of the range by $0.79 (23%), the way that under-budgets a filing, on a page the orchestrator prices from, in a ticket that exists over false cost figures. Fix stated: name the sample ("three Opus gate 1s ran $2.65 to $3.47; the 23 from 2026-10-25 on ran $2.17 to $4.26, median $3.17") or drop the range. Fixable at the landing.
- **low** · F2 · `SKILL.md`, same sentence block: "five filings on that row in 2026-10-31 to 2026-11-01". By the history headings and the ticket files' own commits, four of the five were filed 2026-10-31 (lg-80, lg-82, lg-83, repo-133) and repo-126 on 2026-10-25; none of the five in 2026-11-01. The slip is the ticket's own Reproduction ("entries, 2026-10-31 and 2026-11-01"), copied. A label; nothing relies on it.
- **low** · F3 · `SKILL.md`, same sentence block, two comparators that are not like for like (one mechanism, one bullet). (a) "$1.17 for dl-123 and dl-125": the #480/#481 row in `reference/history.md` is "dl-124 build and dl-125 filing" together, so $1.17 overstates dl-125's filing; the figure is the old sentence's, re-wrapped into the changed lines, and $0.63 for dl-123 (#477) is right. (b) "$1.14 and $1.54 for the one-gate filings": both re-sum correctly (pl-65 #695 $0.0337 + $0.7857 + $0.3211; lg-81 #687 $0.2817 + $0.9902 + $0.2713), but the ticket's Reproduction says they "had no numerical claim to get wrong", and the page drops that, so they read as the cost of a one-gate filing generally; at the ticket's own $1.50 to file plus an Opus gate of $2.65 to $3.47, a filing that carries figures comes to $4.15 to $4.97 (my arithmetic, not a measured filing). Safe direction for (a), unsafe for (b); no live call site.
- **low** · F4 · `SKILL.md`, the bullet "A Haiku build or filing is always gated". Graded as asked: it does not contradict the new row, since a Haiku filing is still gated and the maintenance clause beside it ("changes no source and no brief") still excludes a filing, which adds a brief. It misleads slightly: "or filing" names a case the table no longer routes to Haiku, so a reader can take a Haiku filing for a live row. The builder logged leaving it. Reword to "A Haiku build is always gated" at the landing, or leave.
- **low** · F5 · the ticket, `## Decision — answered`: `docs/01-TICKETS.md`'s format reads `## Decision — answered <date> by <who>`; the heading is bare. The date and owner are in the first line below it, `npm run status` accepts it (`problems: []`), and five other tickets carry a bare one. Format only.
- **low** · F6 · the ticket's Decision, after the second answer: option (a)'s "Expected cost about $1.50 to file plus $1.50 to gate, against $5 to $7 today" stays as offered text, correctly unrewritten, but beside "Chosen: (ii)" the ticket records no expected cost for the chosen row, and the Opus gate is $2.65 to $3.47 on the cited rows, not $1.50. The second answer's options carry no costs either, so a reader cannot tell what the owner was shown. Done when 2 reads the next three filings against "this ticket's table", which has no figure for the chosen row. Not graded as the choice: it is settled.
- **low** · F7 · the ticket's Reproduction still says "the gates cost $3.3 to $4.9"; the Log says it has no matching sum, and it is right: the five filings' gate sums are lg-82 $4.91, lg-83 $3.94, repo-133 $3.11, lg-80 $2.83, repo-126 $3.93, so $2.83 to $4.91. The page was changed to cite totals only, so no shipped text carries it; the brief does.
- **dropped** · `roles/builder.md`, "Push, then open a draft pull request": "A filing the pairing table gates with none opens ready" matches no row at the base or the head. Pre-existing, unchanged by the range, not a contradiction the branch caused; reported to the dispatcher as a page defect.
- **dropped** · the pairing table's docs-only chore row names no gate model beside `builder-standard`, and a filing is also "ticket files, no source". The filing row is the more specific and sits above it. Pre-existing; an open decision for the dispatcher in the full report, not a finding against this range.
- **dropped** · `.claude/agents/builder-standard.md` describes itself as building "one ticket rated `standard`", which a filing is not. The docs-only chore row already dispatched it for the same work, and the description is not the model or effort the table's rule covers. Out of the range.
- **dropped** · the ticket's first Log entry describes a build with `ticket-reviewer-sonnet`. The Log is append-only and the second entry supersedes it by name; not stale.
- **findings** · the hunt returned 11; 7 carried (F1 to F7), 4 dropped.
- NFR: security n/a · performance n/a · reliability — a figure a reader prices from understates (F1) · maintainability — F4, F5, F6, F7. Code invariants skipped: the diff is three markdown files, no source, no test, no dependency.

## Log

- 2026-11-01 — Filed from the 2026-11-01 review's reading of the eight
  batches' accounting tables (session tools-5d); figures copied from the
  entries, not re-run.
- 2026-11-10 — Owner's answer (a) recorded and status set to `ready` in the
  first commit of this branch. Built option (a): the filing row of
  `SKILL.md`'s pairing table reads `builder-standard` (Sonnet 5.5, high) with
  `ticket-reviewer-sonnet`, narrow, after the PR opens; the sentence under the
  table that cited lg-24 now cites this ticket and the five filings.
  `roles/builder.md`'s maintenance paragraph loses "a filing whose reproduction
  is in hand". `reference/dispatching.md` needed no change (Build 2).
  - Done when 1 as worded cannot pass. `grep -rn "filing whose reproduction"
    .claude/skills` after the build returns three lines: `SKILL.md` 260, the
    row's own label; `SKILL.md` 265, the sentence; and
    `review-ticket/gate.md` 27, "filing whose reproduction does not show what
    it claims is wrong", which is unrelated. The check needs the old row's
    text (`builder-mechanical`, prompt saying "maintenance") in place of the
    label.
  - Open decision, not settled in this branch: the sentence kept under the row
    ("The rule is 'a different model', not 'a cheaper one'") no longer holds
    for (a). The pinned models of `builder-standard` and
    `ticket-reviewer-sonnet` are both `claude-sonnet-5-5` (`.claude/agents/`), and
    `review-ticket/SKILL.md`'s "A different model reviews" table sends a Sonnet
    invoker to `ticket-reviewer-opus`. The Decision's "holds under (a) and
    (b)" is true of (b) only. Put to the orchestrator as options in the build's
    report; the answer names the Sonnet gate, so the choice is the owner's.
  - Reproduction figure: the Reproduction's "the gates cost $3.3 to $4.9" has
    no matching sum. From `history.md`'s #696 rows, repo-133's two gates are
    $1.5551 and $1.5519, $3.11 together; lg-80's gates 1 and 2 are $1.0958 and
    $1.7347, $2.83 without its round. The page now cites the totals only, and
    the one-gate filings' totals re-summed from history: lg-81 (#687) $0.2817 +
    $0.9902 + $0.2713 = $1.54; pl-65 (#695) $0.0337 + $0.7857 + $0.3211 = $1.14.
  - Left as written, not in the Build: `SKILL.md`'s bullet "A Haiku build or
    filing is always gated" is still true, but "or filing" now names no row.
  - Done when 2 waits for the merge: the first three filings after it are
    logged in `reference/history.md`.
- 2026-11-10 — Second answer applied on this branch (owner, over (a)'s
  same-model pairing; see the Decision). The "different model" conflict logged
  above is resolved: the filing row reads `builder-standard` (Sonnet 5.5, high)
  with `ticket-reviewer-opus`, narrow, after the PR opens, and the sentence
  under the table cites the Opus gate 1 costs on `standard` builds ($2.65 to
  $3.47, #684, #691, #703, from `reference/history.md`). The "different model"
  sentence is unchanged and now holds. The Decision's "holds under (a) and (b)"
  line is struck, as false for (a).
  - Done when 1's grep is reported as it lists, for inspection: after this
    change, `grep -rn "filing whose reproduction" .claude/skills` returns the
    row's own label (`SKILL.md`), the sentence under the table (`SKILL.md`) and
    `review-ticket/gate.md`'s unrelated sentence. Its wording is left alone, per
    the orchestrator.
  - Checked on this change: `grep -n '^model'` on the three agent definitions
    read `builder-standard.md:5:model: claude-sonnet-5-5`,
    `ticket-reviewer-sonnet.md:5:model: claude-sonnet-5-5` and
    `ticket-reviewer-opus.md:5:model: claude-opus-5-5`.
  - Left as before, not in the Build: `SKILL.md`'s "A Haiku build or filing is
    always gated" bullet.
- 2026-11-10 — Owner's answers at the tools-86 checkpoint 3, after gate 1
  (CONCERNS: 1 med, 6 lows, no high, no round opened). Recorded by the lander
  from the orchestrator's dispatch; each was the recommended option and none
  was overridden.
  - Question: which of gate 1's below-floor findings to fix at the landing
    without a re-gate. Options as relayed: fix F1, F2, F4, F5 and F7 and leave
    F3 and F6 recorded unfixed (recommended), or leave all recorded. Chosen: fix
    F1, F2, F4, F5 and F7; F3 and F6 stay recorded unfixed. On F4 the owner
    chose the rewording ("A Haiku build is always gated") over leaving it.
    Provenance: gate 1's section on this ticket, `## Review`.
  - Question: what the docs-only chore row's gate cell should name, which gate
    1 raised as an open decision (a Sonnet build there could get a Sonnet gate,
    the same-model pairing the second answer above ruled out for filings).
    Options as relayed: name `ticket-reviewer-opus` (recommended), or leave
    "one gate". Chosen: name it. The row now reads `ticket-reviewer-opus`,
    narrow, after the PR opens. This is an owner-authorised landing edit that
    was not gated; the gate saw the row as `one gate, narrow, after the PR
    opens` and did not read the new cell.
  - Question: how Done when 2 is held after the merge. Options as relayed:
    an `awaiting:` line (recommended), or leave it `unproven (scope)` as the
    gate graded it. Chosen: the `awaiting:` line, committed before the records:
    event, the first three filing dispatches after this merge; reading, their
    per-agent cost rows logged in `reference/history.md`. The gate graded the
    row `unproven (scope)` because the dispatch told it to; `gate.md` calls the
    case `awaiting`, and the error was the dispatch's, not the gate's. The gate
    section is landed as written.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F1 — "The Opus gate 1
  on a `standard` build ran $2.65 to $3.47". `SKILL.md` now names the sample:
  three Opus gate 1s ran $2.65 to $3.47 and the 23 from 2026-10-25 on ran $2.17
  to $4.26, median $3.17, as the gate stated. Proof: the removed-line grep
  below, `SKILL.md`, after this commit, read `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F2 — "in 2026-10-31 to
  2026-11-01" is wrong at both ends. `SKILL.md` now dates four filings
  2026-10-31 and repo-126 2026-10-25, and the Reproduction's lead-in reads
  "2026-10-25 and 2026-10-31". Checked against `git log --diff-filter=A` on
  the five ticket files: #682, #688, #693 and #696 on 2026-10-31, #650 on
  2026-10-25. Proof: the removed-line greps, `SKILL.md` and this ticket, each
  read `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F4 — "A Haiku build or
  filing is always gated". Reworded to "A Haiku build is always gated". Proof:
  the removed-line grep, `SKILL.md`, read `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F5 — the heading is a
  bare `## Decision — answered`. It now reads `## Decision — answered
  2026-11-10 by the owner`. Proof: the removed-line grep, this ticket, read
  `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F7 — "the gates cost
  $3.3 to $4.9". The Reproduction now reads $2.83 to $4.91, the gate's sums
  (lg-82 $4.91, lg-83 $3.94, repo-133 $3.11, lg-80 $2.83, repo-126 $3.93). The
  Log entry of 2026-11-10 above that says the old figure had no matching sum
  stands. Proof: the removed-line grep, this ticket, read `1`.
