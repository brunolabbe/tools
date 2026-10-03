---
name: orchestrate-tickets
description: Run several tickets to merged pull requests at once by dispatching builder and reviewer subagents, gating each ticket before it lands. Use when asked to work through a batch of ready tickets, to "keep the board moving", or to act as orchestrator over parallel work — "pick up the ready tickets", "run dl-15 and pl-25 together", "continue working, dispatch agents". Not for a single ticket you can build yourself.
disable-model-invocation: true
allowed-tools: Bash(npm run status*) Bash(gh pr list*) Bash(gh pr view*) Bash(gh pr diff*) Bash(gh pr checks*) Bash(git fetch*) Bash(git log*) Bash(git worktree list) Bash(git show*) Bash(git diff*) Bash(git merge-tree*) Bash(gh run list*) Bash(gh run view*) Bash(git ls-remote*) Bash(node scripts/agent-cost.mjs*)
---

# Orchestrating a batch of tickets

You dispatch, you gate, you decide. **You do not build and you do not review.**
Your context is the one thing that must survive the whole batch, so it holds the
board and nothing else.

**This page is the current rule and nothing else.** Why a rule exists is in
[adr/006](../../../docs/adr/006-gate-records-carry-no-citations.md) and, for the
older ones, in `reference/history.md`, which is an archive: read it only when you
are revising this skill. A page that carries its own history gets skimmed, and
the rule on it gets missed — an orchestrator broke one rule three times in a
batch while this page stated it twice (2026-10-03).

## Reference

| Read | When |
| --- | --- |
| [reference/dispatching.md](reference/dispatching.md) | Writing a builder, gate or fixer prompt (steps 3, 5, 6, 8, 9) |
| [reference/sizing.md](reference/sizing.md) | A ticket that is blocked, tiny, or about to be filed instead of done |
| [reference/concurrency.md](reference/concurrency.md) | Two tickets over one file, a stacked branch, a new ticket id, a peer session |
| [reference/records.md](reference/records.md) | Landing a gate record (step 9) |
| [reference/defect-shapes.md](reference/defect-shapes.md) | Writing a gate prompt for a risky branch |
| [reference/worktree-hygiene.md](reference/worktree-hygiene.md) | A worktree that will not go away, or every agent dying at once |
| [reference/model-pairing.md](reference/model-pairing.md) | Why the pairing table reads as it does. Never needed to dispatch |

## The loop

1. **Intake.** `gh pr list` first, then `npm run status -- --ready`: a ticket
   file says `ready` until something merges. `npm run status` reads the checkout
   you run it in, and `git fetch` does not move it — compare
   `git log --oneline -1 HEAD` with `origin/main`, and if they differ read ticket
   state with `git show origin/main:<path>`. Never reset the shared checkout
   while `ListAgents` shows a live peer.

2. **Map the seams, then ask which batch.** Dispatch `seam-mapper` over the
   candidate ids rather than reading the tickets yourself. Put the batch to the
   user with `AskUserQuestion`; never pick it. In the same question, name every
   candidate with no `difficulty`: an unrated ticket builds on Opus, so ask the
   user to rate it or accept that. Never rate one yourself.

3. **Dispatch builders**, one per ticket, as the agent the pairing table names.
   Never pass `model`. Before each dispatch, create the ticket's scratch
   directories (`<scratchpad>/<id>/build`, `gate-1`, `gate-2`, `land`; `gate-3`
   if one is ever dispatched) and check
   the branch name is free. The builder builds, pushes, and **opens a draft pull
   request**, so CI — the Windows leg, the container jobs, CodeQL — runs while
   the gate works.

4. **Check the build report before you spend a gate on it**: a verdict naming a
   test for every `Done when` line, every command with its output, what it could
   not verify, any open decision, the head sha (confirm it with
   `git ls-remote --heads origin <branch>`), and the draft PR number. Send a
   failing line back now, while the builder's cache is warm. When a `Done when`
   line names several subjects, check all of them in one message.

5. **Gate each accepted branch** with the reviewer the pairing table names,
   spawned by you. **Give the gate nothing from the build** — the ticket, the
   base and head shas, the PR number, the scratch directory and what to attack.
   Never put ship authority in a gate prompt.

