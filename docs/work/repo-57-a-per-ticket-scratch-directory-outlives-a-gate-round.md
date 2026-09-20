---
id: repo-57
tool: repo
title: A per-ticket scratch directory, named in both prompts, outlives a gate round
kind: chore
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-57 — A per-ticket scratch directory, named in both prompts, outlives a gate round

## Why

A reviewer woken for a second, third or fourth round re-verifies its earlier
measurements against the same base tree. On #281's gate, round 3 took about an
hour and round 4 about ten minutes on the same branch; the reviewer's own
account of the difference was that by round 4 it had kept an extract of the
base tree (`git archive <sha> <path> | tar -x`) at a stable scratch path and
its comparison script beside it, where in round 3 it had rebuilt both. The
sandbox refuses most of the shapes that would rebuild them quickly (a `for`
loop, `git` inside `node -e`, a heredoc), so rebuilding is slow as well as
repeated.

The session scratchpad is shared by every agent in the session and survives an
agent's completion, so a per-ticket subdirectory is already the right place;
`concurrency.md` already requires scratch paths to be namespaced by ticket
because of a pull request that briefly carried another ticket's body. What is
missing is that the orchestrator names the directory in both the builder's and
the reviewer's prompt, and that the reviewer is told to keep its extract and
tools there rather than in a path it invents per round.

## Build

1. `dispatching.md`: the builder-prompt list's scratch bullet and the gate
   checklist both name one directory per ticket, `<scratchpad>/<ticket-id>/`,
   given in both prompts as the same literal path.
2. `ticket-reviewer.md`: the base-tree extract and any comparison script go
   under that directory, and a woken reviewer looks there first; a round that
   rebuilds an extract already present says why.
3. `worktree-hygiene.md`: the directory is removed with the ticket's
   worktrees, not before, and the orchestrator's close-out lists it beside
   them.

## Done when

- All three pages carry the rule with this ticket's measurement.
- The next multi-round gate records the wall time of its second round beside
  #281's ten minutes, in this Log.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history,
  after the reviewer on #281 named it in its last report.
- 2026-09-20 — Built on `orchestrate-skill-sweep` by the orchestrating session: the per-ticket scratch directory is named in `dispatching.md`'s builder-prompt list and gate checklist, `ticket-reviewer.md` keeps the base-tree extract there and looks there first when woken, and `worktree-hygiene.md` removes it with the ticket's worktrees. The second Done when line is the next multi-round gate's to record here.
