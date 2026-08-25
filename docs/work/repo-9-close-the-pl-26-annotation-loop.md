---
id: repo-9
tool: repo
title: Write the pl-26 outcome annotation repo-3 could not pay for
kind: chore
status: done
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

### 2026-08-24 — folded into repo-7's own pull request, and its Build step 2 was wrong

**Done, and not as a separate batch item.** The annotation is one line under one
finding; the brief around it was fifty-eight. A ticket whose entire deliverable
is a line does not earn a dispatch of its own, and this one was filed only
because repo-7's brief said not to widen — the note explaining that choice is
what made the cost visible. It was written on repo-7's branch instead, in the
pull request that documents the rule making it affordable, which is also the
only place a reader will be looking for it.

**What landed.** An `_Outcome, 2026-08-24:_` line under the `--show`-prints-
`unblocked` finding in `tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md`,
naming [repo-3](./repo-3-show-a-closed-ticket.md) and the commit that fixed it,
`3145934`. It quotes what `--show pl-26` prints today, taken from a run rather
than from repo-3's brief:

```
dropped — nothing to pick up (Deferred until the existence slice is filed — not refused)
```

Append-only, as Build step 3 required: `git diff --stat` on that file reports 10
insertions and 0 deletions, and the frontmatter and brief are untouched.

**Build step 2 was over-specified, and it was inherited rather than invented
here.** It said the pull request title "**must be `docs(planner): …`**". The
measurement says otherwise: what release-please tests is whether the title's type
is `hidden` in `changelog-sections`, and the scope is not consulted at all. This
annotation landed under `docs(repo): …` and released nothing — measured, not
assumed, on a scratch branch carrying exactly this commit shape:

```
❯ Backfilling file list for commit: 58b2764e4d800790874e1c47523a68034f4720f0
❯ Found 1 files
✔ Considering: 1 commits
✔ No user facing commits found since ece6ec0fc6410c3d19a92c120860f0982e3a396c - skipping
Would open 0 pull requests
```

The error came from repo-7's own wording — `03-RELEASING.md` said the annotation
"rides in a pull request titled `docs(<tool>): …`", which fixes both the type and
the scope where only the type is load-bearing. Both documents are corrected on
the same branch, and this ticket's Build is left as written: a brief records what
was believed when the work was dispatched, and the Log is where it is corrected.

**Kept rather than deleted.** The Why records why the annotation became
affordable and what unblocked it, which the one-line diff does not carry. Three
gate records on repo-7's branch also verify this file's frontmatter, its id and
its `depends_on`; deleting it would dangle all of that.