6. **Answer open decisions, then route the findings — pasted, never retyped.**
   A decision a gate or builder raised goes to the user before anything else
   moves: a `Done when` line left "unproven" by an open question keeps every
   later verdict at FAIL with nothing to fix. Then the whole round goes to one
   agent, each finding as the reviewer wrote it:

   | The round's findings | Go to |
   | --- | --- |
   | any one needs judgement — how, not only whether | the builder, resumed with `SendMessage`, carrying the mechanical ones too |
   | every one is mechanical, or only the landing is left | a fresh `fixer` |

   **The severity floor decides what opens a round.** A `high`, or a `med` that
   a `Done when` line depends on, is fixed. Every other finding is fixed in that
   same round only if a round is already open and the fix is fully stated by the
   finding; otherwise it stays in the record as written. A round is never opened
   for lows alone.

   After sending to a running or resumed agent, confirm delivery with
   `ListAgents` and with the artefact the message should produce.

7. **Accept each report, or send it back.** Five checks, not a re-review: what
   was *run*; a spec file and test name per `Done when` line; any open decision;
   the population read against the population that exists; and whether the
   builder's and the gate's accounts agree. Where they disagree, the
   disagreement is a finding, relayed with both verdicts and no verdict of
   yours.

8. **Re-gate once, scoped to the round.** Wake the same gate with `SendMessage`:
   the sha it gated, the new head, its own findings as it wrote them, and any
   refutation as a command and its output. It reviews
   `git diff <gated sha>..<new sha>` only and returns one new `### Gate 2`
   section.

   **Two gates is the default, and a third runs only when gate 2 itself raises a
   `high`.** Anything less from gate 2 is handled by the floor in step 6 and
   checked by preflight and CI, not by another gate. If a third gate raises
   another `high`, stop and put the state to the user. Across 253 recorded gate
   sections, the 47 past gate 2 found no high (adr/006).

9. **Land it.** Whoever holds the last round lands it — the builder if it was
   resumed for it, otherwise a `fixer` — on ship authority in its own dispatch
   or a direct message from you. One command per ticket
   ([reference/records.md](reference/records.md)):
   `node scripts/review-record.mjs --land <ticket> <gate files…> --base origin/<base> --status done --title "<PR title>" --branch <branch>`.
   Then it posts each gate's full report to the PR thread, names every model in
   the PR body, and marks the PR ready — unless you are holding it as a draft
   for merge order, in which case you say so in a PR comment.

10. **Look once at the PR's finished checks** (`gh pr checks <n>`), then remove
    the ticket's worktrees: each clean, each head on origin, each agent finished
    and sent nothing since. If CI shows a problem, ask the owner whether to keep
    them. A lock names your own pid for every agent, so it is not a liveness
    test.

11. **After a merge, look once at `main`.** See _After a merge_.

12. **Close the batch.** The accounting table below, then the skill's defects:
    ask every agent for them in its dispatch, and for each one either edit the
    page that holds the rule or file a ticket carrying a reproduction. Page
    edits go in one pull request for the batch, gated once, narrowly. No history
    row is written; the table is `agent-cost.mjs` output and goes in that pull
    request's body.

## Which model built it, and which gated it

The agent you dispatch is the choice; its definition in `.claude/agents/` is the
only copy of the model and effort. A change of lineup edits this table and those
files together.

| `difficulty` | Builder | Gate |
| --- | --- | --- |
| `mechanical` — code only | `builder-mechanical` (Haiku 4.5) | `ticket-reviewer-sonnet`, narrow: named attacks only |
| `standard` | `builder-standard` (Sonnet 5.5, high) | `ticket-reviewer-opus` (Opus 5.5, high) |
| `hard`, or absent | `builder-hard` (Opus 5.5, high) | `ticket-reviewer-sonnet` (Sonnet 5.5, xhigh) |
| maintenance — a rebase, a merge from `main`, one Log edit, a filing whose reproduction is in hand | `builder-mechanical`, prompt saying "maintenance" | none, or `ticket-reviewer-sonnet` where one runs |
| a docs-only chore — rule pages, ticket files, no source | `builder-standard` | one gate, narrow, after the PR opens |
| a round's mechanical fixes, and a landing | `fixer` (Sonnet 5.5, high) | the round's gate, woken |

