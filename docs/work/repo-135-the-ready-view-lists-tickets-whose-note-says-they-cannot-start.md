---
id: repo-135
tool: repo
title: The ready view lists tickets whose own note says they cannot start
kind: fix
status: done
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

## Decision — answered 2026-11-01 by the owner

**Answer: (a)**, the `note: held: …` prefix, chosen from (a), (b) and (c) below
with (a) recommended. Rated `standard` as filed; the answer does not change it.
The options stay as they were put.

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
   repo-134's `note:` is deleted by its own branch (PR #766), so convert only
   repo-122's.

## Done when

1. `npm run -s status -- --ready` on a fixture with one held ticket omits it,
   and the same fixture's tool view lists it with the hold.
2. `npm run -s status -- --show <id>` prints the hold's text.
3. `scripts/test/status.test.ts` asserts 1 and 2, and `npm test -- --project repo`
   passes.
4. ~~repo-122 and repo-134 are absent from `--ready` on `main` after the merge.~~ _Observed 2026-11-08 at `d7137816`, the `main` it was cut from; the reading is in the Log._

## Review

**Gate: PASS** — 2026-11-08 · `64185876..4fa7ea17` · Sonnet 5.5, depth medium (repo-139's measurement: a `standard` ticket gated on the Sonnet row)

| Done when                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `--ready` on a fixture with one held ticket omits it; the same fixture's tool view lists it with the hold | `scripts/test/status.test.ts` › "repo-135: --ready omits a held ticket, lists the one beside it, and says why on stderr" (stdout is exactly the plain ticket's row, so a filter that dropped everything fails it) and › "repo-135: the tool view still lists a held ticket, with the hold and no empty `waits on`" ✓. Positive control: with the `!t.held` skip removed from `readyTickets`, 2 of the 7 `repo-135` tests fail (these two); restored |
| 2. `--show <id>` prints the hold's text                                                                      | `scripts/test/status.test.ts` › "repo-135: --show prints the hold on its own row and on the closing line, not `unblocked`" ✓ — asserts the `held` row and the `held — not startable yet: …` closing line, with `unblocked` still printed for the plain ticket beside it                                                                                                                                                                             |
| 3. `status.test.ts` asserts 1 and 2, and `npm test -- --project repo` passes                                 | rows 1 and 2 above; `npm test -- --project repo` run here: 15 files, 639 passed, 1 skipped (640), exit 0; `npm run check` exit 0; the pull request's `test (ubuntu-latest)`, `check` and informational `test (windows-latest)` are all green at `4fa7ea17` ✓                                                                                                                                                                                        |
| 4. repo-122 and repo-134 are absent from `--ready` on `main` after the merge                                 | **awaiting** — the merge of this pull request; the reading is `npm run -s status -- --ready` on `main` listing neither repo-122 nor repo-134. Branch reading already agrees (repo-122 withheld on stderr as `held: at 12 until a lockfile install can skip the compile`; repo-134 is `done` on the base), but the line names `main`                                                                                                                 |

