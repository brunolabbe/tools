---
id: repo-118
tool: repo
title: next-id labels a ticket on main "merged" while its work's pull request is open, and a stacked branch as a clash
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-118 — next-id labels a ticket on main "merged" while its work's pull request is open, and a stacked branch as a clash

## Why

`scripts/next-id.mjs` prints every claimant of an id with its source, and the source
for a ticket file present at `origin/main` is the word `merged`. A builder reads that
as the opposite of the fact it acts on: a ticket is filed on `main` long before its
work merges, so `merged lg-40` printed while lg-40's pull request #548 was open
(orchestration log, tools-01 item 4, 2026-10-18):

```
$ node scripts/next-id.mjs lg | grep lg-40
merged lg-40
$ gh pr view 548 --json state --jq .state
OPEN
```

Two readings reported in the same period belong with it. The answer is the last
line, `next free:`, after some fifty `merged` rows for a tool with that many
tickets, and nothing says so (lg-66's builder, 2026-10-24). A branch stacked on a
sibling's reports the sibling's new ticket as a `clash` held by both pull requests
(`clash: lg-66 is claimed by PR#623, PR#625`), where #625 only carries #623's
commits.

## Build

1. Rename the source label for a file at the ref from `merged` to `on main` (or
   `at <ref>` when `--ref` names another), in the output and in
   `scripts/test/next-id.test.ts`'s expectations; `concurrency.md`'s sample output
   quotes the label and is updated with it.
2. Print the `next free:` line first or mark it, so the answer is not the last of
   sixty lines; keep the claimant rows.
3. For a `clash` between two pull requests where one branch contains the other's
   head (`git merge-base --is-ancestor`), report the stacked one as `PR#<n> (stacked
on PR#<m>)` and not as a clash.

## Done when

1. `node scripts/next-id.mjs lg` prints no `merged` row; a ticket file on `main`
   reads `on main <id>`, and a test asserts the label.
2. The `next free:` answer is on the first line of output, asserted by a test.
3. A fixture with a branch stacked on another's head reports no `clash` for the
   parent's ticket, asserted by a test that goes red when the ancestor check is
   removed.

## Log

- 2026-10-24 — Filed by the 2026-10-24 review of the orchestration log (tools-01 item 4; the
  stacked-branch and last-line readings relayed by session tools-f6 from lg-66's builder, not
  re-run by the review).
- 2026-10-24 — Owner answers at intake, recorded by the builder before any source change:
  1. **Layout: option (a), answer first.** Line 1 is `next free:`, the notes come straight
     after it, then the claimant rows and clashes. Options offered: (a) answer first, notes
     under, with `render`'s comment reworded to say notes sit immediately _below_ the answer,
     for the same reason; (b) keep the answer last and mark it, rewording Done when 2; (c)
     print it both first and last. Build 2 is therefore the "print first" branch. Recommended
     by the builder's question; chosen by the owner.
  2. **Rating: keep `mechanical`.** Options offered: keep `mechanical`, or re-rate to
     `standard` because of Build 3's ancestor check. Chosen: keep. `difficulty` is not edited.
     Status stays `ready`; this is the owner's answer to a `ready` ticket's open question, not a
     change of state.
- 2026-10-24 — Built on `repo-118-next-id-labels-and-stacked` from `5f9e3c0a`. Commits:
  `2af649ed` (the answers above), `9b1e3f17` (the build), `561ed0c8` (the clash assertion moved
  ahead of the labels, so a red run names the clash).
  - **Build 1, the label.** The source for ticket files at the ref is `on main`, or `at <rev>`
    for another ref. `scripts/test/next-id.test.ts` expectations are relabelled throughout.
    The brief says `--ref`; the flag is `--rev` (`parseArgs`), and the build uses that. Done
    when 1 is `on main repo-40` with no `merged` source, in "a ticket file on main is labelled
    on main, and no row says merged". Live, `node scripts/next-id.mjs lg` on this checkout
    printed 0 `merged` rows and 55 `on main` rows.
  - **Build 2, the answer first.** `render` prints `next free:` on line 1, the notes straight
    under it, then the rows and clashes. Its doc comment is reworded with the same reason.
    Done when 2 is "the next free answer is the first line, and a note sits directly under
    it", a 50-ticket board with one unread note: line 1 `next free: repo-51`, line 2 the unread
    note, line 3 `on main repo-1`, last row `on main repo-50`.
  - **Build 3, stacked.** `stackPulls` runs after the sources are built. A read pull request
    head that `git merge-base --is-ancestor` puts inside another's is labelled `PR#<n> (stacked
on PR#<m>)`, and the parent's paths come off its claim. Done when 3 is "a pull request
    stacked on another's head reports no clash for the parent's ticket", over a real fixture
    remote, and "two unrelated pull requests that file one id still clash", which keeps the
    check from being a rule about paths. **Removal:** `isAncestor` made to return `false`
    without running git, the spec red on the clash:
    `expected [ { id: 66, sources: [ …(2) ] } ] to deeply equal []`, with `PR#623` and `PR#625`
    in the sources. Restored from `9b1e3f17`; `scripts/test/next-id.test.ts` 33 of 33.
  - **Fold-in, the owner-selected `concurrency.md`.** Its paragraph, sample (answer first, the
    new labels, one stacked row), pull-request paragraph, clash paragraph and two table rows
    are reworded. No other page under `.claude/skills/` is edited. The guard table gains a row
    for the ancestor check. Nothing else on the ready list is made free by this work
    (`repo-117` shares no file), so there is no other fold-in.
  - **Two open decisions, answered by the owner through the coordinator (2026-10-24,
    relayed; the coordinator put both to the owner that day).** Each question, its options,
    the choice, and whose recommendation it overrode:
    - **Q1, a stacked branch with no pull request.** Options: keep the pull-request scope and
      note the gap in `concurrency.md` (the coordinator's recommendation, which overrode the
      builder's); file a follow-up ticket (the builder's recommendation); widen Build 3 now.
      **Chosen: file a follow-up ticket**, which is the builder's recommendation, so it
      overrode the coordinator's. Filed as `repo-124`, `depends_on: [repo-118]`, `ready`.
    - **Q2, a stacked child whose branch name carries its parent's id.** Options: leave it and
      record it in `concurrency.md` (the coordinator's and the builder's recommendation, both
      the same); fix it now. **Chosen: fix it now**, which overrode both recommendations.
      Built in `e8216ac6` (`fix(repo): take a stacked child's name-derived ids off its
claim`), which adds `unheldName`. The `concurrency.md` paragraph is updated to say so.
  - **Q2 fix and its removal.** `unheldName` takes the ids a parent holds off a stacked
    child's branch name. An id the parent does not hold stays, restated on its own. Tests:
    "a stacked child whose branch name carries its parent's id reports no clash for it",
    "a stacked child's name keeps the ids its parent does not hold", and "two unrelated pull
    requests whose branch names share an id still clash". With the name rule removed
    (`paths: child.paths.filter(...)` in place of `unheldName(...)`), the first test went red
    on `expected [ { id: 66, sources: [ …(2) ] } ] to deeply equal []` with `PR#623` and
    `PR#625 (stacked on PR#623)` in the sources; the other two stayed green. Restored from
    the fix's sha; `scripts/test/next-id.test.ts` 36 of 36.
  - **Still not covered.** A stacked branch with no pull request is not checked against its
    parent. That is repo-124, filed in this branch. Its reproduction is a fixture, not a live
    case; the output is in repo-124's _Why_.
  - **Blind spot, reported and not filed.** `next-id` cannot see a peer's unpushed worktree:
    per the coordinator, `node scripts/next-id.mjs repo` printed `next free: repo-119` on main
    while worktree `deps-2026-10-24` held repo-119 to repo-123 as files. This builder did not
    check that worktree. The gap is already recorded in `docs/01-TICKETS.md` (the 2026-09-30
    note) and `concurrency.md`, and no open ticket covers it. The coordinator asked for it to
    be reported, not filed.
  - **Live, not a test:** `node scripts/next-id.mjs repo` on this checkout prints
    `clash: repo-93 is claimed by branch/repo-93-sqlite-file-tests-windows-timeout, on main`.
    That is a branch with no pull request, so the stacking check does not reach it. Its cause
    was not investigated.
