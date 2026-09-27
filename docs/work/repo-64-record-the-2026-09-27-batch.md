---
id: repo-64
tool: repo
title: Record the 2026-09-27 batch and fold its defects into the rule pages
kind: chore
status: in-flight
milestone: null
depends_on: []
---

# repo-64 — record the 2026-09-27 batch and fold its defects into the rule pages

## Why

`orchestrate-tickets/SKILL.md` step 12: a batch's history row is not the
deliverable, the rule change is — every item in "what the skill got wrong"
either edits the page holding the rule, in the same pull request, or files a
ticket carrying the reproduction. This is that close-out for the batch that
produced #295 (`repo-62`), #296 (`repo-60`) and #297 (`pl-48`), merged, and
#298 (`dl-53`), still open with a Windows-leg fix in progress.

## Build

1. Append a history row to
   `.claude/skills/orchestrate-tickets/reference/history.md`, headed
   `## Session 2026-09-27 — base c87153d`, in the fixed shape: the schema
   table (transcribed from `node scripts/agent-cost.mjs`'s accounting,
   relayed by the dispatching agent, rates read 2026-09-26), a per-agent
   table, then "what the skill got wrong" as one bullet per item, each ending
   with the page and heading its fix landed under or the ticket id it was
   filed as.
2. Fix each item's defect on the page that holds the rule, in this pull
   request, or file a ticket carrying its reproduction:
   - `records.md`'s contradiction between "pinned to the sha that round
     reviewed" and "a gate record never pins to a branch-only sha" for a
     multi-round record's earlier-round coordinates.
   - The Haiku fixer's two record-touching failures this batch (plus one
     from the batch before): move the `fixer` to Sonnet 5 in
     `.claude/agents/fixer.md` and `SKILL.md`'s pairing table, dated, and add
     a line to `roles/fixer.md` if it needs one.
   - The impossible landing order (splice before coordinate re-resolution,
     which `review-record.mjs --verify` refuses): the correct order and
     mechanism in `records.md` and `reference/dispatching.md`.
   - Gate prompts not requiring a dry-run of the gate's own section, from
     inside the gate's own worktree at the head: `dispatching.md`'s gate
     checklist and `roles/reviewer.md`.
   - Two parallel gates split by kind of setup each deferring a shared seam
     to the other: `dispatching.md`.
   - A gate's evidence for a fix lacking a control run without the fix:
     `defect-shapes.md`.
   - A candidate failure detector needing a recovering control before
     adoption: `defect-shapes.md`.
   - A new detector making an older one redundant, found by checking every
     mutation fails at least its own case: `defect-shapes.md`.
   - The first gate record on a `ready` ticket failing `status.test`'s
     `reviewedButReady` check: `roles/builder.md`.
   - Running `citations.mjs` from the wrong checkout resolving against the
     wrong tree: `records.md`.
   - A subagent report ending `# Done`: `roles/common.md`.
   - dl-53's builder's unverified claim that preflight does not see
     uncommitted changes: reproduce it independently; if it holds, file a
     ticket with the reproduction; if not, say so.
   - New sandbox refusals (a git command chained after any other command,
     `sed -i 'Na\…'`, large heredocs, long `node -e`, `pkill -f` killing its
     own shell): `roles/common.md`.
   - A re-gate probing a fix from a seed state its own tests never started
     from: `roles/reviewer.md`.
   - This date added to `SKILL.md`'s relaying-table row "A recommendation on
     an unmeasured premise".
   - A branch touching spawn or ffmpeg paths whose Windows CI leg no gate or
     preflight can see: `dispatching.md`.
3. Where an item's fix needs a judgement the item doesn't settle, leave it as
   an open decision in the report rather than making it.

## Done when

- The history row is appended in the fixed shape, citing the accounting
  table as given.
- Every item above either has an edited rule page in this pull request or a
  filed ticket carrying its reproduction, named in the history row's bullet.
- `.claude/agents/fixer.md`'s model is `claude-sonnet-5` with an effort set,
  and `SKILL.md`'s pairing table and `reference/model-pairing.md` agree with
  it and carry the date and reason.