- **low** · no `Done when` line depends on it · `nfr:maintainability` · a bare `note: held:` (or `held:` and spaces) holds the ticket with **no reason**. `--ready` stderr reads `withheld from --ready — held:`, the tool view `(held: )`, `--show` prints an empty `held` row and the closing line `held — not startable yet:`. The repo refuses the same shape for `awaiting` (`rejectEmpty`, repo-32), and no test covers it or `held:x` (no space; holds, as the prefix is literal). The same neighbourhood: `docs/01-TICKETS.md` says the prefix is "at the start of the line", but values are trimmed, so `note:    held: …` and a tab after the colon hold too — the safe direction, nothing relies on it. Direction (not run): refuse or ignore an empty hold like an empty `awaiting`, or have the stderr line say a hold without a reason.
- **low** · no `Done when` line depends on it · `nfr:reliability` · `--show` on an **`in-flight`** ticket whose `note` still opens `held:` ends on `held — not startable yet: …`, while the tool view marks the same ticket `»` and the base printed `unblocked`. The new branch in `printTicket` sits after the `!OPEN` and `needs-decision` branches but `OPEN` includes `in-flight`. The docs bless dispatching a held ticket on purpose, and that closing line is the one an agent reads to decide (repo-3's comment); reachable only on a sliced ticket, whose note nobody has cleared. Remedy run: guarding the branch with `ticket.status === "ready"` leaves `status.test.ts` at 154 of 154 and the in-flight fixture back on `unblocked`.
- **dropped** · `--json` carries `held: true` on a `done` or `dropped` ticket with a leftover `held:` note — what the docs promise ("a `held` boolean on every ticket"); `readyTickets` requires `ready`, so nothing reads it.
- **dropped** · `note: held: …` is invalid strict YAML (a `: ` inside a plain scalar), and every held note has one by construction. No YAML reader exists in the tree (`git grep` for `yaml`, `js-yaml`, `gray-matter`, `front-matter` imports: none); the readers are `status.mjs`'s `parseFrontmatter` (shared by `review-record.mjs`), `review-record`'s `status:` line replacer and `preflight`'s `status:` regex, all read repo-122's new line correctly, and `oxfmt --check` passes on it. Precedent on `main`: repo-83's title holds `shell: false`. How github.com renders the frontmatter block of a held ticket is **unverified**.
- **dropped** · a quoted `note: "held: x"` exits 1 on every view — the parser's `rejectQuoted` (repo-24), unchanged and not this branch's behaviour; the message names the remedy.
- **findings** · the hunt returned 5; 2 carried, 3 dropped.
- Build skipped: the diff is `scripts/status.mjs`, its test, and markdown, importing `node:` builtins, `vitest` and `markdown.mjs`.
- Invariants: no tool imports, errors, spawn, URL, contract or Dockerfile surface touched (skipped); style clean (`npm run check` exit 0); no new test file (existing `status.test.ts`, already registered).
- NFR: security n/a (reads local files only) · performance n/a (one `startsWith` per ticket) · reliability ✓ (the exit code is unchanged: a held ticket beside a dangling dependency exits 1 with that one dangling-dependency problem, a held ticket alone exits 0; a board whose only ready ticket is held prints `nothing is ready and unblocked` and names the hold on stderr) · maintainability — above.

## Log

- 2026-11-01 — Filed by the review of the orchestration log (tools-5e's item 7,
  tools-e6's item 7). Reproduction above run on `main` at `8ad4e91d`.
- 2026-11-01 — Owner chose (a) at the review session's checkpoint (asked beside
  repo-137's question); `status` moved to `ready` in the same commit.
- 2026-11-08 — Built option (a) on `repo-135-ready-honours-held`, base `64185876`.
  `scripts/status.mjs`: `held` is a boolean on every ticket (`note` starts
  `held:`, exact and lower case); `readyTickets` skips it; `withheldFromReady`
  names it on stderr, beside any open dependency; the tool view prints
  `(held: …)` instead of an empty `(waits on )`; `--show` has a `held` row and a
  closing line `held — not startable yet: …` in place of `unblocked`, keeping
  blockers. `docs/01-TICKETS.md` has the field-table cell and a paragraph (a
  reminder, not a gate; nothing computes a date). repo-122's `note` is now
  `held: at 12 …`; repo-134 had nothing to convert (its `note` went with #766).
  `npx vitest run scripts/test/status.test.ts`: 154 of 154, 7 of them new
  (`repo-135: …`). `npm run -s status -- --ready` on this branch no longer lists
  repo-122 or repo-134 (Done when 4 is a claim about `main` after the merge).
  What the brief had wrong: nothing material; it did not say a held ticket with
  a dependency should name both reasons on stderr, so it does.
  Not folded in: repo-126's `note: not startable before 2026-10-28 …` is the
  same shape, but its date has passed and a concurrent builder owns that ticket;
  pl-26's "Deferred until the existence slice is filed" also reads as a hold and
  is another tool's ticket (a `docs(planner)` change). Both are for whoever
  clears them to convert or delete.
- 2026-11-08 — Owner answered two questions at gate 1's checkpoint. (1) Gate 1's
  two lows, which should the lander apply — options (a) F2 at landing and F1
  recorded, (b) both recorded, (c) F2 at landing and F1 filed as a ticket:
  chose (a). (2) The stale `held`-shaped notes the builder did not convert —
  options: repo-126's own builder deletes its `note: not startable before
  2026-10-28 …` in its branch and pl-26's note is left for whoever next touches
  the planner (recommended), or also convert pl-26 now in a `docs(planner)`
  pull request, or leave both: chose the first. Neither note is edited on this
  branch.
- 2026-11-08 — Fixed at landing by owner choice: gate 1, F2 — "`--show` on an
  in-flight ticket whose note still opens held: ends on held — not startable
  yet". `printTicket` guards the branch with `ticket.status === "ready"`; the
  test "repo-135: --show on an in-flight ticket whose note opens `held:` still
  ends on `unblocked`" in `scripts/test/status.test.ts` failed on `4fa7ea17`
  and passes with the guard. F1 stays recorded, unfixed.
- 2026-11-08 — Done when 4 read, and the `awaiting` line deleted, in the commit
  that records the reading. `main` at `d7137816` (its history holds #768 as
  `4df7082a`, the merge this line waited on). Command:
  `npm run -s status -- --ready`, exit 0, run in the worktree at `d7137816`.
  Stdout lists `repo-126` and neither `repo-122` nor `repo-134`:
  `grep -c -E '^(repo-122|repo-134)\b'` on the output prints `0`. Stderr:
  `docs/work/repo-122-better-sqlite3-13.md: withheld from --ready — held: at 12
  until a lockfile install can skip the compile`. Done when 4 is struck in the
  `~~…~~` form the acceptance lines use elsewhere (repo-130, repo-26), with the
  reading beside it. `status` stays `done`.
