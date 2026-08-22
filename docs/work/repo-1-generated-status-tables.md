---
id: repo-1
tool: repo
title: Generate the status tables from ticket frontmatter, and stop branches editing them
kind: chore
status: in-flight
milestone: null
depends_on: []
---

# repo-1 — The status table is not something a person can keep

**Packages:** `scripts`, `docs`, `.github/workflows`

## Why

`tools/<tool>/docs/03-STATUS.md` is edited by very nearly every pull request —
thirty-seven commits on the planner's alone — because it restates, by hand, what
each ticket's frontmatter already says. Two failures follow.

The loud one is the conflict: a table with one row per ticket, and every ticket
touches it.

The quiet one is worse and is already in `main`. `pl-21`, `pl-22` and `pl-23`
are `done` in their frontmatter and `ready` in the table below it. A branch cut
before they merged carries the old rows, the merge is clean because the file
still parses, and three statuses silently revert. `CLAUDE.md` carries a standing
"rebase before merging anything that touches a status table" instruction for
exactly this, which is an unenforced convention guarding a generated artefact.

The argument in full, and the alternatives that were rejected — a local store
agents query, `merge=union`, convention alone — are in
[ADR 003](../adr/003-the-status-page-is-generated.md).

## Build

1. `scripts/status.mjs`, plain `.mjs` with no dependencies for the same reason
   `commit-message.mjs` has none. It parses every ticket's frontmatter and
   offers: the default human view, `--json`, `--ready` (ready _and_ unblocked),
   `--prs` (folds in `gh pr list`, best-effort), `--write`, `--check --base`.
2. Strict parsing. An unknown field, a status or kind outside the taxonomy, an
   id that disagrees with its filename, a `depends_on` pointing at nothing — each
   is a named failure. A parser that shrugs reports a clean page having read
   half the tickets.
3. Markers in each `03-STATUS.md`. `--write` replaces between them; a file with
   no markers is an error, never a file to append to.
4. `.github/workflows/status.yml`. `check` on every pull request; `regenerate`
   on push to `main`, which writes, formats and pushes.
5. `scripts/test/status.test.ts` in the `repo` vitest project, plus
   `../status.mjs` in `scripts/test/tsconfig.json`'s `include`.
6. The doc edits: ADR 003, `docs/01-TICKETS.md`, `docs/00-TOOLS.md`, and the
   `CLAUDE.md` rule this replaces.

**The trap that shaped the workflow.** `ci.yml` carries
`paths-ignore: ["**.md"]`. A documentation-only pull request — a ticket flipped
to `done` — runs none of it, which is precisely the pull request that needs
checking. Hence a workflow of its own rather than a job in `ci.yml`.

**The second trap: oxfmt formats markdown here.** A generated table that oxfmt
would repad is a `npm run check` failure the moment it lands. `table()` pads to
match, and the workflow runs `npm run format` after `--write` as the belt.

## Done when

- `npm run status` prints open work per tool with what blocks each, and
  `-- --ready` lists only tickets whose dependencies are all `done`.
- Every one of the repo's tickets parses, asserted over the real files.
- A branch that edits a generated region fails `--check`; one that does not,
  passes. Both proven against a real base ref.
- A `03-STATUS.md` with no markers fails rather than being appended to.
- `npm run check` and `npm test` are green, and the generated regions survive
  `npm run format` unchanged.

## Log

**2026-08-22 — built.** `scripts/status.mjs`, its suite (21 tests), the
workflow, ADR 003, and the markers in both tools' status pages.

Four things the brief did not know:

- **`docs/work/` exists now, and this is `repo-1`.** ADR 002 recorded that
  repo-wide work had nowhere to live — the release pipeline was filed as the
  first half of `dl-10` with `pl-2` as its second consumer — and said the third
  such piece would be the signal to give `docs/` a `work/` of its own. This is
  the third. `status.mjs` reads `docs/work/` as a pseudo-tool called `repo`: it
  appears in every view and is written into no status page, because there is no
  repo-wide dashboard and a third place saying what `npm run status` says would
  be the problem again.

- **The narrative migration is deliberately not here.** The prose paragraphs and
  the hand-written phase table stay, so each page now carries a generated
  milestone rollup next to a phase table saying an overlapping thing. That is
  temporary and it is on purpose: `pl-24`'s pull request (#61) is open against
  those exact lines, and the two changes would have conflicted for no reason.
  The follow-up moves each paragraph to its owning ticket, retires the phase
  table and the test count, and repoints the ~8 source comments that cite
  `03-STATUS.md` as the home of a fact.

- **The parser found nothing wrong.** All 46 existing tickets pass unchanged,
  which is the only reason the strictness was affordable — a scan that has to
  start by fixing its inputs gets loosened instead.

- **`--check` needs a real base and a full clone.** A shallow checkout does not
  have the base commit, and `git show` then fails in a way that is
  indistinguishable from "the file is new" — which passes. `fetch-depth: 0` in
  the workflow is load-bearing, and the new-file branch of `--check` is the one
  place this design can be defeated by an environment rather than by a diff.
