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

Three gates, all **CONCERNS**, all closed. Recorded here by the builder rather
than by the reviewer, and that is the point: the first two gates were written in
reviewer worktrees that were then discarded, so neither existed in the repo and
nothing let a later reader check that the findings were addressed rather than
only the ones worth writing about. A gate that is not committed did not happen.

### Acceptance

One row per **Done when** line. Written late — gate 3's finding was that this
half was missing entirely and a finding table had quietly stood in for it, which
is exactly how the acceptance-to-test link stops being recorded.

| Done when                                                              | Proof                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run status` prints open work per tool with what blocks each       | **verified** — no unit test; the pure functions are covered and the human render is not. Re-run: `pl-28` prints `(waits on pl-24, pl-25)`                                |
| …and `-- --ready` lists only tickets whose dependencies are all `done` | `scripts/test/status.test.ts:154` ✓ — `pl-3` waiting on ready `pl-2` is excluded                                                                                         |
| Every one of the repo's tickets parses, asserted over the real files   | `scripts/test/status.test.ts:62` ✓ — reads `REPO`, not a fixture, and asserts the tool set against `readdirSync(tools/)`                                                 |
| A branch that edits a generated region fails `--check`…                | **verified** — the CLI `git show` path has no unit test. Gate 1 re-ran it in both directions; this branch passes it untouched                                            |
| …one that does not, passes. Both proven against a real base ref        | **verified** — `--check --base origin/main` green on every push of this branch                                                                                           |
| A `03-STATUS.md` with no markers fails rather than being appended to   | `scripts/test/status.test.ts:222` ✓, and `:226` for markers reversed                                                                                                     |
| `npm run check` and `npm test` are green                               | **verified** — exit 0; 84 files / 1168 tests, unchanged from the base commit                                                                                             |
| …and the generated regions survive `npm run format` unchanged          | `scripts/test/status.test.ts:206` ✓ for the surrounding-text guarantee, plus **verified**: both regions re-diffed byte-identical to `origin/main` after each format pass |

Four rows are `verified` rather than `proven` and none of them is idle: two are
the `--check` CLI, whose proof is `git show` against a real ref and which no unit
test reaches, and two are the gate bullet every ticket ends with. `verified`
means nothing asserts it and it was re-run — the numbers above are the ones that
came back, not the ones the Log claims.

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

### Gate 3 — 2026-08-23

Verified: the reviewer reproduced the unfiltered sweep hit-for-hit (79), triaged
all 29 non-ticket hits and found **no seventh citation of the dangling kind**,
link-checked **every markdown link in the repo — 378 links across 75 files,
anchor fragments included: 0 missing, 0 bad anchors** — reproduced the 11-path
`ls` sweep and widened it to 28 paths with 28 hits, verified all ten gate
dispositions above as truthful, and checked out `12a19a5` to confirm the 439→113
figures are exact for that commit.

| #   | Finding                                                                                                                                   | Disposition                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | **med** · `.env.example:58` said the proxy's policy is "the only thing" that bounds egress — false, and self-contradicted two lines later | **Fixed** — five words deleted. `ssrf.ts:223` and `:243` do bound it in proxy mode               |
| 2   | **med** · The new rule contradicts `.claude/skills/review-ticket/SKILL.md:79-82`, which is live                                           | **Fixed** — the skill is the document that was wrong; steps 7, 8 and the section shape rewritten |
| 3   | **med** · `01-TICKETS.md` describes the section two incompatible ways, and this exemplar satisfied only one                               | **Fixed** — both halves are named as required, and the acceptance table above was written        |
| 4   | **med** · The safeguard asserts a check exists rather than instructing anyone to create it                                                | **Fixed** — it is an imperative in both `01-TICKETS.md` and the skill's step 8                   |
| 5   | **low** · `repo-1:194` re-introduced "thirty-seven commits" in the same commit that removed it                                            | **Fixed** — 39, and the sentence no longer carries the number                                    |
| 6   | **low** · The sweep enumeration reads as exhaustive but omits 7 files and 13 hits; "23 ticket-file hits" is a file count, not a hit count | **Fixed** — full enumeration, and both counts named as what they are                             |
| 7   | **low** · `adr/001:28` is the origin of the "dashboard" definition and still has no forward pointer to 003                                | **Fixed** — annotated, not rewritten, in the pattern used for 003's "roughly eight"              |
| 8   | **low** · `tools/planner/docs/03-STATUS.md:24-27` carries three sentences of narrative the page's own table says belongs in an ADR        | **Fixed** — cut to the ADR link, matching the downloader's page                                  |

Finding 7 is the one worth reading. `adr/001` is where "the status document
becomes a dashboard" was first written, and it is the framing that invited every
paragraph this ticket deleted — so an agent adding a tool reads the layout ADR,
learns the definition, and reproduces the problem. Chasing the citations without
annotating their source would have left the generator running.

Finding 8 is the ticket failing its own rule in its own exemplar: the planner's
header table says a decision belongs in an ADR, three lines above three sentences
of narrative that duplicate `adr/003:7-13`. The downloader's page had it right.

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
the load-bearing part — the downloader
page's old second paragraph already said "if you find yourself writing a
paragraph here, it belongs in a ticket" and very nearly every pull request the
tool has had ignored it, so the replacement names the destination for each kind of thing a person arrives
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
The unfiltered sweep was then run to completion, and the arithmetic is worth
stating properly because the first attempt at this paragraph named seven files
and read as though that were all of them. Two stable groups, and a third that
this paragraph is itself inside — so no total is quoted, since writing one
changed it:

- **29 non-ticket hits, in 14 files**, every one triaged and none dangling:
  `.github/workflows/status.yml` (3, the workflow that writes the region),
  `CLAUDE.md` (2), `docs/01-TICKETS.md` (1), `docs/00-TOOLS.md` (1),
  `tools/planner/CLAUDE.md` (1) — the definition, in the four places it is
  stated; `scripts/status.mjs` (4) and `scripts/test/status.test.ts` (3), the
  generator and its suite; `README.md` (1), `tools/downloader/README.md` (2),
  `tools/downloader/docs/02-ROADMAP.md` (1),
  `tools/planner/docs/02-ROADMAP.md` (1),
  `tools/planner/docs/01-ARCHITECTURE.md` (1) — navigation links, all still
  true; and `docs/adr/003` (6) plus `docs/adr/001` (2), the decision and its
  origin.
- **35 hits in 22 other ticket files**, all historical Why, acceptance or Log
  lines in **closed** tickets, plus `dl-5` and `dl-6`'s "carried here from
  `03-STATUS.md` (repo-1)" provenance lines and `dl-15`/`dl-16`'s repointed
  acceptance criteria. `dl-19` cites the page nowhere.
- **The remainder, in this ticket's own prose** — a number that this sentence
  moves by existing, which is why it is not written down. `git grep -c 03-STATUS
