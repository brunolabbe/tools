---
name: orchestrate-tickets
description: Run several tickets to merged pull requests at once by dispatching builder and reviewer subagents, gating each ticket before it opens a PR. Use when asked to work through a batch of ready tickets, to "keep the board moving", or to act as orchestrator over parallel work — "pick up the ready tickets", "run dl-15 and pl-25 together", "continue working, dispatch agents". Not for a single ticket you can build yourself.
---

# Orchestrating a batch of tickets

You dispatch, you gate, you decide. **You do not build and you do not review.** Your
context is the one thing that must survive the whole batch, so it holds the board
and nothing else.

This skill is written from five sessions, each applying the last one's lessons:
~4 M subagent tokens across 21 agents and 16 gates; then ~2.7 M across 17
invocations and 6 gates; then 2.86 M across 12 agents and 18 invocations, five
tickets to five merged pull requests, 8 gates and 8 that returned landable
findings; then **2.04 M across 10 agents and 16 invocations, four tickets to four
pull requests, 6 gates and 6 that returned findings, every builder producing a
complete branch on its first round, and no branch ever needing a rebase**; then
**877 k across 6 agents and 12 dispatches-or-messages, three tickets to three
pull requests,
3 gates, again every builder complete on its first round and no rebase — and a
batch whose whole output was 266 non-documentation lines — 104 of them `src/`,
the rest tests, a fixture and one config line — against **1,113 of
documentation**. That 4.2:1 is the fifth session's real lesson and the reason two
of its entries below are about cost rather than correctness.** Most of
what follows is the cost of learning something the expensive way; numbers are quoted where they change a decision, and where the
sessions disagree all are given, because the disagreement is usually the point.

## The loop

1. **Intake** — `npm run status -- --ready` for what is unblocked, `gh pr list` for
   what is already in review. A ticket file says `ready` until something merges, so
   the PR list comes first or work gets built twice. Two more things, both cheap
   and both learned by skipping them:
   - **Read each candidate's opening section, not just its status line.** A ticket
     in the second session read `status: ready` while its own first section was
     titled "Read this before picking it up" and said the work must not be pulled
     forward. `--ready` is a projection of frontmatter, and frontmatter can
     disagree with the page it sits on.
   - **`git fetch` again immediately before dispatch.** `main` moved between the
     status call and the dispatch, landing a commit that deleted machinery three
     builder prompts went on to reference. Harmless that time; it need not be.
2. **Ask which** — never pick the batch yourself. See _Decisions_.
3. **Dispatch builders**, one subagent each, `isolation: "worktree"`.
4. **Gate** each finished branch with a reviewer subagent. Builders never open a PR
   before a gate.
5. **Relay findings** to the builder as one batched message.
6. **Repeat 4–5** until the gate passes or the findings are cosmetic.
7. **Builder opens the PR**, commits the gate record, posts the reviewer's report to
   the PR thread.
8. **Remove the reviewer's worktree** once its record is pushed — in the ticket and
   on the PR thread. **Hold the builder's until the ticket is finished**, because
   steps 9 and 4-above may still need that agent. See _Worktree hygiene_.
9. **Check the merge landed what it was supposed to.** Not polling — one look,
   after the fact. See _After a merge_.

**The PR is not the end of gating; the merge is.** Step 7 reads as a terminus and
it is not one. A branch whose fixes are themselves risky — a correction pass over
numbers, a rewrite of a claim a gate just falsified — can open its PR under
conditional ship authority *and* take one narrow gate afterwards, scoped to the
corrections alone. That ordering costs one cheap gate instead of a whole builder
round, and gives up no gating at all, because you control the merge. The fourth
session did exactly this on its documentation branch and the post-PR gate found a
real defect the correction pass had introduced. Use it when the branch has already
demonstrated that its corrections can be wrong; do not make it the default.

## Concurrency

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
fewer builder rounds rather than fewer gates. See _Size the process to the ticket_.

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

## Size the process to the ticket

The loop above is one loop. Running it identically over a one-line frontmatter fix
and a seventeen-file change touching `packages/core` is the single largest source
of waste, and it is easy to do without noticing, because each individual round
looks reasonable.

**Builder round-trips cost more than gates.** A second-session docs ticket spent
449 k across five invocations on a 123-line change — 312 k of it three builder
rounds, two applying about four lines of markdown each — while all six of its
gates returned landable findings. A resumed builder pays a full context reload,
and its cost is flat in the work done and rising with transcript length:

| round | tool calls | tokens |
|---|---|---|
| 1 | 37 | 100 k |
| 2 | 10 | 94 k |
| 3 | 11 | **118 k** |

Eleven tool calls cost more than thirty-seven. The third session reproduced this
at four times the scale on its widest branch — 100 calls → 238 k, then **29 calls
→ 255 k**, then 50 calls → 290 k. Cost rises as the work shrinks. That branch cost
978 k against a sibling's 322 k, and the difference was rounds, not difficulty. So:

- **End every relay with conditional ship authority.** "Apply these, and **if**
  `npm run check` is green, the suite is green and the diff scope is unchanged,
  open the PR yourself — do not check back. If any condition fails, stop and tell
  me." This removes an entire round and gives up no gating, because the conditions
  are mechanical. It worked on three branches in the second session and four of
  five in the third. **Know when you cannot give it:** a FAIL whose fix is real
  work needs a real check, and that branch will cost you a round no matter how the
  relay is written. Budget for it rather than trying to write around it.
- **Batch every finding from a gate into one relay.** Two relays of one finding
  each cost double for the same result.
- **Choose the gate count from what the branch risks escaping** — a shared
  package, a contract, an untested path, a security claim — not from a rule and
  not uniformly. A self-generated docs ticket deserves one builder and at most one
  gate. See _Do not cap the gate count_ for the other half of this: the economy is
  in scope, never in refusing a gate that has something to check.