- `node scripts/citations-gate.mjs --against origin/main`, `npm run check`,
  and `node scripts/preflight.mjs --base origin/main --title "chore(repo):
record the 2026-09-27 batch and fold its defects into the rule pages
(repo-64)"` each exit 0, unpiped.

## Review

_Re-resolved at `f84c2a1` for round 2: finding 4 cites repo-65 twice, and round 2 corrected both of those claims, so both citations are now prose naming `32b7e0b` (branch-only, never a pin); every word and verdict is otherwise unchanged._

**Gate: CONCERNS** — 2026-09-27 · `6988b65...32b7e0b` (head `32b7e0b7a8f6f93586df4d5cf7363c10534a2bf6`, detached; `origin/main` still `6988b65` after fetch) · code-review at medium, run by the gate itself, no subagents

Procedure read from `origin/main`. The branch's own `roles/reviewer.md` and `roles/common.md` would not have changed this gate: the new dry-run clause (from inside the worktree at the head) is what this gate did anyway, the seed-state clause applies only to a re-gate, and the new sandbox clauses would only have split commands measured running here (finding 9). The ticket does not exist at the base, so the brief was read from the branch down to `## Log`.

**The history row's claims, each against a primary source** — every claim in the schema table, the per-agent totals and the 16 items:

| Claim                                                                              | Source read                                                                                                 | Holds                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| #295, #296, #297 merged as `fe28fed`, `179f6f5`, `6988b65`; #298 open at `18ca055` | `git log origin/main`; `gh pr view` 295 to 298, state, mergeCommit, headRefOid                              | yes                                                                               |
| 15 gate rounds: repo-62 2, repo-60 3, pl-48 3, dl-53 7                             | each ticket's `## Review` on `main`; dl-53's on `origin/dl-53-stream-to-visitor` and the 7 comments on #298 | yes                                                                               |
| dl-53's branch carries 7 gate records, gate A 1, 3, 5 and gate B 2, 4, 6, 7        | Gate 1 to Gate 7 subsections of the branch's ticket, each naming its angle                                  | yes, 7                                                                            |
| 14 rounds returned findings; only Gate 7 has no findings line                      | each round's findings line, recounted                                                                       | yes as worded; 13 if dl-53 Gate 5, whose only finding was dropped, is not counted |
| repo-60 and pl-48 builders pinned to `ac00b8d`, `f1bde60`, `247073d`               | `git log --all -S` per sha: introduced in `4cb75e3` and `c49f0d5`, both Sonnet 5 trailers                   | yes                                                                               |
| the reviewer, not the builder, refuted its own -err_detect recommendation          | builder's Log in `8ac378c`; Gate 4 in `536e1d6`                                                             | **no**, finding 1                                                                 |
| the engine comment credits the gate for proposal and correction                    | the SEGMENT_SKIPPED docblock at `8ac378c` and `18ca055`                                                     | **no**, finding 1                                                                 |
| builder refused bare Stream ends prematurely, and Gate 5 confirmed                 | Gate 6, its section 4                                                                                       | refusal yes; **Gate 6**, finding 5                                                |
| wrong findings: 2                                                                  | all 15 rounds                                                                                               | 3 on one reading, finding 7                                                       |
| dl-53: 5 build rounds plus 3 landing stops, relayed because unmerged               | the branch's Log, entries through Round seven                                                               | **no**, finding 6                                                                 |
| subagent tokens 3,905,607                                                          | the per-agent Tokens column, re-added                                                                       | yes                                                                               |
| $315.88 over 12h33m                                                                | Cost column sums to $315.86, Active to about 12h32m                                                         | yes within rounding, relayed                                                      |
| 8 cold wakes                                                                       | Cold column sums to 8                                                                                       | yes; their cause is relayed                                                       |
| pl-53, repo-63, dl-74 filed during the batch                                       | files on `main`; dl-74 on the dl-53 branch                                                                  | yes                                                                               |
| item 2, the two fixer failures                                                     | repo-60 Log and #296 body; pl-48 Log and #297 comment                                                       | partly, finding 12                                                                |
| item 4, repo-62 gate 1's section failed the lander's splice                        | repo-62 Log, its gate 1 round entry                                                                         | yes; that it skipped the dry-run is relayed                                       |
| item 9, reviewedButReady                                                           | `scripts/status.mjs`; dl-53 Gate 4 reproduced it                                                            | yes                                                                               |
| item 11, a builder ended its report with a Done heading                            | no primary source, it is a transcript                                                                       | unverified                                                                        |
| item 12, preflight misses an uncommitted `scripts/test` change                     | re-run below                                                                                                | yes                                                                               |
| item 14, pl-48 gate 2 found the stuck Save from the e2e walk's plan                | pl-48 Gate 2, its new med                                                                                   | yes                                                                               |
| item 16, the Windows leg is invisible to `gh pr checks`                            | `gh pr checks 298`                                                                                          | **no**, finding 2                                                                 |

