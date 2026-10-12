---
id: dl-117
tool: downloader
title: One 2,400-line browser test file runs serially and is the whole of CI's npm test wall clock
kind: chore
status: ready
milestone: null
depends_on: [dl-115]
difficulty: mechanical
---

# dl-117 — Split browser-resolver.test.ts so one file is not the whole run

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

vitest runs the tests in one file in sequence, and spreads files across workers.
`browser-resolver.test.ts` was 620 s of a 623 s `npm test` on CI. The 258 other
files finished in parallel long before it did. Once dl-111, dl-113, dl-114 and
dl-115 have removed what they can, about 140 to 200 s of serial probes will
remain (inferred). That is still the run's floor.

**The owner chose (2026-10-12)** to split the file. A split adds no workers: the
same pool simply stops idling while one worker runs a long file. The CI-only
worker count is [repo-99](../../../../docs/work/repo-99-ci-runs-vitest-on-three-workers-for-a-wait-bound-suite.md).
This ticket depends on dl-115 because every earlier ticket in this batch edits
the same file, and splitting it first would make each of them a conflict.

## Build

1. **Split along the existing top-level `describe` blocks** into four to six
   files in `resolvers/test/browser/`. Balance them by measured duration, not by
   line count. Name each file for what it covers (for example consent,
   departure guard, shadow root and frames, player box, empty floor).
2. **Move the shared setup into a helper** under `test/browser/helpers/`: the
   fixture server and the `BrowserPool({ maxConcurrent: 1 })` started in
   `beforeAll` and closed in `afterAll`, plus `options`, `probe`, `probeError`
   and `expectCode`. Each file still owns its own pool and server, so a failure
   in one file cannot orphan another file's Chromium.
3. **Move code, not tests.** No test is renamed, merged or changed here. The
   diff for each test body should be a pure move: check it with
   `git diff --color-moved`.
4. **Watch the timing-sensitive files** when they run beside each other: the
   dl-80 empty floor, dl-105's clock, dl-81's input. Run the whole downloader
   project three times locally and note any test whose duration moves by more
   than 20 %.

## Done when

1. The test count for the browser files is the same before and after (vitest's
   `Tests` line for `--project downloader`), and every moved test body is
   unchanged by `--color-moved`.
2. No browser test file takes more than about a quarter of the old file's
   post-trim duration.
3. `npm test -- --project downloader` passes three times in a row locally.
   CI's `npm test` duration, before and after, is in the Log.

## Log

- 2026-10-12 — Filed from the suite-speed audit. Rated mechanical: the split
  follows existing `describe` boundaries and moves code only.
