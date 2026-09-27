---
id: repo-64
tool: repo
title: Record the 2026-09-27 batch and fold its defects into the rule pages
kind: chore
status: ready
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
