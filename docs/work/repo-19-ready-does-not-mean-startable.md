---
id: repo-19
tool: repo
title: ready does not mean startable, and the board cannot say which
kind: fix
status: ready
milestone: null
depends_on: []
---

# repo-19 — `ready` does not mean startable

**Packages:** `scripts` (`status.mjs`, `test/status.test.ts`), `docs/01-TICKETS.md`.

## Why

`npm run status -- --ready` is the command that answers "what can I pick up".
Measured on `origin/main@7fe18af`:

```
$ node scripts/status.mjs --ready | wc -l
7
```

**Six of those seven cannot be started**, because each carries an explicit
unsettled decision its own page says must not be resolved by whoever picks it up:
`repo-14` ("Open question — do not settle it here"), `repo-15` (Decisions A and
B), `repo-16`, `dl-32` ("The decision this ticket exists to force"), `dl-33`
("The decision this ticket must force"), `dl-34` ("Open decision, for whoever
picks this up"). The one that is genuinely startable is `dl-35`.

So the board's headline query is **86% wrong**, and it is wrong in the expensive
direction: an orchestrator dispatches a builder that reads the ticket, discovers
the decision, and stops. That is a full builder round — measured elsewhere in this
repo at roughly a dollar and 100 k subagent tokens — spent to learn something the
frontmatter could have said.

**The repo already knows.** `docs/01-TICKETS.md` says _"`status: ready` means
nobody has picked a ticket up, which is not the same as it being startable"_, and
`.claude/skills/orchestrate-tickets/SKILL.md` records a session where a ticket read
`ready` while its own first section was titled "Read this before picking it up"
and said the work must not be pulled forward. Both describe the gap. Neither
closes it.

### What this is not

**Not a case for banning open questions.** `docs/01-TICKETS.md` is explicit that
_"a ticket carries a decision **or** a reproduction"_ — filing a decision is a
legitimate and deliberate reason to file, and several of the six above say the
person who picks the work up is better placed to price the options than the person
who filed it. `CLAUDE.md` requires surfacing decisions as questions rather than
resolving them in prose. **A rule that every question must be answered before
`ready` would forbid half of what a ticket is for.**

The defect is that one word carries two meanings — _unclaimed_ and _dispatchable_
— and only the first is recorded anywhere.

### There is no state before `ready`, and that is the root

`STATUSES` is `["ready", "in-flight", "done", "dropped"]` (`scripts/status.mjs:53`).
**A ticket's first state is `ready`.** There is no `draft`, no `groomed`, no
`needs-decision` — nothing between "this file now exists" and "anyone may build
this". So a filing that deliberately poses a question has nowhere to sit except
the same bucket as work that is fully specified and waiting for a builder.

Every other status marks a transition somebody performs: `in-flight` when it is
picked up, `done` in the commit that earns it, `dropped` when it is rejected. Only
the **first** transition — from filed to buildable — has no state to move out of,
because it has no state to move from. That asymmetry is the whole bug.

### It also broke the difficulty field, on that field's first use

`repo-17` added an optional `difficulty` rating. Asked to rate the eight open
tickets, a reader returned `hard` for all seven carrying an open decision and
`standard` for the one without — a perfect correlation, with one rating reasoned
as _"the fix is mechanical, but the ticket carries an unresolved call"_. It was
rating blockedness because blockedness had nowhere else to live. The definition
was corrected to "rate the work as it will be once its decisions are answered",
which fixed the rating and left the blockedness still unrecorded.

## Build

**Answer the decision below before writing anything** — it changes which files
move and whether the parser's taxonomy changes at all.

1. **Re-run the measurement at the tip.** `node scripts/status.mjs --ready`, then
   read each returned ticket's headings for a decision section. Both cheap; the
   6-of-7 figure is `7fe18af` and the board moves.
2. Implement the chosen option. If it adds a `status` value, `STATUSES` in
   `scripts/status.mjs:53` and the field table in `docs/01-TICKETS.md` move
   together, and **the parser rejects an unknown status by design** — so every
   ticket carrying the new value must land in the same commit as the parser, or
   the board fails for everyone. `repo-17` hit exactly this and its Log records it.
3. **Whatever is chosen, `--ready` must stop returning work that cannot be
   started**, and must say why it withheld one. A query that silently returns
   fewer rows is a different kind of wrong answer.
4. Test it against a fixture ticket in each state. `scripts/test/status.test.ts`
   has the `repoWith` helper for throwaway trees. Run it red first.

## The decision this ticket poses, and does not settle

**How does the board learn that a filed ticket is waiting on a human?**

| Option                                                                                                                                            | What it costs                                                                                                                                  | What it buys                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — a new `status` value _before_ `ready`** — `groomed`, `needs-decision`, `draft`; name it for what the ticket waits on, not for what it lacks | `STATUSES`, the field table, and every affected ticket in one commit with the parser. Five tickets change state today                          | The board states it directly. `--ready` becomes true by construction, and `npm run status` shows the queue of decisions waiting on a human — which nothing shows today        |
| **B — a board check, in `repo-12`'s shape**                                                                                                       | A warn-not-fail check naming file and id on stderr, exiting non-zero only under `--json` (which CI reads). No taxonomy change, no ticket edits | Cheapest, and consistent with the two checks already there. But it needs a way to tell an _answered_ decision section from an open one — see below, and that is the hard part |
| **C — prose only**                                                                                                                                | A sentence in `docs/01-TICKETS.md`                                                                                                             | Free, and the reason this ticket exists: the gap is _already_ described in two places and has never once been acted on                                                        |

**The hard part of B, and it may decide the whole question.** A decision section
exists whether or not it has been answered — `repo-17` records its answer _inside_
its own decision section, so presence proves nothing. Detecting "answered" needs a
convention (a required `**Answered:**` line, a separate `## Decisions taken`
heading, a frontmatter field), and inventing a convention to avoid changing a
taxonomy may cost more than changing the taxonomy.

**A lean, not a decision:** A states the fact where the fact belongs, and the
`depends_on` machinery already proves the board can express "not startable yet"
without anyone objecting. It also fills a hole in the lifecycle rather
than patching a symptom — every other status marks a transition somebody performs,
and this is the only one that does not exist.

**If A is chosen, the naming is part of the decision, not a detail.**
`needs-decision` says precisely what these six wait on and would read false on a
ticket that is merely half-written; `groomed` is the familiar term and covers both,
at the cost of saying less. Pick one a reader can apply without asking — the parser
rejects anything else. But A is the option that touches every ticket, so the
cost is real and it is the filer's job to say so rather than hide it.

## Done when

1. `npm run status -- --ready` returns only tickets that can actually be started,
   proven by a test over a fixture tree containing one startable ticket and one
   waiting on a decision.
2. That test failed before the change, and the Log says so with its output.
3. `--ready` says what it withheld and why, rather than silently returning fewer
   rows.
4. The decision above is recorded on this ticket with its answer and its reason.
5. If a `status` value was added, no ticket carries it in a commit earlier than
   the parser that accepts it.
6. `npm run check` and `npx vitest run scripts` pass, and `npm run status --json`
   exits 0.

## Log

- **2026-09-02** — Filed off `origin/main@7fe18af`, out of a session that tried to
  rate the open tickets and found the rating contaminated by blockedness.

  **Measured, not assumed:** `--ready` returns 7; six of the seven carry a heading
  that names an unsettled decision; `dl-35` is the only one a builder could start
  today.

  **Not fixed here**, and the reason is the open question: the cheap option (B)
  depends on being able to tell an answered decision from an open one, and nothing
  in the format expresses that today. Choosing B without settling that is choosing
  a convention by accident.

  `repo-19` confirmed free against both lists: `docs/work/` tops out at `repo-18`,
  a grep over the tree adds only `repo-404`, `repo-808`, `repo-901` and `repo-999`
  (all `scripts/status.mjs` fixtures), and no remote branch or pull request in any
  state names it.