- **Point every verification run at the narrowest thing that can fail.** This is
  the largest single cost in a batch and the page said nothing about it for five
  sessions. Measured on this repo, warm: one spec file **2 s**, the directory that
  contains it **41 s**, the tool's whole project **~50 s**, plus **12 s** to rebuild.
  A five-mutation sweep is `5 x (12 + 2)` or `5 x (12 + 41)` — **1.2 minutes or
  4.4 minutes for identical evidence**, and the fifth session paid the second
  figure across six agents. A mutation to one regex cannot break a spec that never
  imports it, so run the spec, then run the project **once** at the end. Say it in
  the prompt; agents reach for the directory by default. The 20x is this repo's
  suites and will not transfer as a constant — the *shape* does, so have the agent
  measure both once and use the number it gets.
- **Some work needs no gate at all.** Filing a ticket that *records a defect* is
  the clear case: require the builder to reproduce the defect before writing it up,
  and the reproduction **is** the verification. In the second session that builder
  found more than it was briefed, corrected the orchestrator, and cost 111 k with
  no reviewer at all.

### Fold it in, or file it

A ticket whose entire deliverable is **one line** is not a ticket. The fourth
session shipped a 58-line brief whose Build section was "append one `_Outcome:_`
line to a sibling ticket" — and the branch that filed it was the branch that had
just *measured* the annotation to be free. It proved the thing was affordable and
then declined to pay for it.

Nobody was careless. The builder was told "implement the Build section, do not
widen or narrow", and it obeyed. **The defect is the orchestrator's**, in two
places: the dispatch rule had no exception for work the branch itself had just
made free, and the resulting deferral was never surfaced as a decision.

**The arithmetic is not close.** Folding it in costs one resume of an agent that
is alive and holds the whole context — and, if the PR is still open, not even a
new pull request. Filing it costs a future intake slot, a full builder dispatch, a
gate, a PR and a merge, all to move one line. Call it five to ten times the price,
paid later, by someone with none of the context.

Three tells that you are looking at this, all cheap to check at relay time:

- **The Build section's output is a single line, or a single frontmatter field.**
- **The blocking reason is already gone** — most sharply when *this* branch is what
  removed it. A ticket that says "X is now affordable because we just measured Y"
  is a ticket that should have spent Y.
- **The ticket's own Why explains why it was not folded in.** In the reference
  case: "left as its own ticket rather than folded in because the brief did not ask
  for it." That sentence is the builder telling you it could have. Read those; they
  are where deferrals become visible, which is exactly why the builder prompt is
  told to write them.

**When you do fold it in, do not delete the ticket if it has already been
committed.** Mark it `done` in the commit that earns it — the convention this repo
already documents — and rewrite its Log to say it was folded in and why that was
possible. The brief usually records *why* the work became affordable, which is not
derivable from a one-line diff; and on a branch where gate records have already
verified that ticket's id, frontmatter and `depends_on`, deleting the file dangles
verified content across every one of them.

**The inverse still holds**, so do not over-read this: a ticket that records a
*defect* is worth filing even when the fix looks small, because the reproduction is
the deliverable and the fix may not be. The test is not size, it is whether
anything is left to decide.

## Worktree hygiene

Worktrees auto-clean only when unchanged. A reviewer that writes into its worktree
leaves it dirty, so it never cleans. The reference session leaked **7.0 GB across
20 worktrees**.

Two rules, both required:

- Reviewers **return** their section as text; they never write it to a file.
- Remove each worktree once its ticket is **finished** — merged, or abandoned —
  not when its PR opens: `git worktree remove --force <path>`, then
  `git worktree prune`, then delete the `review-*` branch.

Audit with `git worktree list` and `du -sh .claude/worktrees` when a batch feels
long. Before removing, check `git status --porcelain` and `git log @{u}..` in each.

**Branch refs leak even when the directories do not.** Removing a worktree leaves
its `worktree-agent-*` branch behind, and they accumulate across sessions — the
second session found **51** of them while its own disk usage was back at the 4 KB
baseline. Sweep them at the end of a batch, but **check each for unmerged commits
first** and delete only those with none:

```bash
for b in $(git branch --list 'worktree-*' | sed 's/^[* ]*//'); do
  [ "$(git log --oneline origin/main.."$b" | wc -l)" -eq 0 ] && git branch -D "$b"
done
```

Of those 51, seven carried real commits — including one belonging to a *live
worktree in another session*, which `git branch -D` refuses to delete, so the
guard is belt-and-braces rather than the only protection. Never blanket-delete by
name pattern.

**Removing a worktree also makes its agent unresumable**, which is why the second
rule waits for the ticket rather than the PR. A follow-up sent to a builder whose
worktree is gone is refused — *its worktree no longer exists* — and the only way
forward is a fresh agent with the whole context rebuilt by hand, which costs far
more than the disk did. An open PR still takes review comments, a rebase and
follow-ups, and every one of those wants the agent that wrote it. Removing earlier
is sometimes the right trade for 7 GB; make it a choice rather than discover it an
hour later. The third session held every builder worktree to merge and paid almost nothing for it — 105 MB peak across a five-ticket batch, against the 7 GB above, because reviewers returned text and finished tickets were swept promptly. It is worth being precise that this is evidence about **cost, not about timing**: every branch in that batch opened its PR in its final builder round, so none was ever resumed afterwards and the trade was never actually tested. Holding to merge is cheap insurance; that batch did not have to collect on it.

**Split the rule by role: hold builders, retire reviewers early.** The unresumable
cost is real for a *builder*, whose branch may still need a rebase or a follow-up.
It is near zero for a *reviewer* the moment its record is safe, and the test for
that is one condition, not three: **the record is pushed** — in the ticket commit
and on the PR thread — somewhere you do not have to be alive to recover it. The
copy you saved when it returned is redundancy, and the least durable of the three.
At that point the worktree holds nothing you cannot get back, and reviewer trees
are the ones that never auto-clean, because reviewing dirties them.

The fourth session ran this deliberately: it retired each reviewer tree as its
record landed and held all four builder trees, going 133 MB → 61 MB mid-batch with
no loss of optionality. (Held *to merge* is the intent; nothing had merged when
that was written, so like the third session's figure this is evidence about cost,
not about whether holding ever paid.) It kept exactly one reviewer alive past its
report — the one whose builder had been told to *reproduce* a finding before
accepting it, because a builder that comes back "this does not reproduce" is a
question only that reviewer can answer. That is the test: **hold a reviewer only
while a specific open question could go back to it.**

