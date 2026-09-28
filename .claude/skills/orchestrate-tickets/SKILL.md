---
name: orchestrate-tickets
description: Run several tickets to merged pull requests at once by dispatching builder and reviewer subagents, gating each ticket before it opens a PR. Use when asked to work through a batch of ready tickets, to "keep the board moving", or to act as orchestrator over parallel work — "pick up the ready tickets", "run dl-15 and pl-25 together", "continue working, dispatch agents". Not for a single ticket you can build yourself.
disable-model-invocation: true
allowed-tools: Bash(npm run status*) Bash(gh pr list*) Bash(gh pr view*) Bash(gh pr diff*) Bash(gh pr checks*) Bash(git fetch*) Bash(git log*) Bash(git worktree list) Bash(git show*) Bash(git diff*) Bash(git merge-tree*) Bash(gh run list*) Bash(gh run view*) Bash(git ls-remote*) Bash(node scripts/citations-gate.mjs*) Bash(node scripts/agent-cost.mjs*)
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
| [reference/dispatching.md](reference/dispatching.md) | Writing a builder, gate, fixer or re-gate prompt (steps 3, 5, 6 and 8) |
| [reference/defect-shapes.md](reference/defect-shapes.md) | Writing a gate prompt, and before believing what one returns (steps 5 and 7) |
| [reference/worktree-hygiene.md](reference/worktree-hygiene.md) | Whenever a worktree is created, held or removed (steps 3, 6 and 10) |
| [reference/records.md](reference/records.md) | Committing a gate record, a ticket log or a PR comment (step 9) |
| [reference/model-pairing.md](reference/model-pairing.md) | Why the pairing table below reads as it does — the trials and the owner decision behind it. Never needed to dispatch |
| [reference/history.md](reference/history.md) | Appending step 12's row, or looking up the session behind a rule here — read it only if you are revising this skill |

## The loop

1. **Intake.** `gh pr list` first, then `npm run status -- --ready`: a ticket file
   says `ready` until something merges. Read each candidate's opening section, not
   its status line, and `git fetch` again immediately before you dispatch.

   **The board is the working tree, and `git fetch` does not move it.**
   `npm run status` reads the ticket files in the checkout you run it in, and a
   shared checkout sits wherever the last session left it. Before trusting the
   board, compare `git log --oneline -1 HEAD` with `origin/main`; if they differ,
   the board is unread — read ticket state with `git show origin/main:<path>`
   instead, and do not reset the shared checkout while `ListAgents` shows a live
   peer, because the fix for your staleness is their reverting index. Measured
   2026-09-08: a tree eight commits behind returned three `ready` tickets, two of
   which had merged hours earlier, and two Opus builders were dispatched against
   finished work. The fetch had printed the ref movement in the session's first
   command.

2. **Map the seams, then ask which batch** — never pick it yourself. Dispatch
   `subagent_type: "seam-mapper"` over the candidate ids; reading the tickets
   yourself costs ~27,800 est. tokens of the surviving context (2026-08-30).

   `--ready` excludes `needs-decision`, so a blocked board shows in the status call
   (2026-09-03: nine ready, eight undispatchable). Tickets filed before that status
   need the decision grep — see _Fallbacks and caveats_.

3. **Dispatch builders** — one per ticket, as the agent the ticket's
   `difficulty` names in _Which model built it_ below: `builder-mechanical`,
   `builder-standard` or `builder-hard`. **Never pass `model`**; the definition
   pins the model and effort, and your prompt carries the ticket, the base, the
   branch name, the scratch directory and ship authority
   ([reference/dispatching.md](reference/dispatching.md)).

4. **Check the build report before you spend a gate on it** — step 7's checks,
   applied to the builder's report the moment it arrives: a verdict naming a
   test for every `Done when` line, every command with its output, what it could
   not verify, any open decision, the population it read against the one that
   exists, and a head sha that `git ls-remote --heads origin <branch>` shows
   pushed. **Send a failing line back now**: the builder has just finished and
   its cache is warm within its cache TTL, where the same send-back after a
   gate may be a cold wake of its whole transcript (see step 6). Adopted 2026-09-26 from the sentinelle
   repository's orchestrator, which checks its build report before its review
   for the same reason.

