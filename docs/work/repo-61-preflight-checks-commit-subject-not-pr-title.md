---
id: repo-61
tool: repo
title: preflight checks the tip commit's subject, not the pull request title
kind: fix
status: ready
milestone: null
depends_on: []
---

# repo-61 — preflight checks the tip commit's subject, not the pull request title

## Why

Preflight's title check is meant to validate the pull request title that will
land as the commit on merge — a squash merge uses that title for the commit
message. When a branch has two commits with different types (`fix(repo): ...`
then `feat(repo): ...`), preflight should check the PR title but instead checks
the tip commit's subject, causing a builder to fail `--base origin/main`
unexpectedly even when the PR title is valid.

## Build

Locate the code in `scripts/preflight.mjs` that reads the subject for the title
check. It presently reads the tip commit when `--title` is not passed:

```javascript
const subject = title ?? run("git", ["log", "-1", "--format=%s"], { cwd: repo }).trim();
```

(from `scripts/preflight.mjs:443`)

Determine what the correct source should be, how to obtain it, and implement the
fix. The reproduction shows the bug: a branch with a first commit `fix(repo): ...`
and a tip commit `feat(repo): ...` passes preflight if run with the branch's head,
because the tip subject type matches the diff paths; but a PR titled `fix(repo): ...`
should pass and a PR titled with `feat(repo): ...` should fail based on the
paths, not the tip commit.

## Done when

- Preflight's title check reads the pull request title (passed via `--title`)
  when available, not the tip commit's subject
- Preflight called without `--title` on a multi-commit branch reports the
  correct title type from the PR, not from the tip commit
- All existing tests pass

## Log

- 2026-09-27: Filed from account item 10 of the 2026-09-26 batch close-out.
  Relayed from dl-70's builder; verified by reading the line that picks the
  subject.
