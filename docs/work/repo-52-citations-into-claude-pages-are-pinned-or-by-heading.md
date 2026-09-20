---
id: repo-52
tool: repo
title: A citation into a .claude page is pinned or names a heading, and the existing ones get pinned once
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-52 — A citation into a `.claude` page is pinned or names a heading, and the existing ones get pinned once

## Why

The skill and agent pages under `.claude/` are prose that the loop edits every
few sessions, and roughly a thousand coordinates in merged records point into
them by bare line number. Every insertion into one of those pages displaces
every unanchored coordinate below it, silently: the citations gate reads
`## Review` sections only, and an unanchored citation is reported `unanchored`
whatever line it now lands on.

Measured on #281, 2026-09-20. A sweep of the rule pages went through four gate
rounds; three of them were this class. Gate 1 found 11 anchored citations
outside `## Review` broken by the branch, gate 2 found four unanchored ones
displaced by gate 1's own repair, gate 3 found one more in the tool root the
sweep had not read. The branch ended by pinning 35 citations across eleven
merged records to its base sha, by hand, with a script that lived in a
scratchpad. `repo-50` files the detector; this ticket removes the need for it
on these pages, which are the ones that move.

A coordinate into a `.claude` page is a claim about the page as it stood on the
day, never about the page as it will stand. That is what a pin says. A heading
is stable across edits in a way a line number is not, and every rule on these
pages sits under one.

## Build

1. Add the rule to `records.md`'s citation section and to `review-ticket` step
   4: a citation into any file under `.claude/` is written either pinned,
   `<file>@<rev>:<line>` with `<rev>` a `main` commit, or as the page and the
   heading it sits under, with no line number. A bare `file:line` into
   `.claude/` is a finding.
2. One mechanical pass over both ticket roots, `docs/work/*.md` and
   `tools/*/docs/work/*.md`: every unpinned coordinate into `.claude/` gets
   `@<rev>` where `<rev>` is the newest `main` commit at which the cited line
   still reads as the record's context describes — the commit before the page
   was next edited, found with `git log -L` or the sweep in `repo-50`'s Why.
   Where no such commit exists, leave the citation and list it in the Log. Do
   not change any text that is not a pin.
3. Make `citations.mjs` report an unpinned coordinate into `.claude/` as its
   own state, `unpinned-volatile`, off by default and on under a flag the gate
   passes, so the rule has a check.

Run the pass after #281 merges, not before: #281 pins 35 of these already and
the two would conflict on every one of them.

## Done when

- The rule is on both pages, with this ticket as its measurement.
- `git grep -nE '\.claude/[^@ ]*\.md:[0-9]'` over both ticket roots returns only
  the citations the Log lists as unpinnable, with a reason each.
- A test plants an unpinned coordinate into `.claude/` in a record and the
  flagged run reports it; the same record with the pin passes.
- The pass is a single commit touching pins only, proven by a
  whitespace-insensitive diff with equal line counts per file.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history,
  after #281 had paid three gate rounds for this class. Ordered after #281.
- 2026-09-20 — Built steps 2 and 3 (step 1's rule text and its two page edits
  are the orchestrator's, deferred by dispatch — the rule text is in this
  builder's report). Both ticket roots swept for `\.claude/[^@ ]*\.md:[0-9]`:
  11 real citations pinned to the `main` commit that wrote the citing line
  (found by `git blame -L <n>,<n>` on the record, matching the ticket's
  practical form), across repo-21 (5), repo-43 (2), repo-45 (1), pl-46 (1),
  pl-47 (1). One citation (repo-21 line 219, `.claude/agents/builder.md:22
"sonnet"`) looked pinnable but is a _demonstration_ of defect 1's wrong
  claim — no commit ever holds "sonnet" at that line, since the table has
  always read "haiku" there — so it is left bare and logged as unpinnable,
  same as the two lines the existing `<!-- citations: evidence -->`
  declaration at line 1180 already covers (the declaration line itself and
  the citation it excuses, both at `.claude/agents/builder.md:21-25`).
  `git grep -nE '\.claude/[^@ ]*\.md:[0-9]'` over both roots now returns only
  those three lines. Verified every new pin resolves
  (`node scripts/citations.mjs <record>`, no `unresolvable`); proved pins-only
  with `git diff -b --stat` (equal insertions/deletions per file); committed
  alone before any code change (`45fdf15`).

  `citations.mjs` gained `requireClaudePins` (CLI flag `--require-claude-pins`,
  default off) and a new state, `unpinned-volatile`: an otherwise `verified` or
  `unanchored` citation into a `.claude/*.md` file with no pin. Failing states
  (`unresolvable`, `moved`, `malformed-pin`) and `unchecked`/`evidence` are
  left alone — see `isUnpinnedVolatile`'s docblock. `citations-gate.mjs` turns
  the flag on unconditionally for the `## Review` scope it already enforces
  (zero existing `## Review` citations hit it — verified before wiring it in).
  Two tests plant a bare `.claude/...md:N` citation: one shows it is invisible
  without the flag (`ok`, exit 0, byte-identical to before), one shows the
  flagged run reports `UNPINNED`/`unpinned-volatile`/exit 64; a third shows the
  pinned form passes under the flag; a fourth shows the override does not
  touch an already-`moved`/`unresolvable` citation.

  Editing `citations.mjs`/`citations-gate.mjs` shifted absolute-line citations
  into them from 8 other already-merged tickets (repo-14, repo-25, repo-29,
  repo-31, repo-35, repo-36, repo-37, repo-44) — confirmed against `45fdf15`
  (this ticket's own pre-code-change commit) which were pre-existing debt and
  which this branch newly broke, and pinned only the newly-broken ones to
  `fdafd1a` (`origin/main`'s tip and this branch's merge-base; verified
  `scripts/citations.mjs`/`citations-gate.mjs` byte-identical there to
  `45fdf15`, so the pin is permanent and does not depend on this branch's own
  commits surviving a squash merge). `node scripts/citations-gate.mjs --against
origin/main` is back to `97 enforced, 0 failing`, matching the corpus before
  any of this ticket's code changes. Also fixed a circular JSDoc type
  (`unpinnedVolatile`'s param typed against `checkCitations`'s own return
  type) that TypeScript silently resolved to `any`, surfacing as six TS7006
  errors elsewhere in the test file.

  Gates: `npm run format` (708 files, only cosmetic re-wrap of a line I added);
  `npx vitest run --project repo` 350/350; `npm run check` exit 0;
  `node scripts/citations-gate.mjs --against origin/main` exit 0 (`97
enforced, 0 failing; 7 grandfathered, holding 2 unresolvable, 21 unanchored;
0 raised`). A whole-corpus sweep (179 records, `node scripts/citations.mjs
<record>` and `--rev 45fdf15`, compared) found and closed one more
  regression outside `## Review` scope (repo-37) that the gate itself would
  not have caught, so the corpus is clean, not just the gated slice.
