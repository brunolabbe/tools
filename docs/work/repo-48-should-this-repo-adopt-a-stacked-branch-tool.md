---
id: repo-48
tool: repo
title: Whether this repo should adopt a stacked-branch tool, and which one
kind: chore
status: ready
milestone: null
depends_on: []
---

# repo-48 — Whether this repo should adopt a stacked-branch tool

## Why

The owner raised this on 2026-09-19 after the 2026-09-17/18 downloader batch,
and chose to file rather than decide: the choice among the three options below
is the owner's, but the evaluation that has to precede it is not decision work,
it is research work, so it belongs in a ticket rather than in a question asked
cold.

**The occasion, verified rather than taken on the account that prompted this
filing.** In that batch, `dl-56` (PR #267, still open) and `dl-58` (PR #269,
merged into `main` at `fb15bc9`) both touched
`tools/downloader/engine/src/index.ts` on adjacent lines: `dl-58` rewrote the
`runFfmpeg` export line to add `redactUrlsInText`, and `dl-56`'s branch carries
the same line **without** that addition, followed immediately by ten new export
lines for a preview-frame module. Confirmed directly:

- `git show origin/main:tools/downloader/engine/src/index.ts` line 711 reads
  `export { isTlsVerificationFailure, redactUrlsInText, runFfmpeg } from
"./ffmpeg/runner.ts";`; the same line on `origin/dl-56-grab-a-preview-frame`
  reads `export { isTlsVerificationFailure, runFfmpeg } from
"./ffmpeg/runner.ts";`, immediately followed by a new
  `export type { PreviewFrameOptions } ...` block.
- `git merge-tree --write-tree origin/main origin/dl-56-grab-a-preview-frame`
  reports exactly one conflicting file, that same one.
- **The reconciliation has since happened, mid-filing.** `gh pr view 267` first
  read `CONFLICTING` / `DIRTY` against `main`; it now reads `MERGEABLE` /
  `UNSTABLE`, because `dl-56`'s branch carries a new merge commit, `00faef5`
  ("chore(downloader): merge main into dl-56 (dl-56)"), whose own message
  confirms exactly the predicted conflict: "One conflict, in
  `engine/src/index.ts`: dl-58's widened runner export and this branch's
  preview-frame block, both kept." So the round the brief described **was
  paid, once, on the second branch** — this filing caught it mid-flight rather
  than after the fact, not a case where the prediction was wrong.
- This matches `.claude/skills/orchestrate-tickets/reference/history.md`'s own
  independently-verified "Seam overlap" note for the same batch (its
  "Twenty-third session" row): "Both `dl-58` (`engine/src/index.ts`, the
  `runFfmpeg` export line) and `dl-56` (the same file, ten lines inserted
  immediately after) touch that file on adjacent lines over `origin/main` —
  confirmed by diffing each branch against `origin/main` directly, not taken
  on the account's word."

**One thing in the prompt that prompted this filing was checked twice, and the
second check reverses the first — this is the ticket's strongest finding, and
it changes what Option 1 below has to say.** The original claim was "the
intake seam map predicted this collision before either builder was
dispatched." A first pass found no support for that framing anywhere in the
tree, since a seam map's raw output is never committed in this repo, and
left it uncorroborated. The orchestrator has since supplied the actual reason
it cannot be corroborated, and it is the opposite of an evidence gap: **the
seam map did not predict this collision because the collision did not exist
yet when the seam map ran.** This is the orchestrator's own account of its
retained session transcript, not itself in the tree — recorded here as its
account, provenance-marked, and checked as far as the tree allows:

- The orchestrator holds the seam-mapper's report from that session (never
  committed, per the gap above) and says it flagged `dl-58` against `dl-66`
  (`api/src/server.ts`) and, conditionally, against `dl-54` (`logger.ts`) —
  and reported **no pair for `dl-56` with `dl-58` at all**. Unverifiable from
  the tree; taken on the orchestrator's word.
- What _is_ verifiable from the tree: `dl-58`'s own committed ticket
  (`tools/downloader/docs/work/dl-58-a-failed-probe-logs-the-page-url-unredacted.md`)
  scopes its original Build to the `api` package only ("Packages: `api` (the
  error handler, and possibly the logger)"; its step-3 "choose the layer"
  offers two candidates, both inside `api`) — `engine` appears nowhere in
  that original scope. The `engine/src/index.ts` export exists only from the
  owner's **D1(a)** decision, dated 2026-09-17 in that ticket's own Log: "Reuse
  `engine/src/ffmpeg/runner.ts`'s existing `redactUrlsInText` matcher... It
  stayed inside `@downloader/engine` (exported through that package's own
  index...)". `git show fb15bc9 -- tools/downloader/engine/src/index.ts`
  confirms the squashed `dl-58` commit's entire touch to that file is the
  one-line export change the D1 decision describes — nothing about `engine`
  reached that branch before D1. So the tree independently confirms the half
  of the claim it can see: the seam this ticket is about was created by a
  decision taken **after** dispatch, not present at intake for any seam map to
  have seen. Whoever picks this ticket up should treat "the collision was
  created by a post-dispatch decision" as tree-confirmed, and "the seam map's
  matrix named these specific other pairs and not this one" as the
  orchestrator's account, not independently checkable.

**This is not a one-off.** `history.md` records the same shape twice more,
both re-read here for what they actually say, not for a paraphrase:

- **Nineteenth session (2026-09-13)**, `history.md@fdafd1a:2672` — matches. "The
  seam-mapper reported no file overlap, and the owner chose 'pl-39 + pl-42
  only'... The branches as finished share two paths, neither of which the
  briefs predicted: `tools/planner/contract/src/errors.ts` (pl-42's new codes;
  pl-39's reworded `AGENT_UNAVAILABLE` comment, **from the owner's first pl-39
  decision**)". Same mechanism: an intake-time seam map that ran before a
  mid-batch decision cannot see a seam that decision goes on to create. The
  one difference worth stating plainly: this instance was cheap, not
  costly — the same passage records "`git merge-tree --write-tree` reports no
  conflict, and the scratch merge passes the citation gate." A shared touch
  is not always a collision; `dl-56`/`dl-58` is the case where it was.
- **Seventeenth session (2026-09-12/13)**, `history.md@fdafd1a:2511`, item 10 —
  **does not match, and is dropped from this claim rather than folded in.**
  That passage is about `repo-39` and `repo-35` both editing the
  `GRANDFATHERED` list, which moved lines `repo-37`'s **already-existing**
  citation depends on: "The seam map could not see this, because the
  collision is a citation _into_ a shared file, not an edit _of_ one." That
  seam existed at intake; the seam map missed it because its detection is
  edit-based, not because a later decision created it. A different failure
  mode of the same tool, not the same pattern as the two rows above — cited
  here only to say so.