Before removing any of them, confirm what the tree actually holds. A reviewer that
checked out the builder's branch shows commits ahead of `main` — those are the
*builder's*, already pushed, not review work. One command settles it:
`git merge-base --is-ancestor "$(git -C "$w" rev-parse HEAD)" origin/<builder-branch>`.
Sweep the leftover `worktree-agent-*` ref at the same time; removal leaves it
behind, and that is the leak that reached 51 stale branches in the second session.

### When every agent dies at once

A session usage limit killed all five in-flight gates simultaneously in the fourth
session, and the fifth ended mid-batch on a deliberate machine shutdown. It is worth planning for because the recovery is cheap and the wrong
recovery is expensive.

- **A snapshot of a live worktree is a moment, not a state — and it goes stale
  while you write it.** Facing a shutdown, the fifth session's orchestrator captured
  each builder's uncommitted diff into a handover file. Both were wrong within
  minutes: one builder was recorded with **one** dirty file and had **three**,
  because it kept working after the capture; the other was written up as "assume
  the work is lost" when it was in fact complete. **The worktree is the artefact;
  a transcription of it is a second thing to keep true.** So capture *pointers* —
  the worktree path, the branch, the pushed tip — and re-read the tree on the way
  back in. Copy content out only for what dies with the session and exists nowhere
  else: a reviewer's returned report is the clear case, an uncommitted diff is not.
- **Prefer pushing over describing.** The best thing that happened under that
  shutdown was a builder told to secure its work choosing to commit and push the
  **gate record first**, ahead of its own half-finished code fixes, under a `docs`
  type so it released nothing. That is the right instinct to name in the message:
  *push the thing that exists nowhere else; the code you can rewrite.*
- **Check for damage before resuming anything.** Agents die at an arbitrary
  instant, so one may have been mid-mutation with a source file still mutated, or
  one step from pushing a scratch branch. Confirm the shared checkout is clean,
  every builder branch is intact at its reported tip, and nothing stray reached
  `origin` (`git ls-remote --heads origin`). All four checks were clean that time;
  the point is that they are four commands and you do not get to assume.
- **Resume by message, do not re-dispatch.** A message resumes the agent from its
  own transcript and keeps its partial work — one gate was on its final confirming
  run, another had already reached "found something". Re-dispatching pays a fresh
  context reload and throws that away.
- **Every resume must re-establish the positive control.** This is the part that
  matters: a gate that died mid-mutation may be sitting on a mutated tree, so any
  result it was holding is worthless. Say it explicitly — *a result carried across
  an interruption is not evidence* — and have it restore to the branch tip and
  re-run the control before continuing.
- **Tighten the destructive step on the way back in.** The gate authorised to push
  a scratch branch was told to delete it as its *immediate next action* after
  capturing output rather than at the end of its review, so a second interruption
  could not strand it on `origin`.

### Give a new worktree its dependencies without installing them

A fresh worktree has no `node_modules`, so every agent pays `npm install` plus
`npm run build` before it can read a test result — minutes each, and in the
reference session two dozen agents each paid it. A **selective symlink farm**
built from the shared checkout's `node_modules` removes the install half in well
under a second and costs tens of kilobytes instead of hundreds of megabytes. The
build still has to run.

The shape, and the whole of it is *why*:

- **Symlink each third-party entry individually**, absolute, into the worktree's
  own real `node_modules` directory.
- **Include the dotfiles** — `.bin` above all. A `*` glob silently misses it and
  every binary the scripts call disappears with it; enumerate with `ls -A`.
- **But create the workspace scopes — `@planner`, `@downloader`, `@webtools` —
  as real directories**, re-creating each inner link with its *original relative
  target*.

That last rule is the load-bearing one. npm writes workspace links relatively
(`@planner/api -> ../../tools/planner/api`), and a relative link resolves from
where it **physically** lives. Inside a real directory in the worktree it lands
on the worktree's own `tools/planner/api`, which is the point. Hence the first
trap:

- **Do not symlink `node_modules` wholesale.** One command, silently wrong: the
  worktree's `node_modules` *is* the shared one, so every workspace link resolves
  into the **shared checkout** — an agent editing a contract then typechecks
  against the other tree's copy of it, and the suite goes green on the wrong code.
  Verified: under a wholesale link `@planner/api` resolves to
  `/workspaces/tools/tools/planner/api` rather than into the worktree.
- **Hard links are not the escape either.** In this container `node_modules` is
  its own mount, so `cp -al` fails on the first file with
  `Invalid cross-device link`. Check with `df` before assuming otherwise; the
  mount layout is specific to this environment, while the relative-link reasoning
  above is not.

Verify a farm the same way rather than trusting it: resolve one workspace link
with `readlink -f` and confirm it points inside the worktree, then run one real
suite there. A farm that is wrong is wrong *quietly*, which is the only reason it
needs a check at all.

## Dispatching a builder

Every builder prompt carries:

- **Setup**: `git fetch origin && git checkout -B <branch> origin/main` — say the
  base explicitly, especially for a stacked branch. Then `npm install`, then
  **`npm run build`** (without built `dist` most suites fail with
  `packageEntryFailure`, which reads as test failure and is not).
- **Read first**: root `CLAUDE.md`, the tool's `CLAUDE.md`, `docs/01-TICKETS.md`, the
  ticket in full, and any sibling ticket whose Log carries the handover.
- **Scope**: implement the Build section, do not widen or narrow. If the brief is
  wrong, do the right thing and record what it had wrong in the Log. **One
  exception, and say it out loud in the prompt:** if the work in front of you makes
  some *other* small, already-specified piece of work free, fold it in rather than
  leaving it — and if you decide not to, write down in the Log that you could have
  and why you did not. That note is what lets the orchestrator catch the call; a
  silent deferral is invisible.
- **Gates**: `npm run check`, the tool's project suite, full `npm test` if shared
  config moved, `npm run format` after any `.md`.
- **Bookkeeping**: append a dated Log entry, set `status: done`. There is no status
  page to update — `npm run status` is the view, computed from the frontmatter.
- **Stop before the PR.** A reviewer runs first. (On the *last* relay, replace this
  with conditional ship authority — see _Size the process to the ticket_.)
- **Do not spawn subagents.** Orchestration is yours.
- **Report**: branch, files, what the brief had wrong, exact gate commands and
  results, anything deliberately left out.
