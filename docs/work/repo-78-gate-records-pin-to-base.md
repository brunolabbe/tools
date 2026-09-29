---
id: repo-78
tool: repo
title: Gate records pin every coordinate to the base they reviewed
kind: chore
status: done
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

## Review

**Gate: FAIL** — 2026-09-27 · `a084170...4889139` (base `a0841701f3f7`, head `488913972dca`; `origin/main` had not moved after the fetch) · code-review at medium

Re-issued at `d25b272` with words, rows and verdicts unchanged: the two coordinates into lines this branch introduced (the new test) are re-resolved against that tip, not `4889139`; every other coordinate is a base pin and unchanged; no coordinate named text this round deleted or corrected, but the page wording quoted in F1, F2 and F5 to F8 is the wording at `4889139`, which this round changed (gate 2 below).

Citations of content that predates this branch are pinned to the base `a084170`; lines this branch introduced are cited against the tip `4889139`, and branch-introduced text in `.claude/` pages is named by page and heading, the only form CI accepts for it (F2). Gated under `main`'s `roles/reviewer.md` and `review-ticket/gate.md`; the branch's copies would have changed one thing here, the pins on pre-existing targets outside `.claude/`, which `main` leaves unpinned and does not forbid. repo-81's gap 6 is in scope by owner decision at intake and is gated here (F1).

| Done when                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A gate record written under the new rule survives when another open PR edits the cited line | For a base-pinned citation: `scripts/test/citations.test.ts:2945 "a citation pinned to the base survives another open PR"`, asserting `:2963 "ok         src/tls.ts@${before}"` ✓ — green with every non-test change reverted to the base (F4). For the citations of branch-introduced content, which the rule keeps unpinned because nothing on `main` holds them, **unproven** and measured not to hold (F1, F2) — the branch narrowed this line to pre-existing content in its Log without surfacing that as a decision |
| a test proves it works                                                                      | The same test ✓ — it proves repo-35's pin capability, already asserted at the base by `scripts/test/citations.test.ts@a084170:2211 "Correct then:"` and `:2214 "Unpinned, against the tip:"` on the same fixture                                                                                                                                                                                                                                                                                                           |
| `npm run check` and the repo suite pass                                                     | **verified** — `npm run check` exit 0; `npx vitest run --project repo` 526/526 at the head, 525/525 at the base; the test diff is 47 insertions, 0 deletions                                                                                                                                                                                                                                                                                                                                                               |

- **med** · **F1 — gap 6 is answered "nobody's", and that is false for two populations that exist.** `records.md`'s _A gate record never pins to a branch-only sha_, in its gap-6 bullet, says no splice can move a base-pinned citation, so nothing needs repointing. But every merged record written before this rule is unpinned, and this branch's own rule keeps every citation of branch-introduced content unpinned for good — after the squash, a line on `main` that any later branch can move. Measured at the head: one comment line inserted into `scripts/test/citations.test.ts` above the tests repo-60 and repo-63 added and their merged records cite, then `node scripts/citations-gate.mjs --against origin/main` exit 1, `127 enforced, 2 failing` — repo-60 `6 moved`, repo-63 `5 moved`. The bullet above it sends that repair to "the ordinary one two bullets down — repoint it", but two bullets down is the deleted-text-to-prose bullet, and the only repointer the pages name is the owning branch's builder (`.claude/skills/orchestrate-tickets/reference/records.md@a084170:125 "A fix that lands after the records are committed does not edit a"`), gone once that branch merged. **Open decision, whose repoint:** (a) _recommended_ — the branch whose change moves it, since its CI is the one that goes red and names the record: coordinate only, pinned to that branch's own base where the content now exists, named in its Log; (b) the orchestrator, after the merge that moved it; (c) keep "nobody's" and accept the red build. Either way the survival row cannot hold for branch-introduced content as written, so the same decision also rescopes it: (i) _recommended_, with (a) above — the `Done when` covers pre-existing content and introduced content is repointable by a named owner; (ii) gates stop citing introduced content by coordinate at all, naming tests by title instead. The survival row and gap 6's own acceptance (a true sentence in its page) depend on it: a round.

