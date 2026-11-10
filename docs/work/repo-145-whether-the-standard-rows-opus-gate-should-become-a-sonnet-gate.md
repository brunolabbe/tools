---
id: repo-145
tool: repo
title: Whether the standard row's Opus gate should become a Sonnet gate
kind: chore
status: needs-decision
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-145 — Whether the standard row's Opus gate should become a Sonnet gate

## Why

[repo-139](./repo-139-measure-a-sonnet-gate-on-standard-tickets-against-opus.md)
measured gate 1 on `ticket-reviewer-sonnet` (xhigh, depth medium) for three
`standard` tickets against ten Opus gate 1s from the log. Pooled, the Sonnet
gates cost about 55 % of an Opus gate; against the Opus gates that ran at the
same depth, 64 % to 66 %. They carried about as many findings, and neither
population had a finding shown false afterwards. Build 5 of that ticket says to
file the change to the `standard` row when that happens, so this is the question
put to the owner, not a recommendation to change it.

Two things stop the numbers from deciding it alone. Three gates cannot show how
often a gate finds a `high`, or what it misses. And a `standard` build is
`builder-standard`, Sonnet 5.5, so a Sonnet gate on it is the same model
reviewing itself, which `SKILL.md`'s pairing notes rule out ("a different
model, not a cheaper one"). PR #778 (repo-138) applies that rule by the owner's
answer of 2026-11-10 to two rows: it moves both the filing row's gate and the
docs-only chore row's gate (builder `builder-standard`) to `ticket-reviewer-opus`.

**The table already carries one same-model pairing, which is a fact and not a
finding of this ticket.** The `fixer` row (Sonnet 5.5, `.claude/agents/fixer.md`)
sends gate 2 to "the ticket's own gate row, dispatched fresh". For `mechanical`
and `hard` tickets that row is `ticket-reviewer-sonnet` (Sonnet 5.5,
`.claude/agents/ticket-reviewer-sonnet.md`), so where a `fixer` wrote the round,
a Sonnet gate reads Sonnet's fixes. `grep -n -E '^model'
.claude/agents/fixer.md .claude/agents/ticket-reviewer-sonnet.md` prints
`claude-sonnet-5-5` for both. On `standard` tickets that gate 2 is Opus and
does not pair. Whether the rule is meant to cover the fixer is Question 2 below.

## Reproduction

Read from [repo-139's Log](./repo-139-measure-a-sonnet-gate-on-standard-tickets-against-opus.md)
(2026-11-10), costs from `node scripts/agent-cost.mjs --agent <id>`, counts from
each gate's own `## Review` section.

|                           | Sonnet xhigh, gate 1 (3 gates)          | Opus high, gate 1 (10 gates)             |
| ------------------------- | --------------------------------------- | ---------------------------------------- |
| Cost per gate             | $1.27 to $2.74, mean $1.85, total $5.55 | $2.26 to $4.26, mean $3.35, total $33.53 |
| Findings carried per gate | 2, 4, 6 (mean 4.0)                      | 2 to 6 (mean 4.2)                        |
| Cost per carried finding  | $0.46                                   | $0.80                                    |
| `high` / `med` / `low`    | 0 / 1 / 11                              | 2 / 1 / 39                               |
| Refuted afterwards        | 0                                       | 0                                        |

The Opus gates ran at different depths, and by mean the cost sorts by depth. All
three Sonnet gates ran `medium`, so the depth-matched row is the one a saving is
read against:

| Opus gates, by the depth their section names         | n   | Mean  | Sonnet mean as a share | Saving per gate |
| ---------------------------------------------------- | --- | ----- | ---------------------- | --------------- |
| all ten, pooled                                      | 10  | $3.35 | 55 %                   | $1.50           |
| `full` (repo-130, 133, 120, 72, 128)                 | 5   | $3.62 | 51 %                   | $1.77           |
| `medium` (lg-80, lg-75)                              | 2   | $2.90 | 64 %                   | $1.05           |
| `medium` plus `standard` (adding repo-121, repo-124) | 4   | $2.82 | 66 %                   | $0.97           |