So the count for "a decision taken after dispatch creates a seam no intake-time
map could have seen" is **two** confirmed instances (`dl-56`/`dl-58`,
`pl-39`/`pl-42`), one of which cost a real merge round and one of which did
not — not three. The evaluation below should lead with this finding, ahead of
the three tool options: **the seams that cost this repo merge rounds are, at
least sometimes, ones a decision creates after dispatch, and neither
intake-time mapping nor a stacking tool addresses that without a re-check
triggered by the decision itself** (a stacking tool still needs a human or a
map to notice the new seam before choosing to stack on it — say this plainly
in the evaluation rather than letting the finding read as support for Option 2
or 3).

**The cost this batch actually paid is not novel, and a stacking tool would
not close the largest part of it.** `history.md`'s Sixteenth session row
(`repo-40`) measured the same class of problem head-on:
`.claude/skills/orchestrate-tickets/reference/history.md@fdafd1a:2304-2307` — "Under
squash-merge, a stacked branch conflicts with `main` after its own base lands
even though it carries the identical commits, because the squash produces a
new commit that is not an ancestor of the stack." That reconciliation is paid
in gate-record citations, not in source: gate records cite `file:line`, and
`scripts/citations-gate.mjs` enforces those citations on every "`## Review`"
section not on its grandfather list. A rebase or a restack that moves a cited
line breaks that citation for whichever branch is behind, and **no stacking
tool changes this** — it is a property of committing `file:line` citations at
all, not of how the branches under them are managed. Say so explicitly in the
evaluation so nobody adopts a tool expecting it to fix that half.

**A second merge-time cost, independently reproduced here rather than taken on
a relay.** While `dl-56`'s builder was resolving the conflict above, it
reported that running `scripts/citations-gate.mjs` **before** staging the
resolution — mid-merge, with `engine/src/index.ts` still unmerged — falsely
failed `dl-45`, a ticket wholly unrelated to either branch, as `ambiguous`.
Reproduced in a scratch clone rather than trusted: checking out `dl-56`'s
pre-merge tip and running `git merge fb15bc9 --no-commit` recreates the same
conflict; `git ls-files -- tools/downloader/engine/src/index.ts` then prints
that one path **three times** — once per unmerged stage (1/2/3), which is
ordinary `git ls-files` behaviour on a conflicted path, not a bug in the
citation tooling by itself. `scripts/citations.mjs`'s `makeResolver` (and
`candidateFiles`, both in `scripts/citations.mjs`) build their candidate list
from exactly that `ls-files` output, so any citation naming that exact path —
and `dl-45` names it four times, none of them the file actually in conflict on
either branch — reports `ambiguous — 3 tracked files match (...)`, all three
matches being the same path duplicated. Running
`node scripts/citations-gate.mjs` in that state reproduces the same `FAIL` on
`dl-45`; `git add tools/downloader/engine/src/index.ts` to stage the resolution
clears it immediately, confirming the builder's own account that the failure
"cleared once the resolution was staged." **No stacking tool closes this
either** — it is a property of resolving any conflict on a file any other
ticket's gate record cites, staged or not, and it fires equally whether the
merge is a manual reconciliation, a stacking tool's automatic restack, or a
plain `git rebase`. Say so next to the citation-coordinate caveat above, not as
a separate, unrelated risk.

## Build

Write the evaluation as a document appended to this ticket (a new `##`
section, e.g. `## Evaluation`), or as its own file under
`docs/work/` if it grows past a ticket's usual size — record which you chose
and why in the Log either way. Do not install anything, do not edit
`.devcontainer/Dockerfile` or `.devcontainer/allowed-domains.txt`, and do not
run a container rebuild: this ticket is itself records-only, exactly as the
options it evaluates must be recorded before either is chosen. Verify every
claim below against the actual repo and actual public documentation before
writing it down — this ticket has already been burned once by an unverified
relayed claim (above); do not repeat that pattern.

1. **Re-confirm the tooling gap.** `command -v gt`, `command -v spr`,
   `command -v ghstack`, and `git-town`'s binary by whatever means avoids the
   sandbox's guard on commands that look like a raw `git` invocation (a
   variable holding the name works) — all absent as of this filing. If any of
   these has since been added to `.devcontainer/Dockerfile`, say so and treat
   the evaluation as partially moot for that tool.

2. **Evaluate option 1 — process only, no tool.** When a seam map (or any
   later check) flags a same-file collision between two open branches, cut the
   second branch off the first and open its PR as a draft against that base
   rather than against `main`. State:
   - The actual mechanics: which command re-targets an already-open PR's base
     (`gh pr edit <n> --base <branch>`), and what happens to it if the first
     branch is squash-merged and deleted (this repo does both) —
     `CLAUDE.md:188-190` "Check the base branch too: a pull request opened
     against another feature branch disappears with it, and its own page
     still says merged" is exactly the hazard a draft base has to be watched
     against, and
     `history.md@fdafd1a:2304-2307`'s measured repeat-conflict mechanism above is
     what still has to happen once the base lands.
   - That this option does not eliminate the reconciliation `repo-40`'s record
     measured; it only sequences _when_ it happens (once, after the base
     lands) instead of leaving two branches to collide in whichever order they
     merge.
   - Its real cost: zero installation, zero firewall change, works today. Say
     what it does _not_ solve (the citations-gate line-drift problem above,
     and any conflict a seam map does not see because it was never re-run
     mid-batch).
   - **Fold in, rather than treat as a separate option, the refinement the
     `dl-56`/`dl-58` and `pl-39`/`pl-42` finding above requires**: an
     intake-time-only seam map cannot catch a seam a decision creates after
     dispatch, so "check the seam map before dispatch" is not enough on its
     own — the process has to also re-run (or re-check) the seam map whenever
     an owner decision widens a branch's touched files into a package or file
     it did not originally name, not only at intake. State this as a second
     trigger for the same process (re-check on decision, not just at intake),
     say plainly it adds no tool and no install, and say plainly it would not
     have prevented `pl-39`/`pl-42`'s shared touch either — that one needed
     noticing, and this trigger is what would have supplied the notice, not a
     guarantee nothing is missed.

