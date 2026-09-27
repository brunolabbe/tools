---
id: repo-75
tool: repo
title: spawn-safety.test.ts never scans scripts/, though CLAUDE.md says the rule is enforced repo-wide
kind: fix
status: ready
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

## The decision — answered 2026-09-27: widen the scan, to every source file

**Asked of the owner** by the orchestrator on 2026-09-27, before the
measurement above existed: "spawn-safety.test.ts never scans scripts/, yet
CLAUDE.md says the rule is 'Enforced repo-wide'… Which way?" Two options were
put: **Widen the scan (recommended)** — "extend the scan to scripts/ (and
.claude/scripts/ if it holds .mjs/.ts), so CLAUDE.md's claim becomes true" —
and **Correct the claim**.

**Answered by the owner: Widen the scan.**

**Read as option 1 below, every source file — the orchestrator's reading, not
the owner's words.** The option's stated purpose was to make "enforced
repo-wide" true, and only option 1 does; the measurement shows options 1 and 2
cost the same. The orchestrator took that reading and said it would tell the
owner it goes one step past the literal option text, which named `scripts/`
(and `.claude/scripts/`, which holds no `.mjs` or `.ts`).

The three options as the builder priced them afterwards, kept as filed:

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

**The second gap — answered 2026-09-27: its own ticket,
[repo-77](./repo-77-shell-false-check-sees-only-spawn.md).** The orchestrator's message
with the answer also asked that the explicit-`shell: false` check cover
`spawnSync` and `execFileSync`, pricing it as `preflight.mjs`' three calls. The
measurement taken then says otherwise: over every source file, a check that
asks any file calling `spawn`, `spawnSync`, `execFile` or `execFileSync` for a
`shell: false` fails **11 files** — `scripts/citations-gate.mjs`,
`scripts/citations.mjs`, `scripts/next-id.mjs`, seven suites under
`scripts/test/` (`preflight.test.ts` among them, which #303 edits) and
`tools/downloader/api/test/ytdlp-in-the-image.test.ts:158`. That last one cannot
change under this pull request's `fix(repo)` title without releasing the
downloader, since release-please routes by path. So the premise did not
survive, and the question went back to the orchestrator as an open decision
rather than being settled here. `preflight.mjs`' three calls say
`shell: false` regardless: the wider roots need that for `spawn(` at `:571`.

Put to the owner on 2026-09-27 with three options — **Own ticket**
(recommended), **Scripts part here** (the ten `scripts/` files in this pull
request, the downloader test in its own) and **Drop it** — with the
orchestrator's note that its earlier three-calls price was a misreading and
the 11-file measurement is the real cost. **Answered by the owner: Own
ticket.** Filed as repo-77 in this pull request, with no fix.

## Build

1. `packages/core/test/support/workspaces.ts` gains `repoSources()`: every
   `.ts`/`.tsx`/`.mts`/`.cts`/`.js`/`.jsx`/`.mjs`/`.cjs` file that
   `git ls-files --cached --others --exclude-standard` names, deduplicated
   (repo-74's shape), deleted files skipped. Appended at the end of the module;
   `sourcesUnder` and `workspaceDirs` stay for `image-closure` and
   `host-resolution`.
2. `spawn-safety.test.ts` reads `repoSources()` and asserts that the scan
   reached a spawning `scripts/*.mjs` and a spawning workspace `test/` file, so
   a later narrowing fails instead of passing on less.
3. `scripts/preflight.mjs`: `shell: false` in the three `spawnSync` option
   objects (`:101`, `:266`, `:530`), each still one line.
4. `CLAUDE.md` unchanged: "Enforced repo-wide" is now what the scan does.

## Done when

- The scan reads every source file, `scripts/` and `.mjs` included, and a scan
  narrowed back to workspaces' `src` fails a test.
- Every check passes over the wider roots, with `scripts/preflight.mjs` saying
  `shell: false` in each of its `spawnSync` calls.
- `npm run check`, the `core` and `repo` suites, and
  `node scripts/citations-gate.mjs --against origin/main` pass.

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
- 2026-09-27 — The owner's answer arrived (above); built as option 1, and the
  status moved to `ready` in the commit recording it.

  **Red, twice.** With the wider roots and `preflight.mjs` untouched,
  `npx vitest run packages/core/test/spawn-safety.test.ts` gave
  `1 failed | 4 passed (5)`, the failure
  `expected [ 'scripts/preflight.mjs' ] to deeply equal []` — the measured hit.
  With the new reach test but `SOURCES` put back to the old
  `workspaceDirs()`/`sourcesUnder` expression, the same command gave
  `1 failed | 4 passed (5)` again, failing only the new reach test: the old
  scan passes every other check, which is the defect. Green after both changes: `5 passed (5)`; the whole `core` project,
  `npx vitest run --project core` → `24 passed (24)`.

  **Scanned now**: 484 files by the scratch measurement over the same
  `git ls-files --cached --others --exclude-standard` list, 27 importing
  `node:child_process`, against 247 `src` files before.

  **`preflight.mjs` line numbers**: the three edits are in place, each line
  still under the formatter's width, so no line moves.

  **The `spawnSync`/`execFileSync` half of the orchestrator's message was not
  built**, for the measured reason under the decision above: 11 files, one of
  them a downloader test this pull request cannot touch under a `repo` title.
  Reported back as an open decision with options.

- 2026-09-27 — The owner chose "Own ticket" for that half; filed as repo-77
  (`node scripts/next-id.mjs repo` → `next free: repo-77`), `ready`, carrying
  the measurement re-run at `cf66f72`: 10 files left, `preflight.mjs` having
  passed since this ticket's build.