- **Say what you could not do, rather than inferring it.** Name the unmeasured
  thing as unmeasured: a container that was never built, an image whose trust
  store was never checked, a suite that could not run here. The best builder
  reports in the second session were the ones that refused to fill a gap with
  reasoning — one declined to hand-write a routing fixture the ticket forbade and
  instead found a way to capture a real one; another left a code path untested,
  said so at full strength, and filed the follow-up rather than claiming the
  ticket done.
- **Push back rather than transcribe.** If a relay's framing does not survive
  contact with the code, say so and record your own reasoning. See
  _Do not launder subagent claims_.

## Dispatching a gate — the highest-leverage thing you write

Gate yield tracked prompt specificity, not gate number. In the reference session
gates 4 and 5 were the cheapest **and** the highest-yield, because by then the
prompts said *reproduce this exact mutation* instead of *review this*.

**So make gate 1 look like gate 4.** Every gate prompt should:

- **Name what to attack.** The riskiest decision, the seam with the longest reach,
  the claim you least believe. Generic review finds generic things.
- **Demand reproductions, not conclusions.** "Revert the fix, confirm it goes red"
  beats "assess whether the test is adequate". A builder's own mutation claim is
  self-transcription — reproduce it independently.
- **Require a positive control before any negative is believed.** Make the gate
  prove its own harness can produce the failure it is looking for, and state that
  result in the review. This is the single highest-yield line in a gate prompt: in
  the third session the gate on a security claim pointed ffmpeg straight at the
  untrusted origin first, got a clean refusal, and only then ran sixteen candidate
  options — which is the entire reason its sixteen negatives are evidence rather
  than a broken fixture.
- **Expect a judgement question to come back as an echo.** The corollary to the
  rule above, and it is the one that decides what a gate is worth. Ask a reviewer
  to *run* something and you get information you did not have. Ask it to *judge*
  something you have already doubted — "is this over-specified?", "is the register
  right?", "is that claim earned?" — and you will usually get your own doubt
  returned in better prose, which feels like corroboration and is not. Both
  readings were already in your prompt.

  Measured on one gate in the fourth session, over a 45-line diff: six findings,
  **three genuinely independent** (a heading that swallowed the section's closing
  paragraph; a worked example that fused two incidents needing two different
  commands; a documented command that exits 2 because it names no pattern — the
  reviewer ran it), **two echoes** of questions the prompt had already raised, one
  cosmetic. Every independent one required executing or resolving something; every
  echo was pure judgement. Scope a gate toward what it must run, and accept that
  the questions you already know to ask are the ones it can least help you with.

- **Enumerate, never sample.** Say "walk every conditional and `??` in these files
  and report how many you tested and what survived". Sampling misses clustered
  defects, and a claim of *none left* is worth exactly what the sweep behind it was.
- **Check the ticket's premise, not only its code against the ticket.** When a
  ticket rests on machinery — a workflow, a scheduled job, a hook, an external
  service — make one gate confirm that the machinery **actually runs**, by reading
  its run logs, not that the code calling it is correct. A green pull-request check
  and a working mechanism are different claims, and no amount of reviewing the
  diff distinguishes them: in the reference session a ticket passed **four** gates
  sitting on a job that had never once done its work (the same job `## After a
  merge` names), and every gate had verified the code faithfully. This is one
  command, and it is why a whole follow-up ticket had to exist.
- **Verify the negative half of every acceptance line.** A criterion reading "a
  branch that edits X **fails** the check" is not proven by three green runs. In the
  reference session a doc ticket reached its fourth gate before anyone watched the
  check actually fail.
- **Resolve every citation, not six.** Staleness clusters in whatever was written
  earliest and edited around, so spot-checks systematically miss it.
- **Say what is already settled** and must not be redone: "gate 2 verified the
  sweep — spot-check two conclusions, then focus on this round".
- **Give verdict guidance** once findings shrink: *"say PASS unless you find
  something that would mislead a reader or let a defect through; do not manufacture
  another round."*
- **Forbid delegation.** No subagents.
- **Fix nothing.** The gate reports; the builder fixes.

Ask for: `PASS / CONCERNS / FAIL`, gates reproduced independently, findings
most-severe-first with `file:line` and a concrete failure scenario each, and
anything claimed that could not be verified.

### Authorising an outward-facing action

**This is not an exception to "Fix nothing" above** — it authorises a throwaway
branch off the base, never a change to the branch under review. See also
_When every agent dies at once_, which is the same cleanup rule arriving from the
other direction.

Sometimes a gate cannot reproduce a claim without reaching outside the repo — a
dry run that needs a branch on `origin`, a service that will not answer a local
ref. Refusing costs you the reproduction; granting it carelessly leaves debris on
a shared remote under someone else's name. Grant it with the conditions attached,
in this order:

- **One named throwaway.** Name the branch in the prompt (`<ticket>-verify-scratch`)
  so it is unmistakably disposable and you can find it later by grep.
- **Make the agent verify the preconditions itself, and say which.** "Confirm no
  workflow can fire on this ref before pushing." Do not hand it your own survey —
  a builder in the fourth session reported four workflows, all of them
  push-to-`main`, and there are **seven**. The reviewer read all seven, reached the same
  conclusion, and only then pushed.
- **Dry run only, never the real thing**, and never to the default branch.
- **Cleanup is the immediate next action after capturing the output**, not a step
  at the end of the review, and it must be stated that way. This is the rule that
  earns its keep: a session usage limit killed that gate mid-run, and it happened
  to die *just before* the push. Had the cleanup been batched with the write-up, a
  second interruption would have stranded the branch.
- **Demand proof of deletion** in the report — `git ls-remote --heads origin |
  grep -c <the-branch-name>` → 0; **name the pattern**, because a bare `grep -c`
  is a usage error and `grep -c ""` counts every branch on the remote and can
  never be 0. Then **check it yourself**: it is one command and it is the only
  part you can confirm.
- **Give it an explicit way out.** "If you judge the push not worth the remote
  churn, say so and verify as far as you can without it." An honest *I did not
  reproduce this* is a legitimate review; a reasoned substitute presented as a
  reproduction is not.


### Do not cap the gate count

