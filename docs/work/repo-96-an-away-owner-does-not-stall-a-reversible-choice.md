---
id: repo-96
tool: repo
title: While the owner is away, the orchestrator proceeds on its recommended option for a reversible choice
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-96 — An away owner does not stall a reversible choice

## Why

tools-79's batch (dl-78 to dl-83, 2026-10-06) stopped overnight on one
question. At 04:49 a fixer stacking dl-83 onto dl-80 found that dl-80's 9 s
quiet floor pushed one of dl-83's no-media tests to 23.3 s, against a 25 s
probe budget. The fix was test-only: pass the existing timing override to
dl-79's, dl-82's and dl-83's no-media tests, which is what dl-80's own brief
says the override is for. The orchestrator held it because it changed other
tickets' tests after their gates. It was answered at 12:10, with the
recommended option, and the stack went on. **Seven hours and twenty minutes
waited on a choice that was reversible, test-only and already recommended.**

Asked on 2026-10-06 whether the orchestrator should behave differently there,
the owner chose **"proceed on the recommended option"** over "leave as is",
which was the recommendation. This is narrower than the standing rule that,
once the owner has signed off, a late decision becomes a ticket: that rule
ends the batch, and this one keeps it moving.

## Build

1. Add a bullet to `## Decisions` in
   `.claude/skills/orchestrate-tickets/SKILL.md`. **When the owner has said
   they are away**, a decision that meets every condition below is taken on
   the orchestrator's recommended option without asking:
   - it is **reversible by one revert** of a commit the batch made, on a
     branch not yet merged;
   - it touches **no contract, error taxonomy, `.claude/settings.json`,
     workflow, `Dockerfile` or allowlist**, and widens no branch into a file
     its Build did not name (that is the seam re-check in `concurrency.md`);
   - it changes **no Done-when line and no gate verdict**;
   - the orchestrator **dry-ran it** (the existing "Dry-run before you name
     it" bullet), and the recommendation does not override a builder's or a
     gate's.

   Anything else is still held, or filed as a ticket at close.

2. Say how it is flagged. The PR comment, and the report the owner reads on
   return, list each such choice: the question, the options, the one taken,
   and the commit to revert. Write it in the form `AskUserQuestion` would
   have used, so the owner can overrule it in one line.
3. Say what an away signal is: the owner says so. Silence is not one, and
   neither is a cache expiry.
4. Before writing the bullet, check its conditions against the 04:49 case.
   That case must qualify. Then check them against one held decision from an
   earlier batch in `reference/history.md` that must not qualify, and name
   it in the Log.

## Done when

1. `SKILL.md`'s `## Decisions` carries the rule with the four conditions, how
   the choice is flagged, and what counts as an away signal.
2. This ticket's Log shows the 04:49 dl-83 case passing the conditions, and
   names one earlier held decision that fails them, with the condition it
   fails.

## Log

- 2026-10-06 — filed by tools-b2 from the owner's answer to "The overnight
  stall was a held decision, not stacking. Should the orchestrator act
  differently there?". Options: leave as is (recommended); proceed on the
  recommended option (chosen). The timings come from tools-79's transcript.
  Companion to [repo-95](./repo-95-pilot-gh-stack-then-adopt-it.md), which
  covers the other half of that night's wait.
