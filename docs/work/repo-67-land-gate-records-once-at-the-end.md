---
id: repo-67
tool: repo
title: Land gate records once, at the end, not every round
kind: chore
status: done
milestone: null
depends_on: []
---

# repo-67 — land gate records once, at the end, not every round

## Why

**From the orchestrator's own measurement of the 2026-09-27 batch, not a
primary source this ticket can point at directly** — the owner asked for
this ticket after reading that batch's process review.

Every round in that batch committed its gate's section into the ticket as
soon as it landed, and the next fix round routinely moved or corrected the
very lines those sections cited. The cost was real: reviewer re-resolutions
and coordinate repoints on `pl-48`, `repo-60` and `repo-64`; `dl-53`'s three
separate landing stops; and, on `repo-64` alone, the same shape — a citation
repointed onto the very correction it should have been sent back for —
recurring three times as "finding D" across three gate rounds, each caught
only after the fact. `citations-gate.mjs` refuses these correctly every
time; the cost is landing mid-flight in the first place, not the checker.

## Build

Change the lander's default from "commit each gate's section as it lands"
to "hold every round's section in the PR thread and the scratch directory;
only the final gate re-issues every prior section, re-resolved against the
tip it is reviewing, and the lander commits all of them once, at the end."

- `records.md`: the multi-round paragraph and its remedies for a moved or
  corrected citation change shape — there is no "earlier round's committed
  coordinates" to repoint or send back if nothing was committed until the
  end.
- `dispatching.md`: the routing-findings section, and the re-gate section's
  instructions about returning corrected copies of earlier rounds.
- `roles/reviewer.md`: what a re-gate returns, and what the final gate must
  re-issue.
- `roles/builder.md` and `roles/fixer.md`: the Landing sections, which
  currently assume a mix of already-committed and newly-committed records.
- `scripts/review-record.mjs`: possibly, if the splice-order assumptions
  (per-round `--gate <n>` appends) no longer fit landing every section at
  once.

**Open question this Build must settle or raise, rather than assume:** how
`scripts/test/status.test.ts`'s `reviewedButReady` check and preflight's
`## Review` presence check apply to a ticket with no record at all until the
single landing commit. Both currently reason about a ticket that has been
"picked up" (carries a record) but is not yet `done`; if no record exists
until the end, that intermediate signal disappears. Settle it if the answer
is clear from re-reading those checks' own rules; raise it as an open
decision if it is not.

**Settled by the builder, 2026-09-27, from the checks' own rules — neither
check changes, and the status rule becomes simpler.** Every citation below is
pinned to `1a8321c`, this branch's base on `main`, because `repo-72` is
editing `scripts/status.mjs` and `scripts/test/status.test.ts` in the same
batch.

- `reviewedButReady` fires on one state only, a record on a `ready` ticket:
  `scripts/status.mjs@1a8321c:389` "filter((ticket) => ticket.reviewed && ticket.status".
  With no record before the landing it has nothing to fire on mid-flight, and
  the landing sets the status in its first record commit, so no commit
  carries a record on a `ready` ticket. `in-flight` plus a record stays legal
  for work that lands partial or is parked unlanded:
  `scripts/test/status.test.ts@1a8321c:1123` "a gate record on an in-flight ticket is a report on work in progress".
- Preflight's presence check reads the ticket at `HEAD`,
  `scripts/preflight.mjs@1a8321c:403` "HEAD:${ticket}", and skips anything
  not `done`, `scripts/preflight.mjs@1a8321c:409` "if (status !==". A
  builder leaves the status alone until the landing, and the landing puts
  `done` and the records into the same tip.
- **The "picked up" signal that disappears was only ever on the branch.** The
  board is `npm run status` on `main`, whose ticket files read `ready` until
  something merges: `CLAUDE.md@1a8321c:186` "A ticket file does not know about a branch."
  `reviewedButReady`'s own comment calls it a floor, never proof of pickup:
  `scripts/status.mjs@1a8321c:377` "It is a floor, not a proof.". So the
  mid-flight `in-flight` that `roles/builder.md` prescribed for an early
  record commit is dropped rather than replaced.