3. **Evaluate option 2 — Graphite (`gt`).** Confirm, from Graphite's own
   current documentation (not from memory), whether it restacks and retargets
   automatically after a squash merge, and confirm whether using its PR
   submission feature requires authenticating to a Graphite-operated service
   (as opposed to using `gt` purely as a local rebase-helper with plain `gh` or
   `git push` for the actual PR). If PR submission does route through
   Graphite's service, say plainly that this repo's branch names, commit
   messages and PR metadata would leave the machine, and weigh that against
   `.claude/settings.json`'s existing posture (`gh api` itself is denied
   outright) rather than treating it as a footnote. State the concrete
   install and firewall cost: which line in `.devcontainer/Dockerfile`, and
   which hostname(s) would need to go into
   `.devcontainer/allowed-domains.txt` (checked against Graphite's actual
   API/auth hostnames, not guessed), plus the rebuild
   ("Dev Containers: Rebuild Container") that `.devcontainer/init-firewall.sh`
   requires for either to take effect — confirmed at
   `.devcontainer/init-firewall.sh:25-27`, "The image's own copy, root-owned,
   not the repo's `.devcontainer/` file... Adding a host means a rebuild."

4. **Evaluate option 3 — `spr` (ejoffe) or a `gh` stack extension.** Confirm
   `spr`'s actual model (one commit per pull request, GitHub API only, no
   third-party account) against its own current documentation. Then check the
   tension named in the brief directly against this repo's flow: a ticket
   branch here accumulates many commits (builder rounds, gate records, fix
   commits) before opening **one** PR that squash-merges under a title that is
   itself the changelog line. Determine whether that tension is real or
   avoidable — e.g., whether squashing a ticket's own branch to one commit
   before running `spr update` reconciles the two models, what step that adds
   to this repo's existing flow, and whether `spr`'s per-commit PR creation
   would fight `release-please-config.json`'s path-based routing (its
   `packages` block names exactly `tools/downloader` and `tools/planner`) or
   the "two tools means two pull requests" rule if a stack ever mixed commits
   from both. Say which reading holds, not just that a tension exists. Note
   any `gh` stack extension considered alongside `spr` and why it was or was
   not evaluated as a fourth candidate.

5. **State both citation caveats once, plainly, in the evaluation's own
   words** (not just inherited from this Why section): whichever option is
   recommended, it does not fix (a) the fact that a merge or a rebase moving a
   cited `file:line` breaks `scripts/citations-gate.mjs` for the branch behind
   it, and (b) the fact that `citations-gate.mjs` run against an unstaged
   merge conflict reports a false `ambiguous` failure on any unrelated ticket
   whose record cites the conflicted file, until the conflict is staged. Both
   are properties of this repo's gate-record format and of `git ls-files`'s
   ordinary behaviour on a conflicted path, not of branch management, and
   nobody should adopt a stacking tool expecting either to go away.

6. **Open with the decision-creates-seams finding as the headline, ahead of
   the three tool options**, in the evaluation's own words: at least two
   confirmed batches (`dl-56`/`dl-58`, `pl-39`/`pl-42`, both cited above) show
   an intake-time seam map missing a seam that an owner decision created after
   dispatch, and state plainly that neither an intake-time-only map nor a
   stacking tool closes that gap without a re-check triggered by the decision
   itself — a stacking tool still needs the same notice before it can act on
   it.

7. **End with a recommendation naming exactly one of the three options**, with
   its cost stated in commands and file changes, not adjectives, and the
   costs of the two rejected options stated with the same rigor so the
   rejection is checkable rather than asserted.

## Done when

- The evaluation opens with the decision-creates-seams finding (step 6 above)
  ahead of the three tool options, naming both confirmed batches and stating
  plainly that no option here closes that gap without a decision-triggered
  re-check.
- The evaluation names, for **each** of the three options, a concrete cost in
  commands or file paths (a Dockerfile line, an allowlist hostname, a `gh`
  command, an install command) — never an adjective standing alone for a cost.
- The evaluation states plainly whether `spr`'s one-commit-per-PR model is in
  tension with this repo's squash-merge-and-one-title flow, and says which of
  "real" or "avoidable" holds, with the reasoning that produced that answer.
- The evaluation states both citations-gate caveats
  (`scripts/citations-gate.mjs`'s `file:line` line-drift problem, and its
  false `ambiguous` failure on an unrelated ticket during an unstaged merge
  conflict on a file that ticket cites) as limitations that hold regardless of
  which option is chosen, not as an argument for one option over another.
- The evaluation ends in a recommendation naming exactly one of the three
  options by name, leaving the actual choice to the owner.
- Nothing is installed, no container file is edited, and no container rebuild
  is run in producing the evaluation — checkable by `git diff --stat` against
  `origin/main` touching only ticket/doc paths.

## Evaluation

Written 2026-09-27 against `origin/main` at `1a8321c`. The evaluation below
recommended an option and decided nothing. **The owner has since decided; the
decision is recorded under "Decision" at the end of this section.**

**How the public claims were checked.** Every claim about a tool below comes
from a page fetched with `curl -sL` on 2026-09-27 and read, and the URL is
given next to it. Where a page could not settle a point, the point is marked
**unverified**. The copies were kept in the session scratch directory and are
not committed. One caveat on the fetches themselves: `curl https://example.com`
returned `200` in the same session, so the container firewall's `OUTPUT` policy
was open. A successful fetch therefore says **nothing** about whether a host is
on the allowlist. Every firewall cost below comes from
`.devcontainer/allowed-domains.txt` and from `getent ahostsv4`, not from
whether a fetch worked.

### Step 1: the tooling gap still holds

`command -v gt`, `spr`, `ghstack`, `gh-stack` and `av` print nothing. A scan of
every `$PATH` directory (1,679 entries) for `town|stack|spr|gt|ghstack|graphite`
matches nothing, so `git-town` is absent too. `gh extension list` prints
nothing. `grep -i -E 'graphite|spr|ghstack|town|stack'` over
`.devcontainer/Dockerfile` and `.devcontainer/allowed-domains.txt` matches
nothing. The container has `git version 2.43.0` and `gh version 2.101.0`.
Nothing here makes the evaluation moot for any tool.

### The headline: a decision can create a seam after dispatch

In at least two batches, a seam that no intake-time map could have seen was
created by an owner decision taken after dispatch:

- **`dl-56` / `dl-58` (2026-09-17/18).** `dl-58`'s original Build named only
  `api`. The owner's D1(a) decision moved the fix into
  `@downloader/engine`'s export line, and that line collided with the ten lines
  `dl-56` inserted right after it. It cost one merge round on the second
  branch: `00faef5`, "chore(downloader): merge main into dl-56". Both have since
  merged. `gh pr view 267` reads `MERGED` at 2026-09-19T01:30:16Z.
- **`pl-39` / `pl-42` (2026-09-13).** The seam-mapper reported no file overlap.
  The branches as finished shared
  `tools/planner/contract/src/errors.ts` because of "the owner's first pl-39
  decision" (`history.md@fdafd1a:2672`). It cost nothing, because
  `git merge-tree` was clean.