5. **Gate each accepted branch** — `ticket-reviewer-sonnet` or
   `ticket-reviewer-opus` per the pairing below, spawned by **you, never the
   builder**: the checked thing must not pick its checker. **Give the gate
   nothing from the build** — not the builder's report, its reasoning, its open
   decisions or a summary of any of them. It gets the ticket, the base and head
   shas, the scratch directory and what to attack, reads the brief as it stood at
   the base, and forms its own verdicts; you hold the builder's, and step 7
   compares them. A reviewer shown what the build claims tends to confirm it,
   which is this page's _pair that agrees too easily_ arriving by design.
   **Never put ship authority in a gate prompt.**

6. **Route every finding, pasted, never retyped.** The gate returns its findings
   and its section to you. Open decisions go to the user. Then **the round** goes
   to one agent, every finding in it **as the reviewer wrote it** — a summary is
   a new claim nobody checked:

   | The round's findings | Go to |
   | --- | --- |
   | any one needs judgement — how, not only whether | **the builder, resumed** with `SendMessage`, carrying the mechanical ones in the same message: it knows why it built what it did, so it does not undo one decision fixing another, and once its wake is paid the mechanical fixes cost a few warm turns |
   | every one is mechanical — a rename, a citation repoint or pin, a Log sentence, a registration line, a lint or format fix — or only the landing is left | **a fresh `fixer`** (Sonnet 5 since 2026-09-27): it starts small and stays small |

   **Why the second row exists, and why only for a whole round.** A subagent's
   prompt cache lives five minutes by default, and every subagent write measured
   here used that default until 2026-09-26 (`scripts/agent-cost.mjs`'s module
   comment, repo-53; the sentinelle repository reports the same across 40
   transcripts on 2026-09-22, relayed). A builder woken past its TTL re-writes its
   whole transcript into the cache before it fixes anything — which is why a
   resume here cost 100–330 k subagent tokens whatever the remaining work
   (2026-09-03), and a one-line Log reword 70,665 on Haiku against a 784,264
   resume (2026-09-14/15). The wakes land past five minutes and within the hour
   (28 subagent transcripts the devcontainer kept, 2026-08-25 to 09-02: 13 wakes past five minutes, all within the hour, 12 of them re-writing the cache), so the builder and gate definitions set a
   1-hour TTL since 2026-09-26; a round of mechanical fixes alone still goes to a
   fixer, because a warm wake still reads the whole transcript on every turn.
   `agent-cost.mjs` prints the wakes that re-wrote as `cold=`. The wake is the cost, so splitting one round between a
   woken builder and a fixer pays for both: the fixer's farm, build, page read and
   reproductions, and a wait, since the two cannot work one branch at once. A
   fixer that finds a fix needs judgement hands it back, and the builder is woken
   for it.

   **Until 2026-09-26 the gate sent its findings to the builder directly**,
   because both relay corruptions this repo recorded were introduced when the
   orchestrator retyped a finding. Routing through you is safe only because you
   paste; the moment you paraphrase, that failure is back. Measured on the first batch routed this way (2026-09-26): the hop from a gate to the next agent had a median of 42 s, against a median 9m35s of the work it delivered, and the two long hops were waiting on the owner.

   **A message to a running or resumed agent is not delivered until something
   shows it was.** A reply queued "for delivery at its next tool round" was never
   read, twice (2026-09-13). After sending, confirm with `ListAgents` and with the
   artefact the message should produce — a push, a commit — and resend if
   neither appears.

   **2026-09-27: dry-run a record mechanic before writing it into a dispatch
   or a message, the same way you check a fact before relaying it.** Three
   of one session's own instructions were impossible or wrong as written,
   each costing a builder a stop or a round: ordering a byte-for-byte splice
   before coordinate re-resolution, when `review-record.mjs --verify`
   refuses a section it finds `MOVED`; naming "declare as evidence" for a
   citation whose text had only moved into the builder's own correction, not
   been deleted outright, where the tool itself calls a declaration wrong
   for a citation a tree still verifies and names repoint instead; and
   naming "merge `main` only on a conflict," when what the citations gate
   needed was `main`'s own `GRANDFATHERED` list, reachable independently of
   whether a merge would conflict. Before naming a splice order, a repoint
   or a declaration, or a merge condition in a dispatch, run it on a scratch
   copy — `review-record.mjs` or `--verify`, the `git log -S` pin-or-declare
   test from `records.md`, or the actual check that needs `main` — and
   confirm it does what the dispatch is about to say it does.

