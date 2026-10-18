---
id: repo-106
tool: repo
title: review-record.test.ts takes about 121 s on the Windows leg, and nothing measured says why
kind: chore
status: ready
milestone: null
depends_on: [repo-100]
difficulty: standard
---

# repo-106 — review-record.test.ts takes about 121 s on the Windows leg

## Why

[repo-100](./repo-100-review-record-formats-the-same-section-three-times-per-landing.md)
memoized `formatMarkdown` and merged four tests, and its gate read the
`Run npm test` step of each run. The Ubuntu leg dropped; the Windows leg did not
move. The owner decided on 2026-10-18 to file a profiling ticket for the Windows
time rather than leave it as an observation.

The reproduction, from repo-100's gate (`ticket-reviewer-opus`):

| Leg                            | Run and sha                         | `review-record.test.ts`        |
| ------------------------------ | ----------------------------------- | ------------------------------ |
| ubuntu-latest                  | 39086562034 at `029641b4`, 67 tests | 41,634 ms                      |
| ubuntu-latest                  | 39089135953 at `e7658afd`, 64 tests | 21,171 ms                      |
| ubuntu-latest                  | 39089694781 at `d06865b1`           | 31,289 ms                      |
| windows-latest (informational) | the same three runs                 | 121,328 / 121,660 / 124,269 ms |

Re-read by the builder on 2026-10-18 with
`gh run view 39089135953 --log | grep -i "review-record"`, ANSI codes removed:

```
test (ubuntu-latest)  Run npm test  ✓ repo scripts/test/review-record.test.ts (64 tests) 21171ms
test (windows-latest, informational)  Run npm test  ✓ repo scripts/test/review-record.test.ts (64 tests) 121660ms
```

On the same file the Windows figure is about three to six times the Ubuntu one,
and it stays near 121 s across the three shas, one of which is the repo-100
branch. The Ubuntu figure moves and the Windows one does not, so whatever
dominates Windows is not the part that moved. Nothing measured says what it is.

**Candidate causes, none of them measured:**

- **The per-test fixtures.** `scripts/test/review-record.test.ts` creates
  temporary directories for its git fixtures (`mkdtempSync` at, among others,
  `:234`, `:1067` and `:1328`). How many `git` and `oxfmt` processes each test
  spawns is not counted anywhere. A process spawn is the likely per-unit cost on
  Windows, and the count is the multiplier.
- **The whole-ticket `oxfmt` spawn.** `spliceSection` in
  `scripts/review-record.mjs` (`:416`) runs `oxfmt` in place on the whole ticket
  file, at `:492`. That is not the call repo-100 memoizes: `formatMarkdown`
  (`:712`) formats a temporary section file, at `:717`, and is what the memo
  covers. `spliceAndCommitAll` calls `spliceSection` per plan and is called from
  two sites (`:1431` and `:1484`). The dispatch that asked for this ticket
  counted two whole-ticket calls; the source has one spawn site for that call,
  and how many times a test reaches it is what a measurement would have to count.

The Windows leg runs only on CI, so the reproduction only another OS can give is
the orchestrator's to arrange as a probe pull request
(`reference/dispatching.md`, _A probe pull request_). The dispatch puts one run of
the matrix at about 17 minutes of Linux and Windows legs.

## Build

Measure, do not fix. The fix, if any, is a separate ticket that this one names.

1. Arrange a **probe pull request** with the orchestrator, as
   `reference/dispatching.md` says. The orchestrator names its files in the
   dispatch; the probe adds new files only and is never merged. The measurements
   it must take are: per-test durations for `review-record.test.ts` on each leg
   (vitest's verbose reporter, in the probe run), and one timed `git` spawn and
   one timed `oxfmt` spawn on `windows-latest` from a new probe spec file that
   touches no existing file. The probe must not change what the existing test
   asserts. Its title follows the commit convention and says `DO NOT MERGE`
   after the type and scope.
2. Read the Windows leg and the Ubuntu leg of that run with
   `gh run view <run> --json jobs` for each step's conclusion, then
   `--job <id> --log | grep` for the timings. Record each number with its run
   id, sha and test count.
3. From those readings, name the dominant cost on Windows. Split the
   `review-record.test.ts` time into fixture setup (directory and repository
   creation outside the test body), `oxfmt` time (the whole-ticket spawn at
   `:492` and the section spawn at `:717`, with the number of times each test
   reaches them), and the rest. State the share of each the probe actually
   measured.
4. Time one `git` spawn and one `oxfmt` spawn on `windows-latest`, so the
   per-spawn cost is a measured Windows number, not the 330 ms and 2 ms figures
   repo-100's ticket quotes from the repo-99 audit.
5. Close the probe pull request without merging it, and delete its branch.

## Done when

1. The Log holds the Windows and Ubuntu per-test durations for
   `review-record.test.ts` from the probe run, each with its run id, sha and the
   test count the leg printed.
2. The Log names the dominant cost on Windows with a share of the file's time for
   each candidate cause above: fixture setup, the whole-ticket `oxfmt` spawn, the
   section `oxfmt` spawn, and the rest. A cause the probe did not measure is named
   as unmeasured, not as ruled out.
3. The Log holds one measured `git` spawn and one measured `oxfmt` spawn on
   `windows-latest`, in milliseconds.
4. The probe pull request is closed without merging, and its branch is deleted.
5. The Log names the fix, or says none is needed, and a follow-up ticket is filed
   for any fix.

## Log

- **2026-10-18** — Filed by a maintenance dispatch from the reproduction in the
  table above. The builder added no code and no workflow. Source read at
  `origin/main` `960f4b26`, and the cited files are unchanged at the filing base
  `140bd78a`: the whole-ticket `oxfmt` spawn is at
  `scripts/review-record.mjs:492`, inside `spliceSection`; the section spawn that
  `formatMarkdown` makes is at `:717`. The dispatch said two whole-ticket calls;
  the source has one spawn site, and the count per test is unmeasured. The
  `depends_on` on [repo-100](./repo-100-review-record-formats-the-same-section-three-times-per-landing.md)
  is because repo-100 changes the spawn count in this same file, and a Windows
  reading taken before it lands describes the code that is about to go.