- **med** · **F2 — the rule for branch-introduced content, in all three pages, produces a record CI refuses whenever that content is under `.claude/`.** `roles/reviewer.md`'s paragraph beginning "Pin a citation of content that already existed at the base", the closing sentence of `gate.md` step 4's pin bullet and `records.md`'s second new bullet each say to cite it "unpinned, against the tip". `citations-gate.mjs` checks `.claude/` pins unconditionally (`scripts/citations.mjs@a084170:1429 "CLAUDE_PAGE.test(r.resolved)"`). Measured: a one-bullet section citing this branch's own new gap-6 line in `records.md` by bare coordinate, spliced by `node scripts/review-record.mjs` exit 0 ("nothing to fix"), then `node scripts/citations-gate.mjs --against origin/main` exit 1, `1 unpinned-volatile`. Neither the lander's tool nor the dry-run command in `main`'s `roles/reviewer.md` passes `--require-claude-pins`, so nothing before CI sees it, and `repo-` tickets edit `.claude/` pages routinely — this one does. **Open decision:** (a) _recommended_ — say in all three pages that introduced content under `.claude/` is named by page and heading, and add `--require-claude-pins` to the dry-run command so a gate sees what CI sees; (b) teach `citations-gate.mjs` to exempt a record's own branch-introduced `.claude/` lines, which needs a per-record base sha it does not have. It bears on the survival row: a round.

