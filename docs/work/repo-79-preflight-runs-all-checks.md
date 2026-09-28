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
- 2026-09-28 — gate 1 (ticket-reviewer-opus) returned CONCERNS at `f772ee9`.
  Reproduced every finding with the gate's own probes before touching
  anything (`gate1-mutate.mjs`, run against this worktree). Owner decisions
  via `AskUserQuestion`, both taken as the gate's/orchestrator's own
  recommendation:
  1. **What the scratch merge merges** — options were (A) per head only,
     wording fix; (B) per head, plus fold `base` in when `HEAD` does not
     contain it; (C) B plus one fold of every mutually-clean head together.
     Chosen: **B**. `git merge-base --is-ancestor base headOid` decides once
     per `checkScratchMergeCitations` call; false folds `base`'s tip into the
     same worktree as the head under test, matching what a real
     `pull_request` run checks (`refs/pull/<n>/merge`, base included) rather
     than the stale tree `HEAD` alone would be. The three-party gap — two
     heads each clean beside `HEAD` alone, breaking a citation only together
     — is disclosed, not closed: option C was declined because it
     reintroduces exactly the shape this ticket's first fix just closed for
     two _conflicting_ heads, one layer up for two _citation-breaking_ ones,
     and this repository's own orchestrator already runs a whole-batch
     scratch merge before a batch lands, which is where that question is
     answered. New test, `checkScratchMergeCitations folds base in when HEAD
does not contain it, catching a citation base itself moved`
     (`scripts/test/preflight.test.ts`), measured both ways: `ok: true` at
     `f772ee9` (the gap), `ok: false` after (caught).
  2. **The two med parity findings** — fix now, chosen over filing. Outcome
     required: a `check`-job step this file cannot read exactly as CI runs it
     fails loudly, naming the step; a covered step (`npm ci`, `npm run
check`, the citations-gate step) is matched exactly; `npm ci` is never
     spawned. Rewrote `extractCheckJobCommands` to group the job into steps
     (comment and blank lines dropped first, since this file's own style
     interleaves a full comment block between every step) and trust exactly
     one shape per step carrying a `run:` key — `run:` as its sole key, one
     line, nothing above or below — throwing on anything else; replaced the
     prefix-matched `ALREADY_COVERED` with `COVERED`, a guard-then-exact-match
     pair per name, so a step that merely _resembles_ a covered one throws
     rather than silently falling through to be spawned (`npm ci
--ignore-scripts` used to do exactly that); added `assertSpawnable` for
     `&&`, `|` and a trailing `# comment`, none of which this file spawns
     through a shell to honour. Verified against all 16 of the gate's own
     mutations, table below (old → new; "loud" means throws, naming the
     step):

     | mutation                                               | old                                                                                                                   | new                                |
     | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
     | baseline                                               | correct                                                                                                               | correct                            |
     | addStep                                                | picked up                                                                                                             | picked up                          |
     | gateArgChanged (`--displaced-since` appended)          | silently excluded, not run, not flagged                                                                               | **loud**                           |
     | citationsArgChanged (`--require-claude-pins` appended) | picked up                                                                                                             | picked up                          |
     | blockPipe (`run: \|`)                                  | loud                                                                                                                  | loud                               |
     | blockPipeDash (`run: \|-`)                             | attempted to spawn a command literally named `\|-`, which fails immediately (ENOENT) — loud, but for the wrong reason | **loud, and for the right reason** |
     | blockFoldDash (`run: >-`)                              | attempted to spawn a command literally named `>-`, which fails immediately (ENOENT) — loud, but for the wrong reason  | **loud, and for the right reason** |
     | namedStep (`name:` then `run:`)                        | silently invisible — step and command vanish                                                                          | **loud**                           |
     | namedBlock (`name:` then `run: \|`)                    | silently invisible                                                                                                    | **loud**                           |
     | andChain (`&&`)                                        | silently spawned with `&&` as a literal argv token                                                                    | **loud**                           |
     | pipe (`\|`)                                            | silently spawned with `\|` as a literal argv token                                                                    | **loud**                           |
     | trailingComment (`npm run check # …`)                  | silently spawned as `npm run … # … …`, several bogus args                                                             | **loud**                           |
     | npmCiArgs (`npm ci --ignore-scripts`)                  | **silently spawned for real**, inside a worktree built on the farm                                                    | **loud, never spawned**            |
     | workingDir (`working-directory:`)                      | silently picked up, wrong cwd                                                                                         | **loud**                           |
     | envStep (`env:`)                                       | silently picked up, missing env                                                                                       | **loud**                           |
     | stepIf (`if:` then `run:`)                             | silently invisible                                                                                                    | **loud**                           |

     `npx vitest run scripts/test/preflight.test.ts -t <mutation-shaped test>`
     is not how these were proven — the gate's own `gate1-mutate.mjs`,
     re-pointed at this worktree, was run directly and its output is the
     table above; `extractCheckJobCommands`/`deriveExtraCiCommands`'s own
     existing tests (real `ci.yml`) still pass unchanged, since every step in
     the real file is already the one trusted shape.
  - **Lows fixed now** (owner's standing rule): the stale "folds every
    reachable one into a scratch merge" docblock (here, `SKILL.md` step 9,
    `builder.md`) now says per-head-plus-base; repo-75's two citations
    restored to their two-line ranges so the `shell: false` line stays
    covered (its own 2026-09-27 Log entry was wrong to call the single-line
    form "coordinate only" — corrected there, dated); the "reproduced
    exactly" docblock now says "the same shape" and names what actually
    differs; the new `removeWorktreeForTest` spawn now carries `shell:
false`; `buildScratchMerge` now checks `git worktree add`'s own exit
    status (throws, naming it, rather than silently proceeding into a
    worktree that was never created) and, on a non-zero `git merge`, checks
    for an actual unmerged path before calling it a conflict — a merge that
    cannot happen at all (an unreachable or bogus oid, reproduced with a
    40-`a` sha) now throws "not a content conflict" instead of reporting one
    with an empty path list. Two new tests for both.
  - **Lows disclosed, not fixed**: the interrupted-run leftover scratch
    worktree (a `SIGINT` mid-fold leaves it registered in `git worktree
list`) needs a process-wide signal handler tracking every scratch dir
    this file has open, which reaches well past this function and risks
    interfering with whatever else in the process installs one — not cheap,
    and left as the gate found it. No ref is ever created reaching it, so
    nothing from this escapes to a push.
  - Pushback: none — every finding reproduced as the gate described it.
  - Commands, this round: `npx vitest run scripts/test/preflight.test.ts` —
    69 of 69 (64 prior + 5 new). `npx vitest run --project repo` — 549 of 549. `npm run check` exit 0. `node scripts/citations-gate.mjs --against
origin/main` exit 0: 127 enforced, 0 failing (this round moved 27
    citations across four tickets again; repointed once more, coordinate
    only, via a small script that substitutes every coordinate in one pass
    per file so a chained pair cannot double-apply). `node
scripts/preflight.mjs --base origin/main --title "feat(repo): preflight
runs every ci check step, plus citations on a merged state (repo-79)"`
    against this checkout's live PR list (now 4 open heads, `#312` new since
    round 1): **exit 0**, wall time 40.8 s, every check `ok` including
    `mergeTree` against all four real heads.
