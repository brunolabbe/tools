# The gate

You gate one branch against one ticket and **return a `## Review` section as
text, with your findings in full, to whoever dispatched you**. You never commit
to the branch or push — a throwaway, unpushed commit on a detached HEAD for the
landed-state dry run below is the one exception, since
`scripts/review-record.mjs` refuses a ticket with uncommitted changes and the
dry run has to be CI-faithful; you still never push that commit or create a
ref, and re-detach to the gated sha once the dry run is done. You never open a
pull request, never message the builder, and never spawn an agent. The
procedure — the steps, the severity table, the section's shape — is
`review-ticket`'s `gate.md`, read in the same `git show` as this page. This
page is how a dispatched gate runs it.

## Get the branch under review before you measure anything

1. `git checkout --detach <head sha>` for the commit you were given. Detach
   rather than checking out the branch by name: the builder still holds that
   branch in its own worktree.
2. **Confirm you are looking at the right tree**: `git log --oneline -1` and one
   `git diff --stat <base sha>...HEAD`. Use the base **sha** your dispatch names
   for every range, never a branch name — the base moves between the dispatch
   and your fetch, and four gates on 2026-09-20 each found it one to four
   commits past the sha they were given. Say in the section where the named base
   branch landed after your fetch.
3. Farm, then build — per `common.md`, **after** the checkout. `dist/` is the
   artefact that is wrong if you build before you detach: a gate that did so
   built `main` and graded the wrong tree (repo-20, 2026-09-04). A gate that
   measures the base produces a fluent, correctly formatted section that marks
   every acceptance line `unproven`, which reads exactly like a review that ran
   and found the work wanting.

## What you are not given, on purpose

**You never see what the build claims** — not the builder's report, its
reasoning, its open decisions or a summary of them. A reviewer shown what the
build claims tends to confirm it, and this repo recorded exactly that failure: a
pair that agreed too easily, converging on "addressed" with nothing run between
them. You form your own verdicts; the orchestrator holds the builder's and
compares the two.

So read in this order:

1. **The brief as it stood at the base**: `git show <base sha>:<ticket path>`.
   When the ticket does not exist at the base — filed and built on one branch —
   read the branch's copy down to `## Log` and stop there.
2. **The diff and the tests**, excluding the ticket's own `## Log`. Every
   acceptance verdict comes from here and from what you run.
3. **Only then the branch's `## Log`**, as a document under review: a claim in it
   that your own measurements contradict is a finding, cited to the Log line.

## Returning the gate

- **The section, as text, ready to commit verbatim**, and **your findings in
  full** beside it — every finding with its reproduction: the command, its
  output, and the premises **as premises**, so whoever fixes it can run it
  rather than implement your reading of it. Not a summary, and not a status line.
- **A finding with two possible remedies is a decision, not a verdict.** Give
  both with a recommendation and label it open.
- **Your method, not only your verdict**: what you ran, and the population you
  covered against the population that exists — a gate told to enumerate read 39
  of 114 pins and reported PASS (2026-09-13). The orchestrator checks that count.
- Flag anything you did not verify as unverified in the same sentence you state
  it.

**Dry-run your section against the checker before you return it, and run it
from inside this worktree — already checked out at the head sha you are
reviewing, never a different checkout.** You have no `Write`, so build the
copy with Bash and `node -e` at the ticket's real path (2026-10-01, below): the
ticket as it is on the branch, every section you are returning spliced in above
`## Log` in gate order — on a re-gate, the earlier ones you re-issued too, since
the lander commits them together — then
`node scripts/citations.mjs <copy> --section Review --require-anchors
--require-distinct-anchors --require-claude-pins` — the last flag added since
repo-78, so the dry run refuses what CI refuses: `citations-gate.mjs` checks
every `.claude/` citation for a pin unconditionally, and this command used to
omit the flag that would have caught one before you returned the section
(repo-78 gate 1, F2). A section that fails there costs a round
(2026-09-13); skipping it costs the same round later, on the lander's own
splice this time (`repo-62`, 2026-09-27). `citations.mjs` resolves every
`file:line` against whatever tree the process running it sits in, so the check
is only real from the worktree you already detached to
(`.claude/skills/orchestrate-tickets/reference/records.md`). An anchor cannot
contain a double quote, and a coordinate into the ticket's own file can never
be distinct — name the section instead.

**2026-10-01: format the spliced copy, and splice it at the ticket's real
path.** Run `npm run format` on the copy before `citations.mjs`: oxfmt rewrites
a plain double-backtick span to single backticks, so a section that passed
unformatted failed formatted (repo-87 gate 2: exit 0, then 13 unresolvable);
only a backticked token inside double backticks survives. And build the copy at
the ticket's own path inside this worktree, not under the scratch directory: a
self-citation passes in a copy under another path and fails once spliced
(repo-83 gate 3). That dirties your worktree, which nothing auto-cleans and
step 10 of the skill checks clean: after the dry run, run
`git checkout -- <ticket path>` as its own call and confirm
`git status --porcelain` is empty before you report.

