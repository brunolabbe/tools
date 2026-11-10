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
`standard` tickets against ten Opus gate 1s from the log. The Sonnet gates cost
about 55 % of an Opus gate, carried about as many findings, and neither
population had a finding shown false afterwards. Build 5 of that ticket says to
file the change to the `standard` row when that happens, so this is the question
put to the owner, not a recommendation to change it.

Two things stop the numbers from deciding it alone. Three gates cannot show how
often a gate finds a `high`, or what it misses. And a `standard` build is
`builder-standard`, Sonnet 5.5, so a Sonnet gate on it is the same model
reviewing itself, which `SKILL.md`'s pairing notes rule out ("a different
model, not a cheaper one") and which PR #778 (repo-138) has just applied to the
filing row by the owner's answer of 2026-11-10.

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

The Sonnet tickets are repo-135 ($1.27, PASS), repo-143 ($1.54, CONCERNS, one
`med`) and repo-129 ($2.74, PASS). The Opus tickets are repo-130, repo-133,
repo-120, lg-69, lg-80, lg-75, lg-72, repo-121, repo-124 and repo-128; the two
`high`s are lg-72's and repo-124's.

"No more refuted at a lower cost" is the Build 5 condition of repo-139 and it
holds, but it is a tie at zero and does not discriminate: a false finding is
the only thing it counts, and a gate's misses are not in it. Only repo-143 had
a second reader (Opus, narrow, over the round), and it found no `high`;
repo-135 and repo-129 had none. If a Sonnet gate had the Opus rate of a `high`
(2 in 10), the chance of none in three is 51 %.

## Decision — open

The row today (`SKILL.md`, _Which model built it_): `standard` is
`builder-standard` (Sonnet 5.5, high) with `ticket-reviewer-opus` (Opus 5.5,
high). Costs below are from the means above and are estimates for the ten
tickets the Opus population covers, not a forecast.

- **(a) Keep the row.** Recommended, with low confidence: the owner has just
  ruled that a Sonnet filer under a Sonnet gate breaks "a different model"
  (repo-138, 2026-11-10), the three Sonnet readings cannot see misses or the
  rate of a `high`, and the row costs $3.35 a gate, $33.53 over the ten. Risk:
  paying about $1.50 a gate more than the measurement says a Sonnet gate costs,
  for protection this measurement could not show is needed. Nothing to build
  but a line in this ticket's Decision and, if wanted, a sentence in
  repo-139's Log closing it.
- **(b) Sonnet xhigh gate 1 on every `standard` ticket**, and write the
  exception into the rule sentence. Saves about $1.50 a gate, about $15 over
  ten (to $18.49). Risk: the reviewer shares the builder's model and so
  whatever that model does not notice; repo-138's owner answer declined this
  pairing for filings (its option (i)) and it would stand against that
  answer. The rule's text must change either way, and that is a decision about
  the rule, not about cost.
- **(c) Sonnet gate 1 where the first read is likely to pass, Opus when it is
  not.** Gate 1 is Sonnet; a `med` or `high` in it, or a FAIL or CONCERNS
  verdict, sends the round to an Opus gate 2 (the shape repo-143 already had).
  Saves the Sonnet-for-Opus difference on tickets that PASS at gate 1 (7 of the
  10 Opus gate 1s did; about 7 x $1.50 = $10.50 over ten) and costs roughly the
  same as today on the rest. Risk: the same same-model objection as (b) at
  gate 1, and the PASS-with-lows tickets, the ones where a miss is invisible,
  are the ones that never meet the Opus reader.
- **(d) Measure misses first.** The next batch of three `standard` tickets
  runs gate 1 on Sonnet xhigh and a second, independent gate over the same
  range on Opus, both blind to each other, then compares findings. The
  Sonnet gate is paid on top of the Opus gate: about 3 x $1.85 = $5.55 more
  than today for a reading of the misses repo-139 could not take, and no
  saving until it is read. Risk: it costs again what repo-139 cost and the
  rate of a `high` is still unmeasured at three tickets; three more tickets
  would add little.

Not offered because it was not measured: Opus at a lower effort or a narrower
depth. The ten Opus gates ran `full`, `standard` and `medium` depths and the
costs do not sort by depth (`medium`: $3.11 and $2.68; `full`: $2.65 to $4.26),
but ten rows of mixed depth cannot price an option.

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

## Done when

1. The `standard` row of the pairing table in `SKILL.md` reads the chosen
   option, and `grep -n 'different model' .claude/skills/orchestrate-tickets/SKILL.md
   .claude/skills/review-ticket/SKILL.md` finds a sentence that still holds
   for every row of the table (for (a) and (d): unchanged).
2. For (d): the batch's `reference/history.md` entry carries both gates'
   rows for each of the three tickets, and this ticket's Log states what the
   Opus gate found that the Sonnet gate did not.

## Log

- 2026-11-10 — Filed by repo-139's build (Build 5), with its Log as the
  reproduction. Options priced from the means in that Log; no estimate here
  was run as an option.
