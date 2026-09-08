---
id: repo-41
tool: repo
title: the next-id sweep cannot see a pushed branch with no pull request
kind: fix
status: ready
milestone: null
depends_on: []
---

# repo-41 — A pushed, PR-less branch is invisible to `next-id.mjs`

## Why

`scripts/next-id.mjs` draws from exactly two sources: merged files via
`git ls-tree <rev> docs/work/` and `ls-tree -r <rev> tools/`
(`scripts/next-id.mjs:200-201`, default `rev` `origin/main` at `:166`), and
open pull requests via `gh pr list --state open`
(`scripts/next-id.mjs:212`). **A branch that is pushed but carries no open pull
request is neither** — it has not merged, and it has no PR — so a real ticket
file already committed there claims an id the tool reports as free.

This is a **ninth** failure mode in the family
[`.claude/skills/orchestrate-tickets/reference/concurrency.md`](../../.claude/skills/orchestrate-tickets/reference/concurrency.md)
already tracks eight of, each measured by removing its guard and watching the
tool go red, each now a test in `scripts/test/next-id.test.ts` (15 tests
there today; none covers this case). Two of the eight already on that page are
commit subjects and PR titles each lying about an id in a different direction;
this is a third direction nobody had measured — a claim that lies in neither
of the two sources the tool reads at all.

**Reproduction — taken on `main` at `a5e31c7`, 2026-09-08, with open PRs 197
and 164, and it expires the moment a pull request opens on
`repo-37-anchor-planner-review-corpus`:**

```
$ node scripts/next-id.mjs repo
merged repo-1
... (repo-2 through repo-31 elided, all "merged")
PR#197 repo-32
merged repo-32
merged repo-33
merged repo-34
merged repo-35
merged repo-36
merged repo-37
PR#197 repo-38
merged repo-38
clash: repo-32 is claimed by PR#197, merged
clash: repo-38 is claimed by PR#197, merged
next free: repo-39
exit 0

$ git ls-tree --name-only origin/repo-37-anchor-planner-review-corpus docs/work/ | grep repo-39
docs/work/repo-39-the-unanchored-half-of-the-review-corpus.md

$ git rev-parse --short origin/repo-37-anchor-planner-review-corpus
fde65a9
```

The tool says `repo-39` is free while `repo-39` is already a committed, pushed
ticket file on `repo-37-anchor-planner-review-corpus` — invisible to
`next-id.mjs` because that branch has no open pull request yet. (If that
branch's PR has opened by the time this is read, the reproduction above no
longer shows the defect directly — the branch would then be visible through
the PR-diff source — which is itself worth knowing: the window this bug lives
in is exactly "pushed, not yet a PR", and it closes the moment a PR opens on
the offending branch, not when the underlying race is fixed.)

**This is filed rather than fixed because the fix is not obvious, and the
existing page already says why.** `concurrency.md` states the race can be
narrowed but not closed: "no command run at time T sees a claim made at T+1",
and a branch is not a claim until it has a commit. A fix here has to decide
**what counts as a claim**, and the three candidate states are not
interchangeable:

1. A merged file on `origin/main` — already covered.
2. A file in an open pull request's diff — already covered.
3. A file on a **pushed remote branch with no open PR** — this ticket, visible
   to `git ls-remote` / a scoped `ls-tree` over every remote branch, at the
   cost of a much larger sweep than the two above (every remote ref, not just
   `main` and open PR diffs).

**A fourth state stays out of reach regardless of what this ticket builds**: a
peer session's **local, unpushed** branch. That is the case the 2026-09-06/07
incident that produced the eight-row table actually was — a peer holding an id
on a branch with a commit that had never left that session's machine — and no
sweep of the remote can see it. Whoever builds this must say explicitly which
of the three states above the fix covers and which it does not, rather than
implying the race is closed by covering state 3.

## Build

1. **Decide the sweep's shape, and record the choice in this ticket's Log
   before writing code.** State 3 is visible to `git ls-remote` or a scoped
   `ls-tree` over remote branches, but "every remote branch" is not free on a
   repo whose ref list is not small, and "only branches matching a naming
   convention" trades completeness for cost in a way that has to be argued for
   rather than assumed. Whatever is chosen, say in the same breath which of
   the three states in the Why section it reaches and which it still does
   not — the 2026-09-06/07 incident's actual failure (a peer's local, unpushed
   branch) is state 4, and no sweep of the remote reaches it. A fix that
   silently implies the race is closed by covering state 3 is worse than one
   that says plainly it still is not.
2. **Add the chosen source to `collect()` in `scripts/next-id.mjs`, beside
   `merged` and `prs`** — a third row in the `sources` array
   (`scripts/next-id.mjs:215`), so a claim from it prints with its own label
   the same way `PR#197` does today, and a clash between it and either
   existing source reports the same way `clash:` already does.
3. **A guard, measured failing before it is written, added to
   `scripts/test/next-id.test.ts`** the way each of the eight rows in
   `concurrency.md`'s table already is — remove it and watch a specific
   scenario go red, not merely "coverage exists". The reproduction in the Why
   section is the scenario to encode, with a fixture remote rather than a real
   one that will have moved by the time CI runs it.

## Done when

- The reproduction in the Why section, or an equivalent fixture built from it,
  no longer reports `next free` on an id a pushed branch already holds.
- The Log states, in one sentence each, which of the four states (merged,
  open-PR, pushed-no-PR, local-unpushed) this fix covers and which it does
  not — and if any remain uncovered, `concurrency.md` is updated to say so
  rather than left implying the race is closed.
- A new row lands in `scripts/test/next-id.test.ts`, verified failing against
  the guard it tests before the guard existed.

## Log

**2026-09-08 — filed jointly, from pl-38's branch.** Found by the orchestrator
while dispatching this batch; identified as a ninth uncovered mode against
`concurrency.md`'s eight-row table by peer session `tools-d4`, which asked the
orchestrator to have it filed — relayed here as the orchestrator's own
measurement, not independently reproduced by this session beyond checking
that PRs 197 and 164 are in fact currently open and that the cited line
numbers in `scripts/next-id.mjs` and the eight-row table in `concurrency.md`
resolve as stated. The reproduction transcript itself was not re-run, on
explicit instruction — running it again risks no longer showing the defect
the moment `repo-37-anchor-planner-review-corpus` opens a pull request, which
would make a fresh run look like a clean bill of health rather than what it
is: the window closing. Not started.