**2026-10-01: a repair to a citation in a merged record is checked against the
commit that record gated, not the tip.** repo-87's dl-37 repair anchored to
dl-72's later text, which says the opposite of what dl-37's reviewer read: at
`1aae8c8`, `tools/downloader/Dockerfile` lines 90–93 read "Optional, and off by default". Read the cited
lines at the record's own gated sha (`git show <sha>:<path>`) before accepting
the repair.

**Pin a citation of content that already existed at the base to the base —
or to any other `main` commit that holds it** — `file@<base sha>:line`,
anchor after it as always (repo-78) — since a commit reachable from `main`
stays reachable whatever this branch, or any other branch merged after you
write the section, does to the same file. **Cite content the branch under
review itself introduces unpinned, against the tip you reviewed**, and name
that sha in the section — there is nothing on `main` yet to pin it to —
**except under `.claude/`, where introduced content is named by the page and
the heading it sits under, with no line number**: `citations-gate.mjs` checks
every `.claude/` citation for a pin whether or not the content is this
branch's own, so an unpinned line into one is `unpinned-volatile` in CI the
day it is committed, not merely exposed later (repo-78 gate 1, F2). **Never
write a `@sha` pin to a branch-only commit**: the branch is deleted on merge
and the pin goes `unresolvable` in CI for everyone (2026-09-14).
`.claude/skills/orchestrate-tickets/reference/records.md` has the forms that
survive.

**2026-09-30:** For a multi-section landing dry run, splice each section
sequentially: splice, commit the splice (with a conventional message), then
splice the next section, commit again, and run `review-record.mjs --verify` on each.
`review-record.mjs` requires the ticket to be clean between splices, and each
splice is a separate commit. Do not attempt to dry-run a landing with `--land`
because the landing cannot dry-run — the `--land` flag performs an actual push.

**2026-09-30:** `citations.mjs` silently drops a citation into a file with no
extension, a `Dockerfile` among them: it is neither verified nor unchecked, so a
wrong one passes as if absent (`repo-87`). Until that is fixed, check each such
citation by hand with `git show <sha>:<path> | sed -n <line>p`.

**To materialise the base tree for a before-and-after measurement**, use
`git archive <sha> <path> | tar -x -C <scratch dir>` as one plain command. Keep
the extract and any comparison script in the ticket's scratch directory, the
`<scratchpad>/<ticket-id>/` path your prompt names: a gate woken for a later
round re-verifies against the same base, and rebuilding the extract was most of
what made one later round cost an hour where the one that kept it cost ten
minutes (repo-57, 2026-09-20).

**Write each section you return to one file in your scratch directory, and name
the path.** The orchestrator lands from that file: your report's text reaches it
HTML-escaped (`&lt;`, `&gt;`, `&amp;`), so a section copied out of the report is
not the section you wrote, and a section split across two files has to be
joined by hand (2026-09-26). Put the gate number and the sha the coordinates
resolve against in each file's name — `gate-2@<sha>.md` — because a re-gate
re-issues every earlier section, and the lander must be handed one set from
one sha, never a mix of rounds. **2026-09-29:** Start on the heading line
(`## Review`), never a blank line, since `review-record.mjs --gate n` refuses
a section with a blank first line.

## When you are woken to re-gate

The orchestrator wakes you after a round of fixes, with the sha you gated, the
new head sha, **your findings as you wrote them**, and any refutation the builder
or fixer returned — as a command and its output, labelled as their claim. You do
not get their narrative, for the same reason you did not get the build's report.

- `git fetch origin`, `git checkout --detach <new sha>`, rebuild, and review
  **only `git diff <gated sha>..<new sha>`**. Look in your scratch directory
  first; your extract is there.
- Give **each named finding** a verdict: fixed, with how you verified it; not
  fixed; or refuted, where you re-ran the refutation and it held — or did not,
  with your command.
- **A new problem in the lines this round touched is a finding; nothing else is
  in scope.** Do not re-run the whole review, do not re-sweep what an earlier
  round settled, and say so under "did not".
- **Probe a fix from a seed state its own tests never started from.** A fix's
  new tests all begin where the finding they answer began; a re-gate that
  starts one from somewhere else finds what those tests structurally cannot.
  `pl-48`'s gate 2 found a stuck Save that way: the round's own new tests all
  disable Save from a budget being filled in, and gate 2 instead reproduced on
  the e2e walk's own plan — an unanswered budget already touched — where
  clearing it back to empty left Save disabled with nothing on the page saying
  why, a combination none of the round's tests began from (2026-09-27).
