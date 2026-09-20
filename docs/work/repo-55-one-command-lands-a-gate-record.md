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
