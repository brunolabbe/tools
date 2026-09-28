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

- 2026-09-27 — **Round 1: gate 1 (Opus) FAIL at `488913972dca21fcbb781332a9e391e4c3a4b0d2`, 3 med + 6 low.**
  Every finding reproduced before fixing; none refuted.

  **Owner decisions, taken via `AskUserQuestion`, all three the orchestrator's
  own recommendation, none overridden:**

  1. **F1 (whose repoint).** Question: how should the page describe who
     repoints a merged citation another branch moves. Options put: (a) state
     today's rule and link repo-47, without deciding or pre-empting it;
     (b) decide repo-47 now, in this branch; (c) the orchestrator repoints
     after each merge. **Chosen: (a).** `records.md`'s gap-6 bullet now says
     the branch whose change moves the line repoints it, coordinate only,
     because that branch's own CI is the one that goes red — the rule in
     force since repo-29 — and names repo-47
     (`docs/work/repo-47-the-citations-gate-fails-a-code-pr-on-merged-records.md`,
     `status: needs-decision`) as the open question of whether that
     allocation should change, undecided here. The `Done when` survival claim
     is rescoped, by this decision and not by me: it covers a citation of
     content that predates the branch (base-pinned, immune to this by
     construction); a citation of content the branch introduces survives only
     by being repointed by the owner today's rule names, which is a weaker
     claim than "survives", and the ticket accepts that as the honest scope.
     Reproduced the gap the finding names: one comment line inserted above
     the tests repo-60 and repo-63's own merged records cite in
     `scripts/test/citations.test.ts`, reverted after — `node
scripts/citations-gate.mjs --against origin/main` exit 1, `127 enforced,
2 failing` (repo-60 and repo-63 both newly `moved`; reverted, back to
     `127 enforced, 0 failing`).
  2. **F2 (`.claude/` content the branch introduces).** Question: how to keep
     a gate from writing a record CI then refuses. Options: (a) name it by
     page and heading, plus add `--require-claude-pins` to the reviewer's
     documented dry run; (b) teach `citations-gate.mjs` a per-record
     exemption for a branch's own new `.claude/` lines. **Chosen: (a).** All
     three pages now say branch-introduced content under `.claude/` is named
     by page and heading, never an unpinned line, and
     `roles/reviewer.md`'s dry-run command carries `--require-claude-pins`.
     Stated plainly, in all three pages, that a heading-form reference is not
     read by the checker at all — `citations.mjs`'s `INLINE` grammar requires
     a line number — so it is a disclosed limit on what this page can verify,
     not a claim that anything checks the heading. Reproduced: a one-bullet
     scratch record citing this branch's own new gap-6 line in `records.md`
     by bare coordinate, `node scripts/citations.mjs <file>
--require-claude-pins` — `1 unpinned-volatile`, exit 64.
  3. **F3 (enforcement).** Question: where the "left for a ticket of its own"
     sentence in `records.md` should point. Options: (a) repo-80's `--land`,
     since landing is the one place that already knows the base; (b) file a
     new ticket; (c) convention only, recorded as such. **Chosen: (a).**
     Added to `docs/work/repo-80-land-records-one-command.md`'s Build section
     — `--land` refuses a section with an unpinned citation of content that
     predates the branch — status and everything else in that ticket
     untouched. `records.md`'s sentence now names repo-80 instead of
     "a ticket of its own". Reproduced the gate's own measurement: a record
     with two anchored, unpinned citations of pre-existing `scripts/` lines
     passes `citations.mjs --section Review --require-anchors
--require-distinct-anchors --require-claude-pins` at exit 0 — nothing
     mechanical refuses the old convention today.

  **F4** — the test proves repo-35's own pin capability, not new code; said
  so in the test's docblock and here, rather than building enforcement to
  make it fail (that is repo-80 now, per F3).

  **F5** — fixed a false claim: `--displaced-since` is already threaded
  through `citations-gate.mjs`'s whole corpus sweep, not a one-record tool
  run by hand — reproduced, `node scripts/citations-gate.mjs
--displaced-since a0841701` enforces 208 records in one run. What is true
  is narrower and was the actual point: it only reports a citation that is
  both unanchored _and_ unpinned, and every citation `citations-gate.mjs`
  enforces already carries an anchor, so it has nothing left to find there
  regardless of whether CI passes the flag. Rewrote the paragraph to say
  that, and to point at repo-80 rather than "a ticket of its own" (F3).

  **F6** — fixed: the four-incidents paragraph called every one "broken by a
  commit its own branch never touched", which is false of the third
  (repo-48), a citation broken by its own record's later round. Reworded to
  say three are a different branch entirely and the fourth is the record's
  own later round.

  **F7** — fixed: the `scripts/preflight.mjs:410` citation in the four-
  incidents list had no anchor; gave it one, `"if (hasGateRecord(content))"`,
  verified `ok` by `node scripts/citations.mjs
.claude/skills/orchestrate-tickets/reference/records.md
--require-claude-pins`.

  **F8** — fixed the two disagreements named: `roles/reviewer.md` now pins to
  "the base — or to any other `main` commit that holds it", matching
  `records.md`, instead of only "the base sha your dispatch names"; and
  `gate.md`'s claim that `citations-gate.mjs` enforces `.claude/` pins "for
  every merged record" now says "for every merged record's `## Review`
  section", the part it actually reads. The heading-form-is-unread edge is
  now stated plainly in all three pages, per F2's disposition above, rather
  than left implicit.

  **F9** — the title this branch will use is not "pin every coordinate to
  the base" (the ticket's own title, which the gate is right overstates a
  branch that deliberately leaves introduced content unpinned): `docs(repo):
pin gate-record citations of pre-existing content to the base (repo-78)`,
  checked with `node scripts/commit-message.mjs --text "<that title>"`,
  exit 0.

  Verified after the round: `npx vitest run scripts/test/citations.test.ts`
  109/109; `npm run check` exit 0; `npx vitest run --project repo` 526/526;
  `node scripts/citations-gate.mjs --against origin/main` exit 0, `127
enforced, 0 failing; 6 grandfathered, holding 1 unresolvable, 19
unanchored. 6 entr(y/ies) compared against origin/main: 0 raised.`; `node
scripts/preflight.mjs --base origin/main --title "docs(repo): pin
gate-record citations of pre-existing content to the base (repo-78)"`.
