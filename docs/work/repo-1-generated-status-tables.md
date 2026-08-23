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

## Review

Two gates, both **CONCERNS**, both closed. Recorded here by the builder rather
than by the reviewer, and that is the point: the first two gates were written in
reviewer worktrees that were then discarded, so neither existed in the repo and
nothing let a later reader check that the findings were addressed rather than
only the ones worth writing about. A gate that is not committed did not happen.

### Gate 1 — 2026-08-22

Verified: the reviewer traced every deleted paragraph asserting a security
property, a known gap or a risk, and read each destination rather than trusting
the pointer — **could not falsify** the claim that nothing was lost. Generated
regions byte-identical, markers intact, `--check` verified in both directions,
1168 tests confirmed correct for the base, line counts exact.

| #   | Finding                                                                                | Disposition                                                                                       |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | The ffmpeg-TLS gap survived only in **closed** `dl-14`, so nothing open tracked it     | **Fixed** — [dl-19](../../tools/downloader/docs/work/dl-19-ffmpeg-verifies-tls.md) filed, `ready` |
| 2   | `docs/02-DEPLOYMENT.md:256` still cited the page for the limiter's scope               | **Fixed** — consequence inline, links `dl-6`'s Log                                                |
| 3   | `dispatcher.ts` / `guarded-fetch.ts` cited `docs/work/dl-*`, which resolves to nothing | **Fixed** — repo-root-relative                                                                    |
| 4   | ADR 003 said two facts had no other home; three did                                    | **Fixed** — third row added, `01-ARCHITECTURE.md`                                                 |
| 5   | ADR 003 **replaced** its "roughly eight" estimate instead of annotating it             | **Fixed** — estimate restored verbatim, outcome annotated beneath                                 |
| 6   | The planner's page hand-wrote "thirty-seven commits"; it was 39                        | **Fixed** — number removed, not corrected                                                         |

One deleted token had no home and stays that way: Phase 0's evidence commit
`5ab843f`, covered by `02-ROADMAP.md`'s Phase 0 section.

### Gate 2 — 2026-08-23

Verified: `dl-19`'s two-ffmpeg-builds premise is **true** — the image installs the
distribution build via `apt-get` and sets `FFMPEG_PATH=/usr/bin/ffmpeg`, while
everything else defaults to `ffmpeg-static`, the override applied only where it
segfaults; so the **Windows CI runner** and any developer outside the dev
container genuinely run the static build. All six of gate 1's fixes confirmed,
both regions re-diffed byte-identical, six of gate 1's sweep conclusions
spot-checked and none falsified, and the line-count comparison verified rather
than taken (381 lines of prose against the architecture document's 307).

| #   | Finding                                                                          | Disposition                                                                        |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Neither gate existed in the repo — reviewer worktrees are discarded              | **Fixed** — this section, and `docs/01-TICKETS.md` now says the builder commits it |
| 2   | A sixth dangling citation: `.env.example:58`, on `PROXY_URL` and pinning         | **Fixed** — consequence inline, links `dl-8`'s Log                                 |
| 3   | Four comment paths still tool-relative in `orchestrator.ts` / `pipeline.test.ts` | **Fixed** — repo-root-relative; all 11 cited paths verified to resolve with `ls`   |
| 4   | The Log's "439 to 113" read as a live figure                                     | **Fixed** — marked as this-commit figures                                          |

The interesting half of finding 2 is the method, not the line. Gate 1's own
lesson said the citations that matter are the ones a compiler and a grep over
source both miss — and both rounds then ran an **extension-filtered** sweep
anyway, which is exactly how `.env.example` survived two of them. ADR 003's
lesson bullet now carries the mechanical fix: sweep with a bare `git grep -n`,
no `--include`, no path filter, and triage afterwards.

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
page, and "Running things". As of this commit the downloader's page went from 252
lines to 120 and the planner's from 439 to 113 — figures for this commit, not
live ones; the review round below moved the planner's again. The header table is
the load-bearing part — the page's
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
`contract/src/errors.ts`. Three facts in the repo had no other home, and moved:

| Paragraph                                                      | Moved to                                           |
| -------------------------------------------------------------- | -------------------------------------------------- |
| Rate limiting is per-process, not per-deployment               | `dl-6`'s Log — it is a property of what dl-6 built |
| `Job.attempts` counts attempts, so a first success reports `1` | `dl-5`'s Log, as the open question it always was   |
| The documentation leads the code by one phase (planner)        | `01-ARCHITECTURE.md`'s opening — see below         |

The rest of the downloader's gaps were already in `dl-8` (rebinding closed,
proxy mode does not pin), `dl-11` (subprocess egress, chaining), `dl-12` (WebRTC,
`ws://`, QUIC), `dl-14` (ffmpeg does not verify TLS — in full), `dl-13`, `dl-10`,
`dl-15`/`dl-16` (the two open coverage gaps, which are their tickets), or in the
code: `server.ts`'s `reconcileInterruptedJobs` docblock carries "interrupted jobs
are failed, not resumed" almost word for word, and `engine/src/download/http.ts`
carries the 403 ambiguity.

