---
id: repo-2
tool: repo
title: Retire the per-tool status page, because a generated artefact in version control needs a writer
kind: chore
status: done
milestone: null
depends_on: [repo-1]
---

# repo-2 — A generated artefact in version control needs a writer

**Packages:** `docs`, `scripts`, `.github/workflows`, both tools' `docs/` and
`CLAUDE.md`

## Why

[repo-1](./repo-1-generated-status-tables.md) made the ticket tables in
`tools/<tool>/docs/03-STATUS.md` a projection of ticket frontmatter, written on
`main` by `.github/workflows/status.yml` and guarded on every branch by
`node scripts/status.mjs --check`. The decision was right and the mechanism does
not work. Two bugs, both live on `main` as this is written.

**1. The `regenerate` job has never pushed a commit.** Branch protection rejects
the bot:

```
remote: - Changes must be made through a pull request.
 ! [remote rejected] main -> main (push declined due to repository rule violations)
```

Six `push` runs of `status.yml` exist. Three failed exactly that way
(`32616378963`, `32644735728`, `32645087083`), one failed differently and is
worth reading — `! [rejected] main -> main (fetch first)`, the job losing a race
with a concurrent merge (`32616349367`) — one was cancelled by the workflow's own
`cancel-in-progress` (`32616340342`), and the one green run
(`32604747060`, repo-1's own merge) printed `the tables already match the
tickets` and exited before `git push`. So the job has never once written the
thing it exists to write, and `main` says so today: the downloader's page lists
**dl-17 as `ready`** when it merged in #65, and **omits dl-19 entirely** — a
`ready` security ticket, the one repo-1 filed so the ffmpeg-TLS gap would be
schedulable.

**2. `--check` cannot see that staleness, by construction.** It compares HEAD's
region against the **base commit's** region (`scripts/status.mjs`, the
`flags.has("check")` branch). Both are equally stale, so the comparison is green.
It asks "did this branch edit the region", never "is the region correct". Every
pull-request run has passed while the artefact it guards has been wrong for a
week.

**The fix is not to repair the writer**, and this is the part a future reader
must not undo. Every writer available here is unsafe, noisy or racy:

| Writer                                                  | Why it was rejected                                                                                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push to `main` from the job (today's shape)             | Rejected by branch protection, and the ADR itself says the fix must not be to make the failure pass quietly                                                                  |
| A protection bypass — PAT, app token, ruleset exemption | Buys an unreviewed write path to `main` to keep a table current. An unreviewed push cannot be verified, and the blast radius of the credential is the whole repo             |
| A pull request per merge                                | Reviewable, and it is noise: one PR per merge, each touching a file every ticket touches. It does not dissolve the conflict either — it relocates it into a queue of bot PRs |
| Regenerate on the branch instead                        | This is exactly what repo-1 removed. A table every ticket rewrites is a file every branch conflicts on, quietly                                                              |
| Give up and hand-write it again                         | ADR 003's `## Context`, in full                                                                                                                                              |

There is a fifth option the four above make obvious. **A generated artefact
stored in version control needs a writer; the fix is to stop storing it.**
`npm run status` computes the same tables from the tickets on every run, cannot
be stale, and needs no job, no token and no guard.

That is sound only because nothing on the page is both unique and non-derivable,
and each third of it was checked:

- **The generated region** is a projection of frontmatter. `npm run status` is
  the same projection, and `--markdown` now emits the same table for pasting
  somewhere a person is reading.
- **The "where each kind of fact goes" table** is meta — it is a rule about the
  ticket format, not a fact about a tool — so it belongs beside the format rules
  in [docs/01-TICKETS.md](../01-TICKETS.md), stated once instead of twice.
- **`## Running things` already duplicates a documented home.** Root
  `CLAUDE.md` says per-tool commands live in that tool's `CLAUDE.md`, and each
  tool's `## Commands` section is **strictly richer** — it carries the traps the
  status page omits: npm runs workspace scripts serially so `dev --workspaces`
  never reaches the UI, `tsx watch` under `concurrently` silently never binds on
  Windows, `e2e` rebuilds the bundle or you are testing the mock. And the
  duplicate had already drifted: `03-STATUS.md` said `npm run dev`, the
  downloader's `CLAUDE.md` says `npm run dev:downloader`. One of them was wrong
  and nothing could tell you which.

**This is not a reversal of repo-1.** It is repo-1's own test — _a fact restated
where nothing keeps it true_ — applied to what repo-1 left behind. repo-1
deleted the hand-written narrative because a person cannot keep it; this deletes
the machine-written table because, here, no machine can.

## Build

1. **File this ticket first.** Carry the argument, both bugs with their evidence,
   and the rejected writers with their reasons.
2. **Delete both `tools/*/docs/03-STATUS.md`.** Before deleting, diff each
   `## Running things` against that tool's `CLAUDE.md` `## Commands` and fold in
   anything genuinely unique. Losing a real fact here is the one unacceptable
   outcome.
3. **Repoint every reference.** `git grep -n "03-STATUS"` **unfiltered — no
   `--include`, no path filter** (repo-1's mechanical lesson, learned across
   three sweeps). Triage every hit: historical references in closed tickets'
   `Why`/`Log` sections are records and stay; instructions to _future_ work, nav
   links and spine listings are repointed at `npm run status` or at the ticket
   that owns the fact. Verify with `ls` that every path written resolves from the
   repo root.
4. **`scripts/status.mjs`** — delete the region machinery that no longer has a
   subject: `--write`, `--check`, `extractRegion`, `replaceRegion`,
   `renderRegion`, `statusPath`, `showAtRef` and the markers. Keep the parser,
   the default view, `--ready`, `--json`, `--prs`. Add `--tool <name>`,
   `--show <id>` and `--markdown`, and cover all three.
5. **`.github/workflows/status.yml`** — delete it. _(Amended after gate 1; the
   brief said to keep it, pruned to the frontmatter-parse check, "and keep the
   comment explaining why this is its own workflow rather than a job in
   `ci.yml`". Writing that comment is what falsified it — see step 9.)_ Move
   `node scripts/status.mjs --json > /dev/null` into `ci.yml`'s `check` job,
   with the comment saying what it catches, and delete the file.
6. **Amend, do not rewrite, `docs/adr/003`.** Its Context and Decision are a
   record of what was believed and stay byte-unchanged; a superseding note says
   the decision held and the mechanism did not. Extend `docs/adr/001`'s existing
   amendment rather than adding a second.
7. **Reconstruct `dl-17`'s missing gate**, labelled as reconstructed after the
   fact rather than transcribed at the time.
8. **Update `.claude/skills/orchestrate-tickets/SKILL.md`** with what the batch
   that produced this ticket taught after the skill was written. _(Extended
   after gate 1 with four more, the batch having kept teaching: verifying a
   ticket's premise rather than its code, the resumability cost of removing a
   worktree, sweeping the other names of a thing, and asking about parallelism
   at intake.)_

9. **Stop `ci.yml` skipping markdown**, which is the reason step 5's workflow
   existed. _(Added after gate 1.)_ `ci.yml` carried
   `paths-ignore: ["**.md"]` on both triggers, but `npm run check` runs
   `oxfmt --check` and **oxfmt formats markdown in this repository** —
   `.oxfmtrc.json` has to name `**/CHANGELOG.md` in `ignorePatterns` precisely
   because it does. So a markdown-only pull request could break `npm run check`
   with nothing in CI to catch it: it merged green-because-skipped and the next
   pull request to touch code went red for a reason unrelated to itself. Not
   theoretical — oxfmt reflowed a wrapped `> 0` into a blockquote in `dl-18`,
   caught only because an agent ran `format` locally. Run `check` on every
   event; keep the five-minute-fifty-four matrix filtered, which needs a
   changes-detection job because **Actions has no per-job `paths`**; verify the
   "no required status checks" claim in `ci.yml`'s comment still holds for a
   skipped _job_ rather than a skipped _workflow_, and record the answer either
   way.

## Done when

- Neither `tools/downloader/docs/03-STATUS.md` nor
  `tools/planner/docs/03-STATUS.md` exists, and nothing in the repo instructs
  future work to read or edit either.
- Every unique fact from both `## Running things` sections is in that tool's
  `CLAUDE.md`, and every command that survives is one that exists in
  `package.json`.
- `git grep -n "03-STATUS"` returns nothing that sends a reader to a file which
  no longer exists: only historical references inside `status: done` tickets,
  the ADRs that record the decision, this ticket, and the prose that explains
  the deletion in the documents which used to describe the page. No markdown
  link anywhere in the repo resolves to a missing target.
- `node scripts/status.mjs` exports no region function and accepts no `--write`
  or `--check`; `--tool`, `--show` and `--markdown` each work and each have a
  test.
- _(Amended after gate 1, with the criterion the addition earned; the original
  read "`.github/workflows/status.yml` has one job, it runs on `pull_request`
  only, and it is `node scripts/status.mjs --json > /dev/null`".)_
  `.github/workflows/status.yml` does not exist and nothing outside a record
  references it. `node scripts/status.mjs --json > /dev/null` is a step of
  `ci.yml`'s `check` job, and neither `ci.yml` trigger filters by path, so
  `check` runs on a markdown-only pull request. The `test` matrix still skips
  one — through the `changes` job rather than a trigger filter — and every event
  without a usable diff base runs it.
- `npm run check` and `npm test` are green.

## Review

### Gate 1 — 2026-08-23

**Gate: CONCERNS** — one med, five lows. Range `origin/main...HEAD`.

Verified by the reviewer: both deleted files reconstructed from `origin/main` and
**every non-generated line accounted for**, so nothing could be silently lost.
Each folded-in claim checked against the code rather than against the prose it
came from — `RATE_LIMIT_*_PER_MINUTE=0` really disables, via `RateLimiter`'s
`get enabled` being `> 0`; `planner.yml` really asks for `/api/health`, then
`curl /` with `grep -q '<div id="root">'`, then health again; the M3 invocation
matches `playwright.config.ts`'s actual env. The sweep reproduced at 93 hits in
33 files with no mis-triage, all 23 ticket-file hits confirmed to be in
`status: done` files. Links checked at 330 relative links, 0 missing. All three
CI premises verified verbatim from the run logs, including `GH013` on three runs
— one of which shows the commit being created immediately before the rejection —
and the `fetch first` race; the correction from "never succeeded" to "never
pushed a commit" was judged the accurate claim. All six defeat attempts on the
unknown-flag guard were refused, including `--write=x`, `-w` and bare `write`.

| #   | Finding                                                                                                                                                                                                                    | Disposition                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **med** · `package.json:35` — the `"// status"` annotation still advertised `--write` as usable, one line above the `status` script. Invisible to `git grep 03-STATUS` because the ADR filename is lowercase `status-page` | **Fixed** — rewritten to describe what the script now does and to say `--write`'s pages were retired. The method half is the finding: the Log now records that the sweep needs a second pass over the _other names_   |
| 2   | **low** · `scripts/status.mjs:145` — `dir: docs` pushed onto every ticket, read by nothing since `statusPath` went, absent from the JSDoc return type, and serialised into `--json`                                        | **Fixed** — removed. It was `statusPath`'s input and died with it; `renderMarkdown` and `describeTicket` both key off `file`                                                                                          |
| 3   | **low** · `scripts/test/status.test.ts` — inherited stderr printed three lines mid-run that read as failures in a green suite                                                                                              | **Fixed** — `stdio: ["ignore", "pipe", "pipe"]`, with a comment saying why. `npm test` is now silent                                                                                                                  |
| 4   | **low** · The ADR amendment was inserted **inside `## Decision`**, which Build step 6 says stays byte-unchanged                                                                                                            | **Fixed** — blockquote removed from Decision, which is now byte-identical to `origin/main`. Its content is a `## Consequences` bullet, and the header carries a blockquote warning a Decision reader before they read |
| 5   | **low** · The ticket claimed this pull request was itself an instance of the path-filter bug; it is not, since the branch touches `tools/*/docs/`                                                                          | **Fixed** — parenthetical dropped, the finding restated without it                                                                                                                                                    |
| 6   | **low** · Done-when line 3 was narrower than what shipped — the sweep also returns six live files of new prose explaining the deletion                                                                                     | **Fixed** — widened to "nothing that sends a reader to a file which no longer exists", with the no-dangling-link half stated as the checkable part                                                                    |

**Raised and correctly not a finding:** flag precedence is silent, so
`--json --markdown` prints JSON. Same shape `--json`/`--ready` already had, and
no reader is misled about a removed feature. No change.

### Post-gate addition — 2026-08-23

**New work landed on this branch after gate 1 closed, and it is recorded here
rather than folded into the dispositions above, because gate 1 did not see it.**
Two additions, both in the two Log entries below, and the gate that covers them
is the one that runs after this, not the one above.

1. Build step 9 and the amendment to step 5: `ci.yml` no longer skips markdown,
   `status.yml` is deleted rather than pruned, and the frontmatter parse is a
   step of `check`.
2. Build step 8's skill update, extended with four things this session taught
   after that step was already written — one of them a correction to advice the
   skill gives.

Gate 2 below is the gate over both, and it found five lows plus one addition of
its own. A third post-gate item — the worktree symlink farm — arrived with that
gate rather than from the build, and is marked as such in its own Log entry.

### Gate 2 — 2026-08-23

**Gate: PASS** — five lows, all fixed. Range `origin/main...HEAD`, covering the
post-gate additions gate 1 did not see.

Verified by the reviewer: the `changes` shell reproduced against real shas and
all five degenerate bases, every one failing open as claimed. The ruleset
confirmed independently and by a **second endpoint this build did not check** —
`gh api repos/{owner}/{repo}/rules/branches/main`, which folds in inherited
organisation rulesets that `/rulesets` alone would not show. Same three rules,
still no required status check, so the claim holds on the wider reading too. ADR
003's `## Context`, `## Decision` and `## Alternatives considered` byte-compared
against `origin/main` by SHA-256: identical.

| #   | Finding                                                                                                                                                                                                                       | Disposition                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **low** · `ci.yml` — `git diff --name-only` has rename detection on by default and reports a rename as its **destination only**, so `git mv src/foo.ts docs/foo.md` lists one `.md` path and the matrix skips a deleted `.ts` | **Fixed** — `--no-renames` on both diffs, reproduced before and after. The header's "the rule the trigger filter expressed, unchanged" is softened to what is provable: GitHub does not document whether its filter consults `previous_filename` |
| 2   | **low** · `ci.yml` — the comment implied a failing `changes` job would silently skip `test`; a failed job sets the run's conclusion to `failure`, so the skip is red and visible                                              | **Fixed** — the comment now says what the guards actually buy (a _degenerate base_ falling open) and adds the reviewer's point that `set -euo pipefail` stops an unguarded git failure before the second diff's `\|\| true` can mask it          |
| 3   | **low** · `SKILL.md:84` still read "Remove each worktree as its PR opens", six lines above the new paragraph correcting it — and that file's own `### Do not cap the gate count` cites self-contradiction as a real find      | **Fixed** — the original bullet now says "once its ticket is **finished** — merged, or abandoned — not when its PR opens", so the rule and its reasoning agree. A correction stacked under the thing it corrects was the actual defect           |
| 4   | **low** · `scripts/test/status.test.ts` — precise about its own test, misleading about the file: two further tests are equally skipped and uncovered, notably `no tool keeps a status page`, this ticket's regression guard   | **Fixed** — rewritten as a section comment listing what `check` covers and what it does not, naming the guard and why an all-`.md` pull request is exactly the change it cannot see. Pre-existing, and now stated instead of implied             |
| 5   | **low** · The `status.yml` Done-when line was rewritten in place while Build steps 5 and 8 carry `_(Amended after gate 1…)_`, so the acceptance list read as though the criterion had always said that                        | **Fixed** — annotated in the same form, quoting the original criterion                                                                                                                                                                           |

**Dropped by the reviewer, no action:** `tools/planner/CLAUDE.md:79` ("the unit
suite runs on every push") — equally imprecise before this change, and the build
had declared leaving it. And `test` now waiting on a full-history `changes`
checkout, which is a cost rather than a defect.

**Added with the gate, not found by it:** the worktree symlink farm in
`## Worktree hygiene`. Post-gate work in its own right; see the Log entry below.

## Log

**2026-08-23 — built, and the brief was right about the shape and wrong in five
details.**

**`--tool` already existed.** The brief asked for three new flags; `--tool` had
been in `parseArgs` and `main` since repo-1, undocumented and untested. What
this ticket actually added there is the test and a decision: `--show` **ignores**
`--tool` rather than composing with it, because a ticket's blockers can sit under
another tool and narrowing first would report that a ticket which exists does
not.

**Unknown flags are now refused, which the brief did not ask for and the
deletion demands.** `--write` and `--check` were real yesterday. Left as-is,
`parseArgs` would have added either to `flags`, matched nothing, and printed the
default view — handing a reader with muscle memory a green run and the belief
that a page had just been regenerated. `parseArgs` now names the flags it knows
and lists them on a miss. Two of the 27 tests are that.

**A second failure mode of the writer, which strengthens the argument.** The
brief has the `GH013` rejections. Run `32616349367` failed differently:
`! [rejected] main -> main (fetch first)` — the job lost a race with a
concurrent merge. So even with the permission, the writer is not reliable while
more than one pull request lands in the same minute, which is the normal case
here. That is recorded in the ticket's Why and in ADR 003's amendment, because
"just give the bot a token" is the obvious re-proposal and it does not survive
this run.

**One green `push` run exists, and it is not a counterexample.** `32604747060`,
repo-1's own merge, printed `the tables already match the tickets` and exited
before `git push`. Six push runs, zero commits written. The precise claim is
"never pushed a commit", not "never exited 0", and the ticket says the former.

**The old workflow's `pull_request` filter never matched a repo-wide ticket.**
It was `tools/*/docs/**`, so a pull request that only filed or closed something
in `docs/work/` ran no frontmatter check at all. This branch is **not** an
instance — it also touches `tools/downloader/docs/` and `tools/planner/docs/`,
which the old filter matched — but a repo-ticket-only pull request is an ordinary
shape here and would have been silent. The new filter names both directories. Found while pruning the triggers; unrelated to
the deletion and fixed in passing because the fix is one line.

**What was folded in before deleting.** Each `## Running things` was diffed
against that tool's `CLAUDE.md` `## Commands`, and the overlap was near-total —
which is the point. Genuinely unique, and moved:

| Fact                                                                   | Now in                       |
| ---------------------------------------------------------------------- | ---------------------------- |
| `VITE_API_MOCK=false` is what `web/.env.example` sets                  | `tools/downloader/CLAUDE.md` |
| The Vite dev server proxies `/api`, so dev is same-origin with no CORS | `tools/downloader/CLAUDE.md` |
| The no-browser / no-yt-dlp fixture invocation, and `SSRF_ALLOW_HOSTS`  | `tools/downloader/CLAUDE.md` |
| `RATE_LIMIT_*_PER_MINUTE=0` for a load test, and only that             | `tools/downloader/CLAUDE.md` |
| The e2e suite keeps its own database under `e2e/.artifacts/`           | `tools/planner/CLAUDE.md`    |
| It starts the API itself — nothing has to be running first             | `tools/planner/CLAUDE.md`    |
| The image gate asks for both `/api/health` and the page                | `tools/planner/CLAUDE.md`    |

`npx vitest run <package-dir>` went to the **root** `CLAUDE.md` instead, and
that is a judgement call worth naming: it is a repo-wide invocation that the
downloader's page happened to be the only home for, and putting it under one
tool would have made a generic fact look tool-specific — the exact thing the
root page's "do not restate" rule exists to stop.

Verified as **not** unique before dropping: both dev-tooling traps (npm's serial
workspace scripts, `tsx watch` never binding on Windows) are in
`tools/downloader/CLAUDE.md` in a fuller form; the port rationale is in
`tools/planner/CLAUDE.md`; the mock default is in both `CLAUDE.md` and
`web/.env.example`. And the drift the brief predicted was real: the downloader's
page said `npm run dev`, its `CLAUDE.md` says `npm run dev:downloader`. Nothing
could have told a reader which was right.

**The sweep, and a distinction the brief did not draw.** `git grep -n
"03-STATUS"` unfiltered, no path filter — repo-1's mechanical lesson. Every
non-ticket hit was repointed or is new prose. Historical hits in closed tickets'
`Why`, `Log` and `Review` sections stay, as records. **But nine of them were
markdown _links_**, not mentions — `[03-STATUS.md](../03-STATUS.md)` in `dl-8`,
`dl-11` (×2), `dl-12` (×2), `dl-13` (×2), `dl-14` and `pl-21` — and a dangling
link is a different object from a dangling mention: a reader who clicks it gets
nothing and cannot tell whether the record is wrong or the file moved. Those
nine are now plain code spans. The sentence around each is byte-unchanged, so
the record is intact and the target is gone. 328 relative markdown links across
the repo, 0 missing.

**One instruction to future work was repointed**, `dl-16`'s acceptance line —
the only open ticket that cited the page. `dl-15`'s several citations are in its
`Review` and `Log` and it is closed, so they stayed.

**`docs/adr/004:177` was triaged and left.** Its consequence bullet says
"Nothing here touches a `<!-- generated:tickets -->` region — see 003". It is a
dated record of what that decision's scope was, it remains true, and 003's
header now says its mechanism is superseded, so a reader following the pointer
lands on the amendment. Rewriting it would be revisionism for no gain.

**The sweep must not be anchored to one term either, and that is the third time
this class has bitten.** repo-1 learned across three rounds that the sweep must
not filter by _file type_ — `.env.example` survived two of them. This round found
the seventh dangling citation with the filter removed and the **term** still
fixed: `package.json:35`'s `"// status"` annotation advertised `--write` as
usable, one line above the `status` script itself, and no `git grep 03-STATUS`
could ever have seen it, because the ADR's filename is lowercase `status-page`.
So the sweep is **two** passes now: the term, unfiltered; then **the other names
of the thing** — `--write`, `--check`, `status-page`, `generated region`,
`status page`, `dashboard`, and the spine listing's word `status`. The second
pass found `package.json:35` and one more the first could not: root `CLAUDE.md`'s
Layout block, which described a tool's `docs/` as "analysis, architecture,
roadmap, status, tickets". Every remaining hit is either an ADR link, a `done`
ticket's Log, or `oxfmt --check`.

**`--markdown` links repo-root-relative.** The old region's links were relative
to a `03-STATUS.md` sitting beside `work/`; there is no such page, and the
destination is a pull request body or a message. Repo-root-relative is what
resolves in both an editor opened at the root and a GitHub comment.

**dl-17's gate was reconstructed, and the range matters.** `d007f27` is the
_first_ commit on that branch, so the transcript gate the orchestrator supplied
(543 tests / 37 files) is gate 1, before the review round that added
`api/test/not-found.test.ts` and took it to 545/38. The section says so, says it
was recovered rather than recorded, and deliberately back-fills **no acceptance
table** — composing one now would invent a traceability link nobody made, which
is what repo-1's own gate 4 declined for the same reason. Every factual claim in
the transcript gate was re-checked against the tree before transcribing it:
`NOT_FOUND: 404` in `http-errors.ts`, four sites still raising `JOB_NOT_FOUND`,
`path` absent from `CLIENT_SAFE_DETAIL_KEYS`, both codes handled in
`error-presentation.ts`.

**Gates.** `npm run check` exit 0. `npm test` 97 files / 1366 tests, all green —
`scripts/test/status.test.ts` went from 21 tests to 27: three region tests
deleted outright (`replaceRegion` round-trip, no-markers, markers-reversed), two
rewritten against what replaced them, and **nine added** — three for
`describeTicket`, one more for `renderMarkdown`, and five driving the CLI itself,
which repo-1's gate 4 recorded as having no test at all. Slow
gates unrun, as always locally: no e2e suite and no container build, and neither
tool's image is touched by this change.

**2026-08-23 — gate 1: one med, five lows, all fixed.** Recorded in `## Review`
above. The med is the one worth reading, and it is a method finding wearing a
one-line fix: `package.json`'s `"// status"` annotation was the **seventh**
dangling citation, and no amount of unfiltering `git grep 03-STATUS` could have
reached it, because the ADR it pointed at is named `status-page`. repo-1's lesson
was "do not filter the sweep by file type"; this one is "do not anchor it to one
term". Both are now in the entry above, and the second pass caught a hit of its
own — root `CLAUDE.md`'s Layout block, which still listed a tool's `docs/` as
carrying "status".

Finding 4 is the one I would have argued about and should not have. Build step 6
of this very ticket says ADR 003's Context and Decision stay byte-unchanged, and
I then inserted an eight-line blockquote into Decision. Nothing was deleted and
the insertion was labelled, so the record survived — but a rule I wrote in the
same file two screens up was not true of what I did, and "close enough, and
labelled" is exactly the reasoning that lets an annotation become an edit.
`## Decision` is now byte-identical to `origin/main`; the content is a
`## Consequences` bullet, and a Decision reader is warned by a blockquote under
the header before they reach the two paragraphs that did not hold.

**2026-08-23 — post-gate: the workflow was a symptom, so it is deleted and the
cause is fixed.**

**The comment I wrote to justify keeping `status.yml` is what killed it.** Build
step 5 asked for the workflow pruned to one job "and keep the comment explaining
why this is its own workflow rather than a job in `ci.yml`". The explanation was
that `ci.yml` carried `paths-ignore: ["**.md"]`, so a documentation-only pull
request — a ticket filed, a ticket flipped to `done` — never ran it, which is
exactly the pull request whose frontmatter needs parsing. That is true, and it
is a description of a bug, not a premise. `npm run check` runs `oxfmt --check`,
and **oxfmt formats markdown in this repository** — the proof is one line of
`.oxfmtrc.json`, which has to name `**/CHANGELOG.md` in `ignorePatterns`
precisely because it does. So a markdown-only pull request could break
`npm run check` with nothing in CI to catch it: green-because-skipped on the way
in, and the next pull request to touch code goes red for a reason that has
nothing to do with it. `dl-18` hit it this morning — oxfmt reflowed a wrapped
`> 0` into a blockquote — and it was caught only because an agent happened to
run `format` locally. Fix the cause and `status.yml` has nothing left to be, so
it is gone and its one step is a step of `check`.

**The shape: a `changes` job, because Actions has no per-job `paths`.**
`paths-ignore` gates the whole workflow, so there is no way to leave `check`
unfiltered while `test` stays filtered by editing the triggers. The triggers now
filter nothing, and a `changes` job diffs base against head and outputs
`code=true|false`; `test` carries `needs: changes` and
`if: needs.changes.outputs.code == 'true'`. The rule it applies is byte-for-byte
the one the trigger filter applied — if every changed path ends in `.md`, skip —
so the matrix's cost is unchanged and only `check`'s blast radius moved. Written
as a dozen lines of shell rather than a marketplace action: this repo writes
`commit-message.mjs` and `status.mjs` for the same reason, and the alternative
is an unpinned third party holding a checkout. It is not a `scripts/*.mjs`
either, because nothing outside CI would ever call it and it would then need a
suite and a tsconfig reference to say what a `git diff` already says.

**The two events need different bases, and everything without one runs the
matrix.** `pull_request` diffs `event.pull_request.base.sha...head.sha`; `push`
diffs `event.before...github.sha`. Three dots on purpose — what the branch added,
not what `main` moved past underneath it, which is the comparison GitHub's own
filter makes. `schedule` and `workflow_dispatch` have no base at all, a first
push has the all-zero sha, and a rewritten history can simply be missing the
commit; each falls through to `code=true`. **Both** shas are proven present with
`git cat-file -e` before the diff, and that is not belt-and-braces: a `changes`
job that errors out would skip `test` through its own `if:`, which is the one
outcome this whole shape exists to prevent. Exercised locally against real
ranges before pushing — `1d3efff` (one `.md`) gives `code=false`, `4fcd133`
(a `.tsx` suite) gives `code=true`, and all four degenerate bases give `true`.

**The no-required-checks claim was re-verified, and it holds.** `ci.yml`'s
comment asserted that "the ruleset on `main` requires no status checks, so a
skipped workflow cannot leave a pull request pending forever". That sentence now
has to be true of a skipped **job**, which is a different thing, so it was
checked rather than inherited. `gh api repos/brunolabbe/tools/rulesets` returns
one active ruleset, `main`, on `~DEFAULT_BRANCH`, with exactly three rules:
`deletion`, `non_fast_forward`, and `pull_request` with
`required_approving_review_count: 0`. There is **no `required_status_checks`
rule**, and `gh api repos/brunolabbe/tools/branches/main/protection` answers
`404 Branch not protected`, so there is no classic protection carrying one
either. A skipped `test` therefore blocks nothing. The comment in `ci.yml` now
carries the date it was read and the warning that follows from it: if a required
check is ever added, `test` cannot be one under this shape, because a required
check that never reports blocks the merge forever — a worse bug than the one
being fixed here.

**`push` loses the filter too, and that was the live question.** A filtered
`push` would have been defensible — the pull request already gates the merge —
but the merge that puts an unformatted `.md` on `main` is a documentation-only
squash, and under a filtered `push` the first run to notice is the next
unrelated pull request. That is the exact failure this change exists to stop,
one step later. So `push` runs `check` too and pays a sub-minute job per docs
merge; the matrix still skips, because `changes` gates it on both events alike.

**The sweep, run on the other names again.** `paths-ignore`, `**.md`,
`status.yml`, "documentation-only", "on every push". Four live hits and one
false alarm. `downloader.yml` and `planner.yml` already carry `"!**.md"` inside
their `paths` — the correct shape for a slow gate, untouched. The three that
needed a change: `ADR 003`, root `CLAUDE.md`, and the test comment below.

**ADR 003 was extended, not re-amended.** Its `## Decision` says the frontmatter
check "has a workflow of its own on purpose", and the purpose named is
`paths-ignore`. That paragraph is a record and stays byte-unchanged — Build step
6, and gate 1's finding 4, which is the one I had already got wrong once. The
existing `## Amendment — 2026-08-23` gains a paragraph, and the blockquote under
the header now says **three** of Decision's paragraphs are superseded rather
than two, naming the third.

**Root `CLAUDE.md` said "CI runs lint, typecheck and every unit suite on every
push"**, which was the sentence a reader would have trusted before running
`format` on a docs-only branch. It now says `check` is filtered by nothing,
markdown included, and why — and that the matrix still skips an all-`.md`
change, through `changes` rather than a trigger. `tools/planner/CLAUDE.md`'s "the
unit suite runs on every push" was left: it is a claim about that suite's
coverage, and it is no less true than it was.

**One stale comment found in a test.** `scripts/test/status.test.ts`
said "CI skips `**.md`, so a documentation-only pull request never reaches this
suite — `status.yml` runs the same walk". Half of that is still true and it is
the half that is easy to get wrong: the **matrix** is still skipped for a
markdown-only change, so this vitest suite still does not run on a ticket-only
pull request. What covers that case now is `check`'s `status.mjs --json` step,
which is the same walk without vitest around it. The comment says so.

**Gates.** `npm run check` exit 0. `npm test` 97 files / 1366 tests, all green —
unchanged from gate 1, as expected: nothing in this addition touches a suite's
subject, only a comment in one. All seven workflow files parse (`js-yaml`,
loaded from outside the tree so as not to touch the lockfile); `ci.yml` resolves
to jobs `check`, `changes`, `test`, with `test.needs = changes` and its `if` as
written, and `check`'s steps ending in `node scripts/status.mjs --json >
/dev/null`. `.github/workflows/status.yml` is deleted; `grep -rn "status\.yml"`
over the repo returns only records — this ticket, `repo-1`, `adr/003` — plus the
`ci.yml` comment that explains where it went.

**2026-08-23 — post-gate, second: four more into
`.claude/skills/orchestrate-tickets/SKILL.md`.**

Build step 8 was written mid-batch and the batch kept teaching. Each of these
came out of this session **after** that step landed, and one of them corrects
advice the skill already gives.

**The one worth reading is a gate instruction, and it is the reason this ticket
exists.** `repo-1` passed **four** gates while resting on a mechanism that had
never once run: every gate verified its code against its ticket, and not one
asked whether the workflow the ticket depends on actually works. It did not, so
both pages it maintained were stale on `main` the whole time, one of them hiding
a `ready` security ticket. So `## Dispatching a gate` now says: when a ticket
rests on machinery — a workflow, a scheduled job, a hook, an external service —
one gate must confirm the **machinery runs**, by reading its run logs, not that
the code calling it is correct. A green pull-request check and a working
mechanism are different claims, and reading the diff cannot tell them apart.
Placed there rather than in `## After a merge`, which already carries the same
evidence for a different actor at a different time: that section tells the
orchestrator to look at `main` afterwards, this one tells a reviewer to look
before. The bullet points at it instead of restating the `GH013` story.

**A correction, not an addition: `## Worktree hygiene` was incomplete.** It says
remove each worktree as its PR opens, which is right for disk and silently kills
the agent's resumability. Hit within the hour of writing it — a follow-up to
this ticket's builder was refused with _its worktree no longer exists_, and the
context had to be rebuilt by hand into a fresh agent. The rule keeps its
caveat now: remove once the ticket is _finished_, not once its PR is open, and
if you remove early, know you are buying disk with a re-dispatch.

**`## Verification traps` gains the general form of its own lesson.** It already
says the sweep must be an unfiltered `git grep`, no `--include`. This ticket
found two hits that no `git grep` on the filename could reach however
unfiltered, because they named the subject without naming the file:
`package.json`'s annotation advertising `--write`, and root `CLAUDE.md`'s Layout
block listing the page by its bare noun. So: unfilter the file type **and** sweep
the other names — the flag, the script, the ADR slug, the bare noun. Three
instances of the class across two tickets, each from an angle the last fix did
not cover, which is what a non-generalising fix looks like from the outside.

**`## Decisions` gains a timing rule.** `## Concurrency` already forbids running
two tickets over one seam; what went wrong was _when_ the question was asked.
`pl-25` and `pl-27` collided, and the decision brought to the user was how to
reconcile them — never whether to run them concurrently at all. By then both
were half-built and every option was bad; three rebases followed. The overlap is
cheap to see at intake and expensive to see after dispatch.

**Judged as already covered and skipped:** nothing. The closest call was the
gate instruction against `## After a merge`, resolved by cross-reference rather
than by a second telling.

**Gates.** Skill prose, so no suite is its subject. `.oxfmtrc.json` ignores
`.claude/`, so `npm run format` does not reach the file — verified rather than
assumed, since the alternative is a silently unformatted commit. `npm run check`
exit 0 and `npm test` 97 files / 1366 tests green after both post-gate
additions together.

**2026-08-23 — gate 2: PASS, five lows, and the one that mattered was a git
default I did not know I was relying on.**

**Rename detection defeats the skip rule.** `git diff --name-only` has it on by
default and reports a rename as its **destination only**, so
`git mv src/foo.ts docs/foo.md` lists `docs/foo.md` and nothing else — every
path ends in `.md`, `non_md` is empty, and the matrix skips a change that
deleted a TypeScript file. Reproduced in a throwaway repo before and after:
`--no-renames` lists both paths and `src/foo.ts` fails the test. Both diffs
carry it now. This is the shape of defect the ticket is about, one layer down —
a guard that looks like it runs and does not, on the one input it exists for.

**And it cost the header a claim.** I had written that the `changes` rule is "the
one the trigger filter used to express, unchanged". The reviewer could not
establish what GitHub's own filter does with a rename — the API reports
`filename` and `previous_filename`, and whether path filtering consults the
latter is undocumented — so "unchanged" was a claim I had no way to check. It now
says close-to rather than identical-to, and names the rename case as the place
the two may differ. Softening it costs nothing; leaving it would have been a
second-hand assertion in a comment written to be trusted.

**A comment that overstated its own mechanism.** I wrote that the `cat-file`
guards exist because a failing `changes` job "would skip `test` through its
`if:`". True in the narrow sense and misleading: a failed job sets the run's
conclusion to `failure`, so the skip is red and nobody merges past it silently.
What the guards actually buy is the **degenerate base** falling open — the only
path by which a change gets skipped for a reason nobody chose. The reviewer
added the half that strengthens it: `set -euo pipefail` means an unguarded first
`git diff` aborts the job if git fails, so the second diff's `|| true` cannot
turn a git failure into an empty `non_md` and a skip. Both are in the comment.

**I stacked a correction under the thing it corrected.** `SKILL.md` still said
"remove each worktree as its PR opens" six lines above my new paragraph saying to
wait until the ticket is finished. A reader who stops at the two-rule list — which
is how a two-rule list is read — gets exactly the advice the paragraph exists to
undo. The bullet itself now carries the rule. Worth naming because that file's
own `### Do not cap the gate count` cites "a process document contradicting
itself in adjacent sentences" as a real gate find, and I reproduced it in the
file that records it.

**The test comment was precise about one test and quiet about two.** It described
what `check` covers for the parse test above it, and left a reader believing the
file was handled. It is not: `no tool keeps a status page` — the regression guard
**this ticket added** — never runs on a pull request that re-adds a
`03-STATUS.md`, because such a pull request is by construction all markdown. Now
a section comment that lists covered and not-covered explicitly. Pre-existing and
not fixed here: the fix is to run the matrix, and that trade is argued in
`ci.yml`'s header rather than settled by a second workflow.

**And a Done-when line I rewrote instead of annotating**, while the Build steps
beside it carry `_(Amended after gate 1…)_`. Same form now, quoting the original.
Small, and the same class as gate 1's finding 4: a record edited to match what
shipped stops being a record.

**The reviewer checked the ruleset by an endpoint I had not.**
`gh api repos/{owner}/{repo}/rules/branches/main` folds in inherited
**organisation** rulesets, which `/rulesets` on the repository alone does not
show. Same three rules, no required status check, so the claim holds on the wider
reading — but I had verified the narrower one and written it up as settled.

**Gates.** `npm run check` exit 0. `npm test` 97 files / 1366 tests, all green.
`npm run format` clean. All seven workflow files still parse; `ci.yml` still
resolves to `check`, `changes`, `test` with the gate intact. The `changes` shell
re-exercised after `--no-renames`: a rename from `.ts` to `.md` now yields
`code=true`, a real `.md`-only range still `code=false`, a real code range still
`code=true`, and all degenerate bases still `true`.

**2026-08-23 — post-gate, third: a worktree symlink farm, in
`.claude/skills/orchestrate-tickets/SKILL.md`.**

Arrived with gate 2 rather than from it. Every agent in this session paid
`npm install` plus `npm run build` in a fresh worktree before it could read a
single test result — minutes each, across two dozen agents. The install half is
avoidable: a **selective symlink farm** off the shared checkout's `node_modules`
builds in **0.24 s** and costs **28 KB** against 342 MB. The build still runs.

Re-verified here rather than transcribed, because guidance that is wrong is
worse than none:

- The farm resolves correctly. Built into a stub worktree carrying a marker file
  at `tools/planner/api/`, `readlink -f node_modules/@planner/api` lands **inside**
  the stub and `cat`ting the marker returns it. 248 entries, `.bin` among them.
- **Wholesale-symlinking `node_modules` is silently wrong**, which is the trap
  worth the words. npm writes workspace links relatively —
  `@planner/api -> ../../tools/planner/api` — and a relative link resolves from
  where it _physically_ lives, so under a wholesale link `@planner/api` resolves
  to `/workspaces/tools/tools/planner/api`: the **shared checkout**. An agent
  editing a contract would typecheck and test against another tree's version of
  it. Stale exports, green suite, wrong code, nothing in the output saying so.
  Reproduced, and that resolved path is the evidence.
- **Hard links are not the escape.** `node_modules` is its own mount here
  (`/dev/sdc`, against `/dev/sdd` for the repo), so `cp -al` fails on the first
  file with `Invalid cross-device link`. Reproduced.
- **`.bin` is a dotfile**, so a `*` glob drops it and every binary the scripts
  call with it. `ls -A`, not `*`.

Written as guidance with the reasoning rather than a script to paste: the mount
layout is this container's, while the relative-link rule is npm's and will
outlive it. The section ends by saying to verify a farm with `readlink -f` and
one real suite, because the failure mode is quiet by construction.
