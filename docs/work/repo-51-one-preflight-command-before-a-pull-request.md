---
id: repo-51
tool: repo
title: One preflight command replaces the pre-PR checks the skill pages ask for by hand
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-51 — One preflight command replaces the pre-PR checks the skill pages ask for by hand

## Why

The orchestration history's recurring "what the skill got wrong" items are
mostly forgotten steps, each one command, each costing a round when missed:

- the citations gate not run before the push, so the pull request went red in
  CI (nineteenth session, item 1; recurred unchanged in the twentieth and the
  twenty-first);
- the `## Review` section not present on the branch when the pull request
  opened — `repo-29` reached an open PR carrying five gate rounds and no record
  (fourteenth session, item 4);
- a `feat` or `fix` title on a branch whose only `tools/` paths were markdown,
  which release-please routes to a tool's changelog (seventeenth session, item
  5; twentieth, item 12);
- two open branches in one batch that `git merge-tree` would have shown
  conflicting on a gate record, found only at merge (seventeenth, nineteenth
  and twentieth sessions).

On 2026-09-20 the sweep of those sessions wrote all four into `SKILL.md` step 9
and `builder.md`'s gate list as prose. Prose rules failed for eleven sessions;
the one instrument in this loop that stopped being wrong is the id sweep, and it
stopped when it became `scripts/next-id.mjs` with a test per guard. The same
argument applies here.

## Build

Add `scripts/preflight.mjs`, run from a branch's worktree with the base as an
argument, that performs in order and reports each with its own exit bit:

1. `npm run check`, and the project suite for each tool the diff touches (read
   the paths, not a flag);
2. `node scripts/citations-gate.mjs --against <base>`;
3. the `## Review` presence test — `git show HEAD:<ticket> | grep '^## Review'`
   for every ticket the branch marks `done`, and a distinct message for a
   `done` ticket with no record;
4. the title-type test — read the intended title from `--title` or the branch's
   last commit subject, run `scripts/commit-message.mjs` over it, then check
   whether the type is hidden in `release-please-config.json` and, if it is not,
   whether every `tools/<tool>/` path in `git diff --name-only <base>...HEAD` is
   markdown; fail with the reason when a changelog would be cut for a docs-only
   change;
5. `git merge-tree --write-tree HEAD <head>` against every other open pull
   request head (`gh pr list --json headRefName`), reporting the conflicting
   paths and which are gate records.

Print one line per check with its result, and the exit code as a bitmask the
way `citations.mjs` does, so a ship condition can be "preflight exits 0".

Then replace the prose: `SKILL.md` step 9's three checks and `builder.md`'s
gate list name the script and nothing else. Keep the measurements that explain
why each check exists; drop the instructions to run them by hand.

## Done when

- `node scripts/preflight.mjs --base origin/main` exits 0 on a clean branch and
  non-zero, naming the check, on each of: a moved citation in a merged record, a
  `done` ticket without `## Review`, a `feat` title over markdown-only `tools/`
  paths, and a gate record two open heads both edit. Each case is a test that
  plants the failure and reads the bit.
- A positive control for check 5: a test that opens no conflict exits 0 and
  says so, so an empty PR list cannot read as a pass.
- `SKILL.md` step 9 and `builder.md` name the script and no longer list the
  checks as separate instructions.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history,
  after the sweep in #281 had written these checks as prose. Not built there:
  it is a script with tests, and #281 is scoped to the pages.

