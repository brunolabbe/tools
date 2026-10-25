---
id: repo-124
tool: repo
title: a branch stacked on an open pull request's head, with no pull request of its own, still reads as a clash
kind: fix
status: done
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

## Review

**Gate: FAIL** — 2026-10-25 · `b9c6c8be..3b3a26ac` (merge base `b9c6c8be`; the branch merged `main`) · Opus 5.5, depth standard

| Done when                                                                                          | Proof                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A branch with no PR, cut from an open PR's head, reports no `clash` for the parent's ticket     | `scripts/test/next-id.test.ts` › "a branch with no pull request, cut from a pull request's head, reports no clash for it" ✓ (it asserts `clashes` is `[]`, the `(stacked on PR#623)` row and `nextFree` 68)                                                     |
| 2. That test goes red when the widened check is removed, shown in the Log                          | proven. The Log shows the removal. Reproduced: candidates cut back to `PR#` only gave `Tests 4 failed \| 40 passed (44)`, the Done when 1 case among the four                                                                                                   |
| 3. Two unrelated sources filing one id still clash; two whose branch names share an id still clash | proven for sources that carry commits: "two unrelated branches with no pull request that file one id still clash", "… whose names share an id still clash", plus repo-118's PR versions ✓. **F1 is a shape of unrelated sources where the second clause fails** |
| 4. `concurrency.md`'s stacked-branch paragraph no longer says the gap is open                      | verified by reading the diff. The "still reads as a clash … follow-up is repo-124" sentence is replaced by the new rule                                                                                                                                         |

