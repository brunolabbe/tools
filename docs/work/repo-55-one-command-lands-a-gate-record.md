---
id: repo-55
tool: repo
title: One command splices a returned Review section into its ticket, checks it, and formats it
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-55 — One command splices a returned `## Review` section into its ticket, checks it, and formats it

## Why

The reviewer returns its section as text and the builder commits it: above
`## Log`, verbatim, anchored on the heading form and not the bare heading
text, then `citations.mjs --section Review --require-anchors
--require-distinct-anchors`, then `npm run format`, then a re-resolve because
the formatter can reflow a table, then a disclosure note. Each of those is a
line on `records.md` or `review-ticket`, and each has failed at least once:

- a record spliced into the middle of an earlier record, because the insertion
  anchored on a heading string that prose had quoted 500 lines above (the
  `repo-13` session, recorded in `records.md`);
- a section that failed the gate the moment it was committed, in three of four
  tickets in one batch (sixteenth session, item 1);
- a gate record that went uncommitted entirely, twice on one ticket, costing
  three rounds (twenty-third session, items 1 and 10);
- a formatter rewrap that split a citation's coordinate from its anchor
  (twenty-third session, item 5).

None of these is judgement. They are one procedure done by hand under a
different context every time.

## Build

Add `scripts/review-record.mjs <ticket> <section-file> [--gate <n>]` that:

1. refuses a section file whose first line is not `## Review` or `### Gate <n>`;
2. finds the insertion point by heading form — a `## Review` at line start
   with blank lines around it, or, when the ticket already has one and
   `--gate` is given, the end of the existing `## Review` block — and refuses
   if the ticket has `## Review` and no `--gate`, or `--gate` and no
   `## Review`;
3. inserts the text unchanged, runs `npx oxfmt` on the ticket, then runs
   `citations.mjs <ticket> --section Review --require-anchors
--require-distinct-anchors` and, on a non-zero exit, restores the ticket
   from `git show HEAD:<ticket>` and prints the checker's output;
4. on success, diffs the inserted block against the section file ignoring
   table padding and rule width, and prints the diff — empty means verbatim
   survived the formatter — as the disclosure the builder pastes into its Log.

Then `review-ticket` step 8 and `records.md` name the script in place of the
procedure.

## Done when

- A test splices a section into a ticket whose prose quotes the `## Review`
  heading above the real one, and the section lands under the real heading.
- A test with a section that fails the checker leaves the ticket byte-identical
  to `HEAD` and exits non-zero with the checker's lines.
- A test with a table the formatter re-pads reports an empty normalised diff.
- `review-ticket` step 8 names the script; the procedure it replaces is gone.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history.
- 2026-09-20 — Built `scripts/review-record.mjs` and
  `scripts/test/review-record.test.ts` (20 tests). Scope was narrowed by the
  dispatch to those two files plus closing the ticket — `review-ticket` step 8
  and `records.md` are explicitly deferred to the orchestrator's own commit
  after this branch merges, so **Done when**'s fourth line ("`review-ticket`
  step 8 names the script; the procedure it replaces is gone") is not done by
  this branch. The replacement text for both is in the build report handed
  back, not written here.

  What Build step 2 had wrong: its first branch names the insertion anchor for
  a brand-new review as "a `## Review` at line start with blank lines around
  it", but a ticket has no `## Review` at that point at all —
  `docs/01-TICKETS.md` says the section is "Absent until the work is
  reviewed", and every ticket observed with one (e.g. `repo-15`) carries it
  between `## Done when` and `## Log`. The Why section already says the real
  anchor: "above `## Log` ... anchored on the heading form". Implemented that
  way — the first review anchors on the ticket's own `## Log` heading, found
  via `citations.mjs`'s `extractSections`, and a later `--gate` anchors on the
  end of the existing `## Review` block (which lands at the same line in
  practice, since `## Log` always follows `## Review` immediately).

  Also found and worked around a formatter-invocation trap not in the brief:
  `npx oxfmt <ticket>`, run literally, fetches an unpinned `oxfmt` over the
  network whenever the ticket's own directory has no `node_modules` above it —
  reproduced directly (`0.68.0` installed against this tree's pinned
  `0.62.0`) — and separately, `node_modules/.bin/oxfmt` cannot be spawned
  without a shell on Windows (`.claude/rules/testing.md`, and
  `packages/core/test/oxfmt-ignore-patterns.test.ts` already carries the fix).
  `review-record.mjs` resolves `oxfmt`'s own `bin` entry via `createRequire`
  and runs it under `process.execPath`, matching that existing pattern, rather
  than shelling out to `npx`.

  Registered the new script in `scripts/test/tsconfig.json`'s `include` list,
  per that file's own documented convention for a plain `.mjs` under test.

  Gates: `npm run check` (exit 0); `npx vitest run
scripts/test/review-record.test.ts` (20/20 passed); `npm test -- --project
repo` (366/366 passed); full `npm test`, run because
  `scripts/test/tsconfig.json` moved (176 files, 3172 tests, exit 0).

