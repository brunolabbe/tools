---
id: repo-128
tool: repo
title: The repo and core suites take 44 s on ubuntu and 251 s on Windows, mostly in fixture spawns
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-128 — The repo and core suites spend their time in fixture spawns

## Why

The test-suite audit of 2026-10-25 compared per-file CI times (run
`40210503276`). The `repo` project is 44 s summed on ubuntu and **251 s on
Windows**, because almost every case spawns `git`, `node` or `bash`, and a
Windows spawn costs about 100 times more. repo-106 and repo-113 already trimmed
`review-record.test.ts`; the same fixes were never applied to its neighbours.
The Windows leg is `continue-on-error` and no ruleset requires it, so these
seconds only help whoever waits for that leg. On ubuntu the win is about 17 s
summed.

## Decision — answered 2026-10-25 by the owner

Asked which removals of coverage are acceptable. Two answers apply here:

- **Clear duplicates may be deleted.**
- **The Linux-only harness hooks are skipped on Windows.** `hooks.test.ts` and
  the `worktree-farm.sh` cases in `check-farm-freshness.test.ts` test bash
  scripts wired in `.claude/settings.json` for the Linux devcontainer. Together
  they cost ~47 s on Windows.

## Build

Estimated seconds saved are given as ubuntu / Windows. All are estimates from
reading the code, priced from repo-113's per-spawn Windows costs, unless marked
measured.

1. `scripts/test/hooks.test.ts`: `describe.skipIf(process.platform === "win32")`,
   with a comment saying why (Linux-only harness). 0 / 39 s (measured).
2. `scripts/test/check-farm-freshness.test.ts`: skip the `worktree-farm.sh`
   cases on win32 the same way. `makeGitRepo` (`:72`) runs 17 `git init`s for
   repos that only need `rev-parse --show-toplevel`; share one per file.
   0.1 / 8 s.
3. `packages/core/test/spawn-safety.test.ts:56-86`: the tree is walked once, but
   each of the three scans re-runs the hand-written `mask()` tokenizer over
   every file (`support/spawn-calls.ts:388`). Cache `mask(text, true)` per
   source. 2.5 / 3 s (measured locally at 0.69 + 0.62 + 0.72 s).
4. `scripts/test/preflight.test.ts:73` `makeRepo`: write the identity with
   `appendFileSync` and copy an empty template repo per file, as repo-113 did in
   `review-record`. The 101 `git config user.*` spawns and 50 `init`s become
   copies. 0.5 / 8 s.
5. `scripts/test/preflight.test.ts:317` `makeTitleRepo`: with `--title` given,
   `checkTitle` never calls git (`commit-message.mjs:84,130`). Use one plain temp
   dir holding `release-please-config.json` and `tools/`, shared by the
   checkTitle cases. 0.2 / 3 s.
6. `scripts/test/next-id.test.ts:738` `ticketRemote` (used by ~12 tests): it
   makes about 250 git spawns per fixture (32 each of add, commit and push, plus
   20 checkouts). Build each history with one `git fast-import` into the bare
   repo, then one fetch. Take care with tests that need an unfetched state.
   1 / 12 s.
7. `scripts/test/review-record.test.ts:1150` `withLandRepo` (~17 land tests):
   template the bare and working pair once per file and fix the remote URL with
   an edit of `.git/config`. The three cases that fail at setup (`:1463`,
   `:1587`, `:1834`) never reach the remote, so they can use `withTicketRepo`.
   0.3 / 7 s.
8. Duplicates:
   - `review-record.test.ts:1328` repeats `:1587` (its own title says
     "superseded by G2-a"). Fold its one unique `git status` assertion into
     `:1587` and delete it.
   - `:505` and `:659` share one fixture and one command; merge them.
   - `check-lockfile-sync.test.ts:169` re-runs the two real `npm install`s that
     `:111` and `:122` already run. Move its cwd spy into those cases. 0.9 / 0 s.
