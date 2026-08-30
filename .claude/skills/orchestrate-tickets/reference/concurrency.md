# Concurrency

**Reviewers occupy slots.** A cap of four means four agents total — planning around
builders alone means constantly rediscovering the cap.

**The builder/reviewer split is not a planning constant, and it is not the lever.**
Reviews were 60% of token spend in the first session, 23% in the second, 25% in
the third, **30% in the fourth** (604 k of 2.04 M) and **38% in the fifth**
(333 k of 877 k) — the third running 75% builder on the same loop and the same
repo. Five sessions, five different answers.
Do not budget from any of those numbers. **Budget from resume cost**, which is the
thing that actually moves: a resumed builder pays a full context reload priced by
transcript length, not by the work in front of it. Measure your own split as you
go, but expect the answer to be that builders are winning and that the fix is
fewer builder rounds rather than fewer gates. See [sizing.md](sizing.md).

The fourth session is the cleanest read on that, because every one of its four
builders produced a **complete branch on its first round** — nothing needed a
second dispatch to fix a build. It still spent **ten builder invocations on four
tickets** — one ticket took four rounds by itself. Most of the extra ones were gate
relays; the exceptions widened a fix after a gate measured that it could be, and
folded in a sibling ticket. Budget the invocations, not the tickets.

Its per-round costs still rose as the work shrank, exactly as the table below
predicts: one builder went 93 k → 135 k while its second round applied five small
findings, and the documentation branch went 97 k → 177 k → 231 k → 283 k across
four rounds. That one branch cost **787 k against a sibling's 206 k** (per-round
figures rounded; the exact sum is 787.2 k) — more than the other three tickets'
builders combined — and its diffs got smaller every round.
**Rounds, not difficulty, is what a batch pays for.**

**Never run two tickets over one seam.** The most expensive agent in the reference
session (559 k) was a builder that rebased three times onto a sibling branch whose
contract kept moving. Every rebase is a full re-read. Serialise them: it costs
wall-clock and saves tokens, context reloads and a whole class of coordination
message.

**The positive case for doing this at intake, measured.** The fourth session built
the seam map before dispatch — reading each candidate, finding two colliding
pairs, and offering the user only batches that broke them up: **one member of each
pair could still run, the other was held.** The four tickets it ran touched
**fifteen files with zero overlap**, confirmed by diffing the four pull requests
against each other. (It was fourteen until a late round folded a sibling ticket's
one-line deliverable into one of the branches — and the pass that wrote *that*
paragraph left this count at fourteen. Fourth instance of the class on this page,
caught by the gate that read both paragraphs together.) No rebase, no serialisation, no cross-builder
coordination message, and merge order that did not matter. Ten minutes of reading
at intake is the cheapest thing on this page.

Be careful what that proves. Zero overlap is measured; *"the seam map prevented
the rebases"* is a counterfactual, and two things confound it — `main` never moved
during the batch, and no branch merged while another was open, so no branch was
ever in a position to need a rebase. The honest claim is the narrower one: **the
whole class of failure was never available to that batch.** Whether the map is
what did it went untested, exactly as the third session's worktree evidence was
about cost and not about timing.

It is worth naming what the map is made of, because a ticket's header does only
half of it: each ticket's **Packages** line, *plus* what its Build section
actually touches. In that batch the `api/src/server.ts` collision was visible in
two Packages lines; the `vite.config.ts` one was **not** — one of those tickets
carries no Packages line at all and the collision is in the second prose paragraph
of its Why.
Two of the ten tickets `npm run status -- --ready` returned had no Packages line —
three of the twelve that read `status: ready`. A map built from headers alone would
have missed a live collision.

**Never edit a branch while it is being reviewed.** Batch the fixes and send them
after the gate returns, or the reviewer is judging a moving target.

**Messaging a running agent is nearly free; resuming a finished one is not.** A
message to an agent that is still working queues to its next tool round and costs
no context reload. Resuming an agent that has stopped costs a full one —
100–330 k in the second session, *regardless of how small the task is*. So push a
correction the moment you have it rather than banking it for the next relay: when
one builder discovered its mutation harness was broken, warning the other gate
mid-flight cost almost nothing and it folded the check into work it was already
doing. Banking it would have cost a round.

