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
| [reference/defect-shapes.md](reference/defect-shapes.md) | Writing a gate prompt, and before believing what one returns (steps 4 and 8) |
| [reference/worktree-hygiene.md](reference/worktree-hygiene.md) | Whenever a worktree is created, held or removed (steps 3, 6 and 10) |
| [reference/records.md](reference/records.md) | Committing a gate record, a ticket log or a PR comment (step 9) |

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
   - **A board can be mostly unbuildable, and then "which batch" is the wrong
     question.** Measured 2026-09-03: `--ready` returned nine and **eight carried
     an open decision their own page forbids a builder from settling**. Offering
     the user a choice of batches out of that set buys a round that ends in "this
     ticket says I may not answer this". One call finds the shape before you
     spend anything —
     `grep -nE '^#{2,4} .*([Dd]ecision|[Oo]pen question)' <candidates>` — and when
     it holds, the question becomes **which slices**, not which tickets. See
     _Slice a blocked ticket_ in [reference/sizing.md](reference/sizing.md).
     **Read the matches, do not count them.** Re-run against the 2026-09-04 board
     of six, where five were genuinely blocked: the grep matched five files and
     got two of the six wrong in opposite directions — one heading read
     "answered … — not open", and one ticket's open decision was a **paragraph in
     its Build section**, not a heading, so it was missed entirely. The two errors
     cancelled and the total came out right, which is the worst way to be right.
     The count is a prompt to open the file, not an answer.
   - **The seam-mapper does not remove the decision-reading cost, only the
     ticket-reading cost.** The same session paid **87,596 subagent tokens** for
     the map and then still read seven decision sections itself. That is not a
     loss — those are disposable tokens where the ~27,800 above are the context
     that must survive — but do not budget the map as though it ends your reading.
     Why you have to read them yourself is under _Decisions_.
3. **Dispatch builders** — `subagent_type: "builder"`, one per ticket. The agent
   definition carries the worktree, the setup order and the scope rules; your
   prompt carries the ticket. **The builder's model comes from the ticket, not
   from you**: read its optional `difficulty` off `npm run status -- --json`,
   which carries it per ticket, and map it with the table in
   [`.claude/agents/builder.md`](../../agents/builder.md). Absent is the common
   case and means inherit. Never rate an unrated ticket yourself — you have not
   read it, which is the whole point of step 2. **Then pass that model explicitly
   rather than letting it inherit**, naming your own model where the table says
   inherit. A backgrounded dispatch's `resolvedModel` never reaches **you** — the
   parent sees only the subagent's final text — so inherit is the one setting that
   leaves the builder's model unobservable from where the decision is made,
   including by the builder, which on 2026-09-04 asserted its own model from a
   line that turned out not to exist. One parameter, and step 4's comparison
   becomes something you wrote down instead of something you infer. See
   [reference/dispatching.md](reference/dispatching.md).