- **med** · **F3 — nothing mechanical enforces the new rule, and the enforcement is left as prose.** Before the branch `citations.mjs` already accepted `file@<base sha>:line` (repo-35); after it, nothing refuses an unpinned citation of pre-existing content outside `.claude/`. Measured with a record written under the old rule — two anchored, unpinned citations of pre-existing `scripts/` lines — spliced by `review-record.mjs` exit 0; `citations.mjs --section Review --require-anchors --require-distinct-anchors --require-claude-pins` exit 0; `citations-gate.mjs --against origin/main` exit 0, `128 enforced, 0 failing`; `preflight.mjs --base origin/main` citation step `ok` (its exit 1 came from `status.test` refusing the probe's `ready` ticket carrying a record, not from a citation). `records.md`'s new _Since repo-78_ paragraph says the enforcement "is left for a ticket of its own", and none is filed; the Log calls it below `med`, which is this gate's floor for asking a round, not a threshold for filing (root `CLAUDE.md`, _Decisions_). **Open decision:** (a) _recommended_ — file a `repo-` ticket for enforcement and replace the sentence with its id; (b) delete the sentence and keep the disclosure; (c) the owner accepts a convention-only rule, recorded as such. No `Done when` depends on it: disclosed, no round.

- **low** · **F4** — the `Done when` test cannot fail on anything this branch changed. With every non-test file reverted to the base (the four pages, the ticket, and `scripts/citations.mjs`, whose blob is identical at both shas), `npx vitest run scripts/test/citations.test.ts` stays 109/109, exit 0. It restates the base's pinned-versus-unpinned pair on the same fixture (second row). The Log says so; carried because the survival it proves is bought by prose that no check enforces (F3).

- **low** · **F5** — the _Since repo-78_ paragraph in `records.md` says `--displaced-since` answers its question "for one ticket's own record, run by hand" and that wiring it into the sweep of `citations-gate.mjs` is future work. It is already wired, `scripts/citations-gate.mjs@a084170:88 "threaded through to every record this gate reaches"`: `node scripts/citations-gate.mjs --displaced-since a0841701` read 214 records in one run. Only CI omits it (`.github/workflows/ci.yml@a084170:190 "node scripts/citations-gate.mjs --against"`), and it checks only citations with no anchor and no pin, which a `## Review` section already refuses — so it is not the enforcement F3 needs.

- **low** · **F6** — `records.md`'s first new bullet says each of its four incidents was "broken by a commit its own branch never touched"; its third says repo-48's citation was "moved by its own later round" (repo-48's record pins `concurrency.md` at `1a8321c`, and that page was last changed by repo-48's own #307). The new test's docblock repeats the framing.

- **low** · **F7** — `records.md` adds a bare, unanchored preflight coordinate to its incident list, in the paragraph arguing for pins: `citations.mjs` over `records.md` goes from 5 unanchored and 1 unchecked at the base to 6 and 2 at the head. The line it names now reads `scripts/preflight.mjs@a084170:410 "if (hasGateRecord(content))"`, the in-place rewrite the bullet describes. The Log's `records.md` comparison names only moved, unresolvable and the new verified citation.

- **low** · **F8** — the three pages disagree at the edges. `roles/reviewer.md` pins only to "the base sha your dispatch names", `records.md` to "the base — or any other `main` commit". `gate.md` keeps a page-and-heading form for `.claude/` that `citations.mjs` does not read at all: a heading-only reference in a probe record was not counted (1 of 2 references), since `scripts/citations.mjs@a084170:278 "const INLINE = new RegExp("` requires a line number. And `gate.md` says `citations-gate.mjs` enforces `.claude/` pins "for every merged record", where it reads only each record's `## Review` section.

- **low** · **F9** — the proposed title, "pin every coordinate to the base", overstates a branch that deliberately leaves introduced content unpinned. `docs` is right for the paths: `node scripts/preflight.mjs --base origin/main --title` with that title exit 0, `"docs" is hidden`, no path under `tools/`.

- **dropped** · a gate that pins to the base but copies the tip's line number, in a file the branch edited above the cited line, gets `MOVED` — measured on `records.md`, tip 319 against base 268 — but the checker's reason names the base line ("it is at 268"), so the dry-run repairs it in one step. Not worth a sentence in the pages.
- **findings** · code-review at medium, run in-context: 10 returned, 9 carried, 1 dropped.
- **Moved lines** · `node scripts/citations-gate.mjs --against origin/main` at the head: exit 0, `127 enforced, 0 failing; 6 grandfathered`. Over every tracked `.md` at the base outside the four edited pages, 42 citations resolve into them — 35 pinned, 7 unpinned, all 7 into `records.md` above its first changed line — and 0 changed state from base to head. The branch's one new pin, `CLAUDE.md@a084170:259 "## Handing back"`, resolves `ok`, and `a084170` is on `origin/main`.
- NFR: security n/a · performance n/a · reliability — F1, F2 · maintainability — F3 to F8.

### Gate 2

**Gate: PASS** — 2026-09-28 · `4889139..d25b272`, this round's diff only (6 files); base `a0841701f3f7` unchanged, `origin/main` still there after the fetch · re-gate, code-review at medium over the touched lines

F1 to F3 are judged against the owner's answers of 2026-09-27, each option (a), relayed by the orchestrator and not read by this gate. Pre-existing content is pinned to `a084170`; lines this branch introduced are cited against `d25b272`, and introduced text under `.claude/` is named by page and heading. Re-sweep of what gate 1 settled: not done.

| Done when                                                                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A gate record written under the new rule survives when another open PR edits the cited line — rescoped by the owner (F1) to content that predates the branch | `scripts/test/citations.test.ts:2945 "a citation pinned to the base survives another open PR"`, asserting `:2963 "ok         src/tls.ts@${before}"` ✓. The rescope is recorded in the Log and in `records.md`, under _A gate record never pins to a branch-only sha_; the brief's own line is unchanged, as a builder's should be |
| a test proves it works                                                                                                                                       | The same test ✓, now disclosed in its own docblock as repo-35's capability rather than new code, `scripts/test/citations.test.ts:2934 "This is repo-35's own pin capability"` (F4)                                                                                                                                                |
| `npm run check` and the repo suite pass                                                                                                                      | **verified** — `npx vitest run --project repo` 526/526, exit 0; `npm run check` `ok` inside `preflight.mjs`, exit 0; this round removed no `expect` line from the test file                                                                                                                                                       |

- **F1** · fixed, per decision (a). `records.md`'s gap-6 bullet, under _A gate record never pins to a branch-only sha_, now names both exposed populations, states today's rule (the branch whose change moves the line repoints it, because its CI goes red) and links repo-47 without deciding it. repo-47 is open, `docs/work/repo-47-the-citations-gate-fails-a-code-pr-on-merged-records.md@a084170:6 "status: needs-decision"`, and its Why describes the same fix in use. The reproduction the bullet quotes, `2 records newly moved`, matches gate 1's measurement.
- **F2** · fixed, per decision (a). All three pages name introduced `.claude/` content by page and heading and disclose that the checker never reads that form. The dry-run in `roles/reviewer.md` (_Returning the gate_) now carries `--require-claude-pins`. Measured at `d25b272`: a one-bullet probe citing this branch's new gap-6 line in `records.md` by bare coordinate, run through that exact command, exit 64, `1 unpinned-volatile`. The orchestrator relays repo-81's 19 `unpinned-volatile` as the same failure live; this gate did not reproduce that one. Residual: G2-d.
- **F3** · fixed, per decision (a). repo-80's Build now carries the refusal, `docs/work/repo-80-land-records-one-command.md:24 "refuses a section carrying an unpinned citation"`, and `records.md`'s _Migration: nothing already committed is rewritten_ points there instead of at an unfiled ticket. Residual: G2-b.
- **F4** · accepted as disclosed, per the dispatch. The docblock says the test cannot fail on anything repo-78 changed, and that is true: this round changed 35 docblock lines and no assertion.
- **F5** · partly fixed. The false claim that `--displaced-since` is a one-record tool is gone, and the 214-record figure matches this gate's run. Its replacement overstates in the other direction: G2-a.
- **F6** · fixed. `records.md` and the test docblock now say three incidents came from another branch and repo-48's came from its own later round.
- **F7** · fixed. The preflight coordinate now carries an anchor and verifies `ok`. `citations.mjs` over `records.md` reports 5 unanchored, the same as the base, and 2 unchecked against the base's 1; the extra one is the prose `line 318` in the repo-48 incident, which fails nothing. Residual: G2-c.
- **F8** · fixed. `roles/reviewer.md` now pins to "the base — or to any other `main` commit", matching `records.md`. `gate.md` now says CI enforces `.claude/` pins on each record's `## Review` section. The heading-form limit is stated in all three pages.
- **F9** · fixed. The Log names the title `docs(repo): pin gate-record citations of pre-existing content to the base (repo-78)`, and `preflight.mjs --base origin/main --title` with it exits 0, `"docs" is hidden`, with `mergeTree` clean against 3 open heads.

- **low** · **G2-a** — the rewritten F5 paragraph in `records.md` (_Migration: nothing already committed is rewritten_) says an enforced record "has nothing left for `--displaced-since` to find". That holds for a `## Review` section only. The flag widens the read to every section, and a Log needs no anchor. Measured: one line inserted at the top of `records.md`, then `node scripts/citations-gate.mjs --displaced-since HEAD` exit 1, `208 enforced, 2 failing`. pl-48, an enforced record, reported `3 displaced`, all in its Log. The paragraph's conclusion still stands, since the flag is not F3's enforcement; say "section" where it says "record".
- **low** · **G2-b** — repo-80's new Build line says landing "already knows the base". But the interface its line above specifies takes no base, and the preflight it must run refuses to start without one, `scripts/preflight.mjs@a084170:764 "if (!base) throw fail"`. And no line under its `## Done when`, `docs/work/repo-80-land-records-one-command.md@2ffb72a:28 "One invocation lands a two-gate ticket"`, asks for the refusal, so repo-80 can pass its gate without building F3's enforcement. Recommended: add `--base` to the interface and one clause to that Done when.
- **low** · **G2-c** — the anchor fix for F7 leaves the preflight coordinate in `records.md`'s incident list unpinned. It points at pre-existing content, on the page that now says such a citation pins to the base, and CI sweeps no `records.md` citation, so the next edit above line 410 moves it silently. Pin it to `a084170`.
- **low** · **G2-d** — the orchestrator's own copy of the dry-run, the text a gate prompt carries, still omits the flag F2 added: `.claude/skills/orchestrate-tickets/reference/dispatching.md@a084170:436 "A reviewer that did this unprompted handed over a"`. So does the splice `review-record.mjs` runs for the lander, repo-80's territory. A gate told the command by its prompt still misses what CI refuses.
- **findings** · re-gate over the touched lines: 4 returned, 4 carried, 0 dropped; F1 to F9: 7 fixed, 1 partly fixed (F5, remainder G2-a), 1 accepted as disclosed (F4).
- NFR: security n/a · performance n/a · reliability — G2-b · maintainability — G2-a, G2-c, G2-d.

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

2026-09-27 — Gate 1's record (FAIL, 3 med + 6 low, F1–F9 above) landed via
`review-record.mjs`. The tool's own disclosure note against the section file
was empty — verbatim survived the formatter.

2026-09-28 — Gate 2's record (PASS, G2-a to G2-d above) landed via
`review-record.mjs --gate 2`. The tool's own disclosure note against the
section file was empty — verbatim survived the formatter.

2026-09-28 — Applied gate 2's four low findings after the record: G2-a,
`records.md` now says an enforced **section** (not "record") has nothing
left for `--displaced-since` to find, since the claim only holds under
`## Review` and not a Log; G2-b, repo-80's Build gives `--land` a `--base
<ref>` and its Done when now asks for the refusal to be built; G2-c, the
preflight coordinate in `records.md`'s incident list is pinned to `a084170`;
G2-d, the dry-run command in `dispatching.md` now carries
`--require-claude-pins`, matching what CI and `--land`'s own splice check
(repo-80) already require. Landed after gate 2, unreviewed, under this
ticket's severity floor.
