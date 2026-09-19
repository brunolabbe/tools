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

**One thing in the prompt that prompted this filing did not survive that
check, and is corrected here rather than carried forward as fact:** the claim
that "the intake seam map predicted this collision before either builder was
dispatched." Nothing in the tree supports that framing. A seam map's raw
output is never committed anywhere in this repo — recorded as a repeated,
deliberate gap across several sessions in `history.md` ("The seam map is
committed nowhere," said more than once about different batches) — so whether
_this_ batch's seam map flagged this specific pair before dispatch cannot be
checked from the tree at all; it can only be taken on the orchestrating
session's own word, and that session's account is not reachable from here.
What _is_ independently confirmed is only that the collision exists between
the two finished branches, discovered (by the history-recording session) after
both branches already existed. Whoever picks this ticket up should not repeat
the stronger claim without a source for it.

**The cost this batch actually paid is not novel, and a stacking tool would
not close the largest part of it.** `history.md`'s Sixteenth session row
(`repo-40`) measured the same class of problem head-on:
`.claude/skills/orchestrate-tickets/reference/history.md:2304-2307` — "Under
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
     `history.md:2304-2307`'s measured repeat-conflict mechanism above is
     what still has to happen once the base lands.
   - That this option does not eliminate the reconciliation `repo-40`'s record
     measured; it only sequences _when_ it happens (once, after the base
     lands) instead of leaving two branches to collide in whichever order they
     merge.
   - Its real cost: zero installation, zero firewall change, works today. Say
     what it does _not_ solve (the citations-gate line-drift problem above,
     and any conflict a seam map does not see because it was never re-run
     mid-batch).

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

6. **End with a recommendation naming exactly one of the three options**, with
   its cost stated in commands and file changes, not adjectives, and the
   costs of the two rejected options stated with the same rigor so the
   rejection is checkable rather than asserted.

## Done when

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