4. **Gate** each finished branch — `subagent_type: "ticket-reviewer"`. Builders
   never open a PR before a gate. **You spawn the reviewer, never the builder**,
   even though the builder is the one who then talks to it: the model-difference
   rule is what is being enforced, and a builder that
   picks its own reviewer is the thing being checked choosing its checker. The
   builder has no `Agent` tool and is told not to spawn, and both of those are
   this rule, not an oversight. **Both halves are knowable if you make them so,
   and neither needs `resolvedModel`** — which the backgrounded dispatch *does*
   carry but never shows you, and background is how `reference/concurrency.md`
   tells you to dispatch a batch. If you ever do need it read, two documented
   routes exist: a `PostToolUse` hook on the `Agent` tool returning it through
   `hookSpecificOutput.additionalContext`, and `/tasks` (v2.1.242+), which names
   the model per row. **Every claim in this paragraph about what a dispatch
   carries is relayed and unverified here** — Claude Code's behaviour, not this
   tree's, read from a sandbox with no network. The gate's half was never in doubt:
   [`.claude/agents/ticket-reviewer.md`](../../agents/ticket-reviewer.md) pins
   `model: sonnet` in its frontmatter, so it is a file read. The builder's half is
   the one step 3 tells you to write down at dispatch. Do both and the comparison
   is a fact. **The commit trailer cannot stand in for either half.** It is built
   once per session tree from *your* model and inherited by every subagent, so a
   `mechanical` ticket built on Haiku lands a commit signed `Claude Opus 5`.
   Measured 2026-09-06, against the binary and then by hand: the trailer is
   appended to the Bash tool description rather than the system prompt, and a
   Haiku 4.5 subagent told to commit in a throwaway repo produced
   `Co-Authored-By: Claude Opus 5 (1M context)`. No trailer anywhere in this
   repo history names any other model — 480 across all refs — and that is the
   inheritance, not evidence Opus built them. Sonnet is right when the builder ran Opus or Haiku; pass
   `model: "opus"` when the builder ran Sonnet, which happens when *you* are
   Sonnet and the ticket inherits. Never `haiku`, never `fable`. **Since repo-17
   the builder's model varies inside a batch** — a `mechanical` ticket dispatches
   `haiku` where its siblings inherit — so check the pairing per ticket rather
   than setting the gate once. Say which model gated in the record; and if you did
   have to infer either, say so and **name the rule you inferred from precisely**,
   because a citation given as fact is transcribed as fact. Measured before this
   line existed: **11 tickets, 22 gates, none gated by a different model than
   built it.**
5. **The reviewer sends its findings to the builder itself**, as one batched
   message, **and sends the same findings to you in full** — not a status line
   saying it did. **Expect this to arrive as a summary anyway**: a subagent's
   report reaches you condensed, which is the same relay hop this step removed
   between reviewer and builder, still standing between reviewer and you. So
   **before you run step 8, read the committed record out of `git show`** rather
   than accepting on the summary — step 8's third check names a test per
   acceptance line and a summary cannot answer it. Measured: a reviewer that reported only "findings sent" left
   this step with one account of a two-party exchange, which is not enough to
   accept on at step 8. You are not the courier — **both recorded relay
   corruptions in this repo were introduced at this hop by an orchestrator
   rewriting a report**, not by either agent. Name the builder in the gate prompt
   so the reviewer knows who to address; the mechanics are in
   [reference/dispatching.md](reference/dispatching.md).
   - **What still comes to you, and only this**: a disagreement the two cannot
     settle, and any **open decision** either of them surfaces. A decision is not
     a disagreement — it is a question neither agent is allowed to answer, and
     you are the only participant who can ask the user. If it reaches the builder
     instead of you, it dies quietly.
   - **What you add is never a summary of the findings.** Ship authority, what is
     already settled, priority across a batch — those are yours because only you
     hold them. The findings are not.