lg-69's gate ("standard, full", $4.14) is in the pooled row only. "Standard" is
not a depth name now, and lg-80's gate read it as `medium`. The `medium` row's n
is 2 and the last row's is 4, so the depth-matched figure rests on two to four
gates; read it as "about $1.00 a gate", not as a measured $0.97. The Sonnet
tickets are repo-135 ($1.27, PASS), repo-143 ($1.54, CONCERNS, one `med`) and
repo-129 ($2.74, PASS). The Opus tickets are repo-130, repo-133, repo-120, lg-69,
lg-80, lg-75, lg-72, repo-121, repo-124 and repo-128; the two `high`s are lg-72's
and repo-124's.

"No more refuted at a lower cost" is the Build 5 condition of repo-139 and it
holds, but it is a tie at zero and does not discriminate: a false finding is
the only thing it counts, and a gate's misses are not in it. Only repo-143 had
a second reader (Opus, narrow, over the round), and it found no `high`;
repo-135 and repo-129 had none. If a Sonnet gate had the Opus rate of a `high`
(2 in 10), the chance of none in three is 51 %.

## Decision — open

The row today (`SKILL.md`, _Which model built it_): `standard` is
`builder-standard` (Sonnet 5.5, high) with `ticket-reviewer-opus` (Opus 5.5,
high). Every cost below is given twice: **pooled** (the ten Opus gates as they
ran, mean $3.35) and **depth-matched** (the Opus gates at `medium` or
`standard`, mean $2.82 to $2.90, the depth repo-139's Build 1 says the Opus row
gets). Both are estimates for the ten tickets the Opus population covers, from
the means above, not a forecast; the matched one is the nearer to what a
`medium` gate costs.

**Question 1 — the `standard` row: open**

- **(a) Keep the row.** Recommended, with low confidence: the owner has just
  ruled that a Sonnet filer under a Sonnet gate breaks "a different model"
  (repo-138, 2026-11-10), and the three Sonnet readings cannot see misses or the
  rate of a `high`. The row costs $3.35 a gate, $33.53 over the ten, pooled; $2.82
  to $2.90 a gate, about $28 over the ten, depth-matched. Risk: paying about
  $1.50 a gate more than a Sonnet gate costs pooled, about $1.00 a gate matched,
  for protection this measurement could not show is needed. Nothing to build
  but a line in this ticket's Decision and, if wanted, a sentence in
  repo-139's Log closing it.
- **(b) Sonnet xhigh gate 1 on every `standard` ticket**, and write the
  exception into the rule sentence. Saves about $1.50 a gate pooled, about
  $15 over ten (to $18.49); about $1.00 a gate depth-matched, about $10 over
  ten ($9.67 to $10.46). Risk: the reviewer shares the builder's model and so
  whatever that model does not notice; repo-138's owner answer declined this
  pairing for filings (its option (i)) and it would stand against that
  answer. The rule's text must change either way, and that is a decision about
  the rule, not about cost.
- **(c) Sonnet gate 1 where the first read is likely to pass, Opus when it is
  not.** Gate 1 is Sonnet; a `med` or `high` in it, or a FAIL or CONCERNS
  verdict, sends the round to an Opus gate 2 (the shape repo-143 already had).
  Saves the Sonnet-for-Opus difference on tickets that PASS at gate 1 (7 of the
  10 Opus gate 1s did): pooled 7 x $1.50 = $10.50 over ten; depth-matched
  7 x $1.00, about $7 ($6.77 to $7.32). It costs roughly the same as today on
  the rest. Risk: the same same-model objection as (b) at gate 1, and the
  PASS-with-lows tickets, the ones where a miss is invisible, are the ones that
  never meet the Opus reader.
- **(d) Measure misses first.** The next batch of three `standard` tickets
  runs gate 1 on Sonnet xhigh and a second, independent gate over the same
  range on Opus, both blind to each other, then compares findings. The
  Sonnet gate is paid on top of the Opus gate: about 3 x $1.85 = $5.55 more
  than today (the same pooled or matched, since only the Sonnet gate is added)
  for a reading of the misses repo-139 could not take, and no saving until it
  is read. Risk: it costs again what repo-139 cost and the rate of a `high` is
  still unmeasured at three tickets; three more tickets would add little.

