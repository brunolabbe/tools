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

- `formatMarkdown` (`scripts/review-record.mjs:711`) is called on the section
  text by `spliceSection`'s comparison (`:523`) and by `verifySection`'s
  (`:861`).
- `land()` (`:1085`) splices each section in a scratch clone, then splices it
  for real, then verifies it. So `formatMarkdown(sectionText)` runs about three
  times on identical text, and a section costs about five spawns.

It depends on [repo-89](./repo-89-the-review-record-land-cli-test-times-out-on-the-windows-leg.md),
which is in-flight and closes on readings of the `--land` CLI test's duration on
`windows-latest`. Changing the spawn count under that test before those readings
are taken would spoil them.

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
