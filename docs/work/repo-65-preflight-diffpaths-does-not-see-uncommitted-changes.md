---
id: repo-65
tool: repo
title: preflight's diffPaths does not see uncommitted changes, so a touched suite can go unrun
kind: fix
status: ready
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
its records from the git index (`git ls-files`, `scripts/citations-gate.mjs:489`)
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
  (`scripts/preflight.mjs:1474`), which parses `git status --porcelain=v1 -z`
  rather than the line form — a staged rename's line form (`R  old -> new`)
  is a string to split on `" -> "`, which a renamed path containing that
  exact substring would break, where `-z` hands each side of a rename back as
  its own NUL-terminated field. `preflight()` (`scripts/preflight.mjs:1530`)
  now computes two path sets rather than one: `diffPaths`, unchanged,
  `${base}...HEAD` only, still handed to check 3 (`checkReview`) and check 4
  (`checkTitle`) per the decision above; and `testSelectionPaths`, the union
  of `diffPaths` with `workingTreePaths`, handed to check 1 (`checkBuild`)
  alone, so an uncommitted edit under `scripts/` or a tool's own paths is
  still selected into the test plan rather than silently skipped. Corrected
  the stale "still `needs-decision`" sentence closing the recommendation
  paragraph above (line 139 before this edit) to point at the owner's answer
  instead, rather than reading as still open beneath it — the dispatch flagged
  it as possibly misleading and it was.

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
  `diffPaths`, not `testSelectionPaths`, exactly as before this branch — the
  new integration test's last two assertions (`review` and `title` both
  `{ ok: true, bit: 0 }` over the same uncommitted edit) pin that down for
  whoever reads this next, repo-47's builder named among them.

  **Fold-in considered and declined.** The Build section's only other ask —
  "update this ticket's Log with which option was built and why, if the
  answer differs from the recommendation" — is this entry; the answer did not
  differ from the recommendation, so nothing else was free to fold in here.
