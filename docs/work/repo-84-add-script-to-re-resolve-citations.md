---
id: repo-84
tool: repo
title: Decide whether to add a re-resolve-citations utility script
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# Add a re-resolve-citations utility script (repo-84)

## Brief

During the 2026-09-29 batch, a reviewer built the same "re-resolve every unpinned citation by anchor" script in each of four separate gate rounds to find citations that had moved in the branch but were not pinned. This suggests the operation is common enough and valuable enough to make available as a reusable script.

## Build

Decide where to place a `re-resolve-citations.mjs` script. Options, costed
roughly, recommended one first (the filer's recommendation, not a decision
made here):

1. **Add it under `scripts/` as a permanent utility for gates and builders to
   use (recommended).** Cost: one small script plus a test, roughly the size
   of `repo-75`'s single-file addition to `scripts/` — a small builder round,
   once. After that the recurring cost is zero: a gate calls it instead of
   rebuilding it. Recommended because the alternative's recurring cost is
   already measured, not projected: four rebuilds in one round.
2. **Document it in the skill and build it when builders or gates need to
   re-resolve unpinned citations.** Cost: a paragraph in `records.md` or
   `roles/reviewer.md`, no new file — cheaper upfront than option 1, but it
   does not stop the rebuild. The next gate that needs it still writes it
   from the description, in its own worktree, each time.
3. **Leave it ad-hoc and built by hand in scratch directories when needed,
   avoiding the code path.** Cost: nothing upfront, and this is the status
   quo already measured this batch — the same script rebuilt four times
   across gate rounds 2 through 5 of `repo-80`'s branch.

## Why

The script was rebuilt four times by the same gate round over successive fix rounds, suggesting it would have been more efficient to have a stable, documented version available. Evidence: the four recreations across gate rounds 2-5 of repo-80's branch.

## Log

- 2026-09-30 — **Decided via AskUserQuestion:** option 1, add it under `scripts/`
  as a permanent utility. The filer's recommendation was chosen. To be built
  after repo-47, since repo-47 changed what "moved" means to the gate. The
  script's semantics are documented in `roles/reviewer.md`.
