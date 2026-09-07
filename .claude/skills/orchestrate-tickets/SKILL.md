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

**An instruction lives in exactly one file, and everywhere else is a pointer to
it.** This page is instructions and their dated measurements; the session that
earned each one is in `reference/history.md`, and the mechanics are on the other
reference pages. Writing a rule where it is needed instead of linking to it is how
this page reached 674 lines before repo-21 cut it back.

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
| [reference/history.md](reference/history.md) | Appending step 12's row, or looking up the session behind a rule here — read it only if you are revising this skill |

## The loop

1. **Intake.** `gh pr list` first, then `npm run status -- --ready`: a ticket file
   says `ready` until something merges. Read each candidate's opening section, not
   its status line, and `git fetch` again immediately before you dispatch.

2. **Map the seams, then ask which batch** — never pick it yourself. Dispatch
   `subagent_type: "seam-mapper"` over the candidate ids; reading the tickets
   yourself costs ~27,800 est. tokens of the surviving context (2026-08-30).

   `--ready` excludes `needs-decision`, so a blocked board shows in the status call
   (2026-09-03: nine ready, eight undispatchable). Tickets filed before that status
   need the decision grep — see _Fallbacks and caveats_.

3. **Dispatch builders** — `subagent_type: "builder"`, one per ticket; the agent
   definition carries the worktree and the scope rules, your prompt the ticket.
   **Pass the builder's model explicitly** — see _Which model built it_.

4. **Gate each finished branch** — `subagent_type: "ticket-reviewer"`, spawned by
   **you and never the builder**: a builder picking its own reviewer is the thing
   being checked choosing its checker. **Pass the gate's model explicitly too.**

5. **The reviewer sends its findings to the builder itself**, as one batched
   message, **and the same findings to you in full** — not a status line saying it
   did. Name the builder in the gate prompt so it knows whom to address.

   Expect a summary anyway, so **read the committed record out of `git show` before
   step 8** (2026-09-03: a reviewer reported only "findings sent"). Both recorded
   relay corruptions in this repo were introduced at this hop, by neither agent.

6. **They iterate until they agree the work is done.** That agreement is theirs to
   reach, not yours to adjudicate; you re-enter only for a disagreement they
   cannot settle and for any open decision either surfaces.

   **This is a chain of wakes, not a conversation**: each side ends its turn after
   it sends, and `SendMessage` wakes the other. Sideways wakes work (2026-09-03);
   upward wakes are disputed, so spend one `ListAgents` rather than assuming.

7. **Both report to you when they are done**, separately — two accounts of one
   exchange by two models. **Ask each for its method, not only its verdict**:
   describing *how* you checked surfaces what describing *what* you concluded cannot.

8. **You accept, or you send it back. The work is not done until you do** — four
   checks, not a re-review. Does each report say what was *run*, and where each
   quote is? Do the two accounts describe the same exchange?

   Does every `Done when` line carry a verdict naming a spec file and line rather
   than "covered"? Is there an open decision in either? **You judge whether they
   are finished, not whether they were right**: send back the line lacking evidence.

9. **The builder opens the PR**, commits the gate record, and posts the reviewer's
   report to the PR thread. **The PR body names both models — which built and
   which gated** — because nothing else in the artefact does.

10. **Hold every worktree — the reviewer's as well as the builder's — until the
    ticket is finished.** "The exchange is over" cannot be evaluated: tested twice
    on 2026-09-03, both times it resumed. Announce any early removal to that agent.

11. **Check the merge landed what it was supposed to.** Not polling — one look,
    after the fact. See _After a merge_.

12. **Append this session's row to [reference/history.md](reference/history.md)**, in
    the schema that page fixes. Nothing forces it, and **its last field earns the
    page** — what the skill got wrong (2026-09-02: six, all only because it was asked).

**The PR is not the end of gating; the merge is.** A branch that has already shown
its corrections can be wrong may open its PR under conditional ship authority *and*
take one narrow gate afterwards, scoped to the corrections. Not the default.

## Which model built it, and which gated it

**Both halves are knowable before either agent runs, and neither needs
`resolvedModel`.** Write them down at dispatch rather than inferring them after.

- **The builder's** comes from the ticket, not from you: read its `difficulty` off
  `npm run status -- --json` and map it with the table at
  `.claude/agents/builder.md:21-25` "| `mechanical` | `haiku` |".
  Absent means inherit — name your own model rather than leaving it unstated.
  **Never rate an unrated ticket yourself**; you have not read it, which is the
  point of step 2.