**The third moved to a document rather than a ticket.** The planner's "the
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

**Five more citations were about to become false**, and are the ones a grep for
`03-STATUS` in `*.ts` does not find. Two in closed tickets' Logs asserted the
page carries a fact today — `dl-12`'s "both are recorded in 03-STATUS.md" and
`dl-14`'s "and 03-STATUS.md carries it" — and now say where it really is. Two are
acceptance criteria on **open** tickets instructing future work to edit a section
that no longer exists: `dl-15`'s "the entry leaves 03-STATUS.md" and `dl-16`'s
equivalent. Both now say the gap closes by flipping frontmatter, and `dl-16`
keeps its "the container's browser tier stays smoke-tested and this ticket does
not reach it" caveat by moving it into its Log rather than onto a page. The
fifth is `docs/02-DEPLOYMENT.md`, and it is the one that mattered most — see the
review round below.
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

**2026-08-23 — review round: six findings, all addressed.** The gate came back
CONCERNS. The reviewer traced every deleted paragraph that asserted a security
property, a known gap or a risk, read each destination rather than trusting the
pointer, and could not falsify the claim that nothing was lost — but found five
things the claim did not cover and one it got wrong.

**[dl-19](../../tools/downloader/docs/work/dl-19-ffmpeg-verifies-tls.md) filed,
and it is the finding worth reading.** The ffmpeg-TLS gap — `tls_verify` defaults
to `0`, so every segment ffmpeg fetches is encrypted to a certificate nobody
checks — was deleted from the downloader's page on the grounds that `dl-14`'s Log
carries it more fully. True, and not sufficient: `dl-14` is **closed**, so
`npm run status` cannot surface the gap, nothing schedules it, and `dl-14` itself
says it "needs its own ticket". The header table this very change introduced says
a gap goes on the ticket that closes it, "and if there is none, file one" — and
none was filed. Leaving it would have been the exact failure this ticket exists
to prevent, committed in the change that establishes the rule.

The id is **dl-19, not dl-18**: `dl-18` was taken by a pipeline high-water-mark
ticket filed on the `dl-15` branch while this was in review. Worth knowing that
ids are claimed on branches, so the next free number is `git log --all` and not
`ls docs/work/`.

The brief is not "turn the flag on". Per `dl-14`, the substance is **which CA
bundle**, and the sharpest form of it is that this repo runs two different ffmpeg
builds: the image installs the distribution's with `apt-get`, dev and CI use
`ffmpeg-static`, and a statically linked build may carry no default trust store
at all. So `-tls_verify 1` can be correct in the container and break every
download on a laptop, or the reverse — which is why the ticket's first step is to
measure both and record the answer rather than to edit `args.ts`. It also asks
for the failure to be classified: a verification failure arrives as ffmpeg text
on stderr and surfaces as `DOWNLOAD_FAILED`, indistinguishable from a dead link,
which is the same ambiguity `dl-11` hit and wrote up.

**`docs/02-DEPLOYMENT.md` was the citation this missed**, and the miss says
something about the method. Four source citations were found by
`grep "03-STATUS" --include="*.ts"`; four more were found by reading the tickets.
The fifth was in neither set: an operations page telling an operator hardening a
shared instance that the in-process limiter's scope is "covered in 03-STATUS.md".
Following it now lands on a generated ticket table, from which the reasonable
conclusion is that the constraint no longer applies. It points at `dl-6`'s Log,
and states the consequence inline so the link is a citation rather than the
answer. **The lesson, recorded in the ADR: when a page is emptied, the citations
that matter are the ones neither the compiler nor a grep over source can see.**

