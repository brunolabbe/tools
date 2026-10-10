---
name: orchestrate-tickets
description: Run several tickets to merged pull requests at once by dispatching builder and reviewer subagents, gating each ticket before it lands. Use when asked to work through a batch of ready tickets, to "keep the board moving", or to act as orchestrator over parallel work — "pick up the ready tickets", "run dl-15 and pl-25 together", "continue working, dispatch agents". Not for a single ticket you can build yourself.
disable-model-invocation: true
allowed-tools: Bash(npm run status*) Bash(gh pr list*) Bash(gh pr view*) Bash(gh pr diff*) Bash(gh pr checks*) Bash(git fetch*) Bash(git log*) Bash(git worktree list) Bash(git show*) Bash(git diff*) Bash(git merge-tree*) Bash(gh run list*) Bash(gh run view*) Bash(git ls-remote*) Bash(node scripts/agent-cost.mjs*)
---

# Orchestrating a batch of tickets

You dispatch, you gate, you decide. **You do not build and you do not review.**
Your context is the one thing that must survive the whole batch, so it holds the
board and nothing else. **Keep that board as `board.md` in your scratchpad as
well** — every agent id, branch, head sha, gate verdict, owner answer and logged
defect, rewritten at each change. A session that dies takes its agents with it,
and the next session rebuilds the batch from that file (_If the session dies_).

**This page is the current rule and nothing else.** Why a rule exists is in
[adr/006](../../../docs/adr/006-gate-records-carry-no-citations.md) and in
`reference/history.md`.

**You never edit this skill, a role page, an agent definition, a rule under
`.claude/rules/` or any `CLAUDE.md`, and you dispatch no agent to.** That binds
your own initiative: a `repo-` ticket the owner selects at step 2 whose Build
edits one of those pages is the owner's edit, dispatched like any other and built
and gated under the page on `main`. You log what went wrong (step 12), and the owner runs a review session over the log once
in a while that changes the rules in one pass. An orchestrator that edits its own
rules adds one each time it is bitten and never removes any: 81 of 203 finished
tickets were process tickets by 2026-10-03 (adr/006). If a rule is so wrong that
the batch cannot proceed, put it to the user at once.

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
| [reference/history.md](reference/history.md) | Appending step 12's entry — read only its last section, never the archive above it |

## The loop

1. **Intake.** `gh pr list` first, then `npm run status -- --ready`: a ticket
   file says `ready` until something merges. `npm run status` reads the checkout
   you run it in, and `git fetch` does not move it — compare
   `git log --oneline -1 HEAD` with `origin/main`, and if they differ read ticket
   state with `git show origin/main:<path>`. Never reset the shared checkout
   while `ListAgents` shows a live peer. Then
   `node .claude/scripts/check-farm-freshness.mjs /workspaces/tools`: a shared
   checkout missing a package the lockfile declares stops every builder at the
   farm, and only `npm install` there, when no peer is live, repairs it
   ([reference/worktree-hygiene.md](reference/worktree-hygiene.md)).

