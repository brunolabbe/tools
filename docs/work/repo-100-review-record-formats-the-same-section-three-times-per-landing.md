---
id: repo-100
tool: repo
title: review-record formats the same section text with oxfmt three times per landing, and four tests repeat a land()
kind: chore
status: done
milestone: null
depends_on: [repo-89]
difficulty: standard
---

# repo-100 — review-record formats the same section three times per landing

## Why

This came out of the 2026-10-12 suite-speed audit (see
[repo-99](./repo-99-ci-runs-vitest-on-three-workers-for-a-wait-bound-suite.md)).
`scripts/test/review-record.test.ts` takes 40 s on CI and 48 s locally, and
`oxfmt` spawns dominate it. The audit measured one `oxfmt` spawn at about
330 ms, against about 2 ms for `git` and 20 ms for a bare `node`.

- `formatMarkdown` (`scripts/review-record.mjs:712` at 029641b4) is called on
  the section text by `spliceSection`'s comparison (`:524`) and by
  `verifySection`'s (`:862`).
- `land()` (`:1234` at 029641b4) splices each section in a scratch clone, then splices it
  for real, then verifies it. So `formatMarkdown(sectionText)` runs about three
  times on identical text, and a section costs about five spawns.

It depends on [repo-89](./repo-89-the-review-record-land-cli-test-times-out-on-the-windows-leg.md),
which is done; it closed on readings of the `--land` CLI test's duration on
`windows-latest`, and changing the spawn count under that test before those
readings were taken would have spoiled them.

## Build

1. **Memoize `formatMarkdown`** by its input text, within one process. Its
   output depends only on the text and the pinned `oxfmt` config, so a cache
   keyed by text is exact. Do not cache across processes. Check that no caller
   relies on a fresh spawn's side effects.
2. **Merge the tests that repeat a `land()`.** The audit read these, but they
   are not measured:
   - "status in the FIRST commit" (2.9 s) repeats the `land()` call of "splices
     two gates…": move its assertion there.
   - "passes --title through" (1.5 s): into the same test, with `runPreflight`
     as a `vi.fn`.
   - "lands every commit… names preflight" (1.5 s): into the first loop
     iteration of "after a successful push… no reset command" (3.0 s), which
     asserts the same no-reset state and pushed state.
   - "verify step once per section" with "keeps the reset command on a verify
     failure": the same single-gate scenario with a throwing verify.

   Each merge keeps every assertion, and each surviving test says in a comment
   which test it absorbed.

3. Leave alone anything repo-89 changed or measured, including the `--land` CLI
   case and its fake `gh`.

## Done when

1. A unit test shows that `formatMarkdown` spawns `oxfmt` once for repeated
   identical input.
2. The four merges are done with no assertion lost, and the Log maps each
   removed test to its absorbing test.
3. Local and CI durations for `review-record.test.ts`, before and after, are in
   the Log.

## Review

**Gate: PASS** — 2026-10-18 · `029641b4..d06865b1` · Opus 5.5, depth standard

| Done when                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A unit test shows that `formatMarkdown` spawns `oxfmt` once for repeated identical input                  | `scripts/test/review-record.test.ts` › "formatMarkdown spawns oxfmt once for repeated identical input, and again for a different one (repo-100)" ✓ — `oxfmtSpawns()` is `before + 1` after three calls on one text and `before + 2` after a different one, and the first result differs from its input. Positive control: the cache lookup deleted, the test fails `expected 3 to be 1`. Also measured outside the suite: a real two-gate `land()` against a fixture repo and a local bare remote spawns `oxfmt` on the section 6 times with the base's `review-record.mjs` and 2 times with this branch's (plus 4 whole-ticket spawns on both).                                                                                                                                                                                                             |
| The four merges are done with no assertion lost, and the Log maps each removed test to its absorbing test | **proven** — every assertion of the four removed tests is present in its absorbing test (inventory in the full report), and each absorbed behaviour fails its absorbing test under a mutation of `land()`: status set at the last plan (`expected … to match /^status: done$/m`, "splices two gates…"), `--title` passed as `""` (`toEqual` red, same test), the verify loop never calling `verify` (`expected +0 to be 1`, "keeps the reset command on a verify failure…"), and for the preflight-failure merge, which the build did not mutate, four mutations all red on "after a successful push … preflight failure (repo-94)": a rollback after preflight fails, the preflight output dropped from the detail, `ok: true` on a failed preflight, and the `verify` step missing from the step list. The Log's table maps all four, verified by reading. |
| Local and CI durations for `review-record.test.ts`, before and after, are in the Log                      | **verified** — the Log carries three local before/after pairs and one CI reading a side per leg. The CI figures match the runs' `Run npm test` lines exactly: 41,634 ms / 67 tests and 121,328 ms (run 39086562034, at 029641b4) against 21,171 ms / 64 and 121,660 ms (run 39089135953, at e7658afd).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

