---
id: repo-96
tool: repo
title: While the owner is away, the orchestrator proceeds on its recommended option for a reversible choice
kind: chore
status: done
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

## Review

**Gate: FAIL** — 2026-10-10 · `7709411e..781587b4` · Opus 5.5, depth narrow

| Done when                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `## Decisions` carries the rule, four conditions, the flag, the away signal                           | **verified**: read in `.claude/skills/orchestrate-tickets/SKILL.md` › _Decisions_, "While the owner is away, a reversible choice is taken, not held". All four conditions, the flag (PR comment and return report, in `AskUserQuestion` form, with the commit to revert) and the away signal (the owner says so; silence and cache expiry are not) are there. PR #411 `check` passed on `781587b4`. Docs-only, so no test is possible |
| 2. Log shows the 04:49 dl-83 case passing; names an earlier held decision that fails, with the condition | **not met**: see F1 and F2. The showing for condition 1 rests on a fact that git contradicts. For condition 2 the Log itself says the text "does not settle" the case, and read literally the text fails it                                                                                                                                                                                                                           |

- **high** · Done when 2 depends on it · **The 04:49 case does not pass the
  bullet as written, and the Log's showing rests on two claims that git
  contradicts.** The fix as built is two commits on two branches:
  `76113c54` on `origin/dl-80-quiet-floor` (dl-79's and dl-82's tests) and
  `b5e45c72` on `origin/dl-83-age-gate-phrasings` (dl-83's). Both edit only
  `tools/downloader/resolvers/test/browser/browser-resolver.test.ts`
  (`git show --stat 76113c54 b5e45c72`; `git branch -a --contains` for each).
  - Condition 1, "reversible by **one revert** of a commit": the Log says
    "The fix was one commit". It took two reverts, one on each branch.
  - Condition 2b, "widens no branch into a file its Build did not name": the
    Log argues from "dl-79, dl-82 and dl-83 each already had a no-media test".
    The edits did not land on dl-79's or dl-82's branches. Neither dl-80's
    nor dl-83's Build names the test file, so the case fails the clause read
    literally. It passes only on a path reading: the file was already in each
    branch's own commits (dl-80: `d956a450`, `4c194fd9`; dl-83: `3fc1968f`
    and five more).
  - The clause's parenthetical points to `reference/concurrency.md`'s seam
    re-check. That re-check starts from the same Build-relative wording and
    "guarantees nothing", so it cannot decide pass or fail.
  - Verdict on attack 1: **the bullet is worded wrong**, not the ticket
    self-contradictory. The wording is inherited word for word from the
    brief's Build step 1, whose own parenthetical intends the path reading.
  - Reproduction: `node conditions.mjs <tree> "04:49 on dl-80" 056aab75 dl-80 <dl-80 ticket> 76113c54`
    → `c2b-literal(Build names file)=false c2b-diff(no new path)=true`. The
    same result for `b5e45c72` against dl-83. **Open decision:**
    - (a) **Recommended.** Reword 2b to "adds no path to any branch's
      `git diff --name-only` against its base". Reword 1 to "one revert on
      each unmerged branch it touched". Rewrite the Log's condition 1 and 2
      paragraphs from the two commits.
    - (b) Keep the brief's wording, and record that 04:49 does not qualify.
      That contradicts Done when 2 and the owner's 2026-10-06 choice.
