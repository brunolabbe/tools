---
id: repo-81
tool: repo
title: Rate repo- tickets at filing, and fix six small rule gaps
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-81 — Rate tickets at filing and fix rule gaps

## Why

This batch exposed gaps in the rules and ticketing process:

- 4 of the batch's 5 intake tickets had no `difficulty`, so each defaulted to Opus. repo-72, a ~20-line fix, cost $1.48 on Opus.
- Six rule gaps, each hit by builders this batch:
  1. "New tests go at the end of a suite" is in no role page; three builders hit it (repo-63, repo-71, repo-72).
  2. `SKILL.md` step 9 writes `review-record.mjs --verify <ticket>`, but it needs the ticket path; an id fails.
  3. `roles/builder.md` never mentions `needs-decision`, the status for filed tickets waiting on a decision.
  4. `reference/dispatching.md`'s "curl it once before you dispatch" should check the firewall state first.
  5. `gh run view <run> --job <id> --log` returned the wrong attempt's log; `--attempt N --log` is right.
  6. A landing's own splice can move a line another ticket's merged record cites; no page says whose repoint that is.

## Build

Add a "rate it at filing" line to `docs/01-TICKETS.md`. Fix each of the six rule gaps in the page that holds the rule.

## Done when

Each of the six has a sentence in its page; `npm run check` passes; no new `file:line` citation.

## Log

2026-09-27 — Built gaps 1–5; gap 6 delivered by repo-78.

**Questions asked at intake:** Which repo- tickets does this batch build? Options: (a) repo-78 + repo-79 + repo-81, with gap 6 moved to repo-78; (b) 78 + 79 only; (c) 77 + 81 only; (d) all five stacked. Owner chose (a).

**Work done:**

- Gap 1 (new tests go at end): Added to roles/builder.md § Scope with explanation of why (shifts lines, breaks citations)
- Gap 2 (SKILL.md --verify path): Changed `<ticket>` to `<ticket-path>` in step 9; tested both: id fails with "fatal: path not found", path works (verified with docs/work/repo-1-generated-status-tables.md)
- Gap 3 (needs-decision): Added explanation to roles/builder.md noting builders never dispatch needs-decision tickets
- Gap 4 (firewall check): Updated reference/dispatching.md curl guidance to check firewall state first and ask owner to open if needed
- Gap 5 (gh run view): Changed documentation in SKILL.md from `--log-failed` to `--attempt N --log` for retried runs
- Rate it at filing: Added new section at end of docs/01-TICKETS.md (positioned there to avoid shifting cited lines) with cost example and link to difficulty explanation

`npm run check` exit 0, `npm run format` clean, `preflight.mjs` exit 0.

**Omitted:** Gap 6 ("a landing's own splice can move a line another ticket's merged record cites; no page says whose repoint that is") is delivered by repo-78 on branch `repo-78-gate-records-pin-to-base`, per owner's decision at intake.