9. `scripts/test/status.test.ts:101` `run()` makes 57 CLI spawns, and its cost
   is CPU, not spawning (7.0 s ubuntu, 12.0 s Windows). Keep about ten spawns,
   for exit codes and flags, and test rendering through the exported functions.
   ~2.5 / 4 s. (Running it twice in CI is repo-127's.)
10. `scripts/test/test-gate.test.ts:301` sets `TEST_GATE_SETTLE_MS: "2500"`. Try
    1000 and keep the change only if the file passes 10 runs in a row locally.
    1.5 / 0 s. Low confidence: a flake costs more than the saving.
11. Stale prose: `preflight.test.ts:4,13,69,1312` and `review-record.test.ts:6`
    cite citations test files retired by adr/006. Reword them.

## Done when

1. `npm test -- --project repo` and `--project core` pass on ubuntu and on the
   Windows leg of this pull request's CI.
2. The Windows leg's `repo` project time is at least 60 s lower than run
   `40210503276`'s 251 s, read from this pull request's CI log.
3. `hooks.test.ts` and the `worktree-farm.sh` cases still run on ubuntu, and are
   reported as skipped on Windows.
4. Each deleted or merged case is named in the Log, with the case that still
   covers its assertion.

## Review

**Gate: PASS** — 2026-10-25 · `7f8d7f48..397d1935` · Opus 5.5, depth full

| Done when                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `--project repo` and `--project core` pass on ubuntu and on the Windows leg        | **verified** — this pull request's CI at `397d1935`: `test (ubuntu-latest)` pass (repo 14 files, core 8 files, 0 failed) and `test (windows-latest, informational)` pass (repo 14 files, core 8 files, 0 failed). Locally every touched spec file passed, 3 shuffled seeds each, except a base-inherited order dependence in `preflight.test.ts` (dropped below)                                                                                                                                                                                                                                                                                                                                                                                            |
| 2. Windows `repo` time at least 60 s below run 40210503276's 251 s                    | **verified** — per-file durations summed from the job logs: 251.4 s in run 40210503276 (the method reproduces the brief's figure), 104.2 s in this pull request's Windows leg at `397d1935`, 147.2 s lower. See the `low` on how much of it is the runner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3. `hooks.test.ts` and the `worktree-farm.sh` cases run on ubuntu, skipped on Windows | **verified** — ubuntu leg at `397d1935`: `hooks.test.ts` 34 tests and `check-farm-freshness.test.ts` 28 tests, none skipped; Windows leg: `hooks.test.ts` "34 tests, 34 skipped", `check-farm-freshness.test.ts` "28 tests, 8 skipped", and `farmTest` is the only skip in that file and wraps exactly the 8 cases that spawn `worktree-farm.sh`                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4. Each deleted or merged case named in the Log, with what still covers it            | **verified** — the Log names all three. Planting each defect turned the named survivor red: `land()` discarding, committing or `reset --hard`-ing the real checkout fails `review-record.test.ts` › "land() refuses at setup when a tracked file has an uncommitted change, before any clone or commit (gate 2, G2-a)" (3 of 3 plants); advice that mentions `git stash` fails › "refuses to run when the ticket has uncommitted changes against HEAD, touches nothing, and advises committing, never stashing"; `check-lockfile-sync.mjs` leaving its temporary directory fails › "a lockfile that matches every manifest passes…" when it leaks on a pass, and › "a lockfile one workspace version behind fails…" when it leaks on a fail (3 of 3 plants) |

- **low** · `nfr:maintainability`, false in the safe direction · `scripts/test/hooks.test.ts`, the
  comment above `linuxOnly`: it says the 34 skipped cases all "spawn bash", but three of them
  read files and spawn nothing ("every hook is wired into the PreToolUse Bash matcher",
  "check-tree-grep's header carries the reasoning…", "check-tree-grep cites its siblings…").
  The owner's decision skips the whole file on Windows, so the skip is right and only the
  count's description is wrong. Nothing relies on it.