**The 16 items:**

| Item | Page named                                                  | Edited    | Rule stated where its step reads it                                     |
| ---- | ----------------------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| 1    | records.md, multi-round paragraph                           | yes       | yes; three older passages on the same page still say pin, finding 3     |
| 2    | agents/fixer.md, SKILL.md, model-pairing.md, roles/fixer.md | all four  | yes; findings 8, 12                                                     |
| 3    | records.md, dispatching.md                                  | yes       | yes, but only dispatching.md's routing section, finding 10              |
| 4    | dispatching.md gate checklist, roles/reviewer.md            | yes       | yes                                                                     |
| 5    | dispatching.md                                              | yes       | yes, beside the gate checklist, pointing at the split rule              |
| 6    | defect-shapes.md                                            | yes       | yes; see dropped                                                        |
| 7    | defect-shapes.md                                            | yes       | yes                                                                     |
| 8    | defect-shapes.md                                            | yes       | yes                                                                     |
| 9    | roles/builder.md                                            | yes       | yes; roles/fixer.md not reconciled, finding 11                          |
| 10   | records.md                                                  | yes       | yes, overstated, finding 13                                             |
| 11   | roles/common.md                                             | date only | the rule already existed                                                |
| 12   | repo-65 filed                                               | yes       | reproduction holds; its decision rests on two false premises, finding 4 |
| 13   | roles/common.md                                             | yes       | one clause contradicted by measurement, finding 9                       |
| 14   | roles/reviewer.md, re-gate list                             | yes       | yes, where a woken gate reads                                           |
| 15   | SKILL.md relaying table                                     | date only | as the brief asks; the rule pre-exists                                  |
| 16   | dispatching.md, builder dispatch                            | yes       | mechanism false and contradicts SKILL.md, finding 2                     |

| Done when                                                                                               | Proof                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History row appended in the fixed shape, citing the accounting table as given                           | **verified** — `## Session 2026-09-27 — base c87153d` at the end of reference/history.md: schema table, per-agent table, one paragraph per item each naming its page or ticket; totals re-added above. Its factual errors are findings 1, 5, 6, 7                                                                         |
| Every item has an edited page or a filed ticket, named in its bullet                                    | **verified** — 16 of 16, table above; finding 10 names one section that was not edited                                                                                                                                                                                                                                    |
| fixer.md is `claude-sonnet-5` with an effort; SKILL.md and model-pairing.md agree, with date and reason | **verified** — frontmatter `model: claude-sonnet-5`, `effort: high`, a full id pinned as builder-standard and ticket-reviewer-sonnet pin theirs; both SKILL.md rows and model-pairing.md say Sonnet 5 from 2026-09-27 and why. Nothing else in `.claude/`, `docs/` or `scripts/` still says the fixer is Haiku. Finding 8 |
| citations-gate, `npm run check`, preflight each exit 0, unpiped                                         | **verified** — commands below                                                                                                                                                                                                                                                                                             |

