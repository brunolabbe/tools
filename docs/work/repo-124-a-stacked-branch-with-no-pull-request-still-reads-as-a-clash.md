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
- 2026-10-25 — Built on branch `repo-124-stacked-branch-no-clash`, base `558ce370`
  (builder, Sonnet 5.5).
  - **What changed.** `stackPulls` in `scripts/next-id.mjs` is now `stackSources` (it is
    no longer about pull requests; nothing else imported the old name). Its candidates are
    every source with a sha, not `unread`, labelled `PR#…` or `branch/…`. Every rule of
    repo-118 is kept as it was (`isAncestor`, nearest parent, only the parent's paths and
    name ids come off, an unread source is never stacked). **The pruning of Build 3** is
    `mayClash`: a pair is asked about only when the two share a path or an id (worked out
    once per source, not per pair). **Two pull requests are exempt and always probed**:
    there are few of them, and repo-118's label (`PR#625 (stacked on PR#623)`) is printed
    for them even when nothing would clash, so pruning them would have dropped a label
    repo-118 set. Without the pruning every branch is a parent of every descendant, and
    the trunk branch (`branch/trunk`, its diff against itself empty, an ancestor of
    everything) was labelled as the parent of every branch: turning `mayClash` into
    `return true` failed 18 of the 44 tests of `scripts/test/next-id.test.ts`, the old
    pull-request ones included.
  - **Done when 1** (a branch with no pull request, cut from a pull request's head, reports
    no clash for the parent's ticket): `npx vitest run scripts/test/next-id.test.ts`, 44 of
    44 pass, the new case being "a branch with no pull request, cut from a pull request's
    head, reports no clash for it" (fixture of _Why_: `parent-pr` as `PR#623` adding
    `repo-66`, `stacked-no-pr` adding `repo-67`; rows `PR#623 repo-66` and
    `branch/stacked-no-pr (stacked on PR#623) repo-67`, no `clash:` line, `next free` 68).
    Two more cases beside it: a chain of three pull-request-less branches names the
    nearest parent, not the root, and a branch's name ids the parent holds come off while
    one it does not hold stays.
  - **Done when 2** (red when the widening is removed). Commit `8ab3410c` is the green
    state. With the candidate filter in `stackSources` restored to `source.source.startsWith("PR#")`
    alone (the base's), the same file gave `Tests  4 failed | 40 passed (44)`: the
    reproduction (`expected [ { id: 66, sources: [ …(2) ] } ] to deeply equal []`), the
    three-branch chain, the name-ids case and the different-ticket-under-the-parent's-id case.
    Restored with `git checkout 8ab3410c -- scripts/next-id.mjs`, 44 of 44 again.
  - **Done when 3** (the two negatives): "two unrelated branches with no pull request that
    file one id still clash" (`clash: repo-70` between `branch/first-filer` and
    `branch/second-filer`) and "two unrelated branches with no pull request whose names
    share an id still clash" (`branch/repo-70-first-filer`, `branch/repo-70-second-filer`).
    The two pull-request versions of them (repo-118's) are untouched and still pass. A
    third, "a stacked branch with no pull request filing a different ticket under its
    parent's id clashes", is the third half of repo-118's rule on a branch child. And
    "branches that share no path and no id are not probed" asserts zero `merge-base`
    spawns for four branches filing four tickets.
  - **Done when 4**: `concurrency.md`'s paragraph no longer says the gap is open and
    describes the rule (the sentence on the example output labels is widened to mention
    `branch/<name> (stacked on PR#<m>)` too).
  - **Sweep time on this checkout, before and after** (Build 3). The script is
    `time-ab.mts` in the builder's scratch directory: it runs the base's `next-id.mjs`
    (`git show 558ce370:scripts/next-id.mjs`) and the branch's, interleaved, against this
    worktree's real remote and `gh`, 10 runs each. Run 1 saw a different board (a pull
    request opened between the two readings: 22 spawns, then 28), so the figures are runs
    2-10 of each, the same board: **before, 9 runs, median 872 ms (min 618, max 992);
    after, 9 runs, median 754 ms (min 655, max 911)**. Both spawned 28 commands, 12 of them
    `merge-base`, so there is no difference to claim: the spread of one version is wider
    than the gap between them, and this checkout's remote holds 5 branches, all but trunk
    belonging to a pull request, so the widening finds no pull-request-less branch to
    probe. Before the interleaved run, 7 runs of the branch's code alone read 586-896 ms
    on a 5-source board. **What is not measured**: a remote with many pull-request-less
    branches; the cost there is bounded by pruning (zero `merge-base` for unrelated
    branches, per the last test above) and is otherwise one spawn per ordered pair that
    shares a path or id.
  - **Fold-in.** None taken. Renaming `stackPulls` to `stackSources` is within this change;
    repo-118's finished ticket still names `stackPulls`, left alone because a finished
    ticket's edit needs a `## Review` that its file does not carry on this branch (preflight
    fails it) and the name is a historical record there.
