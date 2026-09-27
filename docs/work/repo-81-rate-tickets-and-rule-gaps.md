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
