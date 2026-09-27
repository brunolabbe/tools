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

Create `review-record.mjs --land <ticket> <section-file>… --status done|in-flight --title "<PR title>"` that splices each section with one commit per gate, sets the status in the first commit, pushes fast-forward, runs `--verify` per section and preflight, and exits non-zero naming any failed step. Opening the PR remains with the caller.

## Done when

One invocation lands a two-gate ticket in a fixture repo; each failure path exits non-zero and names its step; tests prove both; `npm run check` and the repo suite pass.