- `scripts/review-record.mjs` needs no change. Landing every section at once
  is the sequence its own test already runs — gate 1 without `--gate`,
  committed, then `--gate 2` against the same tree:
  `scripts/test/review-record.test.ts@1a8321c:311` "a gate appended later lands inside the existing".
  Its refusal of a ticket with uncommitted changes is what keeps it one
  commit per gate.

## Done when

- The role pages and `records.md` describe committing gate records once, at
  the landing commit, not per round.
- The `reviewedButReady`/`## Review`-presence question above is either
  settled in this ticket's Build with its reasoning, or raised as an
  explicit open decision.
- `npm run check` and the `repo` project's suite pass, including any test
  changes `review-record.mjs`'s own behaviour needs.

## Review

**Gate: PASS** — 2026-09-27 · `1a8321ce0615059d9b9d338628b78a2d9552249a...8c2667893496ecfe9077afb2c00919884e09eada` · code-review at medium (dispatch named no depth)

| Done when                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The role pages and `records.md` describe committing gate records once, at the landing commit, not per round       | **verified** — `.claude/skills/orchestrate-tickets/reference/records.md`, the bullet "Nothing is committed per round" under its new "A multi-round record lands once, at the end" heading; `.claude/skills/orchestrate-tickets/roles/builder.md`, the bullet "Leave `status` as it is until the landing"; `roles/fixer.md` and `roles/reviewer.md` carry the matching rule (see findings for one place this did not reach) |
| The `reviewedButReady`/`## Review`-presence question is settled with its reasoning, or raised as an open decision | **verified** — settled in the ticket's own Build, the paragraph starting "Settled by the builder, 2026-09-27"; independently re-derived from `scripts/status.mjs:389 "filter((ticket) => ticket.reviewed && ticket.status"`, `scripts/preflight.mjs:815 "exec(content)?.[1]"` and `scripts/preflight.mjs@1a8321c:410 "test(content)) {"`, and reproduced below                                                             |
| `npm run check` and the `repo` project's suite pass                                                               | **verified** — `npm run check` exit 0; `npm test -- --project repo`: `Tests 504 passed (504)`, 10 files, matching the ticket's own Log figure                                                                                                                                                                                                                                                                              |

**Reproduction of the settled question (task-specified).** Built a scratch fixture (`docs/work/repo-90..92`) and ran `node scripts/status.mjs --root <fixture> --json`: a `ready` ticket carrying `## Review` is the only one flagged (`reviewed-but-ready`, exit 1); an `in-flight` ticket carrying `## Review` is not flagged, matching `scripts/test/status.test.ts:1123 "a gate record on an in-flight ticket is a report on work in "`. Called `checkReview` from `scripts/preflight.mjs` directly against a one-commit git fixture with `status: done` and no `## Review`: it correctly returns `FAIL ... is marked done but has no ## Review section`. Under the sequence the pages now describe — status is edited in the same commit as the first gate's splice (`roles/builder.md`'s bullet "Set the status in the first of these commits"), and push happens only after every gate's commit plus a local `preflight.mjs` pass — no commit in the sequence can reach a pushed tip with a record on a `ready` ticket, or `done` with no record; both would require an agent to push before finishing its own Landing steps, which nothing in the sequence does before all record commits exist.

- **low** · `.claude/agents/fixer.md`'s own `description` frontmatter still reads "lands a round whose remaining work is mechanical," unchanged by this branch, while `roles/fixer.md` — the page it points to — now reads (its opening paragraph) "You also land a ticket whose remaining work is mechanical." The two disagree on the unit this branch's whole point is about, in a file the dispatched fixer's own definition carries.
- **dropped** · an apparent sequencing gap where a fixer applying fixes under conditional ship authority would dirty the working tree before splicing records, which could make `review-record.mjs`'s own citations check fail to run — reproduced that it does not: `scripts/review-record.mjs`'s uncommitted-changes guard runs `git diff --quiet HEAD` scoped to the ticket path only (`scripts/review-record.mjs@2ffb72a:367 "git diff --quiet HEAD"`), and its internal citations check reads target files with a plain read against the working tree (`scripts/citations.mjs:895 "readFileSync(path.join(repo, file)"`), so a fix that moved a cited line is caught at the splice itself, before any commit — the pages' "splice records first, commit fixes after" holds regardless of how the agent stages the eventual commits.
- **dropped** · leftover per-round language, swept for: `grep -rniE` across `.claude/skills` and `.claude/agents` for round/landing/commit phrasing (excluding `reference/history.md`) found nothing else stale beyond the low above; `.claude/skills/orchestrate-tickets/reference/worktree-hygiene.md`'s sentence "Retire a reviewer when its record is committed and the [ticket's last round has landed]" is imprecise now that the two conditions become simultaneous under this branch's model, but not incorrect — it does not admit an early retirement it should forbid, so not carried as a finding, only noted; that page is untouched by this branch and outside its named file list.
- **findings** · code-review at medium returned 3; 1 carried, 2 dropped (both explained above).
- NFR: security n/a · performance n/a · reliability ✓ (the sequencing risk above is closed by an existing guard, reproduced) · maintainability — the one `low` above.