2. **Map the seams, then ask which batch.** Dispatch `seam-mapper` over the
   candidate ids rather than reading the tickets yourself. Put the batch to the
   user with `AskUserQuestion`; never pick it. Every open ticket carries a
   `difficulty` — `npm run status` fails on one that does not — and you never
   rate or re-rate one yourself.

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
   moves: a `Done when` line left unmet by an open question leaves nothing to
   fix until it is answered. `gate.md` grades it CONCERNS when the build does
   what the brief's Decision says and no test contradicts the line, and FAIL
   when a test asserts the opposite. Then the whole round goes to one
   agent, each finding as the reviewer wrote it:

   | The round's findings | Go to |
   | --- | --- |
   | any one needs judgement — how, not only whether | the builder, resumed with `SendMessage`, carrying the mechanical ones too |
   | every one is mechanical, or only the landing is left | a fresh `fixer` |

   **The severity floor decides what opens a round.** A `high`, or a `med` that
   a `Done when` line depends on, is fixed. Every other finding is fixed in that
   same round only if a round is already open and the fix is fully stated by the
   finding; otherwise it stays in the record as written. A round is never opened
   for lows alone. **Below the floor, a finding whose fix is fully stated may
   still be applied by the lander, with no re-gate, when the owner says so**:
   put the recorded-unfixed list to the owner at the checkpoint with that
   option, and the record keeps each finding as the gate wrote it, marked
   _fixed at landing_. The owner took that path on seven tickets in five
   batches.

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
   refutation as a command and its output. It reviews the round's own commits
   only — `git log --no-merges <gated sha>..<new sha>`; a merge from `main`
   inside the range is not the round — and returns one new `### Gate 2`
   section.

   **Two gates is the default, and a third runs only when gate 2 itself raises a
   `high`, or when the owner asks for one** — then the owner's answer names its
   depth and scope, and the dispatch carries them. Anything less from gate 2 is handled by the floor in step 6 and
   checked by preflight and CI, not by another gate. If a third gate raises
   another `high`, stop and put the state to the user. Across 253 recorded gate
   sections, the 47 past gate 2 found no high (adr/006).

9. **Land it.** Whoever holds the last round lands it — the builder if it was
   resumed for it, otherwise a `fixer` — on ship authority in its own dispatch
   or a direct message from you. If a gate's table has an `awaiting` row, the
   lander first commits the ticket's `awaiting:` line. Then one command per
   ticket ([reference/records.md](reference/records.md)):
   `node scripts/review-record.mjs --land <ticket-path> <gate files…> --base origin/<base> --status done --title "<PR title>" --branch <branch>`.
   **A gate verdict conditional on a CI leg is read before the lander pushes**:
   the landing push cancels the gated sha's run. When the landing changed only
   the ticket file, the landing head's run stands for it, named in the thread
   comment. Then it posts each gate's full report to the PR thread, names every model in
   the PR body, and marks the PR ready — unless you are holding it as a draft
   for merge order, in which case you say so in a PR comment.

10. **Look once at the PR's finished checks** (`gh pr checks <n>`), then remove
    the ticket's worktrees: each clean, each head on origin, each agent finished
    and sent nothing since. If CI shows a problem, ask the owner whether to keep
    them. A lock names your own pid for every agent, so it is not a liveness
    test.

11. **After a merge, look once at `main`.** See _After a merge_.

12. **Close the batch by logging it.** Write one entry — the accounting table
    below, then the skill's defects — to a file in your scratchpad, in the shape
    `reference/history.md` fixes under _The log since the last review_, and
    have a `fixer` append it to that page verbatim and open a `docs(repo)` pull
    request. No gate: it is your own account, and the review session checks it
    against the transcripts. Ask every agent for the defects in its dispatch;
    each item names the page and heading it concerns and carries a reproduction
    — a command and its output. Change no rule. When the log holds about twenty
    items, or five entries, tell the user a review is due.

## Which model built it, and which gated it

The agent you dispatch is the choice; its definition in `.claude/agents/` is the
only copy of the model and effort. A change of lineup edits this table and those
files together.

