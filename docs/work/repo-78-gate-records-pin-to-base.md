---
id: repo-78
tool: repo
title: Gate records pin every coordinate to the base they reviewed
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-78 — Gate records pin every coordinate to the base

## Why

Four live citations had to be repointed after gating this batch because the coordinates moved in subsequent merges. Each repair turned the coordinate into a pin at the base:

- repo-60's merged record cited a line in repo-63's ticket; repo-63's landing splice moved that line (#306).
- repo-67's record cited `scripts/preflight.mjs` line 410, which #308 rewrote in place, same number, new text (#304).
- repo-48's evaluation cited `reference/concurrency.md` line 318, which its own later round moved (#307).
- `SKILL.md` cites `CLAUDE.md`'s "## Handing back" heading by line, and #305's edit moved it.

The base is a `main` commit, so it stays reachable. That differs from the branch-only shas that the `reference/records.md` forbids.

## Build

Make the gate page and `reference/records.md` specify that a gate should write every coordinate as `file@<base>:line`, where `<base>` is the SHA of the base branch the gate reviewed against. Update `scripts/review-record.mjs` or the citation checker to accept or enforce that format. Decide whether `SKILL.md`'s own citations into `CLAUDE.md` should name the heading instead of pinning to line numbers.

## Done when

A gate record written under the new rule survives when another open PR edits the cited line; a test proves it works; `npm run check` and the repo suite pass.
