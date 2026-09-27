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