docs/work/repo-1-generated-status-tables.md` answers it, and reproducing the
  two groups above is `git grep -n 03-STATUS` with the ticket paths filtered out
  afterwards, never before.

Note that those are **hit** counts, not file counts; the two differ by more than
half here, and a paragraph that quotes one while the reader is reconciling the
other is the small version of the problem this whole ticket is about.

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

**2026-08-23 — third gate: four mediums, four lows, and the rule finally has
teeth.** Recorded in `## Review` above. The reviewer reproduced the unfiltered
sweep hit-for-hit, link-checked all 378 markdown links in the repo (0 missing, 0
bad anchors), widened the cited-path `ls` sweep from 11 to 28, and checked out
`12a19a5` to confirm the line figures — then found four mediums, of which three
are the same shape: **this ticket wrote a rule and did not finish making it
true.**

**`.env.example` was wrong in a way an operator could act on, and it was my
sentence.** Fixing the dangling citation last round, I wrote that the proxy's own
egress policy "is what bounds the service then, **and it is the only thing that
does**." Neither source said "only" — `dispatcher.ts:42` says "what guards a
proxied deployment is the proxy's own egress policy", `dl-8`'s Log says "what
bounds egress there is the proxy's own policy" — and my own next sentence
contradicted it. The check does still bound the service in proxy mode:
`ssrf.ts:223` refuses non-allowed schemes and `:243` refuses blocked literal IPs
regardless of the dispatcher. The failure this invited is specific: an operator
concludes the app filters no egress of its own and sets
`SSRF_ALLOW_PRIVATE_ADDRESSES=true` — which `dispatcher.ts:44` invites for exactly
that deployment — believing it costs nothing, and silently turns off checks that
were running. Five words deleted. **The lesson is about summarising: I tightened
two hedged sources into one confident claim, which is the failure mode of writing
a summary from two things that agree.**

