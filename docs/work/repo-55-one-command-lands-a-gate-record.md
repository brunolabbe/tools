---
id: repo-55
tool: repo
title: One command splices a returned Review section into its ticket, checks it, and formats it
kind: work-package
status: ready
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