6. **They iterate until they agree the work is done** — findings answered,
   reproductions run, the gate's verdict settled between them. **That agreement is
   theirs to reach, not yours to adjudicate**; you re-enter only on the two
   escalations above. **This is a chain of wakes, not a live conversation** — each
   side ends its turn after it sends, and `SendMessage` wakes the other back into
   its own context.

   **Sideways wakes work.** Your builder and reviewer wake each other unaided —
   confirmed again 2026-09-03: a builder that needed the reviewer's record woke it
   from `completed`, and it came back with the text re-resolved against the new
   tip, with no orchestrator hop.

   **Upward wakes: the two sessions that measured this disagree, so check rather
   than plan around either.** 2026-09-02 recorded, three times, that you are *not*
   woken when a child finishes — sitting `completed` beside a finished agent until
   something outside nudged you, with "no completion signal to wait for".
   **2026-09-03 measured the opposite, six or more times**: every finishing
   subagent delivered a `<task-notification>` that woke the orchestrator
   unprompted, and a reviewer's `SendMessage` to `main` arrived the same way.
   **2026-09-04 agreed with the later reading a third time** — every completion
   woke the orchestrator, and sideways `SendMessage` worked throughout. All three
   sessions ran this skill in this repo, so two-to-one is a tally rather than a
   resolution: do not retire the earlier reading on it. Whether the harness
   changed between them
   or the earlier reading was wrong cannot be settled from inside either, so
   **assume nothing and look**: `ListAgents` costs one call and says who is
   `running` against who is `completed`. Plan the batch so a missed wake is
   survivable, and if you do find yourself idle beside finished work, say so in
   your report rather than letting a stalled batch read as a quiet one.

   So **keep the reviewer's agent record and worktree** until the
   exchange is over, which is not the same as keeping it alive; nothing is. A
   builder that comes back "this does not reproduce" is asking a question only
   that reviewer can answer. See
   [reference/worktree-hygiene.md](reference/worktree-hygiene.md).
   - **Watch for the two failures this shape introduces.** One is a pair that
     agrees too easily: two agents that want to be done converge on "addressed"
     without either running anything. The defence is in the gate prompt — demand
     reproductions and a positive control — and in what they report next.
   - **The other is a pair that agrees and then both stop**, each treating the
     gate record as the other's next move. Nothing goes red — `npm run status`
     reads `done`, the branch is pushed, both reports say the work is finished —
     so a stalled exchange and a finished one are identical from your seat.
     Measured 2026-09-04, caught only by looking at the remote for a heading that
     was not there. The discriminator is one command per ticket:
     `git show <branch>:<ticket-path> | grep '^## Review'`. Empty means the
     exchange is still open, whatever either agent told you.
7. **Both report to you when they are done**, separately, and that is the point of
   asking both: you get the builder's account and the reviewer's account of the
   same exchange, written by two models, and can hold one against the other.
8. **You accept, or you send it back. The work is not done until you do** — the
   pair decides when *they* are finished, you decide whether that is true. This is
   the only thing that catches a pair which agreed too easily, and it is four
   checks, not a re-review:
   - **Does each report say what was run — and where a quote came from?**
     Commands and their results, not "addressed" and not "confirmed"; a finding
     closed with no command named is a finding still open. When a report *quotes*
     something to settle a point, ask **where** it is, not just what it says:
     "quotes something plausible" and "quotes something actually present" read
     identically, and asking *where* is the only cheap thing that separates them.
     The failure it catches is **glance-reading** — taking a result in at a glance
     and reporting the reading as the measurement — which found four instances
     across one batch in 2026-09, in prose every time and in citations never,
     because a tool covered those. The sharpest of them, an agent that had
     measured every other claim on its branch and fabricated the one about itself:
     *"the one claim I did not run a check against was the one about myself,
     because it did not feel like a claim."* A statement about the speaker does
     not present itself as needing evidence, which is why "be careful" is not the
     fix. The four are in [reference/history.md](reference/history.md).
   - **Do the two accounts describe the same exchange?** They were written by
     different models and should not need to be reconciled. If one says a finding
     was reproduced and the other does not mention it, something is missing.
   - **Does every `Done when` line have a verdict** — `proven`, `verified`,
     `unproven`, `unproven (gate)` — with a test named, `file.test.ts:88` rather
     than "covered"? The acceptance table is the half a finding list silently
     replaces.
   - **Is there an open decision in either report?** It comes to you precisely
     because neither of them may answer it. Put it to the user before the PR, not
     after.

   **You are judging whether they are finished, not whether they were right.** Do
   not re-open a finding the two of them settled with evidence, do not substitute
   your reading of the code for the builder's — that is the hop this loop removed,
   arriving from the other direction. Send it back naming the specific line whose
   evidence is missing, and let them close it. If a report satisfies all four, say
   so plainly and move on; an acceptance step that always finds something is a
   relay wearing a different hat.
9. **Builder opens the PR**, commits the gate record, and posts the reviewer's
   report to the PR thread. **The PR body names both models — which built and
   which gated**, because nothing else in the artefact does: the trailer records
   the session tree's root rather than the builder (step 4), and the
   `Generated with Claude Code` footer names no model at all. Settings cannot
   supply it either — `attribution.pr` in `settings.json` takes a literal
   string with no placeholder, while the builder's model varies per ticket
   inside one batch. So the builder writes it, or it is not recorded.
