---
name: review-ticket
description: Review finished work against its ticket and record a gate on the ticket file. Use when work on a ticket is done and someone asks to review it, check it against its acceptance, or decide whether it can land — "review pl-16", "is dl-9 ready", "gate this before I open the PR". Checks acceptance-to-test traceability and this repo's own invariants, which a generic code review does not know about, rather than repeating a generic defect hunt.
allowed-tools: Bash(npm run status*) Bash(git diff*) Bash(git log*) Bash(git show*) Bash(gh pr view*) Bash(gh pr diff*) Bash(gh run list*)
---

# Reviewing a ticket

A defect review asks whether the code is wrong. This asks a different question:
**does the change do what its ticket said, can someone else check that, and did it
break any of the rules this repo learned the hard way?** The two are complementary
and only one of them is already built — so this skill runs `code-review` for the
first question and spends its own effort on the rest.

The output is a `## Review` section **committed to the ticket file by the
session that lands the round** — the builder, or `orchestrate-tickets`' fixer —
because `docs/01-TICKETS.md` already holds that the file is the unit of work
from brief to record. A verdict that lives in a terminal scrollback is not a
record — and neither is one written into a worktree that is about to be deleted,
which is the sharper version of the same rule and the reason the lander commits
it rather than the reviewer.

**Unless the pull request only *files* a ticket**, in which case the record goes
under a heading of its own and `## Review` stays empty until something is built —
`docs/01-TICKETS.md`, "The review gate". A brief has no work in it to check, and
`repo-12`'s board check reads `status: ready` plus a `## Review` gate record as
work that merged without its status being flipped. `dl-29` is the worked example:
gated as a filing, recorded under `## The gate on this filing`.

**And when the branch has no ticket at all** — a skill correction, a records
pass, anything the loop produces about itself — three of the steps below have no
object: step 1 has no ticket to read, step 4 has no `Done when` lines, and step 8
has no `## Log` to commit above. The dispatcher supplies the acceptance lines in
the prompt and names the commit message as the brief; the reviewer traces each
supplied line as it would a ticket's; and the section goes on the pull request
thread rather than into a file, per `orchestrate-tickets`' `records.md`. The
severity table below then grades the prompt's lines exactly as it would a
ticket's — an unproven one is still FAIL — and the reviewer says so in the
section, because a prompt's acceptance and a ticket's are the kind of difference
that otherwise gets argued in a round. Every other step applies unchanged. A gate
on 2026-09-20 needed all of this patched by hand in its prompt, which is what
this paragraph replaces.

## Arguments

`/review-ticket <id> [level]` — e.g. `pl-16`, or `dl-9 high`.

With no id, infer it: the branch name, then the ticket ids named in the commits on
this branch. If that is still ambiguous, ask rather than guess — reviewing the
wrong ticket produces a confident answer to a question nobody asked.

`level` is passed to `code-review` and defaults to `medium`. **Never `ultra`**: it
is billed separately and is the user's to trigger, not yours.

## A different model reviews

The agent that wrote the code does not review it. **A subagent on a different
model does**, and that is not ceremony. A model reading its own work re-runs the
reasoning that produced it: the assumption that felt safe while writing feels
safe while reading, and the blind spot is perfectly correlated. A second pass
from the same model mostly re-derives the same confidence. A different one has
not made this particular wrong turn.

So the invoking agent's job here is to dispatch, not to review:

| You are       | Dispatch to              |
| ------------- | ------------------------ |
| Opus          | `ticket-reviewer-sonnet` |
| Sonnet        | `ticket-reviewer-opus`   |
| anything else | `ticket-reviewer-opus`   |

Keyed on **you**, not on whatever wrote the code, because you usually cannot know
what wrote the code and you can always know what you are — and if you wrote it,
you are the model whose reading is about to be re-run.

**The reviewer is `sonnet` or `opus` — never `haiku`, never `fable`.** The rule
is "a different model", not "a cheaper one": the small models are the wrong tool
for a job whose whole content is holding a ticket, a diff and a page of
invariants in mind at once, and a gate they produce is worth less than no gate,
because it still reads as PASS.

