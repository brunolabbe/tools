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

## Log

- 2026-09-27 — Built.
  - **Route: derive from `ci.yml`, not a shared list.** `ci.yml`'s `check` job
    has no way to read a list from a `.mjs` module — Actions has no mechanism
    for a workflow step to import one — so "share one list both read" would
    mean rewriting the job's five separate `- run:` steps into one step that
    loops over a script's own array, losing the per-step reporting the Actions
    UI gives each command today and widening this ticket into a `ci.yml`
    rewrite. Deriving instead means `preflight.mjs` parses the real
    `.github/workflows/ci.yml` text at run time (`extractCheckJobCommands`,
    bounded to the `check:` job by its own top-level job headers, throwing
    rather than silently reporting nothing if a step it cannot read — a
    `run: |` block scalar — ever appears there) and runs whatever it finds,
    minus three commands a dedicated check already covers by calling the same
    code directly rather than spawning it a second time for an identical
    verdict: `npm ci` (setup, not a check), `npm run check` (check 1's own
    first command) and `citations-gate.mjs --against …` (check 2). This is the
    route that makes divergence fail a test rather than rely on discipline: a
    step `ci.yml` adds to that job later is picked up by `deriveExtraCiCommands`
    automatically and run for real, with nothing to update in `preflight.mjs`
    unless it needs adding to the exclusion list — and
    `extractCheckJobCommands reads this repo's own ci.yml check job, in order`
    (`scripts/test/preflight.test.ts`) reads the real file, so a step this job
    changes moves this test on purpose. New bit: `EXIT.ciCommands` (32).
  - **Check 5's other half**: `checkScratchMergeCitations` folds every
    reachable other open pull request head into one real linked worktree,
    sequentially, as real (if scratch) commits — `--no-commit` was tried
    first and rejected: a worktree mid-merge refuses a second `git merge`
    outright ("You have not concluded your merge"), so folding in a second
    head needs the first one finished. Each fold passes `--no-verify`,
    because a linked worktree shares `core.hooksPath` with the real
    repository and this repo's own `commit-msg` hook rejected the scratch
    commit's message as "not a conventional commit" — measured directly
    against this checkout before the flag was added, where the merge tree
    itself was clean and the commit simply never happened, which the caller
    then read as a _content_ conflict with no conflicting paths at all. The
    fold is never pushed, never inspected for its message and never becomes
    real history, so the convention it would otherwise be held to does not
    apply to it. Once folded, `citationsGate`/`compareAgainst` — the same
    functions check 2 already calls — run against the worktree directory
    directly; the citation gate reads files off disk and the index, never off
    an arbitrary tree oid, which is why this is a real worktree and not
    `merge-tree --write-tree`'s tree object.
  - **The brief's own line-410 citation had already moved by the time this
    was built**: `preflight.mjs` line 410 as the Why names it is `status.mjs`'s
    `reviewedButReady`-adjacent code in the version repo-67's gate read; the
    reproduction built here (`checkScratchMergeCitations fails on a citation
two clean-merging heads move between them`) is the same _shape_ of defect
    — an anchored citation whose target line drifts across a clean two-way
    merge — reproduced fresh with a constructed pair of branches rather than
    replayed against that exact historical coordinate, which had already moved
    again by the time this ticket started.
  - **Citation drift this branch itself caused, repaired before reporting.**
    Every insertion into `scripts/preflight.mjs` and
    `scripts/test/preflight.test.ts` shifted lines five other tickets'
    `## Review` sections cite by coordinate: repo-51 (21 citations), repo-64
    (2), repo-67 (1), repo-71 (3) and repo-75 (2). Each was repointed —
    coordinate only, anchor text unchanged, per
    `.claude/skills/orchestrate-tickets/reference/records.md`'s rule for a fix
    that moves a coordinate — and each ticket's own Log carries the dated
    entry naming it. `node scripts/citations-gate.mjs --against origin/main`
    exit 0: 127 enforced, 0 failing, 6 grandfathered, 0 raised, confirms all
    five plus this branch's own new `docs/work/a.md`-shaped test fixtures were
    never real records to begin with (they live only inside a throwaway git
    repository the test builds and deletes).
  - Two of the new tests reused a literal substring an existing, already-passing
    anchor also matched (`docs\/work\/a\.md` and `nothing was checked`),
    which would have made those anchors indistinct without ever touching their
    own coordinates or text — closed by making the new assertions specific
    enough not to collide, not by touching the older citations.
  - **Fold-in considered and declined.** SKILL.md step 9's description of
    preflight's checks (and builder.md's matching bullet) were stale the
    moment a sixth check and a scratch-merge sub-step existed; both were
    updated, narrowly, to the passage the Build named — this is the one piece
    of adjacent work folded in, since leaving it stale would have been a
    fresh inconsistency this same branch created. Nothing else was folded in.
  - Commands: `npx vitest run scripts/test/preflight.test.ts` — 63 of 63 (45
    prior + 18 new). `npx vitest run --project repo` — 543 of 543. `npm test`
    — 3400 passed, 2 skipped (pre-existing, unrelated). `npm run check` exit 0. `node scripts/citations-gate.mjs --against origin/main` exit 0: 127
    enforced, 0 failing. `node scripts/preflight.mjs --base origin/main
--title "feat(repo): preflight runs every ci check step, plus citations on
a merged state (repo-79)"` over this real checkout: `check`, `ciCommands`,
    `citations`, `review` and `title` all `ok`; `mergeTree` fails on a real,
    unrelated conflict — folding in open PR #284
    (`release-please--branches--main--components--downloader`) conflicts on
    `.release-please-manifest.json` — which is the new check finding a real
    thing, not a defect in it.