7. **Accept each report, or send it back — the work is not done until you do**:
   five checks, not a re-review. Does each report say what was *run*, and where
   each quote is? Does every `Done when` line carry a verdict naming a spec file
   and line rather than "covered"? Is there an open decision in it? **Does the
   population the report says it read equal the population that exists?** A gate
   told to enumerate read 39 of 114 pins and reported PASS (2026-09-13), one
   session after another had sampled under the same instruction; the instruction
   alone does not hold, so the count sits with whoever accepts the report.
   **You judge whether they are finished, not whether they were right**: send
   back the line lacking evidence.

   **Then compare the two accounts, which only you hold.** For each `Done when`
   line, put the builder's verdict beside the gate's, and the commands each ran
   beside each other. Wherever they disagree — the builder says done and the gate
   says unproven, the two cite different evidence, a command one reports clean
   fails for the other — **the disagreement is a finding**. It goes through step
   6 carrying both verdicts and their evidence and no verdict of yours, and
   concluding that both are wrong is an available answer (2026-08-24).

8. **Re-gate the round, scoped to it.** Wake the same gate with `SendMessage` —
   never a fresh one for round two, per _Do not cap the gate count_ — giving it
   the sha it gated, the new head sha, its findings as it wrote them, and any
   refutation the builder or fixer returned as a command and its output. Not
   their narrative, for step 5's reason. It reviews
   `git diff <gated sha>..<new sha>` only, gives each named finding a verdict,
   and raises new findings only in the lines the round touched, and it
   re-issues every earlier section beside its new one, re-resolved against the
   new head — nothing is committed before step 9. Then step 7 again. **After two re-gates that each raise a new `high`, stop and put the
   state to the user** rather than looping — an escalation, not a cap: the
   gates go on once the user has chosen.

9. **Land it.** Whoever holds the last round lands it — the builder if it was
   resumed for it, otherwise a `fixer` dispatched as maintenance — **on ship
   authority in its own dispatch or a direct message from you**: every gate
   record committed verbatim with `scripts/review-record.mjs`, once, now — one
   commit per gate, from **the set the final gate returned**, every earlier
   section re-issued by it against the tip it reviewed — the pull request
   opened, and each gate's report posted to the thread. Nothing was committed
   in an earlier round (`reference/records.md`, _A multi-round record lands
   once, at the end_, since `repo-67`). Hand it the set's files; do not
   describe them. **The PR body names every model — which built, which gated,
   which fixed** — because nothing else in the artefact does.

   **One command before granting the ship:**
   `node scripts/preflight.mjs --base origin/main --title "<the pull request title>"` on the branch, exit 0 as a
   ship condition. It is the check and the touched tools' suites, the citations
   gate, the `## Review` presence test, the title-type-against-paths test and a
   `git merge-tree` probe against every other open pull request head, one exit
   bit each, and a non-zero exit names the check (repo-51). Each was a rule in
   prose here until 2026-09-20, and each cost a round when forgotten: `repo-29`
   opened a pull request carrying five gate rounds and no record (2026-09-08);
   #228 went red on a line an older gate record cited (2026-09-13); a `feat`
   title over markdown-only `tools/` paths would have cut a tool's changelog and
   version, because release-please routes by path (2026-09-12, 2026-09-14).

   Without `--title`, check 4 reads the branch's last commit subject, which is not the title that lands; every landing on 2026-09-26 ran it that way.

   **And one per gate once the records are committed**, against the file the
   final gate wrote for that gate rather than any copy the lander was handed:
   `node scripts/review-record.mjs --verify <ticket-path> <the gate's section file> [--gate <n>] --rev origin/<branch>`,
   exit 0. It compares the committed record with that file, ignoring table
   padding and what the formatter rewrites, and a non-zero exit names the ticket
   lines that differ (repo-62). `<ticket-path>` is the path to the ticket file
   (e.g., `docs/work/repo-81-rate-tickets-and-rule-gaps.md`), not its id;
   passing an id fails with `fatal: path '<id>' does not exist in '<rev>'`.
   Diffing by hand is what caught both landers that rewrote a gate's words on
   2026-09-26; this is that diff as one exit bit.

   **2026-09-27: dry-run the mechanic before you name it in a landing
   dispatch too — see step 6's rule.** A splice order, a repoint, a
   declaration or a merge condition prescribed here is a record mechanic
   like any other, and the same session that had to correct all three
   mid-batch is the reason this is stated at both steps rather than once.

