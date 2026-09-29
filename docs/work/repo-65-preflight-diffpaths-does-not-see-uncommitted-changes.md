---
id: repo-65
tool: repo
title: preflight's diffPaths does not see uncommitted changes, so a touched suite can go unrun
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-65 — preflight's diffPaths does not see uncommitted changes

## Why

`scripts/preflight.mjs`'s `preflight()` computes `diffPaths` once, from
`git diff --name-only ${base}...HEAD` (`scripts/preflight.mjs:769`). That range
is committed history only — it cannot see a change that is staged, modified or
untracked in the working tree. Every check that reads `diffPaths` inherits the
gap: `checkBuild`'s `testPlan` (`scripts/preflight.mjs:231`) decides which
`npm test -- --project <tool>` to run from those same paths, and
`scriptsTouched` (`scripts/preflight.mjs:218`) is what adds the `repo` project
when anything under `scripts/` changed.

So a builder that edits `scripts/test/*.test.ts` (or any tool's source) and
runs `preflight.mjs` **before committing** gets a clean `check` bit with no
suite run for the change at all — not "ran and passed", genuinely not run.
`dl-53`'s builder reported this cold on 2026-09-27; this ticket is the
independent reproduction the batch's close-out asked for.

**Reproduced** on `origin/main` at `6988b65`, in a clean worktree:

```
$ echo "// scratch uncommitted probe" >> scripts/test/next-id.test.ts
$ git diff --name-only 6988b65...HEAD
                                            # <- empty: the edit is invisible
$ node scripts/preflight.mjs --base 6988b65
== check ==
ok    npm run check                        # <- no `npm test -- --project repo`
...
preflight passed (exit 0)
$ git checkout -- scripts/test/next-id.test.ts
```

`npm run check` alone never runs `scripts/test/next-id.test.ts`, so an
uncommitted change there — or to any tool's suite — passes preflight with
nothing having exercised it.

**Correction, gate 1: this is narrower than first written, and the checks do
not agree with each other the way the first draft claimed.** Check 3
(`checkReview`) and check 4 (`checkTitle`, absent `--title`) do read committed
state only (`git show HEAD:...`, the last commit subject). **Check 2
(`checkCitations`) does not**: `scripts/citations-gate.mjs:558
"fs.readFileSync(path.join(repo, record)"` reads the record straight off
disk, so it sees an uncommitted change to a ticket's own `## Review` section
exactly as it sees a committed one. Reproduced: prepending one uncommitted
comment line to `scripts/citations.mjs` (which many gate records cite by
line) made `node scripts/citations-gate.mjs --against origin/main` exit 1
with 3 records failing, on `origin/main` at `6988b65`, reverted after. So the
checks split three ways, not two: check 1's _test selection_ is decided from
committed diffs only, though the build and the suites it runs execute
against the working tree like any other local command; check 2 **selects**
its records from the git index (`git ls-files`, `scripts/citations-gate.mjs@2ffb72a:489`)
and **reads their contents** from disk. The earlier wording here said check
2 read the working tree unconditionally for both halves, selection
included; corrected at gate 3, which measured it directly: an untracked
ticket carrying a failing
citation is invisible to `citations-gate.mjs` until `git add`ed, after which
it is named. So check 2's _selection_ is index-based, not working-tree-based
— an untracked path is as invisible to it as to check 1's diff — even
though its selection criterion differs from check 1's (every tracked ticket
file in scope, not only ones the diff touches); only its _reading_ of a
selected file's contents is unconditional. Checks 3–4 read committed state
throughout. Check 5 (`checkMergeTree`) is unaffected either
way — it compares committed heads.

## The decision this ticket carries

**Answered 2026-09-28 by the owner: (b)**, the recommendation. Test selection
reads the working tree as well as the committed diff. No role page changes.

Two ways to close the gap, and they trade differently:

