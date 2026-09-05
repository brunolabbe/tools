# Tickets

A ticket is one markdown file in `tools/<tool>/docs/work/`, or in `docs/work/`
when the work belongs to no single tool. It carries the brief that starts the
work and the record of what the work did — the same file, from "someone should
do this" to "here is what happened and why".

**Its frontmatter is the only place the ticket's state is recorded**, and
`npm run status` is the only view over it — computed from these files on every
run, and stored nowhere. [adr/003](./adr/003-the-status-page-is-generated.md) and
its amendment are why. Move a ticket to `done` by editing the ticket, in the
commit that earns it.

That is the whole point of the format. Splitting a plan across a roadmap row, a
brief and a status entry means three places to keep in sync by hand, and they
drift the moment anything interesting happens.

## What does not get a ticket

**A ticket carries a decision or a reproduction.** When the work in front of you
has neither left — a typo, a stale sentence, a dead link, a rename the current
change already implies, a thing this branch has just made free — do it in the
commit at hand instead of filing. The commit convention does not require a ticket
id (`scripts/commit-message.mjs` accepts a subject without one), so nothing
structural is forcing the file.

The arithmetic is not close. Folding it in costs the rest of a session that
already holds the context. Filing costs an intake slot, a dispatch, a gate, a pull
request and a merge, paid later by someone with none of it.

**Size is not the test**, and reading it as one gets the inverse wrong: a one-line
fix for a _defect_ is worth a ticket, because the reproduction is the deliverable
and the fix may not be. So is anything whose approach is still open, and anything
reaching into a tool you are not currently working in. The test is whether
anything is left to decide.

**A ticket you fold in is marked `done`, never deleted** — in the commit that
earns it, with its Log rewritten to say it was folded in and why that became
possible. The brief usually records why the work became affordable, which is not
derivable from a one-line diff, and gate records on the branch may already cite
that file's id and frontmatter.

## The file

`tools/<tool>/docs/work/<id>-<slug>.md`

```markdown
---
id: dl-8
tool: downloader
title: Pin vetted addresses into the socket, and proxy direct fetches
kind: fix
status: done
milestone: null
depends_on: [dl-5]
---

# dl-8 — Pin vetted addresses into the socket

## Why

The constraint this answers, in a couple of sentences, linked to the analysis
or architecture note it comes from. If nobody can say why, it is not ready.

## Build

The brief. Self-contained enough to paste into an agent without further
context — numbered steps, named files, the traps worth knowing in advance.

## Done when

Acceptance, in terms someone else can check. "Tests prove X" or "this command
produces Y", never "it works".

## Review

The gate, and it has **two halves, both required**: an acceptance table with one
row per **Done when** line naming the test that proves it, and a bullet per
finding with its disposition. Absent until the work is reviewed. **The builder
commits it**, in the branch under review — see below.

## Log

Appended as the work happens: decisions taken, commits, what turned out to be
wrong in the brief. This is what a future reader actually needs.
```

### Fields

| Field        | Values                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| `id`         | `<prefix>-<n>`, monotonic. `dl-` downloader, `pl-` planner, `repo-` repo-wide |
| `tool`       | The directory name under `tools/`, or `repo`                                  |
| `kind`       | `work-package` · `fix` · `chore`                                              |
| `status`     | `needs-decision` · `ready` · `in-flight` · `done` · `dropped`                 |
| `milestone`  | A milestone from that tool's roadmap, or `null`                               |
| `depends_on` | Ticket ids that must land first                                               |
| `note`       | Optional. What the status view shows instead of the title                     |
| `difficulty` | Optional. `mechanical` · `standard` · `hard` — how much judgement it needs    |

The id prefix exists so `dl-8` means something in a commit message and in
conversation, where the directory is not there to disambiguate it.

**The next free id is the union of two lists, not one.** `ls` the `work/`
directory _and_ the ids named in existing ticket Logs and gate records: an id can
be spoken for before its file exists — promised in another ticket's Log as the
follow-up it filed — and reusing one silently attaches new work to an old
conversation. Take the highest of both and add one.