- **The gate's** is a file read: `.claude/agents/ticket-reviewer.md:6` "model: sonnet".
  Pass it explicitly anyway, including when Sonnet is what you wanted. Sonnet is
  right when the builder ran Opus or Haiku; pass `model: "opus"`
  when the builder ran Sonnet — **never on a `hard` ticket**, which pins `opus`
  rather than inheriting. Never `haiku`, never `fable`.
- **Check the pairing per ticket, not once per batch.** A `mechanical` ticket
  dispatches `haiku` and a `hard` one `opus` while their siblings inherit.
- **Three documented paths override an explicit `model`**, so a dispatcher writing
  "gated by Sonnet" should know what could make that false:
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, an `availableModels` allowlist, and `fork`.
  **Relayed from Claude Code's documentation and not verified in this tree**, along
  with fallback chains that can move a model mid-run — which is why a record says
  "dispatched as", not "ran as".
- **Never ask an agent what model it is.** The "You are powered by the model named
  X" line is not guaranteed to exist for a subagent, and a claim an agent makes
  about itself is checked from outside — the self-report row under _Relaying_.
- **The commit trailer cannot stand in for either half.** It is built once per
  session tree from *your* model and inherited by every subagent, so a `mechanical`
  ticket built on Haiku lands a commit signed `Claude Opus 5` (measured 2026-09-06,
  against the binary and by hand; 480 trailers across all refs name no other model,
  which is the inheritance and not evidence Opus built them).

Doing both makes the comparison a fact rather than an inference, and the record
should say so. Measured before any of this was written down: **11 tickets, 22
gates, none gated by a different model than built it** (2026-08-30). If you ever do
need `resolvedModel` itself read, three routes exist and only one is measured in
this tree — [reference/dispatching.md](reference/dispatching.md) carries them.

## Where a gated pair fails, and the test for each

| Failure | Its test |
| --- | --- |
| **A pair that agrees too easily** — two agents that want to be done converge on "addressed" without either running anything | The gate prompt, before the fact: demand reproductions and a positive control. Then step 8's first check |
| **A stalled exchange** — both stop, each treating the gate record as the other's next move. Nothing goes red: `npm run status` reads `done`, the branch is pushed, both reports say finished (2026-09-04) | One command per ticket: `git show <branch>:<ticket-path>` piped to `grep '^## Review'`. Empty means the exchange is still open, whatever either agent told you |
| **A decision relayed without its provenance** — no agent can verify authority from inside its own sandbox, so "the owner directed this" is unwarranted on its face (2026-09-04: a gate correctly declined to extend a PASS over such a commit, and the round was lost) | The record, not a command. A relayed decision names the question asked, the options, which was chosen, and **whose recommendation it overrode** |

`^## Review` is right for a *live* branch because
`.claude/agents/ticket-reviewer.md:10` "return a `## Review` section as text" says
so. It under-matches historical tickets, where `## Gates` and `## Gate 1 — …` also
occur: 68 files match `^#{2,3} (Review|Gates?)` against 51 for `^## Review$`,
measured 2026-09-07 over `docs` and `tools`. Say which of the two you mean.

## After a merge

**A standing rule against polling CI is not a reason never to look.** The rule
exists so nobody watches a run to completion. Look once, and there are two looks.

**Before the merge, and it is yours because of where you stand.** A branch cannot
report its own state: any commit that corrects a status claim invalidates it, so a
record's "green at the tip" is stale the moment it is written (see
[reference/records.md](reference/records.md)). A builder stops before the PR and a
gate earlier still, so **you are the only participant alive at merge time who is
not writing to the branch.** One call per branch about to land:

```
gh run list --branch <branch> --limit 6 --json workflowName,status,conclusion,headSha,event
```

`--json` rather than the table, because the failure this guards against is reading
a run list by eye. **Name the sha in whatever you conclude** — your look decays the
same way a record's does (2026-09-04: a relayed status claim went stale between
being taken and being read).

**After the merge, one more call: `gh run list --branch main --limit 10`, and read
the `push` rows.** Green PR checks say nothing about `push`-triggered jobs — they
are different events with different jobs, and a job that only runs on `push` to
`main` can fail on every merge while every pull request stays green, because nobody
is looking at `main`.

## Decisions

Bring the user a decision whenever two readings lead to materially different work:
scope that widens past a ticket's declared packages, a contract-adjacent change, a
defect that ships today, an architectural choice two branches would both satisfy,
**or a branch about to file a ticket for work it could finish now** (see
_Fold it in, or file it_ in [reference/sizing.md](reference/sizing.md)). How to ask
is the root `CLAUDE.md` rule and is not repeated here.

