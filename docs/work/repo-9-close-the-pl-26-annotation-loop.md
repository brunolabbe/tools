---
id: repo-9
tool: repo
title: Write the pl-26 outcome annotation repo-3 could not pay for
kind: chore
status: ready
milestone: null
depends_on: [repo-7]
---

# repo-9 — the annotation repo-3 wanted is now affordable

**Packages:** `docs`

## Why

[repo-3](./repo-3-show-a-closed-ticket.md) found the `--show`-on-a-closed-ticket
defect through [pl-26](../../tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md)'s
gate, which records it as a finding — _"not fixed, and out of scope … Being
surfaced separately; no ticket filed from here"_. The convention here is that the
loop closes with an `_Outcome, <date>:_` line under that finding, in the pattern
repo-6 used on ADR 003. repo-3 did not write it, because on the branch it had —
titled `fix(repo): …` — one `.md` file under `tools/planner/` would have cut the
planner a patch release whose only changelog line was about `scripts/status.mjs`.

[repo-7](./repo-7-changelogs-are-attributed-by-path.md) measured that, confirmed
it, and measured the way out: the **type** decides, not the scope, and a
`docs(<tool>): …` pull request carrying the same file releases nothing. So the
annotation is now affordable and nothing is stopping it except that nobody has
written it. It is left as its own ticket rather than folded into repo-7 because
repo-7's brief did not ask for it and its own commit was scoped to the rule.

## Build

1. Append an `_Outcome, <date>:_` line under the finding in
   `tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md` that surfaced the
   `--show` defect, naming
   [repo-3](./repo-3-show-a-closed-ticket.md) as where it was fixed and the
   commit that fixed it. Match the shape repo-6 used on ADR 003 rather than
   inventing one.
2. **The pull request title must be `docs(planner): … (repo-9)`.** That is the
   whole point of the ticket: a `fix` or `feat` title on this branch releases the
   planner off one `.md` file. The rule and its measurement are in
   [03-RELEASING.md](../03-RELEASING.md#annotating-another-tools-ticket-without-releasing-it).
3. Nothing else. Do not edit pl-26's frontmatter or its brief — a gate section is
   appended to, never rewritten.

## Done when

- The finding in `pl-26` carries its `_Outcome:_` line, naming repo-3.
- The pull request title is a `docs(planner)` conventional commit, checked with
  `node scripts/commit-message.mjs --text "<title>"`.
- `npm run check` is green (oxfmt formats markdown here).

## Log

_Not started. Filed from [repo-7](./repo-7-changelogs-are-attributed-by-path.md)
on 2026-08-23, which unblocked it._
