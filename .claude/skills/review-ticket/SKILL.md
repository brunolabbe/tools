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
caller**, because `docs/01-TICKETS.md` already holds that the file is the unit of
work from brief to record. A verdict that lives in a terminal scrollback is not a
record — and neither is one written into a worktree that is about to be deleted,
which is the sharper version of the same rule and the reason the caller commits
it rather than the reviewer.

**Unless the pull request only *files* a ticket**, in which case the record goes
under a heading of its own and `## Review` stays empty until something is built —
`docs/01-TICKETS.md`, "The review gate". A brief has no work in it to check, and
`repo-12`'s board check reads `status: ready` plus a `## Review` gate record as
work that merged without its status being flipped. `dl-29` is the worked example:
gated as a filing, recorded under `## The gate on this filing`.

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

| You are       | Dispatch to |
| ------------- | ----------- |
| Opus          | Sonnet      |
| Sonnet        | Opus        |
| anything else | Opus        |

Keyed on **you**, not on whatever wrote the code, because you usually cannot know
what wrote the code and you can always know what you are — and if you wrote it,
you are the model whose reading is about to be re-run.

**The reviewer is `sonnet` or `opus` — never `haiku`, never `fable`.** The rule
is "a different model", not "a cheaper one": the small models are the wrong tool
for a job whose whole content is holding a ticket, a diff and a page of
invariants in mind at once, and a gate they produce is worth less than no gate,
because it still reads as PASS.

Dispatch with the Agent tool — `subagent_type: ticket-reviewer`, `model:` from the
table — and hand it the ticket id, the sha under review, and the diff range. The
agent definition at `.claude/agents/ticket-reviewer.md` already carries the rest:
it preloads this skill, has no `Write`, `Edit`, `Agent` or `Skill` tool, and gets
its own worktree. Those tool omissions are what make "returns text, commits
nothing" and "runs the defect hunt itself" facts rather than requests.

**Do not tell it to call `EnterWorktree`.** An earlier version of this page said
the reviewer's first instruction should be `EnterWorktree` with the builder's
worktree path. That is wrong and it stalls: a subagent's cwd is pinned at launch,
`EnterWorktree` by name is refused outright, and by path it moves only write
access while the Bash sandbox stays pinned to the parent's tree, refusing every
command including `pwd`. Two agents launched that way stalled, and one concluded
it should work in the shared checkout instead. The agent has `isolation: worktree`
and reaches the branch with `git fetch origin && git checkout --detach <sha>`.

**The failure that paragraph was guarding against is real, so keep guarding it**:
a reviewer that reads the wrong tree does not fail loudly. It produces a fluent,
correctly formatted gate that marks every acceptance line `unproven`, which reads
exactly like a review that ran and found the work wanting, and nothing downstream
catches it — the section still names a range and still cites the ticket. That is
why the agent is told to print `git log --oneline -1` and a `--stat` before
reviewing anything: name the sha you gave it in the report, and check it came
back.

**Hand it the ticket id, the sha and the diff range — not your reading
of the ticket.** A caller who summarises the acceptance into the prompt anchors
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

**The subagent returns the `## Review` section as text; the caller commits it to
the ticket, on the branch under review, verbatim.** It returns it rather than
writing it, and that is the correction repo-1 forced: a reviewer works in a
worktree that is thrown away when it reports, so a section written *there* was
written into nothing. Two consecutive gates on repo-1 left no trace in the repo
at all, and the failure is silent in the worst way — the caller saw a
correctly-formatted gate, believed it was recorded, and only the third reviewer
thought to ask what a later reader could check it against.

So the caller writes it into `tools/<tool>/docs/work/<id>-*.md` above `## Log`,
in the branch's own commit, then runs `npx oxfmt` on the ticket file — markdown is
formatted in this repo, and an unformatted table fails `npm run check`, which is
the merge gate. Formatting is not a rewrite and does not conflict with committing
it verbatim: it pads table cells to column width and touches nothing else.

