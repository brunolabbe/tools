---
name: orchestrate-tickets
description: Run several tickets to merged pull requests at once by dispatching builder and reviewer subagents, gating each ticket before it opens a PR. Use when asked to work through a batch of ready tickets, to "keep the board moving", or to act as orchestrator over parallel work — "pick up the ready tickets", "run dl-15 and pl-25 together", "continue working, dispatch agents". Not for a single ticket you can build yourself.
---

# Orchestrating a batch of tickets

You dispatch, you gate, you decide. **You do not build and you do not review.** Your
context is the one thing that must survive the whole batch, so it holds the board
and nothing else.

This skill is written from a session that took five tickets to five pull requests
for ~4 M subagent tokens across 21 agents and 16 gates. Most of what follows is
the cost of learning something the expensive way; the numbers are quoted where
they change a decision.

## The loop

1. **Intake** — `npm run status -- --ready` for what is unblocked, `gh pr list` for
   what is already in review. A ticket file says `ready` until something merges, so
   the PR list comes first or work gets built twice.
2. **Ask which** — never pick the batch yourself. See _Decisions_.
3. **Dispatch builders**, one subagent each, `isolation: "worktree"`.
4. **Gate** each finished branch with a reviewer subagent. Builders never open a PR
   before a gate.
5. **Relay findings** to the builder as one batched message.
6. **Repeat 4–5** until the gate passes or the findings are cosmetic.
7. **Builder opens the PR**, commits the gate record, posts the reviewer's report to
   the PR thread.
8. **Remove the worktree the moment the PR is open.**
9. **Check the merge landed what it was supposed to.** Not polling — one look,
   after the fact. See _After a merge_.

## Concurrency

**Reviewers occupy slots.** A cap of four means four agents total. Reviews were 60%
of token spend in the reference session — planning around builders alone means
constantly rediscovering the cap.

**Never run two tickets over one seam.** The most expensive agent in the reference
session (559 k) was a builder that rebased three times onto a sibling branch whose
contract kept moving. Every rebase is a full re-read. Serialise them: it costs
wall-clock and saves tokens, context reloads and a whole class of coordination
message.

**Never edit a branch while it is being reviewed.** Batch the fixes and send them
after the gate returns, or the reviewer is judging a moving target.

**Ticket ids are an unlocked shared namespace.** Two parallel builders will both
reach for the next number. The next free id is `git log --all`, not `ls docs/work/`.
Assign ids yourself when two builders might file tickets.

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

## Worktree hygiene

Worktrees auto-clean only when unchanged. A reviewer that writes into its worktree
leaves it dirty, so it never cleans. The reference session leaked **7.0 GB across
20 worktrees**.

Two rules, both required:

- Reviewers **return** their section as text; they never write it to a file.
- Remove each worktree as its PR opens: `git worktree remove --force <path>`, then
  `git worktree prune`, then delete the `review-*` branch.

Audit with `git worktree list` and `du -sh .claude/worktrees` when a batch feels
long. Before removing, check `git status --porcelain` and `git log @{u}..` in each.

## Dispatching a builder

Every builder prompt carries:

- **Setup**: `git fetch origin && git checkout -B <branch> origin/main` — say the
  base explicitly, especially for a stacked branch. Then `npm install`, then
  **`npm run build`** (without built `dist` most suites fail with
  `packageEntryFailure`, which reads as test failure and is not).
- **Read first**: root `CLAUDE.md`, the tool's `CLAUDE.md`, `docs/01-TICKETS.md`, the
  ticket in full, and any sibling ticket whose Log carries the handover.
- **Scope**: implement the Build section, do not widen or narrow. If the brief is
  wrong, do the right thing and record what it had wrong in the Log.
- **Gates**: `npm run check`, the tool's project suite, full `npm test` if shared
  config moved, `npm run format` after any `.md`.
- **Bookkeeping**: append a dated Log entry, set `status: done`. There is no status
  page to update — `npm run status` is the view, computed from the frontmatter.
- **Stop before the PR.** A reviewer runs first.
- **Do not spawn subagents.** Orchestration is yours.
- **Report**: branch, files, what the brief had wrong, exact gate commands and
  results, anything deliberately left out.

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
- **Enumerate, never sample.** Say "walk every conditional and `??` in these files
  and report how many you tested and what survived". Sampling misses clustered
  defects, and a claim of *none left* is worth exactly what the sweep behind it was.
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

### Do not cap the gate count

The obvious economy — "three gates then ship" — is wrong. In the reference session a
fourth gate caught a process document contradicting itself in adjacent sentences,
and another fourth gate caught three mediums including a UI element stuck permanently
on for every healthy job. A cap ships those.

The economy is in **scope**, not count. Gates 1 and 2 cost the most and found the
least because they re-read everything from scratch.

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

## Verification traps

- **Build before testing** in a fresh worktree, always.
- **Stale `dist` fakes a passing mutation.** Where a package resolves a sibling
  through `dist`, mutating that sibling and seeing green may mean the build never
  ran. Rebuild, then re-mutate.
- **Measure the baseline yourself.** Never carry a delta across a rebase; check out
  the base, build there, run the suite.
- **Docs need mechanical verification, not prose review.** Prose has no compiler.
  What works: an **unfiltered** `git grep` (no `--include` — the citation that
  matters is in the file type you did not think of), resolving every link including
  anchors, `ls` on every cited path. Three consecutive gates each found exactly one
  more dangling citation than the sweep before it claimed existed.
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

- The reviewer returns the section; **the builder commits it** to the ticket, above
  `## Log`, one subsection per gate, never overwriting an earlier one.
- The builder then posts the reviewer's report to the PR thread
  (`gh pr comment <n> --body-file <f>`). That is what makes a self-transcribed
  verdict falsifiable, and it is the only check on it.
- Verdicts are recorded **as given**. "FAIL, since addressed" is a verdict softened
  in place; put the addressing in the dispositions.
- Every finding is listed, including those needing no change.

## Decisions

Bring the user a decision whenever two readings lead to materially different work:
scope that widens past a ticket's declared packages, a contract-adjacent change, a
defect that ships today, an architectural choice two branches would both satisfy.

Give **options with a recommendation first**, each with its real cost. Do not ask
about choices with an obvious default.

**Batch them.** Each question stalls the board. Hold them to a checkpoint unless one
blocks a running agent.

**Do not launder subagent claims.** If you repeat a consequence to the user, be able
to say who ran it. A vivid failure scenario from a report is a hypothesis until
someone renders it.

## Reporting to the user

Lead with what changed and what needs them. Name the finding that matters and why it
would have bitten, not a list of everything found. Keep a board — ticket, gate
count, verdict, PR — and give merge order when branches are stacked or conflict.

When a batch runs long, report cost honestly: agents, tokens, gates, and what the
next batch should do differently.
