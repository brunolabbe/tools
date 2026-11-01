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