- **low** · no `Done when` line depends on it · the 147 s saving in Done when 2 is not
  like for like. Main's Windows leg at the base sha (run 40222603997) also ran unchanged
  code much slower than this pull request's leg did: ledger 125.0 s against 71.1 s,
  planner 44.5 s against 27.4 s, and the six untouched `repo` files 2.32 s against
  1.32 s. Some of the drop from 273.1 s (the base sha's own `repo` figure) is therefore
  the runner. Skipping `hooks.test.ts` (39.4 s) and the farm cases (about 6 s) saves the
  same amount whatever the runner. Scaling the base by the untouched files' 0.57 still
  leaves about 51 s, and scaling by downloader's 0.89 leaves about 138 s. The line as
  written is met.
- **dropped** · `preflight.test.ts` › "no preflight-ghshim directory this file made is left
  behind (repo-110)" fails under `--sequence.shuffle` with seeds 1 and 2. The base's copy
  of the file fails on the same seeds, so the branch did not cause it, and it is outside
  the reviewed range. It is a defect with a reproduction, so it could be filed.
- **dropped** · `next-id.test.ts` leaves 30 temporary directories per run, 24 of them
  `next-id-edit-*`. The base's copy leaves the same 30, so the branch did not cause it.
- **dropped** · `status.test.ts`'s `repoWith` never removes its directories. This was
  already true at the base, and the branch did not touch it.
- **findings** · the hunt returned 5; 2 carried, 3 dropped.
- Settled by the owner and attacked as asked: `status.mjs`'s `cli()` against the base
  script, byte for byte. 30 cases matched in stdout, stderr and exit code: every view and
  flag, `--prs` through a `gh` shim that answers, one that fails and none at all, a quoted
  scalar, a dangling `depends_on` with `--json` exiting 1, a render that throws after
  partial output, and output piped into `head -1`. That is 0 differences. Three plants
  in `status.mjs` (the entry point ignoring `cli`'s status, the catch returning 0,
  `--json` never failing) each turned `status.test.ts` red, with 4, 6 and 4 failures.
- NFR: security n/a (test-only, except `status.mjs`, whose behaviour is unchanged) ·
  performance ✓ (Done when 2) · reliability ✓ (copies share no state: 24 shuffled runs,
  no copy or template path in a copied `.git`; `TEST_GATE_SETTLE_MS` 1000 passed 10 of 10
  beside a looping `--project core` run, and 10 of 10 beside 12 busy loops on 12 cores,
  where a settle of 0 ms failed 2 of 3) · maintainability: see the first `low`.

## Log

- 2026-10-25: Filed from the test-suite audit; see
  [repo-127](./repo-127-pull-requests-run-every-project-whatever-they-touch.md).
  Spawn counts measured with a git-counting shim: review-record 691, preflight
  464, next-id 287.
- 2026-10-25: Built on `repo-128-spawn-trims`, from `7f8d7f48`. Ubuntu, one
  spec file at a time, `npx vitest run <file>`, base then branch (Duration):
  `hooks.test.ts` 1.25 s → 1.34 s (34 tests, same), `check-farm-freshness`
  1.48 → 1.53 s (28, same), `spawn-safety` 2.36 → 1.27 s (18, same),
  `preflight` 2.80 → 3.12 s (109, same), `next-id` 3.12 → 2.67 s (52, same),
  `review-record` 17.45 → 16.64 s (64 → 62), `check-lockfile-sync` 1.74 →
  1.08 s (7 → 6), `status` 4.61 → 1.34 s (147, same), `test-gate` 5.69 →
  4.10 s (29, same). `npm test -- --project repo` 616 → 613 tests, `--project
  core` 85 → 85, both exit 0. The ubuntu numbers are the small half of this
  ticket: preflight is within noise and a little slower, because a `cpSync` of
  a repository directory costs about what two `git config` spawns do on Linux.
  **The Windows leg is unmeasured here**; Done when 2 is read from this pull
  request's CI.
  - Build 1 and 2: `hooks.test.ts`' 34 cases and the 8 `worktree-farm.sh` cases
    in `check-farm-freshness.test.ts` skip on win32 (`test.skipIf`, the
    file's own `testOffWindows` moved up and renamed `farmTest`, which already
    guarded 3 of the 8). `hooks.test.ts` uses a `linuxOnly = test.skipIf(...)`
    alias, not a wrapping `describe.skipIf`: the wrap put `checkoutOn` in a
    closure and `npm run check` failed `unicorn(consistent-function-scoping)`.
    `makeGitRepo` copies the `.git` of one `git init --template=` made per file
    rather than sharing one repository, because the farm and
    `makeWorkspaceTree` write into the tree and a shared one would carry one
    case's `node_modules` into the next.
  - Build 3: `mask()` in `packages/core/test/support/spawn-calls.ts` caches by
    text, one map per `keepLiterals`. `--reporter=verbose` on the branch: the
    first scan ("no call site sets `shell`") pays the tokenizer once, 669 ms; the
    shell-runner scan took 5 ms and "every file that spawns says `shell: false`"
    95 ms, where the brief measured 0.69 + 0.62 + 0.72 s.
  - Build 4 and 5: `preflight.test.ts` `makeRepo` copies a template made once per
    file (identity and `maintenance.auto = false` appended to its `.git/config`,
    `.gitattributes` in the tree); `makeTitleRepo` is gone for
    `titleFixtureDir()`, one plain directory for the five `checkTitle` cases
    (the `test.each` counts as five).
  - Build 6, **partly**: `ticketRemote` copies a bare-and-clone pair built once
    per distinct `merged` map, with the clone's `origin` URL rewritten in
    `.git/config`; 5 of its ~15 spawns per test go. **The `git fast-import`
    rewrite was not done.** The tests reach into `peer` itself: `cutFrom` checks
    out `-b <name> <parent>` from a local branch `branch()` made, the two orphan
    cases check out and `rm --cached` in it, and "a branch that edits, adds,
    deletes and renames" removes a file from its working tree with `fs.rmSync`.
    An import into the bare repository would leave no local branches and a stale
    working tree, so those tests would need rewriting around a fetch. That is
    the larger, riskier change for the 1 s / 12 s the brief estimated. Open: do
    it in a follow-up ticket, or accept the template as the whole of Build 6.
  - Build 7: `withLandRepo` copies a bare-and-working pair built once per file
    (`landRepoTemplate`), with the working copy's `origin` rewritten. The three
    setup-refusal cases ("the --land CLI refuses a missing flag", "land() refuses
    at setup when a tracked file has an uncommitted change", "land() refuses a
    detached HEAD with no --branch") use `withTicketRepo`.
  - Build 8, deleted or merged, each with what still covers it:
    - "land() never touches the real repository while validating … superseded at
      setup by gate 2, G2-a" is deleted; "land() refuses at setup when a tracked
      file has an uncommitted change" covers it (same `setup` refusal, same
      untouched `HEAD`), and gained its one unique assertion,
      `git status --porcelain` still names `src/tls.ts`.
    - "the dirty-ticket refusal advises committing, never stashing" is merged
      into "refuses to run when the ticket has uncommitted changes against HEAD,
      touches nothing, and advises committing, never stashing": same fixture,
      same command, both `commit them first` and `not /stash/` assertions kept.
    - "its temporary directory is removed, whatever the verdict" in
      `check-lockfile-sync.test.ts` is deleted; the passing-lockfile case and
      the one-version-behind case now record each `npm` cwd (`noteNpmDirs`) and
      assert it is gone, so a pass and a fail verdict are both still checked,
      and the two extra `npm install`s are not run.
  - Build 9: the brief said to test rendering through the exported functions,
    but the default view and `--show` are not exported; they were
    `process.stdout.write` calls inside `main`. `scripts/status.mjs` now exports
    `cli(argv, io)`, returning the exit status, with `process.stdout/stderr` as
    the default `io` and the entry point reduced to
    `process.exitCode = cli(process.argv.slice(2))`. `status.test.ts`' `run()`
    calls it in-process; `runProcess()` keeps 9 spawns (the rootless `sniffer`
    case, `--write`/`--check` (2), `--json` on a dangling dependency, `--json`
    on a duplicate id, `--json` exit 0, `--show` beside a dangling dependency,
    `--tool planner --ready`, and `--markdown` with nothing open), which is what
    still proves the entry point's exit code and that stdout and stderr stay on
    separate pipes.
  - Build 10: `TEST_GATE_SETTLE_MS` 2500 → 1000, `npx vitest run
    scripts/test/test-gate.test.ts` 10 runs in a row, all exit 0, 29 of 29 each.
  - Build 11: `preflight.test.ts` lines 4, 13 and 69 and `review-record.test.ts`
    line 6 no longer cite the retired citations test files, and the comment on
    the second `workingTreePaths` import says adr/006 retired the rule it was
    written for. The import was **not** moved into the top block: repo-127's
    pull request (#658) edits that block.
  - Fold-in: none. Nothing else the work freed was small and already specified.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the first low — "the
  comment above `linuxOnly` says the 34 skipped cases all 'spawn bash', but
  three of them read files and spawn nothing". The gate counted three; the
  lander found five (the two `check-main-writes` cases at lines 388 and 505 as
  well, each only a `readFileSync`), and the comment now says 29 spawn bash and
  five only read files. `git diff 397d1935 -- scripts/test/hooks.test.ts | grep
  -c '^-.*34 cases that spawn bash'` → `1`.
- 2026-10-25 — Owner answers recorded by a maintenance dispatch. The
  orchestrator put both questions through `AskUserQuestion` on 2026-10-25; they
  were not in this Log before this entry. No code or test changed.
  - Build 6, `ticketRemote`: should the template stand in place of the brief's
    `git fast-import` rewrite? Options: "accept the template as the whole of
    Build 6" (the builder's recommendation, **chosen**); "file a follow-up for
    fast-import". Build 6 is closed, and no follow-up ticket is filed.
  - Build 9: keep the production change that makes `scripts/status.mjs` export
    `cli(argv, io)`? Options: "keep it, and the gate attacks it" (the recommended
    option, **chosen**); "revert it". Gate 1 then found 0 differences over 30
    cases (see `## Review`).
