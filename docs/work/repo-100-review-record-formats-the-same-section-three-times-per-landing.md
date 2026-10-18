---
id: repo-100
tool: repo
title: review-record formats the same section text with oxfmt three times per landing, and four tests repeat a land()
kind: chore
status: ready
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
