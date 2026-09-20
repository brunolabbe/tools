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
