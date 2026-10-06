---
id: repo-88
tool: repo
title: what verdict a gate gives a faithful build of an unmeetable Done-when line, or a line proven only by a release
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-88 — what verdict a gate gives an unmeetable Done-when line

## Why

`.claude/skills/review-ticket/gate.md` (_Severity and the gate_) has no verdict
for two cases that both recurred in the 2026-09-30 batch, and each time the gate
settled it by hand:

1. **A faithful build of a Done-when line that cannot be met.** The brief asks
   for something its own Decision cannot deliver, and the builder built exactly
   what the Decision says. repo-49's gate 1 graded it **FAIL "by the letter"**,
   because the Decision's filter could not satisfy Done-when 1. The build was
   not wrong; the brief was, and the question of what to do about it was an
   open decision the gate found by measurement (4 of 11 lines were name claims
   the filter cannot clear).
2. **A line proven only by a post-merge release.** repo-46's Done-when 1 and 3
   can only be proven once a release commit exists. Its gate 3 graded both
   `unproven (gate)` and the verdict **CONCERNS**, resting on those two lines
   alone. The four row verdicts in step 4 have no entry for "proven, but only
   after the merge", so the gate used the nearest one.

The gate's rule for `PASS` is "every acceptance line proven or verified", so
neither case can be a PASS today, and whether each is a FAIL or a CONCERNS is
left to whoever happens to be gating. The same facts got FAIL in one record and
CONCERNS in another.

