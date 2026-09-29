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

## Log

- 2026-09-29 — Filed with no `## Log` heading. Added one here: `--land`'s own splice logic (`planInsertion`) anchors a ticket's first gate on the `## Log` heading, so a ticket that never gets one cannot land its own gates either — this ticket needed to carry one to be landable by the tool it built.
- 2026-09-29 — Built `--land` in `scripts/review-record.mjs`: `spliceSection`/`verifySection` (the existing `main()`/`verifyMain()` bodies, pulled out so `--land` can call them per section instead of reimplementing them), `detectGate`, `setStatus`, `unpinnedPreexistingCitations`, `parseLandArgs`, `land()`, `landMain`. `main()`'s and `verifyMain()`'s own behaviour is unchanged: `npx vitest run scripts/test/review-record.test.ts` — 36/36 of the pre-existing tests still pass, byte for byte, before any new test was added.
- 2026-09-29 — The refusal check (`unpinnedPreexistingCitations`) reuses `citations.mjs`'s own `checkCitations`/`makeReader`/`makeResolver`/`candidateFiles`, pointed at `--base`'s tree instead of the working tree, rather than a second implementation of "does this citation verify". This was a placement question the dispatch flagged as possibly open; it is not, in the event — the Build section itself already settles it ("`--land`'s own splice check carries `--require-claude-pins` too" and repo-78's own text naming this ticket as the place the machinery lands), so the only judgement left was reuse over reimplementation, in keeping with the file's stated practice of reusing the tool that already enforces a check rather than re-deriving it.
- 2026-09-29 — 14 new tests appended to the end of `scripts/test/review-record.test.ts` (never inserted mid-file, so no already-merged citation into this file moves): pure units for `detectGate`/`setStatus`/`parseLandArgs`/`unpinnedPreexistingCitations`, and `land()` exercised against a real git fixture with a real local bare `origin` (never the network) — a full two-gate landing (`land() splices two gates, sets status, pushes and verifies`), the `citations-pin` refusal before any splice (`land() refuses before splicing anything when a section cites pre-existing content unpinned`), a `preflight` failure that still leaves the commits and the push in place, and a `push` failure against a remote that already moved. `npx vitest run scripts/test/review-record.test.ts` — 50/50 (36 existing + 14 new).
- 2026-09-29 — Every `spawnSync`/`execFileSync` call this ticket adds or rewrites says `shell: false` explicitly (repo-77's own widened rule, not yet merged at this branch's base): the two pre-existing calls `spliceSection` folded in from `main()` (the `git ls-files`/`git diff --quiet` tracked/dirty checks) now say it too, since rewriting those lines was unavoidable to extract the function. **Not folded in**: the several other pre-existing `spawnSync`/`execFileSync` calls elsewhere in this file (`repoRootFor`, `buildDiff`, `restoreFromHead`, `verifyMain`'s `git show`) that this ticket's diff does not otherwise touch, and the same gap in `citations.mjs`/`citations-gate.mjs`/`preflight.mjs`. Repo-77 is building concurrently on the exact widened rule and names `scripts/test/review-record.test.ts` as one of its own edited call sites; fixing the rest of this file's pre-existing gap here too would have doubled the surface a scratch-merge with repo-77 has to reconcile for a rule this ticket did not introduce.
- 2026-09-29 — Editing `scripts/review-record.mjs` moved the lines five already-merged gate records cite unpinned: `repo-55`, `repo-62`, `repo-63`, `repo-67`, `repo-82` (measured with `grep -rnoE` over `docs/work` and `tools/*/docs/work` for `scripts/review-record\.mjs:[0-9]+`, cross-checked against `node scripts/citations-gate.mjs --against origin/main`, which failed exactly those five: `10 moved` on `repo-55`, `10 moved` on `repo-62`, `1 moved` on each of `repo-63`, `repo-67`, `repo-82` — 23 citations total). Per `records.md`'s "a citation of content that already existed at the base pins to the base" (since repo-78): every one of the 23 was **repointed**, coordinate only, to `scripts/review-record.mjs@2ffb72a:<the line the record already cited>` — `2ffb72a` is `origin/main`'s tip at this branch's base (`git merge-base HEAD origin/main` equals `git rev-parse origin/main`, both `2ffb72a`), and the content at each old coordinate is unchanged there, only shifted by this branch's own insertions. None were pinned or declared for any other reason, and none needed a new anchor or a reworded claim. `node scripts/citations-gate.mjs --against origin/main` — `131 enforced, 0 failing; 6 grandfathered, holding 1 unresolvable, 19 unanchored. 6 entr(y/ies) compared against origin/main: 0 raised.` exit 0.
- 2026-09-29 — `npm run check` exit 0. `npx vitest run --project repo` — 582/582 across 11 files. `npm run build` clean.
