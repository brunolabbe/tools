---
id: repo-136
tool: repo
title: review-record --land prints FAIL with no reason when the merge-tree probe halts preflight
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-136 — `--land` prints `FAIL` with no reason when the merge-tree probe halts preflight

## Why

`scripts/review-record.mjs --land` runs preflight after its push and reports
each stage as `ok  <reason>` or `FAIL  <reason>`. When preflight halts on its
merge-tree probe, the `== preflight ==` stage prints `FAIL` followed by nothing,
and the reason — which sibling conflicts, on which paths — appears only inside
the nested `== mergeTree ==` block below it. A lander reading the stage line
sees a failure with no cause, and the orchestrator reading the lander's quoted
output the same. lg-77's lander hit it on 2026-10-31; the 2026-11-01 review of
the orchestration log filed it.

## Reproduction

lg-77's landing on 2026-10-31, `tools-54 second` batch, output kept in that
session's scratch directory (`lg-77/land/land.out`). The stage and the block
that follows it, verbatim:

```
== preflight ==
FAIL
== mergeTree ==
comparing HEAD against 7 other open pull request head(s)
ok    #687 lg-81-e2e-reads-unthrottled merges cleanly with HEAD
ok    #686 lg-77-rename-a-household merges cleanly with HEAD
FAIL  #685 lg-78-import-resolves-names conflicts on: tools/ledger/e2e/layout.spec.ts
FAIL  #684 lg-80-admin-name-wraps conflicts on: tools/ledger/e2e/layout.spec.ts

== halted ==
mergeTree failed, so check, ciCommands, review, title did not run: this run proved nothing
```

The `FAIL` line carries two trailing spaces and no text. Every other stage of
the same run (`setup`, `sections`, `splice`, `push`, `verify`) printed a reason
after its verdict.

The mechanism to confirm when building: `--land`'s preflight step runs
`scripts/preflight.mjs` as a child and reads its last line through
`preflightVerdict` (`scripts/review-record.mjs`); the stage line is printed
before the child's output is forwarded, with a reason that is empty when the
verdict names no failing check in the form the regexp expects, or when the stage
prints before the verdict is read.

## Build

1. In `scripts/review-record.mjs`, make the `== preflight ==` stage's `FAIL`
   line carry the verdict's reason — `preflight failed: mergeTree (exit 16); not
   run: check, ciCommands, review, title` — whether the nested output is
   forwarded before or after it. If the stage line has to print before the
   child finishes, print the verdict line again after the block, as `FAIL
   <reason>`, so the reason is on a stage line.
2. A test in `scripts/test/review-record.test.ts` that drives `--land` with a
   stubbed preflight exiting 16 with a `preflight failed:` last line, and
   asserts the stage output contains `FAIL` followed by a non-empty reason on
   the same line.

## Done when

1. A `--land` whose preflight halts on the merge-tree probe prints a `FAIL`
   stage line whose text names the failing check and the checks not run.
2. The test in Build 2 fails on `main` at `8ad4e91d` and passes on the branch.
3. `npm test -- --project repo` passes.

## Log

- 2026-11-01 — Filed by the review of the orchestration log (tools-54 second's
  item 4). The reproduction is the lander's output as kept; not re-run, since
  the sibling conflict it needs is gone.
- 2026-11-08 — Built on `repo-136-land-fail-reason` (base `4a9b8af4`).
  Mechanism, checked: `landMain` prints a stage as `FAIL  ${detail}`, and the
  preflight detail was preflight's whole output. `preflight.mjs` opens its
  output with a blank line (`--only title --title "bad title"` writes `\n== title
  ==` first, `od -c` confirmed), so the FAIL line ended at two spaces. The
  brief's account, that the stage line prints "before the child's output is
  forwarded", is not what happens: `runPreflightDefault` captures the child with
  `spawnSync` and the stage is printed after it returns. The fix is
  `preflightStageDetail` in `scripts/review-record.mjs`: the detail leads with
  the verdict line (`preflight failed: …; not run: …`), or the output's first
  non-empty line when there is no verdict, then the output unchanged.
  Red before the fix, at base `4a9b8af4`, with the test commit alone
  (`83b8343b`): `npx vitest run scripts/test/review-record.test.ts` →
  `× land() puts preflight's reason on the stage's own FAIL line … (repo-136)`
  `AssertionError: expected 'FAIL  ' to be 'FAIL  preflight failed: mergeTree (ex…'`
  and `× land() gives a preflight failure with no verdict line … (repo-136)`,
  `Tests  2 failed | 62 passed (64)`. Green after the fix (`0783137e`):
  `Tests  64 passed (64)`. `scripts/review-record.mjs` and
  `scripts/test/review-record.test.ts` are byte-identical at `8ad4e91d` and
  `4a9b8af4`, so the red stands for the sha Done when names.
  `npm run check` exit 0; `npm test -- --project repo`: `Test Files 15 passed
  (15)`, `Tests 631 passed | 1 skipped (632)`.
  Build 2 as written does not hold: `--land` runs the real `preflight.mjs`
  through `runPreflightDefault`, which resolves the CLI next to the script with
  no injection point, so the CLI cannot be driven with a stub. The new tests
  drive `land()` with a stubbed `runPreflight` and assert the first line of the
  detail, which is the line `landMain` prints after `FAIL  `. A template change
  in `landMain` would not be caught by them. Done when 1 holds by the same
  assertion; Done when 3 by the run above.
- 2026-11-08 — The owner, via the orchestrator, answered the builder's open
  decision on Build 2. The brief asks for a test that drives `--land` with a
  stubbed preflight, but the CLI has no injection point and only `land()`
  accepts a `runPreflight` stub. The options were (a) accept tests that stub
  preflight at `land()` and assert the stage's FAIL line text, (b) add an
  env-var or flag injection seam to the CLI, (c) export a stage-line formatter
  that `landMain` uses and test it. The owner chose (a), the builder's
  recommendation.
- 2026-11-08 — Fixed at landing by owner choice: gate 1, the first low —
  "`landMain`'s own print (`FAIL  ${detail}`) is pinned by no test". In the
  real-CLI case in `scripts/test/review-record.test.ts` ("the --land CLI lands
  the commit and the push for real, then fails naming "preflight"…"),
  `/== preflight ==\nFAIL/` became `/== preflight ==\nFAIL  \S/`. `npx vitest
  run scripts/test/review-record.test.ts -t 'the --land CLI lands the commit'`
  → `Tests  1 passed | 63 skipped (64)` at this head, and `Tests  1 failed | 63
  skipped (64)` at line 1477 with `origin/main`'s `scripts/review-record.mjs`
  put back (then restored). The gate's second low (`preflightStageDetail`'s
  fallbacks untested) is not fixed.
