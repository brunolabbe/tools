---
id: repo-12
tool: repo
title: The board shows merged work as ready, and nothing catches it
kind: fix
status: ready
milestone: null
depends_on: []
---

# repo-12 — The board shows merged work as ready

## Why

`npm run status -- --ready` is the board, and on 2026-08-30 it was offering work
that had merged the day before. `pl-29` merged in #102 on 2026-08-29 with
`status: ready` still in its frontmatter, so for a day the board listed a
finished ticket as available. At 14,809 est. tokens it was also the largest
candidate on that board, so an orchestrator reading its intake would have spent
more context on merged work than on any live ticket.

Nothing caught it. The convention — _move a ticket to `done` by editing the
ticket, in the commit that earns it_ — is real and is stated in the root
`CLAUDE.md`, but it is a convention, and this is the second class of board defect
that turned out to need a mechanical check rather than a rule. `repo-6` was the
first: a dangling `depends_on` silently emptied the view, and the fix was a
non-zero exit from `status --json` wired into CI.

**The naive check is wrong, and the wrong version is worse than none.** "A merged
PR names ticket `X`, so `X` should be `done`" produces false positives, because a
pull request routinely _files_ a ticket rather than finishing one. Verified while
writing this: `repo-5` reads `status: ready` and its PR #79 merged — and it is
correct, because #79 was `docs(repo): file the dev-server HOST lift as a decision
(repo-5)`, the commit that created it. `concurrency.md` already documents this
shape from the other direction: commit subjects and PR titles both lie.

So the check has to distinguish _a PR that finished a ticket_ from _a PR that
mentioned one_, and that is the decision this ticket carries.

## Build

1. Decide the signal. Candidates, cheapest first:
   - **The ticket file's own diff.** A PR that finishes `X` almost always edits
     `X`'s file (the Log entry and the `status` change are the same commit). A PR
     that merely files `X` also edits it — but it _creates_ it. `git log
--diff-filter=A` distinguishes creation from modification.
   - **The `## Review` section.** A finished ticket carries a gate record; a
     filed one does not. Stronger signal, and it is already required.
   - Anything reading PR titles is out, for the reason in _Why_.
2. Implement it where `repo-6` put its check — in `scripts/status.mjs`, reachable
   from `status --json`, so CI gets it for free through the exit code rather than
   through a second workflow.
3. Report it the way `danglingDependencies` reports: named by file and by id, on
   stderr beside the view, so a human running `npm run status` sees it too.
4. Add the case to `scripts/test/status.test.ts`, including **the `repo-5` shape**
   as an explicit non-finding — a ticket that is `ready` with a merged PR that
   created it must not be flagged.

## Done when

- `npm run status -- --json` exits non-zero when a ticket is `ready` or
  `in-flight` while its work has demonstrably merged, and names it.
- A ticket that is `ready` and whose only merged PR _created_ its file is **not**
  reported. `repo-5` is the checked-in case.
- The check is proven by making it fail first: a test asserts the non-zero exit
  and the message, not merely that the happy path is quiet.
- `pl-29` needs no fix — it was corrected by hand on 2026-08-30 — but its shape is
  the fixture.

## Log

- Filed 2026-08-30 out of an audit of the orchestrator skill, which measured
  intake cost across the ready board and found `pl-29` on it a day after merging.
  Its status was corrected in the same commit as this ticket; the correction is
  one line and had nothing left to decide, so by `docs/01-TICKETS.md` it was not
  worth a ticket of its own. **The gap that allowed it is**, because which signal
  to check is a real decision with wrong answers.
- `repo-5` was tested against the naive heuristic and is a false positive. It is
  named in _Done when_ so the implementation cannot pass without handling it.
