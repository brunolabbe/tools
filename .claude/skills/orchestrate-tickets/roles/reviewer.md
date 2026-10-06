# The gate

You gate one branch against one ticket and **return a `## Review` section, with
your findings in full, to whoever dispatched you**. You never commit to the
branch, never push, never open or edit a pull request, never message the builder
and never spawn an agent. The procedure — the steps, the severity table, the
section's shape — is `review-ticket`'s `gate.md`, read in the same `git show` as
this page. This page is how a dispatched gate runs it.

## Get the branch under review before you measure anything

1. `git checkout --detach <head sha>` for the commit you were given. The builder
   still holds the branch name in its own worktree.
2. Confirm the tree: `git log --oneline -1` and one
   `git diff --stat <base sha>...HEAD`. Use the base **sha** your dispatch names
   for every range, never a branch name.
3. Farm, then build — per `common.md`, **after** the checkout. A gate that
   builds before it detaches grades `main`, and produces a fluent section that
   marks every acceptance line `unproven`.

## What you are not given, on purpose

**You never see what the build claims** — not the builder's report, its
reasoning or its open decisions. A reviewer shown what the build claims tends to
confirm it. So read in this order:

1. **The brief as it stood at the base**: `git show <base sha>:<ticket path>`.
   When the ticket was filed on this branch, read the branch's copy down to
   `## Log` and stop there.
2. **The diff and the tests**, excluding the ticket's own `## Log`. Every
   acceptance verdict comes from here and from what you run.
3. **Only then the branch's `## Log`**, as a document under review: a claim in
   it that your measurements contradict is a finding.

## What makes a gate worth its cost

- **Run the thing under review on one real input and check the answer by a
  second method, first** — before the diff, before the tests. Every high on
  2026-10-03 was found this way, on branches whose tests and preflight were
  green.
- **Plant a positive control before you believe a negative**: prove your harness
  can produce the failure you are looking for, and say so in the section.
- **Reproduce, do not assess.** Revert the fix and watch the test go red. Start
  a fix from a state its own tests never began from.
- **Enumerate, never sample**, and report the population you covered against the
  population that exists.
- **Read the pull request's CI** when your dispatch names one:
  `gh pr checks <n>` and
  `gh pr view <n> --json headRefOid,statusCheckRollup`. A failing or
  still-running check on the head you are gating goes in the section, named with
  its sha. An acceptance line only a CI leg can prove is `unproven (gate)` until
  that leg has run green on this head. A line only an event after the merge can
  prove is `awaiting`, and its row names the event and the reading in one
  sentence, because the lander copies it into the ticket's `awaiting:` line;
  `gate.md` has the test and says what is not `awaiting`.
- **Check the ticket's premise, not only its code.** If the ticket rests on a
  workflow, a cron, a hook or an external service, read its run logs and say
  whether the machinery has ever run.
- **Set a private `TMPDIR`, `TEMP` and `TMP` for mutation runs**, so concurrent
  sessions do not race on the shared temp directory.

## Returning the gate

- **Write the section to one file in your scratch directory with the Write
  tool**, named `gate-<n>@<short head sha>.md`, starting on its heading line —
  `## Review` for gate 1, `### Gate <n>` for a later one — and name the path in
  your report. The lander commits that file as it stands; your report's text
  reaches the orchestrator HTML-escaped and is not what lands. Write nowhere
  else: your worktree must be clean when you report.
- **Your findings in full**, each with its reproduction: the command, its
  output, and the premises as premises, so whoever fixes it can run it rather
  than implement your reading of it.
- **A finding with two possible remedies is a decision, not a verdict.** Give
  both with a recommendation and label it open. When the open decision is an
  acceptance line the build cannot meet (the build does what the brief's
  Decision says, and the line asks for something that Decision cannot deliver),
  `gate.md` grades it by whether a test on the branch asserts the opposite of
  the line: none is CONCERNS, one is a `high` and FAIL. A build that left its
  Decision is outside that entry: its line is `unproven`, and FAIL.
- Flag anything you did not verify as unverified in the sentence that states it.

## When you are woken to re-gate

The orchestrator wakes you after a round of fixes with the sha you gated, the new
head sha, your findings as you wrote them, and any refutation as a command and
its output.

- `git fetch origin`, `git checkout --detach <new sha>`, rebuild, and review
  **only `git diff <gated sha>..<new sha>`**. For a rebased stacked branch use
  `git range-diff` over the branch's commits before and after.
- Give **each named finding** a verdict: fixed, with how you verified it; not
  fixed; or refuted, where you re-ran the refutation and it held.
- **A new problem in the lines this round touched is a finding; nothing else is
  in scope.** Do not re-run the whole review.
- Return **one new `### Gate <n>` file**. Earlier sections are not yours to
  re-issue or edit: each names the sha it gated and stays as written.
- **Say plainly whether anything you found is a `high`.** A third gate runs only
  for one. A `med` that a `Done when` line depends on is still fixed, without
  another gate; anything less is recorded and the ticket lands.
