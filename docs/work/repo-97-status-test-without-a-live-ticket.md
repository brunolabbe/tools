---
id: repo-97
tool: repo
title: A status test asked the live board for a ticket whose awaiting line was meant to be deleted
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-97 — A status test asked the live board for a ticket whose awaiting line was meant to be deleted

## Why

On `origin/main` at `1a044437`, `scripts/test/status.test.ts` fails:

```
$ npx vitest run scripts/test/status.test.ts -t "real outstanding obligation"
 FAIL  |repo| scripts/test/status.test.ts > the repo's own board surfaces at least one real outstanding obligation
AssertionError: expected [ 'dl-73' ] to include 'repo-16'
 ❯ scripts/test/status.test.ts:1642:33
 Tests  1 failed | 133 skipped (134)
```

The test did `expect(owed.map((t) => t.id)).toContain("repo-16")` over
`readTickets(REPO)`. #418 ("close repo-46's and repo-16's awaiting lines from
their readings") removed repo-16's `awaiting:` line, which is the field's whole
lifecycle: a line is written when a ticket owes something and **deleted** when
the reading arrives (`docs/01-TICKETS.md`). So the test was written to fail
the first time anyone used the field as designed.

`main` did not go red where anyone looked: #418 changed only `.md` files, and
`ci.yml`'s `changes` job skips the unit matrix for an all-markdown change
(`gh run view 38089787446 --json jobs` shows `test (…)` skipped at
`1a044437`). Every branch that then merges `main` fails `test (ubuntu-latest)`
and `test (windows-latest, informational)`. Found by a gate on dl-103.

Two defects, both fixed here:

1. **The test depends on a ticket's lifecycle state.** Fixed here.
2. **A markdown-only change can break a unit test while CI skips the unit
   tests.** Fixed by the owner's answer of 2026-10-10 (Log): the `check` job
   runs `scripts/test/status.test.ts` on every change. The `changes` filter
   and the unit matrix are untouched.

## Build

1. Replace the test with two that never name a live ticket:
   - a synthetic tree (`repoWith`) holding a ticket with an `awaiting` line and
     one without, asserting the first parses to its text and the second to
     `null`. It cannot be vacuous, because the fixture carries the line;
   - a real-board cross-check that for every ticket file on the board, the
     frontmatter contains an `awaiting:` line exactly when `readTickets`
     returns a string for it. It holds on a board with no `awaiting` line at
     all, so closing the last one stays legal.
