# Records

A gate written only into a reviewer's worktree **did not happen** — the worktree
is discarded. A gate leaves two things behind, and they are written by different
models so one can be held against the other:

- **The section, in the ticket**, above `## Log`: the verdict, the acceptance
  table and the findings, one subsection per gate, exactly as the gate wrote it.
- **The full report, on the pull request thread**: the reasoning, the
  enumerations and the reproductions. A gate returns it as text and cannot
  write it to a file (the harness refuses a subagent writing a report file);
  the orchestrator writes each one to `<scratch>/<id>/gate-<n>/report.md`, and
  the lander posts those.

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
what it found and rolls nothing back. Before the push it prints the reset
command. After the push the records are on the branch: a preflight failure ends
"Nothing to undo — fix what it names" and still exits 1 — a merge-tree exit 16
against a sibling included, so read the output, never the code alone; a verify
failure names the force-push only the owner can make; and a `cleanup` line about
the scratch clone is a warning, not a failure (repo-94).

Two failures after the push are not the lander's to repair. A merge-tree exit
16 against a sibling that conflicts with the base itself (lg-21 and repo-103,
both against dl-110) is cleared by the orchestrator's merge order. A
`FAIL #<n> … is at <sha>, which this checkout does not have even after
git fetch origin` is release-please force-updating its branches faster than
the probe's own fetch (three landings before repo-104 made the probe fetch for
itself and run first): the records are landed, and the failure ends with the
one command to rerun, `preflight.mjs --only mergeTree …`, which takes seconds.
A merge-tree failure stops preflight before the suites, so its output also
carries the `--only` command for the checks that did not run. A `--land` killed
after its push is finished except for the thread comments and `gh pr ready`:
do those by hand, and never run `--land` on the same files again — it splices
a second `## Review` (repo-103).

- **Gate 1's file starts `## Review`; a later gate's starts `### Gate <n>`.**
  The script reads the gate number off that line.
- **The lander changes no word of a section.** A difference between a file and
  what landed goes back to the gate, never into the record.
- **`done`, or `in-flight` for work that lands partial.** No commit carries a
  record on a `ready` ticket: `status.mjs` fails one. So a pull request that
  only records a decision on a ticket, or only files one, and leaves it `ready`
  or `needs-decision`, gets no `--land`: its gate's full report goes on the pull
  request thread as _When there is no ticket_ says, the body says so, and the
  ticket's Log names the thread (dl-90, dl-98, dl-102).
- **An `awaiting` row means an `awaiting:` line, committed before `--land`.**
  `gate.md` grades a line whose only proof is an event after the merge
  `awaiting`, and a gate never edits frontmatter, so the lander writes the
  ticket's one `awaiting:` line, in the form `docs/01-TICKETS.md` gives, naming
  every such row and the event that closes it. `--land` refuses a ticket dirty
  against `HEAD`, so the line is its own commit just before it, in the same
  push. A ticket whose tables carry no `awaiting` row gets no line from this
  step; one its brief already owes (dl-52's, lg-5's) is the builder's, and is
  in the ticket before the lander arrives.
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

## Fixed at landing

A below-floor finding the owner chose to fix at the landing (`SKILL.md` step 6)
is applied as the finding states it — the gate's wording and the code it names,
not the lander's reading of it (repo-95's lander wrote "a similar sentence";
the gate's is the record). The gate's section is not touched. The mark is one
Log entry on the ticket, in the landing commit:

```markdown
- 2026-10-14 — Fixed at landing by owner choice: gate 2, N1 — "<the gate's
  sentence>". `<the command that shows it fixed>` → <its output>.
```

It names the finding, not the commit: a commit cannot carry its own sha (lg-19
spent two commits on one line), and the fix is the landing commit whose subject
names the finding. When the fix touched anything but the ticket file, the
orchestrator reads the landing head's `CodeQL` check before the merge
(`SKILL.md` step 10): repo-103's landing fix raised a new `high` alert that the
gated sha's run had not seen.

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
full, and the body says so in a sentence. A gate row `awaiting` has no
`awaiting:` field to go in here: the body names the event and the reading, and
nothing else in the repo tracks them after the merge.