1. **med · The row credits the reviewer with refuting its own `-err_detect explode` recommendation. The builder refuted it first, and the reviewer confirmed.** Premises: the builder's Round three Log entry, committed in `8ac378c` at 05:39Z, says the flag does not do it and the gate's evidence was an artefact, with the measurements with and without `-bsf:a aac_adtstoasc`. A grep for "does not do it" in the ticket finds it at `8ac378c` and not at `3106835`, the commit before. Gate B's round 2 (Gate 4, recorded in `536e1d6` at 14:09Z, reviewing `8ac378c`) is headed "The disputed high finding, settled by measurement" and ends "The refutation holds completely; my original Option A recommendation was wrong": it confirms a refutation it was handed. The SEGMENT_SKIPPED docblock was written by the builder in `8ac378c` (`git log -S` on stream.ts), and credits the gate only with the proposal and its faulty exit 255. The row says the opposite in four places: the `wrong findings` cell ("not the builder, as this session was first told"; the comment "credits the gate for both the proposal and the correction"), item 6 ("the same reviewer only caught this on its own next round"), and what-went-right bullet 2, which has the reviewer writing the correction into shipped code, though a gate writes no code. The row presents this as its correction of the dispatch, so it tells a reader that the true version was the error. Fix those four places. Item 6's rule in defect-shapes.md is worded neutrally and holds.
2. **med · The Windows-leg rule rests on a false mechanism and contradicts SKILL.md.** Premises: `gh pr checks 298` at `18ca055` lists `test (windows-latest, informational)` as `fail`, and `gh pr view 298 --json statusCheckRollup` gives that check conclusion `FAILURE`. SKILL.md's After a merge prescribes exactly those two calls because they show a `continue-on-error` job that `gh run list` hides (`.claude/skills/orchestrate-tickets/SKILL.md@6988b65:308 "which this page prescribed until 2026-09-20"`). The new bullet under dispatching.md's Dispatching a builder calls the leg invisible to `gh pr checks`'s rollup and cites After a merge for it. History item 16 repeats the claim. What is true, and worth the rule, is that no gate and no preflight can see a CI leg before the pull request exists. Remedy: drop the `gh pr checks` clause, and point at After a merge's look as the check that finds the leg.