- 2026-09-20 — Built `scripts/preflight.mjs` and `scripts/test/preflight.test.ts`.
  Scope narrowed by the dispatch: the `SKILL.md`/`builder.md` prose replacement
  named in Build's last paragraph is deferred to the orchestrator, who is
  editing both pages once across several builders working the same session;
  the replacement text was handed back in this builder's report rather than
  applied here, and `.claude/` was not touched.

  **What the Build section did not say, found by measurement rather than
  assumed:** `git merge-tree --write-tree` exits `1` for a genuine conflict
  _and_ for a ref that does not resolve, with the only reliable difference
  being that a real merge (clean or conflicting) always writes its tree oid to
  stdout first, where a bad ref writes nothing to stdout and puts the reason on
  stderr. `mergeTreeConflicts` in the new script keys on stdout being non-empty
  rather than on the exit status for exactly this reason; an earlier version
  keyed on the status alone and could not tell "two branches conflict" from
  "the ref does not exist," which would have made check 5 report a false
  positive.

  Each check reuses the tool that already enforces it rather than re-deriving
  it: check 2 imports `gate`/`compareAgainst` from `citations-gate.mjs` over
  its own `SCOPE`; check 3 and check 5 both resolve "is this a ticket file"
  from `SCOPE.records`'s own globs rather than a second copy; check 4 imports
  `validate`/`releasingTypes`/`toolScopes` from `commit-message.mjs` and calls
  `releasingTypes(repo)`/`toolScopes(repo)` against the repository under test
  (not this script's own installation), so a fixture's own
  `release-please-config.json` decides the answer, per the dispatch's
  instruction to never hardcode the hidden-type list.

  **Check 1 is narrower than the other four, and is documented as such rather
  than left to look the same.** `npm run check` / `npm test` cannot run for
  real against a throwaway git fixture with no `node_modules`, so its test
  coverage is an injected `run` stub (success and failure paths), not a
  planted git fixture the way the other four Done-when cases are. The
  "clean branch exits 0" pipeline test stubs only the `npm` calls and runs
  every other check for real against one fixture.

  Gates: `npx vitest run scripts/test/preflight.test.ts` — 25 passed;
  `npm run check` — lint, format, typecheck all exit 0 (a `scripts/test/tsconfig.json`
  `include` entry for `preflight.mjs` was needed, the same one-line cost
  `citations-gate.mjs` paid before it, per that file's own comment);
  `npm test -- --project repo` — 371 passed; `npm test` (full suite, run
  because `scripts/test/tsconfig.json` is shared config) — 176 files, 3177
  tests, exit 0.

- 2026-09-20 — Round 2, on the orchestrator's authority, after the reviewer's
  gate 1 (CONCERNS: 5 med, 2 low, every reachable Done when line proven).
  Reproduced two of the five med findings by hand before the orchestrator's
  own decisions arrived — the merge-tree exit-status ambiguity (confirmed
  against real git 2.43.0: a bad ref and a real conflict both exit 1, and only
  stdout being non-empty tells them apart — the Log above already had this
  half right) and the merge-commit title bypass (`--title "Merge branch 'main'
into work"` printed `ok    "undefined" is hidden …`, reproduced verbatim).
  The orchestrator then settled both open decisions and specified all six
  fixes; none were left to this builder's judgement.

  Applied, each with its own planted-failure test:
  1. Check 5 now compares by commit oid (`gh pr list --json … headRefOid`),
     not by `origin/<headRefName>` — a stale local mirror of a peer's branch no
     longer reads as clean. Self-exclusion is by oid too, which closes low
     finding 6 (a detached `HEAD` defeated the old branch-name comparison) as
     a side effect. An oid this checkout does not have is now a failure
     (`git fetch` named as the repair), not a silent skip.
  2. `preflight` verifies `--base` resolves before any check runs and raises
     `EXIT.setup` (64) itself; a bad `--base` used to propagate git's raw exit
     status (128), which the `EXIT` docblock's own claim already asserted
     falsely. Each check is now run through `guarded()`, so a check whose own
     internals throw — `gh` unauthenticated, a pull request head absent from
     the clone — becomes that check's own FAIL line and bit, and the other
     four still print. Measured before the fix: unauthenticated `gh` inside
     check 5 aborted the whole run and left the failing child's own status (a
     `gh` auth failure exits 4) sitting in `EXIT.review`'s bit.
  3. `testPlan` runs `npm test -- --project repo` when the diff touches
     `scripts/` (which already covers `scripts/test/`, named separately in the
     Build section but redundant with it). This branch is the reproduction:
     its own first gate ran `ok npm run check` alone and never its own 25
     tests.
  4. `checkTitle` fails outright, naming "no conventional subject found; pass
     --title", when `type === undefined` — instead of silently reading the
     absent type as "hidden" and passing. **This catches a `Merge ` or
     `Revert "` subject and no other `BYPASS` form; see gate 2's med finding
     and round 3's Log entry below for the rest.**
  5. Check 1 now runs through `runBuildCommand`, a dedicated runner that
     captures stdout and stderr together and prints the last 40 lines on
     failure, decoupled from `runCommand` (imported from `next-id.mjs`, still
     used for git/gh plumbing elsewhere) whose error message is `next-id.mjs`'s
     own and was leaking into a build failure with two sentences about a
     partial id sweep and nothing about what broke.
  6. `checkCitations` now defaults its grandfather list to `grandfatheredFor(repo)`,
     which reads the _target_ repository's own `scripts/citations-gate.mjs`
     (via `citations-gate.mjs`'s own `parseGrandfathered`), not the constant
     baked into this script's own checkout — so a `--repo <fixture>` run no
     longer reports this checkout's debt as `STALE` against a corpus that
     never held it.

  Gates: `npx vitest run scripts/test/preflight.test.ts` — 38 passed (13 new,
  each added for one of the six items above); `npm run check` exit 0;
  `npm test -- --project repo` — 384 passed. `npm test` (full suite) not
  re-run this round — no shared config outside `scripts/test/` moved beyond
  what round 1 already ran it for. Live sanity check, not a gate in itself:
  `node scripts/preflight.mjs --base origin/orchestrate-skill-sweep` on this
  branch now runs `npm test -- --project repo` under check 1 (confirming fix
  3 against the reproduction that found it) and still names the missing
  `## Review` section this ticket does not yet carry.

- 2026-09-20 — Round 3, on the orchestrator's authority, after the reviewer's
  gate 2 (CONCERNS: 1 med, 3 low; the other five round-2 fixes verified closed
  against their own reproductions). The med was a verdict, not a decision, so
  the orchestrator did not escalate it as one: round 2's Log said the title
  fix covered "a merge, revert, fixup or squash" subject, and it covered only
  the first two — reproduced and confirmed before applying anything, matching
  gate 2's own measurement exactly (`--title "fixup! feat(downloader): …"`
  exited 0, printing `ok "fixup" is hidden in release-please-config.json`).

  1. (the med) `checkTitle`'s guard now requires the extracted word to be a
     member of `commit-message.mjs`'s own exported `TYPES`, not merely
     present. `Merge `/`Revert "` still fail via `type === undefined`;
     `fixup!`/`squash!`/`amend!` now fail because `"fixup"`, `"squash"` and
     `"amend"` are not real types, closing all five `BYPASS` forms with one
     extra check rather than a second regex. Nothing outside
     `scripts/preflight.mjs` was touched to get it — `TYPES` was already
     exported, so this cost one import, not an edit to `commit-message.mjs`.
  2. (low) The two remaining leaks of `next-id.mjs`'s id-sweep wording — on
     stdout through `guarded()` when `gh` fails inside check 5, and on stderr
     when `--base` does not resolve — are gone because the plumbing runner
     that produced them is gone: `runCommand` is no longer imported from
     `next-id.mjs` at all. A private `runGit` replaces it everywhere in this
     file (git/gh calls only; `runBuildCommand` already covered check 1),
     carrying `runCommand`'s two real guarantees — a failed command's stdout
     is never read, `PATH`-absent exits 127 — without its prose.
  3. (low) `defaultListOpenHeads` now validates every `gh pr list` entry's
     `headRefOid` and fails naming the PR and the missing field, rather than
     letting a later `.slice(0, 7)` on `undefined` raise an unrelated
     `TypeError`. The fourth low (`SCOPE` and the grandfather list having
     different provenance under `--repo`) was recorded as harmless in-tree and
     left alone — not a decision this round revisited.

  Gates: `npx vitest run scripts/test/preflight.test.ts` — 45 passed (was 38:
  one single-subject bypass test replaced by five parametrized over
  `commit-message.mjs`'s own `BYPASS` forms, plus three new — two for item 2's
  stdout/stderr wording, one for item 3's actionable message); `npm run check`
  exit 0; `npm test -- --project repo` — 391 passed.
