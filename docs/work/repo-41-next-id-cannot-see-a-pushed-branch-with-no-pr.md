---
id: repo-41
tool: repo
title: the next-id sweep cannot see a pushed branch with no pull request
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-41 — A pushed, PR-less branch is invisible to `next-id.mjs`

## Why

`scripts/next-id.mjs` draws from exactly two sources: merged files via
`git ls-tree <rev> docs/work/` and `ls-tree -r <rev> tools/`
(`scripts/next-id.mjs:200-201`, default `rev` `origin/main` at `:166`), and
open pull requests via `gh pr list --state open`
(`scripts/next-id.mjs:212`). **A branch that is pushed but carries no open pull
request is neither** — it has not merged, and it has no PR — so a real ticket
file already committed there claims an id the tool reports as free.

This is a **ninth** failure mode in the family
[`.claude/skills/orchestrate-tickets/reference/concurrency.md`](../../.claude/skills/orchestrate-tickets/reference/concurrency.md)
already tracks eight of, each measured by removing its guard and watching the
tool go red, each now a test in `scripts/test/next-id.test.ts` (15 tests
there today; none covers this case). Two of the eight already on that page are
commit subjects and PR titles each lying about an id in a different direction;
this is a third direction nobody had measured — a claim that lies in neither
of the two sources the tool reads at all.

**Reproduction — taken on `main` at `a5e31c7`, 2026-09-08, with open PRs 197
and 164, and it expires the moment a pull request opens on
`repo-37-anchor-planner-review-corpus`:**

```
$ node scripts/next-id.mjs repo
merged repo-1
... (repo-2 through repo-31 elided, all "merged")
PR#197 repo-32
merged repo-32
merged repo-33
merged repo-34
merged repo-35
merged repo-36
merged repo-37
PR#197 repo-38
merged repo-38
clash: repo-32 is claimed by PR#197, merged
clash: repo-38 is claimed by PR#197, merged
next free: repo-39
exit 0

$ git ls-tree --name-only origin/repo-37-anchor-planner-review-corpus docs/work/ | grep repo-39
docs/work/repo-39-the-unanchored-half-of-the-review-corpus.md

$ git rev-parse --short origin/repo-37-anchor-planner-review-corpus
fde65a9
```

The tool says `repo-39` is free while `repo-39` is already a committed, pushed
ticket file on `repo-37-anchor-planner-review-corpus` — invisible to
`next-id.mjs` because that branch has no open pull request yet. (If that
branch's PR has opened by the time this is read, the reproduction above no
longer shows the defect directly — the branch would then be visible through
the PR-diff source — which is itself worth knowing: the window this bug lives
in is exactly "pushed, not yet a PR", and it closes the moment a PR opens on
the offending branch, not when the underlying race is fixed.)

**This is filed rather than fixed because the fix is not obvious, and the
existing page already says why.** `concurrency.md` states the race can be
narrowed but not closed: "no command run at time T sees a claim made at T+1",
and a branch is not a claim until it has a commit. A fix here has to decide
**what counts as a claim**, and the three candidate states are not
interchangeable:

1. A merged file on `origin/main` — already covered.
2. A file in an open pull request's diff — already covered.
3. A file on a **pushed remote branch with no open PR** — this ticket, visible
   to `git ls-remote` / a scoped `ls-tree` over every remote branch, at the
   cost of a much larger sweep than the two above (every remote ref, not just
   `main` and open PR diffs).

**A fourth state stays out of reach regardless of what this ticket builds**: a
peer session's **local, unpushed** branch. That is the case the 2026-09-06/07
incident that produced the eight-row table actually was — a peer holding an id
on a branch with a commit that had never left that session's machine — and no
sweep of the remote can see it. Whoever builds this must say explicitly which
of the three states above the fix covers and which it does not, rather than
implying the race is closed by covering state 3.

## Build

