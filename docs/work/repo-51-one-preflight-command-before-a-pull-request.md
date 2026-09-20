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

## Review

### Gate 1 — 2026-09-20 · `f9d981f...6a42845`

**Gate: CONCERNS** · defect hunt at medium, run by the reviewer in its own context (Opus 5 gating a Sonnet 5 build)

Every Done when clause the builder could reach was proven, each planted failure re-run through the real CLI rather than the exported functions; `SKILL.md` step 9 and `builder.md` were out of the builder's scope by dispatch and recorded **unproven**, not FAIL, on the dispatcher's explicit ruling. Live run on the branch exited 4, naming this ticket's own missing record.

**This subsection carries no `file:line` coordinates on purpose.** Round 2 rewrote every line these findings named, so a citation here would resolve onto the repair rather than the defect. Gate 2's coordinates below resolve at `874a16d`.

- **med** · check 5 reported a clean merge whenever `origin/<head>` was stale — the normal state of a clone that has not fetched since a peer pushed. Reproduced by pointing a fixture's `refs/remotes/origin/b` at `main`: `FAIL … conflicts on: docs/work/x-1.md` became `ok … merges cleanly with HEAD`, exit 18 → 2.
- **med** · a check that threw aborted the whole run — nothing reached stdout, including verdicts already computed — and the failing child's raw status became the exit code, inside the bitmask's own namespace. Measured: unauthenticated `gh` → 4 (= `EXIT.review`); `gh` with no GitHub remote, and a head absent from the clone → 1 (= `EXIT.check`); a bad `--base` → 128, where the `EXIT` docblock claimed `setup`.
- **med** · check 1 ran no test suite for a branch touching only `scripts/`. The branch under review was that branch: its whole check block was `ok npm run check`, so preflight never ran repo-51's own tests and would have exited 0 on a branch breaking `scripts/test/next-id.test.ts`.
- **med** · check 4 passed any subject `commit-message.mjs` bypasses, printing `ok "undefined" is hidden in release-please-config.json`.
- **med** · a check 1 failure printed `next-id.mjs`'s id-sweep wording and dropped the real diagnostic, `runCommand` keeping only stderr where vitest and oxlint report on stdout.
- **low** · `git rev-parse --abbrev-ref HEAD` returns the literal `HEAD` in a detached worktree, so check 5 never excluded the branch's own pull request there.
- **low** · the grandfather list came from the script's own checkout while the corpus scanned was `--repo`, printing seven foreign `STALE` lines in every fixture run.
- **findings** · 7 returned, 7 carried, 0 dropped.
- **open decisions** · two, both escalated to the orchestrator rather than settled here — how check 5 should reach a head it has not fetched, and how a thrown error should reach the exit code. Both were answered there and are implemented in round 2.
- NFR: security n/a · performance — check 1 dominates and runs first · reliability — the two meds above · maintainability ✓, every check defers to the tool that already enforces it.
- Gates re-run rather than read off the Log: `npm run check` exit 0; the preflight suite 25 passed; `npm test -- --project repo` 371, and 346 with the new file moved aside; `citations-gate --against` exit 0, matching check 2's own report. Each of the five guards removed in turn, the named test red alone each time.

### Gate 2 — 2026-09-20 · `6a42845..874a16d` (branch `f9d981f...874a16d`)

**Gate: CONCERNS** · defect hunt at medium, run by the reviewer in its own context · base `origin/orchestrate-skill-sweep` resolved to `24af376` at this gate

Control before anything else: the unmutated suite **38 passed**. Live run at `874a16d` exits 4, check 1 now running `npm run check` **and** `npm test -- --project repo`. `npm test -- --project repo` 384, against 346 measured at the base in gate 1 — +38, the suite's own size.

