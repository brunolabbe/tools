---
id: repo-140
tool: repo
title: Retire a hard builder at about ten dollars, not fifteen
kind: chore
status: done
milestone: null
depends_on: []
difficulty: mechanical
awaiting: Done when 2 — the first batch entry in reference/history.md after this merge whose table has a builder-hard row names the bar ($10) its builder was read against in its Tickets line
---

# repo-140 — Retire a hard builder at about ten dollars, not fifteen

## Why

`SKILL.md` step 6: a builder is resumed for one round and one owner stop, and
sooner retired for fresh agents when `agent-cost.mjs` shows it past about $15.
The figure came from pl-60 (resumed four times to $38.03) and pl-62 (retired at
$12.01, the ticket $34.24 against pl-60's $47.50).

The `hard` builders of the last eight batches reached $15 to $20 on their first
build, before any round, so the bar never fired early: it was read at the first
report, and the choice was already "fresh agent for every later step". A bar
at about $10 names the same choice before the first build is reported, which
is when the dispatch can still be split (a measurement step, then the build),
and it matches what the fresh agents that finished those tickets cost.

## Reproduction

`builder-hard` (Opus 5.5, high) rows from `reference/history.md`, 2026-10-25 to
2026-10-31, first dispatch of each ticket:

| Ticket   | First build                                         | Later agents on the ticket                                            | Ticket total |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------- | ------------ |
| lg-66    | $19.30 (retired at the first report)                | fresh builder, rounds 1 and 2: $15.33; three gates $9.45; fixer $0.53 | $44.61       |
| lg-76    | $20.14 (one resume for an e2e seed)                 | two gates $5.28; fixers $2.36                                         | $27.73       |
| repo-131 | $15.86 (build + round 1 + an owner's lift; retired) | three gates $5.73; fixer $1.31                                        | $22.90       |
| lg-67    | $10.39                                              | one gate $3.28; fixer $1.00; maintenance $0.05                        | $14.72       |
| lg-71    | $9.42                                               | two gates $4.61; fixers $1.10                                         | $15.13       |
| lg-74    | $6.60                                               | one gate $3.06; fixer $0.54                                           | $10.20       |
| lg-78    | $6.39                                               | one gate $2.52; fixer $0.49                                           | $9.41        |
| lg-77    | $7.17                                               | one gate $2.77; fixer $0.46                                           | $10.40       |

Three of eight first builds passed $15; none of the five under $10.40 needed a
round. The fresh agents that finished the three expensive tickets cost $0.53 to
$15.33 each, and every one that was a fixer cost under $1.40.

## Decision — answered 2026-11-10 by the owner

The owner answered at the tools-86 batch checkpoint 1, on 2026-11-10; the
orchestrator relayed the answer in this build's dispatch. The question put:
"repo-140: at what cost should a long-lived hard builder be retired?" The
options offered, the recommended one first:

- **(a) Lower the bar to about $10**, read at the first report: a builder past
  it is not resumed for a round; the round goes to a fresh `builder-hard`
  handed the branch, its head and the Log, as the page already says for later
  steps. Recommended: it is the figure the page's own data now gives, and it
  changes nothing for the five tickets under it.
- **(b) Keep $15 and add a dispatch split**: a `hard` ticket whose Build has a
  measurement step is dispatched as two agents from the start, the
  measurement on `builder-standard`. Addresses lg-66's shape (a 50-minute
  first build) without touching the bar; does nothing for lg-76 and repo-131,
  whose first builds were the work.
- **(c) Both.**

**Chosen: (a)**, the option above as written, which is this ticket's own
recommendation. No recommendation was overridden. Build 2 applies only to (b)
or (c), so it is not built.

## Build

1. `.claude/skills/orchestrate-tickets/SKILL.md` step 6, the resume paragraph:
   the figure, and this ticket's table in place of pl-60's sentence as the
   measurement.
2. If (b) or (c): `reference/dispatching.md`, _A builder prompt carries_, a
   bullet on splitting a `hard` dispatch at a measurement step.

## Done when

1. `grep -n '\$15' .claude/skills/orchestrate-tickets/SKILL.md` finds nothing
   under step 6, and the paragraph names the new figure with this ticket.
2. The next `hard` ticket's entry in `reference/history.md` names which bar
   its builder was read against.

## Review

**Gate: PASS** — 2026-11-10 · `a100f429..74b9d49a` · Sonnet 5.5, depth narrow

| Done when                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `grep -n '\$15'` on `SKILL.md` finds nothing under step 6, and the paragraph names the new figure with this ticket | **verified** (docs-only, by command) — the grep prints nothing and exits 1; step 6's resume paragraph reads "The bar is about $10" and "repo-140's measurement". "fifteen dollars" appears twice in it as the cutoff of the data (three first builds above it), not as a bar, so the property holds as well as the literal grep |
| 2. The next `hard` ticket's entry in `reference/history.md` names which bar its builder was read against              | **awaiting** — the first batch entry written to `reference/history.md` after the merge whose table has a `builder-hard` row; the reading is whether that entry's text names the bar ($10) its builder was read against (see F2: no page tells the orchestrator to write it)                                                     |

- **low** · F1 · no `Done when` line depends on it · `nfr:maintainability` — the
  new paragraph says the `builder-hard` row "that opened each of eight tickets"
  on the 2026-10-25 and 2026-10-31 batches cost $6.39 to $20.14. Those batches
  hold **nine** such first-build rows: `reference/history.md`, "Batch 2026-10-25
  (tools-97 …)", has repo-127's (`af6a85377816e2387`, $7.10), which the brief's
  table and the paragraph leave out. The range and "three of them above fifteen
  dollars" survive with it (three of nine, $6.39 to $20.14), so the text is
  incomplete, not wrong, and the falsehood runs in the safe direction. The same
  shape as repo-138's gate: a chosen subset written as the batches' range.
- **low** · F2 · open decision, no `Done when` line is unmet by it, but line 2's
  reading depends on it — nothing tells the orchestrator to record the bar.
  Step 6's new paragraph says the bar is read at the first report, not that the
  batch entry says so, and `reference/history.md`'s entry schema ("An entry is
  this and nothing more": table, Tickets, Defects, Worked) has no place for it;
  `git grep -n -i 'which bar\|read against' -- .claude docs/01-TICKETS.md`
  finds only an unrelated sentence. Line 2 will be read off an entry that is
  only written that way if someone does it unprompted. No live call site until
  the next `hard` batch. Remedy options, for the lander or owner: **(a)** one
  clause in the step 6 paragraph, that the batch entry's Tickets line says
  whether the builder was read against the bar (recommended: it puts the
  obligation where the orchestrator reads, one sentence); **(b)** reword line
  2 to read the builder's cost off the entry's table, with no page edit.
- **low** · F3 · no `Done when` line depends on it · `nfr:maintainability` —
  "a builder past it is not resumed for a round", read "at the builder's first
  report", sits beside three other resumes the sentence does not address: step
  4's "Send a failing line back now, while the builder's cache is warm" (the
  same moment), the paragraph's own "one owner stop", and the routing table's
  "any one needs judgement → the builder, resumed with `SendMessage`". By step
  6's own vocabulary a "round" is a gate's findings, so there is no
  contradiction, but a reader at step 4 with a $10.39 builder and a failing line
  has no instruction. The old "$15" sentence had the same shape; the new "first
  report" wording puts the bar at step 4's moment. Safe direction (a cost, not a
  correctness, rule).
