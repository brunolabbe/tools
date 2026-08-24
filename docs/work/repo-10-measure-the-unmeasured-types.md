---
id: repo-10
tool: repo
title: Measure what a perf or revert commit actually does to a release
kind: chore
status: ready
milestone: null
depends_on: [repo-7]
---

# repo-10 — two sentences about `perf` are in tension, and neither was run

**Packages:** `docs`

## Why

[repo-7](./repo-7-changelogs-are-attributed-by-path.md) measured two types
through `release-please --dry-run`: a `fix` releases the tool whose path it
touched, and a `docs` does not, skipped with `No user facing commits found`. It
did not run `perf` or `revert`, and those two are the ones
[03-RELEASING.md](../03-RELEASING.md) says two different things about:

- `03-RELEASING.md`, under **Writing a commit**: _"A `perf:` commit on its own
  therefore releases nothing"_ — a claim about the **version bump**, and
  pre-existing.
- `03-RELEASING.md`, under **Annotating another tool's ticket**: the
  `No user facing commits` skip does **not** cover `perf` and `revert`, because
  neither is `hidden` in `changelog-sections` — a claim about the **skip**, added
  by repo-7 and measured only for `docs`.

They are reconcilable — release-please can decline to skip and still decline to
bump — but nobody has watched it do so. Both gates on repo-7 raised the gap and
disagreed on its severity; repo-7's answer was to stop enumerating types in the
operative rule and point at the config instead, which is correct whatever the
answer here turns out to be. This ticket is the measurement neither gate had.

There are **zero** `perf` and `revert` commits in this repository's history, so
nothing is broken today. What is at risk is the same thing repo-7 was about: a
sentence written down without being run.

## Build

1. Reproduce repo-7's harness, which is recorded with its commands under
   [03-RELEASING.md](../03-RELEASING.md#annotating-another-tools-ticket-without-releasing-it).
   A scratch branch off `main`, one commit, one file under `tools/planner/`,
   pushed to `origin`, run through
   `npx release-please@17.11.1 release-pr --repo-url=… --target-branch=<scratch> --dry-run`.
   All seven workflows are `push: branches: [main]` or have no `push` trigger at
   all, so a scratch branch costs no CI. **Delete the branch from `origin` as the
   next action after the run.**
2. Run it twice: once with a `perf(planner):` subject, once with `revert:`.
   Record whether release-please skips, and if it does not, whether the release
   pull request it would open carries a version bump and under which section.
3. Reconcile the two sentences above with what came back, in
   `03-RELEASING.md`, and paste the commands and their real output into this
   ticket's Log. If the two sentences turn out to be describing the same
   behaviour, say so in one place rather than two.
4. If `perf` or `revert` does open a release pull request, `CLAUDE.md`'s rule
   already covers it — it names the not-`hidden` set rather than `feat`/`fix` —
   so check that it still reads correctly and change nothing else.

## Done when

- The Log carries the two commands and their verbatim output.
- `03-RELEASING.md` says one thing about `perf` and `revert` where it currently
  says two, and what it says is what the runs showed.
- Anything still unmeasured after this — the five hidden types repo-7 assumed
  behave like `docs` — is named as unmeasured rather than quietly folded in.

## Log

_Not started. Filed from [repo-7](./repo-7-changelogs-are-attributed-by-path.md)
on 2026-08-24, whose two gates disagreed about whether this gap mattered._