**No option below closes this gap on its own.** A stacking tool acts on a seam
someone has already noticed. It has to be told that branch B now depends on
branch A before it can stack B on A, and an intake-time seam map is the thing
that did not notice. What closes the gap is a **re-check triggered by the
decision itself**. That re-check is folded into Option 1 below, and every other
option needs it too. It is not an argument for any one of them.

### What no option fixes: two limits of the citation gate

Both limits come from how gate records are written and from how git behaves
during a conflict. Neither depends on how branches are managed. Graphite,
`spr`, `gh stack`, GitHub's server-side "Rebase stack" and a hand-typed
`git rebase` or `git merge` all hit them the same way.

1. **Line drift.** A gate record cites `file:line`, and
   `scripts/citations-gate.mjs` checks those citations in every `## Review`
   section that is not grandfathered. Any merge, rebase or restack that moves a
   cited line breaks the citation on whichever branch is behind. Every option
   below moves lines, whether it merges, rebases or restacks. The repair is the
   one `records.md` already prescribes: re-resolve the citations, repoint them
   or pin them.
2. **A false `ambiguous` result during a conflict that has not been staged
   yet.** While a file is conflicted, `git ls-files` lists its path once for
   each unmerged stage, so the path appears three times. `candidateFiles` in
   `scripts/citations.mjs` builds its list of candidate files from that output.
   Two measurements from this session:
   - In a throwaway repository, `git ls-files -- f.ts` printed `f.ts` three
     times mid-conflict and once after `git add`.
   - `makeResolver` fed that same path three times reported
     `ambiguous — 3 tracked files match (tools/downloader/engine/src/index.ts, …)`
     for the suffix form `engine/src/index.ts`, and resolved the full
     repo-relative path correctly. The full path hits `tracked.includes(file)`
     before any suffix matching happens.

   **So the false failure hits citations that use the suffix form**, not every
   citation of the conflicted file. `dl-45`'s ticket, for example, cites the
   suffix `engine/src/index.ts` with a line number. The example is only there
   to show the form. That coordinate is already stale: it is past the end of
   today's 134-line file, so resolving it literally finds nothing. That narrows what the Why section says. Staging the
   resolution clears it. The mechanism is the same whatever produced the
   conflict: a manual merge, a tool's automatic restack or a plain rebase.

### Option 1: process only, no tool

**The mechanics.** When a seam map, or any later check, flags a same-file
collision between two open branches:

1. Cut the second branch from the first: `git checkout -b <B> origin/<A>`.
2. Open its pull request as a draft against A:
   `gh pr create --draft --base <A> --title "<checked title>"`. For a pull
   request that is already open, `gh pr edit <n> --base <A>` retargets it.
3. Keep B a draft until A has merged. The draft flag is what stops B being
   squash-merged **into A's branch** before A reaches `main`. This repo has
   done that once. `gh pr list --state all` shows exactly one pull request ever
   opened against a non-`main` base: #50, whose base was `pl-17-image-closure`.
   Its base pull request #49 was closed unmerged at 2026-08-22T00:26:37Z, and
   #50 was merged into the dead branch 46 minutes later, at 01:12:42Z. Its merge
   commit `c305c20` exists locally, and
   `git merge-base --is-ancestor c305c20 origin/main` exits `1`. This is the
   hazard in `CLAUDE.md`'s "Check the base branch too: a pull request opened
   against another feature branch disappears with it, and its own page still
   says merged". That sentence is at `CLAUDE.md:189-191` on `1a8321c`; the Build
   above cites it as `188-190`.
4. When A squash-merges, GitHub retargets B to `main` by itself. The repository
   has `deleteBranchOnMerge: true` (from `gh repo view --json`), and GitHub's
   documentation says that when a merged pull request's head branch is deleted,
   GitHub "automatically updates any such pull requests, changing their base
   branch to the merged pull request's base branch" (source:
   https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-and-deleting-branches-within-your-repository).
   That protects B only when A **merges**. It does not help when A is closed
   unmerged, which is the #50 case. There the repair is
   `gh pr edit <n> --base main`, done by hand.
5. Reconcile B with `main` once. After the squash, B still carries A's original
   commits, which are no longer ancestors of `main`. That is the mechanism
   `history.md@fdafd1a:2304-2307` measured, and #214 and #215 each paid it once
   (`1b7a923`, `7a12272`). The repo's own prescription is
   `git rebase --onto origin/main <A's old tip> <B>`
   (`.claude/skills/orchestrate-tickets/reference/concurrency.md:318`), with the
   old tip recovered from `gh pr view <A> --json headRefOid`. Then run
   `gh pr ready <n>`.

**The second trigger: re-check on a decision, not only at intake.** The headline
finding means an intake-time seam map is not enough. Whenever an owner decision
widens a branch into a package or file its Build did not name, the orchestrator
re-checks that branch against every other branch in the batch. Two commands
cover it:

- `git diff --name-only origin/main...origin/<branch>` on each branch, compared
  for shared paths.
- `git merge-tree --write-tree origin/<this> origin/<other>` on each pair, to
  find the textual conflicts.

`scripts/preflight.mjs`'s check 5 already runs that same `merge-tree` probe,
but only against **open pull requests**, and only when a builder runs
preflight. The second trigger moves the probe to the moment the decision is
relayed. It adds no tool and no install. It would **not** have prevented
`pl-39`/`pl-42`'s shared touch, because that touch merged clean. It would have
supplied the notice that the pair now shares a file, which is all any option
can act on. It is not a guarantee that nothing gets missed.

**What it does not change.** It does not remove the reconciliation `repo-40`
measured. It only moves it to one known point, once, after A lands, instead of
leaving two branches to collide in whichever order they merge. The upside is
that B is built on A's decision, so the conflict it eventually meets is
duplicate content, not a real merge of two designs. Both citation limits above
still apply.

**Cost.**

- Nothing to install, no firewall change, and it works today.
- CI already runs on a pull request whose base is a feature branch. The
  `pull_request:` triggers in `.github/workflows/ci.yml`, `downloader.yml` and
  `planner.yml` carry no `branches:` filter.
- One edit to adopt it: a paragraph in
  `.claude/skills/orchestrate-tickets/reference/concurrency.md` for steps 2–4
  and the second trigger. Its `--onto` passage already covers step 5.

### Option 2: Graphite (`gt`)