2. Show both fail with the field's parsing removed, and that deleting the one
   real `awaiting` line left on the board (dl-73's) leaves the suite green.
3. Add one step to `ci.yml`'s unfiltered `check` job, after the existing
   ones: `npx vitest run scripts/test/status.test.ts`, with a comment saying
   why. Show it red against `1a044437`'s copy of the test and green here.

## Done when

1. `npx vitest run scripts/test/status.test.ts` passes on this branch, where it
   failed on `origin/main` at `1a044437`.
2. Both new tests fail with the field's parsing removed (`ticket.awaiting =
null` in `readTickets`, and separately the `FIELDS` entry deleted).
3. Deleting every real `awaiting:` line leaves `status.test.ts` green.
4. The Log names every other test that reads live ticket state, and states
   the markdown-only gap as options with the owner's answer recorded.
5. `ci.yml`'s `check` job runs `npx vitest run scripts/test/status.test.ts`
   on a change that is all `.md`, and that command is red on `1a044437`'s copy
   of the test and green on this branch.

## Review

**Gate: FAIL** — 2026-10-10 · `1a044437..bf7842eb` · Opus 5.5, depth narrow (the dispatch's five attacks and the acceptance table only)

| Done when                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `status.test.ts` passes here, and failed on `origin/main` at `1a044437`                                    | `scripts/test/status.test.ts`, 135 of 135 at `bf7842eb` ✓. **verified** for the base half: 1 failed, 133 passed of 134 at `1a044437`, `the repo's own board surfaces at least one real outstanding obligation`, `expected [ 'dl-73' ] to include 'repo-16'`                                                                                                                                                                                                |
| 2. Both new tests fail with the field's parsing removed, both ways                                            | **verified** by the gate. `ticket.awaiting = null`: `an awaiting line in a ticket file reaches the parsed ticket, and its absence is null` red (`expected [] to deeply equal [ [ 'pl-1', …(1) ] ]`) and `every awaiting line on the repo's own board is carried by the ticket it is written in` red (`expected [ 'dl-73' ] to deeply equal []`). The `FIELDS` entry deleted: both red, `"awaiting" is not a ticket field` for `pl-1-slug.md` and for dl-73 |
| 3. Deleting every real `awaiting:` line leaves `status.test.ts` green                                         | **verified**: one file on the board carries the line (dl-73, `grep -rlE "^awaiting:"`); deleted, 135 of 135                                                                                                                                                                                                                                                                                                                                                |
| 4. The Log names every other test reading live ticket state, and states the markdown-only decision as options | **not met** on its first clause: the table omits `--tool with a name no tool has is a named failure, not an empty view`, which reads the live board (F1). Second clause met: three options, one recommended                                                                                                                                                                                                                                                |

- **high** · F1 · Done when 4 depends on it · the Log's table of tests that read live ticket state lists seven and the true count is eight. `--tool with a name no tool has is a named failure, not an empty view` runs the CLI rootless (`run(["--tool", "sniffer"])`), so it reads the real board. Reproduction: add an unknown field to one real ticket (`bogus: x` under `difficulty:` in the repo-97 file), then `npx vitest run scripts/test/status.test.ts` → `5 failed | 130 passed (135)`, and the five are `every ticket in the repo parses…`, `no ticket on the board is ready with a gate record…`, `repo-wide tickets live in docs/work`, **`--tool with a name no tool has…`**, and the new cross-check. `node scripts/status.mjs --json` covers its malformed-ticket failure but not its tool-name one, so the Log's "the other four" that CI does not run on a markdown-only change are five. It does **not** change the premise: this test stayed green with every open ticket set to `done` and again to `dropped`. Fix: one table row and "four" to "five".
- **low** · the comment above the cross-check says it "holds with no `awaiting` anywhere on the board — and says so rather than going red". Nothing says so: on an empty board the test passes silently. "Passes" is accurate; "says so" misleads.
- **low** · the Log's case for option 1 reads "the cost was one case, now removed". It is the second case. `docs/work/repo-8-tests-bound-to-real-tickets.md` (done) fixed two tests in this file that "fail because the project succeeded", and repo-97 does not mention it. The owner should see the earlier case before choosing option 1.
- **low** · option 3 costs the `repo` project at "minutes, not seconds". Measured here: `npx vitest run --project repo`, 13 of 13 files, 488 of 488 tests, 48.3 s locally. A CI runner may differ; this gate did not measure CI.
- **dropped** · "the new cross-check only checks presence, so a parser that mangles the text passes it." True: truncating the value to 10 characters leaves the cross-check green. But the synthetic test goes red (`expected [ [ 'pl-1', 'the securi' ] ] …`), and so do 8 other existing tests. The old test did not check the value either. Not a regression.
- **dropped** · "something the old test caught is now uncaught." Under both mutations the old test's mechanism half, (a), is also caught by 8 to 18 existing synthetic tests (10 and 19 tests red). The real-format half, (b), is kept by the cross-check while any line exists. Only (c) is lost: "this particular ticket still owes something". Losing (c) is the fix.
- **findings** · the hunt returned 6; 4 carried (1 high, 3 low), 2 dropped.
- PR #420 at `bf7842eb`: `check` ×2, `changes`, `codeql`, `CodeQL`, `dependency-review` green; `test (ubuntu-latest)` and `test (windows-latest, informational)` still in progress when read. No acceptance line depends on them.
- Invariants: the diff is one test file and one ticket, so only test registration and style apply. The file is existing and already registered, and it uses no `any` and no `console`. All others skipped as not touchable.
- NFR: security n/a · performance n/a · reliability ✓ (no test now depends on a ticket's lifecycle: every open ticket set to `done`, then to `dropped`, then dl-73's line deleted, each 135 of 135) · maintainability — the three lows.

## Log

- 2026-10-10 — filed and fixed in one branch from a gate's finding on dl-103,
  confirmed by running the test on `origin/main@1a044437` (output above).
  Owner's choice that day, from "owner raises it with the peer", "builder
  dispatched for a small repo PR" (recommended, chosen) and "file a repo ticket
  only": make the test prove the mechanism without depending on any live
  ticket's awaiting line.

  **What the old test protected, and what the new ones do and do not.** The
  old test was written against the real board so that it "has to be able to
  fail first": with the field absent from the parser the property was
  `undefined` on every ticket, and a `!== null` check passed all of them. It
  protected (a) the parser reads `awaiting`, (b) a line a person really wrote,
  in the shape people write it, survives the parse, and (c) the real board
  held an obligation at all. The new pair keeps (a) and (b) and drops (c).
  The synthetic test is the mechanism, with a fixture that carries the line, so
  it is never vacuous; the cross-check is (b) restated as an agreement between
  the file and the parse, so it needs no particular ticket and passes on an
  empty set. **What is lost:** nothing now asserts that the board has an
  outstanding obligation. That was never a property worth asserting; it was
  the test's proxy for "the real format reaches the parse", and (b) now says
  that directly. The cross-check is vacuous on its real-board half whenever no
  ticket owes anything, which is why the synthetic half exists.

  **Fail first**, both measured here by editing `scripts/status.mjs` and
  reverting with `git checkout`:
  - `ticket.awaiting ??= null;` changed to `ticket.awaiting = null;`: both new
    tests fail (`expected [] to deeply equal [ [ 'pl-1', …(1) ] ]`, and
    `expected [ 'dl-73' ] to deeply equal []`).
  - the `awaiting: { required: false },` entry in `FIELDS` deleted: both fail,
    with `"awaiting" is not a ticket field` for `pl-1-slug.md` and for dl-73.
  - dl-73's `awaiting:` line deleted from its file, then `git checkout`:
    `scripts/test/status.test.ts` 135 of 135 pass, which the old test could not
    do.

  **Every other test that reads live ticket state.** Found by grepping the
  test trees for `readTickets(REPO)`, a rootless `run([...])`, `docs/work`,
  `docs/01-TICKETS.md` and `readFileSync`/`readdirSync` of repo paths. All are
  in `scripts/test/status.test.ts`; `status-gate-record.test.ts`, `next-id`,
  `preflight`, `review-record` and `hooks` build their own trees or only name
  a ticket file inside a string, and `cloudflare-setup`'s `readdirSync` reads
  compose files.

  | Test                                                                   | Reads                                           | Fails on                                                                            |
  | ---------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
  | `every ticket in the repo parses, and its dependencies resolve`        | every ticket, and the tool set against `tools/` | a malformed ticket, a dangling dependency, a tool directory the board does not know |
  | `no ticket on the board is ready with a gate record already on it`     | every ticket                                    | a ready ticket carrying `## Review`                                                 |
  | `repo-wide tickets live in docs/work`                                  | every `repo` ticket path                        | a repo ticket filed elsewhere                                                       |
  | `no tool keeps a status page, and neither does the repo`               | `docs/` and `tools/*/docs`                      | a returned `03-STATUS.md`                                                           |
  | `the ticket format states the rule the parser enforces`                | `docs/01-TICKETS.md`                            | the quoting paragraph rewritten away                                                |
  | `the ticket format documents the field and says who clears it`         | `docs/01-TICKETS.md`                            | the `awaiting` row or its "deletes the line" sentence rewritten away                |
  | `--tool with a name no tool has is a named failure, not an empty view` | the real board, through a rootless `run([...])` | a malformed ticket (the CLI fails first), or a tool called `sniffer`                |
  | the new cross-check                                                    | every ticket file                               | the parse dropping a written `awaiting` line                                        |

  None of them fails on a ticket doing what the format intends; each fails only
  on a defect, which is the difference from the repo-16 case. The gate set
  every open ticket to `done`, then to `dropped`, then deleted dl-73's line:
  each 135 of 135. Two of them (`parses` and `ready with a gate record`) are
  also covered, for a malformed ticket, on an all-markdown change by `ci.yml`'s
  `node scripts/status.mjs --json` step in `check`. The other five read the
  repo for something `--json` does not look at (`repo-wide tickets live in
docs/work`, `no tool keeps a status page`, the two format-document tests and
  `--tool … no tool has`, whose tool-name failure `--json` never reaches), as
  do the cross-check and the tool-set clause of `parses`. So **a markdown-only
  change can break them and, before the step below, CI would not run them.**
  `--tool … no tool has` was missing from this list in the first draft; the
  gate (round 1) found it by adding `bogus: x` to one real ticket, which
  failed five tests including that one.

  **Earlier case.** This is the second time the gap has produced a red test on
  a markdown change. [repo-8](./repo-8-tests-bound-to-real-tickets.md) fixed
  two tests in this same file that went red when downloader tickets finished,
  and did not close the gap. The first draft of this entry called the cost
  "one case", which was wrong.

  **Owner answer, 2026-10-10**, to "should a markdown-only change still run the
  unit tests that read live tickets?". Options: (1) _Run `status.test.ts` in
  the `check` job_ — one vitest step, about 3.9 s, in a job that runs on every
  change including markdown; **chosen**, and recommended by the coordinator.
  (2) _Leave CI as is_ — **my recommendation, overridden**: I argued each
  remaining test guards a defect, so a late red is a correct signal, and had
  counted one earlier case where there were two. (3) _Run the `repo` project
  when `docs/**` changes_ — closes the gap without a new step but widens the
  `changes` filter, and runs 488 tests on every ticket flip (48.3 s locally,
  measured by the gate; CI unmeasured; the first draft said "minutes", which
  was unmeasured). Built as Build step 3.

  **2026-10-10, round 1 (gate 1, Opus 5.5, failed `bf7842eb` on one high and
  three lows).** F1: the `--tool` row above. Lows: the cross-check's comment
  no longer says it "says so" on an empty board (it passes, trivially); the
  repo-8 case is named; option 3's cost is the measured one. The step was added
  to `ci.yml`'s `check` job after `node scripts/status.mjs --json`.

  **The step catches the defect**, measured with `1a044437`'s
  `status.test.ts` put back over this branch's (`git checkout 1a044437 --
scripts/test/status.test.ts`, then restored) and the exact step command:

  ```
  $ npx vitest run scripts/test/status.test.ts      # exit 1
   × the repo's own board surfaces at least one real outstanding obligation
  AssertionError: expected [ 'dl-73' ] to include 'repo-16'
   Tests  1 failed | 133 passed (134)
  ```

  On this branch the same command is green (135 of 135, see the report on the
  pull request). `scripts/preflight.mjs` derives `ci.yml`'s `check`-job
  commands and spawns any that are not `npm ci` or `npm run check`, so it
  runs the new step too (its `ciCommands` section lists `ok    npx vitest run
scripts/test/status.test.ts`). **The brief did not say** that two tests in
  `scripts/test/preflight.test.ts` pin the real `ci.yml` check-job command list
  (`extractCheckJobCommands reads this repo's own ci.yml check job, in order` and
  `deriveExtraCiCommands runs only what no other check already covers`); the
  first preflight of this round failed on both, and each gained one expected
  line.