**Verbatim is the whole point, and it is now the caller who could break it.**
Under the old wording a caller that edited the section had "handed the review back
to the model under review"; under this one the caller is transcribing a verdict on
its own work, which is the same hazard with a longer reach. Change nothing —
not a severity, not a row, not a hedge. If you disagree with a row, say so in the
Log under your own name, and leave the row standing.

**Then post the reviewer's report to the pull request thread** — see step 8. That
is what makes the transcription checkable: the section in the ticket and the
report in the thread are written by different models, and a reader can hold one
against the other. A gate that is not committed did not happen; a gate that is
committed with no report beside it cannot be audited.

**One reviewer, not a panel.** Two models reviewing in parallel is not a second
opinion, it is two gates and no rule saying which one counts.

## Steps

These are the reviewing subagent's steps, not the caller's — except step 8, which
is the caller's alone.

1. **Read the ticket** — `tools/<tool>/docs/work/<id>-*.md`. Its **Done when**
   lines are the acceptance criteria; its **Build** steps and traps are what the
   author expected to be hard. Read the tool's `CLAUDE.md` too.

2. **Establish the diff.** `git diff origin/main...HEAD` for branch work, or the
   PR's diff if given one. Say which range you reviewed — a gate against an
   unstated range cannot be reproduced.

3. **Hunt defects.** How depends on where you are running, and the two are not
   interchangeable:

   - **Invoked directly in a main session** (`/review-ticket pl-16`): invoke
     `code-review` at `level` against that range and do not re-run its analysis
     yourself. That is the one thing this step delegates.
   - **Running as the `ticket-reviewer` subagent**: run the hunt **yourself**, in
     your own context, to the same depth. You have no `Skill` tool, by design —
     dispatch belongs to whoever dispatched you, and nesting it hides cost and
     makes the agent tree unreadable. Record the range and the depth you used
     where the header below says `code-review at <level>`.

   **Read what its finders actually returned, not only the summary it hands
   back, and account for every finding.** Carrying is a decision per finding, not
   transcription: keep it, or drop it and **say in your own section that you
   dropped it and why** — wrong, already fixed, out of the reviewed range, a
   product decision rather than a defect. All three are good answers; silence is
   not, because a finding that vanishes between the finder and the table leaves a
   gate that reads exactly like one that found nothing.

   **Two findings that are one mechanism may share a bullet** — say so in it
   ("two findings, one mechanism") so the arithmetic still reconciles against the
   `findings` line below. Merging is a presentation choice and a reasonable one;
   merging silently is how a count stops adding up, and the caller is then left
   guessing whether one was dropped.

   This paragraph is here because it has already happened twice, in consecutive
   reviews, in both directions: pl-10's gate lost two defects its finders had
   reported — one of them a navigation bug that re-asked an already-drafted
   trip's questions — and pl-18's lost a duplicated-SQL finding, which its author
   then did not record in the Log either. Neither reviewer was careless. Both
   summarised a summary, which is what the old wording of this step invited.

