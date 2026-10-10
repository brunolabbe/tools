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
- 2026-10-10 — built. One bullet added to `## Decisions` in
  `.claude/skills/orchestrate-tickets/SKILL.md`, after the "every" bullet: the
  away signal, the four conditions, the flag, and how it sits beside the
  sign-off rule. No other page edited; the one cross-reference into repo-95's
  files is a prose pointer to `reference/concurrency.md`'s "Re-check the seams
  whenever an owner decision widens a branch", made from `SKILL.md` only.

  **Step 4, the 04:49 dl-83 case, against the four conditions.** The facts are
  the Why's, from tools-79's transcript, which this build did not re-measure
  (the 9 s floor, 23.3 s against 25 s, 04:49 and 12:10 are relayed). What
  could be read on `main`: dl-80's Build step 3 says the floor is "overridable
  through the resolver's options as `quietMs` already is, so unit tests that
  expect `NO_MEDIA_FOUND` don't each pay the floor"
  (`tools/downloader/docs/work/dl-80-the-probe-gives-up-before-a-late-player-starts.md`).
  1. Reversible by one revert: passes. The fix was one commit passing the
     existing override to three no-media tests, on stacked branches not merged.
  2. No contract, taxonomy, settings, workflow, `Dockerfile` or allowlist:
     passes, since test files only. Widens no branch into a file its Build did
     not name: passes in the sense that matters, because dl-79, dl-82 and dl-83
     each already had a no-media test, though the edit lands in a file those
     branches' Builds did not list; the conditions as written do not settle
     that, and the seam re-check would have been the test.
  3. No `Done when` line and no gate verdict: passes. The gates' records stand
     as written. The orchestrator held it because it edited tests after their
     gates, which is a reason to flag the choice and offer a re-gate, not a
     verdict changed.
  4. Dry-run, and no builder's or gate's recommendation overridden: passes as
     the Why describes it. The fixer found the override use, and it was the
     recommended option when asked.
     So it qualifies, with the one soft spot in condition 2 named above. I did not
     tighten the wording to remove it: the ticket's Build gives the four conditions
     and the Done-when asks for them as written.

  **An earlier held decision that fails them:** `reference/history.md`,
  "Fifteenth session — 2026-09-09", item 2 under "What the skill got wrong",
  and `docs/work/repo-32-*.md` `Done when` 6b: what `awaiting` means (three
  readings; the owner chose A, "waiting on an event that will happen"). It was
  held, with `status: in-flight`, until answered. It fails **condition 3**: the
  question is a `Done when` line of repo-32 itself, "the meaning of `awaiting`
  … is put to the owner before the parser is written, and the answer recorded
  here". It fails **condition 4** as well: the gate and the orchestrator read
  the instances one way and the builder another (repo-32's Log, the 2026-09-07
  entry "Answered by the owner: option A", under "The classification is
  disputed"), so no one recommendation could be taken over a builder's or a gate's. Run
  with `grep -n "Fifteenth session" .claude/skills/orchestrate-tickets/reference/history.md`
  → line 1946; `sed -n 1974,1998p` of the same file for the item. History has
  no row saying the owner was away for it, so it fails on the conditions alone,
  with or without an away signal.

  **How the two rules coexist,** as the bullet words it: the standing rule
  (a decision arriving after the owner has signed off becomes a ticket and the
  turn ends in `# Done`) closes a batch; this one keeps an unfinished batch
  moving while the owner says they are away. A sign-off, not an away signal, is
  what moves a decision from this bullet to that rule. That standing rule is
  the owner's practice (the Why calls it "the standing rule"); no page in the
  skill states it, so the bullet describes it rather than linking to it.

  **Fold-in.** Nothing else was made free, and I could have looked for more
  only in `roles/` and `reference/concurrency.md`, which are repo-95's seam.