## Log

- 2026-09-27 — Filed on the owner's decision, from an `AskUserQuestion` after
  reading the orchestrator's process review of this batch. Not built here.
- 2026-09-27 — Built on `repo-67-land-records-once` from `origin/main` at
  `1a8321c`. Status left `ready`: no gate has run, and under the rule this
  ticket writes the status goes in with the landing's first record commit.
  - **Pages changed.** `records.md` (new bullet _A multi-round record lands
    once, at the end_, replacing the per-round repoint paragraph; the
    post-landing case kept as _A fix that lands after the records are
    committed_), `dispatching.md` (lander section, routing bullet, re-gate
    section), `roles/reviewer.md` (re-gate returns the whole set; file naming;
    dry-run over the whole set), `roles/builder.md` (status rule and Landing
    step 1), `roles/fixer.md` (Landing and status), and, because they carried
    the same per-round wording, `SKILL.md` steps 8 and 9, its decisions
    carve-out and its failure-table row, `review-ticket`'s `SKILL.md` and
    `gate.md`, and `sizing.md`'s conditional-ship clause.
  - **The open question is settled in Build above**, from the two checks'
    own code, every citation pinned to `1a8321c`:
    `node scripts/citations.mjs docs/work/repo-67-land-gate-records-once-at-the-end.md --require-anchors`
    printed `7 verified, 0 moved, 0 unanchored, 0 unresolvable` and
    `exit 0 — nothing to fix`.
  - **`scripts/review-record.mjs` needs no change**, and was not touched (it
    belongs to `repo-63` this batch). Evidence is in Build: the landing
    sequence is the one its existing test already runs.
  - **What the brief had wrong.** (1) It says "only the final gate re-issues
    every prior section"; a gate cannot know its round is the last until the
    orchestrator has routed its findings, so the pages have **every** re-gate
    re-issue the whole set, and only the last set lands. The alternative, a
    gate woken again to re-issue once the orchestrator decides to land, costs
    one wake per ticket; this choice is reported to the orchestrator as a
    decision it can reverse, not settled here. (2) It names no rule for
    conditional ship authority, where the lander applies fixes no gate has
    seen: under "the lander repoints nothing", splicing after those fixes
    meets a `MOVED` with no gate left to send it to. The pages now splice the
    records first, at the final gate's tip, and commit the fixes after. (3)
    It names no rule for a branch parked unlanded. The scratch directory does
    not survive a container rebuild, so `dl-58`'s "committed whatever else is
    held" is kept for that case, as `in-flight`. (4) Its file list missed
    `SKILL.md`, `review-ticket`'s two pages and `sizing.md`, which all
    carried per-round wording.
  - **Fold-in, on the orchestrator's instruction: bare page names in the
    role pages.** `roles/builder.md` named `records.md` bare, and a
    concurrent builder (`repo-72`) resolved it as `roles/records.md`, which
    does not exist. Every `records.md` and `sizing.md` in `roles/builder.md`,
    `roles/common.md`, `roles/fixer.md` and `roles/reviewer.md`, and the bare
    `SKILL.md` in `common.md` and `fixer.md`, now name their repo-relative
    path. Command:
    `grep -n 'records\.md\|sizing\.md' .claude/skills/orchestrate-tickets/roles/*.md`
    prints no bare instance. Left alone: skill-relative names such as
    `roles/builder.md` and `agents/fixer.md`, which resolve from the skill
    or `.claude/` directory and are not the reported defect.
  - **Fold-in: `repo-64`'s two unpinned `.claude/` citations, pinned.** Its
    Log cited line 116 of `roles/builder.md` and line 39 of `roles/fixer.md`,
    unpinned. This branch's edits moved the first; the second was already
    wrong at `1a8321c` and true only at `6988b65`. Running
    `node scripts/citations.mjs docs/work/repo-64-record-the-2026-09-27-batch.md`
    before the pin printed the first as `unanchored` over the line
    `- what the brief had wrong.` and the second over `citation — say so and
point to the evidence`. After pinning, builder.md to `1a8321c` and
    fixer.md to `6988b65`, each with an anchor, both print `ok`, exit 0.
  - **Could have folded in, did not:** `pl-48`'s Log cites lines 63 and 148
    of `records.md` unpinned, already wrong at `1a8321c` (true at
    `6988b65`), and this branch moves them further. Pinning them edits a
    `tools/planner/` path from a `repo` pull request; release-please
    attributes by path, and the repo's `CLAUDE.md` splits such a change into
    its own pull request (`chore` is `hidden`, so nothing would release —
    the split is about attribution). `repo-53`'s line 26 of
    `reference/sizing.md` names another branch and sits above this branch's
    only `sizing.md` edit, so it did not move.
  - **Checks.** `npm run check`, exit 0. `npm test -- --project repo`,
    exit 0, `Tests 504 passed (504)`, 10 of 10 files.
    `node scripts/citations-gate.mjs --against origin/main`, exit 0,
    `118 enforced, 0 failing; 6 grandfathered` and `0 raised`.
    `node scripts/commit-message.mjs --text "chore(repo): land gate records once, at the end, not every round (repo-67)"`,
    exit 0.
  - **Not done.** This batch's own gate records still land per round, as the
    dispatch required; nothing here changes how this ticket's record lands.
