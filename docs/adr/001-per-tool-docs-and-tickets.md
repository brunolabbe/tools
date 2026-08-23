# 001 — Documentation and tickets live under the tool

**Status:** accepted, amended in part by [003](./003-the-status-page-is-generated.md) · **Date:** 2026-08-14 · **Affects:** every tool

## Context

`docs/` was written when there was one tool. All five files were the
downloader's: the architecture document opened with "every package named below
lives under `tools/downloader/`", the roadmap's phases were its phases, and
WP-1…WP-7 were its work packages. When the planner landed there was nowhere for
the same material to go except the same directory, which is how two tools that
share nothing but a toolchain start sharing a plan.

Work was also spread across three files per package — a row in the roadmap's
phase table, a brief in `03-AGENT-BRIEFS.md`, an outcome in `04-STATUS.md` —
with nothing keeping them in sync. The status document had grown to 523 lines
absorbing all three roles.

## Decision

**Per-tool documentation moves under the tool**, with a fixed spine
(`00-ANALYSIS`, `01-ARCHITECTURE`, `02-ROADMAP`, `03-STATUS`, `work/`). `docs/`
keeps only what is true of the repo. This mirrors the split the `CLAUDE.md`
files already make.

**A ticket is one file** in `tools/<tool>/docs/work/`, carrying its brief and
its log together — see [01-TICKETS.md](../01-TICKETS.md). The roadmap links to
tickets instead of describing work; the status document becomes a dashboard.

> _Amended by [003](./003-the-status-page-is-generated.md), 2026-08-22._ "Becomes
> a dashboard" is where that word enters the repo, and it turned out to be the
> half of this decision that did not hold: a dashboard nobody generates is a
> dashboard everybody hand-edits, and both status pages accumulated phase
> tables, test counts and gap lists that every branch then rewrote. 003 makes
> the ticket tables generated from frontmatter and empties the rest of the page,
> so `03-STATUS.md` is now the generated region plus how to run the tool — see
> `docs/01-TICKETS.md` for what it keeps. The word is left standing here rather
> than corrected, because this is the record of what was decided in August 2026
> and the framing is the interesting part of the mistake.

Ids are prefixed per tool (`dl-`, `pl-`) so they survive being quoted outside
their directory.

## Alternatives considered

**GitHub Issues and Projects.** Buys a board, PR linkage and labels. Costs the
thing this repo is built around: agents read files for nothing and issues only
through `gh`, briefs stop being reviewable in the diff that implements them, and
plan and code can sit at different commits. Revisit when a second person joins —
and if so, mirror in-flight tickets only. Two sources of truth is worse than
either one.

**Keeping one `docs/` with tool-prefixed filenames.** Cheaper to do, and it
leaves the fusion pressure exactly where it was: shared files invite shared
sections, and a shared section is how `@planner/*` ends up importing
`@downloader/*` a year later.

## Consequences

- Sixteen files carrying `docs/0*.md` cross-references were rewritten, and
  twenty-two more had `WP-n` renamed to `dl-n` so every id in a comment resolves
  to a ticket. Those cross-references are worth keeping — they are how a
  resolver explains itself — so a future move of these files means the same
  sweep again.
- The root `README.md` is still the downloader's, which is now the most visible
  remaining place where one tool speaks for the repo. Splitting it is separate
  work, deliberately not bundled here.
