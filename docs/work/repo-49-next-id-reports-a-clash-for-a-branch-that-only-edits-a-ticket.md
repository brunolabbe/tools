---
id: repo-49
tool: repo
title: next-id.mjs reports a false clash when a branch only edits an already-merged ticket
kind: fix
status: ready
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

## Decision — answered 2026-09-28 by the owner: fix shapes 1 and 3

**Shape 1**: take the candidate above, `--no-renames --diff-filter=A` on both
`git diff` calls. **Shape 3**: count a pull request and its own head branch as
one source. **Shape 2 is not fixed.** It stays as documented over-reporting in
the script's doc comment, since it needs a content comparison against `main`
and it is rare.

**The two fixes are one change, not two**, and neither half works alone.
Found while re-reading `a084170` for the owner. The candidate above
filters only the `git diff` calls. A pull request's paths come from
`scripts/next-id.mjs:345` `paths: lines(run("gh", ["pr", "diff", pr, "--name-only"], { cwd })),`,
and `gh pr diff --name-only` has no status filter. So an open PR that only
edits a merged ticket would still report it as a claim through its `PR#<n>`
source after shape 1's filter had cleared its `branch/<name>` source. The
direction, untested: for a PR whose `headRefName` is also swept as a branch,
keep only the branch source, which can take the filter. Keep the `PR#<n>`
label on it so the reader still sees the PR number. A PR with no swept branch
keeps its `gh pr diff` source, unfiltered, and over-reports as it does today.

## Done when

- A new `scripts/test/next-id.test.ts` case reproduces
  this ticket's `pl-50-count-thinking-tokens` and `pl-47-edit-dates-and-budget`
  fixtures (a branch that only modifies an existing ticket file must not
  appear as a clash source), watched red against the unfixed script first, and
  a case for a genuinely **renamed** ticket file must still be caught —
  watched red against `--diff-filter=A` _without_ `--no-renames` first, since
  that combination is exactly what this ticket measured missing a rename.
- A case where an open PR and its head branch both edit an existing ticket
  file produces no clash, and a case where they add a new one produces
  exactly one source for it, not two. Both are watched red against the
  unfixed script first.
- The `idsIn` / `branchSources` doc comments name shape 2 as known
  over-reporting.
- `npm run check` and the `scripts/test/next-id.test.ts` suite are green.

## Review

### Gate 1

**Gate: FAIL** — 2026-09-30 · `origin/main...HEAD`, base `e79b04f`, head `0d9ddb8` · code-review at medium, run by hand (no finder subagent)

