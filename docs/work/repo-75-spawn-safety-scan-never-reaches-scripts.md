---
id: repo-75
tool: repo
title: spawn-safety.test.ts never scans scripts/, though CLAUDE.md says the rule is enforced repo-wide
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-75 — `spawn-safety.test.ts` never scans `scripts/`, though CLAUDE.md says the rule is enforced repo-wide

## Why

Found by repo-71's gate (Sonnet), verbatim:

> `packages/core/test/spawn-safety.test.ts` walks only `workspaceDirs()` — one
> level under `packages/`, two under `tools/` — and never reaches `scripts/` at
> all, so `scripts/preflight.mjs` and `scripts/test/*.ts` (which do spawn
> `git`/`gh`/`npm`) sit outside that scan entirely.

`CLAUDE.md`, under Rules: "**Never invoke a shell.** … Enforced repo-wide by a
source scan in `packages/core/test/spawn-safety.test.ts`." The scan reads
`sourcesUnder(dir)` for every workspace, which walks `<workspace>/src` for
`.ts`/`.tsx` only — 247 tracked files at `1a8321c`. So it misses `scripts/`
entirely, every workspace's `test/` and `e2e/`, and every `.mjs`.

**Measured at `1a8321c`** — the scan's three checks, with its own regexes and
its own comment stripper, run by a scratch script over the roots it skips:

| Roots                                                          | Files | Import `node:child_process` | `shell` truthy | `exec`/`execSync` imported | `spawn(` without `shell: false` |
| -------------------------------------------------------------- | ----- | --------------------------- | -------------- | -------------------------- | ------------------------------- |
| `scripts/`, `.claude/scripts/`, `.claude/hooks/`, `.githooks/` | 20    | 15                          | 0              | 0                          | 1                               |
| all of `packages/` and `tools/` (not only `src`)               | 463   | 12                          | 0              | 0                          | 0                               |

`.claude/scripts/` and `.claude/hooks/` hold only `.sh`, and `.githooks/commit-msg`
has no extension, so the 20 are `scripts/*.mjs` (9) and `scripts/test/*.ts` (11,
one of them this branch's new test file — see the Log).

**The one hit is `scripts/preflight.mjs:571`**:
`const result = spawn("git", ["merge-tree", "--write-tree", ours, theirs], { cwd: repo });`.
`spawn` there is `mergeTreeConflicts`' injected parameter, defaulting to
`spawnRaw` (`:529`), a `spawnSync` wrapper — not `node:child_process`' `spawn`.
The check matches `\bspawn\s*\(` by name and asks the whole file for one
`shell: false`, and `preflight.mjs` has none: its three `spawnSync` calls
(`:101`, `:266`, `:530`) pass `{ encoding: "utf8", cwd: options.cwd }`. So the
hit is a false positive about the call it names and a true one about the file.

**A second gap, found while measuring:** the explicit-`shell: false` check only
recognises `spawn(`. A file calling `spawnSync`, `execFile` or `execFileSync` is
never asked to say `shell: false`, anywhere the scan runs. The other 14 script
files that import `node:child_process` use those.

## The decision — held for the owner

Put by the orchestrator on 2026-09-27; this ticket moves to `ready` in the
commit that records the answer.

1. **Widen the scan to every tracked source** — `scripts/**/*.{mjs,ts}`, plus
   `packages/` and `tools/` beyond `src` — so "repo-wide" is true. Measured
   cost: one hit, resolved by adding `shell: false` to `preflight.mjs`'s three
   `spawnSync` option objects (each stays one line, so no citation moves), and a
   second walker beside `sourcesUnder` in
   `packages/core/test/support/workspaces.ts`, since that one reads only
   `<workspace>/src` and only `.ts`/`.tsx`. Touches `packages/core/test`, which
   release-please does not version, so a `fix(repo)` title releases nothing.
   **Recommended**: the cost is measured at one file, and the scripts are
   exactly the code that spawns most.
2. **Widen to `scripts/` only** — same cost today; leaves workspaces' `test/`
   and `e2e/` unscanned (0 hits there now) and CLAUDE.md still overstating.
3. **Narrow CLAUDE.md's sentence** to what the scan covers — every workspace's
   `src` — and leave scripts to convention. One sentence; no code. #305 edits
   CLAUDE.md too, at "What is denied", well clear of this line.

Whether the `spawn(`-only gap above is closed in the same change is a second,
smaller question: closing it asks every `spawnSync`/`execFileSync` file in the
scanned roots to say `shell: false`, which is unmeasured beyond the 15 script
files named above.

## Build

Held until the decision above is answered.

## Done when

Held until the decision above is answered.

## Log

- 2026-09-27 — Filed with the measurement above, in one pull request with
  repo-73, repo-74 and repo-76. No fix committed: the orchestrator is asking the
  owner which option to take. The scan was run by
  `node <scratch>/r75-scan.mjs <worktree> scripts .claude/scripts .claude/hooks .githooks`,
  output `scanned 20 files …; 15 import node:child_process`,
  `shellTruthy: 0`, `execImport: 0`, `spawnNoShellFalse: 1` —
  `scripts/preflight.mjs:571`; and over `packages tools`,
  `scanned 463 files …; 12 import node:child_process`, all three `0`. It ran on
  this branch, so the 20 include repo-73's new
  `scripts/test/status-gate-record.test.ts`, which imports nothing from
  `node:child_process`; at `1a8321c` the same roots hold 19 files, 15 importing
  it.
