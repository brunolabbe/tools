---
id: repo-12
tool: repo
title: The board shows merged work as ready, and nothing catches it
kind: fix
status: done
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

**2026-08-30 — built. The signal is the `## Review` section, and the check is
narrower than this brief asked for.** `scripts/status.mjs` gained
`hasGateRecord` and `reviewedButReady` beside `danglingDependencies`, wired into
`main`'s one `problems` list — so `--json` exits 1 through the exit code
`ci.yml`'s `check` job already reads, every other view prints the warning on
stderr beside the table, and `--json`'s payload carries it as
`kind: "reviewed-but-ready"`. `readTickets` now returns one field read from the
body rather than the frontmatter, `reviewed`. Eleven cases in
`scripts/test/status.test.ts`, and each was proven by mutation rather than by a
green run: reverting the check to `OPEN.has(status)`, removing the fence
handling, and dropping the wiring out of `main` each turn exactly the cases
named for them red.

**Step 1's decision, with the measurements.** Over the 11 open tickets on `main`
at `1d420b7`:

- _The ticket file's git history_ (`--diff-filter=A`) flags `dl-16` and `pl-2`:
  two false positives in 11, both genuinely open, both edited after creation by
  another ticket's pull request — which is the convention that a shape-level
  review finding lands on the sibling tickets in the same PR as the fix, not an
  accident. It is also blind exactly where it must run: `ci.yml`'s `check` job
  has no `fetch-depth`, so it gets a depth-1 checkout with no history, and a
  history-based check would pass there by seeing nothing. **The two candidate
  signals in step 1 therefore disagree on real tickets, and the cheaper one is
  the wrong one.**
- _The `## Review` section_ flags none of the 11, and catches `pl-29` at its
  merge commit `98b5e61` — reproduced by extracting that tree with `git archive`
  and running the CLI at `--root`. It needs no git, no network and no `gh`.
  It would also have gone red on #102's own branch, before the merge.

**Where the brief was wrong: `ready` or `in-flight`.** _Done when_ asks for both,
and the wider rule has a false positive the brief did not know about. Running the
check over the whole board at `98b5e61` returned **two** hits, not one: `pl-29`,
and `pl-28`, which had landed as a partial in #74 with two gate records that each
wrote "**`status` stays `ready`**" and sat on the ready board for seven days
until #104 closed it. That makes `pl-28` a third instance of this defect — but it
also means that flagging `in-flight` would leave a landed partial no correct
status at all, since `done` was a lie while two of its acceptance rows read
`unproven`. So the check fires on `ready` only. That is the claim nothing
disputes — a gate record means the work was picked up, and `ready` means nobody
has — and it is where the harm is, because `--ready` is the board and never
offers an `in-flight` ticket. **Note for the reviewer: this is a deliberate
miss against _Done when_'s first line, not an oversight.**

**What it cannot see.** A ticket can finish without a gate record — `pl-16` is
`done` and carries none, and `pl-5`'s Log records that finding being raised and
dropped — so the check is a floor, not a proof, and the inverse (`done` implies a
gate record) would be false today. Nothing here reads a pull request, merged or
otherwise; "demonstrably merged" is inferred from the ticket's own body, which is
what makes it work in a shallow CI checkout.

**Folded in rather than deferred:** `docs/01-TICKETS.md` said a dangling
`depends_on` was "the one exception" to the strict parser, which this change
falsifies — it is now a two-item list naming both checks. `ci.yml`'s comment
listing what its `--json` step catches gained the new case, and the reason a
history-based check could not have lived there.

**An open decision, for whoever can ask.** Should a ticket that lands as a
partial be allowed to sit at `ready`? Two gates said yes on `pl-28`; this check
says no and points at `in-flight`. If the answer is that `ready` must stay legal
for a partial, the exemption needs somewhere to live that is not prose — a
frontmatter field is the only candidate, and that is a ticket-format change, so
it was not made here.

**Gates:** `npm run check` and the full `npm test` pass; `node scripts/status.mjs
--json` over the real board exits 0. No container, e2e or CI run was exercised —
the depth-1 claim about `ci.yml` is read off the workflow file, not observed in
Actions.
