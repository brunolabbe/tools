---
id: repo-65
tool: repo
title: preflight's diffPaths does not see uncommitted changes, so a touched suite can go unrun
kind: fix
status: needs-decision
milestone: null
depends_on: []
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
checks split three ways, not two: check 1 reads committed diffs only, check 2
reads the working tree unconditionally, and checks 3–4 read committed state.
Check 5 (`checkMergeTree`) is unaffected either way — it compares committed
heads.

## The decision this ticket carries

Two ways to close the gap, and they trade differently:

- **(a) Make `preflight.mjs` refuse to run over a dirty working tree.** Check
  `git status --porcelain` before computing `diffPaths` and fail fast (a new
  `EXIT` bit, or fold into `setup`) naming the uncommitted paths, telling the
  caller to commit first. **Real cost, corrected at gate 1: both role pages
  prescribe the opposite order, and (a) would refuse it.**
  `.claude/skills/orchestrate-tickets/roles/builder.md:116 "Fix, run the
narrowest checks, then preflight, then commit a"` and
  `.claude/skills/orchestrate-tickets/roles/fixer.md:39 "Run the checks your
fixes touch, narrowest first, then"` both say preflight runs **before** the
  commit, every round — so (a) would fail preflight on the ordinary case
  both pages already tell every builder and fixer to follow, not only on a
  caller who skipped a step. It is no longer the smaller change once that is
  named: it would need those two pages rewritten too, to commit first and
  preflight second, before it could ship without contradicting them.
- **(b) Extend `diffPaths` to include the working tree, at least for check
  1's test selection.** Union `git diff --name-only ${base}...HEAD` with
  `git status --porcelain` (staged, unstaged and untracked paths, relative to
  `repo`). Matches what check 2 already does unconditionally and what both
  role pages' own prescribed order needs — preflight run before the commit
  that would otherwise make the change visible. Downside: check 3 and check 4
  still read committed state only (`git show HEAD:...`, the last commit
  subject), so widening only check 1 makes the three checks read three
  different trees rather than two; widening all of them is a larger,
  contract-adjacent change to a script every builder's report leans on.

**Recommendation, corrected at gate 1: (b), reversing the filer's own (a).**
Both premises behind (a) were wrong — the role pages prescribe preflight
_before_ the commit, not after, and check 2 already reads the working tree
unconditionally, so (a) would not "match what checks 2 and 4 already assume";
it would put check 1 alone out of step with check 2 and with the very order
`roles/builder.md` and `roles/fixer.md` tell every dispatch to follow. (b)
brings check 1 into line with check 2's existing behaviour and with that
order, at the cost named above. Still `needs-decision`: the owner may prefer
widening checks 3 and 4 too, over living with three checks reading three
different trees.

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
