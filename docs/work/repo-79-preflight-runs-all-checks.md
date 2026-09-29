---
id: repo-79
tool: repo
title: Preflight runs every CI check step, plus citations on a merged state
kind: chore
status: done
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

## Review

### Gate 1

**Gate: CONCERNS** — 2026-09-28 · `a0841701...f772ee9` (`origin/main` still at `a0841701` after this gate's fetch) · code-review at medium, run by the gate in its own context · coordinates re-resolved at `d2b07ea`, words, rows and verdicts as gated at `f772ee9`. Ten citations whose text the gate-1 round deleted or whose claim it corrected are now prose naming what they pointed at in `f772ee9`.

| Done when                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight fails on a branch shaped like #305's first head                            | `scripts/test/preflight.test.ts:1131 "FAIL {2}node scripts\/citations"` — **proven**. Also run live: this head's `preflight.mjs --repo` over #305's first head `1f97de4` exits 49, bit 32 set, on the SKILL.md citation of CLAUDE.md's Handing back heading reported `MOVED`. See the low on the fixture's shape                                                                                                  |
| … and on a pair of branches where one moves a line the other's record cites          | `scripts/test/preflight.test.ts:1290 "fails on a citation two clean-merging heads move between them"`, wired into bit 16 by `scripts/test/preflight.test.ts:1373 "runs the scratch-merge citations step and fails on the same bit"` — **proven**. Also run live on a pair built over this repo, each head passing `citations-gate --against a0841701` alone at exit 0: red, bit 16, `1 moved`; a clean pair green |
| tests prove both                                                                     | the two rows above — **proven**                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check` and the repo suite pass                                              | **verified** — `npm run check` exit 0; `npx vitest run --project repo` 544 of 544; `scripts/test/preflight.test.ts` 64 of 64, with 19 `test(` blocks added and no line of it deleted                                                                                                                                                                                                                              |
| Windows leg: the new tests spawn `node` and add linked worktrees under `os.tmpdir()` | **unproven (gate)** — `test (windows-latest, informational)` in `ci.yml`; neither this gate nor preflight can see it                                                                                                                                                                                                                                                                                              |

- **med** · the `ci.yml` reader sees only a step whose `run:` sits on its `- ` line, `scripts/preflight.mjs`'s `RUN_STEP` regex at `f772ee9`. A step written `- name:` or `- if:` first with `run:` below it — the shape `ci.yml`'s own `test` job uses at `.github/workflows/ci.yml:386 "- if: runner.os == 'Linux'"` — is skipped with nothing failing, a `run: |` block in that position included, so the block-scalar throw in `extractCheckJobCommands` at `f772ee9` never fires for it; a step's `working-directory:` and `env:` are ignored. `run: |-` and `run: >-` become a command named `|-` or `>-`, and `&&`, `|` or a trailing `# comment` reach `spawnSync` as literal arguments, because `parseShellCommand` at `f772ee9` strips only `>`. Measured through `extractCheckJobCommands` and `deriveExtraCiCommands` over 16 mutations of the real `ci.yml`; the test that reads the real file stays green for every silent one, since it compares only what the parser saw. No `Done when` line depends on it; the Build's "every command must be identical to what CI runs" does.
- **med** · two findings, one mechanism: the exclusion list matches steps by text. `ALREADY_COVERED`'s third entry at `f772ee9` drops the citations-gate step by prefix while check 2 calls `gate` and `compareAgainst` with fixed arguments, so appending `--displaced-since origin/main` to that step changes nothing preflight runs, and no test fails (measured). And `npm ci` and `npm run check` are matched exactly, so an added argument (`npm ci --ignore-scripts`, measured) makes preflight spawn `npm ci` for real inside a worktree built on the farm, which `common.md` forbids. An exact match on each covered step that throws on any other form of it would close both.
- **low** · every non-zero `git merge` in the fold is reported as a conflict. The `git worktree add` in `buildScratchMerge` at `f772ee9` has its status ignored, and its conflict branch returns whatever `--diff-filter=U` found: a HEAD oid that cannot be checked out reports `conflicts on: ` with no path (measured). It fails closed; it is the misdiagnosis the Log fixed for the hook cause only, and a missing identity or commit signing reaches it the same way (unmeasured).
- **low** · a run interrupted mid-fold leaves its scratch worktree registered: SIGINT at 2 s left `/tmp/preflight-scratch-UnQNyE` in `git worktree list`, detached at the scratch merge commit. A clean fold, a citation failure, a conflict and two overlapping runs (separate `mkdtemp` paths) all left no worktree (measured); a throwing gate is covered by the `finally` (read, not run). No ref is ever created — `for-each-ref` unchanged across every run — so nothing reaches a push.
- **low** · `checkMergeTree`'s docblock at `f772ee9` still describes the first, single-fold shape, and `SKILL.md` step 9 and `builder.md`'s preflight bullet, both edited here, say it "folds every reachable one into a scratch merge", which reads the same way. The fold is per head: `checkScratchMergeCitations` at `f772ee9` calls `buildScratchMerge` with one head at a time.
- **low** · the five merged records: 29 citations changed (repo-51 21, repo-64 2, repo-67 1, repo-71 3, repo-75 2), all 29 checked, every anchor text unchanged, each record exit 0 under `--require-anchors --require-distinct-anchors`, each with a dated 2026-09-27 Log entry. repo-75's two were not coordinate-only: its `runBuildCommand` and `spawnRaw` citations went from two-line ranges to single lines, dropping the `shell: false` line under each that the row's claim rests on, though its Log entry says "coordinate only". They still verify; the range form keeps the claim checkable.
- **low** · the docblock of the #305-shaped `checkCiCommands` test at `f772ee9` overstates it: the fixture plants an unanchored `SKILL.md` citation, and #305's first head failed the same command on a moved one. The verdict is the same; the word "exactly" is not.
- **low** · the one new spawn in the test file, `removeWorktreeForTest` at `f772ee9`, omits `shell: false`, as the file's older ones do; the spawn-safety explicit-flag rule matches `spawn(` and not `spawnSync(`, so it sees none of them. All five new spawns in `scripts/preflight.mjs` write it out, and `packages/core/test/spawn-safety.test.ts` passes 5 of 5.
- **decision (open)** · what the scratch merge merges. Built: each open head onto `HEAD` separately, which proves the two-party `Done when` and never blames `HEAD` for two other heads' own conflict, `scripts/test/preflight.test.ts:1417 "does not fail HEAD for a conflict between two other heads"`. It misses a break that needs three parties — measured: a record citing a two-line range that two heads each shift by one passes both folds, while the three-way merge fails `citations.mjs` with `1 moved`; 160 of the records' 1,118 anchored citations are ranges. Nor does it fold `--base`, while CI's `pull_request` run checks the merge with the base: a base that moved a line HEAD's record cites leaves preflight green (measured). Options are in the gate's report.
- **dropped** · a CRLF checkout on Windows missing the `  check:` header: `.gitattributes` pins `* text=auto eol=lf`.
- **dropped** · two overlapping runs colliding on one scratch path: `mkdtemp` gives each its own, measured with two concurrent runs.
- **dropped** · the scratch commits escaping to a push: no ref is created, and the linked worktree's HEAD log goes with it.
- **dropped** · `feat` against these paths: preflight's title check reports `type and paths agree`, and with 0 paths under `tools/` release-please routes the change to no component, so `feat` and `fix` both land no changelog line. `feat` describes it: a new check and exit bit 32.
- **findings** · code-review at medium returned 15; 11 carried in 9 bullets (the second med and the decision each carry two), 4 dropped.
- Invariants: no shell ✓, style ✓ (no `console`, no `any` added); AppError, redaction, SSRF, progress, contract, Dockerfile and test registration skipped — nothing in the diff reaches them.
- NFR: security ✓ · performance — preflight took 43.5 s at this head against 30.2 s for the base's code over the same tree and the same three live heads; about 11.3 s of the 13.3 s is the three folds, about 3.75 s a head and linear in open pull requests, and 0.2 s the two derived commands · reliability — the two lows on the fold above · maintainability — the stale docblock above.

### Gate 2

**Gate: CONCERNS** — 2026-09-28 · round diff `f772ee9..6b10392` only (`origin/main` still at `a0841701`) · code-review at medium over the lines this round touched · coordinates re-resolved at `d2b07ea`, words, rows and verdicts as gated at `6b10392`. Eight citations whose text the gate-2 round deleted or whose claim it corrected are now prose naming what they pointed at in `6b10392`.

| Done when                                                                   | Proof                                                                                                                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight fails on a branch shaped like #305's first head                   | `scripts/test/preflight.test.ts:1131 "FAIL {2}node scripts\/citations"` — **proven**                                                                                       |
| … and on a pair of branches where one moves a line the other's record cites | `scripts/test/preflight.test.ts:1290 "fails on a citation two clean-merging heads move between them"` — **proven**; re-run live on the gate-1 pair: red, bit 16, `1 moved` |
| tests prove both                                                            | the two rows above — **proven**                                                                                                                                            |
| `npm run check` and the repo suite pass                                     | **verified** — `npm run check` exit 0; `npx vitest run --project repo` 549 of 549; `scripts/test/preflight.test.ts` 69 of 69                                               |
| Windows leg                                                                 | **unproven (gate)** — `test (windows-latest, informational)` in `ci.yml`                                                                                                   |

**Gate 1's findings:**

- **med, parser** · **fixed.** Steps are now grouped and anything but a lone one-line `run:` throws, naming the step: `scripts/preflight.mjs:402 "if (step.lines.length > 1 || value"`. All 16 gate-1 mutations re-run: baseline, a new step and a changed `citations.mjs` argument picked up; the other 13 loud; none wrong. Its test gap is a new finding below.
- **med, exclusion list** · **fixed.** A covered step must match exactly or it throws, the exact-match throw in `deriveExtraCiCommands` at `6b10392`: `--displaced-since` appended and `npm ci --ignore-scripts` both throw, and `npm ci` is not spawned. The residue is a low below.
- **low, misdiagnosed fold failure** · **fixed.** A failed worktree add throws naming it, `scripts/preflight.mjs:1091 "exited ${added.status}"`, and a merge with no unmerged path throws, `scripts/preflight.mjs:1128 "with no conflicting path — not a content conflict"`. The gate-1 bogus-oid probe now gives `invalid reference` and leaves no worktree. Tests: `scripts/test/preflight.test.ts:1484 "throws rather than report a non-conflict merge failure as a conflict"` and `scripts/test/preflight.test.ts:1504 "when it cannot create the scratch worktree"`.
- **low, interrupted run** · **not fixed, explained** in the Log (a process-wide signal handler, judged not cheap). Accepted: no ref is created.
- **low, stale per-head wording** · **fixed**, in the docblock, `SKILL.md` step 9 and `builder.md`. The base clause they add overstates, per the first med below.
- **low, repo-75 ranges** · **fixed**, `279-280` and `824-825`, each covering its `shell: false` line; the record exits 0.
- **low, #305 docblock** · **fixed**, now says same shape, not exactly.
- **low, test spawn flag** · **fixed**, `scripts/test/preflight.test.ts:1274 "{ cwd: repo, shell: false });"`.
- **decision** · **resolved by the owner** as option B. Built, and incomplete: the first med below.

**New in this round:**

- **med** · the base fold runs only when some other head is reachable. the empty-list early return in `checkScratchMergeCitations` at `6b10392` comes before its `merge-base --is-ancestor` check, so with zero other open pull requests a base that moved a line this branch's record cites still passes. Measured: the gate-1 base-moved probe gives `citations true`, `mergeTree true … nothing was checked`, while the same probe with one clean head fails `1 moved` (plus b, which HEAD does not yet contain). The fold's own test at `6b10392` needs a filler head, and its docblock says so. The owner's option B carried no such condition, and neither does the docblock, `SKILL.md` step 9 or `builder.md`. No `Done when` line depends on it.
- **med** · neither med fix is asserted by any test. A mutant with both the `step.lines.length > 1` clause and the exact-match throw removed passes `scripts/test/preflight.test.ts` 69 of 69, while it reads a `name:`-first step silently and lets an altered covered step through again (measured). The block-scalar and shell-operator tests at `6b10392` cover only the paths gate 1 found loud already or the new `assertSpawnable`. The Log says the table came from the gate's script, not a test.
- **low** · `COVERED` at `6b10392` compares raw text, so `npm  ci` (two spaces) and `npm clean-install` (the alias of `npm ci`) are not recognised and spawn a real install (measured through `deriveExtraCiCommands`), against the docblock's whatever the step's exact text. Comparing tokens would close it.
- **low** · `assertSpawnable` at `6b10392` rejects `&&`, `|` and ` #` only: `;`, a glued `>/dev/null` or `2>/dev/null`, `$VAR` and a quoted YAML scalar still reach `spawnSync` as literal arguments (measured). With today's scripts each fails loudly, since `status.mjs` rejects `>/dev/null` and `--json;` with exit 1 (measured); a `$VAR` passed to a script that accepts any value would be silent (unmeasured).
- **low** · the docblock of `checkScratchMergeCitations` at `6b10392` names `reference/records.md` as the page for the whole-batch scratch merge; it is `SKILL.md` step 11, `.claude/skills/orchestrate-tickets/SKILL.md@a0841701:224 "Scratch-merge the batch"`.
- **low** · the Log's mutation table (this ticket's `## Log`, the 2026-09-28 entry) has a broken `blockPipeDash` row: the escaped pipe inside a code span split it into five cells. It also calls the old `|-` and `>-` behaviour silently spawned; at `f772ee9` those spawned a command named `|-`, which `runBuildCommand` reports as a failed spawn (read, not run): loud but mislabelled.
- **dropped** · a check job re-indented to compact list style reads zero steps and passes silently, but `npx oxfmt --check` rejects that file (exit 1, measured), so check 1 fails first.
- **dropped** · a `--base` that does not resolve reaching the fold's `rev-parse`: `preflight()` raises `EXIT.setup` before any check runs.
- **findings** · code-review at medium over the round diff returned 8; 6 carried, 2 dropped. Gate 1's 9 findings: 7 fixed, 1 not fixed but explained, 1 decision resolved.
- Merged records: 29 citations changed this round (repo-51 21, repo-64 2, repo-67 1, repo-71 3, repo-75 2, both of repo-75's single lines back to ranges); all 29 checked, anchors unchanged, each record exit 0, each with a dated 2026-09-28 Log entry.
- Invariants: no shell ✓ (three new spawns in `scripts/preflight.mjs`, each with `shell: false`; `spawn-safety.test.ts` 5 of 5); style ✓.
- NFR: security ✓ · performance — preflight 38.4 s, exit 0, at `6b10392` against four live heads (#312, #311, #294, #284); gate 1 measured 43.5 s against three, and this gate did not re-time the base, so no delta is claimed · reliability — the first med · maintainability — the second med.

### Gate 3

**Gate: CONCERNS** — 2026-09-28 · round diff `6b10392..d2b07ea` only (`origin/main` still at `a0841701`) · code-review at medium over the lines this round touched · every coordinate resolves at `d2b07ea` · CONCERNS only because the Windows row stays unproven (gate); nothing above low

| Done when                                                                   | Proof                                                                                                                        |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Preflight fails on a branch shaped like #305's first head                   | `scripts/test/preflight.test.ts:1131 "FAIL {2}node scripts\/citations"` — **proven**                                         |
| … and on a pair of branches where one moves a line the other's record cites | `scripts/test/preflight.test.ts:1290 "fails on a citation two clean-merging heads move between them"` — **proven**           |
| tests prove both                                                            | the two rows above — **proven**                                                                                              |
| `npm run check` and the repo suite pass                                     | **verified** — `npm run check` exit 0; `npx vitest run --project repo` 560 of 560; `scripts/test/preflight.test.ts` 80 of 80 |
| Windows leg                                                                 | **unproven (gate)** — `test (windows-latest, informational)` in `ci.yml`                                                     |

**Gate 2's findings:**

- **med, base fold skipped with no other heads** · **fixed.** The early return now needs base to be contained too, `scripts/preflight.mjs:1235 "if (otherHeads.length === 0 && baseIsAncestor) {"`. The gate-1 base-moved probe, no other heads, now reports `scratch merge of HEAD with b alone, which HEAD does not yet contain: FAIL docs/work/repo-999-gate-probe.md — 1 moved`; the control with base contained still says nothing was checked. Restoring the old early return turns `scripts/test/preflight.test.ts:1610 "folds base in when there are no other open heads at all"` red, 1 of 80.
- **med, med fixes untested** · **fixed.** Each fix removed alone turns tests red: the `step.lines.length > 1` clause, 4 of 80, starting at `scripts/test/preflight.test.ts:1653 "throws on a name:-first step"`; the `assertSpawnable` call, 2 of 80, `scripts/test/preflight.test.ts:1717 "throws on a step chained with && through"` and `scripts/test/preflight.test.ts:1821 "throws on each of the five newly caught shapes"`; the exact-match throw, `scripts/preflight.mjs:625 "if (canonicalize(raw) !== covered.exact) {"`, 1 of 80, `scripts/test/preflight.test.ts:1739 "throws on npm ci --ignore-scripts rather"`.
- **low, COVERED raw text** · **fixed** for the two spellings measured: `npm  ci` and `npm clean-install` are now covered and not spawned. A residue is below.
- **low, assertSpawnable** · **fixed**: the semicolon, glued `>/dev/null` and `2>/dev/null`, `$VAR` and quoted-scalar mutations all throw. The docblock discloses the false positive on a legitimately quoted operator.
- **low, wrong page** · **fixed**; the docblock now names `SKILL.md` step 11.
- **low, Log table** · **fixed**; the row has three cells again, and `npm run check` exits 0 over it. The earlier entry was corrected in place and a new dated Log line says so.

**New in this round:**

- **low** · `scripts/preflight.mjs:432 "const NPM_ALIASES"` knows one alias of `npm ci`. `npm ci --help` lists four (`clean-install, ic, install-clean, isntall-clean`), and `npm ic`, `npm install-clean` and `npm isntall-clean` in the check job each spawn (measured through `deriveExtraCiCommands`), against the docblock's own claim to know npm's alias.
- **low** · the comment at `scripts/preflight.mjs:1230 "it is every solo ticket"` says `otherHeads` is `[null]`; the sentinel list is `targets`, and `otherHeads` stays empty.
- **dropped** · a glued-redirect or `$` false positive on a legitimately quoted argument: disclosed in the docblock, and no check-job step has one.
- **dropped** · the fixer rewrote a row of the 2026-09-28 Log entry in place: it is disclosed in a new dated Log line, and it is the correction gate 2 asked for.
- **findings** · code-review at medium over the round diff returned 4; 2 carried, 2 dropped. Gate 2's 6 findings: 6 fixed.
- Mutations re-run at `d2b07ea`: `gate1-mutate.mjs` 16 of 16 as at gate 2 (3 picked up, 13 loud, none wrong); `gate2-mutate-extra.mjs` 9: `npm  ci` and `npm clean-install` covered and not spawned, 6 loud, and a compact-indented check job still reads zero steps, which `oxfmt --check` rejects.
- Merged records: 6 citations changed this round (repo-51 3, repo-64 1, repo-67 1, repo-75 1, the range `824-825` to `895-896` with its width kept and its `shell: false` line inside it); all 6 checked, anchors unchanged, each record exit 0, each with a dated 2026-09-28 Log entry. `citations-gate.mjs --against origin/main` exit 0.
- NFR: security ✓ · performance — one extra fold when the branch is behind base and no other head is open; not re-timed · reliability ✓ · maintainability — the comment above.

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
- 2026-09-28 — post-gate fixer round, **unreviewed**: gates 1–3 above describe
  `d2b07ea`; this fix is `bb006445e744f659281303e8ab733c3cd7a964c1`, landed on
  the owner's decision to fix now rather than merge #314 with `test
(windows-latest, informational)` red or hold it, and it has not itself been
  gated. CI's Windows leg failed five tests at `ee0fd22` (`buildScratchMerge
folds every reachable head in…`, `checkScratchMergeCitations fails on a
citation two clean-merging heads move between them`, `checkMergeTree runs the
scratch-merge citations step…`, and both `…folds base in…` tests); reproduced
  locally, same five, forcing `GIT_CONFIG_KEY_0=core.autocrlf
GIT_CONFIG_VALUE_0=true` (75 of 80, the same five red). **Established as
  test-only, not a defect in `scripts/preflight.mjs` itself.**
  `checkScratchMergeCitations`'s scratch worktrees are read by
  `citations.mjs`'s `extractSections`, whose heading regex
  (`/^(#{1,6})[ \t]+(.*\S)[ \t]*$/`) cannot match a line ending `\r\n` — `.` and
  `\S` never match `\r` in a JS regex with no `/s` flag — so a CRLF-terminated
  file loses every heading, and therefore every `## Review` section and every
  citation in it, silently: measured directly, a scratch merge holding one
  moved citation reported `ok: true, clean over 0 record(s)` under a CRLF
  checkout, `1 moved` under LF. The real corpus never hits this: this repo's
  own `.gitattributes` (`* text=auto eol=lf`) forces LF on every checkout
  regardless of `core.autocrlf`, proven by adding the identical line to a
  scratch copy of the throwaway fixture and re-running the unmodified
  `checkScratchMergeCitations`/`buildScratchMerge` under the forced config —
  clean. `makeRepo()`'s throwaway repos carried no `.gitattributes` at all.
  **Fix, line-neutral**: `scripts/test/preflight.test.ts` now writes that same
  `.gitattributes` into every throwaway repo right after `git init`, replacing
  what was a blank separator line so the file's insertions equal its deletions
  (`git diff --numstat`: 1/1) and no cited line moved or changed.
  `scripts/preflight.mjs` untouched. Commands: `npx vitest run
scripts/test/preflight.test.ts` — 5 of 80 red at `ee0fd22` under forced
  `core.autocrlf=true`, 80 of 80 green after, both under the forced config and
  without it. `npx vitest run --project repo` — 560 of 560. `npm run check`
  exit 0. `node scripts/citations-gate.mjs --against origin/main` exit 0: 128
  enforced, 0 failing, 6 grandfathered, 0 raised.
- 2026-09-28 — repo-82 fixed the CRLF defect this ticket's own post-gate
  fixer round diagnosed and worked around test-only (above): `citations.mjs`
  now strips a trailing `\r` from every line it splits before matching, in
  `extractSections`, `extractCitations` and `extractDeclarations`. It also
  fixed both lows this ticket's gate 3 disclosed rather than closed (`### Gate
3`'s "New in this round"): `NPM_ALIASES` now covers all four of `npm ci`'s
  own aliases, and the fold-loop comment names `targets` rather than
  `otherHeads`. Both edits moved six of this record's own `## Review`
  citations, coordinate only, anchor text unchanged: `scripts/preflight.mjs`
  1050 (`exited ${added.status}`) to 1063; 1087 (`with no conflicting path —
not a content conflict`) to 1100; 1193 (`if (otherHeads.length === 0 &&
baseIsAncestor) {`) to 1207; 592 (`if (canonicalize(raw) !== covered.exact)
{`) to 605; 453 (`const NPM_ALIASES`) to 461; and 1189 (`it is every solo
ticket`) to 1202. `node scripts/citations-gate.mjs --against origin/main`
  named all six `moved` at exactly these new lines before the repoint.
- 2026-09-28 — repo-82's gate 1 fixer round fixed the med (the CLI test's
  coordinate is now read out of the record text it loads, not hard-coded) and
  four lows, two of which touched `scripts/preflight.mjs` again: a guard so
  any `npm` step `deriveExtraCiCommands` does not already recognise throws
  rather than falls through to a real spawn (`npm install-clea`, `npm
isntall-cl` and `npm cit` all resolve to a real `npm ci` under npm's own
  prefix/alias resolution and matched no guard before this), and splitting
  the docblock the same low named — misplaced above `NPM_ALIASES`, describing
  `COVERED` — into one paragraph beside each. Both edits moved six of this
  record's own `## Review` citations again, coordinate only, anchor text
  unchanged: `scripts/preflight.mjs` 1063 (`exited ${added.status}`) to 1091;
  1100 (`with no conflicting path — not a content conflict`) to 1128; 1207
  (`if (otherHeads.length === 0 && baseIsAncestor) {`) to 1235; 605 (`if
(canonicalize(raw) !== covered.exact) {`) to 625; 461 (`const NPM_ALIASES`)
  to 432 — this one moved _up_, since the split leaves less text above
  `NPM_ALIASES` than the misplaced docblock had; and 1202 (`it is every solo
ticket`) to 1230. `node scripts/citations-gate.mjs --against origin/main`
  named all six `moved` at exactly these new lines before the repoint, and
  exit 0 with 0 failing after.
