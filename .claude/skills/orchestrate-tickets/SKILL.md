---
name: orchestrate-tickets
description: Run several tickets to merged pull requests at once by dispatching builder and reviewer subagents, gating each ticket before it opens a PR. Use when asked to work through a batch of ready tickets, to "keep the board moving", or to act as orchestrator over parallel work — "pick up the ready tickets", "run dl-15 and pl-25 together", "continue working, dispatch agents". Not for a single ticket you can build yourself.
disable-model-invocation: true
allowed-tools: Bash(npm run status*) Bash(gh pr list*) Bash(gh pr view*) Bash(gh pr diff*) Bash(git fetch*) Bash(git log*) Bash(git worktree list) Bash(git show*) Bash(gh run list*)
---

# Orchestrating a batch of tickets

You dispatch, you gate, you decide. **You do not build and you do not review.** Your
context is the one thing that must survive the whole batch, so it holds the board
and nothing else.

Most of what follows is the cost of learning something the expensive way. Numbers
are quoted where they change a decision, and where the sessions disagree all are
given, because the disagreement is usually the point. What the sessions actually
cost is in `reference/history.md`; read it only if you are revising this skill.

## Reference

This page is the loop and the judgement calls. Everything else is beside it, read
at the step that needs it — each is a few hundred lines you do not pay for until
you are there.

| Read | When |
| --- | --- |
| [reference/sizing.md](reference/sizing.md) | Before dispatch, to pick gate count and ship authority per ticket (step 2) |
| [reference/concurrency.md](reference/concurrency.md) | Before dispatching more than one builder — seams, collisions, stacking (step 2–3) |
| [reference/dispatching.md](reference/dispatching.md) | Writing a builder prompt or a gate prompt (steps 3 and 4) |
| [reference/defect-shapes.md](reference/defect-shapes.md) | Writing a gate prompt, and before believing what one returns (step 4) |
| [reference/worktree-hygiene.md](reference/worktree-hygiene.md) | Whenever a worktree is created, held or removed (steps 3 and 8) |
| [reference/records.md](reference/records.md) | Committing a gate record, a ticket log or a PR comment (step 7) |

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
2. **Map the seams, then ask which** — never pick the batch yourself. Dispatch
   `subagent_type: "seam-mapper"` over the candidate ids: it reads every ticket in
   full and returns a collision matrix instead of the tickets. Reading them
   yourself costs the one context that must survive the batch — measured at
   **~27,800 est. tokens for nine candidates** on 2026-08-30. Then bring the user
   the batches that break up the collisions. See _Decisions_ and
   [reference/concurrency.md](reference/concurrency.md).
3. **Dispatch builders** — `subagent_type: "builder"`, one per ticket. The agent
   definition carries the worktree, the setup order and the scope rules; your
   prompt carries the ticket. **The builder's model comes from the ticket, not
   from you**: read its optional `difficulty` off `npm run status -- --json`,
   which carries it per ticket, and map it with the table in
   [`.claude/agents/builder.md`](../../agents/builder.md). Absent is the common
   case and means inherit. Never rate an unrated ticket yourself — you have not
   read it, which is the whole point of step 2. See
   [reference/dispatching.md](reference/dispatching.md).
4. **Gate** each finished branch — `subagent_type: "ticket-reviewer"`. Builders
   never open a PR before a gate. **Check the model rather than assuming it**: the
   builder's Agent result carries `resolvedModel`, and the agent definition
   defaults the gate to Sonnet, which is right when the builder ran Opus. If the
   builder ran Sonnet, pass `model: "opus"` on the gate. **Since repo-17 this
   check is load-bearing rather than a backstop** — a `mechanical` ticket puts a
   Sonnet builder in a batch where every sibling is Opus, so the gate's model now
   varies inside one batch and cannot be set once. Never `haiku`, never
   `fable`. Say which model gated in the record — that is what makes the next
   audit one command instead of an assumption. Measured before this line existed:
   **11 tickets, 22 gates, none gated by a different model than built it.**
5. **Relay findings** to the builder as one batched message.
6. **Repeat 4–5** until the gate passes or the findings are cosmetic.
7. **Builder opens the PR**, commits the gate record, posts the reviewer's report to
   the PR thread.
8. **Remove the reviewer's worktree** once its record is pushed — in the ticket and
   on the PR thread. **Hold the builder's until the ticket is finished**, because
   steps 9 and 4-above may still need that agent. See [reference/worktree-hygiene.md](reference/worktree-hygiene.md).
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

## Decisions

Bring the user a decision whenever two readings lead to materially different work:
scope that widens past a ticket's declared packages, a contract-adjacent change, a
defect that ships today, an architectural choice two branches would both satisfy,
**or a branch about to file a ticket for work it could finish now** (see
_Fold it in, or file it_ in [reference/sizing.md](reference/sizing.md)).

How to ask is the root `CLAUDE.md` rule and is not repeated here. What is specific
to running a board is the rest of this section.

**A subagent's report can carry a decision you have to forward.** Builders and
reviewers are told to hand you open decisions as options rather than settling
them. When one does, that is yours to put to the user — not to absorb.

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

**Ask whether to parallelise at intake, not after the collision.** [reference/concurrency.md](reference/concurrency.md)
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

**The hardest finding to relay safely is one whose premises are all true.** In the
sixth session a gate reported that two call sites logged a request context
unredacted, and every premise held: the sites do log it raw, the headers are
documented as carrying `Cookie` and `Authorization`, and the redactor that exists
for exactly that shape is called at neither. The orchestrator checked the premises,
found them sound, and relayed the conclusion as work to do. The conclusion was
false — the logger recognises that field structurally and redacts on the way out,
by design, so a call site is **not** supposed to redact, and adding one would have
taught the next reader the opposite of the intended pattern. The builder
reproduced it first, refuted it, applied nothing, and wrote the regression test the
finding had actually been pointing at. Checking a finding's premises is not
checking a finding; only running it is. Relay the premises **as premises**.

### Three clauses that turn a correction into a rule

The first two are one sentence in a relay and were the direct cause of the fourth
session's best builder output. The third cost the sixth session a whole builder
round by its absence. All three cost nothing and all three are easy to omit.

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
reviewer being wrong, which happens (see [reference/records.md](reference/records.md) on citations).

**Paste the artifact; never describe it.** When a relay carries something the
builder must *commit* — a gate's `## Review` section, a diff, any text that is
evidence rather than instruction — paste it verbatim. In the sixth session the
orchestrator described a gate record instead: its verdict, its method, seven of its
citations, accurately. The builder searched its worktree, the ticket, `git status`
and `origin`, found no such text, and **stopped**, on the grounds that composing a
reviewer's record from a summary is fabricated evidence. It was right, and the
round was lost. A description is not a smaller version of a record; it is a
different object, and no amount of accuracy converts one into the other. The tell
is the verb: if the relay asks the builder to *commit*, *post* or *quote*
something, that something has to be in the relay.

The shape to avoid is the opposite one: relaying a finding as an instruction to
apply. That gets it applied and learns nothing, and when the reviewer is wrong it
gets a wrong thing applied confidently.

**All three failures are one mistake in different costumes: compressing something
the receiving agent needed in full.**

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