- **(a) Make `preflight.mjs` refuse to run over a dirty working tree.** Check
  `git status --porcelain` before computing `diffPaths` and fail fast (a new
  `EXIT` bit, or fold into `setup`) naming the uncommitted paths, telling the
  caller to commit first. **Gains every check's agreement, at a narrower cost
  than either earlier draft named (corrected at gate 3, on both gate 1
  finding 4's and gate 2 finding B's own miss: neither had read the Landing
  sections).** Refusing a dirty tree means all five checks end up reading
  the same, single, committed tree — the internal consistency (a) actually
  buys. **Three places prescribe the opposite order** (corrected again at
  gate 3, this time from the orchestrator's own read of `main` rather than
  from another gate round): `builder.md`'s own **Gates before you report**
  has every builder run `node scripts/preflight.mjs --base origin/<base>`
  before it reports, with nothing there about committing first — this is
  the section and the shape of run that `dl-53`'s builder actually hit,
  which is this ticket's own reproduction. The other two are the
  **fix-round** steps, not the whole of either page:
  `.claude/skills/orchestrate-tickets/roles/builder.md`, under _When you are
  resumed with findings_, step 2 ("Fix, run the narrowest checks, then
  preflight, then commit and push"), and
  `.claude/skills/orchestrate-tickets/roles/fixer.md`, under _The work_ ("Run
  the checks your fixes touch, narrowest first, then" `preflight.mjs`). Both
  pages' own **Landing** sections already commit first and preflight
  second — `builder.md`'s Landing lists "commit each gate record verbatim"
  as step 1 and preflight as step 2; `fixer.md`'s Landing lists commit, then
  "preflight exit 0," then push — so a landing already fits (a) with nothing
  to change. (a)'s real cost is adding a "commit first" line to
  **Gates before you report** and rewriting the two fix-round steps — three
  places across `builder.md` and `fixer.md`, not a reversal of an order the
  whole skill prescribes.
- **(b) Extend `diffPaths` to include the working tree, at least for check
  1's test selection.** Union `git diff --name-only ${base}...HEAD` with
  `git status --porcelain` (staged, unstaged and untracked paths, relative to
  `repo`). Matches what check 2 already does unconditionally and keeps the
  order both role pages already prescribe — preflight run before the commit
  that would otherwise make the change visible. Downside: check 3 and check 4
  still read committed state only (`git show HEAD:...`, the last commit
  subject), so this leaves the checks split across **two** trees rather than
  today's three — checks 1–2 on the working tree, checks 3–4 on committed
  state — not eliminating the split, only narrowing it; widening all of them
  to one tree is a larger, contract-adjacent change to a script every
  builder's report leans on.

**Recommendation, corrected once more: still (b), and the third place found
this round only widens the gap.** (a) makes every check agree, at the cost
named above — adding one line to `builder.md`'s **Gates before you report**
and rewriting its own fix-round step plus `fixer.md`'s, three edits across
two role pages rather than either of the two smaller counts this ticket
carried before; their Landing sections already fit (a) as written, so that
part of the cost has not grown. (b) leaves two trees instead of one, and
stays the same size it always was — a change to `preflight.mjs` alone,
touching neither role page — so the gap between (a)'s cost and (b)'s has
only widened as (a)'s own count grew from two places to three. It brings
check 1's selection closer to check 2's, though not identical — check 2
selects records with `git ls-files` (the index), so an _untracked_ file is
invisible to it, while (b)'s own `git status --porcelain` union would
include one for check 1's selection. **Answered below, 2026-09-28: (b)** —
this paragraph's own "still `needs-decision`" was superseded the moment the
owner recorded that answer at the top of this section, and is left here
only as the last of the corrected rounds' own reasoning, not as this
ticket's current state.

## Build

Whichever of (a) or (b) is chosen:

- Add a unit test reproducing this ticket's transcript: an uncommitted change
  under `scripts/test/` (or a tool's `src`) is either refused (a) or included
  in the resulting test plan (b) — `scripts/test/preflight.test.ts` is the
  existing suite for `testPlan`/`scriptsTouched`/`touchedTools`.
- Update this ticket's Log with which option was built and why, if the answer
  differs from the recommendation above.

## Done when

- The reproduction above no longer passes silently: (a) preflight exits
  non-zero over the dirty tree with a message naming the uncommitted paths, or
  (b) the `repo` project's suite runs and the exit reflects its result.
- A new test in `scripts/test/preflight.test.ts` locks the chosen behaviour.
- `npm run check` and `npx vitest run scripts/test/preflight.test.ts` pass.

## Review

### Gate 1

**Gate: CONCERNS** — 2026-09-29 · `6bfae8e...7170c8d` (base `6bfae8e`, still the tip of `origin/main` after this gate fetched) · code-review at medium. Re-issued at rounds 2 and 3: every unpinned coordinate below resolves against `89dd642`, and the words, rows and verdicts are those gated at `7170c8d`. Five citations became prose naming `7170c8d` at round 2, because that round deleted their text or corrected their claim: the test docblock line in the med, and the `preflight.mjs` lines in lows 1, 3, 4 and 5.

| Done when                                                                                           | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reproduction no longer passes silently: the `repo` suite runs, and the exit reflects its result | Suite selected: `scripts/test/preflight.test.ts:1999 "expect(calls).toContain("` ✓, red with `checkBuild` handed `diffPaths` again (1 failed of 84). A failing suite sets the bit: `scripts/test/preflight.test.ts@6bfae8e:253 "expect(result.bit).toBe(EXIT.check)"` ✓. **verified** end to end: an uncommitted failing test appended to `scripts/test/next-id.test.ts`, `--base 7170c8d`, exits 1 with `FAIL npm test -- --project repo` at the head and 0 with no repo suite run under the base `scripts/` extracted from `6bfae8e` |
| A new test in `scripts/test/preflight.test.ts` locks the chosen behaviour                           | `scripts/preflight.mjs:1580 "checkBuild(repo, testSelectionPaths, buildRun)"` is locked by the test above ✓; the parser by `scripts/test/preflight.test.ts:1935 "expect(found.length).toBe(4)"` ✓. The docblock claims more than the test asserts; see the med finding                                                                                                                                                                                                                                                                 |
| `npm run check` and `npx vitest run scripts/test/preflight.test.ts` pass                            | **verified**: check exit 0; spec 84 of 84 passed, exit 0, against 82 of 82 with both files checked out at `6bfae8e`. The test file diff is 97 lines added and 0 removed                                                                                                                                                                                                                                                                                                                                                                |

- **med** · The test that claims to guard the boundary of decision (b) does not guard it. The docblock of the new integration test (at `7170c8d`, line 1948 of the test file, "which the last two assertions below pin down") says checks 3 and 4 are pinned to committed state, and the Log says the same to the builder of repo-47 (2026-09-29 entry, the paragraph starting "Did not widen check 3 or check 4"). Premise: the fixture leaves only `scripts/seed.mjs` uncommitted, and neither `checkReview` nor `checkTitle` changes its verdict for that path. Measured: handing `testSelectionPaths` to both `checkReview` and `checkTitle` still passes 84 of 84. Remedy, measured: in the same fixture, commit `docs/work/x-1.md` as `DONE_NO_REVIEW` at the base, then leave an uncommitted append to it and an untracked `tools/downloader/NOTES.md`. The test still passes at `7170c8d` (1 of 84 run, 83 skipped), and the widening mutation now fails it with `review` at `bit: 4`. The `title` assertion was not measured on its own, because `review` fails first.
- **low** · `workingTreePaths` leaves out untracked files when `status.showUntrackedFiles=no` is set. The command in `workingTreePaths` (at `7170c8d`, line 1475 of `preflight.mjs`) honours that config, so a throwaway repo carrying it returned `[]` for an untracked `scripts/b.mjs`. `--untracked-files=all` overrides it and returned `?? scripts/b.mjs`. The config is not set in this devcontainer.
- **low** · `workingTreePaths` reports an untracked directory as one collapsed `dir/` entry, never as its files. That is harmless for check 1 in this layout, because `tools/`, `scripts/` and `packages/` are tracked and the collapse stops below them (for example `tools/ledger/`, `tools/planner/api/`, `scripts/newdir/`). In a throwaway repo with no tracked `tools/`, 2 probes collapsed to `tools/` and selected no project at all. It does mean the output is not a list of file paths, and nothing in its docblock says so. The unit test pins the collapsed form as `tools/planner/`. The same `--untracked-files=all` would return files and remove this finding and the one above; that test would then expect `tools/planner/d.ts`.
- **low** · The code composes correctly, but the forward advice in `preflight.mjs` at `7170c8d` (line 1468, "not invent a second path") conflicts with the decided Build of repo-47. `docs/work/repo-47-the-citations-gate-fails-a-code-pr-on-merged-records.md@6bfae8e:292 "Diff it against the"` computes that touched set inside `citations-gate.mjs`, as a tracked-only merge-base-to-worktree diff. `preflight.mjs` already imports `citations-gate.mjs`, so reusing `workingTreePaths` there would make a cycle, and that set includes no untracked files. For check 1, what touched means is legible from the code and the Log. Remedy: state the set exactly (committed range, staged, unstaged, untracked with directories collapsed), and drop the instruction.
- **low** · A failure of `git status` is reported as a bad base. `workingTreePaths` runs inside the try whose catch prints the bad-base message (at `7170c8d`, line 1542 of `preflight.mjs`) with `setup` (64). Measured with an injected `run` that throws on `status`: `exit 64 | --base 6bfae8e... could not be read: fatal: index file corrupt (simulated)`.
- **low** · The docblock line at `7170c8d` (line 1511 of `preflight.mjs`, "ahead of, deliberately, before every commit") restates the claim that the correction from repo-64 gate 3 withdrew from this ticket. The Landing sections commit before they run preflight: `.claude/skills/orchestrate-tickets/roles/builder.md@6bfae8e:156 "## Landing, when your dispatch"` and `.claude/skills/orchestrate-tickets/roles/fixer.md@6bfae8e:61 "preflight exit 0; push"`. Only the pre-report gate list and the fix-round steps run it before a commit.
- **dropped** · The execFileSync call at `scripts/preflight.mjs@6bfae8e:1526 "execFileSync("` passes no `shell: false`. It predates this branch, new code does not reach it, and repo-83 already counts it on `origin/repo-77-spawn-safety-widen`. The new code adds no spawn call site: `workingTreePaths` uses the injected `run`, which in production is `runGit`, and `runGit` passes `shell: false`.
- **dropped** · The test helpers `scripts/test/preflight.test.ts@6bfae8e:703 "function realRun("` and the git helper in `makeRepo` pass no `shell: false`. Both predate this branch, and repo-83 counts them (5 in this file).
- **dropped** · The file header of `preflight.mjs` still says check 1 runs a suite for each tool the diff touches. The wording is loose, but it does not mislead: the docblock of `preflight()` names both path sets.
- **dropped** · A staged copy under `status.renames=copies` came back as the new path alone, with no `C` entry. The copied-from file is unchanged, so there is nothing to select. Not a defect.
- **findings** · code-review at medium returned 10; 6 carried (1 med, 5 low), 4 dropped.
- Path shapes: 15 probes in throwaway repos, run through `workingTreePaths` and `testPlan`. 12 gave the intended paths and plan: clean tree (`[]`), staged rename with `->` in both names (both sides), a space in a name, a newline in a name under a tracked directory, untracked directories in a realistic layout, an untracked file directly under an untracked `tools/`, unstaged and staged deletion, a staged copy, an unstaged rename via `add -N` (both sides), a modified submodule, a detached HEAD, and an unmerged `UU` path. The other 3 are the lows above. One is `showUntrackedFiles=no`. The other 2 (a new file, and an untracked nested repo, each under `tools/planner/` in a repo with no tracked `tools/`) collapsed to `tools/` and selected no project. That is the collapse low in its worst form, and it cannot happen here while `tools/` is tracked.
- Invariants: no shell ✓ (0 new spawn sites). Style ✓ (`npm run check` exit 0). The tests are appended ✓ (0 lines removed; the second `import` sits at the end of the file, as the Log says). The first changed line of `scripts/preflight.mjs` is 1454. Of the 42 unpinned `scripts/preflight.mjs:N` citations under `docs/` and `tools/`, the only 2 past that line are in this Log. `node scripts/citations-gate.mjs --against origin/main` exits 0 (131 enforced, 0 failing), and `node scripts/preflight.mjs --base origin/main` exits 0. Error taxonomy, redaction, SSRF, progress, contracts and Dockerfile are not touched by this diff and were skipped.
- NFR: security ✓ (argument arrays, no new spawn) · performance ✓ (one `git status` per run) · reliability: the lows above · maintainability: the med and the lows above.

### Gate 2

**Gate: PASS** — 2026-09-29 · `7170c8d..21a2196` only (base `6bfae8e`, still the tip of `origin/main`) · code-review at medium over the lines this round touched. Re-issued at round 3: every unpinned coordinate below resolves against `89dd642`, and the words, rows and verdicts are those gated at `21a2196`. One citation became prose naming `21a2196` at round 3, because that round corrected its claim and kept its anchor: the docblock line cited in the first low.

| Gate 1 finding                                                 | Verdict at `21a2196`                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| med: the test did not guard the check 1 split                  | **fixed**. The fixture now also carries an uncommitted append to a done ticket and an untracked tools path: `scripts/test/preflight.test.ts:1982 "<!-- touched -->"`. The widening mutation, re-run with the working-tree paths handed to both `checkReview` and `checkTitle`, gives 1 failed of 87 (review at `bit: 4`). Widening `checkTitle` alone also gives 1 failed of 87 (title at `bit: 8`). |
| low 1: `showUntrackedFiles=no` hid untracked files             | **fixed**. `scripts/preflight.mjs:1486 "const fields = run("` now passes `--untracked-files=all`, and `scripts/test/preflight.test.ts:2014 "sees an untracked file even when"` locks it                                                                                                                                                                                                              |
| low 2: untracked directories collapsed                         | **fixed** by the same flag; `scripts/test/preflight.test.ts:2035 "own file, not the collapsed directory"` locks it. Removing the flag fails 3 of 87 (this test, the low 1 test and the rename test). Re-running the 15 path probes from gate 1 at `21a2196` gives the intended plan for all 15                                                                                                       |
| low 3: forward advice conflicted with repo-47                  | **fixed**. The sentence is deleted, and the docblock now states that untracked files are listed individually                                                                                                                                                                                                                                                                                         |
| low 4: a git status failure was blamed on --base               | **fixed**. It now has its own try, `scripts/preflight.mjs:1574 "the working tree could not be read: "`, with the same exit 64. It is locked by `scripts/test/preflight.test.ts:2081 "toMatch(/the working tree could not be read/)"`, which fails when the old wording is restored. The injected-run probe from gate 1 now reports exit 64 with the message `the working tree could not be read: …`  |
| low 5: docblock overstated when preflight runs before a commit | **fixed**. It now names the pre-report gate list and the two fix-round steps, and says both Landing sections commit first                                                                                                                                                                                                                                                                            |

- **low** · The collapsed form cited as measured is wrong. The docblock line at `21a2196` (line 1470 of `preflight.mjs`, "with no tracked") says that without the flag an untracked `tools/planner/d.ts` under no tracked `tools/` comes back as `tools/planner/`. The Log (gate 1 round entry, collapsed-directories paragraph) says the same. Measured in a throwaway repo with only `seed.txt` committed: plain `git status --porcelain=v1` prints `?? tools/`. The directory collapses at its highest untracked ancestor. Behaviour is unaffected, since the flag is in place and tested. _Amended at `89dd642`: this citation was `scripts/preflight.mjs` line 1470 with the anchor "with no tracked". It is now prose, because round 3 corrected that line to read `tools/` and kept the anchor._
- **low** · Two Log coordinates from the first build entry (2026-09-29, "Built (b)") went stale in this round. Line 1474 and line 1530 of `scripts/preflight.mjs` were `workingTreePaths` and `preflight()`, which now sit at 1485 and 1549; line 1474 now reads `for "something changed under here."` and line 1530 reads `skill prescribes.` CI does not check Log coordinates, so nothing is red.
- **low** · The Log says the count went from 84 to 87 when "the two new lows own tests" were added. Three tests were added, for lows 1, 2 and 4: 84 plus 3 is 87.
- **dropped** · The new docblock says the ticket priced option (a) "after two corrected drafts"; the ticket Log shows four correction rounds. It is a count about history, not about behaviour, and nothing reads it.
- **findings** · code-review at medium over `7170c8d..21a2196` returned 4; 3 carried (3 low), 1 dropped.
- Moved citations: the 14 deletions are 1 line in the test file (the expectation edited in place at line 1932) and 13 in `preflight.mjs` (docblock and try restructure, from line 1462). Of 46 unpinned `scripts/test/preflight.test.ts:N` citations under `docs/` and `tools/`, none is past line 1892. Of 45 unpinned `scripts/preflight.mjs:N` citations, the only ones past line 1458 are 5 in this Log. The new test comment is right that `scripts/test/preflight.test.ts@6bfae8e:764 "expect(caught?.exit).toBe(EXIT.setup)"` is a merged anchor: `scripts/test/preflight.test.ts:2080 "expect(exitBit).toBe(EXIT.setup)"` keeps it distinct.
- Commands at `21a2196`: `npx vitest run scripts/test/preflight.test.ts` exit 0, 87 of 87; `npm run check` exit 0; `node scripts/citations-gate.mjs --against origin/main` exit 0 (131 enforced, 0 failing); `node scripts/preflight.mjs --base origin/main` exit 0.
- NFR: security ✓ (the spawn is still an argument array through `runGit`) · performance ✓ (`-uall` lists every untracked file, and this tree is clean after farm and build) · reliability ✓ · maintainability: the three lows above.

### Gate 3

**Gate: PASS** — 2026-09-29 · `21a2196..89dd642` only, 5 lines changed in place: 1 in `scripts/preflight.mjs`, 4 in this Log (base `6bfae8e`, still the tip of `origin/main`) · code-review at medium over those 5 lines. Every unpinned coordinate below resolves against `89dd642`.

| Gate 2 finding                                      | Verdict at `89dd642`                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| low 1: wrong collapsed form in the docblock and Log | **fixed**. `scripts/preflight.mjs:1470 "with no tracked"` now reads `tools/`. The Log (gate 1 round entry, collapsed-directories paragraph) now reads `tools/` too. Checked against the throwaway repo from gate 2, where `ls-files` lists only `seed.txt`: plain `git status --porcelain=v1` prints `?? tools/` |
| low 2: stale Log coordinates                        | **fixed**. The "Built (b)" entry now cites line 1485 of `scripts/preflight.mjs` for `workingTreePaths` and line 1549 for `preflight()`, and both resolve at `89dd642`                                                                                                                                            |
| low 3: test count in the Log                        | **fixed**. The Log now says three new tests, for lows 1, 2 and 4                                                                                                                                                                                                                                                 |

- **findings** · code-review at medium over `21a2196..89dd642` returned 0; 0 carried, 0 dropped. Each of the 5 changed lines was read against the line it replaced.
- Moved citations: none. All 5 changes are in place, and the diff numstat is 1/1 and 4/4, so no line shifted.
- Commands at `89dd642`: `node scripts/citations-gate.mjs --against origin/main` exit 0 (131 enforced, 0 failing); `node scripts/preflight.mjs --base origin/main` exit 0, with its own `npm test -- --project repo` passing.
- NFR: not applicable. A comment and the Log changed; no behaviour did.

## Log

- 2026-09-27 — Filed from item 12 of the 2026-09-27 batch close-out
  (`repo-64`), which asked for the claim to be reproduced before filing. The
  reproduction above is independent of `dl-53`'s own report and was run on
  `origin/main` at `6988b65`, in a clean worktree, with the probe reverted
  immediately after.
- 2026-09-27 — **Correction from repo-64's gate 1.** Two premises behind the
  first draft's recommendation were false, and both sentences that carried
  them are quoted here verbatim before their correction, per this repo's
  discipline for a claim that reached a record: the first draft's Why said
  check 3 and check 4 read committed state only, "so they already see only
  committed state" — read on its own line, that clause implied check 2 does
  too, and it does not: check 2 reads the working tree unconditionally
  (`fs.readFileSync` on the record path, reproduced: an uncommitted line in
  `scripts/citations.mjs` made `citations-gate.mjs` exit 1, 3 records
  failing). And the first draft's decision section said `roles/builder.md`
  and `roles/fixer.md` "both say to commit and then run it, in that order" —
  backwards: both pages say preflight runs _before_ the commit. Recommendation
  flipped from (a) to (b) accordingly; both sections above are rewritten
  rather than corrected beside the original wording, because neither false
  clause was itself evidence a later reader needs verbatim — the mechanism
  each was wrong about is restated correctly in place of it. Still
  `needs-decision`.
- 2026-09-27 — **Correction from repo-64's gate 2 (finding B).** The
  rewritten Why and decision sections still got the trade-off backwards in
  three places, each fixed below rather than reworded a third time in place:
  (1) the Why said check 1 "reads committed diffs only" without qualifying
  that this is its _test-selection_ logic — the build and the suites
  `checkBuild` runs execute against the working tree exactly like every other
  local command does; only which suites to run is decided from the committed
  diff. (2) The decision section argued (a) "would put check 1 alone out of
  step with check 2," which is false under (a) itself: refusing a dirty tree
  makes every check read the same, single, committed tree, so all five agree
  with each other — the point (a) actually has going for it. (3) (b)'s stated
  downside — "three different trees rather than two" — contradicted the
  Why's own count of today's split (three, stated a few lines above); under (b), check
  1's test selection reads what check 2 already reads, so widening only check
  1 leaves **two** trees (checks 1–2 on the working tree, checks 3–4 on
  committed state), an improvement on today's three-way split, not a
  regression to one.
- 2026-09-27 — **Correction from repo-64's gate 3.** Two more things wrong,
  both narrowing (not reversing) the previous correction:
  1. **(a)'s cost was overstated as skill-wide.** The earlier recommendation
     called (a) a reversal of an order the whole skill prescribes, and the
     earlier option (a) said the same about every round's commit; both
     overreached: only the _fix-round_ steps in `builder.md` (_When you are
     resumed with findings_, step 2) and `fixer.md` (_The work_) run preflight
     before committing. Both pages' own _Landing_ sections already commit
     first and preflight second, so a landing already fits (a) as written.
     Reworded both the option and the recommendation to name the real cost:
     rewriting
     two fix-round steps, not the skill throughout.
  2. **Check 2 does not select from the working tree.** It selects records
     with `git ls-files` — the git index — and only reads their contents
     from disk; an untracked file is invisible to its selection exactly as
     it is to check 1's. Measured by the gate directly: an untracked ticket
     with a failing citation was unseen by `citations-gate.mjs` until
     `git add`ed. Reworded the Why, and noted under (b) that its own
     `git status --porcelain` union, which does include untracked paths,
     would make check 1 broader than check 2 rather than identical to it.

  Both fixes deleted the exact text three of `repo-64`'s gate 3 citations
  quoted as evidence (former lines 104, 83 and 62) — not merely moved, since
  the wrong claims themselves are gone. Per this branch's own `records.md`,
  those citations are not repointed or reworded here; the gate's own record
  carries an evidence declaration for each instead.

- 2026-09-27 — **Correction from the orchestrator**, found by reading
  `builder.md`'s **Gates before you report** section on `main` directly,
  not from a gate round. The previous entry's count of where the opposite
  order is prescribed was still short by one: that section has every
  builder run `preflight.mjs` before reporting, with no line about
  committing first, and it is the section `dl-53`'s builder actually hit —
  this ticket's own reproduction. So (a)'s cost is three places, not two:
  that section, plus the same two fix-round steps already found. Reworded
  option (a) and the recommendation to name the third place and its cost;
  re-checked whether (b) still holds now that (a) costs more, not less —
  it does, more clearly than before, since (b) never touches either role
  page and (a)'s count only grew. Still `needs-decision`.
- 2026-09-28 — **Answered by the owner: (b).** Moved to `ready`, and rated
  `standard` because it was filed unrated: one function in `preflight.mjs`
  plus a test in an existing suite. Re-read against `a084170` first:
  `diffPaths` is still the committed-only `${base}...HEAD` diff at
  `scripts/preflight.mjs:769`, unchanged by `0d455af`, the last commit to
  touch the file.
- 2026-09-29 — **Built (b).** Added `workingTreePaths(repo, run)`
  (`scripts/preflight.mjs:1485`), which parses `git status --porcelain=v1 -z`
  rather than the line form — a staged rename's line form (`R  old -> new`)
  is a string to split on `" -> "`, which a renamed path containing that
  exact substring would break, where `-z` hands each side of a rename back as
  its own NUL-terminated field. `preflight()` (`scripts/preflight.mjs:1549`)
  now computes two path sets rather than one: `diffPaths`, unchanged,
  `${base}...HEAD` only, still handed to check 3 (`checkReview`) and check 4
  (`checkTitle`) per the decision above; and `testSelectionPaths`, the union
  of `diffPaths` with `workingTreePaths`, handed to check 1 (`checkBuild`)
  alone, so an uncommitted edit under `scripts/` or a tool's own paths is
  still selected into the test plan rather than silently skipped. Corrected
  the stale "still `needs-decision`" sentence closing the recommendation
  paragraph above (line 139 before this edit) to point at the owner's answer
  instead, rather than reading as still open beneath it — the dispatch flagged
  it as possibly misleading and it was. `preflight()`'s own docblock was also
  stale independently of this ticket — it said `diffPaths` was "handed to
  whichever checks read the diff — check 1 and check 4," which undercounted
  check 3 (`checkReview`) even before this branch; rewritten along with the
  rest of that docblock, in the function this ticket was already rewriting,
  rather than filed separately.

  Reproduced the ticket's own transcript directly against this fix, in a
  scratch clean worktree, before writing a test for it: with `preflight()`
  reverted one line back to `checkBuild(repo, diffPaths, buildRun)`, a new
  integration test (`scripts/test/preflight.test.ts`, "preflight's check 1
  runs the repo project's suite for an edit still only in the working tree
  (repo-65)") went red — `AssertionError: expected [ 'npm run check' ] to
include 'npm test -- --project repo'` — and passed again once the one line
  was restored to `checkBuild(repo, testSelectionPaths, buildRun)`. Also
  added a pure unit test for `workingTreePaths` itself, against a real
  throwaway repository with a staged rename, an unstaged edit and an
  untracked new directory, both appended to the end of
  `scripts/test/preflight.test.ts` per this branch's append-only rule.
  `npx vitest run scripts/test/preflight.test.ts` → 84 passed (84). `npm run
check` → exit 0.

  **Adding `workingTreePaths` to the existing top-of-file `import` block
  would have moved every citation after it.** Tried first, then measured
  rather than assumed: with `workingTreePaths,` added there,
  `node scripts/citations-gate.mjs --against origin/main` went from clean to
  **5 records, 44 citations, all `moved` by exactly one line** —
  `repo-51-one-preflight-command-before-a-pull-request.md`,
  `repo-64-record-the-2026-09-27-batch.md`,
  `repo-71-a-preflight-test-times-out-on-the-windows-ci-leg.md`,
  `repo-79-preflight-runs-all-checks.md` and
  `repo-82-citations-crlf-and-preflight-lows.md`, every one an
  already-merged `## Review` section citing `scripts/test/preflight.test.ts`
  by bare, unpinned line number. Per this skill's own
  `reference/records.md` ("Whose repoint it is when a _later, unrelated_
  commit moves a line an already-merged record cites"), that repoint would
  have been this branch's to make, coordinate only, in this Log — 44 of
  them. Instead the import moved to a second, later `import` declaration
  placed just above the new unit test at the end of the file, which costs
  nothing upstream of it (an `import` is valid at the top level of a module
  wherever it is written) and left the file's first N lines — and every
  citation into them — untouched: re-ran `citations-gate.mjs` after the
  move, **0 failing**, same as `origin/main` alone. No repoint was needed on
  either the receiving end or the five already-merged tickets above.

  **Did not widen check 3 or check 4** (checked against the Build section's
  own "whichever of (a) or (b) is chosen" instruction and the decision's own
  "no role page changes" line): `checkReview` and `checkTitle` still take
  `diffPaths`, not `testSelectionPaths`, exactly as before this branch. **This
  paragraph originally went on to claim the new integration test's last two
  assertions "pin that down for whoever reads this next" — gate 1 (below)
  measured that false: the fixture's only uncommitted path was
  `scripts/seed.mjs`, which neither check has an opinion about, so both
  assertions passed whether `checkReview`/`checkTitle` read `diffPaths` or
  `testSelectionPaths`. Corrected below, at gate 1: three more fixture lines
  now make the same test fail if either check is ever widened.**

  **Fold-in considered and declined.** The Build section's only other ask —
  "update this ticket's Log with which option was built and why, if the
  answer differs from the recommendation" — is this entry; the answer did not
  differ from the recommendation, so nothing else was free to fold in here.

- 2026-09-29 — **Gate 1 round, at `7170c8d`.** One med, five lows carried (4
  dropped — an execFileSync/test-helper `shell: false` gap that predates this
  branch and repo-83 already counts, loose-but-not-misleading file-header
  wording, and a staged-copy edge case that is not a defect). Reproduced every
  carried finding before fixing it, per this skill's own rule for a handed
  finding.

  **Med, reproduced and fixed.** The claim corrected above, in place: with
  `checkReview`/`checkTitle` handed `testSelectionPaths` instead of
  `diffPaths`, the suite still passed 84 of 84 — the only uncommitted path in
  the fixture, `scripts/seed.mjs`, is not a ticket path and not a `tools/`
  path, so neither check has an opinion about it either way. Fix: three more
  fixture lines in the same test — commit `docs/work/x-1.md` as
  `DONE_NO_REVIEW` at the base (so it is `done`, no `## Review`, and never
  touched between `base` and `HEAD`, so `diffPaths` never carries it), then
  leave an uncommitted append to it plus an untracked `tools/downloader/NOTES.md`.
  Re-measured: reverting `checkReview`/`checkTitle` to `testSelectionPaths`
  now fails the same assertion with `review`'s `bit: 4`, and the test passes
  at `HEAD` with the real code restored. `npx vitest run
scripts/test/preflight.test.ts` → 87 passed (87) at the fix, was 84 before
  the three new lows' own tests (1, 2 and 4) were added.

  **Low, reproduced and fixed — untracked visibility.** A repository with
  `status.showUntrackedFiles=no` set returned `[]` from `workingTreePaths` for
  an untracked file; confirmed directly, plain `git status --porcelain=v1 -z`
  over that fixture returned `""`. Fixed by adding `--untracked-files=all` to
  the spawned command (`scripts/preflight.mjs:1486`), which overrides the
  config; locked by a new test.

  **Low, reproduced and fixed — collapsed untracked directories.** The same
  flag fixes this one too: an untracked file under an untracked directory with
  no tracked ancestor (for example `tools/planner/d.ts` in a repo with no
  tracked `tools/`) came back as the directory alone, `tools/`, not
  the file — confirmed, then confirmed fixed with the flag. Updated the
  existing rename/untracked unit test's expectation from `"tools/planner/"` to
  `"tools/planner/d.ts"` to match, and added a dedicated test for the
  collapse case on its own. Rewrote `workingTreePaths`' own docblock
  (`scripts/preflight.mjs:1462`) to say both of these explicitly, since
  neither was obvious from reading the function.

  **Low, fixed — forward advice conflicted with repo-47's decided Build.**
  The docblock's line telling a later consumer to "union this in the same
  way, not invent a second path" assumed a consumer inside `preflight.mjs`
  itself; repo-47's own decided Build computes its touched set inside
  `citations-gate.mjs`, which `preflight.mjs` already imports, so reusing
  `workingTreePaths` there would be a circular import. Removed the sentence
  rather than reworded it — what "touched" means for check 1 is already
  legible from the code and this Log, which was gate 1's own read on the
  question this ticket's dispatch asked it.

  **Low, reproduced and fixed — a `git status` failure read as a bad
  `--base`.** `workingTreePaths`'s own call used to share the `try` that
  prints `"--base ${base} could not be read"`. Reproduced with an injected
  `run` that throws only on `status`: the message blamed `--base` for a
  failure that had nothing to do with it. Fixed by giving it its own `try`
  (`scripts/preflight.mjs:1569`-`1576`), with its own message,
  `"the working tree could not be read: …"`, same `EXIT.setup` bit — both are
  prerequisite plumbing no check can run without, so the bit stays shared;
  only the wording split. Locked by a new test with the same injected-`run`
  shape.

  **Low, fixed — a stale claim survived its own ticket's earlier
  correction.** The docblock said orchestrate-tickets' builder and fixer
  pages run `preflight.mjs` "ahead of, deliberately, before every commit" —
  restating, inside new code, exactly the overreach repo-64's gate 3 had
  already corrected in this ticket's own decision section: only the
  pre-report gate list and both pages' fix-round steps do that; both pages'
  Landing sections commit first. Reworded to match.

  **Citation collision, found while re-running the gate.** The new
  git-status test's own `expect(caught?.exit).toBe(EXIT.setup)` line was
  character-for-character `scripts/test/preflight.test.ts:764`, a merged
  citation's anchor (`repo-51-one-preflight-command-before-a-pull-request.md`
  line 119), which made that anchor indistinct across two lines. Rewritten to
  read the exit bit through a local first, rather than deleting or
  restructuring the assertion. `node scripts/citations-gate.mjs --against
origin/main` → 131 enforced, 0 failing, both before this collision was
  introduced and after the rewrite.

  `npm run check` → exit 0. `npx vitest run scripts/test/preflight.test.ts` →
  87 passed (87). `node scripts/preflight.mjs --base origin/main` → exit 0.

- 2026-09-29: Landed. The three review records above are gate 3's final set,
  spliced verbatim from `89dd642`, one commit per gate, in order; status set
  to `done` in the first. No section's words or anchors were changed.
