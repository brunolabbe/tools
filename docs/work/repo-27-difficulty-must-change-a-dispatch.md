---
id: repo-27
tool: repo
title: A difficulty rating changes no dispatch, and hard cannot keep its own promise
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-27 — A difficulty rating changes no dispatch

## Why

[repo-17](./repo-17-a-ticket-declares-its-difficulty.md) put a `difficulty` field
on the ticket and mapped it to a builder's model in one table
([`.claude/agents/builder.md`](../../.claude/agents/builder.md)). Measured on this
branch's base, the field changes **no dispatch that has ever run**:

| `difficulty` | maps to | tickets carrying it  |
| ------------ | ------- | -------------------- |
| absent       | inherit | every unrated ticket |
| `standard`   | inherit | 11                   |
| `mechanical` | `haiku` | **0**                |
| `hard`       | inherit | 11                   |

Three of the four rows are the same dispatch, and the only row that differs is
the one nobody has used. Twenty-two tickets carry a rating and not one of them
has sent a builder anywhere it would not otherwise have gone.

That is the context. The **defect** is narrower and is in the `hard` row.

### `hard` promises a floor that `inherit` cannot hold

`builder.md`'s table gives the reason for `hard` as _"a contract, a security
claim, a seam with reach. Never below the default"_ — but the value it maps to is
`inherit`, which is the orchestrator's own model, whatever that happens to be.
`SKILL.md` step 4 states the consequence in its own words, as a fact about the
gate:

> pass `model: "opus"` when the builder ran Sonnet, which happens when _you_ are
> Sonnet and the ticket inherits.

So under a Sonnet orchestrator a `hard` ticket — the category defined as
contract-touching and seam-reaching — is built by Sonnet, the table's "never
below the default" is violated, and nothing anywhere reports it. The rating that
was supposed to raise the floor is the one rating that silently cannot.

`mechanical` does not have this problem: it names a model. `hard` is the only row
that states a floor and then delegates it to a variable.

## The decision, and its answer

**Should `standard` map to `sonnet` and `hard` to `opus`?** Put by the repo owner
2026-09-06, with the costs of each option.

- **Chosen: split it.** Pin `hard` → `opus` now, because that half is a defect
  fix and needs no new evidence. Hold `standard` → `sonnet` for the same
  head-to-head protocol that earned the `haiku` row, because the argument for it
  is reasoning, and reasoning has a 1-for-1 failure record in this exact table.
- **Chosen: `absent` keeps meaning inherit**, whatever the trial decides. It is
  repo-17's rule that adding or re-pointing a value never silently re-dispatches
  the tickets that do not carry it. The cost is named under _Build_ step 4 and is
  real.
- Rejected — ship both rows now as a documented judgment call: faster, and it
  repeats the move that produced the wrong `mechanical` row. See below.
- Rejected — ship both and repin `ticket-reviewer.md` to `opus`: reopens a pin
  repo-17 explicitly declined to touch, on the strength of no measurement at all.
- Rejected — leave the table alone: keeps a row that cannot keep its promise.

### Why `standard` → `sonnet` waits for a trial rather than an argument

**This table was already wrong once, in this exact way.** `mechanical` shipped as
`sonnet`, argued from the eight recorded cases of a builder refusing to
transcribe a wrong brief. repo-17's Log calls that _"the error"_: the evidence was
drawn entirely from `hard` tickets and generalised to a category that did not
exist when those corrections happened. Two controlled trials overturned it. In
this table, reasoning is 0-for-1 and measuring is 1-for-1.

Two specific things a trial has to settle, neither of which is guessable:

1. **The gate inverts, and the gate is not the cheap half.** repo-17 records that
   `ticket-reviewer.md`'s `model: sonnet` pin _"was correct only because builders
   were assumed to inherit Opus."_ Move `standard` to `sonnet` and the pinned
   default is wrong for the largest rated category on the board — 11 tickets,
   against `mechanical`'s zero — so the per-ticket pairing check stops being a
   rare exception and becomes the majority case, against a recorded failure of
   **11 tickets, 22 gates, zero gated by a different model than built them**.
   And it moves the expensive half onto Opus: measured 2026-09-05/06, one gate
   cost 411,966 subagent tokens against its own builder's 406,732, and about 60%
   more than the next most expensive builder in that batch.
2. **repo-17's asymmetry argument is not model-specific.** From its trials Sonnet
   is roughly 40% of Opus at the same volume ($0.4043 against $1.0107 on the dead
   link), so the saving is about 0.6 of a builder round per `standard` ticket.
   Against that, _"one wrong model call buys a rebuild round plus its gates plus
   the orchestrator's relay context"_, and `sizing.md`'s 978 k-against-322 k
   branch where _"the difference was rounds, not difficulty"_. Break-even sits
   near a 30% extra-round rate, and nobody has measured Sonnet's rate on a
   `standard` ticket here.