- **low** · no `Done when` line depends on it · `formatMarkdown`'s new docblock in `scripts/review-record.mjs` says the formatter "runs in a fresh directory under the OS temp dir, so no repository config reaches it", which makes the cache exact. `oxfmt` 0.62.0 reads an `.oxfmtrc.json` from any ancestor of that directory. With `TMPDIR` under a directory whose config sets `printWidth: 10, proseWrap: "always"`, the base's `formatMarkdown` wraps a bullet over ten lines. With `ignorePatterns: ["**/*.md"]` there, `oxfmt` exits 2 ("Expected at least one target file"). The cache's one stale answer comes from the same cause. One process formats a text, `TMPDIR` moves under such a config, and the same text comes back from the cache unwrapped where the base re-spawns and returns it wrapped. There is no live call site: `land()` never changes `TMPDIR`, the CLI runs one process per landing, and the one test that changes `TMPDIR` points it at a directory with no config. The claim is false in the safe direction: a config that reaches the format only makes a landing refuse or throw, and it can never let a changed record through. Direction, unmeasured: qualify the sentence, or pin the config inside the fresh directory.
- **low** · no `Done when` line depends on it · the Log's "Ubuntu halves" rests on one after-reading. The pull request's later run on d06865b1 reads 31,289 ms (run 39089694781, `test (ubuntu-latest)`), and that head's diff from e7658afd is this ticket file only. Against the single 41,634 ms before-reading, the two after-readings give ratios of 0.51 and 0.75. The figures the Log cites are right. Only the conclusion overstates the saving, and nothing chooses from it.
- **low** · `nfr:maintainability` · no test now reaches `land()`'s `failure.stderr || failure.message` fallback in the verify step. The repo-94 test that absorbed F2/M4 now throws with a `stderr`, and it was the only verify stub without one. Mutating the line to `failure.stderr` passes 64 of 64. The base test ran that path but asserted nothing of the message, so no assertion was lost.
- **dropped** · the file-wide `vi.mock("node:child_process")` pass-through spy reported as changing what other tests exercise. It does not change them: vitest mocks per file, the spy calls the real `spawnSync`, and a shuffled run (seed 100) passes 64 of 64. The Windows leg passes 64 tests on this head, and `packages/core/test/spawn-safety.test.ts` passes 18 of 18.
- **dropped** · a cached answer reported as wrong across two tickets in one process. It is not: two `land()` calls with identical sections both succeed at base and at head, and the second makes 0 section spawns at head.
- **dropped** · a cached answer reported as wrong under a different `.oxfmtrc.json` in the ticket's repo. It is not: base and head give the same `splice` refusal, because `formatMarkdown` never read the ticket repo's config before or after this change.
- **dropped** · a formatter failure reported as cached. It is not: an injected failure throws, the next call spawns again and returns, and a third call is a cache hit (spawns 1, 2, 2).
- **dropped** · a different working directory reported as reaching the cache. It cannot: the spawn's `cwd` is its own temp directory, and the process's directory never reaches it.
- **dropped** · the repo-94 loop's first case reported as losing coverage. It changed from `done` with `FAIL merge-tree: …` to `in-flight` with the absorbed output. Nothing asserted the old text, neither output matches `preflightVerdict`'s pattern so the same branch runs, and the repo-104 test covers a halted merge-tree failure.
- **findings** · the hunt returned 9; 3 carried, 6 dropped.
- NFR: security n/a (no new spawn shape; `shell: false` kept) · performance ✓ (section spawns per two-gate landing 6 → 2; the fixture `land()` took 3.9 s at base and 2.4 s at head, one run each under load) · reliability — the first low above · maintainability — the third low above.
- CI on d06865b1: every check on #540 passes, `test (windows-latest, informational)` included.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 7 s from
  the merges and about 8 to 10 s from memoizing (inferred).