- 2026-09-20 — Round 2, from a ticket-reviewer gate (Opus) on `ebd05d2` and the
  orchestrator's decisions on its two open findings. Reproduced both before
  applying: a check failure's `git show HEAD:<ticket>` restore silently
  discarded an uncommitted edit unrelated to the splice (planted one, ran a
  failing section, `grep -c` the planted line afterward → `0`); and
  `locateInsertedBlock`'s "last nested `### `" rule diffed only a gate's own
  tail against the whole section file when that gate's body carried a second
  `###` heading, reporting a false non-empty diff on a splice that landed
  correctly. Both held.

  Applied the orchestrator's decisions, both taking its recommendation: (1)
  `main()` now refuses to run at all when the ticket has uncommitted changes
  against `HEAD` (`git diff --quiet HEAD -- <ticket>`), before writing
  anything — corrected the module docblock, which had presented the `HEAD`
  restore as unconditionally safe. (2) `locateInsertedBlock` now bounds a
  gate's block from its own `### Gate <n>` heading to the end of `## Review`,
  not to the matched heading's own `extractSections` range. Also folded in the
  three low findings: `planInsertion` refuses a `--gate <n>` whose heading
  already exists under `## Review`; the citations CLI is spawned under
  `process.execPath` instead of a bare `node` from `PATH`, matching the
  reasoning the docblock already gave for `oxfmt`; and `oxfmt` is now given
  `cwd: ticketRepoRoot` (previously unset), matching the checker's own `cwd`.

  Added five tests (25 total), one per change above plus a pure-function test
  for the gate-bound fix, and watched each fail first by reverting its guard
  in isolation and restoring afterward — recorded here rather than assumed:
  removing the dirty-check branch reported `git diff failed` instead of the
  named message; returning the matched heading unbounded from
  `locateInsertedBlock` reproduced the reviewer's own "diffs only the tail"
  failure; dropping the repeat-gate guard let a second `--gate 1` land at exit 0.

  The `review-ticket` step 8 / `records.md` wiring landed on
  `orchestrate-skill-sweep` at `56d5564` while this branch was in review
  (`git grep -n review-record 56d5564 -- .claude` names both) — so **Done
  when** 4 is met on the branch this one merges into, not by a commit on this
  branch. `status: done` stands on the orchestrator's word; the reviewer's
  `unproven` grade on that line was correct at the time it was given.

  Gates: `npm run check` (exit 0); `npx vitest run
scripts/test/review-record.test.ts` (25/25 passed); `npx vitest run
--project repo` (371/371 passed, 8 files).

- 2026-09-20 — Round 3, folding two `low` findings from gate 2 (Opus,
  `ebd05d2...7db4d52`) per the orchestrator's instruction, ahead of splicing
  either gate's record: the dirty-ticket refusal now says "commit them
  first" rather than "commit or stash them first" — this checkout's stash
  stack is shared across worktrees and concurrent sessions, so the advice
  must not point at it — and the script now refuses to run at all when the
  ticket is not tracked by git yet (`git ls-files --error-unmatch`), because
  `git diff --quiet HEAD -- <path>` reports a clean tree for a path `HEAD`
  has no record of, which let an untracked ticket slip the round 2 dirty
  guard entirely and land a failed splice with no `HEAD` copy to restore
  from. Two new tests (27 total), each watched failing first against its own
  fix reverted.

  Gates: `npm run check` (exit 0); `npx vitest run
scripts/test/review-record.test.ts` (27/27 passed).