- 2026-09-28 — gate 2 (ticket-reviewer, code-review at medium over the round
  diff `f772ee9..6b10392`) returned CONCERNS: two new meds and five new
  lows, all of gate 1's own findings still verified fixed. Dispatched as a
  fixer round with mechanical findings; owner decision, 2026-09-28 via
  `AskUserQuestion`: fix both meds and the cheap lows in one round, no third
  gate — the orchestrator's own recommendation, taken over none (an earlier
  answer, "land the records first, then fixes", was withdrawn once the
  orchestrator found the base-fold fix had to move lines the merged records
  cite). Reproduced every finding with the gate's own probes
  (`gate1-basemoved.mjs`, `gate1-mutate.mjs`, `gate2-mutate-extra.mjs`) before
  touching anything.
  1. **med, base fold skipped with no other heads** — fixed. The early
     return in `checkScratchMergeCitations` used to fire the instant
     `otherHeads` was empty, before `base` was even resolved, so a base that
     moved a line this branch's own record cites passed silently whenever
     this branch was the only open pull request. `scripts/preflight.mjs`'s
     `checkScratchMergeCitations` now resolves the base-ancestor question
     first and only takes the "nothing to check" exit when `otherHeads` is
     empty **and** `HEAD` already contains `base`; otherwise it folds `base`
     alone into one scratch worktree (`otherHeads.length > 0 ? otherHeads :
[null]`, `null` standing for "no other head, base only"). Measured with
     a small script built for this round
     (`fix1-repro-basemoved.mjs`, same shape as `gate1-basemoved.mjs` but
     calling `checkScratchMergeCitations` directly rather than through
     `checkCitations`/`checkMergeTree`): `ok: true, "…nothing was checked"`
     at `6b10392` (the gap), `ok: false, "FAIL  docs/work/a.md — 1 moved"`
     after. New test at the end of the suite,
     `checkScratchMergeCitations folds base in when there are no other open
heads at all` (no filler head, on purpose) — red on `6b10392` (`expected
true to be false`), green after. The existing `says explicitly that an
empty list checked nothing` test's own fixture (a bogus repo path and a
     zeroed oid) no longer stands for "nothing touches git here" once the
     fix makes something touch git even at zero heads, so it was rewritten
     to a real repository where `HEAD` already contains `base` — the true
     positive control for the new contract — rather than moved or deleted.
  2. **med, the parity fixes have no tests** — fixed. Six tests added, each
     proven red against the exact mutant that removes its own fix and green
     after restoring it (temporary in-place edits to `scripts/preflight.mjs`,
     restored before the next check; never committed):
     `extractCheckJobCommands throws on a name:-first step`,
     `…an if:-first step`, `…a working-directory: step` and `…an env: step`
     (all four red — `expected [Function] to throw an error` — when the
     `step.lines.length > 1` clause is removed from the guard at
     `scripts/preflight.mjs:402`, green restored);
     `deriveExtraCiCommands throws on a step chained with && through the
real pipeline` (red when the `assertSpawnable(raw)` call is commented out
     of `deriveExtraCiCommands`, proving `assertSpawnable` is actually wired
     into the pipeline gate 1's own mutant exercised, not only callable in
     isolation); `deriveExtraCiCommands throws on npm ci --ignore-scripts
rather than spawn it uncaught` (red when the exact-match throw is removed
     from `COVERED`'s consumer, leaving only the guard).
  3. **Lows fixed now** (owner's standing rule):
     - `COVERED` whitespace and the `npm ci` alias — `npm  ci` (two spaces)
       matched neither the guard nor the exact form and fell through to
       `assertSpawnable`/`tokenize`, which split it on whitespace regardless
       and spawned a real install; `npm clean-install` — `npm`'s own alias
       for `npm ci` — matched no guard at all and spawned a real install
       under a name `COVERED` had never heard of. A new `canonicalize`
       helper collapses whitespace runs and rewrites the alias before either
       `guard` or the exact-match comparison runs. Two new tests,
       `deriveExtraCiCommands treats npm  ci (extra whitespace) as covered`
       and `…treats npm clean-install as covered`, both red at `6b10392`
       (measured by swapping that commit's `preflight.mjs` in) and green
       after; independently re-measured through `gate2-mutate-extra.mjs`
       re-pointed at this worktree: neither mutation appears in the spawned
       list anymore.
     - The `checkScratchMergeCitations` docblock named
       `.claude/skills/orchestrate-tickets/reference/records.md` as where the
       three-party gap is answered; the whole-batch scratch merge is
       `SKILL.md` step 11 ("Scratch-merge the batch"), not that page —
       corrected.
     - This ticket's own 2026-09-28 Log table had a broken `blockPipeDash`
       row (an unescaped `|` inside a code span split it into five cells) and
       called the old `|-`/`>-` behaviour "silently spawned", which gate 2
       flagged as mislabelled: at `f772ee9` those spawned a command literally
       named `|-`/`>-`, which fails immediately with ENOENT — loud, but for
       the wrong reason, not silent at all. Both rows corrected in place; the
       table now formats cleanly under `oxfmt`.
     - `assertSpawnable` extended for the four remaining shapes gate 2
       measured reaching `spawnSync` unrecognised: `;`, a glued redirect
       (`>/dev/null`, `2>/dev/null` — no space either side, invisible to
       `tokenize`'s "a lone `>` token" rule), an unexpanded `$VAR`, and a
       `run:` value wholly wrapped in one pair of quotes (YAML's own
       quoting, misread by `tokenize` as a single space-containing "command
       name"). This was a few lines, not a rewrite, so it was done rather
       than filed; the docblock discloses what still is not closed — a
       legitimate argument that itself needs one of these characters quoted
       (`ci.yml` has none today) would be flagged as the operator it is not,
       which is a real, if narrow, remaining gap. Two new tests,
       `assertSpawnable throws on a semicolon, a glued redirect, an
unexpanded $VAR and a wholly quoted value` (plus a positive control: the
       legitimate space-delimited redirect this repo's own `ci.yml` uses is
       still not flagged) and `deriveExtraCiCommands throws on each of the
five newly caught shapes, through the real pipeline` — both red at
       `6b10392`, green after.
  - Citation drift this round caused, repaired before reporting, per the
    orchestrator's mid-task correction (repo-29; repo-78's gate 1, F1: the
    branch whose change moves a merged citation repoints it, coordinate
    only, rather than stopping — narrower than this dispatch's original
    instruction, which the orchestrator withdrew in the same message).
    `node scripts/citations-gate.mjs --against origin/main` named four
    "moved" citations after the med-1 and med-2 fixes (the docblock and
    function-body insertions in `scripts/preflight.mjs` land well before
    line 824, shifting everything below): repo-51's three
    (`scripts/preflight.mjs:1306`→`:1406`, `:1227`→`:1327`, `:641`→`:712`),
    repo-64's one (`:641`→`:712`, the same line), repo-67's one
    (`:703`→`:774`) and repo-75's one range (`:824-825`→`:895-896`, width
    kept, still covering `function spawnRaw(…)` and the `shell: false` line
    beneath it). repo-71's citations all resolve above the insertion point
    and needed no change. Each repointed coordinate-only, anchor text
    byte-for-byte unchanged, verified by re-running the gate after each
    edit; each ticket carries its own dated 2026-09-28 Log line naming the
    change and this rule's provenance. One earlier mistake caught and fixed
    before committing: a new test's own comment quoted the literal fragment
    `"nothing was checked"`, which repo-51's own citation at
    `scripts/test/preflight.test.ts:589` anchors to — `citations-gate`
    reported it "indistinct" (matches two lines) rather than "moved";
    reworded the comment rather than touching repo-51's anchor, since the
    fragment it points at was never moved, only duplicated by this round's
    own new prose.
  - `SKILL.md` step 9's and `roles/builder.md`'s preflight sentences were
    re-read against the fix: both already say the scratch merge folds
    "`base`'s own tip when `HEAD` does not yet contain it" as a clause
    separate from "each reachable [head]", not conditioned on one existing —
    so neither needed a change; left as they stood.
  - Pushback: none — every finding reproduced as the gate described it.
  - Commands, this round: `npx vitest run scripts/test/preflight.test.ts` —
    80 of 80 (69 prior + 11 new, one existing test rewritten in place, none
    removed). `npx vitest run --project repo` — 560 of 560.
    `packages/core/test/spawn-safety.test.ts` — 5 of 5. `npm run check` exit 0. `node scripts/citations-gate.mjs --against origin/main` exit 0: 127
    enforced, 0 failing, 6 grandfathered, 0 raised (read directly, never
    through a pipe). `node scripts/preflight.mjs --base origin/main --title
"feat(repo): preflight runs every ci check step, plus citations on a
merged state (repo-79)"` against this checkout's live PR list (5 open
    heads, `#313` new since round 2): **exit 0**, every check `ok` including
    `mergeTree` against all five real heads — `HEAD` already contains
    `origin/main` here, so the live run does not itself exercise the
    zero-heads base fold; that shape is proven by the new unit test above
    instead.