## Build

1. **`.claude/agents/builder.md`** — change the `hard` row's "Builder runs on"
   from `inherit (Opus, in practice)` to `opus`, and say in the "Because" column
   that it is pinned rather than inherited _because_ `inherit` cannot hold a
   floor. Add a short paragraph under the table naming the Sonnet-orchestrator
   case as the thing the pin fixes, and quoting `SKILL.md` step 4's own sentence
   as the evidence that the repo already knew.

   Leave the `standard` and `absent` rows alone. Leave the "Never `fable` for a
   builder" line alone.

2. **`.claude/skills/orchestrate-tickets/SKILL.md`** — step 4's sentence _"pass
   `model: "opus"` when the builder ran Sonnet, which happens when **you** are
   Sonnet and the ticket inherits"_ stays true, but its scope narrows: it can no
   longer happen on a `hard` ticket. Say so where the sentence is, in one clause.
   Do not restate the mapping table; it lives in `builder.md` and only there.

3. **`.claude/skills/orchestrate-tickets/reference/dispatching.md`** — its
   "Absent means inherit, which is most tickets" passage is still correct and
   needs nothing. Check it rather than assuming; it is the third place that
   describes this field.

4. **`docs/01-TICKETS.md`** — the `difficulty` paragraph says _"Absent means the
   builder inherits the orchestrator's model, which is the status quo"_, which
   stays true, and so does the comment at
   `scripts/status.mjs:72 "absent mean the same thing to a dispatcher"` —
   which becomes false the day the trial lands `standard` → `sonnet`. Do not pre-edit
   either for a change that has not happened. **Add a line to this ticket's Log
   naming both sites**, so the trial's implementer finds them without a grep.

5. **The trial, and it is a second branch, not this one.** Its protocol is
   repo-17's, and deviating from it costs the comparison:

   - One `standard` ticket, dispatched twice, **identical prompts**, one model
     each, **separate worktrees**, neither builder told it is in a trial.
   - Report cost from the **billed** figure, not `subagent_tokens` — repo-17's
     first comparison was reported off that field as "an 8% saving" and was wrong
     by an order of magnitude, because cache reads are ~94% of the bill.
   - Gate both branches, and record whether either needed a round the other did
     not. **That count is the deliverable**, not the token figure: the decision
     turns on the extra-round rate, and a trial that measures only cost measures
     the half that was never in doubt.
   - n=2 on one repo is what repo-17 got and it said so plainly. Say so too.

   File it as its own ticket when this one lands, and put its id in this Log.

## Done when

1. `builder.md`'s `hard` row maps to `opus`, and the file says why a floor cannot
   be delegated to `inherit`.
2. `SKILL.md` step 4 no longer implies a `hard` ticket can be built by Sonnet.
3. The `standard` and `absent` rows are unchanged, and no file in the tree claims
   a `standard` builder runs Sonnet.
4. This ticket records the decision, both halves, with the reason the second half
   waits.
5. `npm run check` passes and `npm run format` has been run over every changed
   `.md`.
6. `npm run status -- --show repo-27` parses and `npm run status -- --json`
   exits 0.

## Log

- **2026-09-06** — Filed out of a question about why a Sonnet builder is never
  observed. The answer is that three of the four rows resolve to `inherit`, which
  is the finding above; the defect fell out of it.

  **Id.** `repo-27` confirmed free against both lists `docs/01-TICKETS.md`
  requires: `docs/work/` topped out at `repo-26`, and `git grep "repo-27\b"`
  over the tree returned nothing, including ticket Logs and gate records. No
  remote branch and no pull request — any state — named `repo-27`.

  **The framing this started from had the emphasis wrong.** It was posed as a
  cost question — `standard` should be cheaper — and the cost half is the half
  that cannot be settled without a trial. The half that _could_ be settled
  immediately was one nobody had asked about: `hard` states a floor and maps to a
  variable. Both halves came out of the same table read; only one of them was in
  the question.

  **Two sites the trial will need, recorded here so they are not grepped for:**
  `docs/01-TICKETS.md`'s `difficulty` paragraph, and the comment at
  `scripts/status.mjs:72 "absent mean the same thing to a dispatcher"`. Both are
  true today and both become false the day `standard` maps
  to `sonnet`. Deliberately not pre-edited.

  **Not folded in:** no ticket was rated, and no existing `standard` rating was
  re-read. The 11 that carry it were rated when the value was a free statement
  rather than a spend decision, so if the trial lands they are worth re-reading
  as a set — but back-rating work this session has not read is the judgement
  repo-17 argues the orchestrator must not make.