10. **Hold every worktree — the reviewer's as well as the builder's — until the
   ticket is finished.** The reviewer's used to come down earlier, once its record
   was pushed and its exchange with the builder had ended. **That condition cannot
   be evaluated**: measured twice on 2026-09-03, once from "the PR exists" and once
   from *both agents reporting closed*, and both times the exchange resumed — a
   builder can always push one more commit and wake its reviewer, and neither is
   lying when it says it is done. The second removal landed mid-`npm run check` and
   cost a verification round. Holding costs ~18 MB; removing early costs an agent
   its tools mid-command. If you do take one early, **tell that agent you did it,
   unprompted** — from inside, your removal and the documented auto-reclaim are
   indistinguishable. See [reference/worktree-hygiene.md](reference/worktree-hygiene.md).
11. **Check the merge landed what it was supposed to.** Not polling — one look,
   after the fact. See _After a merge_.
12. **Append this session's row to [reference/history.md](reference/history.md)**,
   in the schema that page fixes. This is the step that makes the next session
   better than yours, and it is the one with nothing forcing it — no gate fails,
   no test goes red, and a session that skips it looks exactly like one that had
   nothing to say. **The highest-value field is the last one**: what the skill got
   wrong, was missing, or made impossible. Six such defects came out of one
   session on 2026-09-02 and every one of them surfaced only because the
   orchestrator was asked; none would have been recorded by a loop that just
   worked.

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

**There is a second look, before the merge, and it is yours because of where you
stand, not because it is impossible.** A branch cannot report its own state: any
commit that corrects a status claim invalidates it, so a record's "green at the
tip" is stale the moment it is written — see
[reference/records.md](reference/records.md). That much is structural, and it
rules out two of the three participants. A **builder** stops before the PR and
writes to the branch, so the commit recording its check moves the sha the check
was about. A **gate** stops before the merge and writes its record earlier still.
**You are the only participant still alive at merge time who is not writing to the
branch**, so take it as the last act before handing the merge over — one call per
branch about to land:

```
gh run list --branch <branch> --limit 6 --json workflowName,status,conclusion,headSha,event
```

`--json` rather than the table, because the failure this guards against is reading
a run list by eye: `cancelled` is a *completed* run, and a glance counts it as
green. **Name the sha in whatever you conclude** — your look decays the same way a
record's does, and a relayed status claim was measured going stale between being
taken and being read on 2026-09-04. This is not the look below, which happens
afterwards and answers a different question.

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

**On a defect, say whether the branch itself introduces it.** That turns the
question from tolerating an existing wart into shipping a new one, and it is the
fact the user is deciding on. Measured 2026-09-04: framing a defect as one to
*defer* without saying the file was one the branch itself adds cost two round
trips on a single decision, and the correction reached the builder mid-revert.

How to ask is the root `CLAUDE.md` rule and is not repeated here. What is specific
to running a board is the rest of this section.

**A subagent's report can carry a decision you have to forward.** Builders and
reviewers are told to hand you open decisions as options rather than settling
them. When one does, that is yours to put to the user — not to absorb.

**And when the answer goes back down, send how it was taken, not only what it
was.** A builder can say "the owner directed this" and a reviewer has no way to
check that from inside its sandbox — measured 2026-09-04, where a gate correctly
declined to extend its PASS over a commit whose only warrant was that claim. You
are the only participant who can supply the warrant, so relay it: the question
asked, the options, which was chosen, and **whose recommendation it went
against**. That last field is not decoration. Both decisions that overrode a
builder's own recommendation in that session exposed a real pre-existing defect
that only implementing the overridden option could have found — a CLI parser that
consumed a value for every flag, including the first one that takes none, and a
contract declaring a field non-null that arrives `null` from a real binary. A
recommendation is an argument, not a measurement.

**Batch them.** Each question stalls the board. Hold them to a checkpoint unless one
blocks a running agent.