The obvious economy — "three gates then ship" — is wrong. In the reference session a
fourth gate caught a process document contradicting itself in adjacent sentences,
and another fourth gate caught three mediums including a UI element stuck permanently
on for every healthy job. A cap ships those.

The economy is in **scope**, not count. Gates 1 and 2 cost the most and found the
least because they re-read everything from scratch.

Narrowing works, measurably: in the second session narrow gates averaged 75 k
against 124 k for full ones, found fewer things, and **never found nothing.** The
line that makes them cheap is _say what is already settled_ — an explicit "do not
re-sweep the citations, do not re-run the full suite" is worth more than any
instruction about what to examine.

**But a gate can also be scoped too wide.** One gate in the second session was
given seven attack sections — real network calls to two ffmpeg builds, a
from-scratch baseline build, an end-to-end browser suite and a mutation sweep over
seven files — on the widest branch of the batch. It ran **70 minutes and 181 tool
calls**. It found the batch's most serious defect, so the work was real, but it
should have been two gates: one on the security claim, one on everything else.

**So split on the kind of setup, and treat that as a rule rather than a caution.**
The third session split exactly that shape in advance — gate A on the security
claim (real ffmpeg, two TLS origins, recovering a propagation array out of a
stripped binary), gate B on the code, the record and the repo invariants. 114 k
and 113 k, both PASS, both returning findings neither would have reached inside
the other's attention, and B ran the e2e suite while A ran ffmpeg sweeps. The test
is mechanical: **if the attack list needs two kinds of setup, it is two gates.**
Every narrow or split gate across that session was cheaper than every full one and
none came back empty.

**A quiet worktree is not a liveness signal.** That same gate looked hung —
flat transcript, no file written for ten minutes — and was reported to the user as
probably stuck. It was running long subprocesses, and had in fact already
finished. Before concluding an agent is stalled, remember that ffmpeg, Playwright
and a full rebuild all write nothing for minutes at a time. The non-destructive
probe is a message asking it to report what it has and drop the expensive
remainder; it costs almost nothing and is safe if the agent is healthy.

## Defect shapes worth naming in a prompt

**A fixture value that is also the component's no-op.** A sorted list handed to a
sorter; the one enum value that renders nothing handed to a component that renders
on a different one; a present optional handed to a fallback chain. Nine instances
across two tickets in the reference session, none findable by reading the tests —
each reads as a good assertion and passes for the wrong reason.

**A fix that consumes its own counterexample.** Proving a lookup can delete the only
fixture that exercised the comparison beside it. After any test fix, ask what value
the suite no longer supplies.

**A test that asserts a library's prose.** Matching on a framework's warning text
passes green the day the wording changes. Prefer a structural assertion.

**A negative assertion with no companion.** `queryBy(...).toBeNull()` passes when the
whole markup block is gone. It needs a sibling that fails in that case.

**An acceptance line that cannot fail.** Check the premise: if the fixtures cannot
produce the input the criterion describes, the assertion was never live. Amending
such a line is honest — but the amendment needs an outside check.

**A correction that is false in a new place.** A gate finds a claim false, the
builder rewrites it, and the rewrite is wrong differently — and now it *reads as
reviewed*, so the next reader trusts it harder than the original. Twice on one
branch in the third session: "drop the fold and both go red" replaced a different
false sentence, and only one of the two tests goes red because the other is a
control that must stay green. This is the concrete case for _one false
self-report means another gate_ below: it is the correction, not the original,
that the second gate caught. When relaying, say **state only what you have run** —
the builder that fixed it put it best: what broke the pattern was not care, it was
refusing to write the sentence until the command had exited.

**A verification harness that cannot fail.** The shape above, one level up, where
none of the techniques on this page look — because they all examine the tests
rather than the thing running them. A builder reported *twelve mutations, twelve
red*; all twelve were worthless, because its harness ran
`npx vitest run <spec> --reporter=basic` and `basic` does not exist in vitest 4.
It fails to load and **exits 1 on a clean, unmutated tree**, so every mutation
"died" unconditionally. It was reporting the reporter.

**The discipline is one line: a control run.** Before trusting any red, run the
mutation command over the **unmutated** tree and confirm it exits 0. Require it in
the gate prompt, and require the reviewer to state the control's result. It
generalises past mutation testing: any harness whose signal is an exit code needs
its negative case proven once, or a green is indistinguishable from a
misconfiguration.

The corollary is that a builder's mutation report is not evidence until something
reproduces it. When one report on a branch is found false, **every other
self-reported result on that branch is suspect** — that is a reason for another
gate, and it is evidence rather than ritual. In the second session the branch
whose sweep collapsed was re-swept properly (16/16, control green), and the
*corrected* table still overstated by one row. The gate that caught that was the
one a "three gates then ship" cap would have skipped.

**Reasoning that was never run.** One level earlier than the harness that cannot
fail, and it is the most common defect in this repo's history. That shape is about
verification machinery producing a false negative; this one is about a claim that
**never had machinery at all** — sound reasoning, written down as a conclusion,
never executed.

Its distinguishing property is what makes it dangerous: **sound-but-unrun and
sound-and-run reasoning are identical on the page.** No reviewer can separate them
by reading, which is why prose review never catches this and why the fourth
session shipped three instances across two branches — and drafted a fourth, in
this very section. They rhyme:

- A builder deferred fixing one table row because it was "the same class" as a
  row it had *measured* to be unfixable. The measurement was real; the
  generalisation to the neighbouring row was never run. That row was the one
  reaching the disk.
- The same builder rejected an option on a ticket for a specific reason, then
  wrote the opposite into a sibling ticket an hour later. Its own diagnosis is the
  best statement of the class anyone produced: *"The reasoning was sound both
  times; only one was run."*
- A documentation branch replaced a **vague and true** sentence with a **precise
  and false** one, in a passage headed "re-derived from the repository, not taken
  on trust".

The countermeasure is one line, and it belongs in every builder and gate prompt:
**do not write the sentence until the command has exited.** Its corollary is
cheaper still — where you cannot run it, write the vague-and-true form rather than
the precise-and-unverified one. Precision is not a courtesy to the next reader
when it is unearned; it is a trap, because precision is what makes a claim look
checked.