**So is the scratchpad, and a collision there can reach outward.** Every agent in a
session writes to one shared scratch directory, and left to themselves they choose
`test.txt`, `section.md`, `verify.py`, `tail.md`. In the fourth session one builder
passed `gh pr edit --body-file` a path another agent had overwritten in the
meantime, and **a pull request briefly carried a body describing someone else's
ticket.** It was caught on the next command and rewritten, but the lesson is that a
scratch file is not scratch once a `--body-file` or `--body` flag points at it.

Two rules, and the orchestrator has to set them because agents will not:
**namespace every scratch path by the ticket or agent it belongs to** (say so in
the dispatch prompt, and do it in the paths you hand out yourself), and **write the
file you are about to publish immediately before publishing it**, never reusing a
path written earlier in the round. The same applies to the gate records you stage
for a builder to commit — name them for their branch and gate number.

**Ticket ids are an unlocked shared namespace**, and it is wider than your batch:
parallel builders, other sessions on the same machine, and unmerged branches all
draw from it. Assign ids yourself when two builders might file tickets.

**The next free id is the union of the files on `main` and the files in every open
PR.** Not `git log --all`, not `ls docs/work/`, not the PR list — each of those
misses a different half, and both halves were hit within one session:

- `git log --all | grep '(pl-N)'` over commit **subjects** missed `pl-29`, because
  a ticket is routinely *filed* in a commit whose subject names a different
  ticket. A builder was dispatched with a colliding id and had to be corrected
  mid-flight.
- A sweep of `main` plus open PR **titles** missed `dl-20` and `dl-21`, for the
  mirror reason: they live in PRs titled for `dl-18` and `dl-19`. A peer session
  reached for `dl-20` on exactly that reasoning.

Commit subjects and PR titles both lie, in opposite directions. Only the file list
is reliable:

```bash
{ git ls-tree origin/main tools/<tool>/docs/work/ --name-only
  for pr in $(gh pr list --state open --json number --jq '.[].number'); do
    gh pr diff "$pr" --name-only
  done
} | grep -oE '<prefix>-[0-9]+' | sort -u -t- -k2 -n | tail -1
```

**When another session shares the repo, say which ids you hold and ask what it
holds.** A message costs almost nothing (see below) and a collision costs a
rename across a file, a branch and every commit that mentions it.

**And do it early, because the file-list rule cannot see a peer's unmerged work.**
The union-of-files command above is still the right way to pick an id, and it is
still blind to a branch that exists only in another session's worktree: in the
third session a peer held `dl-26` — invisible on `main`, invisible in every PR
title — and it was an id this session had already handed to a builder. Nothing
broke only because that builder did not need it. The message is what finds this,
so send it as soon as `git worktree list` or `gh pr list` shows work that is not
yours.

**Trade seams and constraints, not just ids — and verify what comes back.** That
same exchange was net-positive in both directions: the peer supplied a constraint
that reshaped a follow-up ticket, and this session supplied a measurement showing
the peer's suggested `depends_on` edge would have reddened CI. But a peer's claim
is exactly as unverified as a subagent's. **Relay it marked as unverified and have
the builder check it against the code** — when the peer's branch merged, the
builder read the merged source, re-ran the peer's own mutation tripwire, and
confirmed all three claims before writing any of them into a ticket. That is the
standard; passing a peer's summary along as fact is laundering with an extra hop.

**Overlapping work degrades verification, not just throughput.** The obvious cost
of running four tickets at once is coordination. The real one is that every gate
measures a moving target: a baseline taken an hour ago is a different `main`, a
test count in a report is already wrong, and a citation written into a ticket goes
stale while the ticket is still being written. Two symptoms to expect, both seen —
a reviewer reproducing "543 tests" and getting 545 because a sibling merged, and a
ticket's own Log quoting a figure that stopped being true one commit later. Take
every baseline yourself, in the worktree, at the moment you use it, and write
figures with the commit they belong to.

**Unstack a branch after its parent squash-merges with `--onto`.** A squash merge
rewrites the parent's history into one new commit, so a child branch still carries
the parent's *original* commits — which are now duplicates of content already on
`main`. `git rebase main` replays them and conflicts on every line the squash
touched; `git merge main` keeps them and puts the duplicates in the PR diff. The
one that works is
`git rebase --onto main <the-parent-branch's-old-tip> <child-branch>` — recover
the old tip from the reflog or `gh pr view <parent> --json headRefOid` before the
branch is deleted. **GitHub reports the un-rebased child as "conflicting"**, which
reads like a content problem and is not: it is history shape. Do not send a builder
to resolve those conflicts by hand.