**The exception that pays best: a slice's own decision, asked while its builder is
still alive.** If you dispatched a decision-independent slice (step 2), that
ticket's question is the one to ask *first* rather than hold — an answer that
reaches a running agent costs one message, where the same answer after it
finishes costs a resume, measured in this repo at 100–330 k regardless of how
small the remaining work is. Measured 2026-09-03: a slice dispatched as "steps 1–2
only, the ticket stays open" was widened to the full ticket by a single message,
because the answer arrived before the builder stopped. Ask early, and say in the
message which part of the original dispatch you are reversing.

**Read the options out of the ticket yourself before you put them to the user.**
This is the one relay where a subagent's paraphrase is not good enough, and it is
not the same rule as _do not launder subagent claims_. A relayed *finding* can be
marked unverified and travel safely; a relayed *option* cannot, because the user
acts on it — a costing that drifts becomes the basis of a decision nobody can
audit later. Cost is a few `sed` calls against the decision headings. Measured
2026-09-03: the map's extraction was faithful and still corrected the
orchestrator's own count on the way past, which is the argument for reading, not
against it.

**An option's stated mechanism is a proposal, not a fact — and answering the
decision does not verify it.** The sharpest laundering route on this page, because
it does not feel like relaying at all. A ticket or a subagent writes an option as
*"do X by doing Y"*; you put it to the user faithfully; the user picks it; and Y
arrives in your dispatch as an instruction that nobody ever checked. The
faithfulness of the relay is what disguises it — you were careful with the words,
and the words carried an unverified claim.

Measured 2026-09-03. A builder surfaced a decision whose option A read "guard that
call and **route failure to `options.onFailed`**". The user chose to fold the work
in, and the orchestrator relayed `onFailed` as the mechanism. A gate then
established it is **not reachable** from that call site — it is wired to a
different handler on the same socket, and the throw is a synchronous exception in
the success path, not an event that socket emits. The builder's own proposal had
been wrong about its own file, the orchestrator had repeated it without checking,
and only the gate stopped it being built.

**So separate the outcome from the route when you dispatch a decided option.** Say
what must be true — *a failure here must fail fast with a typed code instead of
escaping* — and say explicitly that the mechanism named in the option is unverified
and the builder should choose the route. That costs one sentence and it puts the
decision's *purpose* beyond the reach of its *guess*.

**"Accept the baseline" is rarely zero work — check before you report it as
closing anything.** An option that reads *do nothing* usually still leaves the
ticket's unconditional steps standing. Measured 2026-09-03: a four-option decision
was answered with the zero-work option, and the ticket's own Build still required
amending an ADR "whichever option wins" and clearing an outstanding alert
"whichever way this goes" — the second explicitly noting no option retires it
retroactively, *do nothing included*. So the answer converted a blocked ticket
into a small dispatchable one rather than closing it. Read the Build for steps
that survive every option before telling the user a decision cost them nothing.

**And hold a question until you can bring a measurement rather than a guess.**
When the decision turns on a fact nobody has yet, asking now buys an opinion and
usually costs a second question later. Put the fact into a gate prompt instead —
name it as blocking a decision you owe the user, so the reviewer prioritises it —
and ask once, with the number attached. In the fourth session the open question
was whether a fix should widen to a neighbouring row; the gate was asked to
*measure* whether it could, came back with one failing test out of 732 — and that
one the row already pinned as a defect — and the user decided on that rather than
on two plausible arguments. The delay was one gate the branch was taking anyway.

**A running builder can produce that measurement too, and the line to hold is
committing, not measuring.** Measured 2026-09-04: a builder whose remedy was still
an open owner decision ran the reproduction anyway — it was needed under *every*
candidate answer, "do nothing" included, so running it was never a bet. Building
the mechanism on top of it was the bet, and it paid, because it converted "we
could fix this" into "the fix exists, measured and reviewer-validated", which is
the fact that changed the owner's answer. What kept it safe was **committing and
pushing nothing while either decision was open**, so the tree each party inspected
was never ambiguous. Ask for the measurement freely; make that last condition
explicit rather than assumed.

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

