---
id: repo-50
tool: repo
title: citations.mjs cannot see an unanchored citation whose cited line changed since a base
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-50 — `citations.mjs` cannot see an unanchored citation whose cited line changed since a base

## Why

An unanchored citation — a path and a line number with no quoted fragment —
resolves as long as the file has that many lines. When an edit above that line
pushes the text down, the citation still resolves, `citations.mjs` reports it `unanchored` as it
always did, and `citations-gate.mjs` exits 0, because the gate reads `## Review`
sections only and an unanchored citation is never `moved`. So a branch that
inserts ten lines into a page silently redirects every unanchored citation into
that page, in every record's Log, Why and Build, and nothing in the repo reports
it.

Measured on 2026-09-20, on the branch that swept sessions 12 to 23's skill
defects into the rule pages (`orchestrate-skill-sweep`). Its first gate found 11
anchored citations correct at the base and broken at the tip, all outside
`## Review`; its second found four unanchored ones in `repo-38`'s Log displaced by
the previous commit's own repair; its third found one more in `dl-57`'s Log, in
`tools/downloader/docs/work/`, because the sweep's pathspec had ended at the
directory and matched nothing. Three rounds, three scope misses, all found by a
hand-rolled base-versus-tip script that lives in a session scratchpad and nowhere
else. The final sweep pinned 24 unanchored citations across six records to the
base sha.

The check is mechanical and the checker already has both halves: it resolves
citations, and it accepts `--rev`. What it lacks is a mode that resolves each
unanchored, unpinned citation at two trees and reports the ones whose cited lines
differ.

## Build

Add `--displaced-since <ref>` to `scripts/citations.mjs`. For every unanchored,
unpinned citation in the record, read the cited line or range at `<ref>` and at
the tree the run resolves against; report each one whose text differs as
`displaced`, printing both versions' first differing line, and set a new exit bit
for it. Citations that are anchored, pinned, or inside an evidence declaration
are out of scope: the first two already fail or hold on their own, and the third
is a deliberately broken state.

Give `citations-gate.mjs` the same flag, passed through to every record in both
ticket roots — `docs/work/*.md` and `tools/*/docs/work/*.md`, with the `*.md`,
since a pathspec ending at the directory matches nothing — so one command answers
"what did this branch displace" for the whole corpus. Whether CI runs it is a
later decision; this ticket builds the instrument.

Prove the harness can fail before trusting a clean run: plant an insertion above
a cited unanchored line in a scratch copy and watch the mode report it.

## Done when

- `node scripts/citations.mjs <record> --displaced-since origin/main` reports
  every unanchored, unpinned citation whose cited text differs between the two
  trees, and nothing else, with a test that goes red when the comparison is
  removed.
- `node scripts/citations-gate.mjs --displaced-since origin/main` walks both
  ticket roots and a test asserts the `tools/*/docs/work/*.md` half is read.
- The positive control above is in the test suite, not only in the Log.
- Run against `orchestrate-skill-sweep`'s tip before its pins landed, the mode
  reports the 24 citations that branch pinned by hand, or the Log says which it
  misses and why. Those tips (`ac98b37`, `5c517d3`, `44196c1`) are branch-only
  commits, unreachable from a fresh clone once the branch squash-merges and is
  deleted; `git fetch origin refs/pull/281/head` brings them back, since all
  three are ancestors of pull request #281's head.

## Log

- 2026-09-20 — Filed from the third gate on `orchestrate-skill-sweep`, on the
  reviewer's recommendation. Not built on that branch: it is scoped to the skill
  pages, and this is a change to a script with tests.

