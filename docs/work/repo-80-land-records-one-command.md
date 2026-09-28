---
id: repo-80
tool: repo
title: One command lands a clean gate
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-80 — One command lands a clean gate

## Why

Every landing this batch followed the same manual sequence: splice with `review-record.mjs`, set status, commit, push, `--verify` with the ticket path, then preflight. This sequence was error-prone and required 7 fixer dispatches and 6 dry runs to complete (#302, #303, #304, #306, #307, #308). Common mistakes included running `--verify` before the commit, flipping status before the splice, and missing `node_modules` in a bare worktree.

A single command automating the entire landing sequence would eliminate these errors and reduce friction.

## Build

Create `review-record.mjs --land <ticket> <section-file>… --base <ref> --status done|in-flight --title "<PR title>"` that splices each section with one commit per gate, sets the status in the first commit, pushes fast-forward, runs `--verify` per section and preflight, and exits non-zero naming any failed step. Opening the PR remains with the caller.

**`--land` also refuses a section carrying an unpinned citation of content that predates the branch** — landing is the one place in the whole pipeline that already knows the base, since it is invoked with the ticket on the branch being landed and `--base` names it explicitly, the same way `preflight.mjs` itself requires one (`scripts/preflight.mjs@a084170:764 "if (!base) throw fail"`). Nothing enforces this today (repo-78 gate 1, F3): a record written under the old rule — two anchored, unpinned citations of pre-existing `scripts/` lines — splices clean, passes `citations.mjs --section Review --require-anchors --require-distinct-anchors --require-claude-pins` at exit 0, passes `citations-gate.mjs --against origin/main` at exit 0, and passes preflight's citation step; only a reviewer's own discipline catches it. `--land`'s own splice check carries `--require-claude-pins` too, so it refuses what CI refuses rather than what the pre-repo-78 dry-run command checked (repo-78 gate 2, F2/G2-d).

## Done when

One invocation lands a two-gate ticket in a fixture repo; a section with an unpinned citation of pre-existing content is refused before it is spliced; each failure path exits non-zero and names its step; tests prove both; `npm run check` and the repo suite pass.