| Done when                                                        | Proof                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — exits 0 on a clean branch                                    | `scripts/test/preflight.test.ts:720 "expect(bitmask).toBe(0)"` — **proven**                                                                                                                          |
| 1 — non-zero on a moved citation in a merged record              | `scripts/test/preflight.test.ts:274 "toBe(EXIT.citations)"`, `scripts/test/preflight.test.ts:275 "toMatch(/docs\/work\/a\.md/)"` — **proven**; real CLI over a planted fixture exits 2               |
| 1 — non-zero on a `done` ticket without `## Review`              | `scripts/test/preflight.test.ts:347 "toBe(EXIT.review)"`, `scripts/test/preflight.test.ts:348 "x-1\.md is marked done but has no"` — **proven**; real CLI on this branch exits 4, naming this ticket |
| 1 — non-zero on a `feat` title over markdown-only `tools/` paths | `scripts/test/preflight.test.ts:409 "toMatch(/markdown/)"` — **proven** for a conventional subject; see the med below for the subjects `validate` bypasses                                           |
| 1 — non-zero on a gate record two open heads both edit           | `scripts/test/preflight.test.ts:522 "toMatch(/gate record/)"` — **proven**; real CLI sets bit 16 and names the record, now by oid rather than by a ref that can be stale                             |
| 2 — a check 5 run that opens no conflict exits 0 and says so     | `scripts/test/preflight.test.ts:556 "no conflicts with any other open pull request head"` and `scripts/test/preflight.test.ts:570 "nothing was checked"` — **proven**, two distinct messages         |
| 3 — `SKILL.md` step 9 and `builder.md` name the script           | **unproven** — out of the builder's scope by dispatch; the page wiring is the orchestrator's and the Log says so. Recorded as unproven rather than FAIL on the dispatcher's ruling.                  |

Gate 1's seven findings, re-measured through the real CLI at this sha:

- **closed** · the stale remote-tracking ref. `scripts/test/preflight.test.ts:603 "update-ref"` plants the stale mirror; the CLI run that said `merges cleanly` in gate 1 now reports the conflict, exit 16, with `refs/remotes/origin/b` left exactly as stale as before. An oid the checkout lacks is now its own FAIL naming the fetch — `scripts/test/preflight.test.ts:657 "never-fetched.*does not have"` — where it used to abort the run at exit 1.
- **closed** · the exit-code collision. A bad `--base` raises 64 — `scripts/test/preflight.test.ts:745 "expect(caught?.exit).toBe(EXIT.setup)"` — and a check that throws costs only its own bit, with the other four still printing: `scripts/test/preflight.test.ts:778 "toMatch(/authentication failed/)"`. Measured end to end: unauthenticated `gh` moved from exit 4 with empty stdout to exit 16 with four intact verdicts above it.
- **closed** · check 1 on a `scripts/`-only branch, `scripts/test/preflight.test.ts:129 "testPlan runs the repo project on scripts/"`, confirmed live on the branch that was the reproduction.
- **closed** · check 1's borrowed failure text, `scripts/test/preflight.test.ts:189 "partial file list"` asserting the negative; a fixture whose check script fails on stdout now shows its real diagnostic.
- **closed** · the detached-HEAD self-exclusion, now by oid — `scripts/test/preflight.test.ts:639 "against 0 other open pull request head"`, re-measured in a genuinely detached fixture.
- **closed** · the grandfather list's provenance, `scripts/test/preflight.test.ts:295 "toEqual(new Map([["`; the seven foreign `STALE` lines are gone from every fixture run, and the planted cases now exit 2 and 8 alone.
- **med** · **the title-bypass repair covers half its class, and the Log says it covers all of it.** `scripts/preflight.mjs`'s guard, as it stood at `874a16d` (`if (type === undefined)`), keys on an absent type, but `/^(?<type>[a-z]+)/` extracts one from `BYPASS`'s lowercase members. Measured on the same fixture and diff that exits 8 with a proper `feat` title: `--title "fixup! feat(downloader): …"` exits **0**, printing `ok "fixup" is hidden in release-please-config.json`; `squash!` behaves identically; `amend!` takes the same path by the same regex (read, not run). Three of five bypasses still pass, the message asserts a word that is not in that config at all, and the round-2 Log names fixup and squash as covered. The new test at `scripts/test/preflight.test.ts:483 "no conventional subject found"` exercises only `Merge `, which is why the suite is green.
- **low** · `next-id.mjs`'s id-sweep wording now reaches **stdout** through `scripts/preflight.mjs:735 "name} threw"`, and stderr on a bad `--base`. Fix 5 decoupled check 1; `runCommand` remains the runner for git and gh, so the wording moved rather than went. The real cause prints directly above it.
- **low** · a `gh` payload without `headRefOid` throws at `scripts/preflight.mjs:672 "head.oid.slice(0, 7)"` and surfaces a raw TypeError. It fails closed at the right bit; the message is not actionable, and `gh` validating `--json` field names makes it unlikely.
- **low** · `scripts/preflight.mjs:346 "citationsGate(repo, SCOPE, grandfathered)"` now takes `SCOPE` from the reviewing checkout's module and the grandfather list from the target repo's file. Identical in-tree, divergent only under `--repo`.
- **findings** · defect hunt at medium over `6a42845..874a16d`; 4 returned, 4 carried, 0 dropped. Six of gate 1's seven are verified closed against their own reproductions; the seventh is the med above.
- NFR: security n/a — no user-influenced URL, no credential, nothing spawned through a shell. performance — check 1 now also runs the `repo` project, which is seconds and is the point. reliability ✓ — a `gh` outage costs one check's verdict instead of the whole run, measured. maintainability ✓ — `SELF` and `parseGrandfathered` reused from `citations-gate.mjs` rather than re-spelled, and no file outside `scripts/preflight.mjs`, its test and this ticket was touched.
- Invariants: no shell, no `console`, `node:` builtins, no `any`, suite registered in `scripts/test/tsconfig.json`, nothing under `.claude/` touched. Skipped as untouchable by this diff — contract packages, the `AppError` taxonomy, redaction, SSRF, progress reporting, Dockerfile closure, cross-tool imports.
- Gates re-run in this gate: control 38 passed; `npm run check` exit 0 and `npm test -- --project repo` 384, both through preflight's own check 1 and the second re-run standalone for its count; `citations-gate --against origin/orchestrate-skill-sweep` clean over 104 records, 7 grandfathered, matching check 2's own line. Seven mutations, each killing only the tests that name its guard, the tree restored clean between every one.

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