**`needs-decision` is a ticket's first state, and `ready` is the second.** It
means the filing is complete and the work is not dispatchable, because the ticket
poses a question its own page says must not be settled by whoever picks it up.
Move it to `ready` in the commit that records the answer — the answer goes on the
ticket, never into a builder's prompt alone, or the board says blocked while the
file says otherwise.

It exists because `ready` was carrying two meanings, _unclaimed_ and
_dispatchable_, and only the first was recorded anywhere. Every other status
marks a transition somebody performs; the first one, from filed to buildable,
had no state to move out of, so a ticket deliberately posing a question sat in
the same bucket as work waiting for a builder. Measured on `origin/main@7fe18af`,
six of the seven tickets `--ready` returned could not be started, and each cost a
full builder round to discover it. See
[repo-19](./work/repo-19-ready-does-not-mean-startable.md).

**It is not a draft state**, and the name is deliberate about that: it says what
the ticket waits on rather than what it lacks, and so reads false on a filing
that is merely half-written. A ticket carries a decision _or_ a reproduction, so
**filing a question is a legitimate reason to file** — this is the queue of
decisions waiting on a human, not a holding pen for unfinished prose. Rate
`difficulty` for the work as it will be _once the decision is answered_; the two
fields are orthogonal, and collapsing them destroys both.

`note` is the one editorial field, and it should stay rare: a title that reads
badly in a table column is usually a title worth fixing.

**`difficulty` is the one field written for a dispatcher rather than a reader.**
`orchestrate-tickets` maps it to the model it runs a builder on, and it is on the
ticket rather than computed by the orchestrator because **the author has read the
work and the orchestrator deliberately has not** — its intake reads a seam map,
not the briefs. Rate the _judgement_ the work needs, never the size of the diff:
a one-line change to a contract is `hard`, a forty-file rename is `mechanical`.
Absent means the builder inherits the orchestrator's model, which is the status
quo and the right answer for most tickets, so leaving it off costs nothing;
`standard` says somebody looked and it is ordinary, which is not the same
statement. The mapping from a value to a model lives in
[`.claude/agents/builder.md`](../.claude/agents/builder.md) and only there, so no
ticket ever names a model — see
[repo-17](./work/repo-17-a-ticket-declares-its-difficulty.md).

**These fields are parsed, and strictly** — the six required ones and both
optional ones. `scripts/status.mjs` fails by file and line on a key nobody has
agreed on, a `status`, `kind` or `difficulty` outside the lists above, or an `id`
that disagrees with its own filename. A parser that
shrugs at what it does not understand reports a clean status view having read
half the tickets.

**Two checks warn rather than end, and both are about the board rather than
about a file it cannot read.** Each is named by file and by id on stderr beside
the view; every ticket still renders, and only `--json` also exits non-zero,
which is what `.github/workflows/ci.yml`'s `check` job reads — so neither check
is softened, they are paid for by the pipeline rather than by every reader.

- **A `depends_on` naming a ticket that does not exist**
  ([repo-6](./work/repo-6-dangling-dependency-kills-the-view.md)). `--show` on
  the offending ticket prints `repo-404 (not a ticket)` where a blocker would
  be. The difference from the failures above is that a dangling id is frequently
  just a forward reference: a ticket depending on one still in review is valid on
  its own branch and becomes dangling for everybody else the moment it merges
  first.
- **A ticket that is `ready` and already carries a `## Review` section**
  ([repo-12](./work/repo-12-board-shows-merged-work.md)). `pl-29` merged with its
  gate record and `status: ready`, so the board offered a finished ticket for a
  day. A gate record means the work was picked up, and `ready` means nobody has
  picked it up — the two cannot both be true. `in-flight` is deliberately not
  flagged: a review never moves `status`, a FAIL is a report, and a ticket that
  lands as a partial has to have somewhere to sit.

