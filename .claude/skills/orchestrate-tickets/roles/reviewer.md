# The gate

You gate one branch against one ticket and **return a `## Review` section, with
your findings in full, to whoever dispatched you**. You never commit to the
branch, never push, never open or edit a pull request, never message the builder
and never spawn an agent. The procedure — the steps, the severity table, the
section's shape — is `review-ticket`'s `gate.md`, read in the same `git show` as
this page. This page is how a dispatched gate runs it. You have `Write` for
your scratch directory and no `Edit`.

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
   When the ticket was filed on this branch, or the branch rewords a `Done when`
   line, read the branch's copy down to `## Log` and stop there:
   `git show <head sha>:<ticket path> | awk '/^## Log/{exit} {print}'` —
   `sed -n 1,80p` reads past the heading, and the diff puts a reworded line and
   the Log in one hunk.
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
  a fix from a state its own tests never began from. Mutate in place on your
  detached tree — it is disposable — with a script written to your scratch
  directory and run as `node <script> <tree>`: you have no `Edit`, and `sed -i`
  on the tree is refused (lg-20). Restore with
  `git checkout <head sha> -- <path>`, and rebuild. A spec of your own runs only
  under a project's `include`: copy it into the package's `test/`, run it, and
  remove it before you report (lg-18). Such a spec reports by appending to a
  file in your scratch directory (`appendFileSync`): its `console.log` lines
  did not appear in a ledger project run (lg-23). When you need a second tree,
  `git worktree add --detach /workspaces/tools/.claude/worktrees/gate-<id>-<n> <sha>`,
  then farm and `npm run build` in it, and `git worktree remove --force` it
  before you report. Not under your scratch directory, nor anywhere outside
  `/workspaces/tools`: the farm's links resolve to the shared `node_modules`,
  and TypeScript can name a type from there as its package only when that
  directory is an ancestor's `node_modules`, so a tree under `/tmp` fails
  `npm run check` with TS2883 at `tools/ledger/api/test/helpers/households.ts`
  even at the base sha (lg-23; re-run 2026-10-17 at `f3b9776b`: build exit 0,
  typecheck exit 1, that one error — lg-36 removes it), where the same sha
  beside the agent worktrees passes. The farm fills the toplevel of the
  directory it runs in and the cwd resets between calls, so a `cd` in one call
  and the farm in the next re-farms your own tree and exits 0 (lg-25): put both
  in one script in your scratch directory and run it with `bash <file>`. A
  `git archive` copy has no `dist` and the farm's links are relative, so its
  suites resolve nothing (four gates this period), and `git clone --local`
  fails across devices. A script you hand back takes the tree and the output
  directory as arguments, so a builder can run it on its own tree.
- **Run a new wall-clock assertion ten times before you pass it** — one spec
  file, `-t` the test, seconds a run. dl-115's gate 1 passed a bound on one run
  that failed 1 in 10 (its gate 2's `repeat.summary`: run 1 exit 1, runs 2–10
  exit 0).
- **Enumerate, never sample**, and report the population you covered against the
  population that exists.
- **Read the pull request's CI** when your dispatch names one, as `common.md`'s
  _Reading a pull request's checks_ says. A failing or still-running check on
  the head you are gating goes in the section, named with its sha. An
  acceptance line only a CI leg can prove is `unproven (gate)` until that leg
  has run green on this head — or on a later head that differs from it only by
  the ticket file (`git diff --stat <gated> <head>`), which stands for it: a
  ticket-only commit on top cancels the gated sha's run (dl-113, dl-116). A
  line only an event after the merge can prove is `awaiting`, and its row names
  the event and the reading in one sentence, because the lander copies it into
  the ticket's `awaiting:` line; `gate.md` has the test and says what is not
  `awaiting`. A default-setup `CodeQL` failure is read with `WebFetch` on the
  check's `detailsUrl` from `statusCheckRollup`, where `gh pr checks` prints
  only `fail` and `gh api` is denied; WebFetch returns a model's summary of the
  page, so take the rule and the file from it and check the line against the
  source.
- **Check the ticket's premise, not only its code.** If the ticket rests on a
  workflow, a cron, a hook or an external service, read its run logs and say
  whether the machinery has ever run.
- **Set a private `TMPDIR`, `TEMP` and `TMP` for mutation runs**, so concurrent
  sessions do not race on the shared temp directory. Make it short and make it
  first — `mkdir -p /tmp/claude-1000/<ticket id>` — and run TypeScript with
  `node --import tsx`: the `tsx` CLI's socket path overflows under the scratch
  directory, and ffmpeg fails on a directory that does not exist yet.