- 2026-10-18 — Built on `repo-100-review-record-formats-once` from 029641b4.
  The brief's coordinates were stale: at 029641b4 `formatMarkdown` is at
  `scripts/review-record.mjs:712`, its two callers at `:524` and `:862`, and
  `land()` at `:1234`, not `:1085`. The Why now says repo-89 is done (it is
  `status: done`), and names the coordinates with their sha.

  **Build 1.** `formatMarkdown` keeps a module-level `Map` keyed by the input
  text and spawns through a private `runOxfmtOnText` only on a miss; a throw is
  never stored. No caller reads anything from the spawn but its returned string
  (`spliceSection` and `verifySection` pass it to `compareRecord`), so a cached
  string is the same value. Measured in the same test, `land()` of two gates with
  `spawnSync` wrapped as a pass-through spy, counting calls on
  `review-record-fmt-*/section.md`: `OXFMT_SPAWNS=6` with the 029641b4 source,
  `OXFMT_SPAWNS=2` with this branch's — three per section down to one. The ticket
  said "about five spawns" a section; the other two are the whole-ticket
  `oxfmt` each of the two splices runs on the ticket itself
  (`scripts/review-record.mjs:492` at 029641b4), which formats a file in place
  under the repository's own config rather than a bare text, so the cache here
  does not cover it; this change does not touch it.

  **Done when 1.** `scripts/test/review-record.test.ts`, "formatMarkdown spawns
  oxfmt once for repeated identical input, and again for a different one
  (repo-100)": one spawn for three calls on one text, a second for a different
  text, and the first result differs from its input so it is the formatter's
  output and not an echo. Red against the cache bypassed (`&& false` in the
  hit test, run from a commit and restored from it): `expected 3 to be 1`.

  **Done when 2.** Four tests removed and the one of item 1 added: 67 − 4 + 1
  = 64 (`npx vitest run scripts/test/review-record.test.ts`, 64 of 64 passed).
  The map from each removed test to its absorbing test, with every assertion
  kept:

  | Removed                                                                                                       | Absorbed by                                                                                                                               | What moved                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | "land() sets status in the FIRST commit, not only at HEAD (F2/M2)"                                            | "land() splices two gates, sets status, pushes and verifies…"                                                                             | `status: ready` at `base`, and `status: done` at the first commit `land()` made. That test has a third commit (the branch's own) ahead of them, so the first land commit is `shas[1]`, and the length asserted is 3 where the removed test asserted 2.                                                                                                                                                                                                               |
  | "land() passes --title through to runPreflight (F2/M5)"                                                       | the same test                                                                                                                             | `runPreflight` is a `vi.fn`; called once, with `[base, title]` after the repo-root argument.                                                                                                                                                                                                                                                                                                                                                                         |
  | 'land() lands every commit and the push, then names "preflight" when it fails, without rolling anything back' | "land() after a successful push says the landing is pushed and prints no reset command on a preflight failure (repo-94)", first loop case | `result.ok` false, the six step names, the detail containing the preflight output, no `git reset --hard`, and the last commit's subject matching `record gate 1`. The cases are now `{status, preflight}` pairs: the first is `in-flight` with the removed test's output, as that test ran; the second is `done` and throws, as before. The first case's output used to be `FAIL merge-tree: conflicts with PR #371`; nothing asserted that text, so it is not kept. |
  | "land() actually calls its verify step once per section, and stops on its failure (F2/M4)"                    | "land() keeps the reset command on a verify failure after the push, and says undoing it needs the owner's force-push (repo-94)"           | A counting `verify` that throws an error carrying a `stderr`; `calls` is 1, `result.ok` false, the last step is `verify`, its detail contains the `stderr`. The pushed-state assertion was already there.                                                                                                                                                                                                                                                            |

  The "repo-80 gate 1, F2" comment above `setStatus`'s CRLF test, which said four
  tests below it were each red on one mutation, now says three of them moved and
  where.

  Each moved assertion was checked to bite, by mutating `review-record.mjs` from
  a commit and restoring it from that commit: status written at the last plan
  rather than the first (`index === plans.length - 1`) fails the new
  `status: done` assertion at `shas[1]`; the title passed as `""` fails the
  `[base, title]` assertion; the verify loop iterating `[]` fails "expected +0
  to be 1" at the counting `verify`. **Not mutated:** the third merge's
  assertions (the preflight-failure case). They are the removed test's own lines,
  moved without change, and the test passes with them; no mutation was run to
  show each still fails.

  **Done when 3, local.** The machine was shared with five other builders, so
  each figure is Vitest's own `Duration` for the one spec, taken in alternating
  pairs from two trees (the base in a detached worktree at 029641b4, this branch
  at 35e28578 with only this ticket file modified), with the load average from
  `uptime` at the start and end of each run:

  | Pair | Tree     | Duration | Tests | Load, start to end |
  | ---- | -------- | -------- | ----- | ------------------ |
  | 1    | 029641b4 | 73.91 s  | 67    | 6.92 to 10.36      |
  | 1    | 35e28578 | 33.31 s  | 64    | 10.36 to 7.92      |
  | 2    | 029641b4 | 79.53 s  | 67    | 7.92 to 12.94      |
  | 2    | 35e28578 | 60.67 s  | 64    | 12.94 to 18.50     |
  | 3    | 029641b4 | 97.72 s  | 67    | 18.50 to 21.75     |
  | 3    | 35e28578 | 52.60 s  | 64    | 21.75 to 15.75     |

  After over before in the same pair: 0.45, 0.76, 0.54. The absolute figures are
  the sandbox's: the ticket's 48 s was a quiet machine and these ran at load
  7 to 22. The ratio is the usable reading, and it is noisy; the CI reading is
  below. An earlier single run at 029641b4 read 92.00 s at load 7.73 to 15.54.

  **Done when 3, CI.** The spec's own line in the `Run npm test` log
  (`gh run view <run> --job <id> --log | grep review-record.test.ts`), one run
  each side, so a single reading a side:

  | Leg                                    | Before: run 39086562034 (dispatched, 029641b4) | After: run 39089135953 (PR #540, e7658afd) |
  | -------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
  | `test (ubuntu-latest)`                 | 41,634 ms, 67 tests                            | 21,171 ms, 64 tests                        |
  | `test (windows-latest, informational)` | 121,328 ms, 67 tests                           | 121,660 ms, 64 tests                       |

  A second ubuntu reading, from the pull request's later run 39089694781 at
  d06865b1 (a change to this ticket file only, from e7658afd), is 31,289 ms, 64
  tests. Against the one before-reading of 41,634 ms the two after-readings are
  ratios of 0.51 and 0.75, so ubuntu falls by a quarter to a half on two
  readings; it does not reliably halve. **Windows does not move**: 121.3 s
  before, then 121.7 s and 124.3 s after (run 39089694781: 124,256 ms). Cutting the section's `oxfmt` spawns and four `land()` runs saved
  nothing there, so that leg's time is somewhere this change does not reach.
  repo-89's own readings were of the `--land` CLI case, which this ticket was told
  to leave alone and did; this is a reading of the whole file on that leg, not
  an investigation of it, and what dominates it is not measured here.

  **Folded in, and not.** Folded in: the Why's stale repo-89 sentence and line
  numbers, and the stale "four links" comment above `setStatus`'s CRLF test.
  Not folded in: the whole-ticket `oxfmt` at `spliceSection`
  (`scripts/review-record.mjs:492` at 029641b4), a second spawn per splice that
  could in principle be avoided — it has no specification, since its input is a
  file in the repository's config, not a bare text, so it was not "already
  specified" and no ticket was filed (repo-106 stays unused).

- 2026-10-18 — Fixed at landing by owner choice: gate 1, L1 — "`formatMarkdown`'s
  new docblock in `scripts/review-record.mjs` says the formatter 'runs in a fresh
  directory under the OS temp dir, so no repository config reaches it', which
  makes the cache exact. `oxfmt` 0.62.0 reads an `.oxfmtrc.json` from any
  ancestor of that directory." The docblock now says an `.oxfmtrc.json` above the
  temp directory can reach the formatter, so the cache is exact only while that
  config does not change within a process; a comment-only change.
  `grep -c "no repository config reaches it" scripts/review-record.mjs` → 0
  (1 at d06865b1).
- 2026-10-18 — Fixed at landing by owner choice: gate 1, L2 — "the Log's
  'Ubuntu halves' rests on one after-reading. The pull request's later run on
  d06865b1 reads 31,289 ms (run 39089694781, `test (ubuntu-latest)`) … Against
  the single 41,634 ms before-reading, the two after-readings give ratios of 0.51
  and 0.75." Checked first: `gh run view 39089694781 --log`, `test
(ubuntu-latest)` / `Run npm test`: `✓ repo scripts/test/review-record.test.ts
(64 tests) 31289ms`; the Windows leg of that run reads `124256ms`. The Done-when
  3 CI paragraph now carries the second reading and both ratios, and says
  "falls by a quarter to a half on two readings; it does not reliably halve".
  `grep -c "Ubuntu halves, as the local pairs" <ticket>` → 0 (1 at d06865b1).