**`--ready`'s withheld notice is on stderr too, and it is neither of these.** A
ticket saying it waits on a human is a board in good health, so that line never
enters `problems` and never moves `--json`'s exit code — routing it there would
fail every reader's pipeline the moment somebody filed a question, which is a
filing this page invites.

**`dropped` tickets stay.** A ticket that was considered and rejected is worth
more than a deleted file: the next person to have the idea finds the reason it
did not happen.

**One file per ticket, and the file is the unit of work.** If a ticket needs
splitting to be dispatchable, split it into two files rather than growing a
checklist that only its author can read.

## The review gate

`Done when` is written so that someone else can check it. **`Review` is where
someone else checked it**, and it is on the ticket for the same reason the Log
is: a verdict that lives in a chat scrollback is not a record, and the next
person to touch this code cannot find it.

**A gate on a pull request that only _files_ a ticket does not go in `## Review`.**
That section answers one question — was _the work_ checked, and by whom — and a
filing has no work in it to check: its `Done when` lines describe an
implementation that does not exist yet, so a gate applying them literally would
fail every filing on principle. Record such a gate anywhere else on the ticket —
`dl-29` keeps its own under `## The gate on this filing`, unedited and in place —
and leave `## Review` empty until something is built. This is not bookkeeping:
`repo-12`'s board check reads `status: ready` **plus** a `## Review` gate record
as a ticket whose work merged without its status being flipped, and a filing gate
in that section makes a perfectly ordinary unstarted ticket look like a defect.

It is one table — a row per acceptance line, naming the test that proves it,
`file.test.ts:88` rather than "covered" — a list of findings by severity, and a
single word:

| Gate         | When                                                              |
| ------------ | ----------------------------------------------------------------- |
| **PASS**     | Every acceptance line proven or `verified`, nothing above `low`   |
| **CONCERNS** | A `med` finding, or a line proven only by a gate that has not run |
| **FAIL**     | A `high` finding, or a line nothing asserts **and nobody re-ran** |
| **WAIVED**   | A human overrode a gate, named themself, and said why             |

`verified` is the row for an acceptance line nothing asserts and the reviewer
**re-ran** — the gates-are-green bullet almost every ticket ends with, and a
criterion whose only proof is a command rather than a test. It counts as proven,
and it is not a softer `unproven`: the difference is whether someone got a number
back. The four row verdicts are the review skill's, and it defines them.

The vocabulary is fixed so that the gate is a decision rather than a mood. Prose
verdicts drift towards the reviewer's appetite for argument that afternoon; four
words with a written rule do not, and "CONCERNS" is a thing you can grep for
across every ticket a milestone contains.

**The middle row is the one that earns the section.** An acceptance line whose
proof is a tool's e2e suite or its container build is proven by nothing that runs
on your machine — those gates live in `.github/workflows/<tool>.yml` and only
there. [pl-16](../tools/planner/docs/work/pl-16-the-plan-run.md) is the worked
example: `npm run check` green, 1,020 tests green, and the image would not boot.
That row is `unproven (gate)`, which is deliberately neither PASS nor FAIL — the
work may be perfectly correct and simply unproven, and saying so is the whole
job.

**A review appends; it never edits the brief and never moves `status`.** A FAIL
is a report, and whether the work stops is the author's call. The reviewer's job
is to make the state of the thing legible, not to decide it.

The procedure is a skill —
[`.claude/skills/review-ticket`](../.claude/skills/review-ticket/SKILL.md),
invoked as `/review-ticket <id>`, and the reviewer it dispatches is the
[`ticket-reviewer`](../.claude/agents/ticket-reviewer.md) subagent. It reads the
ticket, runs a defect hunt — delegated to `code-review` when the skill is invoked
in a main session, run in its own context when it is the subagent, which has no
`Skill` tool for the purpose — and spends the rest of its effort on the two things
a general-purpose reviewer cannot know: what this change was supposed to do, and
the rules in this repo's `CLAUDE.md` files and `.claude/rules/` that each exist
because something once went wrong.