**On a defect, say whether the branch itself introduces it.** That turns the
question from tolerating an existing wart into shipping a new one, and it is the
fact the user is deciding on. Measured 2026-09-04: omitting it cost two round trips
on a single decision, and the correction reached the builder mid-revert.

**A subagent's report can carry a decision you have to forward.** Builders and
reviewers hand you open decisions as options rather than settling them; that is
yours to put to the user, not to absorb. **And when the answer goes back down, send
how it was taken, not only what it was** — the provenance row above.

**Batch them.** Each question stalls the board. Hold them to a checkpoint unless
one blocks a running agent. **The exception that pays best is a slice's own
decision, asked while its builder is still alive**: an answer that reaches a
running agent costs one message, where the same answer after it finishes costs a
resume, measured in this repo at 100–330 k regardless of how small the remaining
work is (2026-09-03).

**Hold a question until you can bring a measurement rather than a guess.** Where
the decision turns on a fact nobody has, put the fact into a gate prompt — name it
as blocking a decision you owe the user — and ask once, with the number attached.
**A running builder can produce that measurement too, and the line to hold is
committing, not measuring**: ask for the reproduction freely, and say explicitly
that nothing is committed or pushed while either decision is open (2026-09-04).

**"Accept the baseline" is rarely zero work.** An option that reads *do nothing*
usually leaves the ticket's unconditional steps standing — read the Build for the
steps that survive every option before telling the user a decision cost them
nothing (2026-09-03).

**Ask whether to parallelise at intake, not after the collision.**
[reference/concurrency.md](reference/concurrency.md) says never to run two tickets
over one seam; the failure that costs is asking late, when both are half-built and
every option is bad. The overlap is cheap to see before dispatch.

**When two gates disagree, relay the disagreement.** Do not adjudicate it and do
not average it: give the builder both readings with their evidence and no verdict,
and say explicitly that concluding both gates are wrong is an available answer
(2026-08-24 — the builder proposed a third reading neither gate held, and a further
gate was still needed to say what kind of claim it was).

### Relaying: fourteen costumes of one mistake

**Compressing something the receiving agent needed in full.** Each row is one
instruction; where the shape has a worked example it is in
[reference/history.md](reference/history.md) under the same name.

| The shape | The instruction | Measured |
| --- | --- | --- |
| A relayed **option** | Read the options out of the ticket yourself before putting them to the user. A relayed *finding* travels safely marked unverified; an option does not, because the user acts on it | 2026-09-03 |
| An option's stated **mechanism** | A proposal, not a fact, and answering the decision does not verify it. Dispatch the outcome — *this must fail fast with a typed code* — and say the named route is unverified | 2026-09-03 |
| A subagent's **claim**, repeated as yours | Be able to say who ran it. A vivid failure scenario from a report is a hypothesis until someone renders it | 2026-08-22 |
| A **caveat** where a command would do | Where checking is one command — a file count, a config flag, a quoted line — spend it rather than caveating. Reserve the caveat for what genuinely cannot be checked from here | 2026-08-24 |
| An **unmarked** relay | "The ticket says X; I have not checked" costs a sentence and stops the chain. Without it three links formed silently and only the middle one was cheap to break | 2026-08-23 |
| Your own **summary**, sent downstream | Relay the reproduction, not the verdict, and say the builder should push back rather than transcribe. Every builder in the fourth session corrected something | 2026-08-23 |
| A finding whose **premises are all true** | Checking a finding's premises is not checking the finding; only running it is. Relay the premises **as premises** | 2026-09-01 |
| A wrong **citation** under a right conclusion | The outcome cannot catch this one. Check the rule you are about to cite, not only the answer it gives you, and attribute the correction when one lands | 2026-09-04 |
| A fix relayed without its **mechanism** | Ask *"why did the argument not transfer?"*, not for a corrected number. Both generalisations quoted on this page exist because a relay asked; neither builder volunteered it | 2026-08-24 |
| A finding accepted **unreproduced** | Make the builder reproduce it first — not to doubt the reviewer, but to put the builder in contact with the gap. It also catches the reviewer being wrong, which happens | 2026-08-24 |
| A **described** artifact | Paste anything the builder must *commit*, *post* or *quote*. A description is not a smaller version of a record; a builder asked to commit one it could not find correctly stopped, and the round was lost | 2026-09-01 |
| A result read **at a glance** | `cancelled` is a *completed* run and a glance counts it as green. Take the measurement with `--json`; four glance-readings turned up in one batch, in prose every time and in citations never | 2026-09-05 |
| A **disposition** marked "accepted" | A disposition is a relay, and "accepted" is the word that hides an unmeasured one. **Gate a disposition by measuring what it claims changed**, not by checking the finding is marked closed | 2026-09-05 |
| A claim an agent makes **about itself** | Its tools, its model, its lifecycle are self-reports, and a self-report is checked from outside — see the table below for the one-call check per field | 2026-09-03 |