**The rule contradicted the tracked skill, and the skill was live.**
`.claude/skills/review-ticket/SKILL.md` said the reviewer produces the section and
"the caller appends it to the ticket unedited… Append it verbatim", edited on
`main` three commits ago. `docs/01-TICKETS.md` now said the opposite. The skill is
the document that is wrong — its authors could not have known that "append it
verbatim" appends into a worktree about to be deleted — so its step 7 now says
**return** the section and says why a file written there goes nowhere, step 8 is
three acts (commit it, post the report to the pull request, then report to the
user), and the section heading is "The section to commit". The skill's own
warning is kept and re-aimed: it used to say a caller who edits the section has
handed the review back to the model under review; it now says the caller is
transcribing a verdict on its own work, which is the same hazard with a longer
reach. It also picks up the one-subsection-per-gate rule, for the same reason the
finding list has to include the findings that needed no change.

**`01-TICKETS.md` described the section two incompatible ways** — the template at
line 51 asking for an acceptance row per `Done when` line, the new prose asking
for a line per finding — and **the exemplar I committed satisfied only the
second.** So the next builder writes a finding table, cites the prose, and the
acceptance-to-test link quietly stops being recorded. Both halves are now named
as required in both places, and the acceptance table exists above: eight rows,
four `proven` with a `status.test.ts` line each, four `verified` with the numbers
that came back. Writing it was the useful part — it is the first time this
ticket's own acceptance has been traced, and it surfaced that the `--check` CLI
path has no unit test at all. That is honest as `verified` and would be a finding
if the criterion had not been re-run.

**The safeguard was decorative.** `01-TICKETS.md` asserted that "the check on it
is that the reviewer's message is in the pull request thread" — a claim that a
check exists, not an instruction to anyone to create one. Nothing posts it: no
workflow reads PR comments, and the skill's step 8 reported to the user and
stopped. And this branch has no pull request, so for the very ticket introducing
the rule both reviewer messages exist nowhere but discarded scrollback — gate 2's
failure relocated rather than closed. It is an imperative now, in both documents,
with the command and the case where the branch has no PR yet.

**Four lows, and two of them are this ticket failing its own rule.** The Log
re-introduced "thirty-seven commits" in the same commit that removed it from the
page — the number is 39 — so the sentence no longer carries one. The sweep
enumeration named 7 files and read as exhaustive while omitting 7 more and 13
hits, and quoted a file count where the reader was reconciling hits; it now gives
both stable groups exactly (29 hits in 14 non-ticket files, 35 in 22 other ticket
files) and deliberately quotes **no total**, because writing one moved it. And
the planner's page carried three sentences of narrative about its own history,
duplicating `adr/003`, three lines under a table saying such prose belongs in an
ADR — cut, matching the downloader's page, which had it right. Lengths at this
commit: planner 112, downloader 120.

**The fourth low is the one that matters most.**
[adr/001](../adr/001-per-tool-docs-and-tickets.md) is where "the status document
becomes a dashboard" was first written — the origin of the framing this ticket
spent three rounds deleting everywhere else, still `accepted`, with no pointer to 003. An agent adding a tool reads the layout ADR first and learns the definition
that invited every paragraph removed here. Annotated rather than rewritten, in
the pattern used for 003's "roughly eight": the word stays, a blockquote beneath
it records that this half did not hold and why — a dashboard nobody generates is
a dashboard everybody hand-edits — and the header says "accepted, amended in part
by 003". Chasing citations without annotating their source would have left the
generator running.