10. **Hold every worktree — the gate's and the fixer's as well as the
    builder's — until the ticket is finished.** "The round is over" cannot be
    evaluated: tested twice on 2026-09-03, both times it resumed. Announce any
    early removal to that agent.

11. **Scratch-merge the batch, then check the merge landed what it was supposed
    to.** Before any branch in the batch merges, run
    `git merge-tree --write-tree <headA> <headB>` over every pair of open batch
    heads, and the citations gate on a scratch merge of all of them. The seam map
    reads briefs and cannot see the gate-record pins a branch writes mid-build:
    in two batches every merge conflict was in a gate record more than one branch
    pinned, and none was in source (2026-09-12, 2026-09-14). Then one look, after
    the fact, not polling. See _After a merge_.

12. **Append this session's row to [reference/history.md](reference/history.md),
    and change the rules it names.** The row follows the schema that page fixes,
    headed by date and base sha rather than by ordinal — a row written while the
    previous row's pull request was still open had to stack on it to avoid
    computing the same ordinal (2026-09-18), and a dispatch had already once
    called the twelfth row the eleventh (2026-09-07). Nothing forces it,
    and **its last field earns the page** — what the skill got wrong (2026-09-02:
    six, all only because it was asked). **Ask every agent for it in its
    dispatch**, not at close-out: three sessions running asked late or not at all,
    and the field came back thinner each time (2026-09-13 to 2026-09-18).
    **A defect that stops at the history entry has not been fixed.** Every item in
    that field either edits the page that holds the rule, in the same pull
    request, or files a ticket carrying the reproduction. A row "scoped to this
    file alone" is the failure this step used to produce: between 2026-09-12 and
    2026-09-18 eight rows carrying about seventy items landed and no rule page
    changed, so each batch paid again for defects the previous one had recorded.
    The cheap test is whether the rule's page changed in the same commit
    (2026-09-07). Decided by the owner on 2026-09-20, against the rows' own
    precedent.

    **2026-09-27: the orchestrator drafts the fact list, the builder formats
    it, and a gate checks it against primary sources.** The history row's
    schema table and per-agent numbers are the orchestrator's own read of the
    batch's accounting and transcripts, handed to the builder to lay out in
    the fixed shape — not reconstructed by the builder from a summary. The
    `repo-64` batch got this backwards once: a builder-reconstructed claim
    credited a reviewer with refuting its own `-err_detect` recommendation,
    when the builder that built the fix had refuted it first and the
    reviewer only confirmed — a fact nobody had drafted from source, and it
    cost a round to undo once a gate re-read the primary commits. **A ticket
    filed out of a step-12 close-out PR carries its reproduction — a command
    and its output — not a claim reconstructed from a summary**, and where it
    poses a decision, its options are drafted from a fresh read at the time
    the owner is asked, never carried forward from an earlier draft that may
    have gone stale: `repo-64`'s own `repo-65` had its decision section
    rewritten four times inside one pull request, because each gate found
    another premise in it that a fresh read would have caught the first
    time.

**The PR is not the end of gating; the merge is.** A branch that has already shown
its corrections can be wrong may open its PR under conditional ship authority *and*
take one narrow gate afterwards, scoped to the corrections. Not the default.

## Which model built it, and which gated it

**The agent you dispatch is the choice; its definition is the only copy of the
model and effort.** Each definition in `.claude/agents/` pins both by full id,
never an alias: `opus` and `sonnet` follow the newest release, which would move a
pairing without anyone deciding it — and did, silently, while this page priced
its trials at Opus 5 and the alias went on to newer models. **A change of lineup
edits this table and those files together, and nothing else.**