3. **med · records.md still steers a gate record to a branch-only pin in three places the new paragraph does not reach.** (a) The re-resolve list's mode 2 still says the answer is pinning the record to the commit the gate reviewed, "the cheaper answer" (`.claude/skills/orchestrate-tickets/reference/records.md@6988b65:114 "record to the commit the gate reviewed"`, unchanged on the branch). That is the instruction item 1 says two builders followed. (b) The pin-or-declaration test (`.claude/skills/orchestrate-tickets/reference/records.md@6988b65:285 "Reach for a pin when the citation was true of some commit"`) decides with `git log --all -S`, which finds branch-only commits. So for a gate-record citation that a later round deleted, it answers pin. dl-53's lander had to substitute `git log origin/main -S` by hand for gate 5's DEMUX_READ_FAILED citation (the branch's Landed Log entry). (c) The run-output section says "pin it to the commit it was true at" (`.claude/skills/orchestrate-tickets/reference/records.md@6988b65:526 "pin it to the commit it was true at"`). Method: grepped all 20 files under `.claude/skills/orchestrate-tickets/` and `.claude/agents/` (7 definitions, 13 skill pages; history.md is read as evidence, not instruction), plus review-ticket's `gate.md`, for pin, pinned, pins, pinning, `@<rev>`, reviewed sha and branch-only. Every other hit is consistent: builder.md's "repoint or pin" is about merged records, pinned to the base; reviewer.md forbids a branch pin; gate.md requires a `main` commit. Remedy: (a) repoint; (b) `git log origin/main -S` for a gate record; (c) a `main` commit or a declaration.
4. **med · repo-65's open decision rests on two false premises.** (i) repo-65 at `32b7e0b`, its decision section, where the two role pages both say to commit and then run it. Both pages say preflight comes before the commit: `.claude/skills/orchestrate-tickets/roles/builder.md@6988b65:104 "Fix, run the narrowest checks, then preflight, then commit and push"` and `.claude/skills/orchestrate-tickets/roles/fixer.md@6988b65:39 "Run the checks your fixes touch, narrowest first, then"`, whose next bullet is the commit. Both are unchanged on the branch. So option (a) would refuse the order both role pages prescribe, a cost the option does not name, and "(a) would enforce" is backwards. (ii) repo-65 at `32b7e0b`, its Why, where checks 2 to 4 already see only committed state. Check 2 does not: `scripts/preflight.mjs:346 "citationsGate(repo, SCOPE, grandfathered)"` reaches `scripts/citations-gate.mjs:558 "fs.readFileSync(path.join(repo, record)"`, the working tree. Measured: prepending one uncommitted comment line to scripts/citations.mjs made `node scripts/citations-gate.mjs` exit 1 with 3 records failed, repo-50's first (reverted after). The `npm run check` inside check 1 reads the working tree too. So the recommendation's reason, that (a) matches what checks 2 and 4 already assume, fails for check 2. The reproduction itself holds (below). The decision is correctly shaped: options, a recommendation, `needs-decision`. The premises need correcting. Whether (a) stays the recommendation once its real cost is named is the owner's call, not this gate's.
5. **low** · The `wrong findings` cell names Gate 5 as the round that reproduced the builder's recovering control. It was Gate 6, its section 4. Gate 5 is angle A's probe-timeout ceiling round.
6. **low** · The row counts dl-53 as 5 build rounds plus 3 landing stops, labelled relayed because the branch is unmerged. The branch's Log is readable at `origin/dl-53-stream-to-visitor` and runs two build entries, then Round three to Round seven. That matches the per-agent row's 7 reports; 5 plus 3 does not.
7. **low** · `wrong findings: 2` leaves out pl-48 gate 1's low, refuted as to scope by gate 2 (`tools/planner/docs/work/pl-48-change-dates-and-budget-on-the-page.md:165 "the day named twice: refuted as to scope"`, counted at `tools/planner/docs/work/pl-48-change-dates-and-budget-on-the-page.md:169 "8 gate-1 verdicts (7 closed, 1 refuted)"`). The defect was real but not in this branch. The row should say either way whether a scope refutation counts.
8. **low** · model-pairing.md says the fixer "was Haiku 4.5, from 2026-09-04". `git log --diff-filter=A` adds both `agents/fixer.md` and `roles/fixer.md` in `a1a417b` on 2026-09-26, and `git log -S fixer -- .claude/` finds nothing earlier.
9. **low** · common.md now lists "a git command chained after any other command" as refused. In this gate's own session, `echo probe && git -C <worktree> log --oneline -1` ran, and so did several `cd <worktree> && git …` and `git …; git …` chains. The one refusal here was a compound running `bash <script>`, refused as a construct too complex to verify.
10. **low** · Item 3 says the landing-order fix landed in both dispatching.md's builder-dispatch and routing-findings sections. The diff adds it only under Routing findings: the builder or the fixer. The Dispatching a builder hunk is item 16's bullet.
11. **low** · roles/fixer.md still says to set `status: done` in the first gate record's commit. The branch's builder.md now commits an earlier round's record with `in-flight` and leaves `done` for the landing commit. On a multi-round ticket, a fixer landing later has no first-record commit left to mark.
12. **low** · The repo-60 and pl-48 fixer failures are described on four pages: history item 2, SKILL.md's pairing paragraph, model-pairing.md and roles/fixer.md's Landing. That description says more than the primary sources do. repo-60's Log says the fixer's docblock rewrite `docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md:398 "removed one line net"`, which shifted every citation below it and turned CI's `check` red. Its Log also claimed a repo-63 correction it had not made. #296's body shows the round was a fix round plus a landing. pl-48's Log says the fixer "pushed nothing and left records that fail the citations gate". No ticket or PR thread I read supports "removed a line it was told to keep" or "altered a reviewer's own re-resolved anchors"; unverified here, possibly in dispatch transcripts.
13. **low** · records.md's new mode 5 says `citations.mjs` and `citations-gate.mjs` resolve "never against a sha you name". `citations.mjs --rev <sha>` does exactly that, as the paragraph after it says. `citations-gate.mjs` has no `--rev`, so the claim holds only for the gate.

