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
2. The ubuntu import share and wall clock fall against the nearest `main` matrix
   run, and the Log states the difference.
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
- 2026-11-10, built by a Sonnet 5.5 builder on `repo-129-split-isolation` from
  `a100f429`. **What the brief had wrong, and what was done about it.**
  - **`--project <name>` matches a project's name exactly** (vitest 5.0.5,
    `wildcardPatternToRegExp`: `^name$`, case-insensitive), so two inline projects
    `planner` and `planner (isolated)` would have made `npm test -- --project
    planner`, `ci.yml`'s matrix, `preflight.mjs`'s plan and `npm run test:planner`
    run half the files and say nothing. A glob in the docs is not enough: those four
    pass the literal name. What vitest 5 does give is the container: a config
    _file_ that declares `projects`; its children are named `<name> (<child>)` and
    `--project <name>` matches the container by ancestry (`matchesEntryFilter`).
    So each split tool has `tools/<tool>/vitest.config.ts`, and the root config
    lists the three paths. **A file project inherits nothing from the root config**
    (`resolveSingleProjectEntry`: "file-based projects own all of their values"),
    so `splitProject` sets repo-99's `maxWorkers: 4` itself under the same `isCi`;
    unproven here, because the gate sets `VITEST_MAX_WORKERS` locally and CI is
    the only place `isCi` is true (gate 1 has since read it from vitest's config
    resolution: the `maxWorkers: 4` entry below).
  - **Selection is by reading the file, not by a list.** `splitProject`
    (`vitest.isolation.ts`) puts a file in the isolated half when it matches
    `\bvi\.(?:mock|doMock|unmock|doUnmock|stubGlobal|stubEnv|resetModules)\b`, or
    when a container names it in `stayIsolated` with a reason. The count the brief
    gave (35) omitted `resetModules` and `doMock`; the pattern above finds **50**
    files at `a100f429`: core 1, downloader 9, planner 13, ledger 24, `scripts/test`
    3 (`grep -rlE '<pattern>' tools packages scripts --include=*.test.ts
    --include=*.test.tsx`). A new file that mocks goes isolated the day it is written.
  - **The preflight shuffle failure is not what the Log took it for.**
    `npx vitest run scripts/test/preflight.test.ts --sequence.seed=2` fails with
    `--sequence.shuffle.tests` (`1 failed | 120 passed`, the ghshim case, now near
    line 3038) and passes with `--sequence.shuffle.files` (`121 passed | 1
    skipped`). It is an order the file depends on, inside one file, and it fails
    under `isolate: true` all the same; seed 1 passing was not "half stale", it
    only did not draw the order. `repo` is not split (below), so no reading here
    shuffles it and it was left alone.
  - **`--sequence.shuffle` is the wrong flag for ledger.** It reorders tests inside
    a file as well as files, and ledger has two files whose tests depend on the
    ones above them: seeds 3 and 4 failed `csv-import.test.ts › no line of any
    request above holds a CSV's content…` and `workbook-describe.test.ts › no line of
    any request above holds the upload's content…` (`csv-import.test.ts` seed 3: `expected 0 to be greater than 20`;
    `workbook-describe.test.ts` seed 4: `expected false to be true`). Both fail with `--isolate` too (`npx vitest run
    tools/ledger/api/test/csv-import.test.ts --sequence.shuffle --sequence.seed=3
    --isolate` → `1 failed | 62 passed`; `workbook-describe.test.ts` seed 4 → `1
    failed | 44 passed`), so they are not leaks between files. Ledger's five
    readings use `--sequence.shuffle.files`; planner's and downloader's use plain
    `--sequence.shuffle`, which they pass. The two ledger files are filed as lg-106
    (pull request #789, branch `ledger-file-shuffle-order`, open) and the preflight
    ghshim case as repo-144 (pull request #788, open), not folded in: each needs its
    tests made independent of their order, which is test design and not this
    ticket's.
  - **Core and `repo` are left unchanged.** Core: `--project core --isolate` 2.15,
    2.22, 1.79 s against 3.85, 1.97, 1.99 s split (three alternating pairs): no
    gain, so no container file in `packages/`. `repo`: 14.1 s with import at 3 %
    of it (`npm test -- --project repo`); the cost is spawning `git` and `node`.
- 2026-11-10, **the readings.** Each is one gated `npm test -- --project <tool>
  <flags>` on the branch, serially; correctness only, the machine was shared with
  two peer sessions. All passed, 2608/2610 and 2 skipped in the downloader (the
  same one file and two tests skip under `--isolate`).
  - planner, `--sequence.shuffle --sequence.seed=<n>`, seeds 1 2 3 4 5: `Test
    Files 86 passed (86)`, `Tests 1944 passed (1944)` each.
  - ledger, `--sequence.shuffle.files --sequence.seed=<n>`, seeds 1 2 3 4 5:
    `Test Files 99 passed (99)`, `Tests 2300 passed (2300)` each. (Plain
    `--sequence.shuffle`: seeds 1, 2 and 5 pass, 3 and 4 fail as above.)
  - downloader, `--sequence.shuffle --sequence.seed=<n>`, seeds 1 2 3 4 5: `Test
    Files 126 passed | 1 skipped (127)` each.
  - **Files, before and after (Done when 3):** `vitest list --filesOnly --project
    <p> | grep -c test` at `a100f429`: core 15, repo 16, downloader 127, planner
    86, ledger 99. On the branch: core 15, repo 17 (its own new test),
    downloader 27 isolated + 100 shared = 127, planner 13 + 73 = 86, ledger 24 +
    75 = 99; 343 in all either way. `scripts/test/vitest-projects.test.ts` holds
    it: each split tool's `--project` lists exactly the test files on disk, none
    twice, and every file matching the pattern is in an isolated half.
  - **The files that stay isolated:** every file matching the pattern (downloader
    9, planner 13, ledger 24), and the whole of
    `tools/downloader/resolvers/test/browser/` (20 files, 2 of them already
    matching) for Build 3: Chromium through `BrowserPool`, and prototype patches
    (`provoke.test.ts` patches `Frame.click`). No file needed to move out of the
    shared half after a failure, and no list was grown by hand: the ledger rate
    limiter, `no-model-environment.ts` and the downloader's recorders held through
    five shuffled passes. The one non-shuffled downloader run that failed
    (`resolvers.test.ts › a rejection recorded before the caller's own window does
    not reach it`, `TLS_VERIFICATION_FAILED` for `UNREACHABLE`, run during a 125 s
    load) did not recur in the six runs after it (one more unshuffled, five shuffled), and its cause is
    unproven: it needs `Date.now()` not to have advanced past a 20 ms timer.
  - **Local wall times (not a reading: a shared machine, noisy to 2x):** alternating
    `--isolate` and the split, planner 10.2 s and 8.4 s against 6.8 s and 6.6 s,
    with `import` at 38-44 % of the summed time against 27 %; ledger 22.8 s and
    36.7 s against 19.8 s (the second split run hit a `history.test.tsx` focus
    failure in the _isolated_ half under that load: `the button reports whether
    its control is open, and takes focus back when it closes (lg-95)`); downloader
    147 s and 71 s against 66 s (and one run, 125 s, with the failure above).
    `import` fell from 9-10 % of the summed time to 3-5 %; the downloader's wall time is
    its browser files, which stay isolated, so it moves least.
  - **Build 5, planner's alternatives, kept `isolate: false`.** A scratch config
    (not committed) with the planner project isolated and `@planner/*` aliased to
    `src/index.ts`, or `server.deps.external` over `tools/planner/*/dist`, three
    alternating rounds against the plain project: duration 22.7, 21.0 and 15.0 s
    plain; 32.8, 18.5 and 21.3 s aliased; 27.3, 11.7 and 16.6 s externalised;
    `import` 37-48 % in all three. Neither beats the 6.6-6.8 s of the split, and
    neither separates from the plain project beyond the machine's noise.
  - **The new test fails when the pattern stops matching:** with `vi\.(?:mock|` in
    `vitest.isolation.ts` changed to `vi\.(?:nomock|`, `npx vitest run
    scripts/test/vitest-projects.test.ts` → `1 failed | 1 passed (2)`, `a test file
    that mocks, stubs or resets modules is in the isolated half`; restored from
    the commit. The test states the mock calls itself (a first version imported
    `NEEDS_ISOLATION` and passed under that same mutation).
  - **CI, this pull request's run `42732276312` at `2b13cbd9` (Done when 1's CI pass
    and Done when 2).** `test (ubuntu-latest)` passed: `Test Files 342 passed | 1
    skipped (343)`, `Duration 198.63s (tests 90%, import 4%, environment 3%,
    transform 2%)`. `test (windows-latest, informational)` passed: `340 passed | 3
    skipped (343)`, `Duration 343.53s (tests 87%, environment 6%, import 6%,
    transform 1%)`. Both read with `gh run view 42732276312 --job <id> --log`.
  - **Done when 2 cannot be read in seconds.** The comparison run `40210503276`
    was vitest 4 and printed `import 144.65s, tests 814.81s`; vitest 5.0.5, which
    `main` runs now, prints each as a share of the summed time and no seconds. The
    nearest green `main` push run with its matrix executed is `42525621981` (`d7137816`,
    two docs commits and one ledger change before this base): ubuntu `341 passed | 1
    skipped (342)`, `Duration 229.18s (tests 83%, import 11%, environment 4%,
    transform 2%)`; windows `322.30s`, `import 11%`. So **ubuntu import went from
    11 % to 4 % of the summed time and the wall clock from 229 s to 199 s; windows
    import from 11 % to 6 %, wall 322 s to 344 s** (the informational leg, whose
    wall time moves with its runner). In seconds that is a derived estimate and not
    a reading: with the old run's 815 s of tests held fixed, 11 % is about 108 s
    and 4 % about 36 s. The 145 s figure is not comparable to either, which the
    brief could not have known; the Done when wants rewording to the share. A nearer
    `main` push run ran its matrix, `42536853653` at `7a1ad282` (ubuntu `269.18s`,
    import 14 %; windows `379.57s`, import 14 %), and was red on one
    `history.test.tsx` focus case; it is not the baseline used here, and against it
    the fall is larger, so no conclusion changes (gate 1's F5).
  - **`maxWorkers: 4`, read from vitest's own config resolution (gate 1's):** a
    `createVitest` probe printing `project.config.maxWorkers` gives 4 for all eight
    head projects and all five base projects under `CI=true`; with `CI` unset or
    `false` it gives 11 (`nproc` is 12).
- 2026-11-10, **the owner's answers at the gate checkpoint** (tools-86, checkpoint
  4, relayed by the orchestrator; each was the recommended option and none was
  overridden), recorded by the lander.
  - **Done when 2, which asked for a seconds figure no run prints.** Options: reword
    to the share and the wall clock (chosen; the builder's recommendation); keep
    seconds; reword and also hold windows. The Done when line itself is reworded to
    "The ubuntu import share and wall clock fall against the nearest `main` matrix
    run, and the Log states the difference."
  - **The three in-file order-dependent tests** (the preflight ghshim case and the
    two ledger log tests). Options: file two tickets (chosen; the builder's
    recommendation); record in the Log only; fix ghshim here and file the ledger
    one only. Filed as
    [repo-144](./repo-144-the-preflight-leak-spec-depends-on-test-order.md) (pull
    request #788, open) and lg-106, `tools/ledger/docs/work/lg-106-the-log-tests-read-what-earlier-tests-logged.md`
    (pull request #789, open, branch `ledger-file-shuffle-order`); neither is on
    this branch, so the links are by name until they merge.
  - **pl-64's handover.** Options: a note in pl-64's Build in this pull request
    (chosen); leave it to pl-64's builder. The note is appended to the bullet that
    reads "Exclude `api/test/live-records.test.ts` from the `planner` project's unit
    run." in
    `tools/planner/docs/work/pl-64-planner-tests-load-the-contract-twice-and-scan-archived-runs.md`:
    the planner project is now `tools/planner/vitest.config.ts`, and `splitProject`
    has no `exclude` option.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F1 — "Build 2 and Done
  when 1 name `--sequence.shuffle`; for ledger the Log used
  `--sequence.shuffle.files`". The Log's "a defect to file" sentence now cites
  lg-106 and repo-144 (Build 2's own wording is the
  brief's). `git diff 5bee293c HEAD -- docs/work/repo-129-every-test-file-reimports-its-module-graph.md | grep -c '^-.*are a defect to$'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F3 — "the header of
  `no-model-environment.ts` says `setupFiles` is in the root `vitest.config.ts`,
  and the opening of `testing.md` and the root `CLAUDE.md` still say the projects
  are configured once in the root file". The owner authorised the wording of all
  three, and nothing else in the two pages; landing edit, not gated. `git diff 5bee293c HEAD -- .claude/rules/testing.md | grep -c '^-.*configured once in the root'` → `1`;
  `git diff 5bee293c HEAD -- CLAUDE.md | grep -c '^-.*configured in the root$'` → `1`;
  `git diff 5bee293c HEAD -- tools/ledger/api/test/helpers/no-model-environment.ts | grep -c '^-.*in the root$'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F4 — "the new test's
  `MOCKS` regex omits `unmock` and `doUnmock`". Both are in `MOCKS` now. Proof, on
  the fix's commit with a throwaway `tools/planner/api/test/zz-unmock-probe.test.ts`
  holding one `vi.unmock("node:fs")` call and `unmock|doUnmock` taken out of
  `NEEDS_ISOLATION`: the gated test (`git checkout 5bee293c -- scripts/test/vitest-projects.test.ts`)
  → `Tests  2 passed (2)`, green under the mutation; the fixed test
  `npx vitest run scripts/test/vitest-projects.test.ts` → `1 failed | 1 passed (2)`,
  `planner: expected [ …(13) ] to deeply equal ArrayContaining{…}` naming the
  probe. Restored with `git checkout 11d693a6 -- vitest.isolation.ts`, probe
  removed. `doUnmock` was removed in the same mutation as `unmock` and the probe
  calls only `unmock`, so `doUnmock` is covered by being in the same pattern and not
  by a call of its own.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F5 — "the Log's baseline
  sentence calls `d7137816` 'the nearest `main` push run with its matrix
  executed'". It now reads "nearest green" and names run `42536853653`, the nearer
  red one, with its figures. `git diff 5bee293c HEAD -- docs/work/repo-129-every-test-file-reimports-its-module-graph.md | grep -c '^-.*nearest `main` push run with its matrix executed'` → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1, F6 — "the Log gives
  `expected 0 to be greater than 20` for both ledger files". Each file now carries
  its own message. `git diff 5bee293c HEAD -- docs/work/repo-129-every-test-file-reimports-its-module-graph.md | grep -c '^-.*(`expected 0 to be greater than$'`→`1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 1's note — "the Log's 'Not
  proven by anything run here: that a file project's `maxWorkers: 4` took effect
  on CI' can be proven and now is". The Log's last reading is replaced by the gate's
  probe and the earlier "unproven here" clause points to it. `git diff 5bee293c HEAD -- docs/work/repo-129-every-test-file-reimports-its-module-graph.md | grep -c '^-.*Not proven by anything run here'` → `1`.
