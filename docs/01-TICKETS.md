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
| `status`     | `ready` · `in-flight` · `done` · `dropped`                                    |
| `milestone`  | A milestone from that tool's roadmap, or `null`                               |
| `depends_on` | Ticket ids that must land first                                               |
| `note`       | Optional. What the status view shows instead of the title                     |

The id prefix exists so `dl-8` means something in a commit message and in
conversation, where the directory is not there to disambiguate it.

`note` is the one editorial field, and it should stay rare: a title that reads
badly in a table column is usually a title worth fixing.

**These six fields are parsed, and strictly.** `scripts/status.mjs` fails by
file and line on a key nobody has agreed on, a `status` or `kind` outside the
lists above, an `id` that disagrees with its own filename, or a `depends_on`
naming a ticket that does not exist. A parser that shrugs at what it does not
understand reports a clean status view having read half the tickets.

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
invoked as `/review-ticket <id>`. It reads the ticket, delegates defect-hunting
to the `code-review` skill rather than repeating it, and spends its own effort on
the two things a general-purpose reviewer cannot know: what this change was
supposed to do, and the rules in this repo's `CLAUDE.md` files that each exist
because something once went wrong.

**The model that wrote the code does not gate it.** The skill dispatches a
subagent on the other of Opus and Sonnet, and the caller appends what comes back
without editing it. A model reading its own work re-runs the reasoning that
produced it, so the blind spot is correlated and a second pass mostly re-derives
the first one's confidence.

**The builder commits the gate, in the branch under review** — not the reviewer.
A reviewer works in a worktree that is thrown away when it reports, so a
`## Review` section written there is written into nothing: the finding travels
back as a message and the record does not travel at all. `repo-1` went through
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
npm run status -- --ready         # ready, and nothing open in its depends_on
npm run status -- --json          # the same data, structured
npm run status -- --prs           # fold in `gh pr list`
npm run status -- --tool planner  # narrow any of the above to one tool
npm run status -- --show pl-28    # one ticket: its fields, its blockers, its path
npm run status -- --markdown      # the table, to paste into a pull request body
```

Computed from the ticket files every time, so it cannot disagree with them.
`--ready` is the one worth knowing: `status: ready` means nobody has picked a
ticket up, which is not the same as it being startable — a ticket waiting on one
that is still open is a queue, and only `--ready` separates the two.

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