- 2026-09-20 — No gate 3. The owner's budget decision, relayed by the
  orchestrator after the reviewer had already been asked for one: round 3's
  three items above are verified by their own planted-failure tests (the
  `test.each` over all five `BYPASS` forms, the two wording-leak tests, the
  `headRefOid` test) and by the mechanical checks above, not by a second
  reviewer pass. The reviewer's gates 1 and 2 (`## Review`, above) still cover
  everything through round 2; round 3 was reviewed by test and by the
  orchestrator reading this Log, and that is the record of it.

  Landing the reviewer's section required one repair and one incidental fix,
  both mechanical: **the repair** — round 3 shifted lines in both
  `scripts/preflight.mjs` and its test, so every `file:line` coordinate the
  reviewer wrote against `874a16d` needed re-resolving against `93f6965`.
  Fourteen of gate 2's twenty-two citations had moved; all fourteen were
  repointed to where `node scripts/citations.mjs … --section Review
--require-anchors --require-distinct-anchors` found the same anchor text,
  and one (`scripts/preflight.mjs`'s `if (type === undefined)` guard, cited at
  its old line 432) is rewritten as prose naming `874a16d`, since round 3's fix
  changed that exact line and the literal string no longer occurs anywhere in
  the file. No verdict, row, severity or anchor's quoted fragment was changed
  — only coordinates, and one coordinate to prose. **The incidental fix** —
  after repointing, `--require-distinct-anchors` failed once more:
  `"partial file list"` had become indistinct, because round 3's own two new
  wording-leak tests each repeated it. Two redundant assertions (the
  `.not.toMatch(/partial file list/)` half of each, leaving each test's
  `.not.toMatch(/Refusing to answer/)` half, which tests the same leak) were
  removed from `scripts/test/preflight.test.ts` — a test-file edit, not a
  citation-text edit, and the coordinate constraint above never applied to it.
  `npx vitest run scripts/test/preflight.test.ts` still 45 passed after the
  removal (two assertions dropped, no test dropped). Citations check:
  `node scripts/citations.mjs docs/work/repo-51-one-preflight-command-before-a-pull-request.md
--section Review --require-anchors --require-distinct-anchors` — 21
  verified, 0 moved, 0 unanchored, exit 0.

  Disclosure: the `## Review` section committed in this round is the
  reviewer's own text, transcribed exactly for every verdict, row, severity,
  and quoted anchor fragment. Altered: fourteen `file:line` coordinates
  (repointed) and one (rewritten as prose naming `874a16d`, listed above).
  Nothing else — no wording, no finding, no proof cell.

  Gates re-run after both repairs: `npm run check` exit 0; `npx vitest run
--project repo` — 391 passed; `node scripts/citations-gate.mjs --against
origin/orchestrate-skill-sweep` — clean over 104 records, 7 grandfathered,
  0 raised, exit 0. Diff for this entry: `scripts/test/preflight.test.ts` (the
  two redundant assertions) and this ticket file only — `scripts/preflight.mjs`
  untouched.

- 2026-09-20 — Orchestrator, after the merge into `orchestrate-skill-sweep`: the "keeps only the last 40 lines" test failed once in six preflight runs on the merged branch, seeing "line 175" as the last of 200 lines. Cause is the child script's `process.exit(1)` racing its piped stdout, not the tool; both test children now set `process.exitCode = 1` and end on their own. Verified by re-running the test file; no gate, by the owner's budget decision.