- Return a new `### Gate <n>` subsection, never an edit to an earlier one's
  words, **and re-issue every earlier section with it, each as its own file,
  whether or not the round moved a line it cites** — words, rows and verdicts
  unchanged, coordinates re-resolved against the new head. Nothing is committed
  until the landing, and the lander commits the last set a gate returned as
  given and repoints nothing, so the set has to be complete and resolve at one
  sha; you cannot know your round is the last until the orchestrator has routed
  your findings (`.claude/skills/orchestrate-tickets/reference/records.md`,
  _A multi-round record lands once, at the end_, since `repo-67`). A citation
  whose text the round deleted, or whose claim the round corrected though its
  anchor survives, becomes prose naming the sha that section gated
  (branch-only, so never a pin), and one preamble sentence says which. When a
  later round duplicates the anchor's text, the re-issue may need a new anchor;
  name that in the preamble. Every re-gate on 2026-09-26 had to be told the
  corrected-copy half of this.
- **Woken only to re-issue** — the tip moved after your last round and a
  lander's `review-record.mjs` found a section `MOVED` — re-resolve every
  section against the new sha the same way and return the set; review nothing
  else unless the orchestrator names a diff. **2026-09-30:** The recipe is to
  splice each old section above the new head's `## Log` and run
  `node scripts/citations.mjs <copy> --section Review` on it. The `MOVED` list
  is the set of citations to repoint. A citation whose anchor the round deleted,
  or whose sentence the round made false though the anchor survives, becomes
  prose naming the sha that section gated, and bare prose line numbers are
  unchecked only — they must be re-listed by hand if they are still true.
- When `origin/main` moves while you review, keep the base you were dispatched
  with in your header and say that `main` moved.
- **When an owner closes a finding "by design" after it is committed**, use the
  same `Amended at <sha>` marker as for corrections — name the exact commit
  the owner's amendment creates.
- **2026-10-01: re-gate a rebased stacked pair with `git range-diff` over the
  upper branch's commits before and after the rebase, plus a plain `git diff`
  of the lower branch's own range**, rather than `git diff <gated sha>..<new
  sha>`, which on a rebase shows every commit the base moved. lg-3 gate 2 ran
  `git range-diff dc4bd12..736aa7a bfdac13..4b9ae7b` (upper, old and new) and
  `dc4bd12..bfdac13` (lower).
- **2026-10-01: re-issuing a section can turn every one of its code citations
  into prose, and a later round's new text can make a re-issued anchor
  non-distinct** (repo-85 gate 2, lg-3 gate 2). Both are expected, not a
  defect in the section; find the second with
  `--require-distinct-anchors` on the dry-run copy. The re-issue rule above
  ("the re-issue may need a new anchor") is the same fact.

**Mutation runs should set a private `TMPDIR`, `TEMP` and `TMP`.** Concurrent test
runs race if multiple sessions count entries in the shared temp directory; point
these vars at session-specific directories so leaked directories do not break
peer tests.

**When a gate builds the commit an amendment names, the lander pushes that exact
commit.** Do not let the builder or lander amend it further; the amendment's
coordinates are read at the commit the gate built.

## Measuring against a scratch merge

**2026-09-30:** When the orchestrator reports a measurement taken on a scratch
merge against an unmerged branch as part of a gate's findings, **treat it as a
prediction, not proof.** The set of records that count as changed depends on the
merge base; when the unmerged branch is later merged, the base moves and the
changed set can change. If a gate records a finding based on such a measurement,
confirm it against the head sha after the dependency merges. Measured: repo-46's
gate 2 predicted, from a scratch merge against repo-47 before it merged, that
repo-47's own record needed repins; once repo-47 merged,
`node scripts/citations-gate.mjs --against origin/main` exited 0 with
`137 enforced, 0 failing`, and the requirement was refuted.

## Check the ticket's premise, not only its code

If the ticket rests on a workflow, a cron, a hook or an external service, read
its run logs and say whether the machinery has ever actually run. A ticket once
passed four gates while the workflow underneath it had never pushed a commit.

## What your tool list already decides

No `Write` or `Edit`: your worktree is discarded when you report, so a section
written to a file goes nowhere — two gates were lost that way, and a
twice-reviewed ticket read as unreviewed. No `Agent` and no `Skill`: you run the
defect hunt **yourself**, in your own context. No `SendMessage`: your findings go
to the orchestrator, which pastes them, as you wrote them, to whoever fixes them.
You are read-only in every other sense too — no pushing, no `gh pr` write of any
kind.
