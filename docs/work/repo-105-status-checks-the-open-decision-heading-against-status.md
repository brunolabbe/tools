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

Measured 2026-10-17 on `main`: 71 ticket files carry a `##` heading containing
"decision", in about 41 spellings once dates are normalised, and the one
`needs-decision` ticket (repo-98) carries none. The section is optional, so a
`needs-decision` ticket without the heading is not an error. A `— open` heading
on a ticket that is not `needs-decision` is.

#521 merged as f7929c41, so the template section this checks is on `main`, and
nothing blocks the build; there is no ticket id to name in `depends_on`.

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
2. `npm run status` exits 0 on the branch: the 71 existing headings are not
   rewritten, and none uses the new spelling with another status.
3. `docs/01-TICKETS.md` says so under the section.

## Log

- 2026-10-17 — Filed from the owner's review of #521 (session tools-d3), from
  the heading count above (`grep -h "^## .*[Dd]ecision" tools/*/docs/work/*.md
docs/work/*.md`).
- 2026-10-18 — Built on `repo-105-status-checks-open-decision-heading`, base
  029641b4. The check is in `scripts/status.mjs` (`validate`, with
  `hasOpenDecisionHeading`), its three cases are the end of
  `scripts/test/status.test.ts`, and the template sentence is in
  `docs/01-TICKETS.md`.
  - **Premise.** The Why said this waits for #521. It is merged: `git
merge-base --is-ancestor f7929c41 origin/main` exits 0, and
    `git show origin/main:docs/01-TICKETS.md | grep -n "^## Decision — open"`
    prints `82:## Decision — open`. The sentence is corrected above. Nothing
    else in the brief rested on #521 being unmerged.
  - **Counts, re-measured on 029641b4.** `grep -l "^## .*[Dd]ecision"
tools/*/docs/work/*.md docs/work/*.md | wc -l` is 71 files, the grep
    line count is 81, and `sort -u` gives 48 distinct lines. The Why's "70
    files" is one short, and its "about 41 spellings once dates are
    normalised" reproduces once dates are normalised (my `sort -u` above did not
    normalise them): `grep -h "^## .*[Dd]ecision" tools/*/docs/work/*.md docs/work/*.md | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}/DATE/g' | sort -u | wc -l` prints 41, and 48
    un-normalised. No heading
    needed rewriting, because none is `## Decision — open`: the same grep
    for that exact line over `work/` gives 0 files.
  - **Fail-first, Build 3.** Commit `8bc15bd2` is the baseline. With the
    `if` in `validate` replaced by `if (false && …)`, `npx vitest run
scripts/test/status.test.ts --reporter=verbose` gave `Tests  1 failed |
138 passed (139)`, the failure being ``a `## Decision — open` heading on a
ready ticket fails, and names the file``. That is the only case the check
    can fail, so the other two passing is by construction. Each was run against
    the mutant that would wrongly fail it: the `needs-decision` exemption
    dropped, with the template sentence also removed in the same run, gave
    `Tests 2 failed | 137 passed (139)` (the `needs-decision` case and the
    doc case); matching headings without `extractSections`' fence rule gave
    `Tests 1 failed | 138 passed (139)` (the fence case). Both files were
    restored with `git checkout 8bc15bd2 -- <path>`, and the tree was clean
    against the baseline afterwards.
  - **The real board, Done when 2.** `node scripts/status.mjs --json` exits 0
    and reads 318 ticket files; `npm run status` exits 0. Neither prints the
    new message, and the raw grep above finds no `## Decision — open` line in
    any `work/` file.
  - **Gates.** `npx vitest run scripts/test/status.test.ts`: 139 passed.
    `npm test -- --project repo`: 14 files, 561 passed. `npm run check`: exit 0.
  - **Fold-in.** Considered; nothing else this change makes free. The
    template fence in `docs/01-TICKETS.md` shows the same heading as an
    example, which the fence rule already exempts. `scripts/review-record.mjs`
    (repo-100) was not touched.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F1 — "Done when 2 and
  the Why still say "70". The real figure is 71 files and 81 lines. The Log
  also says the brief's "about 41 spellings once dates are normalised" did not
  reproduce, because the builder did not normalise dates. Normalised, it
  reproduces exactly: `sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}/DATE/g' | sort -u | wc -l` prints 41, and 48 un-normalised."
  The Why and Done when 2 now say 71, and the builder's "Counts" entry now says
  the 41 reproduces once dates are normalised. `awk '/^## Log/{exit} {print}' <ticket> | grep -c "70 "` → 0 (2 at the gated head). `awk '/^## Log/{exit} {print}' <ticket> | grep -c "71 "` → 2. The Why's other claim: `grep -h "^## .*[Dd]ecision" tools/*/docs/work/*.md docs/work/*.md | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}/DATE/g' | sort -u | wc -l` → 41.
- 2026-10-18 — Fixed at landing by owner choice: gate 1, F3 — "the Log's
  fail-first paragraph is garbled. Spaces are missing around code spans, and
  one span holds escaped backticks, which CommonMark does not honour inside a
  code span." Spacing restored, and the escaped span rewritten with
  double-backtick delimiters, wording unchanged. The paragraph is in the Log,
  so the counts below are over the whole file, with the last letter of each
  pattern bracketed so this entry does not match itself.
  `grep -c "needs-decision.exemptio[n]" <ticket>` → 0 (1 at the gated head).
  `grep -c "gave.Tests 2 faile[d]" <ticket>` → 0 (1 at the gated head).
  `grep -c 'a [\\].' <ticket>` → 0 (1 at the gated head, the escaped span).
