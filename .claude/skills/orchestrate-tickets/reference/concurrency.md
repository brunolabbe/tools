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

**Your own batch's work is not available to your own builders.** Obvious stated
plainly, and easy to lose after a few hours of shipping: every builder branches
from `origin/main`, so a capability one of your branches just added does not exist
for any of the others until it **merges**. A batch is exactly the situation that
erodes this — you have been reading, relaying and celebrating that work all
session, and it starts to feel landed.

Measured 2026-09-03. One branch implemented a `--section` flag on a repo script and
opened its PR. The orchestrator then told a *different* builder, in a dispatch, to
use that flag — "note it gained a working `--section` on `main` today". It had not:
the PR was open, never merged. The builder ran the tool, got
`usage: node scripts/citations.mjs <ticket-file> [--rev <sha>]`, and reported back
that whatever landed on `main` was not in its base. Confirmed afterwards in one
line — `git show origin/main:scripts/citations.mjs | grep -c section` returns **1**
(the stale usage line that was the defect), against **26** on the branch.

Harmless there, because the builder checked. It would not be harmless in a brief
that told an agent to *rely* on the capability, and it is the same class as the
intake rule at the top of the loop — a ticket reads `ready` until something
merges — arriving from the other direction. **The state of your own batch is
`gh pr list`, not memory.** If a dispatch depends on a sibling branch's work, either
say "this is unmerged, on branch X, do not depend on it" or stack the branch
deliberately and say so.

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

**The next free id is the union of the files on `main`, the files in every open
PR, and the files on every branch the remote has.** Not `git log --all`, not
`ls docs/work/`, not the PR list — each of those misses a different half, and
both halves were hit within one session:

- `git log --all | grep '(pl-N)'` over commit **subjects** missed `pl-29`, because
  a ticket is routinely *filed* in a commit whose subject names a different
  ticket. A builder was dispatched with a colliding id and had to be corrected
  mid-flight.
- A sweep of `main` plus open PR **titles** missed `dl-20` and `dl-21`, for the
  mirror reason: they live in PRs titled for `dl-18` and `dl-19`. A peer session
  reached for `dl-20` on exactly that reasoning.

Commit subjects and PR titles both lie, in opposite directions. **Branch names
are the same kind of claim and lie the same way** — repo-41's reproduction is
`docs/work/repo-39-….md` sitting on a branch called
`repo-37-anchor-planner-review-corpus`, so a sweep of branch *names* would have
answered `repo-39` and been just as wrong. Only the file list is reliable — and
the ticket format keeps that list in **two** roots, `docs/work/` for `repo-` and
`tools/*/docs/work/` for a tool prefix, so a sweep that reads one of them answers
from half the namespace without saying so:

```bash
node scripts/next-id.mjs <prefix>     # repo, dl, pl …
```

It prints **every claimant with its source**, then any id two sources both hold,
then anything it could not read in full, then the first free one:

```
merged repo-29
merged repo-30
PR#174 repo-31
branch/repo-31-a-peer-pushed-this repo-31
clash: repo-31 is claimed by PR#174, branch/repo-31-a-peer-pushed-this
unread: branch wip-not-fetched-here is on origin at 9c1f0ab, which is not in this
  checkout — only its name was read; run `git fetch origin` and re-run for its files
next free: repo-32
```

The maximum alone is what made two real collisions unreadable — `26` with no
source cannot be told from `26` while somebody is already sitting on 27. Above
the merged high-water mark, every id belongs to somebody, and the point is to see
who.

**Read `unread:` as "this answer is short by an unknown amount".** A branch the
remote has but your checkout has not fetched cannot have its files read at all —
measured, `git cat-file` and `git diff` both exit 128 on such a sha — so only its
name is scanned, and a branch named `wip-…` holding a ticket file contributes
nothing. `git fetch origin` and re-run before you rely on the number.

**Expect `branch/…` rows to clash with `merged`, and do not read that as a
defect.** Measured 2026-09-09 on a `pl` sweep: five clash lines, all true, all
from two branches whose work had already squash-merged and which nobody deleted.
A squash merge leaves the branch unrelated to `main` by ancestry, so no cheap
test tells "stale" from "genuinely duplicating a merged id", and the script's own
rule decides it — over-reporting a claim costs one glance, under-reporting one is
the failure the whole page is about. A `branch/…`/`merged` clash usually means
that branch should be deleted.

**It was a fenced snippet on this page until repo-30, and it was wrong the whole
time.** That is the argument for it being a file: the work is mechanical, it must
give the same answer every time, and a fence has nowhere to put a test. Each row
below is a guard that was measured failing before it was written, and is now a
test in `scripts/test/next-id.test.ts` that goes red when the guard is removed —
verified by removing each one in turn, not by assertion.

