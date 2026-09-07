---
id: repo-32
tool: repo
title: A done ticket can carry an obligation nobody can see
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# repo-32 — `done` can hide an outstanding obligation

## Why

**`npm run status` cannot tell "done, nothing left" from "done, but one
acceptance line waits on something nobody can do yet".** Both render as absent
from the board, because both are `status: done` and the board is computed from
frontmatter.

That second state is not an edge case and not a lapse. It is what a ticket looks
like when its last acceptance line names an observation that only exists **after
a merge** — a GitHub alert state, a hook firing on `main`, a workflow that its
own trigger filter keeps off every branch but the default one. The work is
finished and correctly gated; the proof is not available to the person finishing
it, by construction.

Today the only thing that closes such a line is somebody remembering. There is no
field, no board column and no command that surfaces it, and the ticket most
likely to need the reminder is the one that has just dropped off the board.

### The reproduction — three in one batch, not a hypothetical

1. **[repo-13](./repo-13-codeql-false-positives-recur.md)** closed `status: done`
   on 2026-09-01 with acceptance lines 5 and 8 **genuinely open** — not struck,
   no "Done" marker, both explicitly "deferred to the merge". They stayed open
   for six days and were answered only because
   [repo-16](./repo-16-suppression-does-not-dismiss.md) happened to be filed
   against the same subject. Nothing surfaced them in between.
2. **[repo-16](./repo-16-suppression-does-not-dismiss.md)'s `Done when` 6** —
   the state of a code-scanning alert after the change, read from the security
   tab. The dismissal step it depends on runs only on a push to `main`, so there
   is no "after" until the ticket merges, and `gh api` is denied in the
   development container besides. Filed `done` with the line marked outstanding.
3. **repo-15's hook** — cannot be observed firing until it is on `main`, for the
   same structural reason.

Three tickets, one batch, three different agents. The rate is the argument: this
is the normal end state of a certain kind of work, not an occasional slip.

**What makes it worth a ticket rather than a habit** is that the repo already
rejected "somebody will remember" as a mechanism.
[adr/003](../adr/003-the-status-page-is-generated.md) is the argument in full: a
projection kept by hand needs a writer, and every writer available here is a
person who will forget. An obligation recorded only in prose inside a `done`
ticket is exactly such a projection.

## Decision

**How should a post-merge obligation be recorded, such that something other than
memory surfaces it?** Three options, with what each costs. **This ticket
recommends option A** and does not settle it: the choice touches the ticket
schema, which is parsed strictly and gates CI, so it is not a builder's to make.

**A — an optional frontmatter field, surfaced by `npm run status`.** Something
like `awaiting: <what closes it>` on a `done` ticket, rendered as its own board
section and reported by `--json`. Recommended, because it is the only option that
makes the obligation _derivable_ rather than remembered, which is adr/003's own
test.

- Cost, and it is the real one: the frontmatter is **parsed strictly and gates
  CI**, and [repo-24](./repo-24-quoted-scalars-render-with-quotes.md) is the
  recorded instance of a parser change failing the board on sound work. A new
  field needs its validation, its render, its `--json` shape and a decision about
  whether an unclosed `awaiting` should ever fail anything.
- Second cost: a field nobody clears is a field that rots. Whatever is built
  needs an answer for "who removes it and when", or it becomes a second
  projection with the same defect.

**B — a convention, written into `docs/01-TICKETS.md`, with no mechanism.** A
`done` ticket carrying an open acceptance line must name it in a fixed form the
last Log entry can be grepped for. Cheap, in version control, and honest about
being a habit.

- Cost: it is the mechanism adr/003 rejected, wearing a style guide. Nothing
  fails when it is skipped, and the three instances above were each written by an
  agent that had read `01-TICKETS.md`.

**C — do nothing, and rely on the record's own closing sentence.** adr/005 ends
with "until somebody records that, this record describes a mechanism that has
been built and not seen to run", which is a genuinely good sentence in a
genuinely findable place.

- Cost: it works only for the reader who opens that document, which is the
  reader who least needs telling. Zero work, and it is the honest baseline.

## Build

**Startable: the decision is answered — option A, with the sub-decision in step
2 answered as "render only".** Both answers, and the costs that ruled the other
options out, are in the dated Log entry below; this section is not the record of
them. Whoever builds it should re-read the three instances first; two of them may
have closed by now, which changes the argument's shape but not its direction, and
a fourth arrived on 2026-09-07 (the Log entry names it).

1. ~~**Answer the decision**, with the owner.~~ **Done, 2026-09-07.** Option A,
   over B and C. Do not re-open it in the implementation.
2. **A, so:** add the field to `docs/01-TICKETS.md`'s field table, teach
   `scripts/status.mjs` to parse and render it, and implement the `--json`
   contract as answered: **an unclosed obligation is a rendered line and a
   `--json` field, never a `problem` and never a CI failure.** That
   sub-decision is settled — the reasoning is in the Log and it is not a
   builder's to revisit. What is still open and belongs to the builder is the
   shape, not the severity: the field's name in `--json`, where it renders on
   the board, and what an empty or malformed value does.