Two consequences for how you dispatch:

- **Require every figure to carry the command that produced it**, inline, in the
  Log. Not "verified" — the invocation and its output. This is the only mechanical
  test that separates the two cases, and it is what a later gate can audit.
- **A ticket's own rigour claim is a place to look, not a reassurance.** All three
  instances above sat inside sentences advertising that they had been measured.
  When a gate prompt says what to attack, "the sentence claiming it was measured"
  is a good answer.

**And it catches orchestrators.** The first draft of this very section reported the
fourth session's review share as "40%". Nobody computed it; it was the number that
felt right beside the previous three. Summing the six gates against the total gave
**34%** — written into a paragraph whose subject is claims that were never run, by
the agent writing the rule.

Then the session kept running, one branch took a fourth round, and the true figure
became **30%**. So the anecdote has two halves and the second is the more useful
one. Nobody is exempt from this class, least of all whoever is currently explaining
it — and **a figure computed while the work is still moving is a figure that will
move.** Re-derive every number as the last action before you commit, not the first
convenient one; the discipline that caught both errors was mechanical, not
vigilance.

**Why it recurs, which is the part worth carrying.** The documentation branch above
hit this class **three times on one document across three passes of one branch** —
written wrong, corrected wrong, and the correction's correction invalidated by the
next round — all inside a single session, across roughly one hour. That is the
alarming part: it does not need elapsed time or a change of author to recur. Two
gate rounds on that branch were enough to surface two of the three. Its builder found the
mechanism, and it is not carelessness: the paragraph was being edited for a
*different* finding, so it was on the **edit list** but not on the **re-derive
list**. The rule as practised was "verify the figures the gates named"; the rule as
written was "verify every figure". Adding a file to the branch silently invalidated
a count that had been correct when written, and nothing connected the two edits.

So the generalisation to put in a relay is theirs, not a restatement of the
finding: **a number is safe when it is re-derived in the same pass that could have
invalidated it — and adding a file to a branch invalidates every count of that
branch's files.** A fix that does not generalise is how a class recurs, and "fix
the number the gate named" is exactly such a fix.

## Verification traps

- **A harness that cannot fail is the defect class that produced everything else
  on this page.** Before trusting any negative result — a mutation that "died", a
  sweep where nothing worked, a check that stayed green — **prove the harness can
  produce the positive.** Three independent instances in one session, only one of
  them mutation testing: a component test whose value arrived from a refetch
  rather than the frames it named; sixteen ffmpeg candidates that all failed
  identically because the fixture returned the *requested* port (`0`) instead of
  the bound one; and a peer session's dangling-dependency test whose dependency
  was not dangling. In each the result looked like evidence and the setup had
  quietly removed the thing under test. The mutation-testing control run below is
  one instance of this rule, not the whole of it.
- **Build before testing** in a fresh worktree, always.
- **Stale `dist` fakes a passing mutation.** Where a package resolves a sibling
  through `dist`, mutating that sibling and seeing green may mean the build never
  ran. Rebuild, then re-mutate.
- **And restoring a mutation can leave `dist` stale too** — the same trap running
  backwards, hit independently by two agents in one session. `mv "$F.bak" "$F"`
  restores the file's **original mtime**, so `tsc --build` judges the source older
  than the emitted output, skips the project, and the **mutated** `dist` survives
  the restore. One occurrence left a mutated `config.js` in place, failed an
  unrelated suite, and looked exactly like a branch flake. `touch` the source
  after restoring, or force a clean rebuild, and grep `dist` to confirm the
  mutation is gone. Suspect this first when a suite fails in a way the diff cannot
  explain.
- **Restore from a `trap`, not from the next line of the script.** The next line
  does not run when you are killed. A mutation harness whose restore is a
  subsequent statement leaves the tree mutated on any timeout, interrupt or usage
  limit — and the fifth session's orchestrator did exactly this to itself, running
  a sweep under a two-minute tool timeout and stranding a source file *and* its
  `dist` with a security-relevant lookahead deleted. Write
  `trap 'cp "$BAK" "$F"; touch "$F"; npm run build' EXIT INT TERM` **before** the
  first mutation, and have the run print a line when it fires so you can see that
  it did. This is the cheap half of *When every agent dies at once*: that section
  tells you to check for a mutated tree afterwards, and this stops there being one.
- **Measure the baseline yourself.** Never carry a delta across a rebase; check out
  the base, build there, run the suite.
- **Docs need mechanical verification, not prose review.** Prose has no compiler.
  What works: an **unfiltered** `git grep` (no `--include` — the citation that
  matters is in the file type you did not think of), resolving every link including
  anchors, `ls` on every cited path. Three consecutive gates each found exactly one
  more dangling citation than the sweep before it claimed existed.
- **A sweep anchored to one term is still a filter.** Unfiltering the file type is
  half of it; the other half is sweeping the **other names of the thing** — the
  flag, the script, the ADR slug, the bare noun in a spine listing — because a
  citation can name the subject without ever using its filename. Two found this way
  in one ticket, neither reachable by any `git grep` on the filename: a
  `package.json` annotation still advertising a deleted flag, because the ADR it
  pointed at is slugged differently; and a `CLAUDE.md` layout block listing the
  page by its bare noun. Three instances of this class across two tickets, each
  from an angle the previous fix did not cover — which is the tell that a fix which
  does not generalise is how a class recurs.
- **Slow gates do not run here.** e2e and container builds stay unrun in this loop.
  Say so when reporting a PASS; the CI workflow is the first thing to exercise them.

## After a merge

**A standing rule against polling CI is not a reason never to look.** The rule
exists so nobody watches a run to completion; it does not license never checking
what a merge did. Look once, afterwards.

**Green PR checks say nothing about the `push`-triggered jobs.** They are different
events with different jobs, and a job that only runs on `push` to `main` can fail
on *every* merge while every pull request stays green — nobody sees the red,
because nobody was looking at `main`. In the reference repo one such job had never
once succeeded: branch protection rejected its push with `GH013 — changes must be
made through a pull request`, so a generated file it maintained sat a week stale
while listing a merged ticket as open and omitting a live security ticket
entirely.

So after a batch merges, one call: `gh run list --branch main --limit 10`. Read
the `push` rows. That is the whole check, and it is the only thing that would have
caught it.

