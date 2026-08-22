---
id: repo-1
tool: repo
title: Generate the status tables from ticket frontmatter, and stop branches editing them
kind: chore
status: done
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

**2026-08-22 — the bootstrap commit is the one branch that must regenerate.**
`pl-24` merged while this was in review, and the pull request went red on its own
check: `--check` falls back to "the region must be what `--write` produces"
whenever the base commit has no region, and that is true of exactly one pull
request — this one. So `main` moving under it made a correct branch wrong, and
the fix was to merge `main` and re-run `--write`.

It is worth being precise about the scope, because the obvious reading is that
the guard is fragile. It is not: every pull request after this one compares
against a base that _has_ a region, and passes by leaving it alone. The
new-region branch exists for a genuinely new tool's status page, and it inherits
this property — a tool added while something else merges has to regenerate once.
That is a rebase, which is what it would be anyway.

The other half was self-healing and needed nothing: the region committed here
was rendered when `pl-24` still said `ready`, and the `regenerate` job on `main`
would have corrected it on the merge push regardless. Fixing it on the branch is
for the reviewer's benefit, so the diff does not ship a table that is visibly
wrong.

**2026-08-22 — the narrative is retired, and this closes.** The second half the
first entry deferred: `pl-24` had merged, so the lines it was open against were
free.

**What a `03-STATUS.md` is now.** Three things and no fourth: the generated
region, a short table saying where each kind of fact goes _instead_ of onto this
page, and "Running things". The downloader's page went from 252 lines to 120, the
planner's from 439 to 113. The header table is the load-bearing part — the page's
old second paragraph already said "if you find yourself writing a paragraph
here, it belongs in a ticket" and thirty-seven commits ignored it, so the
replacement names the destination for each kind of thing a person arrives
wanting to write: frontmatter for state, a ticket's Log for what work did, a
ticket for a gap, a code comment for why the code is shaped that way, an ADR for
a cross-tool decision, `02-ROADMAP` for phases.

**Retired outright.** The phase table (`02-ROADMAP` defines phases and the
generated milestone rollup counts them — two tables saying an overlapping thing
was the duplication this ticket exists to end), the test count on both pages,
"Last updated", the `## Open questions for the owner` section, and both `##
Known gaps and risks` sections. A gap worth recording is a ticket worth filing,
and the generated table lists those with a sentence each.

**Almost nothing had to move, which is the finding.** ADR 003 predicted the
narrative paragraphs were each "that ticket's Log, restated a second time"; that
turned out to be true of nearly all of them, checked one at a time against the
owning ticket before deleting. Every planner paragraph was already carried
somewhere else — its ticket's Log or Why (pl-2, pl-5, pl-9, pl-10, pl-11, pl-12,
pl-13, pl-15, pl-16, pl-17, pl-18, pl-19, pl-26), an amendment to
`00-ANALYSIS` §3/§7, `02-ROADMAP`'s answered-questions section, or a docblock in
`contract/src/errors.ts`. Exactly two facts in the repo had no other home, both
the downloader's, and both moved:

| Paragraph                                                      | Moved to                                           |
| -------------------------------------------------------------- | -------------------------------------------------- |
| Rate limiting is per-process, not per-deployment               | `dl-6`'s Log — it is a property of what dl-6 built |
| `Job.attempts` counts attempts, so a first success reports `1` | `dl-5`'s Log, as the open question it always was   |

The rest of the downloader's gaps were already in `dl-8` (rebinding closed,
proxy mode does not pin), `dl-11` (subprocess egress, chaining), `dl-12` (WebRTC,
`ws://`, QUIC), `dl-14` (ffmpeg does not verify TLS — in full), `dl-13`, `dl-10`,
`dl-15`/`dl-16` (the two open coverage gaps, which are their tickets), or in the
code: `server.ts`'s `reconcileInterruptedJobs` docblock carries "interrupted jobs
are failed, not resumed" almost word for word, and `engine/src/download/http.ts`
carries the 403 ambiguity.

**One paragraph moved to a document rather than a ticket.** The planner's "the
documentation leads the code by one phase" is a warning to the reader of
`00-ANALYSIS` and `01-ARCHITECTURE`, so it is now `01-ARCHITECTURE`'s own opening
— where the reader it warns is standing — rather than a note on a third page they
may not have opened.

**The source comments, four not eight.** ADR 003 estimated "roughly eight"; the
grep finds four, in the four files it named. Each now points at the fact's real
home rather than at a page being emptied:

| Site                              | Now points at                                            |
| --------------------------------- | -------------------------------------------------------- |
| `api/src/guarded-fetch.ts:13`     | `dl-11`, which closed the ffmpeg-egress hole it names    |
| `api/src/dispatcher.ts:4`         | `dl-8`, which is what the "two gaps" were                |
| `api/src/jobs/orchestrator.ts:71` | `engine/src/download/manifest.ts` and `download/http.ts` |
| `api/test/pipeline.test.ts:259`   | the same two, plus `MAX_REPROBE_RETRIES`                 |

**Four more citations were about to become false**, and are the ones a grep for
`03-STATUS` in `*.ts` does not find. Two in closed tickets' Logs asserted the
page carries a fact today — `dl-12`'s "both are recorded in 03-STATUS.md" and
`dl-14`'s "and 03-STATUS.md carries it" — and now say where it really is. Two are
acceptance criteria on **open** tickets instructing future work to edit a section
that no longer exists: `dl-15`'s "the entry leaves 03-STATUS.md" and `dl-16`'s
equivalent. Both now say the gap closes by flipping frontmatter, and `dl-16`
keeps its "the container's browser tier stays smoke-tested and this ticket does
not reach it" caveat by moving it into its Log rather than onto a page.
Historical Why sections and the acceptance criteria of _closed_ tickets were left
alone — they record what was true when they were written, and rewriting them
would be revisionism.

**Where the rule now lives.** Root `CLAUDE.md` and `docs/01-TICKETS.md` both
described `03-STATUS.md` as "a dashboard: what is in flight, what is known to be
rough" — the definition that invited every paragraph this removed. Both now say
what the page holds and what it does not, `docs/00-TOOLS.md`'s spine listing
matches, and ADR 003's consequences say the follow-up landed. `tools/planner/CLAUDE.md`
pointed an agent at `03-STATUS.md` for "what actually exists today"; it points at
`docs/work/` now, which is where that is.

**One stale line fixed in passing.** The root `README.md` said the planner's
state was "the intake produces a brief; nothing plans from it yet", which stopped
being true at pl-16. It now says `npm run status`, which is the point: a state
sentence maintained by hand in a fourth place is the same bug one level up.