`origin/main` was still `e79b04f` at my fetch and again before the live sweep, so nothing moved under the range. Re-issued with gate 2 at `612fb5c`: coordinates into `scripts/` and the tests are re-resolved against that tip, and content that predates the branch stays pinned to `e79b04f`. The citations whose text round 2 replaced or whose claim it corrected (the first row's two test citations, and F1, F2 and F4) are prose naming `0d9ddb8`, the sha this section gated, because that sha is branch-only and cannot be a pin. The anchor of the last row's second citation, which round 2's orphan-copy case now duplicates, is replaced by a range anchor on the comment above the same assertion. Rows, counts and verdicts are gate 1's words, measured at `0d9ddb8`. The FAIL rests on the first row and the first bullet alone: the brief asks for something its own Decision cannot deliver. Every other finding is low.

| Done when                                                                                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new `next-id.test.ts` case reproduces the `pl-50` and `pl-47` fixtures (a branch that only modifies a ticket file must not appear as a clash source), watched red against the unfixed script first | Fixtures reproduced and the diff contributes no path: the shape-1 case at `0d9ddb8` asserted `?.paths).toEqual([name])` ✓. Red against the unfixed script (verified, head tests on the base script): 4 of 25 fail, this case with `expected [ 'pl-50-count-thinking-tokens', …(3) ] to deeply equal [ 'pl-50-count-thinking-tokens' ]` ✓. **"Must not appear as a clash source" is unproven, and the test asserts the opposite:** at `0d9ddb8` the same case expects both branches to remain clash sources, for `pl-47` and `pl-50`, through their names (F1).                   |
| a genuinely renamed ticket file must still be caught, watched red against `--diff-filter=A` without `--no-renames` first                                                                             | `scripts/test/next-id.test.ts:849 "id: 12 }])"` ✓. Red with `--no-renames` dropped from `ADDED` (verified): 1 of 25 fails, this case alone, `expected [] to deeply equal [ { …(2) } ]` ✓.                                                                                                                                                                                                                                                                                                                                                                                        |
| An open PR and its head branch both editing a ticket produce no clash, and both adding one produce exactly one source for it, both watched red against the unfixed script first                      | `scripts/test/next-id.test.ts:874 "expect(clashes(result)).toEqual([])"` (edit) and `scripts/test/next-id.test.ts:873 "PR#274 repo-52"` (add: one `PR#274` row for `repo-52`, and no `PR#276` row) ✓. Red against the unfixed script (verified): `expected [ 'PR#276 repo-5', …(4) ] to deeply equal [ 'merged repo-5', 'PR#274 repo-52' ]` ✓. Fold disabled (verified): 2 of 25 fail, this case and the unread and fork case. The two halves are one test, watched red together.                                                                                                |
| The `idsIn` / `branchSources` doc comments name shape 2 as known over-reporting                                                                                                                      | **verified** by reading: `scripts/next-id.mjs:235 "What it over-reports, knowingly"` is in the `branchSources` docblock; the `idsIn` docblock was unchanged at `0d9ddb8` (F5).                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check` and the `next-id.test.ts` suite are green                                                                                                                                            | **verified**: `npm run check` exit 0; `npx vitest run scripts/test/next-id.test.ts` 25 of 25 at the head against 21 of 21 at the base; `npm test -- --project repo` 624 of 624; `packages/core/test/spawn-safety.test.ts` 5 of 5. Not run: the full `npm test`, CI.                                                                                                                                                                                                                                                                                                              |
| (step 4) no existing test changed meaning                                                                                                                                                            | **verified**: the base test file run against the head script passes 20 of 21, and the one red is the orphan case. Its base assertion claimed `repo-1`, a file the orphan deletes (`scripts/test/next-id.test.ts@e79b04fb68e936fae777becbeef44b20f10f600e:723 "every file that differs, so a file the orphan"`); it is now `scripts/test/next-id.test.ts:722-726 "Until repo-49 the two-dot diff"`. That is what the Decision asks (both `diff` calls filtered), and nothing is under-reported: a file only `rev` holds is `merged` claim, and a file both hold is already taken. |

- **high** · **F1, open decision** · The brief's premise is wrong for part of shape 1: **4 of the 11 lines it counts as `M`-only are name claims** (`pl-17`, `pl-19`, `pl-47`, `pl-50`, each a branch named for the id it edits). `branchSources` reads a branch name as a claim floor before any diff, so the filter cannot clear them, and the new test asserts they stay (at `0d9ddb8` the shape-1 case expects the two clashes). Live at `e79b04f`, `node scripts/next-id.mjs pl` goes from 5 clash lines to 3 and `repo` stays at 1. **All 4 remaining lines are false positives, 0 of 4 a real hazard**, and each id's ticket file is already on `origin/main`: `pl-17`, `pl-19` and `repo-49` by branch name (3 of 4), `pl-21` by shape 2 (1 of 4). Options: **A** accept the name floor as the documented residue and have a human amend or waive the first row's parenthetical; **B** a follow-up that lets a branch name stop claiming an id whose merged file the branch only modifies, which clears 3 of the 4 and leaves `pl-21`; **C** delete the two stale remote branches, which clears `pl-17`, `pl-19` and `pl-21`. Recommend A with C; B narrows what counts as a claim for one line per live branch. Not settled here.
- **low** · F2 · `nfr:reliability` — the orphan fallback's `--no-renames` is unproven: dropping it at that call alone (the fallback call in `scripts/next-id.mjs` at `0d9ddb8`) leaves 25 of 25 green, and a probe shows the claim lost, an orphan branch holding a near-copy of a merged ticket under a new id reports `[]` instead of that id. One case would close it.
- **low** · F3 · `nfr:maintainability` — the concurrency page is only partly brought in line: its four-state table still reads `gh pr diff --name-only` for a pull request (`.claude/skills/orchestrate-tickets/reference/concurrency.md@e79b04fb68e936fae777becbeef44b20f10f600e:268 "a file in an open pull request"`) and a plain three-dot diff for a branch (`.claude/skills/orchestrate-tickets/reference/concurrency.md@e79b04fb68e936fae777becbeef44b20f10f600e:269 "plus a three-dot diff per head"`); and the page's paragraph headed _Expect some `branch/…` rows to clash with `merged` still_ keeps "usually means that branch should be deleted", which is false for the live build branch `repo-49-next-id-edit-only`, the fourth of the four remaining lines. Two sentences, one mechanism.
- **low** · F4 · `nfr:reliability` — a second open pull request on the same head branch is not folded: the first renames the branch source to its own label, so the second finds no `branch/<head>` and keeps its unfiltered `gh pr diff` (at `0d9ddb8` the lookup matched only the unrenamed label). Probe: two PRs on one head that edits a merged ticket make `clashes()` return `[{ id: 5, sources: [PR#277, merged] }]`. The over-reporting direction, and the page lists only an unfetched head and a fork as the cases that keep `gh pr diff`.
- **low** · F5 · The `idsIn` docblock is unchanged and only `branchSources` names shape 2; the Decision says "the script's doc comment", the Done when says both, so I graded the row verified and disclose the reading.
- **low** · F6 · No committed test covers a branch that edits one ticket and adds another (the `pl-17-image-closure` shape), or a ticket deleted on a three-dot diff. Probed, both correct: a branch that edits `repo-5`, adds `repo-52`, deletes `repo-6` and renumbers `repo-7` to `repo-70` claims exactly `52` and `70`. `--diff-filter=AD` in place of `A` is caught by two existing tests (2 of 25 red), so the deletion half is covered indirectly.
- **dropped** · `gh pr list` returns 30 at most by default. The base has no `--limit` either, so it is outside this range, and 2 are open.
- **dropped** · `@tsv` might render the boolean `isCrossRepository` oddly. The live `gh pr list --json number,headRefName,isCrossRepository --jq` query printed `false` between tabs.
- **dropped** · a stacked pull request's base is another branch, and the branch diff is against `rev`. That over-reports, the safe direction.
- **findings** · code-review at medium, by hand, returned 9; 6 carried (F1 to F6, F3 being two sentences of one mechanism), 3 dropped.
- NFR: security ✓ (argument arrays, `spawn-safety.test.ts` 5 of 5) · performance n/a (same three commands, folded in memory) · reliability — F2, F4 · maintainability — F3, F5, F6.

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

- 2026-09-28 — **Answered by the owner: shapes 1 and 3, shape 2 left as
  documented noise.** Moved to `ready`. Re-read against `a084170`: both
  `--name-only` diffs are still at `:254` and `:264`. Found one gap in the
  candidate, written up under Decision: the PR source's `gh pr diff` can't
  take the filter, which is why shape 3's dedupe has to land with it.

- 2026-09-30 — **Built shapes 1 and 3 on `e79b04f`.** The premise held there:
  both diffs were still a bare `git diff --name-only`. Both now take `ADDED`
  (`--no-renames --diff-filter=A --name-only`). In `collect`, a pull request
  whose head branch is swept and was read is folded into that branch's source
  under the `PR#<n>` label. `gh pr list` now asks for
  `number,headRefName,isCrossRepository`. Shape 2 is named in `branchSources`'
  docblock. The concurrency page's clash paragraph and its guard table are
  updated to match.

  Each new case was watched red with
  `npx vitest run scripts/test/next-id.test.ts`:
  - Against the unfixed script: 4 failed of 25. The failures were the orphan
    case, the `pl-50`/`pl-47` case (`expected [ 'pl-50-count-thinking-tokens',
…(3) ] to deeply equal [ 'pl-50-count-thinking-tokens' ]`), the PR-and-branch
    case (`expected [ 'PR#276 repo-5', …(4) ]`) and the unread/fork case. The
    rename case passes against the unfixed script, as it should: a bare
    `--name-only` lists a rename's new path.
  - Against `--diff-filter=A` without `--no-renames`: the rename case fails,
    `expected [] to deeply equal [ { …(2) } ]`.
  - With the filter in and the fold disabled: 2 failed of 25, the PR-and-branch
    case and the unread/fork case. That confirms the Decision's point that
    neither half works alone.
  - With `!branch.unread` removed: 1 failed of 25,
    `expected [ 'peer-just-opened' ] to deeply equal [ 'peer-just-opened', …(1) ]`.
  - With the fork check removed: 1 failed of 25,
    `expected [ 'PR#310', 'PR#311', 'merged' ]`.
  - Fixed: 25 of 25.

  Live, `node scripts/next-id.mjs pl` against origin at `e79b04f`:

  ```
  before: clash pl-5, pl-10, pl-17, pl-19, pl-21   (5 lines)
  after:  clash pl-17, pl-19, pl-21                (3 lines)
  ```

  `pl-5` and `pl-10` were `M` only. `pl-21` is shape 2. `pl-17` and `pl-19`
  are the next item.

  **What the brief had wrong or left out:**
  - **Shape 1 is two mechanisms, and the filter fixes one.** A branch's _name_
    is a claim floor (`branchSources`' docblock). So a branch named after the
    ticket it edits still clashes with `merged` on that id, with no diff
    involved. That is the ordinary case: every builder branch is named
    `<id>-slug`. It covers 4 of the 11 lines this ticket counted as `M`-only:
    `pl-17`, `pl-19`, `pl-47` and `pl-50`. That is why the `pl-50`/`pl-47`
    case asserts that the diff contributes no path, and leaves exactly two
    clashes, `pl-47` and `pl-50`, both from the names. Narrowing the name floor
    narrows what counts as a claim, and this ticket says that needs sign-off.
    It is not built here; it went to the orchestrator as an open decision.
  - **"Keep only the branch source" loses files when the branch is unread.**
    `ls-remote` names a sha this checkout has not fetched, so only the name was
    read. In that case the PR's `gh pr diff` is kept beside the name, still
    unfiltered, and the unread note is dropped, because the files were read
    after all. A fork's PR has a `headRefName` that names a branch in the fork,
    so only a same-repository head is matched.
  - **The orphan fallback's existing case changed.** It asserted that `repo-1`,
    a file the orphan _deletes_, was claimed. Filtered to additions, as the
    Decision asks for both calls, it is no longer claimed. Nothing is lost by
    that: a file only `rev` holds is `merged`'s claim. The fallback now
    over-reports only files the orphan holds that `rev` lacks, and its note
    says so.

  No spawn call changed. The source's only spawn is still `runCommand`'s
  `spawnSync`, and the new tests go through the existing `runGit` and
  `runCommand`. No fold-in was available: the only other open ticket that
  names this script is `pl-52`, and it names it in passing.

- 2026-09-30 — **Round 2, on gate 1's findings at `0d9ddb8`.** The owner
  decided F1 on 2026-09-30, choosing the builder's option over the gate's: a
  branch name that names only merged ids claims nothing. `collect` now drops
  such a name from the branch's paths before folding, and the `pl-50`/`pl-47`
  case now expects no clash. That meets Done-when line 1 as written. Each
  finding was reproduced before it was fixed; every run below is
  `npx vitest run scripts/test/next-id.test.ts`.
  - **F1, fixed.** Against the round-1 script, the flipped case fails with
    `expected [ 'pl-50-count-thinking-tokens' ] to deeply equal []`. A new
    last case pins why dropping the name is safe: a branch named for a merged
    id that adds a _second_ ticket file under that id still clashes, and a
    name naming an unmerged id still claims it. Against the round-1 script it
    fails with `expected [ { id: 30, … }, …(1) ] to deeply equal
[ { id: 31, … } ]`. Removing the guard that a name must carry some id
    fails the unread/fork case (1 of 29). Case 9's `repo-37` name row is
    replaced by a comment on the same line, so its anchored `:277` does not
    move.
  - **F2, fixed.** A new case: an orphan branch holding a merged ticket's
    body under `repo-77`. With `--no-renames` dropped from the fallback call
    alone it fails, `expected [] to deeply equal [ { …(2) } ]`, which
    reproduces the gate's probe.
  - **F3, fixed.** `concurrency.md`'s four-state table now says how a PR is
    read, through its head branch or else `gh pr diff`, and that a branch's
    diff counts added files only. The clash paragraph is rewritten for the
    new behaviour. A `branch/…`/`merged` clash is now either a second ticket
    under a taken id, which needs renumbering, or a stale squash-merged
    branch, which should be deleted once its work is on `main`. The guard
    table gained the name rule and the label-lookup rule, and the rename row
    now names both diffs.
  - **F4, fixed.** Reproduced as the gate stated it: two PRs on one head gave
    `[{ id: 5, sources: [PR#277, merged] }]`. The head branch is now looked
    up in a map keyed by head name, built before any relabelling. A second
    PR joins the label as `PR#276+PR#277`, so both numbers stay visible. An
    unread head keeps `unread` after its first PR's diff is merged in, so a
    second PR on that head adds its own diff too.
  - **F5, fixed.** The `idsIn` docblock now says which paths reach it and
    names shape 2 as kept over-reporting.
  - **F6, fixed.** A new case: one branch that edits `repo-5`, adds `repo-52`,
    deletes `repo-6` and renumbers `repo-7` to `repo-70` claims exactly `52`
    and `70`. With `--diff-filter=AD` it fails: `expected [ …(4) ] to deeply
equal [ …(2) ]`.
  - **Live, against origin with `main` at `e79b04f`.** The owner's deletion
    of `pl-17-image-closure` and `worktree-pl-19-pin-through-the-browser` is
    confirmed by `git ls-remote --heads origin`, which lists neither.
    `node scripts/next-id.mjs pl` prints no clash line and no non-merged row
    (`next free: pl-54`). `node scripts/next-id.mjs repo` prints no clash
    line (`next free: repo-85`). The round-1 script, run against the same
    remote, prints four `repo` clashes, all names of live build branches:
    `repo-46`, `repo-47`, `repo-49` and `repo-66`.
