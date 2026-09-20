---
id: repo-56
tool: repo
title: A maintenance dispatch runs on Haiku by rule, not by the orchestrator's mood
kind: chore
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-56 — A maintenance dispatch runs on Haiku by rule, not by the orchestrator's mood

## Why

The builder's model table maps `difficulty` to a model for tickets. A batch
also dispatches work that has no ticket and no difficulty: the history row, a
rebase after a sibling merges, a pin repair, a one-line Log reword, a merge of
`main` into an open branch. The twenty-first session measured what those cost
when routed by habit:

| dispatch                                            | model          | subagent tokens    |
| --------------------------------------------------- | -------------- | ------------------ |
| one-line Log reword                                 | haiku          | 70,665             |
| the same builder resumed for it would have reloaded | sonnet         | 784,264            |
| merge `main` into `dl-55`                           | haiku          | 37,902             |
| merge `main` into `dl-63`                           | haiku          | 30,224             |
| rebase the history row                              | haiku          | 61,654             |
| pin repairs on three PRs                            | sonnet         | 265,947            |
| the history row itself, other sessions              | opus or sonnet | 103,556 to 251,529 |

Every Haiku row produced a correct artefact and the orchestrator chose Haiku
each time by judgement; the pages say nothing, so the next orchestrator
resumes a 784 k builder for a reword. The twentieth session's filers ran on
Opus at 101 k and 152 k for tickets that build nothing.

## Build

Add a row to the model table in `builder.md` and `SKILL.md`'s _Which model
built it_: **maintenance** — a dispatch with no ticket or with `kind: chore`
and no source change: a history row, a rebase, a merge from `main`, a citation
pin, a Log edit, a filing whose reproduction is already in hand — runs on
`haiku`, and its gate, where one runs, on `sonnet`. Say the test is the
absence of a judgement call, not the size of the diff, and that a maintenance
dispatch that finds one stops and reports rather than making it. Cite the table
above as the measurement.

Add the same to `dispatching.md`'s builder-prompt list: name the dispatch as
maintenance in the prompt so the agent knows to stop on a judgement call.

## Done when

- Both tables carry the row with the measurement.
- The next batch's accounting table shows its maintenance dispatches on
  `haiku`, recorded in this Log with their token figures beside the
  twenty-first session's.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history.
- 2026-09-20 — Built on `orchestrate-skill-sweep` by the orchestrating session: the maintenance row is in both model tables (`SKILL.md` _Which model built it_, `builder.md`) with the twenty-first session's measurements, and `dispatching.md`'s builder-prompt list says to name a maintenance dispatch as one. The second Done when line is the next batch's to record here.