**The model that wrote the code does not gate it.** The skill dispatches a
subagent on the other of Opus and Sonnet, and the caller appends what comes back
without editing it. A model reading its own work re-runs the reasoning that
produced it, so the blind spot is correlated and a second pass mostly re-derives
the first one's confidence.

**The builder commits the gate, in the branch under review** — not the reviewer.
A reviewer works in a worktree that is thrown away once its record is pushed and
its exchange with the builder has ended, so a `## Review` section written there is
written into nothing: the finding travels back as a message and the record does
not travel at all. `repo-1` went through
two gates and neither existed in the repo afterwards, which is how it was
noticed. So the reviewer reports and the builder writes the section down, with
the date, the verdict, and **both halves named above**:

- **The acceptance table** — one row per `Done when` line, each naming the test
  that proves it (`file.test.ts:88`, not "covered"), with the verdict from the
  skill's four: `proven`, `unproven`, `unproven (gate)`, `verified`. This is the
  half that records the acceptance-to-test link, and it is the half a finding
  table will silently replace if only one is asked for.
- **A bullet per finding, with its disposition — including the ones that needed
  no change.** A later reader's whole job is checking that all of them were
  answered, and a section listing only the findings that produced a diff cannot
  be distinguished from one that quietly dropped the rest.

A ticket through several rounds keeps **one subsection per gate**, not a single
overwritten one, for the same reason.

That the author transcribes a verdict on his own work is a real weakness, so the
check is a step rather than an assertion: **the builder posts the reviewer's
report to the pull request thread** — `gh pr comment <number> --body-file <file>`
— in the same push that commits the section, and where the branch has no pull
request yet, that duty attaches to opening it. The two are then written by
different models and a reader can hold one against the other. A gate that is not
committed did not happen; a gate committed with no report beside it cannot be
audited.

## What the other documents keep

- **`02-ROADMAP.md`** — phases, milestones, and the shape of the argument. It
  links to tickets; it does not describe work. A phase is done when its tickets
  are.
- **`CLAUDE.md`** — the rules for that tool, and how to run it. Its
  `## Commands` section is where per-tool commands live; the root `CLAUDE.md`
  says so, and it is the only place that has ever kept them right.
- **There is no `03-STATUS.md`.** Both tools had one.
  [repo-1](./work/repo-1-generated-status-tables.md) emptied it of everything a
  person had to keep true and generated the rest from frontmatter;
  [repo-2](./work/repo-2-retire-the-status-page.md) deleted what was left,
  because a projection kept in version control needs a writer and every writer
  available was unsafe, noisy or racy. **`npm run status` is the view**, and it
  is computed on every run, so it cannot be stale.

### Where each kind of fact goes

This table is why the page could go. Every line on it names a home that
something already keeps true; a status page is what you get when none of them
is named.

| What you want to say                          | Where it goes                                              |
| --------------------------------------------- | ---------------------------------------------------------- |
| A ticket is done, or blocked, or open         | its own frontmatter. `npm run status` is the view over it  |
| What a piece of work did, and got wrong       | that ticket's `## Log`                                     |
| Whether the work was checked, and by whom     | that ticket's `## Review`                                  |
| A gap a tool still has                        | the ticket that closes it — and if there is none, file one |
| Why the code is shaped the way it is          | a comment beside the code                                  |
| How to run the tool, and what trips you up    | that tool's `CLAUDE.md`                                    |
| Where the design was overruled by building it | an amendment in that tool's `00-ANALYSIS.md`               |
| A decision that binds more than one tool      | an [ADR](./adr/)                                           |
| What a phase or a milestone means             | that tool's `02-ROADMAP.md`                                |

A test count, a "what exists" paragraph and a phase table are each either a
projection of frontmatter — in which case `npm run status` already says it — or
a ticket's Log restated where nothing keeps it true. **A gap worth recording is
a ticket worth filing.**

## Asking what is next

