---
id: repo-124
tool: repo
title: a branch stacked on an open pull request's head, with no pull request of its own, still reads as a clash
kind: fix
status: ready
milestone: null
depends_on: [repo-118]
difficulty: standard
---

# repo-124 — a stacked branch with no pull request still reads as a clash

## Why

repo-118 taught `scripts/next-id.mjs` that a pull request stacked on another open pull
request's head does not clash with its parent: the child is labelled
`PR#<n> (stacked on PR#<m>)` and the parent's files come off its claim. That check
runs only between two **pull requests**. A pushed branch with no pull request of its
own, cut from an open pull request's head, carries the parent's commits in its diff
against `main` exactly as a stacked pull request does, and reads as a clash with the
parent.

Filed as the follow-up to repo-118's decision Q1. The owner chose, on 2026-10-24, to
file this rather than to widen repo-118's scope before it merged. The options were:
keep the pull-request scope and note the gap in `concurrency.md`; file a follow-up
ticket (chosen); widen repo-118's Build 3 now.

**No live case exists.** The reproduction is a fixture, not a board. On branch
`repo-118-next-id-labels-and-stacked` at `e8216ac6`, a fixture with a parent pull
request `PR#623` (head `parent-pr`, adds `repo-66`) and a branch `stacked-no-pr` cut
from that head (adds `repo-67`, no pull request) printed:

```
next free: repo-68
at origin/trunk repo-5
PR#623 repo-66
branch/stacked-no-pr repo-66
branch/stacked-no-pr repo-67
clash: repo-66 is claimed by PR#623, branch/stacked-no-pr
```

The fixture is built by a scratch script (real git for the remote and the branches, a
fake `gh pr list` and `gh pr diff` for the one pull request), and run from the
worktree root with `node --import tsx`. Its shape is the one in
`scripts/test/next-id.test.ts`'s fixture helpers (`ticketRemote`, `withGh`).

## Build

Widen the stacking pass in `scripts/next-id.mjs` (`stackPulls`) from pull requests to
**any two read sources that carry a sha**. This is the option the owner chose to file
as this ticket, and the choice of what to build here is the builder's, within it:

1. A read branch source with no pull request is a candidate child and a candidate
   parent, exactly as a folded pull request is: `branch/<name>` labels become
   `branch/<name> (stacked on PR#<m>)`, and a branch stacked on another branch names
   that branch.
2. Keep every rule repo-118 set. The ancestor test is `git merge-base --is-ancestor`,
   the nearest parent is named, only the paths the parent holds come off the child,
   the child's name's ids the parent holds come off its name (`unheldName`), and an
   unread source (no sha in this checkout) is never stacked.
3. Probing every pair of branches is one `git` spawn per pair. Prune before probing:
   only probe a pair whose paths share at least one path or whose names share an id,
   since only those can clash. Measure the sweep's time on this checkout before and
   after, and say what it cost.
4. Keep the two negative cases green: two unrelated sources that file one id still
   clash, and two unrelated sources whose names share an id still clash.
5. Update `concurrency.md`'s paragraph that says a stacked branch with no pull request
   "still reads as a clash" to describe the new rule.

Not built, and recorded here so it is not re-asked: keeping the pull-request scope and
noting the gap in `concurrency.md` was the alternative the coordinator recommended
first; the owner chose this ticket instead.

## Done when

1. A branch with no pull request, cut from an open pull request's head and carrying
   that pull request's ticket in its diff, reports no `clash` for the parent's
   ticket, asserted by a test in `scripts/test/next-id.test.ts` built on the
   reproduction's fixture.
2. That test goes red when the widened check is removed, with the removal shown in
   the Log.
3. Two unrelated sources that file one id still clash, and two unrelated sources whose
   branch names share an id still clash, each asserted by a test.
4. `concurrency.md`'s stacked-branch paragraph no longer says the gap is open.

## Log

- 2026-10-24 — Filed by repo-118's builder (branch `repo-118-next-id-labels-and-stacked`,
  head `e8216ac6` when the fixture was run) as the follow-up to repo-118's decision Q1, as
  set out under _Why_. The reproduction is a fixture and no live case exists; the output
  is under _Why_.