1. **Decide the sweep's shape, and record the choice in this ticket's Log
   before writing code.** State 3 is visible to `git ls-remote` or a scoped
   `ls-tree` over remote branches, but "every remote branch" is not free on a
   repo whose ref list is not small, and "only branches matching a naming
   convention" trades completeness for cost in a way that has to be argued for
   rather than assumed. Whatever is chosen, say in the same breath which of
   the three states in the Why section it reaches and which it still does
   not — the 2026-09-06/07 incident's actual failure (a peer's local, unpushed
   branch) is state 4, and no sweep of the remote reaches it. A fix that
   silently implies the race is closed by covering state 3 is worse than one
   that says plainly it still is not.
2. **Add the chosen source to `collect()` in `scripts/next-id.mjs`, beside
   `merged` and `prs`** — a third row in the `sources` array
   (`scripts/next-id.mjs:215`), so a claim from it prints with its own label
   the same way `PR#197` does today, and a clash between it and either
   existing source reports the same way `clash:` already does.
3. **A guard, measured failing before it is written, added to
   `scripts/test/next-id.test.ts`** the way each of the eight rows in
   `concurrency.md`'s table already is — remove it and watch a specific
   scenario go red, not merely "coverage exists". The reproduction in the Why
   section is the scenario to encode, with a fixture remote rather than a real
   one that will have moved by the time CI runs it.

## Done when

- The reproduction in the Why section, or an equivalent fixture built from it,
  no longer reports `next free` on an id a pushed branch already holds.
- The Log states, in one sentence each, which of the four states (merged,
  open-PR, pushed-no-PR, local-unpushed) this fix covers and which it does
  not — and if any remain uncovered, `concurrency.md` is updated to say so
  rather than left implying the race is closed.
- A new row lands in `scripts/test/next-id.test.ts`, verified failing against
  the guard it tests before the guard existed.

## Log

**2026-09-08 — filed jointly, from pl-38's branch.** Found by the orchestrator
while dispatching this batch; identified as a ninth uncovered mode against
`concurrency.md`'s eight-row table by peer session `tools-d4`, which asked the
orchestrator to have it filed — relayed here as the orchestrator's own
measurement, not independently reproduced by this session beyond checking
that PRs 197 and 164 are in fact currently open and that the cited line
numbers in `scripts/next-id.mjs` and the eight-row table in `concurrency.md`
resolve as stated. The reproduction transcript itself was not re-run, on
explicit instruction — running it again risks no longer showing the defect
the moment `repo-37-anchor-planner-review-corpus` opens a pull request, which
would make a fresh run look like a clean bill of health rather than what it
is: the window closing. Not started.

**2026-09-09 — the sweep's shape, decided and recorded before any code was
written, as Build step 1 requires.** Every figure below was taken in this
ticket's own worktree off `origin/main@435ee35`, with `npm run build` already
run:

| measured                                          |                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `git ls-remote --heads origin`                    | 0.286 s, **5 heads**, one network round trip, mutates nothing                                                    |
| the same worktree's local `refs/remotes/origin/*` | **12 refs** — seven of them branches the remote no longer has, because a plain `git fetch origin` does not prune |
| `git diff --name-only <rev>...<sha>` for one head | 0.003 s (11 files for `pl-17-image-closure`, three of them ticket files)                                         |
| `git cat-file -e <sha>^{commit}` for one head     | 0.003 s                                                                                                          |
| `node scripts/next-id.mjs repo` as it stood       | 2.155 s — `gh pr list` 0.714 s, `gh pr diff 203` 1.166 s, `gh pr diff 164` 1.262 s                               |

So the new source costs roughly **0.32 s on a 2.2 s command**, and one more
network round trip on a command that already made three.

**Chosen: `git ls-remote --heads <remote>` for the ref list, and
`git diff --name-only <rev>...<sha>` for each head's own files.** Four grounds,
in the order they decided it:

1. **The ref list comes from the remote, never from `refs/remotes/`.** The
   cheap local source is wrong in both directions at once: measured above, this
   worktree holds twelve remote-tracking refs against the remote's five, and a
   branch a peer pushed since your last fetch is not in that list at all.
   Reproduced in a fixture rather than argued — a second clone published
   `some-unrelated-slug` carrying `docs/work/repo-9-held.md`, and the first
   clone's `git for-each-ref refs/remotes/` still showed one ref while its
   `git ls-remote --heads origin` showed two. Reading the local mirror is
   exactly the "answering confidently from a different tree" the script's own
   comments already refuse to do.