Dispatch with the Agent tool — `subagent_type` from the table, and **no `model`
parameter**: each definition in `.claude/agents/` pins its model and effort by
full id, and a `model` passed at dispatch overrides the model while keeping the
definition's effort — a pairing nobody chose. That is relayed from the sentinelle
repository and not measured here; Claude Code's sub-agent documentation says a
definition's `effort` overrides the session's, and nothing about a per-call
`model`. Hand it the ticket id, the
ticket's path, the base sha and the head sha. The definition carries the rest:
it reads [gate.md](gate.md) and the orchestrator's gate role from `origin/main`,
has no `Write`, `Edit`, `Agent`, `Skill` or `SendMessage` tool, and gets its
own worktree. Those omissions are what make "returns text, commits nothing" and
"runs the defect hunt itself" facts rather than requests.

**Do not tell it to call `EnterWorktree`, and do not write its setup into the
prompt.** Its checkout, farm and build order is in the gate role, and a gate that
reads the wrong tree does not fail loudly — it produces a fluent section marking
every acceptance line `unproven`. So check the sha it names in its report is the
one you gave it.

**Hand it the ticket id and the shas — not your reading of the ticket, and not
what the build claims.** A caller who summarises the acceptance into the prompt anchors
the reviewer to its own reading of what the ticket asked, which is a quieter
version of the thing this whole split exists to prevent. The reviewer opens the
ticket itself; that is step 1.

**Background is the default, and it is correct.** An earlier version of this page
said to dispatch in the foreground, on the grounds that backgrounding "turns the
wait into polling". Neither half held: every one of the 34 dispatches in the
recorded window ran async regardless, and the harness now notifies you when an
agent returns, so there is nothing to poll. Pass `run_in_background: false` only
when your very next action genuinely depends on the gate and nothing else could
usefully happen meanwhile.

**Do not read a running agent's output file to check on it.** `TaskOutput` is
deprecated for local agents and that file is a symlink to the agent's *full
conversation transcript* — reading it overflows the context this whole split
exists to protect. To see what is running, `ListAgents`. To probe one that looks
stalled, send it a message (see `orchestrate-tickets`, which explains why a quiet
worktree is not a liveness signal). To end a runaway, `TaskStop`.

**The subagent returns the `## Review` section as text; the builder commits it to
the ticket, on the branch under review, verbatim, and discloses its own
authorship.** It returns it rather than writing it, and that is the correction
repo-1 forced: a reviewer works in a worktree that is thrown away when it
reports, so a section written *there* was written into nothing. Two consecutive
gates on repo-1 left no trace in the repo at all, and the failure is silent in
the worst way — the caller saw a correctly-formatted gate, believed it was
recorded, and only the third reviewer thought to ask what a later reader could
check it against.

**The builder, not the caller that dispatched the reviewer, is the one who
commits it** — in a dispatched loop those are two different sessions, and it is
the builder who already holds write access to the branch. That costs the
independence a separate transcriber would buy: the subject of the review
becomes its own transcriber, and the disclosure note below plus the posted
report (step 8) are what is left standing in its place. In `orchestrate-tickets`
a mechanical last round is landed by its fixer instead, which holds write access
too and is a different model from the gate; everything below applies to it
unchanged.

So the builder lands it in `tools/<tool>/docs/work/<id>-*.md` above `## Log`,
in the branch's own commit, with `scripts/review-record.mjs` as step 8 says —
the script splices, formats and checks it in one run. Markdown is formatted in
this repo, and an unformatted table fails `npm run check`, which is the merge
gate; formatting is not a rewrite and does not conflict with committing it
verbatim, since it pads table cells to column width and touches nothing else.
**Each gate on a ticket is its own commit**: the script refuses to run on a
ticket dirty against `HEAD`, so land gate 1, commit, then land the next, and a
four-gate ticket is four commits (repo-55, 2026-09-20). A record with several
gates is restated at the current tip when a later round moves the lines an
earlier gate cited: a coordinate that resolves onto the repair is not a
citation of the defect, so re-resolve, or rewrite the finding's coordinate as
prose that names the sha it was true at.

**Verbatim is the whole point, and it is now the builder who could break it.**
Under the old wording a caller that edited the section had "handed the review back
to the model under review"; under this one the builder is transcribing a verdict
on its own work, which is the same hazard with a longer reach. Change nothing —
not a severity, not a row, not a hedge. If you disagree with a row, say so in the
Log under your own name, and leave the row standing.

