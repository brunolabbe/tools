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
  sign-off rule. No other page edited. The first draft pointed at
  `reference/concurrency.md`'s seam re-check from `SKILL.md`; round 1 dropped
  the pointer, since condition 2 became a path test the re-check cannot decide.

  **Step 4, the 04:49 dl-83 case, against the conditions as reworded in round 1
  (below).** The Why's timings (the 9 s floor, 23.3 s against 25 s, 04:49 and
  12:10) are tools-79's transcript, which this build did not re-measure. What
  git shows: the fix is **two commits on two branches**, not one. `76113c54`
  (12:20 UTC on 2026-10-06, 38 lines) is on `origin/dl-80-quiet-floor` and on
  `origin/dl-83-age-gate-phrasings`, and carries dl-79's and dl-82's no-media
  tests. `b5e45c72` (12:43 UTC, 22 lines) is on `origin/dl-83-age-gate-phrasings`
  only. Each touches only
  `tools/downloader/resolvers/test/browser/browser-resolver.test.ts`
  (`git show --stat 76113c54 b5e45c72`; `git branch -r --contains` for each),
  and each adds `emptyMinWaitMs: NO_EMPTY_FLOOR_MS` to `new BrowserResolver({…})`
  calls, the override dl-80's Build step 3 asks for ("overridable through the
  resolver's options as `quietMs` already is, so unit tests that expect
  `NO_MEDIA_FOUND` don't each pay the floor").
  1. One revert on each unmerged branch it touched: passes. One commit per
     branch, so two reverts in all, and neither branch had merged.
  2. Path test: passes. No forbidden path, and the file was already in each
     branch's own diff against its base (dl-80: `4c194fd9`, `d956a450`; dl-83:
     `2cac7900` and five more). Run: `node conditions.mjs <repo> "04:49 on dl-80"
056aab75 dl-80 <ticket> 76113c54` → `c2a(no forbidden path)=true
c2b-diff(no new path)=true`, and `… 5ad7f739 dl-83 <ticket> b5e45c72` →
     the same. The script is the gate's, in its scratch. **Read literally, the
     brief's wording "widens no branch into a file its Build did not name"
     fails the case** (`c2b-literal(Build names file)=false` on both), because
     neither Build names the test file; the rewording to a path test is why it
     passes.
  3. No `Done when` line, no reserved decision, no gate verdict: passes. Neither
     commit edits a ticket. Both land after committed gate records (dl-80 gate 2
     `c49b327d`, dl-83 gate 3 `2a2b8907`, both ancestors of the fix commits), so
     the case is a commit after a gate. It changes lines inside tests the gates
     read, but only a setup argument in the constructor call: no assertion and
     no code under test. That is the reading the bullet's wording takes.
  4. Dry-run, and no builder's or gate's recommendation overridden: as the Why
     describes it, unmeasured here. The Why says the choice was the recommended
     option when asked.
     So it qualifies. It was a fixer's question, which is why the bullet names the
     rule it is an exception to.

  **An earlier held decision that fails them:** `reference/history.md`,
  "Fifteenth session — 2026-09-09" (line 1946), item 2 under "What the skill
  got wrong" (lines 1974–1998), and `docs/work/repo-32-*.md` `Done when` 6b:
  what `awaiting` means (three readings; the owner chose A, "waiting on an
  event that will happen"). It was held, with `status: in-flight`, until
  answered. It fails **condition 3** only on the reading the bullet now states:
  it takes "a decision a ticket's `Done when` … reserves to the owner", since
  6b says the meaning "is put to the owner before the parser is written", and
  taking A unasked would have left 6b unmet. It does not edit the line. It does
  **not** fail condition 4: round 1's gate found repo-32's Log, "2026-09-09,
  later", saying "A matches the builder's recommendation, so it overrode
  nobody", and the earlier version of this entry claimed otherwise from the
  2026-09-07 "classification is disputed" passage, which concerns which
  instances fit and not which reading to recommend. History has no row saying
  the owner was away for it, so it fails on the conditions alone.

  **How the two rules coexist,** as the bullet words it: the rule that a
  decision arriving after the owner has signed off becomes a ticket (the owner's
  practice; no page in the skill states it, and `grep -rn -i "signed off\|sign-off"
.claude/skills CLAUDE.md docs/01-TICKETS.md` matches only this bullet)
  closes a batch; this one keeps an unfinished batch moving while the owner
  says they are away. A sign-off, not an away signal, moves a decision from this
  bullet to that rule.

  **Fold-in.** Nothing else was made free, and I could have looked for more
  only in `roles/` and `reference/concurrency.md`, which are repo-95's seam.

- 2026-10-10, later — **round 1: gate 1 FAILED `781587b4`** (one high, three
  med, two low). **Owner answer, 2026-10-10,** put by the coordinator with the
  gate's open decision and its "no gate verdict" med folded in. Question: how
  should the bullet's conditions 1, 2 and 3 be worded, given the 04:49 case is
  two commits on two branches and edits a file neither Build names? Options:
  (1) reword to what was meant: condition 1 becomes one revert on each unmerged
  branch it touched, condition 2 a path test (adds no new path to any branch's
  own `git diff --name-only`), condition 3 lets a commit made after a gate
  qualify if it changes no line a gate graded; (2) keep the wording, and record
  that 04:49 does not qualify; (3) reword 1 and 2, but a post-gate commit never
  qualifies. **Chosen: (1)**, which was the gate's and the coordinator's
  recommendation, so it overrode no one's. The earlier entry's "one commit" and
  "each already had a no-media test" were wrong and are rewritten above from
  `76113c54` and `b5e45c72`. How each finding came out:
  - high (04:49 fails as worded): confirmed with the gate's script, see
    condition 2 above; fixed by the rewording.
  - med (repo-32 fails condition 4 on a refuted claim): confirmed against
    repo-32's Log (`grep -n "overrode nobody" docs/work/repo-32*.md` → line
    744); condition 4 claim dropped, condition 3 stated as the failing one and
    the bullet now says what it reads as.
  - med (absorbs a subagent's decision): the bullet now names the two rules it
    is an exception to and says the answer goes back down as the orchestrator's
    choice under this rule, not the owner's.
  - med ("no gate verdict" needs judgement): the bullet states the post-gate
    rule and asks the flag to name the gate's record, so the owner can order a
    re-gate.
  - low (allowlist names no file): now `.devcontainer/allowed-domains.txt` and
    `.gitignore`'s `.claude/` allowlist.
  - low (root `CLAUDE.md` narrowed without naming it): named, with "a taken
    choice, not an open decision at close". **That last clause is my reading**,
    reported to the coordinator as an open decision.
  - **Open, from the owner's wording:** "changes no line a gate graded" read
    literally fails the 04:49 case, because the fix changes constructor lines
    inside tests the gates graded. The bullet words it "no assertion and no
    code under test that the gate graded", which lets 04:49 pass; that is my
    reading of what the owner meant.
