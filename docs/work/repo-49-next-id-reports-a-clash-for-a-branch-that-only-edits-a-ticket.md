---
id: repo-49
tool: repo
title: next-id.mjs reports a false clash when a branch only edits an already-merged ticket
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: hard
---

# repo-49 — `next-id.mjs` reports a false clash when a branch only edits a ticket

## Why

Found while gating dl-66: running `node scripts/next-id.mjs pl` reported clashes
against several already-merged ids for branches that never proposed a new ticket
under those ids at all — they only appended a Log entry, corrected a premise, or
recorded a gate on a ticket that had already merged under that id. The review
gate on that same branch measured two more mechanisms producing the same
symptom (a clash line with no real second claimant) once this ticket's first
draft was checked line by line — all three are below as shapes 1, 2 and 3, and
the title names the most common one.

`branchSources` (`scripts/next-id.mjs:230`) computes what a branch "claims" from:

`scripts/next-id.mjs:254` `paths.push(...lines(run("git", ["diff", "--name-only", `${rev}...${sha}`], { cwd })));`

`--name-only` reports every path the branch's diff touches, whatever the change
type — `M`odified, `A`dded, `D`eleted, `R`enamed. `idsIn` (`scripts/next-id.mjs:119`)
then matches any path containing `<prefix>-<n>` — deliberately permissive about
the _pattern_, by its own doc comment ("over-reporting a claim costs a reader one
glance"), but that comment is about substring matching within a path, not about
which diff statuses should count in the first place. Nothing filters `M` out, so
a branch that merely **edits** an existing, already-merged ticket file counts as
a second **claimant** of that ticket's id, alongside `merged` itself —
`clashes()` (`scripts/next-id.mjs:167`) flags any id more than one source
reports, and `merged` plus `branch/<name>` are two sources for the same id the
moment the branch touches that file at all.

**Reproduction**, `node scripts/next-id.mjs pl` run against `origin` from this
worktree (`origin/main` at `4463431`, same rev the tool defaults to). Re-run
after the review gate below found this ticket's own first count stale — the
branch list on `origin` moves between sweeps, which is itself the ordinary case
this tool exists to be safe against, not a defect:

```
clash: pl-5 is claimed by branch/pl-17-image-closure, merged
clash: pl-10 is claimed by branch/worktree-pl-19-pin-through-the-browser, merged
clash: pl-17 is claimed by branch/pl-17-image-closure, merged
clash: pl-19 is claimed by branch/worktree-pl-19-pin-through-the-browser, merged
clash: pl-21 is claimed by branch/pl-17-image-closure, merged
clash: pl-40 is claimed by PR#274, branch/pl-50-count-thinking-tokens, merged
clash: pl-42 is claimed by branch/pl-47-edit-dates-and-budget, merged
clash: pl-43 is claimed by branch/pl-47-edit-dates-and-budget, merged
clash: pl-44 is claimed by branch/pl-47-edit-dates-and-budget, merged
clash: pl-46 is claimed by PR#276, branch/pl-46-revise-through-the-browser, merged
clash: pl-47 is claimed by branch/pl-47-edit-dates-and-budget, merged
clash: pl-49 is claimed by PR#274, branch/pl-47-edit-dates-and-budget, branch/pl-50-count-thinking-tokens, merged
clash: pl-50 is claimed by PR#274, branch/pl-50-count-thinking-tokens, merged
clash: pl-52 is claimed by PR#274, branch/pl-50-count-thinking-tokens
```

14 lines this time (11 M-only, one stale-merge-base, two double-sourced — see
below), one more than the first sweep and shaped slightly differently, because
`pl-46` has since merged and `pl-52` is a genuinely new, unmerged, singly-held
ticket. Nothing here depends on the exact count staying still; the three
_shapes_ below do not depend on which ids currently exhibit them.

Checked each branch's own diff rather than assuming the change type from the
clash line alone:

```
git diff --name-status origin/main...origin/pl-50-count-thinking-tokens -- tools/planner/docs/work/
M       tools/planner/docs/work/pl-40-prove-p3-against-a-real-model.md
M       tools/planner/docs/work/pl-49-what-a-run-costs.md
M       tools/planner/docs/work/pl-50-thinking-tokens-are-billed-and-not-counted.md

git diff --name-status origin/main...origin/pl-47-edit-dates-and-budget -- tools/planner/docs/work/
M       tools/planner/docs/work/pl-42-the-revision-contract.md
M       tools/planner/docs/work/pl-43-repack-named-days-and-diff.md
M       tools/planner/docs/work/pl-44-the-replan-run-and-edits.md
M       tools/planner/docs/work/pl-47-edit-the-dates-and-budget.md
M       tools/planner/docs/work/pl-49-what-a-run-costs.md

git diff --name-status origin/main...origin/worktree-pl-19-pin-through-the-browser -- tools/planner/docs/work/
M       tools/planner/docs/work/pl-10-plan-view-and-provenance.md
M       tools/planner/docs/work/pl-19-pin-through-the-browser.md

git diff --name-status origin/main...origin/pl-17-image-closure -- tools/planner/docs/work/
M       tools/planner/docs/work/pl-17-dockerfile-workspace-scan.md
A       tools/planner/docs/work/pl-21-name-the-bare-fields.md
M       tools/planner/docs/work/pl-5-orchestrator-and-fan-out.md
```

**Three distinct false-clash shapes are in the list above, not one.**

**Shape 1 — a branch that only edits an already-merged ticket file (`M`).**
11 of the 14 lines: `pl-5`, `pl-10`, `pl-17`, `pl-19`, `pl-40`, `pl-42`,
`pl-43`, `pl-44`, `pl-47`, `pl-49`, `pl-50`. The branch is not proposing a new
ticket under that id and there is no real ambiguity about who holds it. This is
the shape the candidate fix below (`--diff-filter=A`) actually addresses.

**Shape 2 — a stale merge-base against squash-merged history (`pl-21` on
`pl-17-image-closure`).** This is _not_ a genuine second ticket filed under a
taken id, and `--diff-filter=A` does **not** clear it — it is a different
mechanism entirely. `pl-21-name-the-bare-fields.md` already exists on
`origin/main` today:

```
git ls-tree -r --name-only origin/main -- tools/planner/docs/work | grep pl-21
tools/planner/docs/work/pl-21-name-the-bare-fields.md
```

and `pl-17-image-closure`'s own tip is the commit that filed it, squashed into
`main` as `#50`:

```
git log --oneline -1 origin/pl-17-image-closure
c305c20 docs(planner): close pl-5, and ticket the accessible-name gap pl-12 found (pl-5, pl-21) (#50)
```

The branch's file and `main`'s file are the same ticket, differing only by a
`status` field and a markdown link fixed later
(`git diff origin/main:…pl-21… origin/pl-17-image-closure:…pl-21…`). The three-dot
diff (`origin/main...origin/pl-17-image-closure`) reports it as `A` because its
merge base (`1b41274`) predates the squash that landed the file on `main` under
the same name — the branch's own history still shows the file being created
from nothing, relative to a base that is now behind where it landed. Filtering
by diff _status_ cannot distinguish this from a real new-ticket addition; both
say `A`. This is a stale-merge-base problem, which `--diff-filter=A` cannot
fix and this ticket does not propose a fix for.

**Shape 3 — a pull request and its own head branch double-count the same
ticket (`pl-46`, `pl-52`).** `branchSources` and the pull-request source read
the same commits through two different mechanisms (`gh pr diff` for the PR,
`git diff` against the remote branch ref for the branch), and when a PR's head
branch is itself swept — which it always is, since every open PR has a
pushed branch — the identical, single real claim is reported as two sources:

```
gh pr view 274 --json headRefName,number
{"headRefName":"pl-50-count-thinking-tokens","number":274}
gh pr view 276 --json headRefName,number
{"headRefName":"pl-46-revise-through-the-browser","number":276}
```

`pl-52` is a genuinely new, unmerged, singly-held ticket (`main` has no
`pl-52-*.md`; only `pl-50-count-thinking-tokens` and PR#274, its own PR, hold
it) and still reports as a clash for exactly this reason. The Done-when below
did not originally cover this shape.

**This does not corrupt `next free`.** `nextFree` (`scripts/next-id.mjs:155`)
takes the max id across every row regardless of clash status, and none of the
three shapes above raises that max past what a real claim would. What the
false clash pollutes is the diagnostic line itself — the thing a human or an
agent reads to decide whether an id is really contested — with noise that has
to be manually resolved per clash (a `git diff --name-status` for shape 1, a
`git ls-tree` plus a look at the branch's own last commit for shape 2, a
`gh pr view --json headRefName` for shape 3), exactly as this ticket did,
every time a routine gate or Log edit touches an old ticket file on a
still-open branch, or a branch's PR is itself part of the sweep.

## Candidate fix — untested, not implemented here, and only for shape 1

Filter the diff to added paths only, **with rename detection explicitly off**:
`git diff --no-renames --diff-filter=A --name-only` at `scripts/next-id.mjs:254`
and the two-dot fallback at `:264`. Manually confirmed the _shape_ of the fix
against raw git output (not against a modified script, and not run through
`scripts/test/next-id.test.ts`):

```
git diff --no-renames --diff-filter=A --name-only origin/main...origin/pl-50-count-thinking-tokens -- tools/planner/docs/work/
git diff --no-renames --diff-filter=A --name-only origin/main...origin/pl-47-edit-dates-and-budget -- tools/planner/docs/work/
```

Both produce no output — shape 1's false clashes disappear. This candidate
fixes **shape 1 only**: it does not touch shape 2 (the diff status is
genuinely `A`; the problem is the merge base, not the filter) or shape 3 (the
problem is two sources reading the same commits, not a diff status).

**Why this is a decision and not a mechanical patch:**

- The script's own comment on `idsIn` explicitly prefers over-reporting to
  under-reporting ("under-reporting one is the entire failure this script
  exists to prevent"), for the id-pattern match specifically. Narrowing the
  _diff status_ filtered on is a different axis, but it is still a deliberate
  narrowing of what counts as a claim, and it should be signed off as such
  rather than folded into a fix quietly.
- **`--no-renames` is required, not optional, and this ticket's first
  draft had this backwards.** Rename detection defaults **on** for `git diff`
  (since git 2.9), regardless of `diff.renames` being unset in this repo's
  config — an unset config value means "use git's built-in default," and the
  built-in default for `diff` (as opposed to `status`, where it defaults off)
  is detection on. Measured directly rather than inferred from the config:

  ```
  git --version
  git version 2.43.0
  git diff --name-status 6bedb1b~1 6bedb1b
  … R078   .env.example   tools/downloader/.env.example …
  git diff --name-status --diff-filter=A 6bedb1b~1 6bedb1b
  (does not list the renamed file at all)
  git diff --name-status --no-renames --diff-filter=A 6bedb1b~1 6bedb1b
  … A tools/downloader/.env.example …
  ```

  So `--diff-filter=A` **without** `--no-renames` would _miss_ a renamed
  ticket file today — the exact under-reporting failure this script exists to
  prevent — not merely risk it under some future git version. `--no-renames`
  is therefore part of the candidate fix above, not a follow-up question.

- The same flags would need to apply to both the three-dot diff (`:254`) and
  the two-dot orphan-branch fallback (`:264`) to stay consistent, and the
  fallback's own comment says it deliberately over-reports for a different
  reason (no merge base) — worth checking that narrowing its diff status
  doesn't reintroduce under-reporting for the one case it exists to cover
  safely.
- Shapes 2 and 3 are not addressed by any candidate here. Shape 2 (a stale
  merge base surviving a squash merge) would need either a fresher merge base
  per branch or a content comparison against `main`'s current tree rather than
  a diff status. Shape 3 (a PR and its own head branch) would need
  deduplicating sources by the commit(s) they actually read, not by their
  label, before computing clashes.

Not implemented here, on the coordinator's instruction: this ticket files the
reproduction and the candidate direction for shape 1, names shapes 2 and 3 as
open rather than solved, and leaves the actual change,
`scripts/test/next-id.test.ts` coverage for it, and the sign-off on all three
questions to whoever picks it up next.

## Done when

- The owner or a future builder has answered, for each of the three shapes:
  whether shape 1 is worth `--no-renames --diff-filter=A` (or accepting the
  noise as within the tool's existing documented preference for
  over-reporting), and whether shapes 2 and 3 are worth a fix at all given
  neither has a candidate here.
- If shape 1 is applied: a new `scripts/test/next-id.test.ts` case reproduces
  this ticket's `pl-50-count-thinking-tokens` and `pl-47-edit-dates-and-budget`
  fixtures (a branch that only modifies an existing ticket file must not
  appear as a clash source), watched red against the unfixed script first, and
  a case for a genuinely **renamed** ticket file must still be caught —
  watched red against `--diff-filter=A` _without_ `--no-renames` first, since
  that combination is exactly what this ticket measured missing a rename.
- `npm run check` and the `scripts/test/next-id.test.ts` suite are green.

## Log

- 2026-09-19 — Filed per the coordinator's instruction while gating dl-66,
  which hit this while running `next-id.mjs` for `pl-51`. Reproduced
  independently rather than transcribing the number relayed secondhand: this
  sweep found 12 clash lines, 11 of them `M`-only (false), one genuinely `A`
  (`pl-21`, a different, pre-existing situation). The relayed count from an
  earlier sweep ("7 false clashes") is not reproduced exactly — the branch
  list on `origin` has moved between that sweep and this one — so this ticket
  records what this sweep actually shows rather than forcing agreement with a
  number from a different moment.
- 2026-09-19 — The review gate on dl-66 (whose branch this ticket was filed
  from) measured three things wrong with the draft above and this ticket was
  rewritten before it was ever committed as a standalone fact — all three
  reproduced independently rather than taken on the reviewer's word:
  - **The rename claim was backwards.** The draft said `--diff-filter=A`
    "still catches" a rename via its `D`+`A` pair, reasoning from
    `diff.renames` being unset in this repo's config. Unset means "use git's
    default," and git's default for `diff` (not `status`) has been rename
    detection **on** since git 2.9 — confirmed directly against a real rename
    in this repo's history (`6bedb1b`, `.env.example` → `.env` moved under
    `tools/downloader/`): plain `git diff --name-status` reports `R078`, and
    `--diff-filter=A` alone reports nothing for that file at all. Only
    `--no-renames` recovers it as `A`. Corrected throughout: `--no-renames` is
    now part of the candidate fix, not a follow-up question, and the measured
    commands are in the ticket body rather than asserted.
  - **`pl-21` was not "a genuine `A`, a different situation."** It is a third
    false-clash shape in its own right: `pl-21-name-the-bare-fields.md`
    already exists on `origin/main`, and `pl-17-image-closure`'s own tip
    (`c305c20`) is the commit that filed it there, squashed in as `#50`. The
    three-dot diff reports `A` because the branch's merge base predates that
    squash, not because a second ticket is genuinely contending for the id.
    Confirmed via `git ls-tree` (file present on `main`) and `git diff`
    between the two blobs (near-identical, one field and one link changed).
    Renamed "shape 2" in the rewrite and explicitly marked as something
    `--diff-filter=A` does not fix.
  - **A third shape was missing entirely.** `pl-46` and `pl-52` clash because
    a pull request and its own head branch are swept as two independent
    sources reading the same commits — confirmed with `gh pr view --json
headRefName` for both PRs. Added as shape 3, with its own `Done when`
    coverage question, since neither existing candidate touches it.

  Re-ran `node scripts/next-id.mjs pl` once more before finalizing the
  rewrite: 14 clash lines at this sweep (branch list had moved since the
  first two sweeps — `pl-46` merged, `pl-52` newly appeared), all three shapes
  present. `npm run format` and `npm run status -- --show repo-49` both clean
  after the rewrite.
