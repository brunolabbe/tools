# Tickets

A ticket is one markdown file in `tools/<tool>/docs/work/`. It carries the brief
that starts the work and the record of what the work did — the same file, from
"someone should do this" to "here is what happened and why".

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

The gate. One row per line above, each naming the test that proves it. Absent
until the work is reviewed, and written by the review rather than by the author.

## Log

Appended as the work happens: decisions taken, commits, what turned out to be
wrong in the brief. This is what a future reader actually needs.
```

### Fields

| Field        | Values                                                              |
| ------------ | ------------------------------------------------------------------- |
| `id`         | `<prefix>-<n>`, monotonic per tool. `dl-` downloader, `pl-` planner |
| `tool`       | The directory name under `tools/`                                   |
| `kind`       | `work-package` · `fix` · `chore`                                    |
| `status`     | `ready` · `in-flight` · `done` · `dropped`                          |
| `milestone`  | A milestone from that tool's roadmap, or `null`                     |
| `depends_on` | Ticket ids that must land first                                     |

The id prefix exists so `dl-8` means something in a commit message and in
conversation, where the directory is not there to disambiguate it.

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
| **PASS**     | Every acceptance line proven, nothing found above `low`           |
| **CONCERNS** | A `med` finding, or a line proven only by a gate that has not run |
| **FAIL**     | A `high` finding, or an acceptance line nothing asserts at all    |
| **WAIVED**   | A human overrode a gate, named themself, and said why             |

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

## What the other documents keep

- **`02-ROADMAP.md`** — phases, milestones, and the shape of the argument. It
  links to tickets; it does not describe work. A phase is done when its tickets
  are.
- **`03-STATUS.md`** — a dashboard: what is in flight, what is known to be
  rough, how to check the tree is green. Not a log — the log is in the tickets.

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
  image gate is the proof I do not have".
- **The pull request title is the commit.** The rule and its reasoning are in
  [03-RELEASING.md](./03-RELEASING.md), which an agent handed a ticket has no
  reason to open — so the check for it goes here, where it will be read. A title
  that reads like a heading is a guaranteed red `pr-title`.
