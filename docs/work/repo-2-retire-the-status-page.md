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
5. **`.github/workflows/status.yml`** — delete the `regenerate` job and the
   `--check` step. Keep the frontmatter-parse check on pull requests, which is
   the only thing in CI that reads tickets, and keep the comment explaining why
   this is its own workflow rather than a job in `ci.yml`.
6. **Amend, do not rewrite, `docs/adr/003`.** Its Context and Decision are a
   record of what was believed and stay byte-unchanged; a superseding note says
   the decision held and the mechanism did not. Extend `docs/adr/001`'s existing
   amendment rather than adding a second.
7. **Reconstruct `dl-17`'s missing gate**, labelled as reconstructed after the
   fact rather than transcribed at the time.
8. **Update `.claude/skills/orchestrate-tickets/SKILL.md`** with what the batch
   that produced this ticket taught after the skill was written.

## Done when

- Neither `tools/downloader/docs/03-STATUS.md` nor
  `tools/planner/docs/03-STATUS.md` exists, and nothing in the repo instructs
  future work to read or edit either.
- Every unique fact from both `## Running things` sections is in that tool's
  `CLAUDE.md`, and every command that survives is one that exists in
  `package.json`.
- `git grep -n "03-STATUS"` returns only historical references in closed
  tickets, this ticket, and the ADRs that record the decision.
- `node scripts/status.mjs` exports no region function and accepts no `--write`
  or `--check`; `--tool`, `--show` and `--markdown` each work and each have a
  test.
- `.github/workflows/status.yml` has one job, it runs on `pull_request` only,
  and it is `node scripts/status.mjs --json > /dev/null`.
- `npm run check` and `npm test` are green.

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
in `docs/work/` — this one included — ran no frontmatter check at all. The new
filter names both directories. Found while pruning the triggers; unrelated to
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