4. **Trace every acceptance line to its proof.** One row per **Done when** line,
   each naming the test that proves it — `file.test.ts:88`, not "covered". A line
   with no test is a finding, and so is a test that asserts something narrower
   than the line claims.

   **Cite the line of the assertion, not the line of the `test(` that contains
   it.** A test whose name covers half the clause — "reaches grounding, and
   grounding reaches the composer", for a bullet that also demands `grounding →
   done` be *rejected* — is cited correctly and is still unverifiable: the reader
   has to open the file to find out whether the other half is asserted anywhere.
   Cite the half you mean and the row can be checked without leaving the table.

   **A line with several clauses is proven only when every clause is.**
   Acceptance lines routinely join three or four claims with commas. Cite each,
   and if one is unproven the row is unproven whatever the others say — a row
   ticked on the strength of its first clause is the exact failure this step
   exists to prevent.

   Four verdicts, and the last two are the ones that matter:

   - **proven** — a test asserts it, and it runs in `npm test`.
   - **unproven** — nothing asserts it.
   - **unproven (gate)** — asserted only by something the local gates do not run:
     a tool's `e2e` suite or its container build, which live in
     `.github/workflows/<tool>.yml` and nowhere else.
   - **verified** — nothing asserts it, but you re-ran it. For the bullet almost
     every ticket ends with: the gates pass, the suite count went up, no existing
     test changed meaning. **Give the numbers you got, not the ones the Log
     claims** — a count is verified by running the suite at the base commit too,
     and "no existing test changed meaning" by reading the diff of the test files
     it touched for deletions and reworded assertions. Counts as proven for the
     gate.

   `unproven (gate)` exists because of [pl-16](../../../tools/planner/docs/work/pl-16-the-plan-run.md):
   `npm run check` and 1,020 tests passed and the image would not boot. "Green
   locally" is not proof of an acceptance line whose proof is a gate you did not
   run, and this is the row that refuses to let that pass silently.

   `verified` exists because that last bullet fits none of the other three —
   nothing asserts it, it is not a CI gate, and it is plainly not unproven.
   Without a verdict of its own a reviewer reads the Log's numbers back and ticks
   them, which is the ticket marking its own homework.

   **Then look for what has no proof at all.** A source file the diff adds a
   branch to, with no test file of its own, is a finding in its own right — name
   the file and the branch. It costs one `ls` of that package's `test/`, and it
   catches what reading does not: reading covers the lines you looked at closely,
   and nothing makes you look at all of them. pl-24 is the worked example.
   `RunView.tsx` took 38 changed lines in a package with no `run-view.test.tsx`,
   and absorbed two _never fake progress_ defects in one branch — a lookup
   labelled as a specialist, and the fan-out's finished counters replayed as
   grounding's own. Both were eventually found by eye; the second was found
   twice, because the first reading caught one of its two call sites.

5. **Walk the repo's invariants.** These are not general advice — each is a rule
   the root or tool `CLAUDE.md` states, and a generic reviewer knows none of them.
   Check only the ones the diff can plausibly touch, and say which you skipped.

   - A tool imports nothing from another tool. Shared code moves to `packages/`
     on the **second** real consumer — and a lift is itself a change to the other
     tool, to be declared rather than smuggled.
   - Failures throw `AppError` with a code from the taxonomy. New code in core
     only if it would mean something to a tool that never heard of this one.
     `NOT_FOUND` (no route) and `JOB_NOT_FOUND` (no such job) are not
     interchangeable. Re-worded copy at the raise site means the code is wrong.
   - No shell. Argument arrays, `shell: false`. Kill process **trees**.
   - `redactHeaders` / `redactUrl` wherever a header or URL is logged — a signed
     URL carries its credential in the query string.
   - Every user-influenced URL is SSRF-checked, after each redirect included.
   - No faked progress: unknown total is `null` and an indeterminate UI.
   - Contract packages are not edited unilaterally. If the diff changes one, the
     ticket must show that decision being made, not assumed.
   - New tests are registered: a package's `references` line in
     `tsconfig.tests.json`, and a `web` or `e2e` package's own project file plus
     the `exclude` entry. Unregistered specs pass green while checking nothing.
   - A new workspace dependency for an `api` costs **two** edits to that tool's
     `Dockerfile`, in two places, and neither is typechecked.
   - Style: no `any`, no `console`, `import type`, `node:` builtins, `.ts` in
     relative imports.

6. **Sweep the four NFRs** — security, performance, reliability,
   maintainability — one line each. *Not applicable* is a fine answer and a fast
   one; silence is not, because a skipped sweep and a clean one look identical
   afterwards.

7. **Decide the gate by the rule below, not by feel**, and **return** the section
   as text. Do not write it to the ticket yourself: your worktree is discarded
   when you report, so a file you edit here goes nowhere. The caller commits it.

8. **Commit the section, post the report, then say what would clear it.** This
   step is the caller's, and it has three acts. First write the returned section
   into the ticket above `## Log`, verbatim, in the branch's own commit. Second,
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

   A finding the ticket has already settled — a `low` it recorded as a deliberate
   product decision — is not work to propose. Say that it is settled and move on.
   That is the `dropped` line's honesty applied to a finding that lives but is
   not going to be acted on.

   This step exists because a review of pl-5 and pl-17 appended two CONCERNS
   gates naming seven `med` findings between them, reported the verdicts and
   stopped there, the last instruction having been carried out. The user had to
   ask twice — the second time "or you are saying it's already fixed?" — to learn
   which of the two acts had taken place.

