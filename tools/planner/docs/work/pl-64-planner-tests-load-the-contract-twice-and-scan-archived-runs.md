---
id: pl-64
tool: planner
title: Planner tests load the contract twice, scan 56 MB of archived runs on every push, and repeat pl-60's cases
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# pl-64 — Planner tests load the contract twice, scan archived runs and repeat cases

## Why

Planner is a small share of CI test time: 35 s summed on ubuntu and 48 s on
Windows (run `40210503276`). But **import costs more than the tests**: locally,
import is 48–61 s against 37–43 s of tests. The test-suite audit of 2026-10-25
found:

- `contract/test/fixtures.ts:23` imports `../src/index.ts`, while every package
  under test imports `@planner/contract`, which resolves to `dist/`. So the
  zod contract is evaluated twice in 18 files. One file's import breakdown
  showed `contract/src/index.ts` at 1.52 s and `contract/dist/index.js` at
  1.41 s.
- `api/test/live-records.test.ts:220` parses all 476 archived paid-run records
  (56 MB under `api/test/fixtures/live/`) on every run: 2.7 s ubuntu, 3.8 s
  Windows. These records are written once and never edited.
- `api/test/revisions.test.ts:650` makes 49 real HTTP restores to reach the
  revision ceiling (1.98 s on CI, 2.26 s measured locally).
- pl-60, pl-61 and pl-62 left overlapping cases across `food-pass`,
  `lodging-pass`, `grounding-food`, `grounding-valhalla` and `lodging-run`.

## Decision — answered 2026-10-25 by the owner

- **The live-records scan is path-filtered.** Options put:
  - path-filter it;
  - make it cheaper but keep it on every run (~1 s saved);
  - leave it.

  **Chosen: path-filter.**

- **Clear duplicates may be deleted.**

## Build

1. `contract/test/fixtures.ts:23`: import from `@planner/contract`, the way the
   tests that use it do, so one copy loads. If a fixture needs something the
   package does not export, say so in the Log rather than re-adding the src
   import. Aliasing `@planner/*` to `src` is repo-129's measurement and not part
   of this ticket.
2. Live records:
   - Exclude `api/test/live-records.test.ts` from the `planner` project's unit
     run.
   - Run it in `.github/workflows/planner.yml` in a job path-filtered on
     `tools/planner/api/test/fixtures/live/**` and on the test file itself.
   - Keep it runnable locally with `npx vitest run <file>`, and say how in
     `tools/planner/CLAUDE.md`.
   - **The scan must still run when a record lands.** That is its whole point.
3. `api/test/revisions.test.ts:650`: seed 49 revisions with `insertRevision(db,
   revision)` (`api/src/db/plans.ts:197`), then make the two 409 calls over
   HTTP. Restore over HTTP stays covered at `:1381`. ~1.8 s.
4. `api/test/lodging-run.test.ts:174` and `:240`: two `test.each(TRIP_SHAPES)`
   blocks draft all six shapes twice. `CountingGrounding` (`:74`) wraps
   `FixtureGroundingProvider`, so make one run per shape and assert days,
   coverage and calls together.
5. Delete `api/test/discovery-run.test.ts`, after moving its one unique assertion
   (`view.unchecked` holds a `coverage` kind) into `lodging-run.test.ts:174`.
6. Duplicates, all going through `keep()` in `api/src/runs/lodging.ts:248` or
   the same `nearbyPoint` adapter. Merge `food-pass.test.ts` into
   `lodging-pass.test.ts` while doing this, if it reads cleanly:
   - `food-pass.test.ts:178` subsumes `lodging-pass.test.ts:215` and `:378`.
   - `food-pass.test.ts:156` subsumes `food-pass.test.ts:129` and
     `lodging-pass.test.ts:178`. Keep one assertion each on the radius and
     kinds constants.
   - `grounding-food.test.ts:296` repeats `grounding-valhalla.test.ts:2171`.
   - `grounding-food.test.ts:211,230` repeat `grounding-valhalla.test.ts:2145`.
   - `grounding-food.test.ts:203` is the sum of the rows at `:183`.
7. `api/test/revisions.test.ts:1048, 1085, 1123`: make them one
   `test.each(["food", "lodging", "activities"])` with the full assertions, so
   each name still guards `readsFinds` membership (`revise.ts:582`).
8. Delete the unused `isTerminal` in `api/test/helpers/runs.ts:121`.

## Done when

1. `npm test -- --project planner` passes and no longer runs
   `live-records.test.ts`.
2. A pull request that adds a file under `api/test/fixtures/live/` runs the
   live-records scan in CI. Show it with a probe commit on this branch, read
   from the pull request's checks.
3. `@planner/contract` is evaluated once per test file. Show it with an import
   breakdown of one of the 18 files, recorded in the Log.
4. Each deleted or merged case is named in the Log, with the case that still
   covers its assertion.

## Log

- 2026-10-25: Filed from the test-suite audit; see
  [repo-127](../../../../docs/work/repo-127-pull-requests-run-every-project-whatever-they-touch.md).
  Kept on purpose: `live-gate.test.ts:349`'s subprocess spawn, the only proof
  that the price refusal comes before the provider is built. Also kept:
  `itinerary/test/first-draft-baseline.test.ts` next to `compose.test.ts:119`,
  since the properties say why. Measured and rejected: `defaultHidden: true` for
  `*ByRole` in web tests (−6 %). Seam note: step 2 edits `vitest.config.ts`,
  which repo-129 also edits.
