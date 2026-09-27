---
id: repo-78
tool: repo
title: Gate records pin every coordinate to the base they reviewed
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-78 — Gate records pin every coordinate to the base

## Why

Four live citations had to be repointed after gating this batch because the coordinates moved in subsequent merges. Each repair turned the coordinate into a pin at the base:

- repo-60's merged record cited a line in repo-63's ticket; repo-63's landing splice moved that line (#306).
- repo-67's record cited `scripts/preflight.mjs` line 410, which #308 rewrote in place, same number, new text (#304).
- repo-48's evaluation cited `reference/concurrency.md` line 318, which its own later round moved (#307).
- `SKILL.md` cites `CLAUDE.md`'s "## Handing back" heading by line, and #305's edit moved it.

The base is a `main` commit, so it stays reachable. That differs from the branch-only shas that the `reference/records.md` forbids.

## Build

Make the gate page and `reference/records.md` specify that a gate should write every coordinate as `file@<base>:line`, where `<base>` is the SHA of the base branch the gate reviewed against. Update `scripts/review-record.mjs` or the citation checker to accept or enforce that format. Decide whether `SKILL.md`'s own citations into `CLAUDE.md` should name the heading instead of pinning to line numbers.

## Done when

A gate record written under the new rule survives when another open PR edits the cited line; a test proves it works; `npm run check` and the repo suite pass.

## Log

- 2026-09-27 — **Owner decision taken at intake**, recorded here per the
  dispatch: the batch builds repo-78 + repo-79 + repo-81, with repo-81's own
  gap 6 moved into this ticket instead of repo-81's. Nobody's recommendation
  was overridden — option (a) was both the owner's choice and the
  orchestrator's own recommendation.

  Built. `reference/records.md`'s _A gate record never pins to a branch-only
  sha_ generalises: a citation of content that already existed at the base
  pins to the base (or any other `main` commit that holds it) **by default**,
  not only for "a Log passage citing pre-existing code", which is the case
  the page used to single out — a gate's `## Review` section cites exactly as
  much pre-existing content as a Log entry does, and all four incidents in
  this ticket's Why are `## Review`/evaluation citations, not Log ones. A
  citation of content the branch under review itself introduces is unchanged:
  nothing on `main` holds it yet, so it stays unpinned, anchored, and
  re-resolved as the last action before commit. Carried the same distinction
  into `roles/reviewer.md` (the "cite line numbers against the tip" paragraph)
  and `.claude/skills/review-ticket/gate.md` step 4's `.claude/`-only bullet,
  generalised beyond `.claude/` since the failure this ticket's Why names hit
  `docs/work/*.md` and `scripts/preflight.mjs`, neither of them under
  `.claude/`.

  **repo-81 gap 6 — "whose repoint is it when a landing's own splice moves a
  line another ticket's merged record cites" — is answered, not deferred:
  nobody's.** Once the citation names a base pin, it is read at the base
  commit; no later splice on any branch, the cited ticket's own included, can
  move what it reads, so there is nothing to repoint. The question only had
  force under the rule this page gave until today, which left that class of
  citation unpinned. The one repoint that is still somebody's — a fix that
  moves the lines its own branch's freshly-introduced citation names — is
  unchanged and was never gap 6's subject: `roles/builder.md`'s and
  `records.md`'s existing _A fix that lands after the records are committed_.

  **Decided the one open choice the Build left, on a measurement rather than a
  guess: `SKILL.md`'s citation into `CLAUDE.md`'s "## Handing back" stays a
  pinned line number, not a heading-only reference.** Measured before
  deciding: a heading-only citation (page + heading, no line) is not a form
  `citations.mjs` reads at all — `INLINE` requires a `:digit`, so such a
  reference sits entirely outside `extractCitations`, uncounted even as
  `unchecked`, forever invisible to every gate. Building heading-resolution
  (a new citation shape, plus code to check the heading still exists in the
  target file at a given rev) is real new machinery for one link, and the
  pin this ticket generalises already fixes the exact failure this citation
  hit — a line moved by an edit elsewhere in the same file — at zero
  additional cost, since pinning is already fully built (repo-35) and tested.
  So: pinned it, `CLAUDE.md@a0841701f3f764f74ce50f21aa8cd8f849942af4:259 "##
Handing back"`, verified `ok` by `node scripts/citations.mjs
.claude/skills/orchestrate-tickets/SKILL.md --require-anchors`.

  **What the Build's "accept or enforce that format" turned out to mean:**
  "accept" was already true — `citations.mjs` has read `file@<rev>:line`
  pins, including a base sha, since repo-35, unchanged here. "Enforce" — CI
  refusing an unpinned citation of pre-existing content the way
  `--require-claude-pins` already refuses one into `.claude/` — is **not
  built**, and that is a disclosed gap rather than an oversight: it needs
  `citations-gate.mjs`'s corpus-wide sweep (`docs/work/*.md`,
  `tools/*/docs/work/*.md`) to know, per citation, whether its target
  predates the _branch under review_, and that sweep does not carry a
  per-ticket base sha today — only `--against <ref>` for the `GRANDFATHERED`
  ratchet, a different question. `--displaced-since <ref>` already answers
  the narrower "does this unanchored, unpinned citation read differently at
  `ref`" for one record run by hand; wiring it into the CI sweep repo-wide is
  left for a ticket of its own, named in `records.md` rather than filed,
  since severity here is below `med` (a convention gate discipline already
  covers, not a live defect) — per this ticket's floor, disclosed and not
  reopened.

  Fold-in considered: no other small, already-specified piece became free
  doing this work beyond gap 6, which the dispatch assigned outright rather
  than this ticket discovering it free.

  Added `scripts/test/citations.test.ts`'s "a citation pinned to the base
  survives another open PR editing the cited line" at the end of the suite
  (new tests go at the end so they do not shift a merged record's own
  citations into this file). One record, two citations over the same
  two-commit fixture already used by the repo-35 pin tests (the fixture's
  second commit — "the fix, which inserted three lines above the cited
  region" — stands in for the unrelated "other open PR"): the bare, anchored
  citation against the tip reports `MOVED` (red, the rule this ticket
  replaces); the same claim pinned to the first commit reports `ok` (green,
  the rule this ticket sets) — both in one run, which is the red-then-green
  this ticket's own `Done when` asks for, since no code changed and the
  property was already true of `--rev`/pins before this ticket, only the
  authoring convention did.

  Verified: `npx vitest run scripts/test/citations.test.ts` 109/109 (108
  before this branch, +1); `node scripts/citations.mjs
.claude/skills/orchestrate-tickets/reference/records.md
--require-claude-pins` shows the same 1 moved / 6 unresolvable as
  `origin/main`'s copy (the page's own deliberately-broken illustrations,
  unchanged) plus the one new `verified` citation this ticket added, and no
  new `unpinned-volatile`; `node scripts/citations-gate.mjs --against
origin/main` — `127 enforced, 0 failing; 6 grandfathered, holding 1
unresolvable, 19 unanchored. 6 entr(y/ies) compared against origin/main: 0
raised.`, exit 0; `npx vitest run --project repo` 526/526; `npm run check`
  exit 0; `node scripts/preflight.mjs --base origin/main` exit 0, including a
  clean `mergeTree` probe against `#311 repo-81-rate-tickets-and-rule-gaps`,
  the one open sibling PR at the time.