- **low** · F4 · no `Done when` line depends on it — the ticket's Log, correction
  4, says none of the five builders under $10.40 "had a builder round, but each
  had a fresh fixer for owner answers or landing". lg-71's fixer
  (`a632eb598726a1564`) is, in `reference/history.md`, "lg-71 round 1 (med + two
  lows + two owner answers)": a round, with a `med` in it, went to a fixer. "No
  builder round" is true; "for owner answers or landing" is not the whole of
  lg-71's. Log text, safe direction, nothing relies on it.
- **dropped** · "fifteen dollars" in the new paragraph as a way round the
  `\$15` grep: it states the data's cutoff, not a bar, and no page still tells an
  orchestrator to resume a builder up to $15 (`grep -rn '\$15\|fifteen' .claude/
  CLAUDE.md docs/` returns only history rows, other tickets' own figures and
  repo-140's own text).
- **dropped** · the $10 against $15 choice changes the data's decisions only for
  lg-67 ($10.39): the owner's settled choice (a), a product decision.
- **dropped** · the personal memory file `retire-long-lived-builders.md` still
  says "~$15": outside this tree and not a page; named in the report to the
  dispatcher.
- **findings** · the hunt returned 7; 4 carried, 3 dropped.
- Checked and clean: every dollar figure and agent id in the changed `SKILL.md`
  lines re-derived from `reference/history.md` (35 of 35 cost cells equal,
  every id present); the ticket's two named Log corrections (lg-76's total is
  $27.78, not $27.73; the floor is $0.48, not $0.53) hold; `npm run status --
  --json` reads repo-140 as `ready`, `problems: []`; the Decision's option text
  is unchanged from the base (the diff of that section is the heading, the
  provenance paragraph and the "Chosen" paragraph); a clean `git merge-tree`
  of this head with repo-138's (PR #778) head.