- Never `haiku` for a gate or for prose and records; never `fable` for either
  role. The rule is "a different model", not "a cheaper one".
- A Haiku build is always gated: it has reported verifications it did not run
  (dl-36, pl-51).
- Confirm what ran from the transcript:
  `node scripts/agent-cost.mjs --agent <id>`. Never ask an agent what model it
  is, and never read it off a commit trailer.

## After a merge

A standing rule against polling CI is not a reason never to look. Look once,
twice in a ticket's life.

**Before the merge**, per branch, because you are the only participant not
writing to it:

```
gh pr checks <n>
gh pr view <n> --json headRefOid,statusCheckRollup
```

Not `gh run list`, which hides a `continue-on-error` leg, a `skipped` matrix
that reads `success`, and any check that is not an Actions workflow. Name the
sha in whatever you conclude. A default-setup `CodeQL` failure cannot be read
from this container: give the owner the check's `detailsUrl` from
`statusCheckRollup` and say the annotations are there. Never run `gh api`, alone
or inside a compound command.

**After the merge**:
`gh run list --branch main --limit 10 --json databaseId,event,conclusion,headSha`,
then `gh run view <id> --json jobs` for each `push` row. A `push` run cancelled
by the next merge reports no test conclusion at all.

## Decisions

Bring the user a decision whenever two readings lead to materially different
work. How to ask is the root `CLAUDE.md` rule. What is specific to a batch:

- **On a defect, say whether the branch itself introduces it.**
- **A subagent's open decision is yours to forward, not to absorb**, and the
  answer goes back down with its provenance: the question, the options, which
  was chosen, and whose recommendation it overrode.
- **Batch questions to a checkpoint**, except a slice's own decision while its
  builder is still alive: an answer to a running agent costs one message.
- **Dry-run before you name it.** An option's mechanism, its cost, a command in
  a dispatch, a fix you prescribe: each is a claim you are making. Run it on a
  scratch copy, price it from `agent-cost.mjs` figures of comparable agents,
  and for a contract or taxonomy change grep for exhaustive maps over the type
  first.
- **When two gates disagree, relay the disagreement** with both readings and no
  verdict; concluding that both are wrong is an available answer.
- **An acceptance line that says "every" is reworded to an enumerable scope
  before dispatch**, or the gate can always find one more shape (dl-58).

### Relaying

Every relay failure here has been one mistake: compressing something the
receiving agent needed in full.

- Paste findings, options and records; never describe or summarise them.
- A subagent's claim, or a premise inside an option, is a hypothesis until you
  can say who ran it. Where checking is one command, spend the command.
- Mark what you have not verified, in the sentence that states it.
- Relay a reproduction, not a verdict, and tell the receiver to push back
  rather than transcribe.
- Read results with `--json`, never at a glance: `cancelled` and `skipped` both
  read as green.
- An agent's claim about itself — tools, model, lifecycle — is checked from
  outside: call the tool, `agent-cost.mjs`, `git worktree list`.

## Reporting to the user

Lead with what changed and what needs them. Name the finding that matters and
why it would have bitten. Keep a board — ticket, gates, verdict, PR — and give
merge order when branches are stacked or conflict. Close with `# Done` once
nothing waits on an answer; open pull requests awaiting merge go under it, and
so does every finding the severity floor left recorded and unfixed, named as
such. A `high`, or a `med` an acceptance line depends on, that nobody has
repaired ends in a question instead.

**End every batch with a per-agent accounting table**, unasked:

| PR | Status | Model / effort | Agent | Task | Active / wall | Cold | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |

One row per agent, from `node scripts/agent-cost.mjs --agent <id> …`, with the
rate date it prints and its `orchestrator` row as a floor. Status comes from
`gh pr list --json number,mergeable,statusCheckRollup`, not memory. Never
convert `subagent_tokens` into dollars: it excludes cache reads, which are most
of the bill.