**Question 2 — the `fixer` → `ticket-reviewer-sonnet` pairing: open**

Raised by repo-139's gate; the table has carried it since before this ticket
(see the Why). It is the owner's to decide whether "a different model" covers a
gate over a `fixer`'s round, and nothing in Question 1 settles it.

- **(i) Leave it.** The `fixer`'s work is mechanical and a landing, gate 2 reads
  a narrow range, and the rule is written about a ticket's build. Costs nothing.
  Risk: the rule's sentence says more than the table does, and a later row
  change reads it as binding.
- **(ii) Put gate 2 over a `fixer`'s round on `ticket-reviewer-opus` on
  `mechanical` and `hard` tickets.** Not priced here: no gate-2 population was
  read for this ticket, and an Opus gate 2 narrow ran $2.26 to $2.66 in the
  rows repo-139 read (repo-124, repo-143, lg-72). Risk: it adds that cost to
  every such round.
- **(iii) Say in the rule that it covers a ticket's build and not a `fixer`'s
  round.** One sentence in `SKILL.md` and `review-ticket/SKILL.md`, no change in
  cost or dispatch. Risk: it writes down an exception the owner never chose.

Not offered because it was not measured: Opus at a lower effort or a narrower
depth. The ten Opus gates ran `full`, `standard` and `medium` depths, and by
mean the cost does sort by depth ($3.62 `full`, $2.82 to $2.90 `medium`), which
is why every figure above is given twice; but two to four rows at a depth
cannot price an option.

## Build

By option; the one answered is the whole of the build.

1. (a): none. Record the answer under _Decision_ and set `status: done` with
   the answer in the Log.
2. (b) or (c): edit the `standard` row of the pairing table in
   `.claude/skills/orchestrate-tickets/SKILL.md`, the sentence "The rule is 'a
   different model', not 'a cheaper one'" beside it and the matching sentence
   in `.claude/skills/review-ticket/SKILL.md` ("A different model reviews"),
   in the same commit, so the three agree. Merge over PR #778 (repo-138),
   which edits the same table and the same bullet; read the table at the tip
   of `main` before editing, not this ticket's text.
3. (d): the next batch's dispatch is the build; the batch log carries the
   second table.
4. Question 2: (i) none; (ii) the `fixer` row's gate column in `SKILL.md`;
   (iii) the same sentences as step 2.

## Done when

1. The `standard` row of the pairing table in `SKILL.md` reads the answer to
   Question 1. For (b) and (c), the "different model" sentences in
   `SKILL.md` and `review-ticket/SKILL.md` (`grep -n 'different model'
   .claude/skills/orchestrate-tickets/SKILL.md
   .claude/skills/review-ticket/SKILL.md`) name the pairing the new row
   makes, so each says what the table does. For (a) and (d) no edit is
   needed and the Log says so.
2. The answer to Question 2 is recorded under _Decision_, with the options it
   was chosen from. If it is (ii) or (iii), the `fixer` row or the same
   sentences read it, as in Done when 1.
3. For (d): the batch's `reference/history.md` entry carries both gates'
   rows for each of the three tickets, and this ticket's Log states what the
   Opus gate found that the Sonnet gate did not.

## Log

- 2026-11-10 — Filed by repo-139's build (Build 5), with its Log as the
  reproduction. Options priced from the means in that Log; no estimate here
  was run as an option.
- 2026-11-10 — Round 1 of repo-139's gate 1 (FAIL, one high). Pricing: the
  options now carry the pooled and the depth-matched figures; the means by depth
  were re-derived from the ten costs by a script (`depth.mjs`, scratch) and match
  the gate's ($2.90 `medium`, $2.82 `medium` plus `standard`, $3.62 `full`).
  Done when 1 (it could not be met for (a) as worded, because the `fixer` row
  already pairs Sonnet with Sonnet) is reworded, and the `fixer` pairing is
  stated in the Why and put as Question 2 instead of being resolved here. The
  Why names #778's two rows.
