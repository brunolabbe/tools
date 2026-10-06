---
id: repo-88
tool: repo
title: what verdict a gate gives a faithful build of an unmeetable Done-when line, or a line proven only by a release
kind: work-package
status: done
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

## Review

### Gate 1

**Gate: PASS** — 2026-10-06 · `4907d9a...c1fd096` · Opus 5.5, depth standard · graded under `gate.md` as it stands on `origin/main` at `4907d9a`. CI on `c1fd096` (`gh pr checks 364`, `headRefOid` confirmed): `check` ×2, `changes`, `codeql`, `CodeQL` and `dependency-review` pass, and the unit matrix is skipped because every changed file is `.md`.

| Done when                                                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate.md` states the post-merge verdict (PASS, by the `awaiting` test) and the open-decision verdict (CONCERNS, a `med` the line depends on) | **verified** by reading `gate.md` at `c1fd096`. Step 4's `awaiting` bullet is the row, and _Severity and the gate_ adds `awaiting` to PASS. The `unproven (open decision)` entry is "one finding, a `med` that the line depends on", gives CONCERNS, and makes a contradicting test a `high` and FAIL. See the first low.                                                                                                                                                                                                                                                                                           |
| The reproductions give FAIL for repo-49 gate 1, PASS for repo-46 gate 3 and PASS for dl-73 gate 2                                            | **verified** by applying the rule to the records on `main` myself. **repo-49 gate 1: FAIL.** Its first row says the test "asserts the opposite", and F1 is `high`. Gate 2 records the line met as written. **repo-46 gate 3: PASS.** Done when 1 and 3 need the first release commit after the merge, so both are `awaiting`. Done when 2 is proven at gate 2 and Done when 4 verified at gate 1, and gate 3's findings are both `low`. **dl-73 gate 2: PASS.** Done when 2's remaining clause needs the first real bump pull request, so it is `awaiting`. Done when 1 and 3 are verified, and F4 to F6 are `low`. |
| The rule says which of repo-89's two `unproven (gate)` rows it moves, and why                                                                | **verified**. `gate.md` _Worked cases_ moves the three-runs row and not the slow-step row. That matches repo-89's Log entry "How this lands", which counts "this pull request's, then main's after the merge" towards the three, and gate 1's first row, which names the pull request's own `windows-latest` runs as the experiment.                                                                                                                                                                                                                                                                                |
| The rule says how it grades lg-5's Done when 4, an excused check, and why                                                                    | **verified**. `gate.md` _Worked cases_, "An excused check": the row is `awaiting` when the Log records the excusal with its options and who gave it, and every other check is green. lg-5's Log does record the owner's choice (a) under adr/005, and its gate 2 reads 8 of 9 checks passing. By the new rule, gate 1 stays CONCERNS on its `med` and gate 2 becomes PASS.                                                                                                                                                                                                                                          |
| A lander's page names the `awaiting` step, and the four pages in Build step 4 agree with `gate.md`                                           | **verified**. The step appears in `review-ticket` `SKILL.md` step 8, `records.md` _Landing_, `orchestrate-tickets` `SKILL.md` step 9, `roles/builder.md` and `roles/fixer.md`. A scripted check covered 16 pages: the row words used, the verdict counts, the enumerated list and the PASS row. It found 0 problems at `c1fd096`. Positive control: with the `awaiting` bullet deleted from a scratch copy of `gate.md`, it found 32. Reading the pages found three statements left only partly in line. Each is a `low` below, and none contradicts a verdict `gate.md` gives.                                     |
| `npm run check` passes                                                                                                                       | **verified**: `npm run check` exit 0 at `c1fd096` ("All matched files use the correct format."). `node scripts/preflight.mjs --base 4907d9a --title "…(repo-88)"` exit 0, every check ok.                                                                                                                                                                                                                                                                                                                                                                                                                           |

- **low** · F1 · `gate.md`, step 4, the `awaiting` bullet, says "Three things are not `awaiting`:" and lists two. This is a residue: `git diff 25fc005 c1fd096 -- .claude/skills/review-ticket/gate.md` shows the third item, the no-ticket branch, moved out by the owner's second answer while the count stayed. The list also leaves out the case of a line the branch could prove and nobody did. Only the bullet's first clause excludes that case: "nothing that can run before the merge proves it". **Open decision**, two remedies. **(a)** (recommended) Keep "Three" and add the missing item: "a line a test or command on the branch could prove, which is `unproven` when nobody did". **(b)** Change "Three" to "Two".
- **low** · F2 · `docs/01-TICKETS.md`, the verdict table under _The review gate_: its FAIL row, "a line nothing asserts **and nobody re-ran**", also describes an `unproven (open decision)` line. `gate.md` says that line "does not force FAIL". The paragraph two below the table, "An acceptance line the build cannot meet…", gives the right grade. The same row already left out `unproven (scope)` at `4907d9a`. Done when 5 touches this. I graded Done when 5 verified because the page's own paragraph states the rule and defers to `gate.md`.
- **low** · F3 · `docs/01-TICKETS.md` still says "where an obligation belongs to no ticket at all, it is a ticket worth filing rather than a line worth hanging somewhere convenient". The owner's second answer, as written in `gate.md` (the `awaiting` bullet), `records.md` (_When there is no ticket_) and `review-ticket` `SKILL.md` (the no-ticket paragraph), says something else: the row names the event, the lander puts it in the pull request body, and "nothing in the repo tracks" it. A lander that reads `01-TICKETS.md` would file a ticket, and one that reads `records.md` would not. The decision itself is settled, and only this page fails to state it.
- **low** · F4 · `roles/reviewer.md`, under _Returning the gate_, says: "When the open decision is an acceptance line the build cannot meet, `gate.md` grades it by whether a test on the branch asserts the opposite of the line: none is CONCERNS, one is a `high` and FAIL." It leaves out both conditions of `gate.md`'s `unproven (open decision)` entry: the build does what the brief's Decision says, and the line asks for something that Decision cannot deliver. The gap shows on a build that left its Decision, cannot meet a line, and has no contradicting test. `reviewer.md` grades that build CONCERNS. `gate.md` leaves it outside the entry, so it is `unproven` and FAIL. Gates read both pages in one `git show`.
- **dropped** · repo-89's slow-step row might also move, since the Log's "What closes it" reads the same three runs, `main`'s included. Gate 1's own row names the pull request's `windows-latest` runs as the experiment, and those run before the merge, so `unproven (gate)` holds.
- **dropped** · lg-5 gained an `awaiting:` line although its tables carry no `awaiting` row, while `records.md` says such a ticket "gets no line". That sentence governs a landing. lg-5's line is a later fold-in under the owner's first answer, its own Log explains it, and #357 set the same precedent for repo-46 and dl-73.
- **dropped** · `unproven (open decision)` is a row label outside step 4's "Five verdicts". `unproven (scope)` already sat in the same place at `4907d9a`, and the branch's Log gives the reason: a line graded `unproven` forces FAIL, and this one must not.
- **dropped** · an unwrapped long line in `roles/builder.md` and an odd wrap in `review-ticket` `SKILL.md`'s no-ticket paragraph. `oxfmt --check` passes and both render the same.
- **dropped** · `orchestrate-tickets` `SKILL.md` step 6 leaves out the condition "the line asks for something the Decision cannot deliver". It keeps "the build does what the brief's Decision says", and a build that does what a Decision able to meet the line says would meet the line. So the omission changes no grade, and step 6 routes the decision rather than grading it.
- **findings** · the hunt returned 9: 4 carried, 5 dropped, all `low` or below. Nothing found is a `high`.
- NFR: security n/a (documentation, plus a frontmatter line on lg-5) · performance n/a · reliability ✓: the lander's sequence ran in a scratch clone with push and preflight stubbed. Left uncommitted, the `awaiting:` line makes `land()` refuse at setup. Committed first, every step is ok and the push carries that commit. `status.mjs` accepts the new line on a `ready` and on a `done` ticket and fails an empty one. · maintainability: F1 to F4.

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
- 2026-10-06 — **The owner answered the three open decisions above**, through
  `AskUserQuestion`, with the options as the builder wrote them. This entry
  supersedes the "OPEN DECISION", "Derived, not asked" and "Folds considered"
  bullets of the entry above.
  - **lg-5's Done when 4, an adr/005-excused check.** Options: **A**, a
    recorded owner excusal makes the line `awaiting` (event: the push to `main`
    running `security.yml`'s dismissal step; reading: the alerts' state
    afterwards); **B**, it stays `unproven (gate)` and CONCERNS. **Chosen: A**,
    the builder's recommendation. The bullet in `gate.md` lost its
    "(provisional)".
  - **A branch with no ticket, and a line only a post-merge event can prove.**
    Options: `unproven (gate)` (the builder's derived choice), or `awaiting`
    with the obligation named only in the pull request body. **Chosen:
    `awaiting`, named in the PR body. This overrode the builder's
    recommendation.** The owner was told the cost: nothing in the repo tracks
    that obligation after the merge. Applied in `gate.md` (the `awaiting`
    verdict), `review-ticket/SKILL.md` (the no-ticket paragraph) and
    `reference/records.md` (_When there is no ticket_).
  - **The row word.** Options: `awaiting` (the builder's) or
    `proven (post-merge)`. **Chosen: `awaiting`**, no change.
  - **Fold-in, made.** lg-5 (merged as #354, `done`) now carries an `awaiting`
    line for Done when 4, with a Log entry on that ticket, since decision 1
    makes the line `awaiting` and no step had written the field. `status` is
    untouched. The alerts' state was not read, because it needs the security
    tab and `gh api` is denied. repo-89 still needs none, as above.
- 2026-10-06 — **Gate 1 (Opus 5.5) returned PASS with four `low` findings, and the owner chose to fix all of them at landing**, through `AskUserQuestion` (options: fix F1 to F4 at landing, recommended, or leave all four recorded under the severity floor). **Chosen: fix all four, the recommended option.** F1 carried a two-remedy open decision of its own and the owner took the gate's recommendation, (a). Applied by the fixer (Sonnet 5.5 high) on `c1fd096`:
  - **F1, `gate.md` step 4, the `awaiting` bullet.** "Three things are not `awaiting`" listed two, the no-ticket case having moved out in the owner's second answer. Kept "Three" and added the missing item: a line a test or command on the branch could prove, which is `unproven` when nobody did. Reproduced: the bullet's list, read before the edit, had two items under "Three".
  - **F2, `docs/01-TICKETS.md`, the verdict table.** The FAIL row now says "bar an open decision or a scoped-out line", the two `unproven` entries `gate.md` says do not force FAIL.
  - **F3, `docs/01-TICKETS.md`, the `awaiting` field.** The sentence that called an obligation belonging to no ticket "a ticket worth filing" now states what `records.md` (_When there is no ticket_), `gate.md` and `review-ticket` `SKILL.md` already say: the row names the event and the reading, the lander puts them in the pull request body, and nothing in the repo tracks it after the merge.
  - **F4, `roles/reviewer.md`, _Returning the gate_.** The open-decision sentence now carries both conditions of `gate.md`'s entry (the build does what the Decision says, and the line asks for something it cannot deliver) and says a build that left its Decision is outside the entry: `unproven`, FAIL.