| `difficulty` | Builder | Gate |
| --- | --- | --- |
| `mechanical` | `builder-mechanical` — Haiku 4.5 | `ticket-reviewer-sonnet` — Sonnet 5, xhigh |
| `standard` | `builder-standard` — Sonnet 5, high | **`ticket-reviewer-opus`** — Opus 5.5, high |
| `hard` | `builder-hard` — Opus 5.5, high | `ticket-reviewer-sonnet` |
| absent | `builder-hard` | `ticket-reviewer-sonnet` |
| **maintenance** — no ticket, or a `chore` with no source change: a history row, a rebase, a merge from `main`, a citation pin, a Log edit, a filing whose reproduction is in hand | `builder-mechanical`, prompt saying "maintenance" | `ticket-reviewer-sonnet`, where one runs |
| **a docs/records-only chore** — a `chore` whose whole diff is rule pages, ticket files and history rows, no source (2026-09-27) | whichever builder the dispatch names — `builder-mechanical` absent an override, or a stronger one by owner override, per `repo-64`'s own `builder-standard` | **one gate, post-PR and narrow** — `sizing.md`'s docs-ticket gate cap; a second, narrow gate only once the first has found something wrong, never a default second round |
| **a round's mechanical fixes, and its landing** | `fixer` — Sonnet 5, high (Haiku 4.5 until 2026-09-27) | the round's gate, woken |

**2026-09-27: the docs/records-only chore row exists because `repo-64` did not
get it.** That ticket — a `chore` with no source change, only rule pages and
ticket records — took three Opus gates plus five builder rounds, $60.18 total
(`$45.46` builder, `$14.72` gates, from `node scripts/agent-cost.mjs`) by the
orchestrator's own reading of that batch's accounting.
[reference/sizing.md](reference/sizing.md) already said a self-generated docs
ticket deserves one builder and at most one gate; this row makes that binding
for the class rather than leaving it as unenforced guidance the multi-round
loop's own defaults kept overriding.

**2026-09-27: the `fixer` moved to Sonnet 5, on the owner's decision, overriding
the filer's own recommendation to resume the builder for a record-touching
landing instead.** The Haiku fixer failed both of the batch's record-touching
landings — measured directly by the orchestrator, not read off either
ticket's own Log: on `repo-60`, dispatched to reword a docblock "in place,
keeping the same number of lines," it removed one line net instead, turning
CI's `check` red, and reported the citations gate exit 0 where a run in the
reviewer's own worktree at that sha exited 1 with 3 records failing; on
`pl-48`, it altered a reviewer's own re-resolved anchors and pushed nothing,
leaving its local, unpushed commits with the citations gate exiting 1 where
the reviewer's own dry-run had exited 0, and the round was discarded — and
the batch before this one had it rewrite gate findings twice despite a
dispatch saying stop. Effort set to `high`, matching the Sonnet row above
rather than measuring a new value for this one: `reference/model-pairing.md`
already gives Sonnet 5 `high` as its builder setting, and a fixer's work is a
small build.

- **Never pass `model` when dispatching one of these.** It overrides the
  definition's model and keeps its effort, which gives a pairing this table does
  not have. Relayed from the sentinelle repository and not measured here: Claude
  Code's sub-agent documentation confirms a definition's `effort` overrides the
  session's, and says nothing about a per-call `model`.
- **Never rate an unrated ticket yourself**; you have not read it, which is the
  point of step 2. **Absent maps to `hard`** since 2026-09-26. It used to mean
  *inherit the orchestrator's model*, which under an Opus orchestrator already
  collapsed onto `hard`'s pair (measured 2026-09-12), and under the Fable
  orchestrator of 2026-09-20 would have built every unrated ticket on Fable,
  which this page forbids.
- **Never `haiku` for a gate, never `fable` for either.** The rule is "a
  different model", not "a cheaper one", and a gate from a small model still
  reads as PASS.
- **The effort column is a bet, not a measurement.** No trial in this repo has
  compared efforts; the values are the sentinelle repository's lineup for the
  same models. `agent-cost.mjs` prints the effort every agent actually ran at,
  so a history row can test them. Why each model row reads as it does, and why
  the cost case behind `standard` needs re-measuring now that Opus 5.5 reads its
  cache at Sonnet 5's rate, is [reference/model-pairing.md](reference/model-pairing.md).

**Confirm what ran from the transcript, not from anyone's account of it:**
`node scripts/agent-cost.mjs --agent <id>` prints each agent's model and effort
as its records carry them, with its tokens and cost. Never ask an agent what
model it is — a claim an agent makes about itself is checked from outside. And
**the commit trailer cannot stand in for either half**: it is built from the
session tree's model and has named an Opus model on a Haiku subagent's commit
(2026-09-06). Measured before any of this was written down: **11 tickets, 22
gates, none gated by a different model than built it** (2026-08-30).