- **dropped** · items 6 to 8 land on defect-shapes.md, which the orchestrator reads when it writes a gate prompt rather than the gate or builder that runs the control. That is the page's stated purpose, "What to name in a prompt".
- **dropped** · items 11 and 15 are dates on rules that already existed; the brief asks for exactly that.
- **dropped** · the row's 14 rounds that returned findings, against the 13 that carried one: the literal reading holds.
- **dropped** · $315.88 against a column sum of $315.86: rounding of relayed figures.
- **dropped** · items run four to nine lines each, but each is one paragraph, within history.md's "No subsection runs past one paragraph".
- **findings** · code-review at medium returned 18; 13 carried (4 med, 9 low), 5 dropped.
- **Commands at the head.** `node scripts/citations-gate.mjs --against origin/main` exit 0: 116 enforced, 0 failing; 6 grandfathered; 0 raised. `npm run check` exit 0. `node scripts/preflight.mjs --base origin/main --title "chore(repo): record the 2026-09-27 batch and fold its defects into the rule pages (repo-64)"` exit 0: every check ok, and all 3 other open heads merge cleanly. The diff adds 0 `@sha` pins, so there was no ancestry to check.
- **repo-65 re-run.** Run at the head with `--base 32b7e0b`, so the committed diff is empty, the same condition as the ticket's run on `main`. With one uncommitted line appended to scripts/test/next-id.test.ts, `git diff --name-only 32b7e0b...HEAD` gave 0 lines. Preflight then printed `ok npm run check` with no `npm test -- --project repo` line, and "preflight passed (exit 0)". Reverted; `git status --short` empty.
- **For the lander:** the ticket is `status: ready` at the head. Committing this section onto it fails reviewedButReady, per the branch's own builder.md.
- NFR: security n/a, pages only · performance n/a · reliability: findings 2, 3 and 4 each leave a rule that misdirects the next dispatch · maintainability: findings 1 and 5 to 13.

## Log

- 2026-09-27 — Filed and built in the same dispatch, on the owner's
  instruction (maintenance: a `chore` with no source change). Built on
  `origin/main` at `6988b65`.