**The disclosure note is required, not a habit.** Alongside the section, say in
as many words that you transcribed it and name what you altered or dropped from
the reviewer's text — "nothing" is a fine answer and still has to be said,
because the note, not an assumption of good faith, is what a later reader checks
the section against. Before this ticket the note had appeared three times in the
corpus, all on one ticket (`repo-30`) and nowhere else — a habit one builder had,
not a rule every builder followed.

**Then post the reviewer's report to the pull request thread** — see step 8. That
is what makes the transcription checkable: the section in the ticket and the
report in the thread are written by different models, and a reader can hold one
against the other. A gate that is not committed did not happen; a gate that is
committed with no report beside it cannot be audited.

**One model, not a panel.** Two models reviewing in parallel is not a second
opinion, it is two gates and no rule saying which one counts. A split of one gate
into angles on one model was trialled as a workflow whose verdict is computed in
code, and dropped: it found less than one gate, at 2.7× the cost
([repo-58](../../../docs/work/repo-58-trial-a-gate-split-by-angle.md)).

## Steps

Steps 1 to 7 are the gate's, and live in [gate.md](gate.md), which only the gate
agents read. Step 8 is the lander's — the session that commits to the branch
under review: the builder, or in `orchestrate-tickets` the fixer on a mechanical
last round.

8. **Commit the section, post the report, then say what would clear it.** This
   step is the builder's, and it has three acts. First, write the reviewer's
   returned text to a file, `## Review` as its first line (or `### Gate <n>` for
   a later gate), and run
   `node scripts/review-record.mjs <ticket> <section-file> [--gate <n>]`. The
   script finds the insertion point by heading form, never by a bare-text
   search — a first review lands above `## Log`, a later gate at the end of the
   existing `## Review` block — inserts the text verbatim, runs the formatter,
   then runs `citations.mjs --section Review --require-anchors
   --require-distinct-anchors` itself; on a failure it restores the ticket from
   `git show HEAD:<ticket>` and prints the checker's own output, so fix what it
   says and run it again. On success it prints a normalised diff between the
   section file and what landed, ignoring table padding and rule width: paste
   that into the Log as the disclosure note — say that you transcribed it and
   what, if anything, differs, "nothing" included — in the same commit. That is
   the check CI is about to run; catching it here costs one command, and
   catching it in CI costs a push. Where a citation is deliberately
   unresolvable — a coordinate quoted as the evidence of a finding — declare it
   with `<!-- citations: evidence file.ts:120 -->` in the section file before
   running the script, and the declaration is itself an error if it excuses
   nothing. Before repo-55 this act was four hand steps, and each had failed at
   least once: a record spliced into the middle of an earlier one, a section
   red the moment it was committed, a record that went uncommitted, a
   formatter rewrap that split a citation from its anchor (2026-09-20). Second,
   **post the reviewer's report to the pull request thread** — `gh pr comment
   <number> --body-file <file>` — so the transcription can be audited against
   what the reviewer actually said; if the branch has no pull request yet, that
   duty attaches to opening it, and the report goes in the body or as the first
   comment. Third, report the gate to the user. A verdict is a record; the repair
   is work that has not happened — and a report that ends in a list of findings
   reads exactly like a report of work done. So name all three, and keep the
   third of them honest: give the gate, say plainly that **nothing has been
   fixed**, and then what clearing it would take, per finding or per cluster and
   concrete enough that the user can say yes to some and no to others. Then offer to do that work now, and wait for the answer. The findings
   are the author's to accept, argue with or defer: a CONCERNS gate is not a work
   order, and FAIL is a report rather than a decision to stop.

   **A gate report is not a hand-back.** `# Done` — CLAUDE.md's
   [Handing back](../../../CLAUDE.md) — belongs on the turn where the work is
   finished, and a CONCERNS or FAIL whose findings nobody has repaired is the
   opposite of that: it ends in the offer above, and waits. Only a PASS with
   nothing left to propose closes.

   A finding the ticket has already settled — a `low` it recorded as a deliberate
   product decision — is not work to propose. Say that it is settled and move on.
   That is the `dropped` line's honesty applied to a finding that lives but is
   not going to be acted on.

   This step exists because a review of pl-5 and pl-17 appended two CONCERNS
   gates naming seven `med` findings between them, reported the verdicts and
   stopped there, the last instruction having been carried out. The user had to
   ask twice — the second time "or you are saying it's already fixed?" — to learn
   which of the two acts had taken place.