- 2026-09-27, after landing: pinned the gate record's `scripts/preflight.mjs:410`
  citation to `@1a8321c` — coordinate only, anchor unchanged — because
  repo-73..76 rewrites that line in place; owner's decision.
- 2026-09-27 — repo-79's builder repointed the one remaining unpinned citation
  this record's `## Review` section carries, `scripts/preflight.mjs:408
"exec(content)?.[1]"` → `:605` — coordinate only, anchor text unchanged —
  because repo-79's own additions to `scripts/preflight.mjs` moved it. `node
scripts/citations-gate.mjs --against origin/main` exit 0: 127 enforced, 0
  failing.
- 2026-09-28 — repo-79's gate 1 round moved the same citation again, to
  `:703`; repointed once more, coordinate only. `node
scripts/citations-gate.mjs --against origin/main` exit 0: 127 enforced, 0
  failing.
- 2026-09-28 — repo-79's gate 2 fixer round moved the same citation again, to
  `:774` — coordinate only, anchor text unchanged. Per the orchestrator's
  standing rule (repo-29; repo-78's gate 1, F1), the branch whose change
  moves a merged citation repoints it rather than stopping.
- 2026-09-28 — repo-82 moved both of this record's remaining `## Review`
  citations again, coordinate only, anchor text unchanged:
  `scripts/preflight.mjs` from 774 (`exec(content)?.[1]`) to 787, and
  `scripts/citations.mjs` from 868 (`readFileSync(path.join(repo, file)`) to
  895 — the latter from the new `splitLines` helper added after the imports.
  `node scripts/citations-gate.mjs --against origin/main` named both `moved`
  at exactly these new lines before the repoint.
- 2026-09-28 — repo-82's gate 1 fixer round, fixing the gate's low on
  uncaught `npm` abbreviations, moved this record's `scripts/preflight.mjs`
  citation again, from 787 to 807 — coordinate only, anchor text unchanged.
  `node scripts/citations-gate.mjs --against origin/main` named it `moved` at
  exactly this new line before the repoint.
- 2026-09-28 — the same fixer round, splitting the docblock the gate's other
  low also named (misplaced above `NPM_ALIASES`, describing `COVERED`) into
  one paragraph beside each, moved this record's `scripts/preflight.mjs`
  citation again, from 807 to 815 — coordinate only, anchor text unchanged.
  `node scripts/citations-gate.mjs --against origin/main` named it `moved` at
  exactly this new line before the repoint.