- CI at `74b9d49a`: check, pr-title, codeql, dependency-review success; the unit
  matrix is skipped (markdown only).
- NFR: security n/a · performance n/a · reliability — F2 · maintainability —
  F1, F3, F4.

## Log

- 2026-11-01 — Filed from the 2026-11-01 review's reading of the eight
  batches' accounting tables (session tools-5d); figures copied from the
  entries, not re-run.
- 2026-11-10 — Built on `repo-140-retire-at-ten` from `a100f429`, on the
  owner's answer (a) recorded above. Commit 1 records the answer and sets
  `status: ready`, and left the open heading beside it: `npm run status --
  --show repo-140` then failed on the ticket. Commit 2 rewords that heading as
  answered, which `docs/01-TICKETS.md` (_Decision — open_) requires, edits
  `SKILL.md` step 6's paragraph, and writes this Log, and nothing else. Build 2
  is not built: it applies only to (b) or (c).
  - **Change.** The paragraph now reads the bar as about $10, read at the
    builder's first report, and sends the round to a fresh `builder-hard`. The
    pl-60 and pl-62 sentence is replaced by this ticket's measurement, which the
    paragraph states in the figures below.
  - **Done when 1.** `grep -n '\$15' .claude/skills/orchestrate-tickets/SKILL.md`
    → no output, exit 1. The paragraph names $10 and repo-140.
  - **Done when 2** is not met by this build. It binds the next `hard` ticket's
    `reference/history.md` entry, which does not exist yet; unproven until then.
  - **Figures, re-derived.** Each row is named by its agent id in the batch
    sections of `reference/history.md`: "Batch 2026-10-25 (tools-a2)" (#669,
    #670, #672), "Batch 2026-10-31 (tools-54)" (#680, #681), "(tools-54
    second)" (#685, #686), "(tools-54 third)" (#692). A script in scratch summed
    the Cost column per ticket; its output:

    ```
    lg-66     first 19.2996  gates 9.4466  fixers+maint 0.5322  later 25.3119  total 44.6115
    lg-76     first 20.1357  gates 5.2842  fixers+maint 2.3594  later 7.6436  total 27.7793
    repo-131  first 15.8642  gates 5.7254  fixers+maint 1.3106  later 7.0360  total 22.9002
    lg-67     first 10.3909  gates 3.2843  fixers+maint 1.0484  later 4.3327  total 14.7236
    lg-71     first 9.4208  gates 4.6064  fixers+maint 1.0994  later 5.7058  total 15.1266
    lg-74     first 6.5995  gates 3.0590  fixers+maint 0.5376  later 3.5966  total 10.1961
    lg-78     first 6.3919  gates 2.5242  fixers+maint 0.4941  later 3.0183  total 9.4102
    lg-77     first 7.1676  gates 2.7725  fixers+maint 0.4572  later 3.2297  total 10.3973
    three expensive tickets, later agents: min 0.4800 max 15.3331
    all fixers: min 0.4572 max 1.3106 count 11
    ```

    The rows behind the paragraph's figures: `builder-hard` first builds
    `a8050d856d258c4cc` (lg-78, $6.39) to `a57335d72eb728e06` (lg-76, $20.14);
    above fifteen dollars `a7c7a6062d2340117` (lg-66, $19.30),
    `a57335d72eb728e06` (lg-76, $20.14, one resume inside the row) and
    `ae48dca7c340d2bed` (repo-131, $15.86, round 1 inside the row). Later agents
    on those three: `a5ab66271eba5897a` ($0.48, the lowest) and `a66da0ebde99bea6d`
    ($4.41, the highest gate or fixer) bound "$0.48 to $4.41"; `ae9dcdfc18ca12a88`,
    the fresh builder for rounds 1 and 2 on lg-66, is the one figure above it.

  - **The brief's figures, against the rows.** The Reproduction table's lg-66,
    repo-131, lg-67, lg-71, lg-74, lg-78 and lg-77 rows all re-derive. Four
    statements do not:
    1. lg-76's ticket total reads **$27.73**; its rows (`a57335d72eb728e06`,
       `a7a3f5dcbd410ee08`, `a52cae48916102a77`, `aefaf3b0221841f4b`,
       `a5ab66271eba5897a`, `ac0a1372f85bb12fa`) sum to **$27.78**. The fixers
       cell ($2.36) is right only with the merge-of-main fixer
       (`ac0a1372f85bb12fa`, $0.63) counted.
    2. The Why's "fresh agents ... cost $0.53 to $15.33": $0.53 is lg-66's
       fixer (`af0fd0e77546ab5de`). The lowest later agent on the three is
       lg-76's landing fixer, `a5ab66271eba5897a`, at $0.48.
    3. The Why's "reached $15 to $20 on their first build, before any round":
       three of the eight first-build rows passed $15, and two of those three
       carry a round or a resume inside the row (lg-76, repo-131). The other
       five were $6.39 to $10.39.
    4. "None of the five under $10.40 needed a round": none of the five had a
       builder round. Four had a fresh fixer for owner answers or landing
       (`afa7141de4a8bf99d`, `ae23f1b723c5ae207`, `af85f863831fd99cf`,
       `aa90fbde84ac03c93`); lg-71's fixer (`a632eb598726a1564`) took its
       round 1, a med, two lows and two owner answers. And lg-67's $10.39 sits
       just above the new bar, so "changes nothing for the five" holds only
       because it had no builder round.

    The Why and the Reproduction table are the brief and were not edited (the
    Build names only the skill page); these four are the record.

  - **Fold-in.** None. No other small, already-specified piece came free from
    this change. The brief's figures are corrected here, not in the table,
    because the Build does not name the ticket's own text.
