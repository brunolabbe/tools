---
id: repo-135
tool: repo
title: The ready view lists tickets whose own note says they cannot start
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-135 — The ready view lists tickets whose own note says they cannot start

## Why

`npm run status -- --ready` is the orchestrator's intake: every ticket it lists
goes to the seam mapper and is offered to the owner as a batch candidate. A
ticket can be `ready` and still not startable — held until a dependency
publishes a fix, or not before a date — and the format has no field for that.
Authors have been putting the hold in `note:` and in prose, and `--ready` lists
the ticket every batch all the same. Four batches logged it (tools-5e on
2026-10-25 for dl-132 and repo-120, tools-e6 on 2026-11-01 for repo-122 and
repo-134), and the 2026-11-01 review of the orchestration log filed it here.

`status: needs-decision` is not the state for it: that status says the ticket
poses a question a human must answer, and these tickets pose none. `depends_on`
is not either: it names tickets, and the hold is on an event outside the repo.

## Reproduction

On `main` at `8ad4e91d`, 2026-11-01:

```
$ npm run -s status -- --ready | grep -E '^repo-122|^repo-134'
repo-122	repo	Move better-sqlite3 to 13 and its types to 9 in the three APIs
repo-134	repo	glob and minimatch carry moderate advisories fixed only in majors no dependent accepts, in code nothing here runs
```

while their frontmatter reads `note: held at 12 until a lockfile install can
skip the compile` and `note: not startable until @fastify/static depends on
glob ^14`. repo-126 carried `Not before 2026-10-28` in its Build section and was
listed every day before that date.

## Decision — open

How a `ready` ticket says it cannot start yet, so that `--ready` leaves it out.

- **(a) A `note:` whose text begins `held:`** — `note: held: until @fastify/static
  depends on glob ^14`. `--ready` omits a ticket whose note starts that way,
  `--show` and the per-tool view still print it, and `--json` carries a `held`
  boolean. No new field, no new status: one condition in `scripts/status.mjs`,
  one test, one paragraph in `docs/01-TICKETS.md`. Recommended: the four
  tickets that needed it already use `note:` for the sentence.
- **(b) A new optional field `held:`** with the same semantics as (a)'s prefix,
  leaving `note:` as the display override it is. Cleaner, and a parse change:
  the frontmatter reader, its tests, `--json`'s schema and the format page.
- **(c) A new status value `held`.** Every reader of `status` (the gate, the
  lander's `--land`, the CI check for a record on a non-done ticket, release
  tooling) has to learn it; the largest change for the same effect.

A date-bound hold (`not before 2026-10-28`) is the same thing under every
option: the text names the date, and whoever reads the view clears it after.
Nothing here computes dates.

## Build

Under the chosen option:

1. `scripts/status.mjs`: `--ready` excludes a held ticket; `--show <id>` prints
   the hold on its closing line beside `awaiting`; `--json` carries it.
2. `scripts/test/status.test.ts`: a held fixture is absent from `--ready` and
   present in the tool view and `--show`; the CI exit code is unchanged.
3. `docs/01-TICKETS.md`, the fields table and the `note` paragraph: the hold's
   form, and that it is a reminder, not a gate — nothing stops a human
   dispatching a held ticket on purpose.
4. Convert repo-122's and repo-134's notes to the chosen form.

## Done when

1. `npm run -s status -- --ready` on a fixture with one held ticket omits it,
   and the same fixture's tool view lists it with the hold.
2. `npm run -s status -- --show <id>` prints the hold's text.
3. `scripts/test/status.test.ts` asserts 1 and 2, and `npm test -- --project repo`
   passes.
4. repo-122 and repo-134 are absent from `--ready` on `main` after the merge.

## Log

- 2026-11-01 — Filed by the review of the orchestration log (tools-5e's item 7,
  tools-e6's item 7). Reproduction above run on `main` at `8ad4e91d`.
