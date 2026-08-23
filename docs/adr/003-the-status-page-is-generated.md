# 003 — The status tables are generated from the tickets

**Status:** accepted · **Date:** 2026-08-22 · **Affects:** every tool

## Context

[001](./001-per-tool-docs-and-tickets.md) split work out of a 523-line status
document and gave each ticket one file carrying its brief and its log. It left
`03-STATUS.md` behind as "a dashboard, not a log". The downloader's page still
says so in its own second paragraph — _if you find yourself writing a paragraph
here, it belongs in a ticket_ — and the planner's is 397 lines of paragraphs.
Thirty-seven commits have touched it, which is very nearly every pull request
the tool has had.

The page holds three kinds of content, and only one of them is authored.

**Derivable state.** The phase table, the open-ticket table, the test count,
"Last updated". Every one is a projection of what the tickets already record in
frontmatter, restated by hand. Every branch rewrites the same rows, so every
branch conflicts — and the worse case is the one that does not. A branch cut a
few days ago carries the whole table as it was, so merging it silently restores
every row that moved since. The file still parses and the statuses are all still
words, which is why `CLAUDE.md` had to carry a standing instruction to rebase
before merging anything that touches one.

It has already happened. On `main` today, `pl-21`, `pl-22` and `pl-23` are
`done` in their frontmatter and `ready` in the table three lines below —
three merged pull requests that updated one and not the other. The open pull
request for `pl-24` edits the phase table and the test count and leaves its own
row in the ticket table saying `ready`. Nothing is wrong with any of that work;
the table is simply not something a person can be expected to keep.

**Narrative.** "Pinning is proven across the middle as of pl-19", "the image's
workspace list is no longer kept by memory". Each of these belongs to exactly
one ticket and is that ticket's Log, restated a second time in a file every
other branch is also appending to. The rule that this content lives in the
ticket is already written down; the page is where it goes when the rule is not
enforced.

**Static orientation.** What the tool is, how to run it, which ports. This part
has never conflicted and never will.

## Decision

**A ticket's frontmatter is the only place its state is recorded.** `id`,
`kind`, `status`, `milestone`, `depends_on`, and an optional `note` for when a
title reads badly in a column. An agent moves a ticket to `done` by editing the
ticket, in the same commit as the code — the change is reviewed in the diff that
earned it, and it travels with the branch.

**`scripts/status.mjs` is a lens over that, and stores nothing.** It parses
every `tools/<tool>/docs/work/*.md` and prints, emits JSON, answers "what is
ready and unblocked", or renders the markdown region. It is computed fresh on
every run, so it cannot disagree with git: it _is_ git.

```bash
npm run status                # open work per tool, with what blocks each
npm run status -- --ready     # ready, and nothing open in its depends_on
npm run status -- --json      # the same data, for an agent
npm run status -- --prs       # fold in `gh pr list`, which no ticket file knows
```

**The generated tables live between markers in `03-STATUS.md`, and only `main`
writes them.** `.github/workflows/status.yml` runs `--write` after a merge and
pushes the result. A branch never touches the region, so only one side of any
merge ever changes it, and there is nothing to conflict.

**A pull request that edits the region fails.** `--check` compares the branch's
region against the base commit's and refuses a difference. The same workflow
parses every ticket, which is the only thing in CI that does.

**That check has a workflow of its own on purpose.** `ci.yml` carries
`paths-ignore: ["**.md"]`, so a documentation-only pull request — a ticket
flipped to `done`, a ticket filed — runs none of it. That is precisely the pull
request this needs to gate, so a job in `ci.yml` would be silent in the only
case it exists for.

**No store between the tickets and the projection.** Considered and rejected
below; it is the thing 001 removed.

## Alternatives considered

**A local database that agents query and update.** The obvious shape, and wrong
here for three reasons. A write to it does not travel with the branch, so the
status change never reaches `main` — the pull request is what carries work here.
It is not reviewable: a transition in frontmatter appears in the diff beside the
code that justifies it, and a row in a store appears nowhere. And work happens
in per-ticket worktrees, so it would be either an empty database per worktree or
one shared store written across branches, which is the conflict problem again in
a place git cannot help. Forty-six markdown files parse in milliseconds; there
is no scale problem here to buy a store with. If reading them ever does become
slow, the answer is a gitignored cache, never an authority.

**`.gitattributes` with `merge=union`.** One line, and it makes the failure
worse rather than better: union on a table yields two rows for the same ticket
with different statuses, which reads as plausible. The whole problem is a file
that stays valid while becoming untrue.