A builder on this batch's close-out drafted two new verdict bullets for
`gate.md`, `proven (post-merge)` and `open decision`, and that draft was
dropped: it stated neither a verdict effect nor a rule (the gate's finding F7 on
PR #329), and it contradicted repo-46's own gate 3.

## The decision

What verdict does a gate return for each case? Options, from the gate's F7. **No
recommendation is set here; it is the owner's to choose.**

1. **Both cases yield CONCERNS.** A line proven only by a post-merge release is
   graded like `unproven (gate)`: CONCERNS, with the line named. An open
   decision found on a faithful build is CONCERNS, not FAIL, and the row names
   the contradictory facts so the owner can see what is open. This is what
   repo-46's gate 3 did, and what repo-49's gate 1 did not.
2. **A line proven only by a post-merge release is PASS; an open decision on a
   faithful build is CONCERNS.** The release is the proof, and waiting for it
   is not a defect in the build. The open-decision half is as in option 1.

What the page does today, for comparison, is neither: it has no rule, so the
verdict depends on the gate.

### The answer

**Option 2.** Chosen by the owner on 2026-10-05, in answer to these two options
plus "leave it open". The orchestrator recommended it, so no recommendation was
overridden. Two facts the filing did not have were put to the owner with it:

- pl-40's gate 2 had already graded lines only the owner's run could prove as
  "awaiting owner run", and returned **PASS**. Under option 1 that record would
  be the outlier.
- `docs/01-TICKETS.md` now defines an `awaiting` frontmatter field for "waiting
  on an event that will happen". `npm run status` shows it until it is closed.
  A release after the merge is exactly that kind of event.

So, as first answered:

- **A line proven only by a post-merge release is PASS.** The row names the
  event that proves it, and the ticket's `awaiting` field carries the line, so
  the obligation survives the merge.
- **An open decision found on a faithful build is CONCERNS, not FAIL.** The row
  names the contradictory facts so the owner can see what is open.

### The answer, narrowed

A review of PR #357 on 2026-10-05 read this answer against the two records
below and against the pages as #350 left them, and put what it found back to
the owner, who narrowed the second half and widened the Build. What it found:

- **repo-49's gate 1 is not a CONCERNS under any rule the page should have.**
  Its F1 is graded `high`, and its first row says the branch's test asserts the
  opposite of the Done-when line. That is FAIL twice over: a high, and a line
  unproven. The line was not unmeetable either. Gate 2 records that the owner
  took the builder's option and the row was met as written. The FAIL did its
  job.
- **Nobody writes `awaiting`.** A gate never edits frontmatter, and no page
  under `orchestrate-tickets` mentions the field. repo-46 landed `done`
  without it, and `git log c07f984..origin/main --grep='^chore(.*): release'`
  printed nothing on 2026-10-05, so its Done-when 1 and 3 were owed and
  `npm run status` could not show it. dl-73 was in the same state. A PASS
  with no step that writes the field removes the only marker there was.
- **pl-40 supports the PASS and not the mechanism.** It landed `in-flight`
  with no `awaiting`, and what it waits on is a funded run, not a merge.
- **Two more cases were routed here and never written in.** The 2026-10-03
  batch's history row, item 18, names repo-89 (three consecutive Windows runs)
  and dl-73 (the first real bump pull request).

The rule to build, as the owner left it:

- **A line whose only proof is an event after the merge is PASS**, by the test
  `docs/01-TICKETS.md` already gives for `awaiting`: the event is nameable, it
  will happen, and somebody can take the reading afterwards. A release is one
  such event, and so is a first bump pull request. A line nothing runs is not
  one and stays `unproven (gate)`. The row names the event. The lander writes
  the ticket's `awaiting` line in the landing commit, because the gate cannot.
  The verdict does not choose the ticket's `status`, which stays the author's
  call.
- **An open decision is CONCERNS only when the build does what the brief's
  Decision says and no test on the branch contradicts the Done-when line.**
  The finding is a `med` that the line depends on, so the decision goes to the
  owner before any round. A test that asserts the opposite of an acceptance
  line is still a `high`, and still FAIL. repo-49's gate 1 stays FAIL.

## Reproductions

Four gate records on `main`, each graded by hand. All four are under
`## Review` in the ticket named.

- **repo-49's gate 1, FAIL "by the letter".** In
  `docs/work/repo-49-next-id-reports-a-clash-for-a-branch-that-only-edits-a-ticket.md`,
  the section headed `### Gate 1`. Read the verdict line, the first row and the
  first finding, F1. This is the case the narrowed rule must leave at FAIL.
- **repo-46's gate 3, CONCERNS resting only on Done-when 1 and 3.** In
  `docs/work/repo-46-release-commits-never-update-the-lockfile.md`, the section
  headed `### Gate 3`. Its first line gives the verdict and the reason:
  "CONCERNS only because Done when 1 and 3 are still **unproven (gate)** until
  a release".
- **dl-73's gate 2, CONCERNS resting on one clause of Done-when 2.** In
  `tools/downloader/docs/work/dl-73-prove-the-shipped-yt-dlp-trusts-the-terminating-proxy.md`,
  the section headed `### Gate 2`. Its header says the one thing between it and
  PASS is a clause "that only a real bump pull request can prove".
- **lg-5's gates 1 and 2, CONCERNS with Done-when 4 "Gates green" left
  `unproven (gate)`.** In
  `tools/ledger/docs/work/lg-5-people-ratios-and-the-two-buckets.md`, the
  `## Review` section and `### Gate 2`. Every check passed but the
  code-scanning `CodeQL` check, which the owner had excused until merge under
  adr/005. Whether that is an event after the merge by the `awaiting` test, or
  a line nothing will run, is not settled by the answer above.

No gate section has, as its sole cause, the case the narrowed rule grades
CONCERNS: a build that matches the Decision, a Done-when line it cannot meet,
and no test that contradicts the line. Three carry it as one finding inside a
FAIL for something else, each in its ticket's `### Gate 1`:

- `tools/downloader/docs/work/dl-73-prove-the-shipped-yt-dlp-trusts-the-terminating-proxy.md`,
  finding F2: a `med` open decision, Done when 2 asked for a red check "before
  it can merge" where nothing blocks the merge. The owner reworded the line.
- `docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md`,
  the bullet headed "Open decision": no fix could meet Done when 1's
  parenthetical.
- `tools/downloader/docs/work/dl-74-retire-mux-failed.md`, finding 6: graded
  `low`, Done when 1 could not be met by a build that documents the retirement.

## Build

1. **Look for a record of the CONCERNS case** in the `## Review` sections under
   `docs/work/` and `tools/*/docs/work/`. If there is one, add it to the
   reproductions. If there is none, say so in the Log with the search that
   showed it, and give the rule a worked example in `gate.md` instead.
2. **Write the rule from "The answer, narrowed"** into
   `.claude/skills/review-ticket/gate.md`: a row verdict for each case in step
   4, and each one's effect under _Severity and the gate_. The two bullets
   dropped from PR #329 are a starting draft only. They stated no effect on
   the verdict.
3. **Give the lander the `awaiting` step.** Whoever lands a ticket with a
   post-merge row writes the `awaiting` line in the landing commit, in the form
   `docs/01-TICKETS.md` gives. It goes in `review-ticket`'s `SKILL.md` step 8
   and in `orchestrate-tickets`' `roles/fixer.md` and `roles/builder.md`,
   wherever each describes the landing.
4. **Bring every other statement of the verdicts into line.** There are four:
   - `.claude/skills/orchestrate-tickets/roles/reviewer.md`, wherever it
     restates a verdict.
   - `docs/01-TICKETS.md`, "The review gate": its verdict table, and the
     paragraph that calls `unproven (gate)` "deliberately neither PASS nor
     FAIL".
   - `.claude/skills/orchestrate-tickets/SKILL.md` step 6, which says an open
     question "keeps every later verdict at FAIL".
   - `.claude/skills/review-ticket/SKILL.md`, "an unproven one is still FAIL".

History items 17 and 19 of the 2026-10-03 batch touch the same table (a
dispatch's severity rule against `gate.md`'s, and a ticket with no Done when).
Both were handed to another session's review. Check what that review changed
before editing, and do not settle either here.

## Done when

- `gate.md` states the verdict for a line whose only proof is an event after
  the merge (PASS, by the `awaiting` test) and for an open decision on a build
  that matches its Decision with no contradicting test (CONCERNS, a `med` the
  line depends on).
- The three reproductions, read against the new rule, give FAIL for repo-49's
  gate 1, PASS for repo-46's gate 3 and PASS for dl-73's gate 2.
- The rule says which of repo-89's two `unproven (gate)` rows it moves, and
  why.
- The rule says how it grades lg-5's Done-when 4, a check the owner excused
  until merge, and why.
- A lander's page names the `awaiting` step, and the four pages in Build step
  4 agree with `gate.md`.
- `npm run check` passes.

## Log

- 2026-09-30 — Filed on the owner's decision via `AskUserQuestion`, at PR #329's
  close-out: drop the two verdict bullets the builder drafted for `gate.md`, and
  pose the question here with the gate's options and no recommendation. The
  reproductions are the two gate records above.
- 2026-10-05 — Answered by the owner: **option 2** (see "The answer"). `status`
  is now `ready`. The premise was re-checked against `gate.md` on `3a7d8a9`
  first: its verdict list (FAIL, CONCERNS, `unproven (scope)`, PASS, WAIVED)
  still has no entry for either case. Build and Done when are now written
  against the answer. Folded in: repo-46's gate 3 is on `main` now that #328
  has merged, so the reproduction says so.
- 2026-10-05 — PR #357 reviewed before merge, and the answer narrowed by the
  owner through `AskUserQuestion` (see "The answer, narrowed"). Two choices,
  both the recommended option: the open-decision half applies only where no
  test contradicts the line, so repo-49's gate 1 stays FAIL; and this pull
  request is amended rather than merged as it stood. Build and Done when are
  rewritten against that. dl-73's gate 2 is added as a reproduction. Folded
  in: an `awaiting` line on repo-46 and on dl-73, each with a Log entry,
  because both owed a post-merge line that nothing showed. Not checked:
  whether the other session's review of history items 17 and 19 has changed
  `gate.md`.
- 2026-10-05 — lg-5's gates 1 and 2 added as a fourth reproduction, with a
  `Done when` line, from item 7 of the 2026-10-04 batch's history entry. The
  owner's answer is unchanged; how the rule grades an excused check is left to
  the Build.
- 2026-10-06 — Built on `origin/main` at `4907d9a`, on `repo-88-gate-verdict-rule`;
  the PR is held as a draft by the owner until lg-6, dl-76 and dl-52 merge.
  - **History items 17 and 19 of the 2026-10-03 batch, checked first.** #361
    (`4907d9a`) did not touch `gate.md`:
    `git show --stat 4907d9a` lists `dispatching.md`, `history.md`,
    `roles/builder.md`, `docs/01-TICKETS.md` and this ticket. The last change to
    `gate.md` is #350 (`3a7d8a9`, `git log -1 -- gate.md`), which already carries
    step 1's "no `Done when` section is a finding and an open decision" (item 19) and `dispatching.md`'s "Never a severity rule of your own" (item 17).
    Neither is settled here: the new rule does not touch step 1's no-`Done when`
    case, and the severity table's `high` and `med` are unchanged.
  - **The Build's step 1 search.** A script over every `## Review` (to `## Log`)
    in `docs/work/` and `tools/*/docs/work/` matched "open decision",
    "unmeetable", "cannot be met", "cannot satisfy", "unsatisf" and "cannot
    clear": 127 lines in 57 of the 164 tickets that carry a `## Review`. Read
    for the shape (a faithful build, a line it cannot meet, no contradicting
    test) it found no gate whose sole cause that is, and three that carry it as
    one finding inside a FAIL for another reason: dl-73 gate 1 F2 (`med`),
    repo-60 gate 1 (no severity) and dl-74 gate 1 finding 6 (`low`). They are
    in the Reproductions now, and `gate.md` carries them as a worked case. The
    search is a phrase match: a record that words the shape otherwise is not
    ruled out.
  - **The Build's step 4 inventory: four pages, as written, but more places on
    them.** `grep -rniE "unproven|keeps every later|still FAIL|CONCERNS"` over
    the repo outside `work/`, `.git`, `node_modules` and `dist`, read for what
    states a verdict rule. On the four pages: `docs/01-TICKETS.md` states it in
    five places (the paragraph on `done`, the verdict table, "The four row
    verdicts", "deliberately neither PASS nor FAIL" and "the skill's four");
    `roles/reviewer.md` once, the CI-leg bullet; `orchestrate-tickets`'
    `SKILL.md` once, step 6; `review-ticket`'s `SKILL.md` once, the no-ticket
    paragraph. Everything else the grep returned is history or a comment that
    is still true (`history.md`, `adr/006`, `scripts/status.mjs`,
    `planner.yml`, `planner/e2e/pin.spec.ts`, `dispatching.md`'s `unproven
(scope)` and Windows lines), and no script parses a row verdict:
    `grep -rln "gate.md\|unproven (gate)\|Four verdicts" scripts packages` printed
    nothing. **The landing step is on two more pages than the Build named**,
    because the procedure lives there: `reference/records.md` (the full step, in
    _Landing_) and `SKILL.md` step 9 of `orchestrate-tickets`, beside the three
    pages the Build named.
  - **What the Build had wrong.** (1) "In the landing commit": `--land` refuses
    a ticket dirty against `HEAD` and makes its own commits, so the `awaiting:`
    line is its own commit just before it, in the same push. Read from
    `scripts/review-record.mjs` (the dirty-tree refusal); **not run**, as
    `--land` pushes. (2) "Three records" over four listed: fixed in the
    Reproductions. (3) "The four row verdicts" are now five: **`awaiting`** is
    the new row word, named after the field, and **`unproven (open decision)`**
    is a severity-section entry beside `unproven (scope)` rather than a sixth
    row word, because a line that is `unproven` forces FAIL by the old rule and
    this one must not.
  - **repo-89, which row.** Its two `unproven (gate)` rows are "the slow step
    is named" and "three consecutive `windows-latest` runs". The rule moves the
    second: the ticket's own Log (2026-10-03, "How this lands") counts "this
    pull request's, then main's after the merge" towards the three, so part of
    the reading does not exist before the merge. The first stays
    `unproven (gate)`: the pull request's own `windows-latest` run supplies it.
  - **The three reproductions against the rule**, each read from the committed
    record: repo-49 gate 1 FAIL (first row says the branch's test asserts the
    opposite, and F1 is `high`); repo-46 gate 3 PASS (its verdict line says
    CONCERNS "only because Done when 1 and 3 are still unproven (gate) until a
    release", and every finding is `low`); dl-73 gate 2 PASS (its verdict line
    says the one thing between it and PASS is a clause only a real bump pull
    request can prove, and F4 to F6 are `low`).
  - **OPEN DECISION, not settled by the owner: lg-5's Done when 4.** Two
    readings give different rules, and the paragraph in `gate.md` is the
    recommended one, written provisionally and removable alone (the last bullet
    of _Worked cases_). **A** (recommended): an excusal the owner recorded makes
    "Gates green" `awaiting`, because the push to `main` runs
    `security.yml`'s dismissal and the alerts' state afterwards is a reading
    somebody can take, which meets the `awaiting` test as the owner left it;
    lg-5's gate 2 becomes PASS. **B**: the excusal is the owner's act, not an
    event that proves the line, and the PR's check never goes green; the row
    stays `unproven (gate)` and CONCERNS, with the excusal named. A costs a
    reading that proves "the alerts cleared" and not "the PR's check was
    green"; B costs a permanent CONCERNS on every adr/005 excusal, with no
    marker after the merge, since the gate would not be `awaiting`.
  - **Derived, not asked:** a branch with no ticket cannot carry an `awaiting`
    line, so a line only a post-merge event can prove is `unproven (gate)`
    there (`review-ticket` `SKILL.md`, the no-ticket paragraph; `gate.md`, the
    `awaiting` verdict). `docs/01-TICKETS.md` already says an obligation that
    belongs to no ticket is a ticket worth filing.
  - **Folds considered and not made.** An `awaiting` line on lg-5 (merged as
    #354) waits on the open decision above. repo-89 (merged as #346, `in-flight`
    by the owner's choice) needs none: `in-flight` already says it is open.
