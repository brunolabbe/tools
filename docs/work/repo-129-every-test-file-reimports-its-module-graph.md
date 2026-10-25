---
id: repo-129
tool: repo
title: Every test file re-imports its whole module graph, 145 s of CI's 815 s
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-129 — Every test file re-imports its whole module graph

## Why

On CI run `40210503276` (ubuntu, 4 workers), vitest reports **import 145 s**
next to 815 s of tests, and 179 s on Windows. Every file is isolated, so each
one re-evaluates Fastify, zod, every route and each workspace's `dist/`.
Locally, ledger spends 64 s importing against 132 s of tests, and planner 48 s
against 37 s.

The audit measured one experiment: `vitest run --project planner` at 4 workers,
back to back, took **21.4 s isolated and 9.5 s with `--no-isolate`**. Twelve
tests failed without isolation, all in `tools/planner/api/test/lodging-run.test.ts`,
which mocks `../src/intakes/state.ts` with `vi.mock` (`:63`). Across the repo, 35
test files use `vi.mock` or `vi.stub*`: downloader 8, planner 9, ledger 18.

## Decision — answered 2026-10-25 by the owner

Options put: (a) trial `isolate: false` one project at a time and keep it only
where it holds; (b) not now. **Chosen: (a).**

## Build

1. For each project (planner, ledger, core, then downloader), split it into two
   vitest projects with the same name prefix: one `isolate: false` for files
   with no `vi.mock`, `vi.doMock`, `vi.stubGlobal`, `vi.stubEnv` or
   `vi.resetModules`, and one isolated for the rest. Select them by an explicit
   file list or a marker, never by guessing from file names. `--project
   <tool>` must still run both halves; check how vitest 4 matches project names
   and use a glob such as `<tool>*` in the docs if needed.
2. A project's non-isolated half is kept only if it passes **five consecutive
   full runs** of that project locally, with different `--sequence.seed` values
   (`--sequence.shuffle`), and one CI run. State leaking between files shows up
   as order-dependent failures. Candidates found by reading: the ledger rate
   limiter, ledger's per-file env clearing in
   `tools/ledger/api/test/helpers/no-model-environment.ts`, and module-level
   recorders in downloader's browser tests.
3. Downloader's browser files share Chromium through `BrowserPool`, and some
   patch prototypes (`provoke.test.ts` patches `Frame.click`). Leave those
   files in the isolated half.
4. Record per project, in the Log: import and wall time before and after, the
   files that had to stay isolated, and why.
5. While measuring, also try planner's alternative: alias `@planner/*` to `src`
   or externalise `tools/planner/*/dist` (`server.deps.external`). Record the
   number. Adopt it only if it beats `isolate: false` for planner, and say which
   was kept.
6. Update the comment block in `vitest.config.ts` and
   `.claude/rules/testing.md` to explain the split.

## Done when

1. Each project ends either split into an isolated and a non-isolated half, with
   five shuffled local passes and one CI pass recorded in the Log, or left
   unchanged with the failing files and the reason recorded.
2. The CI log of this pull request shows a lower summed `import` time than run
   `40210503276`'s 145 s, and the Log states the difference.
3. `npm test -- --project <tool>` still runs all of that tool's files. Prove it
   by comparing the file count before and after.

## Log

- 2026-10-25: Filed from the test-suite audit; see
  [repo-127](./repo-127-pull-requests-run-every-project-whatever-they-touch.md).
  Seam note: [pl-64](../../tools/planner/docs/work/pl-64-planner-tests-load-the-contract-twice-and-scan-archived-runs.md)
  also edits `vitest.config.ts` (excluding `live-records.test.ts`). Also,
  lg-69 deletes `lg-65-search.test.ts`, the only `vi.mock` in ledger's
  `api` and `books`, which changes which ledger files can go in the
  non-isolated half.
- 2026-10-25, from repo-128's gate 1 (dropped there as pre-existing, the owner chose to
  note it here): `scripts/test/preflight.test.ts` › "no preflight-ghshim directory this
  file made is left behind (repo-110)" fails under
  `npx vitest run scripts/test/preflight.test.ts --sequence.shuffle --sequence.seed=<n>`
  with seeds 1 and 2, on main's own copy at 7f8d7f48 as well as on repo-128's branch.
  Re-run on `origin/main` at 7134af89 with seed 1: `Tests  1 failed | 108 passed (109)`,
  `AssertionError: expected 0 to be greater than or equal to 3`
  (`scripts/test/preflight.test.ts:2521`). Done when 1's shuffled runs will hit it: fix it
  or exclude it, with a reason, before taking those readings.
