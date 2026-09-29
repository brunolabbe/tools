---
id: repo-84
tool: repo
title: Decide whether to add a re-resolve-citations utility script
kind: work-package
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# Add a re-resolve-citations utility script (repo-84)

## Brief

During the 2026-09-29 batch, a reviewer built the same "re-resolve every unpinned citation by anchor" script in each of four separate gate rounds to find citations that had moved in the branch but were not pinned. This suggests the operation is common enough and valuable enough to make available as a reusable script.

## Build

Decide where to place a `re-resolve-citations.mjs` script:

1. Add it under `scripts/` as a permanent utility for gates and builders to use
2. Document it in the skill and build it when builders or gates need to re-resolve unpinned citations
3. Leave it ad-hoc and built by hand in scratch directories when needed, avoiding the code path

## Why

The script was rebuilt four times by the same gate round over successive fix rounds, suggesting it would have been more efficient to have a stable, documented version available. Evidence: the four recreations across gate rounds 2-5 of repo-80's branch.

## Log

None yet.