- **med** · Done when 2 depends on it · **The named held decision fails
  condition 4 only on a claim its own cited source refutes.** The decision is
  as the Log says: repo-32's meaning of `awaiting`, A/B/C, owner chose A
  (`reference/history.md`, "Fifteenth session — 2026-09-09", item 2;
  repo-32 `Done when` 6, struck sentence).
  - Condition 4: repo-32's Log, entry "2026-09-09, later", says "**A matches
    the builder's recommendation, so it overrode nobody.**" The 2026-09-07
    "classification is disputed" passage the Log cites is about which
    instances fit, not about which reading to recommend.
  - Condition 3: it fails only if "changes no `Done when` line" is read as
    "takes no decision a `Done when` line reserves to the owner". Taking A
    unasked would leave 6b ("put to the owner") unmet. It would not edit the
    line.
  - Remedy: drop the condition-4 claim. Either say condition 3 is met on that
    reading and make the bullet say it ("no decision a ticket's `Done when`
    or Decision reserves to the owner"), or name a held decision that plainly
    fails a path or gate condition.
- **med** · no `Done when` line depends on it · **The bullet lets the
  orchestrator absorb a subagent's open decision.** That contradicts the bullet
  above it in the same section, "A subagent's open decision is yours to
  forward, not to absorb", and it gives no reason. The 04:49 decision was a
  fixer's. Nor does the bullet say the answer goes back down labelled as
  _your_ choice rather than the owner's, which that bullet's provenance rule
  requires. A builder's Log could record an owner's answer that never happened.
- **med** · no `Done when` line depends on it · **Condition 3's "no gate
  verdict" needs judgement the bullet does not admit.** Both 04:49 commits land
  after committed gate records (dl-80 gate 2 `c49b327d`; dl-83 gates 1–3
  `a6f3b474`..`2a2b8907`), which is exactly why it was held. Whether editing a
  gated head "changes a verdict" is not said. The Log's answer ("flag the choice
  and offer a re-gate") is not in the bullet.
- **low** · "allowlist" names no file. Candidates:
  `.devcontainer/allowed-domains.txt` (the egress allowlist, per
  `.devcontainer/README.md`) and `.gitignore`'s `.claude/` allowlist.
  `.claude/settings.json` is already named.
- **low** · Root `CLAUDE.md` › _Decisions_ says "ask, with `AskUserQuestion`"
  with no carve-out, and _Handing back_ withholds `# Done` from "a branch
  carrying an open decision". The bullet narrows the first without naming it.
  It does not say whether a flagged-but-taken choice is open at close. The
  "signed off becomes a ticket" rule it contrasts with is stated nowhere else
  in the repo (`grep -rn -i "signed off\|sign-off" .claude/skills CLAUDE.md docs/01-TICKETS.md`
  matches only this bullet).
- **positive control** · The same `conditions.mjs` on `beb0289b` (dl-73's
  owner-decided rewording of `Done when` 2) gives
  `c2a(no forbidden path)=false c2b-diff(no new path)=false c3(no Done-when edit)=false`:
  it touches `.github/workflows/downloader.yml`, adds
  `resolvers/test/ytdlp.test.ts` and edits `## Done when`. The bullet as
  written rejects it on conditions 2 and 3. A choice made against a gate's
  verdict is rejected by condition 4's text ("does not override … a gate's
  recommendation"). That needs no command.
- **unmeasured** · the 04:49 and 12:10 timings, and whether the orchestrator
  dry-ran the fix. Both are tools-79's transcript, and no history row exists
  for that batch.
- **findings** · the hunt returned 7; 6 carried (1 high, 3 med, 2 low), 1
  dropped. Dropped: the Log's "no page in the skill states" the sign-off rule
  is true, and it is folded into the second low.
- NFR: security n/a · performance n/a · reliability: the high and the gate-verdict med · maintainability: the lows above.

### Gate 2

**Gate: CONCERNS** — 2026-10-10 · `781587b4..9768f418` (round: `9768f418` only) · Opus 5.5, depth narrow

| Done when                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `## Decisions` carries the rule, four conditions, the flag, the away signal                     | **verified**: read in `.claude/skills/orchestrate-tickets/SKILL.md` › _Decisions_, "While the owner is away, a reversible choice is taken, not held". PR #411 `check` passed on `9768f418`                                                                                                                                                                                                      |
| 2. Log shows the 04:49 case passing; names an earlier held decision that fails, with the condition | **verified** against the bullet's wording. The facts in the Log are re-measured (two commits, 38 and 22 lines, test file only, gate records are ancestors) and `conditions.mjs`/`c3.mjs` pass both halves. repo-32 fails condition 3's "reserves to the owner" clause, which is now in the bullet's text. Against the owner's literal wording the 04:49 case fails: see the open decision below |

**Gate 1's findings**

- **high**, 04:49 fails as worded and the Log rests on false facts: **fixed**.
  - Condition 1 is now "one revert on each unmerged branch it touched".
  - Condition 2 is now a path test: no new path in any branch's
    `git diff --name-only`. Re-run: `c2a=true c2b-diff=true` on `76113c54` and
    `b5e45c72`.
  - The Log now says two commits. `76113c54` has 32+6 lines and `b5e45c72`
    has 19+3. The Log names the branches right: `76113c54` reaches dl-83 only
    through the merge `fe4f6e40`.
- **med**, repo-32 fails condition 4 on a refuted claim: **fixed**. The claim
  is dropped. The "reserves to the owner" reading is in the bullet's own
  condition 3: "takes no decision a ticket's `Done when` or Decision section
  reserves to the owner". repo-32 fails it on two lines: `Done when` 1 ("answered
  by the repo's owner") and 6's struck sentence ("put to the owner before the
  parser is written").
- **med**, absorbs a subagent's decision: **fixed**. The bullet names
  _A subagent's open decision is yours to forward, not to absorb_ as the rule it
  is an exception to. It also sends the answer down as "your choice under this
  rule, not the owner's".
- **med**, "no gate verdict" needs judgement: **not fixed in full**. See the
  new med below.
- **low**, allowlist names no file: **fixed**. It now names
  `.devcontainer/allowed-domains.txt` and `.gitignore`'s `.claude/` allowlist.
- **low**, root `CLAUDE.md` narrowed without naming it: **fixed**. The bullet
  names the root `CLAUDE.md` "Decisions" rule and says how the choice stands at
  close.

**This round**

- **open decision** · med · Done when 2 depends on it · **The bullet's
  post-gate rule is not the owner's wording, and the 04:49 case passes only
  the bullet's.**
  - The owner chose: "a commit after a gate qualifies if it changes no line a
    gate graded".
  - The bullet says: "only if it changes no assertion and no code under test
    that the gate graded".
  - Read literally, both 04:49 commits change lines inside tests that a gate
    record names. In dl-79's record: "a probe that saw only segments says so
    in the error's reason". In dl-82's: "presses neither a pagination link nor
    a vote button…". In dl-83's: "an Italian gate in a fixed layer, not told
    to confirm…" and "a gate whose layer lives in an open shadow root is
    recognised".
  - `node c3.mjs <tree> … 76113c54 <dl-79, dl-82, dl-80 tickets>` →
    `owner-literal(no graded line changed)=false bullet(no assertion, no src)=true`.
    Same for `b5e45c72` against dl-83.
  - The owner chose the option "to make the 04:49 case pass", so the literal
    wording defeats the owner's stated purpose. The builder disclosed this in
    the Log as its own reading.
  - Per _An answer given on a premise a later measurement changed is
    re-asked_, this goes back to the owner with the measurement. Options:
    - (a) **Recommended.** Keep the bullet's wording and close the hole in the
      next bullet: add "and no fixture, page or data a graded test reads". The
      04:49 case still passes, since it changes a constructor option only.
    - (b) Keep the bullet as it is.
    - (c) Take the owner's literal wording. Then 04:49 does not qualify and
      Done when 2 is not met.
- **med** · no `Done when` line depends on it · **The post-gate rule admits a
  commit that guts a graded test.** Planted on a scratch tree at `76113c54`,
  in dl-82's graded "presses neither a pagination link nor a vote button…":
  - P1 deletes one `expect(...).not.toContain(...)`. Result:
    `bullet(no assertion, no src)=false`, so the bullet rejects it.
  - P2 swaps `probeError("/consent-lookalikes.html", …)` for
    `"/untyped-no-segments.html"`. No assertion changes and no source changes,
    and the test's subject page is gone. Result:
    `bullet(no assertion, no src)=true`. The bullet does not reject it.
  - P2 is then held back only by "changes no gate verdict", which is the
    judgement gate 1's med named. Remedy: option (a) above.
- **low** · "For a commit made after a gate, name that gate's record" does not
  say which gate.
  - `76113c54` lands after dl-80's gate 2, `c49b327d`, which is the one the
    Log names. The tests it changes were graded by dl-79's and dl-82's gates.
  - Suggested wording: "the record of each gate that graded a line it
    changes".
- **low** · The Log's reproduction `git branch -r --contains` for `76113c54` and
  `b5e45c72` now returns nothing. After this fetch, no ref contains either
  commit (`git for-each-ref --contains <sha>` → empty): the dl-80 and dl-83
  branches were deleted after merging. Cite the pull requests' head refs
  instead.
- **checked, no finding** · "A choice taken this way is a taken choice, not an
  open decision at close" against root `CLAUDE.md` › _Handing back_. The root's
  test is that the next move is the user's to choose ("each of those ends in
  `AskUserQuestion`"). It already treats a pull request left for the owner as
  done ("Whatever the user still owns goes _under_ the heading"). A flagged
  choice the owner may overrule in one line belongs under the heading in the
  same way. The two are consistent.
- **findings** · gate 1's 6: 5 fixed, 1 not fixed in full. This round's hunt
  returned 5: 4 carried (2 med, one of them the open decision; 2 low), 1
  checked with no finding (_Handing back_).
- NFR: security n/a · performance n/a · reliability: the post-gate med · maintainability: the lows.
- No `high`.

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
  (12:20 UTC on 2026-10-06, 38 lines) is in the head of pull request #372 (dl-80)
  and of #374 (dl-83), and carries dl-79's and dl-82's no-media
  tests. `b5e45c72` (12:43 UTC, 22 lines) is in the head of #374 (dl-83)
  only. Each touches only
  `tools/downloader/resolvers/test/browser/browser-resolver.test.ts`
  (`git show --stat 76113c54 b5e45c72`; the pull requests' head refs, below),
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

- 2026-10-10, later still — **round 2: gate 2 CONCERNS `9768f418`** (no high;
  one open decision, one med, two low). The coordinator re-asked the owner two
  questions the same day, the first with gate 2's measurement. Both answers are
  recorded here as given.
  1. **Question:** "Read literally, your rule 'a post-gate commit qualifies if it
     changes no line a gate graded' excludes the 04:49 case… Which wording?"
     **Options:** (a) "No assertion, no code under test, no fixture a graded
     test reads" (gate 2's (a); recommended by the gate and the coordinator);
     (b) "Keep the builder's wording as is"; (c) "Your literal wording".
     **Chosen: (a)**, on 2026-10-10. The bullet's post-gate condition now reads
     "changes no assertion, no code under test, and no fixture, page or data a
     graded test reads". It is the recommended option, so it overrode no one's.
  2. **Question:** "repo-96's bullet says a choice taken under the away rule 'is
     a taken choice, not an open decision at close'… Keep that sentence?"
     **Options:** "Keep it" (recommended by the builder; gate 2 found it
     consistent with root `CLAUDE.md` › _Handing back_); "Drop it".
     **Chosen: keep it**, on 2026-10-10. No text change.

  **Done when 2 against the new wording.** Gate 2's `c3.mjs`, extended as
  `c4.mjs` with one more test: no non-test file in the diff, and no changed line
  naming a page or data file (`"…\.(html|json|m3u8|mpd|xml|txt)"` or
  `"…fixtures/…"`) in the test. The script is in the lander's scratch, not the
  repo. Run on `76113c54` and `b5e45c72` as committed, and on the planted fixture
  swap P2 from gate 2 (a scratch tree at `76113c54`, line 1054 of
  `browser-resolver.test.ts`, `probeError("/consent-lookalikes.html", resolver)`
  changed to `probeError("/untyped-no-segments.html", resolver)`):
  - `76113c54` →
    `RESULT old(no assertion, no src)=true NEW(no assertion, no src, no fixture/page/data)=true`
  - `b5e45c72` → the same line, `NEW(…)=true`.
  - P2 →
    `fixture/page/data line changed: +      const error = await probeError("/untyped-no-segments.html", resolver);`
    and `RESULT old(no assertion, no src)=true NEW(no assertion, no src, no fixture/page/data)=false [assertionChanged=false srcChanged=false fixtureChanged=true]`.

  So 04:49 passes the new wording and the swap that the old wording admitted is
  now rejected. This does not decide the case where the swapped fixture is
  referenced by a name the pattern does not match (a constant, a computed path);
  the script reads literals only.

  **Gate 2's finding that the `git branch -r --contains` reproduction returns
  nothing:** confirmed, the dl-80 and dl-83 branches are deleted. The pull
  requests' head refs reproduce it:

  ```
  git fetch origin refs/pull/372/head:refs/remotes/pr/372 refs/pull/374/head:refs/remotes/pr/374
  git for-each-ref --contains 76113c54 refs/remotes/pr
  5ad7f739e873ed03e43ed0f51c43deed9f95a778 commit	refs/remotes/pr/372
  c9a2c45fc6134e9f05972804bd09648692aba976 commit	refs/remotes/pr/374
  git for-each-ref --contains b5e45c72 refs/remotes/pr
  c9a2c45fc6134e9f05972804bd09648692aba976 commit	refs/remotes/pr/374
  ```

  **Left unfixed, recorded by the severity floor:** gate 2's first low, that the
  bullet's "name that gate's record" does not say which gate (suggested: "the
  record of each gate that graded a line it changes").
