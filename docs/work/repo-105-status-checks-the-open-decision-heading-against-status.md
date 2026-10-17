---
id: repo-105
tool: repo
title: npm run status fails a "Decision — open" heading on a ticket whose status is not needs-decision
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-105 — `npm run status` checks the open-decision heading against `status`

## Why

#521 adds an optional `## Decision — open` section to the ticket template in
`docs/01-TICKETS.md`, reading `## Decision — answered <date> by <who>` once
settled (owner, 2026-10-17). The heading now says whether a decision is open,
and so does `status: needs-decision`. The root `CLAUDE.md` says a ticket's
frontmatter is the only place its state is recorded, and nothing compares the
two: a ticket answered in its frontmatter and still headed "open", or the
reverse, is the drift adr/003 was written against.

Measured 2026-10-17 on `main`: 70 ticket files carry a `##` heading containing
"decision", in about 41 spellings once dates are normalised, and the one
`needs-decision` ticket (repo-98) carries none. The section is optional, so a
`needs-decision` ticket without the heading is not an error. A `— open` heading
on a ticket that is not `needs-decision` is.

This waits for #521 to merge, since the template section it checks is on that
branch; there is no ticket id to name in `depends_on`.

## Build

1. In `scripts/status.mjs`, beside the `difficulty` validation ("a `<status>`
   ticket needs a difficulty"), add: a ticket whose body has a line matching
   `^## Decision — open` outside a fenced block, and whose `status` is not
   `needs-decision`, fails with a message naming the file and both ways out
   (reword the heading as answered, as `docs/01-TICKETS.md` says, or set
   `needs-decision`). Skip fences the way `hasGateRecord` does
   (`extractSections`' rule, repo-73), so the template's own fenced example
   never fires.
2. Do not check the inverse: `needs-decision` with no heading stays legal.
3. `scripts/test/status.test.ts`, new cases at the end of the suite: the
   heading with `status: ready` fails and names the file; the heading with
   `needs-decision` passes; the heading inside a fence with `ready` passes.
   Each must fail first with the check removed, and the Log says so.
4. One sentence under `## Decision — open` in `docs/01-TICKETS.md` saying
   `npm run status` fails the heading on a ticket not in `needs-decision`, and
   a test that the sentence exists, in the shape the `awaiting` tests use.

## Done when

1. `node scripts/status.mjs` exits non-zero on a fixture ticket with
   `## Decision — open` and `status: ready`, naming the file, and exits 0 when
   the status is `needs-decision` or the heading is inside a fence — the three
   cases in `status.test.ts`.
2. `npm run status` exits 0 on the branch: the 70 existing headings are not
   rewritten, and none uses the new spelling with another status.
3. `docs/01-TICKETS.md` says so under the section.

## Log

- 2026-10-17 — Filed from the owner's review of #521 (session tools-d3), from
  the heading count above (`grep -h "^## .*[Dd]ecision" tools/*/docs/work/*.md
docs/work/*.md`).