- **high** · F1 · Done when 3 depends on it · **A branch with only a name claim, sitting on a commit that `rev` already holds, becomes the stack parent of every later source whose name shares its id, and the clash disappears.** The name floor exists for exactly this branch: one pushed before its ticket file was committed (`branchSources`' docstring). Its sha is an ancestor of every branch cut from `trunk` since, `mayClash` passes on the shared name id, and `unheldName` takes the id off the child. Fixtures (real git): `repo-130-reserve` is pushed empty at the trunk tip and `repo-130-other` is cut from trunk on its own. The base prints `clash: repo-130 is claimed by branch/repo-130-other, branch/repo-130-reserve, …`. At the head, `branch/repo-130-other` drops off the board and that clash is gone. The same happens with `repo-140-early` pushed empty and trunk then moving on, against `PR#710` on `repo-140-late`: the base prints `clash: repo-140 is claimed by PR#710, branch/repo-140-early`, and at the head `PR#710` has no row and there is no clash line. The text is false in the dangerous direction. `concurrency.md` ("Two unrelated sources that file one id, or whose branch names share one, still clash") and the source's own "the expensive error is the one to keep" both promise the opposite. `next free` is unaffected, since the reserve still claims the id; what is lost is the collision line. This is new with the widening: a PR cannot be opened with no commits (premise, not measured), so repo-118's PR-only pass could not reach it. Direction, not tested: do not treat a source as a stack parent when its sha is reachable from `rev`, because it carries no commits of its own.
- **low** · F2 · `nfr:maintainability` · Pruning can drop or misname a stack label, which contradicts "nothing is lost by not probing it" (`stackSources` docstring) and "cut from another branch it names that branch" (`concurrency.md`). The text is false in the safe direction: a label only, and no clash changes. Two cases. (a) In a chain `chain-a`→`chain-b`→`chain-c`, `chain-b` deletes `chain-a`'s ticket and `chain-c` re-adds it. The head prints `branch/chain-c (stacked on branch/chain-a)`, the root, because `chain-b` was pruned; the nearest parent is `chain-b`. (b) A parent whose diff against trunk adds nothing (it only modifies `code.txt`, as a branch or as `PR#700`) gives its child no `(stacked on …)` label. One mechanism, one bullet.
- **low** · F3 · no `Done when` line · Nothing tests repo-118's "two pull requests are always probed and labelled" once pruning exists. Deleting the `PR#`/`PR#` early return in `mayClash` left `Tests 44 passed (44)`. The Log's reason for that exemption ("pruning them would have dropped a label repo-118 set") rests on no test.
- **low** · F4 · no `Done when` line; no live call site · Nothing tests "an unread source is never stacked". Dropping `!source.unread` from `readable` left 44 of 44 passing. So did dropping it and also giving an unfetched branch its `ls-remote` sha. Today the guarantee holds only because no unread source carries a sha.
- **low** · F5 · `nfr:performance` · The PR exemption leaves the one quadratic term this board actually has unpruned. On this clone's remote (7 open PRs, 9 heads) the base and the head both spawn 64 commands, 42 of them `merge-base`, which is 7×6 PR pairs. The two non-PR branches get 0 probes. This is no regression, but Build 3's pruning does not reach the pairs that cost anything today.
- **dropped** · repo-118's done ticket still names `stackPulls`. It is a historical record, `git grep` finds no other reference outside `docs/work`, and the builder's reason for leaving it holds.
- **findings** · the hunt returned 6; 5 carried, 1 dropped.
- NFR: security n/a · performance (above) · reliability (F1) · maintainability (above). Invariants: no shell ✓ (argv arrays through `run`); the rest are n/a to a `scripts/` change.
- CI on `3b3a26ac`: every check passes, the Windows leg included.

### Gate 2

**Gate: PASS** — 2026-10-25 · `3b3a26ac..f4d37301` (the round is `fbba2ab0` and `18c69465`; `f4d37301` is a merge of `main` and touches neither `scripts/next-id.mjs` nor its spec) · Opus 5.5, depth narrow

| Done when                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A branch with no PR, cut from an open PR's head, reports no `clash` for the parent's ticket     | `scripts/test/next-id.test.ts` › "a branch with no pull request, cut from a pull request's head, reports no clash for it" ✓ (52 of 52 at the head)                                                                                                                                                                                                   |
| 2. That test goes red when the widened check is removed, shown in the Log                          | proven. With the candidates cut back to `PR#` only, the result is `Tests 5 failed \| 47 passed (52)`, and the Done when 1 test is among the five. The Log shows the removal                                                                                                                                                                          |
| 3. Two unrelated sources filing one id still clash; two whose branch names share an id still clash | proven, now including F1's shape: "a branch pushed at a commit the rev holds is no stack parent, and its name still clashes" and "a name-only branch behind the rev still clashes with a pull request naming its id" ✓, beside gate 1's tests. Dropping the new `!heldByRev(other)` guard turns exactly these two red (`2 failed \| 50 passed (52)`) |
| 4. `concurrency.md`'s stacked-branch paragraph no longer says the gap is open                      | verified by reading. The round's new sentences are checked under F2 and F5                                                                                                                                                                                                                                                                           |

- **F1 (high): fixed.** I re-ran gate 1's `shapes.mts` at the head. S3 prints `clash: repo-130 is claimed by branch/repo-130-other, branch/repo-130-reserve, branch/repo-131-files`, and S4 prints `clash: repo-140 is claimed by PR#710, branch/repo-140-early`. These are the rows of gate 1's base, with 7 and 3 `merge-base` probes. Three attacks on the fix:
  - **A rev-held parent with real commits** is possible: a branch fast-forwarded into trunk, or merged by a merge commit. Its paths are still only its name (`[["branch/repo-150-prep",["repo-150-prep"]], …]`), because its three-dot diff against `rev` is empty. So "nothing to take off" holds. Its child loses only the `(stacked on …)` label, and the `repo-150` clash is printed at both shas.
  - **A sha equal to `rev`** (S3's reserve, and `branch/trunk`) is held, since `--is-ancestor` is true on equal commits.
  - **An unfetched sha** never reaches `heldByRev`. `isAncestor(other, child)` runs first and throws `exit=128 … fatal: Not a valid commit name`. Called directly, `isAncestor(<unfetched>, origin/trunk)` throws the same exit 128. It does not read as "no".
- **F2 (low): fixed in part.** The new text says "What can be lost is a label, in two ways" (`stackSources` docstring), and its first way is "a parent whose own diff adds nothing gives its child no `(stacked on …)`" (in `concurrency.md` too). Both are false in the safe direction. The loss only ever touches a label, and the real rule is the pruning one: a pair that shares no path and no id is never asked. Two reproductions. (S5b) The parent `repo-170-edit` only edits `code.txt`, and its child `repo-170-more` files `repo-171`. The head prints `branch/repo-170-more (stacked on branch/repo-170-edit) repo-171`: a parent that adds nothing still labels a child whose name shares its id. (S6) The parent `chain-p` adds `repo-66`, and its child `chain-q` deletes that file and files `repo-67`. Both shas print `branch/chain-q repo-67` with no label, and that is neither of the two named ways. The code is unchanged, as the owner settled.
- **F3 (low): fixed.** Plant D (the PR/PR early return in `mayClash` removed) now fails "a pull request stacked on one that adds nothing is still labelled": `1 failed | 51 passed (52)`.
- **F4 (low): fixed.** Plant A (`!source.unread` dropped) and plant B (A, plus an unfetched branch that keeps its `ls-remote` sha) each fail "an unread source is never stacked › an unread child is left as it was" and "… › an unread parent takes nothing off its child": `2 failed | 50 passed (52)`.
- **F5 (low): fixed (text).** On this clone's remote today there are 7 readable PRs and 2 readable branches. Gate 1's head spawns 64 commands, 42 of them `merge-base`. This head spawns 65, with 43 `merge-base`: the 42 PR pairs plus one `heldByRev` for the one live stacked parent (`PR#644 (stacked on PR#641)`). That matches "7 x 6" and "a spawn per stacked parent". The mean `merge-base` time is 4.0–7.0 ms over 5 runs, which matches "about 4 ms". "n open pull requests cost n(n-1)" counts PRs whose head is read; a fork's or an unfetched PR costs none. That is an upper bound, and nothing relies on it.
- **dropped** · A child cut from a reserve branch at `rev`, sharing its id, now clashes with that reserve. Git cannot tell this child from a sibling cut from trunk (S3 is that graph), and the clash is the cheap over-report that `concurrency.md` keeps. Not a defect.
- **dropped** · The rev-held merged parent (S7, S7b) loses its child's label. Its commits are `main`'s, so the child is effectively cut from `main`. Correct behaviour.
- **findings** · the attacks returned 3 beyond the verdicts: 1 carried as F2 fixed in part (two shapes), 2 dropped. Nothing here is a `high`.
- Regression check: `scripts/test/next-id.test.ts` passes 52 of 52. Plant E (`mayClash` always true) is now `3 failed | 49 passed (52)`, against gate 1's 18 of 44, because the guard now excludes `branch/trunk` too, as the Log says. On the real remote, the head's `scripts/next-id.mjs` and `b9c6c8be`'s give byte-identical output for `repo`, `dl`, `lg` and `pl` (`cmp` 0 each), with a live stacked PR on the board.
- NFR: security n/a · performance (F5, measured above) · reliability (F1 fixed) · maintainability (F2). Invariants: no shell ✓ (the new `isAncestor` call goes through `run` with an argv array); the rest are n/a to a `scripts/` change.
- CI on `f4d37301` (`gh pr checks 639`, draft, base `main`): all 8 checks pass, the Windows leg included.

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
- 2026-10-25 — Round 1, after gate 1 at `3b3a26ac` (FAIL, F1 high and four lows). Owner's
  answers the same day: F1's remedy is option 1 of {1: never take a source whose sha is
  reachable from the trunk rev for a stack parent (`git merge-base --is-ancestor
  <parent> <rev>`); 2: require a parent to hold a path beyond its name claim}; the round
  covers F1 plus every low (F2-F5), over the coordinator's F1+F3+F4. (The sweep
  time is Build 3's ask, not a `Done when` line's; the ticket's text is unchanged.)
  - **F1 (high) reproduced, fixed.** `shapes.mts` of the gate run on the head
    `3b3a26ac` reproduced both shapes: S3, `repo-130-reserve` pushed at the trunk tip,
    printed no `branch/repo-130-other` row and no clash; S4, `repo-140-early` behind a
    moved trunk, printed no `PR#710` row and no clash. The base prints `clash: repo-130 is
    claimed by branch/repo-130-other, branch/repo-130-reserve, branch/repo-131-files` and
    `clash: repo-140 is claimed by PR#710, branch/repo-140-early`. `stackSources` now
    takes `rev` (from `collect`) and, for a pair git has already said is an ancestor,
    asks `heldByRev(parent)` (`isAncestor(parent.sha, rev)`, memoized per source) and
    skips the parent if the rev holds it. Asking only after the pair test means a spawn
    per stacked parent and not per source. The gate's `shapes.mts` re-run on the fixed
    tree prints the base's rows and clash lines for S3 and S4 (7 and 3 `merge-base`
    probes). Red: with `&& !heldByRev(other)` removed from the parent filter, `npx vitest
    run scripts/test/next-id.test.ts` gave `Tests  2 failed | 50 passed (52)` — "a
    branch pushed at a commit the rev holds is no stack parent, and its name still
    clashes" (`expected [] to deeply equal [ { id: 130, sources: [ …(2) ] } ]`) and "a
    name-only branch behind the rev still clashes with a pull request naming its id"
    (`expected [] to deeply equal [ { id: 140, … } ]`); restored, 52 of 52. The trunk
    branch itself (sha the rev's tip) is now excluded by the same rule and no longer by
    the path pruning alone.
  - **F2 (low), the text corrected, not the code.** Both cases reproduce
    (`shapes.mts` S1: `branch/chain-c (stacked on branch/chain-a)`, the root, probes 3;
    S2: no label). They are the price of pruning a pair that shares nothing: the label
    depends on ancestry alone, and knowing it is one spawn per pair, which is what the
    pruning removes. The `stackSources` docstring and `concurrency.md` now say that no
    clash is lost but a label can be, and name both cases. Two tests pin the behaviour
    ("a chain whose middle shares nothing with the end names the nearest parent that
    shares something", "a branch parent that adds nothing gives its child no stacked
    label"); with the pruning turned off (`mayClash` returning true) they and the
    zero-probe test fail, `Tests  3 failed | 49 passed (52)`.
  - **F3 (low), reproduced, tested.** The gate's plant D (the PR/PR exemption
    removed) left 44 of 44. New test "a pull request stacked on one that adds nothing is
    still labelled" (`PR#700` only edits `code.txt`, `PR#701` is cut from it): with the
    exemption removed, `Tests  1 failed | 51 passed (52)`, `expected [ 'at origin/trunk',
    'PR#700', …(2) ] to include 'PR#701 (stacked on PR#700)'`.
  - **F4 (low), reproduced, tested.** Plants A and B left 44 of 44 (the gate's `a3.sh`
    hard-codes `git checkout 3b3a26ac`, which would have reverted this round's source, so
    I planted A by hand: `!source.unread` removed). New `describe("an unread source is
    never stacked")` hands `stackSources` sources directly, with a `git` that says `a` is
    an ancestor of `b` and nothing else is: a control (both read, stacked), an unread
    child and an unread parent. With `!source.unread` removed, `Tests  2 failed | 50
    passed (52)`, the unread child and the unread parent.
  - **F5 (low), shown to be out of reach without dropping the label.** On this clone a
    `merge-base --is-ancestor` spawn costs 4.0 ms (40 runs), so the gate's 42 PR-pair
    probes are about 170 ms of a sweep that reads 0.7 to 1.2 s; the rest is `ls-remote`
    and `gh`. The PR exemption is the label repo-118 set, and a label depends on
    ancestry alone, so no test on paths or ids can skip a pair without dropping the
    label for some pair that is stacked. The pruning therefore stays as built, and the
    docstring and `concurrency.md` say n open pull requests cost n(n-1) probes. An option
    this ticket does not take, because Build 2 keeps `merge-base --is-ancestor` as the
    ancestor test: one `git rev-list <child> ^<rev>` per child and a lookup of every
    other sha in that list gives the same answer in n spawns, at the price of
    reading a full history for an unrelated branch.
  - **Sweep spawns, the same board, base against this head** (`time-ab.mts`, 8 runs
    each, 9 sources): 32 spawns and 12 `merge-base` before; 35 and 15 after. The 3 extra
    are `heldByRev` for the stacked parents the board actually has. Medians 946 ms and
    959 ms, the spread (737-1185) wider than the gap.
- 2026-10-25 — Owner's answers at the landing, the rest of what round 1 did not record
  (F1's remedy and the round's scope are in the round 1 entry above). F2: the reading
  is a text fix, not code that produces the label (options: a text fix, the builder's
  reading and the recommendation; make the code produce the label). F5: leave the
  PR/PR term as built (options: leave it, the builder's recommendation; one `git
  rev-list <child> ^<rev>` per child). Gate 2's remainder of F2: fix at the landing
  (options: fix at landing, the recommendation; record unfixed).
- 2026-10-25 — Fixed at landing by owner choice: gate 2, F2 — "a parent whose own diff
  adds nothing gives its child no `(stacked on …)` … false in the safe direction. The
  loss only ever touches a label, and the real rule is the pruning one: a pair that
  shares no path and no id is never asked." The `stackSources` docstring in
  `scripts/next-id.mjs` and the matching sentence in `concurrency.md` now say "a label
  can be lost for any parent and child that share no path and no id" (the gate's
  suggested wording); comments and prose only, no code changed.
  `npx vitest run scripts/test/next-id.test.ts` is 52 of 52 after the edit, as before.