## Records

A gate written into a reviewer's worktree **did not happen** — the worktree is
discarded. So:

- **Put the long form on the pull request and the short form in the ticket.** Both
  are durable and the thread costs the repo nothing, so committing the full report
  *and* posting it — which is what the rule below produced for five sessions — stores
  every gate twice and creates two copies that can drift. Measured on the fifth
  session's three tickets: **303 lines of gate record committed, 294 of the same
  text posted.** Commit the verdict, the findings table with `file:line` and a
  disposition each, and what the gate did **not** do; post the reasoning, the
  enumerations and the reproductions to the thread, and link it.
- **The Log is where the bloat is, not the gate record.** Same three tickets: Logs
  **753 lines**, gate records **303** — and one of those Logs ran to **371 lines
  for a three-line config change**. The cause is upstream, in the relay: every
  *"say why"*, *"what is the mechanism"*, *"what could you not measure"* converts a
  measurement into paragraphs, and those instructions are elsewhere on this page
  because they are worth it. So keep asking — and put the answer where it is read
  once. **The Log's shape is a claim, its command, and that command's output.** The
  narrative belongs in the pull request body. **One carve-out, because the repo's
  own `CLAUDE.md` says it has nowhere else to live:** what the brief turned out to
  have wrong stays in the Log, as a claim with its command like any other. Judge a
  Log by whether a later agent can re-run it, not by whether it reads well.

- The reviewer returns the section; **the builder commits the short form of it**
  (the two bullets above say which form) to the ticket, above
  `## Log`, one subsection per gate, never overwriting an earlier one.
- The builder then posts the reviewer's report to the PR thread
  (`gh pr comment <n> --body-file <f>`). That is what makes a self-transcribed
  verdict falsifiable, and it is the only check on it.
- Verdicts are recorded **as given**. "FAIL, since addressed" is a verdict softened
  in place; put the addressing in the dispositions.
- Every finding is listed, including those needing no change.
- **Re-resolve every `file:line` in the record as the genuinely last action before
  `git add`** — after the final `npm run format`, with nothing between. Verify
  programmatically (check that each cited line still contains what the record
  claims) and say in the record which commit the citations resolve against.
  Without this, **every gate record this page prescribes is stale on arrival.**
  There are four ways it goes stale, and only the first is the obvious one:

  1. **Your own fix moves the lines.** Fixing one finding in the second session
     lengthened a comment by six lines and pushed four citations
     (`:313→:319`, `:331→:337`, `:341→:347`, `:384→:390`); another branch remapped
     22 after a lint fix moved code.
  2. **The reviewer's citation was wrong when written.** Five of twenty-five did
     not resolve on one third-session branch against a directory that was
     *byte-identical* to the commit reviewed — so this step catches reviewer error,
     not just drift. **This mode dominates, and the ordering here understates it:**
     the fourth session caught **ten** of them across four branches — one off by a
     line (`:14→:15`), five clustered in one direction (each pointing at the
     comment block *above* a test rather than its `test(` line), three one-line
     boundary misses where the quoted string ran past the cited range, and one
     more (`:96→:94`) on a fourth branch. Reviewers mis-cite systematically, in a
     consistent direction per reviewer, which is why a spot-check misses it and an
     enumeration does not. Mode 1 occurred too, on the branch whose fix moved the
     very lines its record cited — handled not by remapping but by **pinning the
     record to the commit the gate reviewed** and saying so, which is the cheaper
     answer when the reviewed tree is the one the findings describe.
  3. **You re-resolve, then make one more edit.** One builder ran its check clean
     at 10/10, then applied a comment fix that moved two citations. It caught this
     only by re-running. "Before committing" is not tight enough; it has to be
     last.
  4. **The formatter reflows the file after you write the record.** oxfmt
     rewrapping gate tables broke a self-referential row twice on one branch and
     was confirmed on another. Format first, resolve second.

  Three mechanics make the check actually catch things, all learned by nearly
  missing them:

  - **Assert that every `path:line` in the record is in the checked set.** Without
    it a citation you forgot to register passes silently, which is the one failure
    the check exists to prevent. One builder built this and it is the difference
    between a resolver and a rubber stamp.
  - **Bare numbers with no file token are citations too.** A reviewer's evidence
    table with a `line` column carries them, and every naive regex skips the whole
    column. Two builders hit this independently.
  - **Do not remap a citation that is the finding's own evidence.** A gate that
    reports "`:93-94` is wrong, the text is at `:94-95`" contains a coordinate that
    must stay wrong — it is a quotation of the defect, not a pointer. A positional
    remap will silently "fix" it and destroy the finding.

  **A caveat specific to editing this file.** `.claude/` sits in `.oxfmtrc.json`'s
  `ignorePatterns`, so `oxfmt` never touches this page and `npm run check` cannot
  catch a broken table, an unterminated code span or a mangled list in it. "Format
  first, resolve second" does not apply here — nothing reflows — but neither does
  the formatter's usual backstop, so proofread structure by eye.

  And two things that are not staleness and will look like it: a citation whose
  *content* you changed (it resolves, it just no longer says what it said), and a
  gate record citing text a later correction deleted outright — inherent to
  committing a gate in the branch that fixes it. Say so in the record's preamble
  rather than repointing them.
- Record what the gate **did not** do, alongside what it did. A narrow second gate
  that says "did not re-sweep the citations, did not re-run the full suite, ran
  `--project repo` because that is what parses the ticket tree" is far more useful
  later than one that only lists conclusions.

## Decisions

Bring the user a decision whenever two readings lead to materially different work:
scope that widens past a ticket's declared packages, a contract-adjacent change, a
defect that ships today, an architectural choice two branches would both satisfy,
**or a branch about to file a ticket for work it could finish now** (see
_Fold it in, or file it_).

Give **options with a recommendation first**, each with its real cost. Do not ask
about choices with an obvious default.

**Batch them.** Each question stalls the board. Hold them to a checkpoint unless one
blocks a running agent.

