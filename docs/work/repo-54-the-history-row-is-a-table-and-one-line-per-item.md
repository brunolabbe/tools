---
id: repo-54
tool: repo
title: The history row is the schema table and one line per item, and the narrative goes to the rule it changed
kind: chore
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-54 — The history row is the schema table and one line per item, and the narrative goes to the rule it changed

## Why

`reference/history.md` is about 3,900 lines. Its rows for the sixteenth to
twenty-third sessions run 100 to 300 lines each and were each written by a
records-only dispatch costing 100 k to 250 k subagent tokens — the eighteenth
session's row measured 175,595 for its own author, the sixteenth 251,529. The
skill tells a reviser to read the page and nobody can: the 2026-09-20 sweep
read it in five chunks to find that eight rows carried about seventy items and
that none had changed a rule.

The rows have two proven values. The schema table, which let the ninth session
recover counts the orchestrator had lost, and the "what the skill got wrong"
field, which is the only source every rule on the pages was written from. The
rest — the re-narration of each finding, the "what went right" lists, the
per-agent prose — is where the length comes from, and since 2026-09-20 step 12
sends each item's substance to the rule page it changes, where it is read at
the step that needs it.

## Build

1. Rewrite the schema section of `history.md` so a row is: the schema table;
   then `what the skill got wrong` as one bullet per item, each ending with
   the page and heading the fix landed under or the ticket id it was filed
   as; then, optionally, `what went right` as one line per entry. No
   subsection may exceed one paragraph. Say that a measurement worth keeping
   goes on the rule's page as a dated clause, and that the row points at it.
2. Say the row is written by a `mechanical` dispatch on Haiku from the
   orchestrator's account and the accounting table, with the verification the
   records-only dispatches have been doing — re-reading verdicts and counts
   from `git show` — kept as a checklist of one line per field.
3. Do not rewrite the existing rows. Add a one-line note at the schema saying
   rows before this ticket are in the older shape.

## Done when

- The schema section states the shape and the cap, with this ticket as its
  measurement.
- The next session's row, written under it, is under 60 lines and its author
  dispatch reports under 80 k subagent tokens; both figures recorded in this
  Log by that session.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history.
- 2026-09-20 — Built on `orchestrate-skill-sweep` by the orchestrating session, on the owner's call to build the seven filings there rather than later: the schema section of `history.md` now fixes the row shape and the cap, names the Haiku maintenance dispatch that writes it, and keeps the records-only verification as a checklist; earlier rows are marked as the older shape. The second Done when line is the next session's to record here.