- 2026-10-10 — landing. Two edits made at landing by the owner's choice, with no
  re-gate (both gate files are landed as handed; no other finding is open).

  1. **Gate 2's new low, fixed at landing by owner choice.** `ci.yml`'s header
     said no `.md` in the repository is a test fixture, which
     `scripts/test/status.test.ts` contradicts: it reads every ticket file and
     `docs/01-TICKETS.md`. Question: "Should the lander correct it, with no
     re-gate?" Options: "Correct it at landing" (recommended; chosen) and
     "Leave it recorded". The sentence now says almost none is, names that one
     suite, and says that is why `check`, not the matrix, runs it (repo-97).
     Comment only.
  2. **Gate 2 attack 4, fixed at landing by owner choice.** `CLAUDE.md`'s
     Testing section and `.claude/rules/testing.md` explained the unfiltered
     `check` job by `oxfmt` alone, which is now incomplete. Question: whether to
     amend them. Options: "Add one clause to both, in repo-97" (recommended;
     chosen, the owner's direction), "You edit it yourself later" and "Leave
     both as they are". Each file gained one clause in the sentence beginning
     "`ci.yml`'s `check` job is filtered by nothing at all": the job also runs
     `scripts/test/status.test.ts`, which reads ticket files (repo-97). Nothing
     else in either file changed.