## Where a gated pair fails, and the test for each

| Failure | Its test |
| --- | --- |
| **A pair that agrees too easily** — two agents that want to be done converge on "addressed" without either running anything | Structural since 2026-09-26: the gate never sees the build's claims (step 5) and you compare the two accounts (step 7). Before the fact, the gate prompt still demands reproductions and a positive control |
| **A record nobody landed** — every report says finished, `npm run status` reads `done`, the branch is pushed, and no gate record is on it. Under the old builder↔gate exchange each treated the record as the other's next move (2026-09-04); now it is the lander you forgot to grant | One command per ticket: `git show <branch>:<ticket-path>` piped to `grep '^## Review'`. Empty means the ticket is not landed, whatever any agent told you — and before step 9 it is empty by design, since no round commits its record; preflight runs the same test |
| **A decision relayed without its provenance** — no agent can verify authority from inside its own sandbox, so "the owner directed this" is unwarranted on its face (2026-09-04: a gate correctly declined to extend a PASS over such a commit, and the round was lost) | The record, not a command. A relayed decision names the question asked, the options, which was chosen, and **whose recommendation it overrode** |

`^## Review` is right for a *live* branch because the gate role returns a
`## Review` section as text and `review-record.mjs` lands it under that heading. It under-matches historical tickets, where `## Gates` and `## Gate 1 — …` also
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
gh pr checks <n>
gh pr view <n> --json headRefOid,statusCheckRollup
```

**Not `gh run list`, which this page prescribed until 2026-09-20.** It reports
*workflow* conclusions, and three real failures hide behind a green workflow: a
`continue-on-error` job (this repo's `windows-latest, informational` leg), a
`changes`-gated matrix that was `skipped` on a markdown-only push and still reads
`success`, and a check run that is not an Actions workflow at all — GitHub's
default CodeQL setup, which `gh run list` cannot see with any flag. An
orchestrator used the weaker command for a whole batch and nearly closed with two
failures unseen (2026-09-18), after `skipped` had been recorded as reading green
in three consecutive sessions, all on 2026-09-07. Read a failing check's reason
with `gh run view <id> --log-failed`, and say which of the two CodeQL checks
you mean, since `CodeQL` and `codeql` both exist here. `--json` rather than the
table, because the failure this guards against is reading a list by eye. To
read one job's full log on a run that has been retried, add `--attempt N`:
`gh run view <id> --job <id> --log` alone, without it, returned the wrong
attempt's log — byte-identical output for a failing job and a passing one
(reference/history.md item 9). **Name the sha in whatever you conclude** — your
look decays the same way a record's does (2026-09-04: a relayed status claim
went stale between being taken and being read).

**After the merge, one more look at `main`:
`gh run list --branch main --limit 10 --json databaseId,event,conclusion,headSha`,
then `gh run view <id> --json jobs` for each `push` row, reading job conclusions.**
Green PR checks say nothing about `push`-triggered jobs — they are different
events with different jobs, and a job that only runs on `push` to `main` can fail
on every merge while every pull request stays green, because nobody is looking at
`main`. A `push` run `cancelled` by the next merge landing on top of it reported
no `test` conclusion at all, and `main` stayed red on Windows for most of a day
(2026-09-07).

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
that nothing is committed or pushed while either decision is open (2026-09-04) —
**except the gate records, which are committed whatever is open** once the
ticket lands or its branch is parked unlanded. A hold with no carve-out left
`dl-58`'s gate-1 record uncommitted, the next gate raised the missing record as
a med finding, and three rounds went to a record everyone already held; the
same hold lost gate 4's record on the same ticket (2026-09-17). Since `repo-67`
no round commits its record mid-flight (`reference/records.md`), so an
uncommitted record before the landing is the rule and not a finding; what the
carve-out still protects is the landing, and the parked branch whose scratch
directory would not survive a rebuild.

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

### Relaying: sixteen costumes of one mistake

**Compressing something the receiving agent needed in full.** Each row is one
instruction; where the shape has a worked example it is in
[reference/history.md](reference/history.md) under the same name.

| The shape | The instruction | Measured |
| --- | --- | --- |
| A relayed **option** | Read the options out of the ticket yourself before putting them to the user. A relayed *finding* travels safely marked unverified; an option does not, because the user acts on it | 2026-09-03 |
| An option's stated **mechanism** | A proposal, not a fact, and answering the decision does not verify it. Dispatch the outcome — *this must fail fast with a typed code* — and say the named route is unverified | 2026-09-03 |
| A subagent's **claim**, repeated as yours | Be able to say who ran it. A vivid failure scenario from a report is a hypothesis until someone renders it — and a premise inside an option you put to the owner is the same claim: "the planner has no `@fastify/static`" went from a build report into a question unchecked, and one grep of its `package.json` refuted it | 2026-08-22, 2026-09-26 |
| A **caveat** where a command would do | Where checking is one command — a file count, a config flag, a quoted line — spend it rather than caveating. Reserve the caveat for what genuinely cannot be checked from here | 2026-08-24 |
| An **unmarked** relay | "The ticket says X; I have not checked" costs a sentence and stops the chain. Without it three links formed silently and only the middle one was cheap to break | 2026-08-23 |
| Your own **summary**, sent downstream | Relay the reproduction, not the verdict, and say the builder should push back rather than transcribe. Every builder in the fourth session corrected something | 2026-08-23 |
| A finding whose **premises are all true** | Checking a finding's premises is not checking the finding; only running it is. Relay the premises **as premises** | 2026-09-01 |
| A wrong **citation** under a right conclusion | The outcome cannot catch this one. Check the rule you are about to cite, not only the answer it gives you, and attribute the correction when one lands | 2026-09-04 |
| A fix relayed without its **mechanism** | Ask *"why did the argument not transfer?"*, not for a corrected number. [reference/defect-shapes.md](reference/defect-shapes.md)'s re-derive-list rule exists because a relay asked for one; its builder did not volunteer it | 2026-08-24 |
| A finding accepted **unreproduced** | Make the builder reproduce it first — not to doubt the reviewer, but to put the builder in contact with the gap. It also catches the reviewer being wrong, which happens | 2026-08-24 |
| A **described** artifact | Paste anything the builder must *commit*, *post* or *quote*. A description is not a smaller version of a record; a builder asked to commit one it could not find correctly stopped, and the round was lost | 2026-09-01 |
| A result read **at a glance** | `cancelled` and `skipped` are *completed* runs and a glance counts either as green — a `changes`-gated matrix that never ran reads `success` at workflow level. Take the measurement with `--json` and read jobs, not runs; four glance-readings turned up in one batch, in prose every time and in citations never, and `skipped` recurred in three consecutive sessions after it was first recorded | 2026-09-05, 2026-09-07 |
| A **disposition** marked "accepted" | A disposition is a relay, and "accepted" is the word that hides an unmeasured one. **Gate a disposition by measuring what it claims changed**, not by checking the finding is marked closed | 2026-09-05 |
| A claim an agent makes **about itself** | Its tools, its model, its lifecycle are self-reports, and a self-report is checked from outside — see the table below for the one-call check per field | 2026-09-03 |
| An **option or cost you construct yourself** | A claim you are making, and it needs a measurement or an explicit "unverified" exactly as a relayed one does. An orchestrator described a closure as needing a flag that would fail the branch; the builder had already built one that did neither, reverted it on the declined mechanism, and the reversal cost two rounds | 2026-09-08 |
| A **recommendation on an unmeasured premise** | A gate's recommendation conditioned on a fact nobody measured is not a recommendation. Measure the condition, or hand the decision up unrecommended — one such premise was measured false before it reached the owner | 2026-09-17, 2026-09-27 |

**A claim an agent makes about itself — its tools, its model, its lifecycle — is a
self-report, and is checked from outside.** It bites at dispatch, at gate and at
report time, which is why the rule is here and its per-field check is one call:

| Field | The one-call check |
| --- | --- |
| tools | ask it to *call* the tool ([reference/dispatching.md](reference/dispatching.md) carries the measurement: a builder reported eight against thirteen in its frontmatter) |
| model and effort | `node scripts/agent-cost.mjs --agent <id>`, which reads them from its transcript — _Which model built it_, above |
| lifecycle — running, held, released | `git worktree list` |

`reference/defect-shapes.md` uses "self-report" for a different thing: a builder's
claim about its **work**, checked by reproducing the work. These are two rules, not
one, and neither covers the other.

Two remedies on this page are not shapes of their own and belong to their
neighbours: **separate the outcome from the route** when you dispatch a decided
option, and **check the rule you are about to cite** rather than only the answer.

**On the `Measured` column.** Where the session recorded a date, that is the date.
Where it recorded only "the second session" or "the fourth session" — rows 3 to 6,
9 and 10 — the date is the commit that wrote the provision, taken with
`git log -S`, and it is a *written* date rather than a measured one. Stated here
once rather than marked per row, because a column of asterisks is worse than a
sentence.

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

**Close the batch with `# Done`** —
`CLAUDE.md@a0841701f3f764f74ce50f21aa8cd8f849942af4:259` "## Handing back"
(repo-78: pinned rather than a heading citation, per that ticket's Log) — once the
table below is written and nothing is waiting on the user's answer. Open pull
requests waiting to be merged do not disqualify it; they belong under the heading
with their merge order. A batch still carrying an open decision, or one whose gates
named repairs nobody has made, ends in the question instead.

### End every batch with a per-agent accounting table

Unasked, and whatever the batch cost. The owner had to ask for this by hand on
2026-09-05, which is the tell: "report cost honestly" is satisfiable by a sentence,
and a sentence hides where the cost went, whether the model-difference rule held
per branch, and what an interruption cost.

| PR | Status | Model / effort | Agent | Task | Active / wall | Cold | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

**One row per agent, not per ticket** — an agent killed and replaced is two rows,
which is the only place the duplicated work is visible at all.

- **Cost** — dollars from `node scripts/agent-cost.mjs --agent <id> …`, one
  `--agent` per agent id an `Agent` result reported, with the rate date the
  script prints beside its total. It reads the agent's transcript, so an agent
  whose last turn ended in a message is priced too, and it adds a row for your
  own session, `orchestrator <session id>` — **a floor**, since your transcript
  keeps growing after the run that read it. A task output file path works as
  before. **Never a conversion of `subagent_tokens`**: that figure excludes
  cache reads, which are 94 to 97% of the bill, and the `standard` trial's first
  "8% saving" was wrong by an order of magnitude on exactly that (repo-53,
  2026-09-20). `subagent_tokens` stays in the table only as the series the
  earlier history rows are in.
- **Active / wall** — as `agent-cost.mjs` prints them: active is the gaps under
  five minutes between records, wall is first record to last. The total sums
  active time only, since agents overlap.

- **PR** — where the agent's work landed, or `—` for batch-wide work like the seam
  map. **Status** — the PR's state as you write, from
  `gh pr list --json number,mergeable,statusCheckRollup`, not from memory.
- **Model / effort** and **Cold** — as `agent-cost.mjs` prints them from the
  transcript, never inferred: the model and effort every record carries, and the
  turns that re-wrote the cache because it had expired — a large write that
  began longer after the previous turn than the cache TTL. **A `cold=` above zero
  on a builder or gate** means a wake past an hour, or the definition's 1-hour TTL
  ignored because the subscription was on usage credits; name which in the
  history row. A `cold` count on a
  builder is the price of its resumes, and the number that says whether step 6's
  routing is paying.
- **Agent** — the `subagent_type`. **Task** — one line, including how it ended
  where that matters: killed by an interrupt, resumed, replaced. **Tokens** — that
  agent's last-observed `subagent_tokens`.

Three caveats, all measured 2026-09-05/06:

- **`subagent_tokens` are usually cumulative per agent**, so a resume is folded
  into the figure rather than added to it, and summing an agent's successive
  reports double-counts it. **Not always**: a builder reported 516,783, was
  resumed, and reported 400,121 (2026-09-12); a gate reported 202,260 then
  196,927 (2026-09-14). The mechanism is not known. Record every figure you
  observe per agent, and say which one the table carries.
- **Some agents never report a total** — a final turn ending in a `SendMessage`
  delivers no usage block. Write `not reported` in **Tokens**, **do not omit the
  row and do not estimate the cell**, and price it from its transcript by id.
- **This is not the bill.** [reference/sizing.md](reference/sizing.md) records what
  fraction of the all-in volume `subagent_tokens` is once cache reads are counted.

It is also most of step 12's work: `reference/history.md`'s `subagent tokens` field
wants exactly this split, so the history row becomes a transcription rather than a
reconstruction from memory.
