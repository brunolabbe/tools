# Records

A gate written only into a reviewer's worktree **did not happen** — the worktree
is discarded. A gate leaves two things behind, and they are written by different
models so one can be held against the other:

- **The section, in the ticket**, above `## Log`: the verdict, the acceptance
  table and the findings, one subsection per gate, exactly as the gate wrote it.
- **The full report, on the pull request thread**: the reasoning, the
  enumerations and the reproductions. The gate writes it beside its section
  as `gate-<n>@<sha>.full.md` — the harness refuses a subagent only a file
  named `report.md` (measured 2026-10-17) — and the lander posts those files.

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
itself and run first): the records are landed. A merge-tree failure stops
preflight before the suites, and the `--land` output ends with the one command
that covers the probe and every check that did not run, `--only` followed by
all five names: **the landing's `## Review` and title checks have not run until
it passes**, so `--only mergeTree` alone is not enough. A `--land` killed
after its push is finished except for the thread comments and `gh pr ready`:
do those by hand, and never run `--land` on the same files again — it splices
a second `## Review` (repo-103). **A suite that fails after the push in a file
the branch never touched**, a timing test under the batch's own load, is the
same case: the records are landed, and the lander reruns only the checks that
did not pass, `node scripts/preflight.mjs --only <names> --base origin/<base>
--title "<title>"`, once the machine is quieter, and names that pass in the
thread comment (dl-126: `expected 1001.709… to be greater than or equal to
1200` in `browser-resolver-departure-and-floor.test.ts`, then `--only check`
exit 0).

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
- **A ticket that already holds `## Review`** — the second slice of an
  `in-flight` ticket, a filing pull request that closes a ticket gated before —
  continues the numbering: the gate dispatch names the count `k`, the gates
  write `### Gate <k+1>` and on, and `--land` splices those files. A file
  starting `## Review` on such a ticket is refused (lg-56, 2026-10-24: both
  gates re-emitted their files as Gates 3 and 4 after the refusal).
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
Log entry on the ticket, **in the fix's own commit, before `--land`**, which
refuses a ticket dirty against `HEAD` (every lander since 2026-10-15 committed
it so: repo-104's `ba703486`, lg-26's `611e7547`):

```markdown
- 2026-10-24 — Fixed at landing by owner choice: gate 2, N1 — "<the gate's
  sentence, or the clause of it that fits one line>". <the proof>.
```

**Name the finding as the gate did** — `F2`, `N1` — or, when the section's
bullets carry no ids, by severity and ordinal ("gate 1, the first low";
dl-129). A fix the owner chose on a reading of their own rather than a gate
finding — a red CI leg read at step 10 (repo-117's Windows skip) — names the
reading in the finding's place: `Fixed at landing by owner choice: CI, <check>
red at <sha> — "<what it showed>". <the proof>.` One entry per finding, even when one commit fixes two (lg-55, lg-61,
lg-63). It names the finding, not the commit: a commit cannot carry its own sha
(lg-19 spent two commits on one line), and the fix is the commit before the
records whose subject names the finding. **The proof depends on what was
fixed:**

- a code fix: the command that failed before and passes after, or the test by
  file and name;
- a wording fix — in the ticket or any other file, in the brief or in the Log:
  `git diff <gated sha> HEAD -- <path> | grep -c '^-.*<a fragment of the
  removed text that sits on one line>'` → `1`, **run after the commit that
  carries the fix and this entry**: before it the range holds nothing and the
  count reads `0` (lg-83's and repo-131's landers; `git diff HEAD -- <path>`
  shows the same hunk uncommitted). It reads the removed line, so the entry's
  own quotation cannot count (dl-127: `2` for one fixed line and pl-56: `3`,
  under an unscoped `grep -c`), and it reaches a Log sentence, a source comment
  or `tokens.css`, where a count scoped above `## Log` could not: fourteen
  landers between 2026-10-17 and 2026-10-24 each improvised a scope of their
  own. A fix that only adds a sentence has no removed line: then
  `git diff <gated sha> HEAD -- <path> | grep -v 'Fixed at landing' | grep -c '^+.*<fragment>'`
  → `1`, the `grep -v` keeping this entry's own quotation out (lg-76's
  lander). The fragment is plain words: a backtick inside it breaks the entry's
  code span (repo-118's lander put `.` in its place), and `[`, `.` and `*` are
  regex to `grep`;
- a figure the finding states against its own arithmetic (repo-106: "245
  spawns" beside 30 × 5 + 18 × 5): apply the arithmetic, quote both in the
  entry, and say which you took.

**Write the quotation so the formatter cannot break it**: the markdown hook
re-wraps the ticket on every edit, and a backtick span or a quoted phrase
wrapped across a line end is dedented out of the bullet (repo-108's lander
rewrote its entry). Quote a fragment that fits one line, and re-read the entry
after you write it. **A fix made after `--land` has run** — an owner's edit on
the lander's open decision (pl-57's Forillon) — gets the same entry, worded for
whose decision it was, in its own commit, with
`node scripts/preflight.mjs --only check,review,title --base origin/<base> --title "<title>"`
in place of the `--land` that will not run again. **A committed Log claim the
fix shows false** is withdrawn in place (_Rules for what the record says_),
never deleted (lg-32's lander found that rule itself; repo-114's L1). When the
fix touched anything but the ticket file, run `npm run check` before `--land`
(`roles/fixer.md`), and the orchestrator reads the landing head's `CodeQL`
check before the merge (`SKILL.md` step 10): repo-103's landing fix raised a
new `high` alert that the gated sha's run had not seen.

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
full, and the body says so in a sentence. A pull request that only files a
ticket is the same case, and **its fixes at the landing** (`SKILL.md` step 6)
are committed on the branch with _Fixed at landing_ entries in the filed
ticket's Log, no `--land`, the ticket left `ready` (lg-52, pl-59, lg-64). The
Log names the thread in one entry of the same shape, in the fixes' commit or
one of its own: `- <date> — Gate 1's full report is on the pull request thread,
#<n>; status unchanged.` (lg-80's lander improvised one). A fix made only in
the pull request body — a Summary corrected at the landing — gets no entry:
the body is not a record (lg-72's lander). A gate row `awaiting` has no
`awaiting:` field to go in here: the body names the event and the reading, and
nothing else in the repo tracks them after the merge.
