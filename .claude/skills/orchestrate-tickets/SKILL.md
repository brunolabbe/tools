---
name: orchestrate-tickets
description: Run several tickets to merged pull requests at once by dispatching builder and reviewer subagents, gating each ticket before it opens a PR. Use when asked to work through a batch of ready tickets, to "keep the board moving", or to act as orchestrator over parallel work — "pick up the ready tickets", "run dl-15 and pl-25 together", "continue working, dispatch agents". Not for a single ticket you can build yourself.
---

# Orchestrating a batch of tickets

You dispatch, you gate, you decide. **You do not build and you do not review.** Your
context is the one thing that must survive the whole batch, so it holds the board
and nothing else.

This skill is written from two sessions. The first took five tickets to five pull
requests for ~4 M subagent tokens across 21 agents and 16 gates. The second took
four tickets plus two filed defects to five pull requests for ~2.7 M across 17
invocations and 6 gates, applying the first session's lessons. Most of what
follows is the cost of learning something the expensive way; the numbers are
quoted where they change a decision, and where the two sessions disagree both are
given, because the disagreement is usually the point.

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
8. **Remove the worktree the moment the PR is open.**
9. **Check the merge landed what it was supposed to.** Not polling — one look,
   after the fact. See _After a merge_.

## Concurrency

**Reviewers occupy slots.** A cap of four means four agents total — planning around
builders alone means constantly rediscovering the cap.

**The builder/reviewer split is not a planning constant.** Reviews were 60% of
token spend in the first session and 23% in the second, on the same loop and the
same repo. The difference is not the tickets, it is where the round-trips went:
the second session wrote sharper gate prompts (so gates read less and reproduced
more) and kept relaying findings to finished builders (so builders paid context
reload over and over). Do not budget from either number. Budget from
_Size the process to the ticket_ below, and measure your own split as you go —
whichever side is winning is the side to attack.

**Never run two tickets over one seam.** The most expensive agent in the reference
session (559 k) was a builder that rebased three times onto a sibling branch whose
contract kept moving. Every rebase is a full re-read. Serialise them: it costs
wall-clock and saves tokens, context reloads and a whole class of coordination
message.

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

**Builder round-trips cost more than gates.** In the second session a docs ticket
consumed 449 k across five invocations for a 123-line change; 312 k of that was
three builder rounds, two of which applied about four lines of markdown each.
Meanwhile every one of the six gates returned at least one landable finding —
**zero wasted gates.** A resumed builder pays full context reload and its cost is
roughly flat in the work done and rising with transcript length:

| round | tool calls | tokens |
|---|---|---|
| 1 | 37 | 100 k |
| 2 | 10 | 94 k |
| 3 | 11 | **118 k** |

Eleven tool calls cost more than thirty-seven. So:

- **End every relay with conditional ship authority.** "Apply these, and **if**
  `npm run check` is green, the suite is green and the diff scope is unchanged,
  open the PR yourself — do not check back. If any condition fails, stop and tell
  me." This removes an entire round and gives up no gating, because the conditions
  are mechanical. It worked on three branches in the second session.
- **Batch every finding from a gate into one relay.** Two relays of one finding
  each cost double for the same result.
- **Choose the gate count from what the branch risks escaping** — a shared
  package, a contract, an untested path, a security claim — not from a rule and
  not uniformly. A self-generated docs ticket deserves one builder and at most one
  gate. See _Do not cap the gate count_ for the other half of this: the economy is
  in scope, never in refusing a gate that has something to check.
- **Some work needs no gate at all.** Filing a ticket that *records a defect* is
  the clear case: require the builder to reproduce the defect before writing it up,
  and the reproduction **is** the verification. In the second session that builder
  found more than it was briefed, corrected the orchestrator, and cost 111 k with
  no reviewer at all.

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
hour later.

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

- **Do not symlink `node_modules` wholesale.** It is one command and it is
  silently wrong: the worktree's `node_modules` *is* the shared one, so every
  workspace link resolves into the **shared checkout**. An agent editing a
  contract then typechecks and tests against the other tree's version of it —
  stale exports, green suite, wrong code, and nothing in the output says so.
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
  wrong, do the right thing and record what it had wrong in the Log.
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
Split a gate when its attack list needs more than one kind of setup.

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

## Verification traps

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

- The reviewer returns the section; **the builder commits it** to the ticket, above
  `## Log`, one subsection per gate, never overwriting an earlier one.
- The builder then posts the reviewer's report to the PR thread
  (`gh pr comment <n> --body-file <f>`). That is what makes a self-transcribed
  verdict falsifiable, and it is the only check on it.
- Verdicts are recorded **as given**. "FAIL, since addressed" is a verdict softened
  in place; put the addressing in the dispositions.
- Every finding is listed, including those needing no change.
- **Re-resolve every `file:line` in the record against the branch tip before
  committing it.** A reviewer cites the commit it reviewed; fixing those findings
  moves those lines; the record is then committed already stale. Fixing one finding
  in the second session lengthened a comment by six lines and pushed four
  citations (`:313→:319`, `:331→:337`, `:341→:347`, `:384→:390`); another branch
  remapped 22 after a lint fix moved code. Verify programmatically — check that
  each cited line still contains what the record claims — and say in the record
  which commit the citations are resolved against. Without this, **every gate
  record this page prescribes is stale on arrival.**
- Record what the gate **did not** do, alongside what it did. A narrow second gate
  that says "did not re-sweep the citations, did not re-run the full suite, ran
  `--project repo` because that is what parses the ticket tree" is far more useful
  later than one that only lists conclusions.

## Decisions

Bring the user a decision whenever two readings lead to materially different work:
scope that widens past a ticket's declared packages, a contract-adjacent change, a
defect that ships today, an architectural choice two branches would both satisfy.

Give **options with a recommendation first**, each with its real cost. Do not ask
about choices with an obvious default.

**Batch them.** Each question stalls the board. Hold them to a checkpoint unless one
blocks a running agent.

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
if the framing does not survive contact with the code.

## Reporting to the user

Lead with what changed and what needs them. Name the finding that matters and why it
would have bitten, not a list of everything found. Keep a board — ticket, gate
count, verdict, PR — and give merge order when branches are stacked or conflict.

When a batch runs long, report cost honestly: agents, tokens, gates, and what the
next batch should do differently.