| take the guard out | what it did |
| --- | --- |
| read only `tools/<tool>/docs/work/` | for a `repo-` prefix: **0 ids against 30**. There is no `tools/repo/`, so the merged half contributed nothing and the answer came from open pull requests alone. On a board whose open PRs are releases it printed nothing at all, exit 0 |
| do not filter the tools root to `docs/work/` | a path that is not a ticket file counts as a claim |
| read a failed command's stdout | a command may write half its output and then die; that partial list is indistinguishable from a correct short one |
| treat a missing command as an ordinary failure | `gh` absent stops being **127** and becomes a generic 1, and the recorded measurements stop meaning anything |
| dedupe across sources, as `sort -u` did | a board holding `repo-99` in two pull requests printed it **once** — the clash is precisely what got erased |
| break ties by input order | two rows holding one id swap between runs |
| swallow a failing `gh pr list` | the merged half alone, exit 0 — which is the original defect exactly |
| drop the advice on a missing default rev | `fatal: Not a valid object name origin/main` and nothing else, which is what every CI runner and every shallow clone gets |
| drop the branch source (repo-41) | a **pushed branch with no pull request** is in neither of the other two sources, so a ticket file already committed and pushed on one is handed out as free. Measured on `main` at `a5e31c7`: `next free: repo-39` while `docs/work/repo-39-….md` was on `repo-37-anchor-planner-review-corpus` |
| read `refs/remotes/origin/*` instead of `ls-remote` | wrong in both directions at once — a plain `git fetch` does not prune, so it keeps branches the remote deleted (**twelve refs against the remote's five**, measured), and it cannot see a branch pushed since your last fetch at all |
| `ls-tree` a branch instead of diffing it | every ticket file the branch *contains* becomes a claim, so `main` itself and every long-lived branch cut from it re-report the whole merged set and clash on every id |
| drop the `unread:` line | a branch the remote has and this checkout has not fetched claims nothing at all if its name carries no id — silently, which is the defect wearing one more costume |

**The codes are each child's own, so which one you see says which command
failed — and on a fresh checkout that is `git`, not `gh`.** A default
`actions/checkout` fetches one commit and creates no remote-tracking refs at
all, so `origin/main` is simply absent and the sweep exits **128** naming the
ref, before `gh` is ever spawned. Same in any shallow clone. It says what to do
(`git fetch origin main`, or `--rev HEAD`) and deliberately does not fall back on
its own, because answering confidently from a different tree is the defect this
whole page is about. Read the exit code as *which child*, never as *what went
wrong* — this branch's own spec asserted 127 and passed five times across two
machines without once reaching `gh`, because every local checkout had the ref
that CI does not.

Two of those are traps rather than oversights, and both caught a repair in
progress. `grep` exits 1 on *no match*, so the shell version's `set -o pipefail`
needed a `|| true` on every grep or an ordinary pull request touching no ticket
file took every later pull request's ids with it. And GNU `sort -s` **disables**
last-resort comparison — a gate reviewer read the missing `-s` as the bug when it
is the reverse, so adding it is what would have made a clash's two rows swap
between runs. Neither survives the port; the tie-break is explicit in the script
now, and the reasoning is in its comments.

**This narrows the race; it cannot close it, and reading it as a lock is the new
way to collide.** Measured in the 2026-09-06/07 incident that produced the table
above: the id that clashed was held on a peer's branch that carried **no commit
yet**, so nothing this reads — not `origin/main`, not any pull request diff — could
show it, and a direct look at the branch showed a possible claimant rather than a
real one. A branch is not a claim until it has a commit, and no command run at
time T sees a claim made at T+1. Which makes the next paragraph load-bearing
rather than polite.

**repo-41 closed one of the four states and left the one that incident was
open.** Say the four out loud, because "the sweep now reads branches" is exactly
the sentence that gets read as a lock:

| where an id can be claimed | seen? |
| --- | --- |
| merged on `origin/main` | yes — `git ls-tree` over both ticket roots |
| a file in an open pull request's diff | yes — `gh pr diff --name-only` |
| a file on a **pushed branch with no pull request** | yes since repo-41 — `git ls-remote --heads` plus a three-dot diff per head, **provided that branch's commit has been fetched here**; if it has not, only its name is read and an `unread:` line says so |
| a peer's **local, unpushed** branch | **no, and no sweep of a remote ever will.** This is the state the 2026-09-06/07 collisions actually were |

So the coordination below is not a belt on top of a working lock. It is the only
thing that covers the fourth row, and the fourth row is the one that has actually
bitten.

**When another session shares the repo, say which ids you hold and ask what it
holds.** A message costs almost nothing (see below) and a collision costs a
rename across a file, a branch and every commit that mentions it.

**The mechanism is `ListAgents`, then `SendMessage`.** `ListAgents` enumerates the
other Claude sessions reachable on this machine and prints the name each one is
addressed by; `SendMessage` with that name reaches it. This page told you to
coordinate for five sessions without naming either, which is most of why it did
not happen — `git worktree list` shows you that a peer *exists*, and only these
two let you ask it anything.

**And do it early, because the file-list rule cannot see a peer's unpushed work.**
The union-of-files command above is still the right way to pick an id, and since
repo-41 it does see a peer's branch **once that branch is pushed and fetched
here**. It is still blind to one that exists only in another session's worktree:
in the third session a peer held `dl-26` — invisible on `main`, invisible in every
PR title, and it would still be invisible today — and it was an id this session
had already handed to a builder. Nothing
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
