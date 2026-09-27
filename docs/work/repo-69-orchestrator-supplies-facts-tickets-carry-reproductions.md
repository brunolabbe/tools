---
id: repo-69
tool: repo
title: The orchestrator supplies the facts; decision tickets carry reproductions only
kind: chore
status: ready
milestone: null
depends_on: []
---

# repo-69 — the orchestrator supplies the facts; decision tickets carry reproductions only

## Why

**From the orchestrator's own measurement of the 2026-09-27 batch, not a
primary source this ticket can point at directly** — the owner asked for
this ticket after reading that batch's process review.

Two recurring failures this batch, both from a builder or a ticket
reconstructing a fact from evidence it had not itself gathered:

- The history row's backwards `-err_detect` attribution: it credited a
  reviewer with refuting its own recommendation, when the builder had
  refuted it first and the reviewer only confirmed. That came from a builder
  reconstructing events it never directly saw, and cost a round to undo.
- `repo-65`'s decision paragraph was rewritten four times inside one chore
  pull request, because each gate found another false premise in it — the
  order the role pages actually prescribe, what check 2 actually reads, and
  a third place under option (a) the orchestrator itself later found by
  reading `main` directly.

## Build

- The orchestrator drafts the fact list a history row or a filed ticket's
  Why depends on, from its own read of primary sources, before handing it
  to a builder to write up.
- A gate checks that fact list against the sources it cites, the same way
  gates already check other claims in this skill.
- A ticket filed out of a step-12 close-out PR carries its reproduction (a
  command and its output), not a claim reconstructed from a summary; its
  options, where it poses a decision, are drafted from a fresh read at the
  time the owner is asked, not carried forward from an earlier draft that
  may have gone stale.

## Done when

- `SKILL.md` step 12 (or wherever the history row's authorship is
  specified) says the orchestrator supplies the fact list, not the builder.
- The role page for whichever gate checks a history row or a filed ticket's
  Why states that it verifies the fact list against primary sources.
- A worked example or a test fixture shows the shape: a fact list with one
  deliberately wrong entry, and the gate step catching it.

## Log

- 2026-09-27 — Filed on the owner's decision, from an `AskUserQuestion` after
  reading the orchestrator's process review of this batch. Not built here.
