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

**What this does not affect.** Check 2 (`checkCitations`), check 3
(`checkReview`) and check 4 (`checkTitle`) either read `git show HEAD:...` or
the branch's last commit directly, so they already see only committed state
and are consistent with committing-then-checking as the intended order; only
check 1's test selection silently degrades when that order is skipped. Check 5
(`checkMergeTree`) is unaffected — it compares committed heads.

## The decision this ticket carries

Two ways to close the gap, and they trade differently:

- **(a) Make `preflight.mjs` refuse to run over a dirty working tree.** Check
  `git status --porcelain` before computing `diffPaths` and fail fast (a new
  `EXIT` bit, or fold into `setup`) naming the uncommitted paths, telling the
  caller to commit first. Cheap, and it turns the silent gap into a loud one
  without changing what "the diff" means anywhere in the script — matches how
  checks 2–4 already read only committed state. Downside: a builder who wants
  to preflight _before_ committing, as a pre-commit sanity pass, cannot.
- **(b) Extend `diffPaths` to include the working tree.** Union
  `git diff --name-only ${base}...HEAD` with `git status --porcelain` (staged,
  unstaged and untracked paths, relative to `repo`). Lets preflight be run
  before or after committing with the same coverage. Downside: check 3 and
  check 4 still read committed state only (`git show HEAD:...`, the last
  commit subject), so the three checks would disagree about what "the branch"
  means unless those two are widened as well — a larger, contract-adjacent
  change to a script every builder's report leans on.

No orchestration-skill page prescribes committing before preflighting in so
many words; `roles/builder.md` and `roles/fixer.md` both say to commit and
then run it, in that order, which (a) would enforce and (b) would merely
tolerate skipping. Recommend (a): it is the smaller change, and it matches
what checks 2 and 4 already assume rather than asking them to catch up.

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