- 2026-09-27 — Gate 1 (CONCERNS) fixed. Every finding reproduced before
  changing anything; none refuted.

  **med 1, fixed.** The `-err_detect` attribution was backwards: the builder
  refuted it first, in `dl-53`'s Round-three Log at `8ac378c` (05:39Z per
  `git show -s --format=%cI`); the reviewer's own `### Gate 4` (`536e1d6`,
  14:09Z) confirmed the builder's refutation by re-running the same
  measurement, agreeing its own round-1 recommendation was wrong. Fixed in
  `history.md`'s `wrong findings` cell, item 6, and the "what went right"
  bullet — all three credited the reviewer with originating the correction.
  - **med 2, fixed.** `gh pr checks 298` and `gh pr view 298 --json
statusCheckRollup` both name `test (windows-latest, informational)`
    directly — reproduced: `gh pr checks 298 | grep -i windows` prints the
    row, `--json statusCheckRollup` returns its `conclusion`. The true
    mechanism is that a gate and preflight run before any CI has results at
    all, not that the leg is invisible to those two commands. Fixed in
    `dispatching.md`'s builder-dispatch bullet and `history.md` item 16.
  - **med 3, fixed.** `records.md`'s mode-2 remedy, the `git log --all -S`
    pin-or-declaration test, and the run-output section all still pointed at
    a branch-only pin. Reworded mode 2 to repoint rather than pin; added a
    `git log origin/main -S` carve-out for a gate record's own citation; and
    corrected the run-output section to name a surviving commit.
  - **med 4, fixed.** `repo-65`'s decision rested on two false premises:
    `roles/builder.md:116` and `roles/fixer.md:39` (unchanged on this branch)
    both prescribe preflight _before_ the commit, not after; and check 2
    (`checkCitations`) reads the working tree unconditionally — reproduced:
    prepending an uncommitted line to `scripts/citations.mjs` made
    `citations-gate.mjs` exit 1, 3 records failing, reverted after.
    Recommendation flipped from (a) to (b) in `repo-65`, corrected in place
    with a dated Log entry there; still `needs-decision`. Fixing `repo-65`
    moved this finding's own two citations into it (`:76→:140`, `:50→:134`);
    both anchors are unchanged text, so this is the ordinary coordinate-only
    repoint `records.md` permits the lander, not the fix's own evidence
    (which must stay wrong) or text the fix deleted outright (which would go
    back to the reviewer).
  - **low 5, fixed.** The recovering-control confirmation was `### Gate 6`,
    not `### Gate 5` (angle A's probe-timeout-ceiling round) — corrected in
    `history.md`'s `wrong findings` cell.
  - **low 6, fixed.** `dl-53`'s builder-rounds count is **7** (its own Log
    runs two initial build entries then Round three through Round seven,
    matching the per-agent row's "last of 7 reports"), not "5 plus 3 landing
    stops" — corrected in `history.md`'s `builder rounds` row and `tickets`
    row.
  - **low 7, fixed.** Added `pl-48` gate 1's scope-refuted low as a third
    wrong finding in `history.md`, naming the disposition question the row
    left implicit rather than counting it silently either way.
  - **low 8, fixed.** `.claude/agents/fixer.md` and `roles/fixer.md` were
    both added in `a1a417b` on 2026-09-26, not 2026-09-04 — corrected in
    `model-pairing.md`.
  - **low 9, fixed.** Narrowed `common.md`'s new "git command chained after
    any other command" claim: it did not hold in this gate's own session,
    which ran several such chains without incident, and the one real refusal
    was a `bash <script>` compound. Reworded with that caveat rather than
    stating it as a general rule.
  - **low 10, fixed.** `history.md` item 3 claimed the landing-order fix
    landed under both `dispatching.md`'s builder-dispatch and routing-findings
    sections; it is only under routing-findings. Corrected, with a pointer to
    item 16 for the builder-dispatch hunk.
  - **low 11, fixed.** `roles/fixer.md` still said to set `status: done` in
    "the first gate record's commit," which a multi-round ticket may not
    have once an earlier round's record already went in as `in-flight`.
    Reworded to land on the commit that actually lands the round.
  - **low 12, fixed.** The `repo-60`/`pl-48` fixer-failure descriptions on
    four pages said more than either ticket's own Log or PR body supports.
    Replaced with the orchestrator's own relayed measurement (its commands,
    not read off any primary source here), labelled as such in all four
    places: `history.md` item 2, `SKILL.md`'s pairing paragraph,
    `model-pairing.md`, `roles/fixer.md`'s Landing section.
  - **low 13, fixed.** `records.md`'s mode 5 overclaimed "never against a sha
    you name" for both scripts; `citations.mjs --rev <sha>` is the documented
    exception. Narrowed to say the unconditional case is `citations-gate.mjs`,
    which has no `--rev` at all.

  **Landing order.** Set `status: in-flight` and committed gate 1's section
  verbatim with `scripts/review-record.mjs`, both before any fix, per the
  coordinator's instruction and this branch's own `roles/builder.md` edit.
  `node scripts/review-record.mjs --verify docs/work/repo-64-record-the-2026-09-27-batch.md <gate 1 file>`
  exits 0 at the landing commit.

  Verified after all fixes: `npm run check` exit 0;
  `node scripts/citations-gate.mjs --against origin/main` exit 0;
  `node scripts/preflight.mjs --base origin/main --title "chore(repo): record
the 2026-09-27 batch and fold its defects into the rule pages (repo-64)"`
  exit 0.