| `difficulty` | Builder | Gate |
| --- | --- | --- |
| `mechanical` — code only | `builder-mechanical` (Haiku 5.5, high) | `ticket-reviewer-sonnet`, narrow: named attacks only |
| `standard` | `builder-standard` (Sonnet 5.5, high) | `ticket-reviewer-opus` (Opus 5.5, high) |
| `hard` | `builder-hard` (Opus 5.5, high) | `ticket-reviewer-sonnet` (Sonnet 5.5, xhigh) |
| maintenance — a rebase, a merge from `main`, one Log edit, a filing whose reproduction is in hand | `builder-mechanical`, prompt saying "maintenance" | none, or `ticket-reviewer-sonnet` where one runs |
| a docs-only chore — ticket files, tool docs, no source | `builder-standard` | one gate, narrow, after the PR opens |
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
sha in whatever you conclude. A default-setup `CodeQL` failure is read with
`WebFetch` on the check's `detailsUrl` from `statusCheckRollup`: the page lists
each alert's rule, file and line, where `gh pr checks` prints only `fail`
(verified 2026-10-10). Never run `gh api`, alone or inside a compound command.

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
- **An answer given on a premise a later measurement changed is re-asked, with
  the measurement.** lg-6's buffer answer, dl-91's "at most two inflations" and
  dl-97's excusal were each given on a builder's example and overturned by a
  gate's numbers; the owner re-chose each time.
- **An acceptance line that says "every" is reworded to an enumerable scope
  before dispatch**, or the gate can always find one more shape (dl-58).
- **While the owner is away, a reversible choice is taken, not held.** An away
  signal is the owner saying so; silence is not one, and neither is a cache
  expiry. Then a decision that meets **every** condition is taken on your
  recommended option without asking:
  - it is reversible by **one revert on each unmerged branch it touched**;
  - it is a path test: it touches no contract, no error taxonomy,
    `.claude/settings.json`, `.github/workflows/`, `Dockerfile`,
    `.devcontainer/allowed-domains.txt` or `.gitignore`'s `.claude/` allowlist,
    and adds no new path to any branch's own `git diff --name-only` against its
    base;
  - it changes no `Done when` line, takes no decision a ticket's `Done when` or
    Decision section reserves to the owner, and changes no gate verdict. A
    commit made after a gate qualifies only if it changes no assertion, no code
    under test, and no fixture, page or data a graded test reads;
  - you dry-ran it (_Dry-run before you name it_), and the choice does not
    override a builder's or a gate's recommendation.

  Anything else is still held, or filed as a ticket at close.

  **Flag each choice taken this way** in a comment on the pull request and in
  the report the owner reads on return, in the form `AskUserQuestion` would have
  used: the question, the options, the one taken, and the commit to revert, so
  the owner can overrule it in one line. For a commit made after a gate, name
  that gate's record, so the owner can order a re-gate. A choice taken this way
  is a taken choice, not an open decision at close.

  **This is an exception to two rules, and keeps both elsewhere.** It is an
  exception to _A subagent's open decision is yours to forward, not to absorb_,
  above, and to the root `CLAUDE.md` "Decisions" rule to ask with
  `AskUserQuestion`. The answer goes back down to the subagent labelled as
  **your choice under this rule, not the owner's**, with the question, the
  options and the one taken, so no Log records an owner's answer that was never
  given. It is also narrower than the rule that a decision arriving after the
  owner has signed off becomes a ticket and the turn ends: that rule closes a
  batch, this one keeps an unfinished batch moving, and a sign-off, not an away
  signal, is what moves a decision from here to there.

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

## If the session dies

Two of the five batches of 2026-10-06 to 2026-10-08 lost their session
mid-batch — once the orchestrator, once the host. Its subagents die with it and
cannot be messaged, and a worktree an agent left clean is reclaimed. The next
session reads `board.md` and the transcript, then for each remaining worktree
`git log <last known sha>..HEAD` and `git status --short`, before it decides
anything: local commits a builder never pushed are handed to a fresh agent by
name, not rebuilt; a gate that died is dispatched fresh for the round it was in,
and the gate files already in the scratch directory stand.

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

One row per agent, from `node scripts/agent-cost.mjs --agent <id> --agent <id> …`
— one id per flag; a bare second id is read as a file path — with the
rate date it prints and its `orchestrator` row as a floor. Status comes from
`gh pr list --json number,mergeable,statusCheckRollup`, not memory. Never
convert `subagent_tokens` into dollars: it excludes cache reads, which are most
of the bill.
