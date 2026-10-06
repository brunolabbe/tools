# Records

A gate written only into a reviewer's worktree **did not happen** — the worktree
is discarded. A gate leaves two things behind, and they are written by different
models so one can be held against the other:

- **The section, in the ticket**, above `## Log`: the verdict, the acceptance
  table and the findings, one subsection per gate, exactly as the gate wrote it.
- **The full report, on the pull request thread**: the reasoning, the
  enumerations and the reproductions.

## What a record names

**The sha it gated, the spec file and the test's name for each acceptance line,
and the file and symbol for each finding. No line numbers and no commit pins.**
A record is a statement about one commit, and its header names that commit; it is
not kept true against later ones, and nothing in CI reads it after it lands.

Line citations and pins were retired on 2026-10-03
([adr/006](../../../../docs/adr/006-gate-records-carry-no-citations.md)). Records
written before that keep their citations as written; nobody repairs them, and a
branch that moves a line they cite owes them nothing.

## Landing

Nothing is committed per round. Each gate writes its section to a file in the
ticket's scratch directory (`gate-<n>@<sha>.md`), the orchestrator holds the
paths, and whoever lands the ticket commits them all at once:

```
node scripts/review-record.mjs --land <ticket-path> <gate-1 file> [<gate-2 file> …] \
  --base origin/<base> --status done|in-flight --title "<the pull request title>" [--branch <branch>]
```

It validates every splice in a scratch clone first, then commits one gate per
commit, sets `status` in the first, pushes `HEAD` to the branch, verifies each
committed section against its file, and runs preflight. `--branch` is required
from a detached HEAD, which is where a fixer works. Any step that fails prints
what it found; a failure after the commits prints the reset command and rolls
nothing back.

- **Gate 1's file starts `## Review`; a later gate's starts `### Gate <n>`.**
  The script reads the gate number off that line.
- **The lander changes no word of a section.** A difference between a file and
  what landed goes back to the gate, never into the record.
- **`done`, or `in-flight` for work that lands partial.** No commit carries a
  record on a `ready` ticket: `status.mjs` fails one.
- **An `awaiting` row means an `awaiting:` line, committed before `--land`.**
  `gate.md` grades a line whose only proof is an event after the merge
  `awaiting`, and a gate never edits frontmatter, so the lander writes the
  ticket's one `awaiting:` line, in the form `docs/01-TICKETS.md` gives, naming
  every such row and the event that closes it. `--land` refuses a ticket dirty
  against `HEAD`, so the line is its own commit just before it, in the same
  push. A ticket whose tables carry no `awaiting` row gets no line.
- **A gate that runs after the records are committed** — a narrow check on a
  post-PR fix — lands its own file alone with the same command. Do not pass the
  already-committed files again: that adds a second `## Review`.
- **A branch parked without landing still commits what it holds**, as
  `in-flight`: the scratch directory does not survive a container rebuild.

One splice by hand, when `--land` is not the right tool:
`node scripts/review-record.mjs <ticket-path> <section-file> [--gate <n>]`, then
commit, then
`node scripts/review-record.mjs --verify <ticket-path> <section-file> [--gate <n>] --rev HEAD`.
`<ticket-path>` is the file's path, not its id, and `--gate` is given only for a
file that starts `### Gate <n>`.

## Rules for what the record says

- **Verdicts are recorded as given.** "FAIL, since addressed" is a verdict
  softened in place; the addressing goes in the next gate's section.
- **Every finding is listed**, including those needing no change and those the
  severity floor left unfixed — say which.
- **A claim that reached a committed record is withdrawn in place, never
  deleted**: mark it `WITHDRAWN — do not cite this paragraph`, leave it
  standing with the retraction beneath it, and attribute the error to whoever
  made it.
- **The Log's shape is a claim, its command, and that command's output.**
  Narrative belongs in the pull request body. What the brief had wrong stays in
  the Log, because it has nowhere else to live.
- **The pull request body names every model** — which built, which gated, which
  fixed. The commit trailer cannot stand in for it.

## When there is no ticket

A skill correction, a close-out, anything the loop produces about itself has no
ticket to commit a section to. **The pull request thread is the record**, in
full, and the body says so in a sentence.
