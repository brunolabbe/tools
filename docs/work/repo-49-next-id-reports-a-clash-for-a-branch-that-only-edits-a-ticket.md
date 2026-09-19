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
recorded a gate on a ticket that had already merged under that id.

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
worktree (`origin/main` at `4463431`, same rev the tool defaults to):

```
clash: pl-40 is claimed by PR#274, branch/pl-50-count-thinking-tokens, merged
clash: pl-42 is claimed by branch/pl-47-edit-dates-and-budget, merged
clash: pl-43 is claimed by branch/pl-47-edit-dates-and-budget, merged
clash: pl-44 is claimed by branch/pl-47-edit-dates-and-budget, merged
clash: pl-47 is claimed by branch/pl-47-edit-dates-and-budget, merged
clash: pl-49 is claimed by PR#274, branch/pl-47-edit-dates-and-budget, branch/pl-50-count-thinking-tokens, merged
clash: pl-50 is claimed by PR#274, branch/pl-50-count-thinking-tokens, merged
clash: pl-5 is claimed by branch/pl-17-image-closure, merged
clash: pl-10 is claimed by branch/worktree-pl-19-pin-through-the-browser, merged
clash: pl-17 is claimed by branch/pl-17-image-closure, merged
clash: pl-19 is claimed by branch/worktree-pl-19-pin-through-the-browser, merged
clash: pl-21 is claimed by branch/pl-17-image-closure, merged
```

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

**11 of the 12 clash lines above are `M`-only — a false clash, in the sense
that the branch is not proposing a new ticket under that id and there is no
real ambiguity about who holds it.** The twelfth, `pl-21` on
`pl-17-image-closure`, genuinely adds a `pl-21-*.md` file (`A`) — a different
situation (a long-lived, already-merged branch whose surviving remote ref still
carries a since-abandoned draft filed under an id `main` also used for
something else), not the defect this ticket is about, and left alone here.

**This does not corrupt `next free`.** `nextFree` (`scripts/next-id.mjs:155`)
takes the max id across every row regardless of clash status, and an `M` on a
lower, already-merged id never raises that max. What the false clash pollutes
is the diagnostic line itself — the thing a human or an agent reads to decide
whether an id is really contested — with noise that has to be manually
resolved by re-running `git diff --name-status` per clash, exactly as this
ticket did, every time a routine gate or Log edit touches an old ticket file
on a still-open branch.

## Candidate fix — untested, not implemented here

Filter the diff to added paths only: `git diff --name-status --diff-filter=A
--name-only` (or `--diff-filter=A` with `--name-only`, which git accepts
together) at `scripts/next-id.mjs:254` and the two-dot fallback at `:264`.
Manually confirmed the _shape_ of the fix against the raw git output (not
against a modified script, and not run through `scripts/test/next-id.test.ts`):

```
git diff --name-status --diff-filter=A origin/main...origin/pl-50-count-thinking-tokens -- tools/planner/docs/work/
git diff --name-status --diff-filter=A origin/main...origin/pl-47-edit-dates-and-budget -- tools/planner/docs/work/
```

Both produce no output — the false clashes disappear. The same filter against
`pl-17-image-closure` still reports `pl-21-name-the-bare-fields.md`, so the one
genuine `A` case above is unaffected.

**Why this is a decision and not a mechanical patch:**

- The script's own comment on `idsIn` explicitly prefers over-reporting to
  under-reporting ("under-reporting one is the entire failure this script
  exists to prevent"), for the id-pattern match specifically. Narrowing the
  _diff status_ filtered on is a different axis, but it is still a deliberate
  narrowing of what counts as a claim, and it should be signed off as such
  rather than folded into a fix quietly.
- **Rename risk.** A ticket file renamed on a branch (draft name to final
  name, or an id correction) shows as a single `R` status when
  `diff.renames`/`--find-renames` is in effect, and `--diff-filter=A` alone
  does not match `R`. This repo's git config has `diff.renames` unset
  (`git config --get diff.renames` exits 1, i.e. not set — the _default_ is
  detection off for `git diff`, on for `git status`), so today's `git diff`
  reports a rename as a plain `D`+`A` pair, which `--diff-filter=A` still
  catches. That is an ambient default, not something `next-id.mjs` pins with
  `--no-renames`, so the fix's correctness depends on an assumption the script
  does not currently assert anywhere. A reviewer should decide whether to add
  `--no-renames` explicitly alongside `--diff-filter=A` rather than rely on
  the default holding on every future git version and every contributor's
  config.
- The same `--diff-filter=A` would need to apply to both the three-dot diff
  (`:254`) and the two-dot orphan-branch fallback (`:264`) to stay consistent,
  and the fallback's own comment says it deliberately over-reports for a
  different reason (no merge base) — worth checking that narrowing its diff
  status doesn't reintroduce under-reporting for the one case it exists to
  cover safely.

Not implemented here, on the coordinator's instruction: this ticket files the
reproduction and the candidate direction, and leaves the actual change,
`scripts/test/next-id.test.ts` coverage for it, and the sign-off on the
rename question to whoever picks it up next.

## Done when

- The owner or a future builder has answered: apply `--diff-filter=A` (with or
  without `--no-renames`), or accept the noise as within the tool's existing
  documented preference for over-reporting.
- If applied: a new `scripts/test/next-id.test.ts` case reproduces this
  ticket's `pl-50-count-thinking-tokens` and `pl-47-edit-dates-and-budget`
  fixtures (a branch that only modifies an existing ticket file must not
  appear as a clash source), watched red against the unfixed script first: a
  case for a genuinely renamed ticket file must still be caught.
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
