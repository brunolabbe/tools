---
id: repo-79
tool: repo
title: Preflight runs every CI check step, plus citations on a merged state
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-79 — Preflight runs every CI check step

## Why

Preflight's checks do not cover every step in `ci.yml`'s `check` job. This batch showed gaps:

- #305 passed preflight twice and then failed CI's `check` job on `node scripts/citations.mjs .claude/skills/orchestrate-tickets/SKILL.md --require-anchors`, which preflight does not run (#305).
- Preflight's check 5 only tests `git merge-tree` for conflicts. Three citation breaks were found only by hand-built scratch merges of open PR heads: repo-60's record against repo-63's splice, `scripts/status.mjs`'s `hasGateRecord` line against repo-63's unmerged record, and `scripts/preflight.mjs` line 410 against repo-67's record.

Preflight needs to run the citations gate on a merged state of all open PR heads to catch these cases before they land.

## Build

Have preflight derive and run every command step of `ci.yml`'s `check` job, or share one list with it. Extend check 5 to build a scratch merge of `HEAD` with every open PR head and run `citations-gate --against origin/main` on it. Every command must be identical to what CI runs.

## Done when

Preflight fails on a branch shaped like #305's first head, and on a pair of branches where one moves a line the other's record cites; tests prove both; `npm run check` and the repo suite pass.