**And hold a question until you can bring a measurement rather than a guess.**
When the decision turns on a fact nobody has yet, asking now buys an opinion and
usually costs a second question later. Put the fact into a gate prompt instead —
name it as blocking a decision you owe the user, so the reviewer prioritises it —
and ask once, with the number attached. In the fourth session the open question
was whether a fix should widen to a neighbouring row; the gate was asked to
*measure* whether it could, came back with one failing test out of 732 — and that
one the row already pinned as a defect — and the user decided on that rather than
on two plausible arguments. The delay was one gate the branch was taking anyway.

**Ask whether to parallelise at intake, not after the collision.** `## Concurrency`
says never to run two tickets over one seam; the failure that costs is asking the
question late. In the reference session two tickets overlapped and the question
brought to the user was *how to reconcile them* — never *whether to run them
concurrently at all*. By then both were half-built and every option was bad; three
rebases followed. The overlap is cheap to see before dispatch and expensive after,
so it is an intake decision, and it is one worth surfacing even though the answer
often looks obvious.

**Do not launder subagent claims.** If you repeat a consequence to the user, be able
to say who ran it. A vivid failure scenario from a report is a hypothesis until
someone renders it.

**Cheaper than marking a claim unverified: run it.** Where checking is a single
command — a file count, a config flag, a line that either says what it is quoted as
saying or does not — spend it rather than caveating. The value is not catching
the reviewer — in the fourth session none of these checks found a reviewer wrong.
It is the difference between "the reviewer says" and "I checked", which is what
lets you relay a finding as fact without becoming the middle link in a laundering
chain.

The worked example is a count of the files one commit touched, published wrong in
a document: `git show --name-only <sha>` settles it in one line, and the same line
settled it a second time two passes later when the published number had drifted
again. Note the object — a *branch's* touched-file count is
`git diff --name-only <base>...<tip>`, a different command, and reaching for the
wrong one gives a confident wrong answer. Reserve the caveat for what genuinely cannot be checked from here — token
counts, another session's transcript, anything that needed the network.

**For the rest, the mechanism is one clause, and it is cheap: mark relayed claims as unverified
in the relay itself.** "The ticket says X; I have not checked" costs a sentence and
stops the chain. Without it the chain forms silently — in the third session a
ticket asserted that a file contained a word, the orchestrator repeated it in a
brief without running the one-line `grep` that same brief demanded, and the builder
repeated it from the orchestrator. Three links, and the middle one was the only
place it was cheap to stop. The same orchestrator later relayed a peer session's
claims explicitly flagged as unrun, and that one did not propagate — the builder
verified them against merged code instead.

**And do not launder your own summaries downstream.** A relay carries the finding
and the evidence, not a conclusion to implement. In the second session the
orchestrator passed a reviewer's framing of a guard as "prototype-pollution
defence" down to the builder as an instruction; it was wrong — the value reached a
`Map` key, so that route was already closed, and the real risk was key collision.
The builder refused to transcribe it, wrote the test for the collision it could
demonstrate, and the next gate upheld the builder. **Three separate builders
corrected an orchestrator error in one session** — an id, a ticket's status, and a
diagnosis. Write relays so that is possible: give the reproduction, not the
verdict, and say explicitly that a builder should push back rather than transcribe
if the framing does not survive contact with the code. In the fourth session all
four builders corrected something — a brief's fixture tree that would have passed
against the CLI it was testing, a brief's claim that an option "removes the whole
class", an orchestrator framing that treated a choice as settled when its premise
was unmeasured, and a ticket's own baseline.

### Two clauses that turn a correction into a rule

Both are one sentence in a relay, and both were the direct cause of the fourth
session's best builder output. They cost nothing and they are easy to omit.

**Ask for the mechanism, not the fix.** When you relay a finding, add: *"why did
the argument not transfer?"*, or *"why did the discipline not catch its own
paragraph? — that is the more useful note than the fix."* Without it you get a
corrected number. With it you get the reason the number was wrong, which is the
only part the next agent can use. Both generalisations quoted on this page —
"tested it and narrated the other", and the edit-list/re-derive-list split — exist
because a relay asked for them. Neither builder volunteered it.

**Make the builder reproduce a finding before accepting it.** Not to doubt the
reviewer — to put the builder in contact with the gap. A builder told to run the
disproof of its own claim wrote the sharpest diagnosis of the batch; a verdict
handed down would have got "reproduced, agreed, fixed". This also catches the
reviewer being wrong, which happens (see _Records_ on citations).

The shape to avoid is the opposite one: relaying a finding as an instruction to
apply. That gets it applied and learns nothing, and when the reviewer is wrong it
gets a wrong thing applied confidently.

### When two gates disagree, relay the disagreement

A split gate can come back split. Do not adjudicate it yourself and do not average
it — **give the builder both readings with their evidence and no verdict, and say
explicitly that concluding both gates are wrong is an available answer.**

In the fourth session gate A rated a rule's type enumeration a real defect; gate B
rated the same thing acceptable. Relayed as an open disagreement, the builder
rejected both framings and proposed a third: read the mechanism off the `hidden`
flag rather than off a list of type names, so *enumerating type names was itself
the defect*. An answer neither gate proposed, and the instruction it wrote — read
the test off the config — does not go stale when a type is added.

**And then a later gate corrected the builder in turn, which is the part not to
lose.** That third answer was an *inference*, not a measurement: only two types
were ever run, and both results are equally consistent with a hardcoded releasing
list. It shipped because it **errs safe** — if the hypothesis is wrong the new rule
over-warns, where the enumeration it replaced under-warned. So the lesson is not
"the builder's measured answer beats both gates"; it is that relaying the split
produced a better *hypothesis* than either gate held, and that a further gate was
still needed to say what kind of claim it was. Repeating a builder's
self-description as measurement is the laundering this section forbids, and the
orchestrator did exactly that in the first draft of this paragraph.

Often the builder has run the mechanism and the reviewers have not — though not
always: one gate in that session reproduced a release-please dry run end to end,
which is more than the builder's own claim rested on. Say which gate found what,
keep both attributions, and let whoever is closest to the measurement decide.

## Reporting to the user

Lead with what changed and what needs them. Name the finding that matters and why it
would have bitten, not a list of everything found. Keep a board — ticket, gate
count, verdict, PR — and give merge order when branches are stacked or conflict.

When a batch runs long, report cost honestly: agents, tokens, gates, and what the
next batch should do differently.