**Convention alone** — "a branch does not edit `03-STATUS.md`; a follow-up
commit on `main` does". Free, and it is exactly what `--check` enforces. Rejected
as the whole answer for the reason 002 gives: an unenforced convention drifts,
and here there is no author who will notice.

**Generating the entire page.** Tempting, and it would delete the file's last
hand-written line. Rejected because the orientation paragraph is the one thing
on the page a reader actually needs and no projection can write it. A page that
is entirely generated is a page nobody reads.

**GitHub Issues, again.** Answered by 001 and unchanged: two sources of truth is
worse than either one.

## Consequences

- **The narrative is migrated, and the pages are what is left.** Done on
  2026-08-22, in [repo-1](../work/repo-1-generated-status-tables.md)'s second
  half — deliberately not in the same change as the tables, because `pl-24`'s
  pull request was open against those exact lines. What survives on a
  `03-STATUS.md` is the generated region, a table saying where each kind of fact
  goes instead, and "Running things". The phase table went (the roadmap defines
  phases; the generated rollup counts them), the test count went (CI asserts it
  on every push and prose cannot), and the gap list went: a gap worth recording
  is a ticket worth filing, and the tables list those. Exactly one gap on either
  page had no ticket and needed one filed — ffmpeg not verifying TLS, now
  `dl-19` — which is the rule working rather than an exception to it. Almost
  every narrative
  paragraph turned out to be already present in its ticket's Log verbatim, which
  is the second copy this ADR predicted — only three facts in the repo had no
  other home. Two moved to the tickets that own their subject, `dl-5`
  (`Job.attempts` semantics) and `dl-6` (the limiter is per-process); the third,
  the planner's "the documentation leads the code by one phase", is a warning to
  the reader of the design documents and became `01-ARCHITECTURE.md`'s opening.
- **Roughly eight source comments cite `03-STATUS.md` as the home of a fact** —
  `guarded-fetch.ts`, `dispatcher.ts`, `orchestrator.ts`, `pipeline.test.ts`.
  They should point at the ticket, which is a more stable anchor than a
  paragraph in a page being emptied. Part of the same follow-up.

  _Outcome, 2026-08-22: four, not eight — the four files named here carried one
  citation each rather than the two apiece this assumed, and each now points at
  the ticket or the code that holds the fact._ The estimate is annotated rather
  than corrected in place: an ADR that rewrites its own prediction to match the
  result stops being a record of what was believed when the decision was taken.

- **Six citations outside the source were about to become false**, and a grep
  over `*.ts` finds none of them. Two closed tickets' Logs asserted the page
  carries a fact _today_ (`dl-12`, `dl-14`); two **open** tickets' acceptance
  criteria instructed future work to edit a section that would no longer exist
  (`dl-15`, `dl-16`); `docs/02-DEPLOYMENT.md` sent an operator hardening a shared
  instance to the page to read the rate limiter's scope; and `.env.example` sent
  one setting `PROXY_URL` there to read why address pinning turns off. All six
  now state the consequence inline and link the ticket that holds the reasoning.

  **The lesson, and it has a mechanical half.** The citations that matter are the
  ones a compiler and a grep over source both miss — and the way to find them is
  a bare `git grep -n 03-STATUS` with **no `--include` and no path filter**. Each
  of the two rounds that missed one had filtered by extension first: the first
  swept `*.ts`/`*.tsx` and found four, the second added the markdown and missed
  `.env.example`, which is neither. An emptied page is cited from workflows,
  env templates, Dockerfiles and READMEs, and the filter that makes the sweep
  fast is the same filter that makes it wrong. Sweep unfiltered, then triage.

- **`docs/work/` now exists, and ids there are prefixed `repo-`.** 002 said the
  signal to create it would be "a third piece of repo-wide work with nowhere to
  live", after `dl-10` and `pl-2` had to carry the release pipeline between
  them. This is it.
- **The regenerating job pushes to `main` directly.** If a ruleset ever requires
  a pull request to write there, that job fails, and the fix is to open one
  rather than to let it pass — a status page that silently stops updating is
  worse than the hand-written one it replaced.
- **`status.mjs` is the first thing in the repo that reads ticket frontmatter at
  all.** It is strict on purpose: an unknown field, a status outside the
  taxonomy, an id that disagrees with its filename or a `depends_on` pointing at
  nothing is a named failure rather than a row quietly missing from a table.
  Forty-six existing tickets pass it unchanged, which is the only reason the
  strictness was affordable.