3. **Whichever:** amend `docs/01-TICKETS.md` where it says a ticket moves to
   `done` in the commit that earns it, since that sentence is the one that reads
   as though `done` meant nothing is left.

## Done when

1. The decision above is answered by the repo's owner, with the rejected options
   recorded alongside the cost that ruled each out.
2. If a mechanism is chosen, it is implemented, and **it is made to fail first** —
   a ticket carrying an unclosed obligation is shown to appear where the chosen
   mechanism says it should, before the mechanism is trusted.
3. The three instances in "The reproduction" are re-read at build time rather
   than trusted from this page, and their state recorded — an alert, a hook and a
   workflow are each claims about a commit, and `main` moves.
4. `docs/01-TICKETS.md` says what `done` does and does not promise.
5. `npm run check` passes and `npm run format` has been run, since this ticket's
   work is `.md` and `.mjs`.

## Log

- **2026-09-07** — Filed from repo-16's build, on the owner's decision to file
  rather than fold. The gap was surfaced by repo-16's **gate**, which named it
  and declined to resolve it; the builder carried it as an open decision, and the
  owner chose to file. Both agents agreed it should appear once, attributed to
  the gate that found it, which this entry does.

  The three instances were read from the ticket files on this branch, not
  relayed: repo-13's acceptance lines 5 and 8 read open at `origin/main@e9054c5`
  before repo-16 amended them, repo-16's `Done when` 6 is marked outstanding on
  its own page, and repo-15's hook is named by the orchestrator on the same
  terms as the other two. **repo-15's instance is the one fact here that was
  relayed and not checked** — its branch is unmerged and not visible from this
  worktree.

  `repo-32` was taken from `node scripts/next-id.mjs repo` (`next free: repo-32`,
  against both ticket roots and every open pull request's diff), not derived by
  hand. Its Log half is unchecked by that script; no `repo-3[2-9]` id appears in
  any Log or gate record reachable from this branch.

  No `## Review` heading, deliberately. A filing has no work to check, and
  `scripts/status.mjs`'s `hasGateRecord` matches the heading rather than the
  body — so an empty one would trip repo-12's `reviewed-but-ready` board check.
  repo-16's Log records that trap being sprung.

  Nothing implemented, and deliberately: the mechanism is the decision.

- **2026-09-07** — **Answered by the owner: option A**, and a second answer to
  the sub-decision Build step 2 was told to bring back. `status` moves to
  `ready`. **Nothing is implemented here, deliberately** — the owner held the
  implementation for its own batch, because this ticket is rated `hard` and the
  field it adds lands in frontmatter that is parsed strictly and gates CI.

  **A — an optional `awaiting` field on a `done` ticket, surfaced by
  `npm run status`.** That is this ticket's own recommendation, taken as filed.
  The costs it names are accepted rather than waived: the field needs its
  validation, its render, its `--json` shape, and an answer to "who clears it
  and when" or it becomes a second projection with the same defect adr/003
  rejected.

  The rejected options, with the cost that ruled each out:

  - **B, a convention in `docs/01-TICKETS.md` with no mechanism** — rejected as
    the mechanism adr/003 already rejected, wearing a style guide. The three
    instances in "The reproduction" were each written by an agent that had read
    that file.
  - **C, do nothing and rely on adr/005's closing sentence** — rejected because
    it reaches only the reader who opens that document, which is the reader who
    least needs telling.

  **The sub-decision, answered: render only. An unclosed `awaiting` never fails
  CI.** It is a rendered line and a `--json` field, and it is not a `problem`.
  The owner's reasoning, recorded because the shape of the implementation turns
  on it: these obligations are open **by construction** — the proof does not
  exist until after a merge — and the person holding one frequently cannot close
  it, so gating on it would block unrelated work for a reason nobody could act
  on. [repo-24](./repo-24-quoted-scalars-render-with-quotes.md) is the recorded
  case of a frontmatter parser change failing the board on sound work, and that
  is the failure mode a new field must not reintroduce. So this is a reminder
  and not a gate, and Build step 2 is answered: whoever builds it should not
  need to ask again.

  Recorded from repo-31's branch (`repo-31-windows-leg-non-blocking`, base
  `origin/main` at `4fad5f8`), which was the batch in which the owner answered
  both tickets. That branch touches nothing this ticket will touch —
  `scripts/status.mjs` and `docs/01-TICKETS.md` are untouched by it — so
  whoever picks this up starts from `main` with no dependency on it.

  **One thing for the builder, found while recording this rather than relayed.**
  repo-31 went `done` in that same batch carrying exactly the state this ticket
  describes: three claims in its Log that can only be checked once the branch's
  own CI has run — whether `if: failure()` fires under a job-level
  `continue-on-error`, whether the workflow still parses (there is no YAML
  parser in this repository's dependency tree, so it was reviewed by eye), and
  whether `main` still carries no `required_status_checks` (`gh api` is denied
  in the development container). That is a fourth instance, two days newer than
  the three above, and it is the one whose `awaiting` line a builder could write
  first to see the mechanism fail before it is trusted — `Done when` 2's
  requirement.