- 2026-09-27, sent back before gating — **wrong**, and corrected. The
  orchestrator measured, sha for sha, that this branch's own `mergeTree`
  failure above was not a real conflict of `HEAD`'s: `#284` and `#294` (two
  open release-please pull requests) conflict with _each other_ on
  `.release-please-manifest.json`, and each merges cleanly with `HEAD` on its
  own — `git merge-tree --write-tree` against both pairs, run by the
  orchestrator, confirmed it. `checkScratchMergeCitations`'s first shape
  folded every reachable other open head into one worktree, one after
  another, so a conflict between two heads that are _not_ `HEAD` landed on
  `HEAD`'s own verdict — and two open release pull requests is this
  repository's ordinary standing state, so that shape would have failed
  preflight, and so blocked every landing (`ci.yml`/`SKILL.md` step 9 both
  make `preflight` exit 0 a ship condition), almost always.
  - **Fix: fold each other head onto `HEAD` separately, never two non-`HEAD`
    heads together** — the first of the two routes the orchestrator offered,
    chosen over "skip and report a head whose fold conflicts with an earlier
    non-`HEAD` head" because it needs no notion of "earlier": each head gets
    its own scratch worktree built fresh from `HEAD`, one merge, one citation
    gate run, then discarded, so a conflict between two other heads simply
    cannot arise inside this check at all rather than being detected and
    excused after the fact. `buildScratchMerge` itself (and its own two
    tests, which prove a genuine multi-head fold conflict is reported and
    that a clean fold is cleaned up afterward) is unchanged; only
    `checkScratchMergeCitations` now calls it once per head instead of once
    with the whole list. This does cost the case where two heads are each
    clean against `HEAD` alone but only break a citation when _both_ land
    beside it — genuinely uncaught by this shape — but that case was never
    this ticket's reproduction (its own Why and Done when both describe two
    parties: one record, one line-mover), and the alternative is the outage
    just measured. Not a change to what `Done when` promises: both required
    reproductions are still exactly a `HEAD` and one other head.
  - New test, `checkScratchMergeCitations does not fail HEAD for a conflict
between two other heads` (`scripts/test/preflight.test.ts`), shaped
    exactly like `#284`/`#294`: two heads that conflict with each other on
    one file and each merge cleanly with `HEAD`. Measured directly against
    both shapes of the code: red on `981c0cb` (`expected { ok: false } to
match { ok: true }`), green after the fix, 64 of 64 in the same run.
  - Commands, re-run after the fix: `npx vitest run
scripts/test/preflight.test.ts` — 64 of 64. `npx vitest run --project
repo` — 544 of 544. `npm run check` exit 0. `node
scripts/citations-gate.mjs --against origin/main` exit 0: 127 enforced, 0
    failing (this fix moved two more `scripts/preflight.mjs` lines repo-51's
    record cites — `:1122`→`:1134`→`:1137` and `:1043`→`:1055`→`:1058`,
    repointed twice, once by hand and once again after `npm run format`
    reflowed the same lines; final coordinates are the ones now in the
    record). `node scripts/preflight.mjs --base origin/main --title
"feat(repo): preflight runs every ci check step, plus citations on a
merged state (repo-79)"` over this real checkout, live PR list: **exit
    0** — every check `ok`, `mergeTree` included, all three real open heads
    (`#311`, `#294`, `#284`) both merge-tree-clean and scratch-merge-clean.