**Its mirror is worse, because the outcome cannot catch it: a relay's *citation*
can be wrong while its conclusion is right.** Measured 2026-09-04. An orchestrator
told a gate that the builder's model was inferred off `builder.md`'s `hard`
difficulty row. The ticket carried no `difficulty` at all — `hard` was a
*sibling's*, in the same batch — and both rows resolve to the same model, so the
error was invisible in the answer and reached a committed gate record. The
reviewer transcribed it because it was given as fact, which was correct of it.
**So check the rule you are about to cite, not only the answer it gives you**, and
attribute the correction when one lands: the record has to show which link failed,
or the next reader blames the gate. How to withdraw a claim that reached a record
is in [reference/records.md](reference/records.md).

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

When a batch runs long, say what the next batch should do differently. The numbers
themselves are the table below, which is not conditional on the batch being long.

### End every batch with a per-agent accounting table

Unasked, and whatever the batch cost. The owner had to ask for this by hand on
2026-09-05, which is the tell: "report cost honestly" is satisfiable by a
sentence, and a sentence hides all three things a table makes plain.

| PR | Status | Model | Agent | Task | Tokens |
| --- | --- | --- | --- | --- | --- |

**One row per agent, not per ticket** — an agent killed and replaced is two rows,
which is the only place the duplicated work is visible at all.

- **PR** — the pull request the agent's work landed in, or `—` for batch-wide work
  like the seam map.
- **Status** — the PR's state as you write, from
  `gh pr list --json number,mergeable,statusCheckRollup`, not from memory of an
  earlier look.
- **Model** — `opus` / `sonnet` / `haiku` / `fable`, and **recorded fact, never
  inference**. Both halves are already written down by the time you need them: the
  builder's is what step 3 tells you to pass explicitly at dispatch, the gate's is
  pinned in [`.claude/agents/ticket-reviewer.md`](../../agents/ticket-reviewer.md)'s
  frontmatter and is a file read. If either had to be inferred, the row says so.
- **Agent** — the `subagent_type`.
- **Task** — one line, including how it ended where that matters: killed by an
  interrupt, resumed, replaced.
- **Tokens** — that agent's last-observed `subagent_tokens`.

Three caveats, all measured 2026-09-05/06:

- **`subagent_tokens` are cumulative per agent**, so a resume is folded into the
  figure rather than added to it. Summing an agent's successive reports
  double-counts it.
- **Some agents never report a total.** An agent whose final turn ends in a
  `SendMessage` rather than a completion delivers no usage block, and one killed by
  a rate limit or an interrupt may deliver none either. Write `not reported` in the
  cell — **do not omit the row and do not estimate the cell**, because an omitted
  row makes the table read as complete when it is not. State the observed total
  *and* the number of agents missing from it.
- **This is not the bill.** [reference/sizing.md](reference/sizing.md) records what
  fraction of the all-in volume `subagent_tokens` is once cache reads are counted.
  The table compares agents against each other honestly and says nothing directly
  about cost.

What it shows that prose reliably hides, all three from the same batch:

- **Where the cost actually went.** One branch — repo-22, PR #161 — took roughly a
  third of that batch, and **its gate cost about what its own builder did**:
  411,966 against 406,732, last-observed cumulative figures a 1.3% apart, which is
  a tie and not a ranking. The comparison that carries weight is the other one —
  that gate cost **roughly 60% more than the next most expensive builder in the
  batch** (256,418). Either way it inverts `sizing.md`'s "builder round-trips cost
  more than gates", which is true per *round* and stops being true when one branch
  takes six gate rounds. A prose summary surfaces neither the inversion nor how
  narrow the first margin is.
- **Whether the model-difference rule held**, per branch rather than as a claim.
  Step 4 exists because a builder that picks its own reviewer is the thing being
  checked choosing its checker; a Model column turns compliance into something a
  reader can audit at a glance.
- **What an interruption cost.** A replaced agent sits in its own row beside its
  replacement instead of vanishing into a total.

It is also most of step 12's work: `reference/history.md`'s `subagent tokens` field
wants exactly this split, so the history row becomes a transcription rather than a
reconstruction from memory.