**Restack and retarget after a squash merge.** They happen automatically only
when the stack is merged from Graphite's app. The docs' "Automatic rebasing"
section says: "Graphite will automatically rebase your partially-merged stacks
so long as you click `merge` from the Graphite app. **This feature does not
work when merging from GitHub.**" Source:
https://graphite.com/docs/merge-pull-requests.md. The owner merges on GitHub,
so here the documented path is the manual one: `gt sync` to pull trunk, delete
the merged branch and restack the rest, then `gt submit` to force-push the
restacked branches (https://graphite.com/docs/merge-stack-prs-github.md,
https://graphite.com/docs/sync-with-a-remote-repo.md). Those are local commands
run in each worktree. Graphite "does not modify branches checked out in
another worktree", and a stack spread across worktrees needs `gt sync` "run
separately from each relevant worktree"
(https://graphite.com/docs/multiple-worktrees.md). In this repo every ticket
has its own worktree, so each builder would run it.

**PR submission goes through Graphite's service.**

- Authentication: sign in at `https://app.graphite.com/activate` with GitHub,
  then run `gt auth --token <token>`
  (https://graphite.com/docs/install-the-cli.md).
- New accounts must install the Graphite GitHub App, and OAuth is no longer
  offered (https://graphite.com/docs/authenticate-with-github-app.md).
- The App requests "Read & write: actions, checks, contents, pull requests,
  workflows", and on `gt submit`: "Metadata about which branches were pushed to
  GitHub are sent to Graphite servers so we can open those PRs on your behalf"
  (https://graphite.com/docs/privacy-and-security.md).
- Graphite stores the GitHub access tokens server-side (same page) and logs
  CLI usage metadata, "commands being run".
- The Linux binary itself (`@withgraphite/graphite-cli-linux-x64@1.8.6`,
  downloaded and read with `strings`, not run) embeds `https://api.graphite.com/v1`
  and the routes `/graphite/submit/pull-requests`, `/graphite/cli/retarget-pr`
  and `/graphite/cli/log-actions`.

So this repo's branch names, pull request metadata and command history would
leave the machine for a third party, and that party would hold a token with
write access to `contents` and `workflows`. That sits badly with
`.claude/settings.json`, which denies `Bash(gh api *)` and
`Bash(gh auth token*)` outright: the repo refuses to let its own agents make
arbitrary GitHub API calls, and this option hands that capability to an outside
service. `gt merge` ("Merge the pull requests … via Graphite",
https://graphite.com/docs/command-reference.md) is also a merge path that the
`Bash(gh pr merge *)` deny does not match, so it would need its own deny rule.

**Whether `gt` works purely as a local rebase helper without `gt auth`** is
**unverified**. The documentation fetched here does not say which commands need
the token. The binary carries "No auth token set. Please run `gt auth --token
<token>`." without saying where it applies.

**Cost.**

- `Dockerfile`: `RUN npm install -g @withgraphite/graphite-cli@stable`, the
  documented npm route. It pulls a 99,279,476-byte unpacked binary package from
  `registry.npmjs.org` (already on the allowlist). The package's license field
  reads `None`, i.e. proprietary.
- `allowed-domains.txt`: `api.graphite.com`, which resolves to AWS addresses
  (`32.194.74.144`, `34.201.61.190`, `34.237.171.197`) that no current entry
  covers. `app.graphite.com` is only needed in the owner's browser for
  activation, and that runs outside the container.
- A rebuild ("Dev Containers: Rebuild Container"), because
  `.devcontainer/init-firewall.sh:25-27` reads the image's own root-owned copy
  of the allowlist: "Adding a host means a rebuild."
- An account and the GitHub App install. The Hobby tier is free and covers
  "Personal account repos" (https://graphite.com/pricing), and this repository
  is under the personal account `brunolabbe`.
- A new deny rule, `Bash(gt merge*)`.
- `gt` needs git ≥ 2.38, and the container has 2.43.0.

### Option 3: `spr`, or a `gh` stack extension

Two candidates fit the option as filed, and they behave very differently.

**3a. `spr` (ejoffe), v0.17.6, released 2026-04-22.**

Its model, from https://raw.githubusercontent.com/ejoffe/spr/HEAD/readme.md:

- "Each commit becomes a pull request."
- "The commit subject becomes the PR title."
- "Works with native GitHub. No extra services". That holds: it calls GitHub's
  API directly.
- Pull request branches are named `spr/<target>/<8-hex commit-id>`
  (`git/helpers.go`).
- Every local commit is rewritten by an interactive rebase so its body carries
  a `commit-id:` line (`git/helpers.go`, the `spr_reword_helper` path).

Two things sit badly with this repo's settings:

- It finds its token itself, in this order: `GITHUB_TOKEN`,
  `~/.config/gh/hosts.yml` or the keyring entry `gh:github.com`, then hub's
  config (`github/githubclient/client.go`, `findToken`). It then makes GitHub
  API calls that the `Bash(gh api *)` deny cannot see, because they are not
  Bash commands.
- `git spr merge` "combines all commits up to it into a single PR, merges it,
  and closes the intermediate PRs". That is a merge outside the
  `Bash(gh pr merge *)` deny.

**Is the tension with this repo's flow real or avoidable? It is real.**

Here a ticket is one branch, built in its own worktree by its own agent. It
collects many commits: builder rounds, one commit per gate record by
`review-record.mjs`, fix rounds. It then opens one pull request, which
squash-merges under a title that is the changelog line.

Squashing a ticket to one commit before `spr update` does fix the title: the
squashed commit's subject becomes the pull request's title, and
`.githooks/commit-msg` checks it. It fixes nothing else:

- **Both tickets' commits have to be on one local branch.** `spr` stacks
  commits, not branches. Stacking A and B means cherry-picking both squashes
  into a third branch in a third worktree, which neither builder owns.
- **The pull request's head becomes `spr/main/<id>`, not the ticket's
  branch.** Dispatch prompts, `gh pr list` lookups, fixers starting from
  `origin/<branch>` and gate records naming a reviewed sha all point at a
  branch the pull request no longer uses.
- **Every later round has to be amended into the one commit.** That means
  `git spr amend`, and it breaks "one commit per gate" in
  `roles/builder.md`'s landing steps.

So the extra step is not "squash once". It is "keep squashing on every round,
from a branch nobody builds on". That is a second workflow, not a reconciled
one.

**Release-please routing is not the problem, and the merge command is.** Each
`spr` pull request squash-merges its own commit's paths. The path-based routing
in `release-please-config.json` works per pull request, and its `packages`
block now names `tools/downloader`, `tools/planner` **and `tools/ledger`**
(the Build above lists two). A stack that mixes tools, one commit per tool,
therefore still lands as one pull request per tool, which matches the "two
tools means two pull requests" rule. `git spr merge` breaks that: it folds
several commits into **one** pull request under one title, which is exactly
the two-tools-one-sentence failure. That is avoidable only by never running it,
and nothing enforces that unless a `Bash(git spr merge*)` deny is added.

Cost of 3a:

- `Dockerfile`: fetch `spr_linux_x86_64.tar.gz` from the v0.17.6 GitHub
  release (`https://github.com/ejoffe/spr/releases`) and unpack it into
  `/usr/local/bin`. The apt route needs `apt.fury.io`, which is not on the
  allowlist.
- Release downloads redirect to `release-assets.githubusercontent.com`,
  measured with `curl -sI` on a GitHub release asset. That name is **not** in
  `allowed-domains.txt`. Today it resolves to the same four addresses
  (`185.199.108–111.133`) as the listed `objects.githubusercontent.com` and
  `raw.githubusercontent.com`, so the IP-keyed ipset would admit it by
  coincidence, not by name.
- The API calls go to `api.github.com`, which is covered by the GitHub `meta`
  ranges `init-firewall.sh` loads.
- A rebuild.
- A `.spr.yml` at the repository root with `mergeMethod: squash`, because the
  default is `rebase` and this repository allows squash only
  (`gh repo view --json`: `squashMergeAllowed: true`, the other two `false`).
- The deny rule above.

**3b. GitHub's own stacked pull requests, with the `github/gh-stack`
extension. This is new since the ticket was filed.**

GitHub now has native stacks, "in public preview and subject to change". They
need "**no setup or enablement**"
(https://docs.github.com/en/pull-requests/tutorials/roll-out-stacked-prs) and
can be created "from the GitHub website" with no CLI: open B against A's
branch and choose **Create stack**, or accept the banner GitHub shows when
pull requests already chain
(https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests).
The docs pages were fetched through
`https://docs.github.com/api/article/body?pathname=<path>`.

Documented behaviour that matters here:

- "When you merge a pull request at the bottom of the stack, the remaining
  branches are automatically rebased so the next pull request targets the
  default base branch"
  (https://docs.github.com/en/pull-requests/get-started/about-stacked-prs).
  That is the server-side form of Option 1's step 5.
- "**Squash** creates one clean, squashed commit per pull request. Merging `n`
  pull requests creates `n` squashed commits"
  (https://docs.github.com/en/pull-requests/reference/stacked-pull-requests).
  Every ticket keeps its own changelog line.
- "Closing a pull request in the middle of a stack blocks all pull requests
  above it from being mergeable"
  (https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-stacked-pull-requests).
  That would have stopped #50.
- Merging a pull request merges every unmerged one below it, and requires "a
  fully linear history" across the stack. When `main` moves, someone has to
  click **Rebase stack** or run `gh stack rebase`, which force-pushes every
  branch in the stack. "Auto-merge is not supported for stacked pull
  requests"
  (https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests).
- The extension (https://raw.githubusercontent.com/github/gh-stack/HEAD/README.md,
  MIT, v0.1.1 released 2026-09-02) adds local cascading rebases and
  `gh stack link <A> <B>`. GitHub's docs say that command "only calls the
  GitHub API to create the stacked pull requests — it does not create any
  local tracking"
  (https://docs.github.com/en/pull-requests/reference/use-other-tools-with-stacked-pull-requests).
  The README says the same in other words: "This command does not store or
  modify any `gh stack` local tracking state". That suits this repo's
  branch-per-worktree layout. The extension authenticates through `gh`.

What is **unmeasured** here:

- Whether a builder's usual `git merge origin/main` into a stacked branch (as
  in `00faef5`) counts as "linear" for the merge check.
- How a server-side rebase interacts with a builder whose worktree still holds
  the pre-rebase branch. From the mechanism, its next push would be rejected
  as non-fast-forward.
- Whether public preview is enabled for this personal repository in practice.

The docs say no enablement is needed, but nobody has opened a stack here.

Cost of 3b:

- **Website-only use costs nothing to install**, but the owner or an agent
  has to link the stack in the browser.
- With the extension: `gh extension install github/gh-stack`. It installs per
  user and would not survive a rebuild unless it is added to the `Dockerfile`.
  It downloads from `release-assets.githubusercontent.com`, with the same
  by-coincidence allowlist status as 3a. The robust fix is to add that name to
  `allowed-domains.txt` and rebuild.
- A deny rule `Bash(gh stack merge*)`, because `gh stack merge` merges and the
  existing `Bash(gh pr merge *)` does not match it.

**Considered and not evaluated as a fourth option:**

- `ghstack`. Its README says its pull requests cannot be merged "using the
  normal GitHub UI" and must be landed with `ghstack land`
  (https://raw.githubusercontent.com/ezyang/ghstack/HEAD/README.md). That takes
  merging out of the owner's hands in the GitHub UI.
- `git-town`. It is branch-per-PR and local-only, and it handles "phantom
  conflicts" after squash merges
  (https://www.git-town.com/stacked-changes). GitHub's docs name it as a local
  tool to pair with `gh stack link`, so it would be an addition to 3b, not an
  alternative to it. Its details were not checked beyond that page and
  https://www.git-town.com/preferences/github-connector.
- `timothyandrew/gh-stack`. Only its repository description was read. GitHub's
  own extension supersedes it for this purpose.

### The costs side by side

|                            | Option 1: process                                     | Option 2: Graphite                                                                                     | Option 3a: `spr`                                                          | Option 3b: native stacks / `gh stack`                     |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Install                    | none                                                  | `npm install -g @withgraphite/graphite-cli@stable` in `Dockerfile`                                     | release tarball in `Dockerfile`                                           | none (website), or `gh extension install github/gh-stack` |
| Allowlist                  | none                                                  | add `api.graphite.com`                                                                                 | `release-assets.githubusercontent.com` (admitted today by IP coincidence) | same as 3a if the extension is used                       |
| Rebuild                    | no                                                    | yes                                                                                                    | yes                                                                       | only if the extension goes in the image                   |
| Third party                | none                                                  | Graphite account, GitHub App with write access to `contents`/`workflows`, PR metadata sent to Graphite | none                                                                      | none (GitHub, public preview)                             |
| New deny rule              | none                                                  | `Bash(gt merge*)`                                                                                      | `Bash(git spr merge*)`                                                    | `Bash(gh stack merge*)` if the extension is used          |
| Post-squash reconciliation | one `--onto` rebase per dependent branch, by an agent | `gt sync` + `gt submit` in each worktree                                                               | `git spr update` after a rebase                                           | server-side, automatic after a GitHub merge               |
| Fits branch-per-ticket     | yes                                                   | yes, with `gt sync` per worktree                                                                       | no (one commit per PR on one branch)                                      | yes                                                       |
| Decision-created seams     | re-check trigger, folded in                           | needs the same trigger                                                                                 | needs the same trigger                                                    | needs the same trigger                                    |
| Citation limits (a), (b)   | remain                                                | remain                                                                                                 | remain                                                                    | remain                                                    |

### Recommendation: Option 1

**Adopt Option 1, process only, with the decision-triggered re-check.**

- It costs one paragraph in `concurrency.md` and no install, firewall change,
  rebuild, third party or deny rule.
- Its one measured hazard, #50, is closed by the draft flag in step 3 and by the
  `CLAUDE.md` rule that already exists.
- The need is rare, going by the instances found for this evaluation. That is
  not a census of every batch. `gh pr list --state all --limit 400` shows one
  pull request ever opened against a feature-branch base (#50). The
  reconciliation merges found are two for `repo-40` (`1b7a923`, `7a12272`) and
  one for `dl-56` (`00faef5`). `pl-39`/`pl-42` cost none.

Why not the others:

- **Option 2** is rejected on the third-party grant and the metadata flow. Its
  automatic restack, the feature that would earn those costs, does not work
  for merges done on GitHub, which is how this repository merges.
- **Option 3a** is rejected because its commit-per-PR model contradicts the
  branch-per-ticket flow, as argued above.
- **Option 3b** is deferred, not rejected. It is the strongest alternative,
  and its server-side reconciliation is the one feature here that would remove
  a cost this repository has actually paid. It is not the recommendation for
  three reasons: it is in public preview, its linear-history rule and
  server-side force-pushes have not been tried against this repository's
  merge-from-`main` habit and its live builder worktrees, and nothing here
  needs it often enough to justify being first. Option 1's
  `gh pr create --base <A>` builds exactly the chain GitHub's native stacks
  recognise ("a **recommendation banner** offering to turn them into a stack",
  from the creating-stacked-pull-requests page above). So adopting Option 1 now
  does not block trying 3b later. Whether to trial the website-only form of 3b
  the next time a chain forms was a separate question, and the owner has
  answered it below.

### Decision

**Settled 2026-09-27 by the owner: Option 1 + a 3b pilot.** The orchestrator
asked "repo-48: which stacked-branch approach does the repo adopt?". The
options as they were put:

- **Option 1 + 3b pilot (recommended).** Process only, with the
  decision-triggered re-check, plus one website-only pilot of GitHub's native
  stacked pull requests the next time a chain forms.
- Option 1 only.
- 3b with the `gh-stack` extension.
- Option 2: Graphite.

Option 3a (`spr`) was not offered: this evaluation and gate 1 both found that
it conflicts with one branch per ticket.

The choice matches this evaluation's recommendation, and the builder's
decisions 1 and 2 as handed up. It overrode no one. It is implemented in
`.claude/skills/orchestrate-tickets/reference/concurrency.md` by three
paragraphs just before the `--onto` paragraph: stack on purpose as a draft,
re-check the seams on a widening decision, and pilot native stacks through the
website once.

The builder's other two open questions have been **disposed of, and neither
is open**:

- **The false-`ambiguous` `candidateFiles` defect.** The owner had it fixed
  now, in a separate pull request filed as repo-73 to repo-76, not on this
  branch.
- **Adding `release-assets.githubusercontent.com` to the allowlist.** It is
  moot under Option 1, and was not taken up.

## Log

**2026-09-19 — filed.** Verified independently before writing this ticket
rather than transcribing the account that prompted it: the `dl-56`/`dl-58`
collision on `tools/downloader/engine/src/index.ts` (`git show`, `git
merge-tree --write-tree`, `gh pr view 267 --json mergeable`), that `dl-58`
(#269) merged and `dl-56` (#267) remains open, and that none of `gt`, `spr`,
`ghstack` or `git-town` is installed in this worktree. Two corrections made to
the prompting account, both recorded above rather than silently dropped: (1)
"the intake seam map predicted this collision before either builder was
dispatched" has no support anywhere in the tree — seam-map output is never
committed, so this cannot be checked at all, and the only committed
confirmation of the collision is post-hoc, from the session that later wrote
the batch's history row; (2) "cost was one merge round on the second branch"
described a cost not yet paid at the moment this was first written — PR #267
was reading `CONFLICTING` at the time. `status: ready` rather than
`needs-decision`, because nothing here poses a question the ticket itself says
must not be settled by whoever picks it up — the evaluation is ordinary
research work, and only the resulting recommendation is the owner's to decide,
which is what `ready` is for per `docs/01-TICKETS.md`'s own distinction
between the two states.

**2026-09-19 — session restart, follow-up round.** Two things resolved
between the two rounds of writing this ticket. First, correction (2) above is
now superseded by events rather than merely corrected: `dl-56`'s builder
pushed the actual reconciliation, `00faef5`
("chore(downloader): merge main into dl-56 (dl-56)"), while this ticket was
being filed — `gh pr view 267` now reads `MERGEABLE`/`UNSTABLE` rather than
`CONFLICTING`/`DIRTY`, and the merge commit's own message names the same
single conflict this ticket independently found. So the "one merge round"
framing in the prompting account turns out to be correct as a prediction, just
not yet true at the instant this ticket first checked it. Second, the
coordinator relayed a further measurement from that same builder — a false
`ambiguous` failure on `dl-45` from running `scripts/citations-gate.mjs`
mid-merge, before staging the resolution — with instructions to reproduce it
cheaply rather than transcribe it. Reproduced in a throwaway clone under
`/tmp` (never touching this worktree or its branch): checked out `dl-56`'s
pre-merge tip, ran `git merge fb15bc9 --no-commit`, confirmed
`git ls-files -- tools/downloader/engine/src/index.ts` prints that path three
times (one per unmerged stage) and that both `citations.mjs` and
`citations-gate.mjs` then report `dl-45` — a ticket touching neither branch —
as `ambiguous`, purely because its own citations name the conflicted path;
`git add` on the conflicted file cleared it immediately. Folded into the Why
and Build sections above as a second, independently-confirmed merge-time cost
next to the citation-coordinate one, rather than left as a bare relay.

**2026-09-19 — third round: the seam-map correction reverses, not just
withdraws.** The coordinator relayed that it had asserted, twice, that the
intake seam map predicted the `dl-56`/`dl-58` collision, and that this was
wrong — the seam-mapper's retained report (held only in the orchestrator's own
session, never committed) flagged `dl-58` against `dl-66` and conditionally
`dl-54`, and named **no** pair for `dl-56`/`dl-58` at all, because the
collision did not exist at intake: `dl-58`'s original Build scoped to `api`
only, and the `engine/src/index.ts` export that collided with `dl-56` was
created by the owner's D1(a) decision on 2026-09-17, relayed to `dl-58`'s
builder mid-batch. Checked against the tree rather than re-transcribed:
`dl-58`'s own committed ticket confirms the original Build never named
`engine`, its D1(a) Log entry describes exactly the reuse-via-export decision,
and `git show fb15bc9 -- tools/downloader/engine/src/index.ts` confirms the
squashed commit's sole touch to that file is the one-line export change the
decision describes — so "the collision was created by a post-dispatch
decision" is now tree-confirmed, not just asserted; "the seam-mapper's matrix
named these specific other pairs" remains the orchestrator's account, marked
as such, since seam-map output is never committed here. Also checked, per the
coordinator's second message, two further `history.md` passages it named as
supporting evidence: the Nineteenth-session row (`history.md@fdafd1a:2672`,
`pl-39`/`pl-42`) is the same shape — an intake-time seam map missing a seam a
mid-batch decision later created — though that instance never became a
conflict (`git merge-tree` clean, citation gate clean on the scratch merge).
The Seventeenth-session row (`history.md@fdafd1a:2511`, item 10, `repo-39`/`repo-35`
on the `GRANDFATHERED` list) is a **different shape** — a citation-into-a-
shared-file seam that existed at intake and was missed because the seam map's
detection is edit-based, not because a decision created it after dispatch —
and is named here only to say it does not belong to this pattern; not folded
in as a third instance. Promoted the decision-creates-seams finding to the
evaluation's required headline (Build step 6, Done-when's first bullet) and
folded the "re-check on decision, not just at intake" refinement into Option 1
rather than adding a fourth option, per the coordinator's instruction to pick
whichever reads truer and say which. Stated plainly, both above and in the new
Build step, that a stacking tool needs the same notice before it can act and
so does not close this gap either.

**2026-09-27: evaluation written (builder, branch
`repo-48-stacked-branch-tool` off `origin/main` at `1a8321c`).** The
`## Evaluation` section above holds it. Nothing was installed, nothing under
`.devcontainer/` was edited and nothing was rebuilt.
`git diff --stat origin/main` touches this file only. The Graphite and GitHub
release binaries were downloaded to the scratch directory and read with
`strings`/`tar`, never run and never installed. `status` stays `ready`: no
`## Review` section has landed, and the recommendation is the owner's to take.

**Where the evaluation lives, and why.** It is appended here, not written as its
own file. The Build offered "its own file under `docs/work/`", but
`scripts/status.mjs` parses **every** `.md` in a `work/` directory as a
ticket, with frontmatter validated and ids de-duplicated (the `readdirSync`
loop feeding `parseFrontmatter` and `validate`). A standalone evaluation file
there would have had to be a ticket.

**What the brief had wrong or stale, measured on 2026-09-27:**

- `dl-56` (#267) is no longer open. `gh pr view 267` reads `MERGED`,
  2026-09-19T01:30:16Z, merge commit `af734fe`.
- The `CLAUDE.md` sentence cited as `CLAUDE.md:188-190` is at `189-191` on
  `1a8321c` (`sed -n 186,191p CLAUDE.md`).
- `release-please-config.json`'s `packages` block names three tools, not two.
  `node -e` over the config prints
  `[ 'tools/downloader', 'tools/planner', 'tools/ledger' ]`.
- The false-`ambiguous` caveat is narrower than the Why says. It hits citations
  that name the conflicted file by a **suffix**, like `dl-45`'s
  `engine/src/index.ts`. A full repo-relative path resolves through
  `tracked.includes(file)` in `makeResolver` before any suffix matching. Measured
  by importing `makeResolver` and feeding it the path three times: the suffix
  form returns `ambiguous — 3 tracked files match`, and the full path returns
  `{"path":"tools/downloader/engine/src/index.ts"}`. The `ls-files` behaviour
  itself was reproduced in a throwaway repository: 3 entries mid-conflict, 1
  after `git add`.
- Option 3's "a `gh` stack extension" now has an official answer the brief
  could not have known about. `github/gh-stack` (v0.1.1, 2026-09-02) and
  GitHub-native stacked pull requests are in public preview. They are evaluated
  as 3b.
- Graphite's documentation has moved from `graphite.dev/docs` to
  `graphite.com/docs`, and the old URL redirects.

**A fold-in I could have made and did not.** The false-`ambiguous` defect has a
one-line fix: de-duplicate `candidateFiles`' output in
`scripts/citations.mjs`, e.g. `[...new Set([...])]`. It was free here, because
the reproduction above already exists. I left it out for three reasons:

- This ticket's Build is records-only.
- `CLAUDE.md` says a one-line fix for a defect still earns a ticket, because
  the reproduction is the deliverable.
- The dispatch limited this branch to this ticket's file.

Whether to file it is handed up as an open decision, not decided here.
Adopting Option 1 (a paragraph in `concurrency.md`) was also left undone,
because that paragraph is the adoption and the choice of option is the owner's.

**2026-09-27: decision recorded, Option 1 implemented, gate 1's three findings
answered.**

The owner chose "Option 1 + 3b pilot". It is recorded under `### Decision`.
The two other questions handed up above are recorded there as **disposed**:

- The `candidateFiles` fix went to a separate pull request, repo-73 to
  repo-76. This is the orchestrator's account. At the time of writing,
  `gh pr list --state all` showed no pull request naming those ids, so the
  tree does not confirm it yet.
- The allowlist entry is moot under Option 1.

Option 1 is now in
`.claude/skills/orchestrate-tickets/reference/concurrency.md`: three
paragraphs placed just before the existing `--onto` paragraph, which they
point to for the reconciliation step. They carry no `file:line` citation. The
three untested points of the pilot are the ones Option 3b named as
unmeasured.

`status` stays `ready`, and that was deliberate. `roles/builder.md` says to
leave it as it is until a `## Review` section lands, and to set it in the
commit that commits the gate record. Gate 1's record lands after the re-gate,
not in this round.

Gate 1's findings, each reproduced before anything changed:

1. **`gh stack link` "only calls the GitHub API" as a quote: fixed, but the
   finding is half refuted.** The phrase is verbatim. It comes from GitHub's
   docs page, not from the README the sentence credited:
   `grep -n 'only calls the GitHub API'` matches
   `use-other-tools-with-stacked-pull-requests` line 9 and nothing in the
   README. The quote was misattributed, not paraphrased. The fix names the
   right source and adds the README's own wording next to it.
2. **"Auto-merge is not supported" has no citation: fixed with a citation,
   not marked unverified.** GitHub's
   `merging-stacked-pull-requests` page says, verbatim, "Auto-merge is not
   supported for stacked pull requests." That page was fetched during the
   evaluation and again for this round, but it was never among the pages the
   evaluation cited. That is why the gate's check of the cited pages found
   nothing.
3. **The stale suffix-form coordinate in the Evaluation: fixed.** Before the
   fix, `node scripts/citations.mjs` on this ticket exited `1`,
   "1 unresolvable" of 16 references, the one FAIL being that coordinate. The
   example now names `dl-45`'s suffix without a line number, and says it is
   only there to show the form and is already stale.