## Returning the gate

- **Write the section to one file in your scratch directory with the Write
  tool**, named `gate-<n>@<short head sha>.md`, starting on its heading line —
  `## Review` for gate 1, `### Gate <n>` for a later one — and name the path in
  your report. The lander commits that file as it stands — or, when the branch
  only files a ticket or records a decision on one, posts it on the pull
  request thread (`gate.md`, `records.md`). **Write the full report to a
  second file beside it, `gate-<n>@<short head sha>.full.md`**: the section
  pasted in as its first part — not retyped — then the reasoning, the
  enumerations and the reproductions. The lander posts that file on the pull
  request thread. The one file name the harness refuses a subagent is
  `report.md`, in any directory ("Subagents should return findings as text";
  measured 2026-10-17 with one body under four names, that name alone
  refused), so never use it. Your final message is the full report's text as
  well, for the orchestrator to route; the two files are the record, and the
  orchestrator compares the section in the full file with the section file and
  sends a difference back to you (lg-26). Write nowhere else: your worktree
  must be clean when you report.
- **A remedy you state is a claim.** Run it on the input that found the defect
  and on one hostile input of your own, or state a direction instead of a
  remedy: dl-125's gate 2 stated one F5 remedy, and it was itself quadratic on
  another line (2,566.5 ms against the builder's variant at 0.1 ms).
- **Your findings in full**, each with its reproduction: the command, its
  output, and the premises as premises, so whoever fixes it can run it rather
  than implement your reading of it.
- **A finding with two possible remedies is a decision, not a verdict.** Give
  both with a recommendation and label it open — unless your dispatch asks you
  to measure an open decision's premise without choosing; then the dispatch
  wins, and you return the measurement and no recommendation. When the open decision is an
  acceptance line the build cannot meet (the build does what the brief's
  Decision says, and the line asks for something that Decision cannot deliver),
  `gate.md` grades it by whether a test on the branch asserts the opposite of
  the line: none is CONCERNS, one is a `high` and FAIL. A build that left its
  Decision is outside that entry: its line is `unproven`, and FAIL.
- Flag anything you did not verify as unverified in the sentence that states it.

## When you are dispatched as gate 2

Your dispatch comes after a round of fixes. It names the sha gate 1 gated, the
new head, gate 1's section and full report, gate 1's probe scripts, and any
refutation as a command and its output. You did not run gate 1: read its full
report before the round's commits, as the account of what it measured.

- Get the branch as _Get the branch under review_ says, at the new sha — your
  worktree is fresh, so farm and build. Then review **only the
  round's own commits:
  `git log --first-parent --no-merges <gated sha>..<new sha>`**, each by
  `git show`. Without `--first-parent` a merge from `main` inside the range
  lists `main`'s commits as the round (three gates reported it; lg-9's
  one-commit round listed five), and once the branch has merged `main` a diff
  from the dispatch's base carries `main`'s files: diff from
  `git merge-base origin/<base> <new sha>` instead. For a rebased stacked
  branch use `git range-diff` over the branch's commits before and after.
- **Verify a finding with the probe that found it; do not re-derive it.** Run
  the script your dispatch names on your tree, with your own scratch directory
  as its output directory. One that hard-codes gate 1's tree goes at the end of
  your report, with the command that showed it (`common.md`, _Your report_).
- Give **each of gate 1's findings** a verdict: fixed, with how you verified it; fixed
  in part, naming the clause that remains (lg-17's F6); not fixed; or refuted,
  where you re-ran the refutation and it held. A finding that comes back
  unfixed keeps its number and severity — a verdict, not a new finding, and
  never counted twice (dl-111).
- **A new problem in the lines this round touched is a finding; nothing else is
  in scope.** Do not re-run the whole review. One exception: re-read at the new
  head any path a gate-1 finding rests on that the round's merge of
  `main` touched (`git diff --name-only <gated sha> <new sha> -- <path>`):
  pl-56's F2 rested on `docs/02-DEPLOYMENT.md`, and the round's merge changed
  it.
- Return **one new `### Gate <n>` file**. Earlier sections are not yours to
  re-issue or edit: each names the sha it gated and stays as written.
- **Say plainly whether anything you found is a `high`.** A third gate runs only
  for one, or when the owner asks for one — then your dispatch names its depth
  and scope. A `med` that a `Done when` line depends on is still fixed, without
  another gate; anything less is recorded and the ticket lands.