**Two comment paths resolved to nothing.** `dispatcher.ts` and `guarded-fetch.ts`
were repointed to `docs/work/dl-8-…` and `docs/work/dl-11-…` — tool-relative,
where the comments they replaced were repo-root-relative. From the repo root that
resolves into `docs/work/`, which _this ticket_ made the repo-wide directory and
which holds no `dl-*` file, so an agent opening the path as written gets ENOENT
and concludes the ticket was deleted. Both are `tools/downloader/docs/work/…`
now, and `dispatcher.ts` says why in half a line. A relative path in a comment is
only unambiguous while there is one directory it could mean; `repo-1` is the
change that stopped that being true.

**Three corrections.** ADR 003 said two facts had no other home; three did — the
planner's "the documentation leads the code by one phase" had none either, and
became `01-ARCHITECTURE.md`'s opening. The same ADR bullet had **replaced** its
forward estimate of "roughly eight source comments" with the outcome; the
estimate is restored and annotated with what it turned out to be, because an ADR
that silently rewrites its own prediction to match the result stops being a
record of what was believed. And the planner's page hand-wrote "thirty-seven
commits", which was 39 — corrected by removing the number rather than by fixing
it, since a hand-maintained count on the page whose thesis is that it keeps no
hand-maintained numbers is the joke writing itself. It names the `git log`
invocation instead.

One deleted token genuinely had no home and stays that way: Phase 0's evidence
commit `5ab843f`, which `02-ROADMAP.md` covers well enough at its Phase 0
section.

**2026-08-23 — second gate: four findings, and a new process.** Recorded in
`## Review` above rather than only here, because the first of the four findings
was that neither gate existed in the repo at all.

**The gate record is now the builder's to commit.** A reviewer works in a
worktree that is discarded when it reports, so a `## Review` section written
there is written into nothing — the findings travel back as a message and the
record travels nowhere. Two gates on this ticket left no trace, and the second
reviewer caught it by asking the obvious question: what lets a later reader check
that six findings were addressed rather than the five worth writing about?
`docs/01-TICKETS.md` now says the builder writes the section, in the branch under
review, **one line per finding including the ones needing no change** — a record
listing only the findings that produced a diff is indistinguishable from one that
dropped the rest. It also names the weakness, which is that the author is
transcribing a verdict on his own work; the check is that the reviewer's message
is in the pull request thread beside it.

**`.env.example:58` was the sixth dangling citation, and the method is the
finding.** It told an operator that `PROXY_URL` turns address pinning off and
sent them to `03-STATUS.md` to read why. The failure is specific and bad: follow
it now, land on a generated ticket table with no mention of pinning, conclude the
caveat was retired, and deploy believing pinning is still in force behind the
proxy. Fixed the way `02-DEPLOYMENT.md` was — consequence inline (pinning is not
weakened, it is not the mechanism in play; the pre-flight SSRF check still runs)
and a link to `dl-8`'s Log for the reasoning and the tests.

The method half is worth more than the line. The previous entry recorded the
lesson that "the citations that matter are the ones a compiler and a grep over
source both miss" — and then swept with `--include="*.ts"` anyway, and the round
after that added markdown and still missed a file that is neither. **A bare
`git grep -n 03-STATUS`, unfiltered, finds all seventy-odd in one call**, and
`.env.example` is on the first line of the output. ADR 003's lesson bullet now
carries the mechanical form: no `--include`, no path filter, triage afterwards.
The unfiltered sweep was then run to completion here; everything it returns
besides the six is either a correct definitional reference (`CLAUDE.md`,
`docs/01-TICKETS.md`, `00-TOOLS.md`, both READMEs, `status.yml`, `status.mjs`,
ADR 001), a historical Why or acceptance line in a **closed** ticket, or this
ticket's own prose.

**Four comment paths were still tool-relative** in `jobs/orchestrator.ts` and
`api/test/pipeline.test.ts` — the other two of the four comments repointed in the
first commit, left behind when `dispatcher.ts` and `guarded-fetch.ts` were fixed
in the second. `engine/src/download/manifest.ts` resolves from neither the repo
root nor the citing file's own directory. All four are `tools/downloader/…` now,
and every path cited across the six touched files was extracted with a regex and
run through `ls`: eleven paths, eleven hits, no ENOENT.

**A figure that read as live is marked as historical.** "The downloader's page
went from 252 lines to 120, the planner's from 439 to 113" was true of the commit
that made it and stopped being true one commit later, at 116 — the same class of
rot as the test count this ticket deleted, reintroduced in the entry describing
its deletion. It now says so in the sentence rather than being re-corrected,
because re-correcting it is what the whole ticket argues against.