2. **The claim is a file list; the branch name is only a floor.** Branch names
   here do carry ids by convention, and a names-only sweep needs no objects at
   all — but it does not reach this ticket's own reproduction, where
   `docs/work/repo-39-….md` sat on a branch named
   `repo-37-anchor-planner-review-corpus`. `concurrency.md` already says why:
   commit subjects and pull request titles both lie about ids, and a branch
   name is the same kind of claim. The name is read as well, because it costs
   nothing and it catches a branch created before its ticket file was
   committed — but it is not the source.
3. **A diff, not a tree listing — for the same reason `gh pr diff` is a diff.**
   `git ls-tree` over a head returns every ticket file the branch _contains_,
   so `main` itself and both long-lived `release-please--branches--…` heads
   would each re-report the entire merged set and clash with `merged` on every
   id. A three-dot diff against `rev` is the branch's own contribution, which
   makes `main` self-excluding with no special case at all.
4. **`--heads`, so tags and `refs/pull/*` stay out.** The cost is one network
   call whatever the head count, plus ~6 ms of local git per head, so
   completeness over the branch namespace was not worth trading for a naming
   convention.

**Which of the four states this reaches, one sentence each, as the ticket
asks:**

- **State 1, merged on `origin/main`** — covered, unchanged, by `git ls-tree`
  over both ticket roots.
- **State 2, a file in an open pull request's diff** — covered, unchanged, by
  `gh pr diff --name-only`.
- **State 3, a file on a pushed branch with no open pull request** — covered
  **when that branch's commit is in this checkout**, and when it is not the
  branch is still named, its id read from the branch name, and an `unread:`
  line printed telling you to fetch; measured in the fixture above, both
  `git cat-file -e` and `git diff` exit 128 on a sha `ls-remote` can name but
  the object store does not hold, so the alternative was silence.
- **State 4, a peer's local unpushed branch** — **not covered, and no sweep of
  the remote can cover it.** That is the state the 2026-09-06/07 incident
  actually was, and this ticket does not close the race; it removes one of the
  two ways to lose it.

**2026-09-09 — built, on branch `repo-41-next-id-sees-pushed-branches` off
`origin/main@435ee35`.** `git ls-remote --heads origin main` confirmed the base
is on the remote before branching.

**What landed.** `branchSources()` in `scripts/next-id.mjs`, a third row in
`collect()`'s `sources` beside `merged` and `PR#…`, labelled `branch/<name>`;
`render()` gained an optional third argument for lines the sweep could not read,
printed between the clashes and `next free`. Five new cases in
`scripts/test/next-id.test.ts` (15 → 21), of which two drive real git against a
fixture remote built in a `mkdtemp`.

**Each guard watched failing on its own, not merely "the suite is green" — and
that includes the two `concurrency.md` rows that are about a _choice_ rather
than a deletion, which the first pass had reasoned about instead of running:**

