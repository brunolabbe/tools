---
id: repo-141
tool: repo
title: Prune the orchestration pages under a size budget before the next review
kind: chore
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-141 — Prune the orchestration pages under a size budget before the next review

## Why

Every review of `reference/history.md` adds rules to the role and reference
pages and removes almost none. The 2026-10-24 review and the 2026-11-01 review
each landed about 400 inserted lines against about 200 deleted. A gate now reads
51 KB of procedure at its first command (`roles/common.md`, `roles/reviewer.md`,
`review-ticket/gate.md`), more than the tool's output cap, so the 2026-11-01
review split the read into two calls instead of shortening the pages. A
builder reads about 30 KB. Each is cached for an hour and re-read by every
agent of every batch.

The pages accrete the same way adr/006 says the process tickets did: a rule
is added each time the loop is bitten and nothing takes one away. Sentences
now restate each other — `roles/common.md` carries four separate paragraphs on
the farm, and the markdown-only skip was stated in three places with three
wordings until the 2026-11-01 review made them agree — and the incident each
cites (a ticket id, a date) is the only thing that tells a reader whether the
rule is still live.

## Reproduction

Sizes on `main` at `8ad4e91d`, before #720, and on #720's head:

```
$ wc -c .claude/skills/orchestrate-tickets/roles/common.md .claude/skills/orchestrate-tickets/roles/reviewer.md .claude/skills/review-ticket/gate.md
```

→ 51,368 bytes before #720 (read by the repo-117 gate, 2026-10-24: "Output too
large (50.2KB)"); the figure after #720 is to be read at the start of this
ticket. Line counts before #720: `SKILL.md` 433, `common.md` 245, `builder.md`
229, `reviewer.md` 221, `fixer.md` 124, `dispatching.md` 216, `records.md` 186,
`gate.md` 333, `concurrency.md` 396, `defect-shapes.md` 280,
`model-pairing.md` 354.

Review growth: `git show --stat 5f9e3c0a` (the 2026-10-24 review) and the
same for #720's first commit; each is roughly +400 / −200 across the pages.

## Decision — open

What a pruning pass removes, and what bounds it afterwards.

- **(a) A pass now, under a stated budget per page.** Remove a sentence when
  (i) a later sentence on the same page or the page it points to states the
  same rule, or (ii) its incident is older than the two most recent reviews
  and the rule has not recurred in the log since. Keep the rule, drop the
  second telling and the stale incident. Then set a budget — a line count per
  page in the page's own header, checked by `scripts/test/` so a review that
  exceeds it has to prune in the same pull request. Recommended: the budget is
  what keeps the pass from being a one-off.
- **(b) A pass now, no budget.** Cheaper, and the next two reviews put the
  lines back; the 2026-10-10 and 2026-10-17 reviews each trimmed and both were
  outgrown within a month.
- **(c) No pass; move incidents out.** Keep every rule, strip every incident
  citation (ticket id, date, figure) to `reference/history.md`'s worked
  examples. Smaller pages, but the reader loses the one signal that says
  whether a rule is live.

The pass is an owner's edit under `SKILL.md`'s preamble, built and gated like
any other `repo-` ticket; the builder changes no rule's meaning, and the gate
checks that by reading each removed sentence against what remains.

## Build

1. Read the current sizes (Reproduction) and write them into the Log.
2. For each page, list every sentence that meets (i) or (ii) with the sentence
   that supersedes it, as a table in the pull request body; remove them.
3. Move four blocks to where only their readers pay for them, measured on
   #720's head at four bytes a token (a gate reads 60.5 KB, about 15 k tokens;
   a builder 37 KB; a fixer 29.7 KB; the orchestrator 28 KB of `SKILL.md` on
   every turn and compaction):
   - the three dependency cases of `roles/common.md`'s _Your worktree_ into
     `roles/builder.md` — only a builder relocks, and gates and fixers read
     about 40 lines they never use; the gate's three pages then fit under the
     50 KB output cap again;
   - `review-ticket/gate.md`'s _Worked cases_ (about 45 lines of provenance)
     to a reference page no dispatched gate reads at its first command;
   - `review-ticket/SKILL.md`'s _A different model reviews_ (126 lines) and
     `reference/model-pairing.md` (22 KB, "never needed to dispatch") into one
     why-page, since both reason about the same table;
   - `SKILL.md`'s _If the session dies_ and the away-owner block of
     _Decisions_ (about 60 lines together) to reference pages the loop points
     at, read on the day they apply.
     A separate build or review skill is not one of the moves: builders and
     gates already read only their own pages, and a new skill would duplicate
     `common.md`.
4. If (a): a header line per page, `<!-- budget: N lines -->`, and a test in
   `scripts/test/` that fails naming the page and its overrun; set N at the
   pruned size plus ten percent.
5. Record the before-and-after sizes in the Log, and the gate agents' read
   command in `.claude/agents/ticket-reviewer-*.md` goes back to one `git
   show` if the three pages fit under the output cap again.

## Done when

1. No rule is lost: for each removed sentence the pull request body names the
   sentence that still states its rule, and the gate re-reads the pairs.
2. The gate's three pages total under 45 KB, or the Log says why not.
3. If (a): the budget test exists, passes on the pruned pages, and fails on a
   fixture page one line over.

## Log

- 2026-11-01 — Filed from the 2026-11-01 review (session tools-5d); the sizes
  above are read from `main` at `8ad4e91d`, the 51,368-byte figure from the
  tools-18 entry's item 9.
- 2026-11-01 — Build 3 added at the owner's choice, from the session's
  measurement of who reads which page; a gate's procedure is 4 to 9 percent
  of its per-turn context (171 k to 392 k cached tokens in the log), so the
  moves are for the output cap and clarity more than for cost.
