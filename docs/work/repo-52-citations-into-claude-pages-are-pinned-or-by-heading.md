---
id: repo-52
tool: repo
title: A citation into a .claude page is pinned or names a heading, and the existing ones get pinned once
kind: chore
status: ready
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