**A claim an agent makes about itself — its tools, its model, its lifecycle — is a
self-report, and is checked from outside.** It bites at dispatch, at gate and at
report time, which is why the rule is here and its per-field check is one call:

| Field | The one-call check |
| --- | --- |
| tools | ask it to *call* the tool ([reference/dispatching.md](reference/dispatching.md) carries the measurement: a builder reported eight against thirteen in its frontmatter) |
| model | the `model` parameter you passed at dispatch — _Which model built it_, above |
| lifecycle — running, held, released | `git worktree list` |

`reference/defect-shapes.md` uses "self-report" for a different thing: a builder's
claim about its **work**, checked by reproducing the work. These are two rules, not
one, and neither covers the other.

Two remedies on this page are not shapes of their own and belong to their
neighbours: **separate the outcome from the route** when you dispatch a decided
option, and **check the rule you are about to cite** rather than only the answer.

## Fallbacks and caveats

- **The decision grep** (step 2), for tickets filed before `needs-decision`:
  `grep -nE '^#{2,4} .*([Dd]ecision|[Oo]pen question)'` over the candidates.
  **Read the matches, do not count them.** On the 2026-09-04 board of six it got
  two wrong in opposite directions — one heading said the decision was *answered*,
  one ticket's open decision was a paragraph in its Build section under no matching
  heading — and the errors cancelled into a correct total, which is the worst way
  to be right.
- **The seam-mapper removes the ticket-reading cost, not the decision-reading
  one.** The same session paid 87,596 subagent tokens for the map and still read
  seven decision sections itself (2026-09-03). Those are disposable tokens where
  the ~27,800 are not, so this is not a loss — but do not budget the map as though
  it ends your reading.

## Reporting to the user

Lead with what changed and what needs them. Name the finding that matters and why
it would have bitten, not a list of everything found. Keep a board — ticket, gate
count, verdict, PR — and give merge order when branches are stacked or conflict.
When a batch runs long, say what the next batch should do differently.

**Close the batch with `# Done`** — `CLAUDE.md:259` "## Handing back" — once the
table below is written and nothing is waiting on the user's answer. Open pull
requests waiting to be merged do not disqualify it; they belong under the heading
with their merge order. A batch still carrying an open decision, or one whose gates
named repairs nobody has made, ends in the question instead.

### End every batch with a per-agent accounting table

Unasked, and whatever the batch cost. The owner had to ask for this by hand on
2026-09-05, which is the tell: "report cost honestly" is satisfiable by a sentence,
and a sentence hides where the cost went, whether the model-difference rule held
per branch, and what an interruption cost.

| PR | Status | Model | Agent | Task | Tokens |
| --- | --- | --- | --- | --- | --- |

**One row per agent, not per ticket** — an agent killed and replaced is two rows,
which is the only place the duplicated work is visible at all.

- **PR** — where the agent's work landed, or `—` for batch-wide work like the seam
  map. **Status** — the PR's state as you write, from
  `gh pr list --json number,mergeable,statusCheckRollup`, not from memory.
- **Model** — **recorded fact, never inference**; both halves are already written
  down by the time you need them, per _Which model built it_. If either had to be
  inferred, the row says so.
- **Agent** — the `subagent_type`. **Task** — one line, including how it ended
  where that matters: killed by an interrupt, resumed, replaced. **Tokens** — that
  agent's last-observed `subagent_tokens`.

Three caveats, all measured 2026-09-05/06:

- **`subagent_tokens` are cumulative per agent**, so a resume is folded into the
  figure rather than added to it. Summing an agent's successive reports
  double-counts it.
- **Some agents never report a total** — a final turn ending in a `SendMessage`
  delivers no usage block. Write `not reported`, **do not omit the row and do not
  estimate the cell**, and state the observed total *and* how many agents are
  missing from it.
- **This is not the bill.** [reference/sizing.md](reference/sizing.md) records what
  fraction of the all-in volume `subagent_tokens` is once cache reads are counted.

It is also most of step 12's work: `reference/history.md`'s `subagent tokens` field
wants exactly this split, so the history row becomes a transcription rather than a
reconstruction from memory.