```bash
npm run status                    # open tickets per tool, with what blocks each
npm run status -- --ready         # startable: `ready`, and nothing open in its depends_on
npm run status -- --json          # the same data, structured
npm run status -- --prs           # fold in `gh pr list`
npm run status -- --tool planner  # narrow any of the above to one tool
npm run status -- --show pl-28    # one ticket: its fields, its blockers, its path
npm run status -- --markdown      # the table, to paste into a pull request body
npm run status -- --root <dir>    # a test seam: read another tree's tickets
```

`--root` is listed for completeness rather than for use. It exists because
`scripts/status.mjs` derives its own root from the script's location, so without
it no test could drive the CLI against a throwaway ticket tree and every
end-to-end case had to run against the real tickets — which cannot be malformed
on purpose ([repo-6](./work/repo-6-dangling-dependency-kills-the-view.md)). If
you are asking what is next, the six above are the whole of it.

Computed from the ticket files every time, so it cannot disagree with them.
`--ready` is the one worth knowing, and it answers "what can I pick up" rather
than "what is unclaimed" — the two used to be the same query and were not the
same question. A ticket is withheld from it for either of two reasons: something
in its `depends_on` is still open, or its `status` is `needs-decision` and it is
waiting on a human. **Neither withholding is silent.** `--ready` names every
ticket it kept back and why, on stderr beside the answer, because a query that
quietly returns fewer rows is a different kind of wrong answer — and with
everything withheld, stdout says `nothing is ready and unblocked`, which is also
what a finished board says.

The default view marks the same distinction: `•` startable, `·` queued behind a
dependency, `?` waiting on a decision, `»` picked up.

## The agent preamble

Prepend this to any ticket handed to an agent. It is the same for every tool;
substitute the tool's name.

> Read the root `CLAUDE.md`, `tools/<tool>/CLAUDE.md`, and that tool's
> `docs/01-ARCHITECTURE.md` before writing code. All cross-package types come
> from `@<tool>/contract` — do not redefine them, and do not edit that package;
> if you believe the contract is wrong, stop and say so rather than changing it.
> Use `AppError` with a code from the taxonomy for every failure. Ship unit
> tests with checked-in fixtures, never live network calls. In a fresh worktree
> run `npm install` **and `npm run build`** before anything else. `npm run check`
> and `npm test` must pass — and neither runs that tool's slow gates, so if you
> changed what the container ships or what the browser loads, say that CI has not
> proved it rather than reporting green. The pull request title is itself a
> conventional commit, because this repo squash-merges and the title is the
> message that lands on `main`; check yours with
> `node scripts/commit-message.mjs --text "<title>"` before opening it. Append
> what you did, and anything the brief got wrong, to the ticket's Log before you
> call it done.

**The three sentences in the middle are there because each one was missed by an
agent that was otherwise finished**, on 2026-08-16, and each cost a red build
that the ticket itself could not have predicted. They are not general advice —
they are the three ways a correct change fails here.

- **Build before you test.** Every workspace is consumed through its `dist`, so
  an unbuilt worktree fails on `@webtools/core` with a Vite resolve error naming
  nothing that has anything to do with the cause. It is the first thing to do and
  it looks like the last.
- **`check` and `test` are not the whole gate.** A tool's e2e suite and its
  container build live in `.github/workflows/<tool>.yml` and run nowhere else, so
  a green local tree is silent about both. The worked example is
  [pl-16](../tools/planner/docs/work/pl-16-the-plan-run.md): it added a workspace
  dependency to `api`, `npm run check` and 1,020 tests passed, and the image
  would not boot — because a `Dockerfile` lists its workspaces by hand, twice,
  and nothing type-checks that list. The honest report is "green locally, and the
  image gate is the proof I do not have". The list is unchecked for now and that
  is filed as
  [pl-17](../tools/planner/docs/work/pl-17-dockerfile-workspace-scan.md) — read
  it before writing a ticket for it.
- **The pull request title is the commit.** The rule and its reasoning are in
  [03-RELEASING.md](./03-RELEASING.md), which an agent handed a ticket has no
  reason to open — so the check for it goes here, where it will be read. A title
  that reads like a heading is a guaranteed red `pr-title`.