- 2026-11-10 — Owner's answers at the tools-86 batch checkpoint 5, taken after
  gate 1 (PASS, four lows) and relayed in the lander's dispatch; each is the
  gate's recommendation and none was overridden. Recorded by the lander before
  the records.
  - **Question 1 — F2, the open decision.** "Step 6 says the bar is read at the
    first report, but not that the batch entry records it, and `history.md`'s
    entry schema has no place for it; Done when 2 reads off an entry that is
    only written that way if someone does it unprompted." Options: **(a)**
    add one clause to step 6's paragraph saying the batch entry's Tickets line
    states whether the builder was read against the bar (recommended); **(b)**
    reword Done when 2 to read the builder's cost off the entry's accounting
    table, with no page edit. **Chosen: (a).** The clause is an owner-authorised
    landing edit to `SKILL.md` step 6 and was not gated.
  - **Question 2 — F1, F3, F4.** Options: fix F1 and F4 at the landing with no
    re-gate and leave F3 recorded unfixed (recommended), or fix all three.
    **Chosen: F1 and F4 fixed at landing; F3 stays recorded unfixed.** F1's
    figure is re-derived from `reference/history.md` in the entry that marks it.
  - **Question 3 — Done when 2.** The gate graded it `awaiting`. Options: an
    `awaiting:` line naming the event and the reading (recommended), or leave
    the line unmarked. **Chosen: the line.** The event is the first batch entry
    in `reference/history.md` after this merge whose table has a `builder-hard`
    row; the reading is whether that entry's Tickets line names the bar ($10)
    its builder was read against.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F1 — "Those batches
  hold nine such first-build rows". `SKILL.md` step 6 now reads "each of nine
  tickets". repo-127's row is re-derived from `reference/history.md`, "Batch
  2026-10-25 (tools-97, repo-119 repo-127 repo-128)": `af6a85377816e2387`,
  `builder-hard, repo-127 + probe PR #659`, $7.1044, so $7.10. It sits inside
  the range, so "$6.39 to $20.14" and "three of them above fifteen dollars" are
  unchanged at three of nine. The brief's table and the Log's figures keep
  their eight rows, as they were not edited.
  Proof: `git diff 74b9d49a HEAD -- .claude/skills/orchestrate-tickets/SKILL.md | grep -c '^-.*opened each of eight tickets'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F4 — "'for owner
  answers or landing' is not the whole of lg-71's". Correction 4 above now
  says four of the five had a fresh fixer for owner answers or landing, and
  that lg-71's fixer took its round 1, which `reference/history.md` words as
  "med + two lows + two owner answers".
  Proof: `git diff 74b9d49a HEAD -- docs/work/repo-140-retire-a-hard-builder-at-ten-dollars.md | grep -c '^-.*builder round, but each had a fresh fixer'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice, not gated: gate 1, F2, option
  (a) — "one clause in the step 6 paragraph". `SKILL.md` step 6 now carries the
  sentence "The batch entry's Tickets line says whether that builder was read
  against the bar." It adds one sentence.
  Proof: `git diff 74b9d49a HEAD -- .claude/skills/orchestrate-tickets/SKILL.md | grep -c '^+.*says whether that builder'` → `1`.
- 2026-11-10 — Gate 1's F3 (step 6's "round" beside step 4's resume of a
  failing line) is recorded in the gate's section and left unfixed, by owner
  choice.