- 2026-09-26 — Built. `--displaced-since <ref>` added to `scripts/citations.mjs`
  (`checkDisplacement`, called only for a citation that is `unanchored` and
  carries no pin, using the same `trees()` machinery `--rev` already reads pins
  through) and threaded through `scripts/citations-gate.mjs` (`checkRecord` and
  `gate` both take it; the CLI's `--displaced-since` is validated against the
  repository up front, the same way an invalid `--against` was already refused).
  `EXIT.displaced = 128`, unconditionally fatal — no `--require-*` flag guards
  it, since the state cannot appear unless the caller already asked for it.

  Positive control, base vs. head, both runs recorded: at `a1a417b` (this
  branch's base) `node scripts/citations.mjs` does not accept the flag at all —
  `unknown option --displaced-since`. Reproduced the defect itself on a scratch
  fixture instead, per the ticket's Why: a two-commit repo where the second
  commit inserts three lines above a cited, unanchored `src/tls.ts:2-3` —
  `node scripts/citations.mjs drift.md` (no flag, either revision) reports
  `unanchored`, exit 0, on both — the coordinates still resolve, so nothing
  noticed the insertion. At head, the same fixture with
  `--displaced-since <the pre-insertion sha>` reports `DISPLACED
src/tls.ts:2-3`, `exit 128 — 1 displaced`, naming the line and both versions'
  text. The equivalent gate-level reproduction, a record under
  `tools/planner/docs/work/` (not `docs/work/`, to hit the second half of
  `SCOPE.records`): `checkRecord`/`gate`/the CLI all report the same citation
  `unanchored` without the flag and `displaced` (`FAIL … 1 displaced`) with it.
  Both fixtures are in the test suite, not only here — see `Done when` below —
  and a mutation check confirmed each one goes red: with `checkDisplacement`'s
  call site replaced by a bare `null`, `npx vitest run
scripts/test/citations.test.ts` failed 2 of 99 and `npx vitest run
scripts/test/citations-gate.test.ts` failed 3 of 40, all five the tests this
  ticket added; restored, both files are green again (99/99, 40/40).

  Fold-in considered and declined: repo-47 ("the citations gate fails a code PR
  on merged records") is `needs-decision` and adjacent, not folded in — its
  question is whether the gate should run at all against a PR that only touches
  code, which this ticket's `displaced` state does not bear on either way: it
  is a new _state_ the existing gate invocation can produce, not a change to
  when the gate runs or what triggers it. If repo-47 lands changing which PRs
  the gate runs against, `displaced` participates in that the same way `moved`
  and `unanchored` already do, with no code of its own to change.

  **Collision with the ticket's own edit, found by `preflight.mjs`'s citations
  check and not by anything in the Build section:** this branch's own diff to
  `scripts/citations.mjs` and its test inserted text above lines that
  `docs/work/repo-52-....md`'s `## Review` section cites with anchors — the
  exact class of drift this ticket detects, this time on an _anchored_ citation
  (which was already `moved`, not `unanchored`, so `--displaced-since` would not
  have caught it even if run; `moved` is `citations.mjs`'s pre-existing,
  anchor-based mechanism for exactly this case). `node scripts/citations.mjs
docs/work/repo-52-....md --section Review --require-anchors
--require-distinct-anchors` reported `0 verified, 7 moved` before repointing
  and `7 verified, 0 moved — exit 0` after; the six distinct `file:line` tokens
  (`scripts/test/citations.test.ts` at 2354, 2370, 2323, 2413 and
  `scripts/citations.mjs` at 1209 twice, 1170) were repointed to the lines the
  tool named, wording and verdicts unchanged — see that ticket's own Log entry,
  dated today, for the command and full before/after.

  **The historical check** (`Done when` 4): `git fetch origin
refs/pull/281/head` brought `ac98b37`, `5c517d3` and `44196c1` back reachable
  — confirmed ancestors of `FETCH_HEAD` by `git merge-base --is-ancestor`, all
  three. Checked in a throwaway `git worktree add --detach <tmp> <sha>` (removed
  after, `git worktree list` confirms it is gone), with this branch's
  `citations.mjs`/`citations-gate.mjs` copied in over each historical
  checkout — reading the historical _record_ content and the historical
  _source_ content, through the new code, which is what the flag is for.

  `44196c1`'s own diff pins 21 citations across five records (`docs/work/repo-21
-the-orchestration-skill-outgrew-its-loop.md`, `repo-32-done-can-hide-an-
outstanding-obligation.md`, `repo-35-a-citation-cannot-be-pinned-to-a-
commit.md`, `repo-38-two-documents-disagree-on-who-writes-the-review.md`,
  `repo-48-should-this-repo-adopt-a-stacked-branch-tool.md` — `git show
44196c1 -- <path> | grep -c '^+.*@fdafd1a'` gives 5, 1, 2, 7, 6). `b07d506`
  pins one more, in `tools/downloader/docs/work/dl-57-....md`, into
  `records.md` — the sixth record, 22 pins total. **Not 24**: the ticket's own
  figure does not match either commit's diff, and this area's commit messages
  are already self-admittedly wrong once in the same range ("Gate 2's low on
  the previous commit message: it said seven knock-on pins and the diff
  carried nine" — `44196c1`'s own message). Read as debt in the ticket's
  premise rather than in the tool: 22 is what the diffs show, not 24.

  Running `node scripts/citations.mjs <record> --displaced-since fdafd1a` at
  `5c517d3` (before `44196c1`) for the first five records, and at `44196c1`
  (before `b07d506`) for `dl-57`, filtered to citations resolving into a
  `.claude/` page — the class the sweep pinned — reports **29**, not 22:
  5, 1, 4, 12, 6, 1 per record in the order above. Spot-checked on `repo-38`
  (12 found, 7 pinned) and `repo-35` (4 found, 2 pinned): every pinned
  coordinate is among the ones reported, and the extra ones are shorthand
  citations (`` `:93` ``, `` `:153-154` ``, `` `:282` `` inheriting an already-
  displaced file) that the sweep's own tool — `git grep -nE
'\.claude/[^@ ]*\.md:[0-9]'`, a literal pattern — cannot read, exactly the
  caveat `repo-52`'s own gate 2 recorded against that same grep ("cannot see
  the shorthand spelling — three unpinned shorthand `.claude` coordinates
  survive in repo-21"). So the mode reports a superset of what the branch
  pinned by hand, not a subset: every citation the humans caught, plus seven
  more of the same class they structurally could not. `repo-35` also carries
  22 further `displaced` results into `scripts/citations.mjs` itself at this
  same base, unrelated to the sweep's `.claude`-page edits and outside this
  ticket's scope — `repo-52`'s own Review section already names that set as an
  open decision ("pin the 30, or soften the claim and leave them to repo-50's
  detector"), unresolved there and not resolved here either.

  Gates: `npm run format` (2 files reformatted, both mine); `npm run check`
  exit 0; `npx vitest run --project repo` 481/481 (up from 472); `node
scripts/preflight.mjs --base origin/main` exit 0 after the repo-52 repoint
  (citations gate: `citation gate clean over 113 record(s), 7 grandfathered —
checked against origin/main`).