| removed or swapped                                        | red                                                                                                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources.push(...branchSources(…))`                       | 4 failed, 17 passed                                                                                                                                                                             |
| the branch name as a claim (`paths = [name]`)             | 3 failed, 18 passed                                                                                                                                                                             |
| the `unread:` note                                        | 3 failed, 18 passed                                                                                                                                                                             |
| `out.push(...notes)` in `render`                          | 1 failed, 20 passed                                                                                                                                                                             |
| the no-merge-base fallback                                | 1 failed, 20 passed                                                                                                                                                                             |
| `ls-remote --heads` → `for-each-ref refs/remotes/origin/` | the fixture-remote case, `expected undefined to deeply equal [ 'some-unrelated-slug' ]` — the local mirror does not have the branch                                                             |
| the three-dot diff → `ls-tree -r <sha>`                   | 3 failed, 18 passed, including `expected [ { source: 'branch/trunk', id: 1 } ] to deeply equal []` — the trunk head re-reporting a merged id, which is the exact noise the diff exists to avoid |

Before any of it was written the five cases were run against the unmodified
script and came back **5 failed, 15 passed**, each for the right reason —
`branchSources is not a function`, `expected undefined to deeply equal [...]`,
`expected [] to have a length of 1`, `expected [Function] to throw`, and the
five-row transcript coming back as three rows.

**Two things the brief did not have, both measured rather than reasoned.**

1. **The reproduction had already expired**, exactly as the ticket predicted it
   would. `repo-37-anchor-planner-review-corpus` has merged and been deleted;
   there was nothing left to re-run, which is why the fixture remote in the spec
   is the deliverable rather than the transcript.
2. **A diff needs a merge base, and one kind of branch has none.** An orphan
   branch — `gh-pages` and its kin — makes `git diff --name-only <rev>...<sha>`
   exit 128 `no merge base`, measured against a fixture, and that would have
   taken the _whole_ sweep down: one orphan branch on the remote and the tool
   answers nothing at all. It falls back to the two-dot diff, which over-claims
   (a file the branch _deletes_ is listed) and says so on its own line. Nothing
   in the ticket anticipated this; it is a hazard the chosen shape brought with
   it and it has its own guard.

**Cost, measured on this branch against the pre-change script extracted from
`origin/main`, same repo, same minute:** 1.825 s / 1.722 s before, 2.136 s /
1.969 s after — a delta of ~0.28 s, which is the `ls-remote` round trip and
matches the 0.286 s taken at decision time. The per-head local work is ~6 ms.

**What the fix costs a reader, stated because it will look like a defect.** A
`repo` sweep here now prints two extra rows and two `clash:` lines, and a `pl`
sweep prints **five clash lines**, all from two branches whose work had already
squash-merged and which nobody deleted. Every line is true. It is not suppressed
because a squash merge leaves a branch unrelated to `main` by ancestry, so no
cheap test tells a stale branch from one genuinely duplicating a merged id — and
`idsIn`'s own docblock already decides that tie: over-reporting costs a glance,
under-reporting is the failure the script exists to prevent. `concurrency.md`
now says so where a reader will hit it.

**`concurrency.md`** gained four rows in its guard table (eight → twelve), a
four-row table naming which of the four states the sweep reaches, an `unread:`
line in the worked output, and the stale-clash note above. Its "union of the
files on `main` and the files in every open PR" sentence and its "cannot see a
peer's unmerged work" heading were both false the moment this merged and are
corrected. `docs/01-TICKETS.md`'s one-paragraph description of the tool was
stale in the same way and is folded in here rather than filed — it is one
sentence, and the change in front of it is what made it wrong.

**The Why section's four `scripts/next-id.mjs` coordinates are left as filed and
are now stale, deliberately.** They resolve correctly against `origin/main`
(checked: `node scripts/citations.mjs … --rev origin/main` prints the four lines
the Why describes), and the prose around them describes the pre-fix file, so
re-pointing them at the new line numbers would attach a correct coordinate to a
sentence that is no longer true. On this branch the same four are `:322` and
`:288` (the merged half and the default rev, both inside `collect`), `:334`
(`gh pr list`) and `:338` (the `sources` array, with the new row pushed at
`:352`); `branchSources` begins at `:215`. The Why's "15 tests there today" is
21 for the same reason.

**Gates**, each read from its own exit code rather than through a pipe:
`npm run format` (588 files), `npm run check` → 0, `npx vitest run
scripts/test/next-id.test.ts --project repo` → 21 passed, `npx vitest run
--project repo` → 294 passed in 6 files, `npm test` → 2372 passed in 136 files.
`node scripts/citations.mjs` on this ticket → exit 0, 4 unanchored and 0 moved.

**What this does not do**, restated at the end so it is not lost in the
decision entry above: it does not close the id race. A peer's local, unpushed
branch is unreachable, a pushed branch you have not fetched is read by name
only, and no command run at time T sees a claim made at T+1.