### A shape-level finding goes onto the siblings too

When a finding is not about this change but about a **shape** the change shares
with its siblings — the same wrong assumption in three resolvers, one rule
restated in four ticket briefs — it belongs in the siblings' `## Build` sections,
in the same pull request as the fix. Naming it only in this ticket's `## Review`
records it where nobody building the sibling will read it, and the next agent
rebuilds the defect from the brief that still describes it.

## Severity and the gate

| Severity | Means                                                                    |
| -------- | ------------------------------------------------------------------------ |
| **high** | Breaks an invariant above, loses data, leaks a credential, or an acceptance line is wrong rather than merely untested |
| **med**  | An acceptance line unproven, a rule bent with no reason given, a defect behind a condition that will occur, a new branch in a file with no test file of its own |
| **low**  | Style, a missing fixture, a comment that will mislead the next reader     |

- **FAIL** — any high, or any acceptance line **unproven**.
- **CONCERNS** — any med, or any acceptance line **unproven (gate)**.
- **PASS** — every acceptance line proven or verified, nothing above low.
- **WAIVED** — never yours to write. A human waives, names themself and says why.

`unproven (gate)` is CONCERNS rather than FAIL on purpose: the work may be
entirely correct and the gate simply has not run yet. It is not PASS either,
because that is precisely the case that has already shipped a broken image here.

**A review never edits the ticket's `status` frontmatter**, and never edits the
brief. FAIL is a report; whether work stops is the author's call, not the
reviewer's. The section is added, never in place of anything else in the file.

## The section to commit

Above `## Log`. On a ticket that has been through several rounds, keep one
subsection per gate rather than overwriting: a record that shows only the last
gate cannot be told from one whose earlier findings were dropped. Keep it short;
the reasoning belongs in the Log where the author writes it.

```markdown
## Review

**Gate: CONCERNS** — 2026-08-16 · `origin/main...HEAD` · code-review at medium

| Done when                                  | Proof                              |
| ------------------------------------------ | ---------------------------------- |
| Run over HTTP leaves a `PlanDetail`         | `api/test/runs.test.ts:142` ✓      |
| Image ships every workspace `api` imports   | **unproven (gate)** — planner.yml  |

- **med** · `Dockerfile` lists workspaces by hand in two places and nothing
  typechecks the list; the build-stage half fails differently from the runtime half.
- **low** · `nfr:maintainability` — no fixture for the empty-roster branch.
- **dropped** · finder reported the retry loop as unbounded; it is bounded by
  `maxAttempts` two frames up. Not a defect.
- **findings** · code-review at medium returned 3; 2 carried, 1 dropped.
- NFR: security ✓ · performance n/a · reliability ✓ · maintainability — above.
```

A `dropped` line costs one sentence and is the difference between a gate that
found nothing and a gate that decided something was not worth carrying. It has
no severity, and it never changes the verdict.

**The `findings` line is required even when nothing was dropped.** `2 returned,
2 carried, 0 dropped` looks like a formality and is the opposite: it is the only
line that separates a gate whose defect hunt found nothing from one whose defect
hunt never ran. The header above names the hunt and its depth, so a reviewer that
skipped step 3 entirely still writes them, and every other part
of the section would look exactly the same. The count also has to reconcile
against the bullets, which is what makes a merged bullet safe to write.

## What this is not

It does not run the slow gates for you, and it must not report them as run. If an
acceptance line needs the e2e suite or the image, the honest row is
`unproven (gate)` and the honest sentence is that the gate is the proof you do not
have.

It does not fix what it finds unasked. The reviewing subagent fixes nothing at
all — a model asked to both judge and repair is back on the wrong side of the
split this skill exists to draw — and the caller proposes the work in step 8
rather than starting it.
