---
id: repo-139
tool: repo
title: Measure a Sonnet gate on standard tickets against the Opus gates in the log
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-139 — Measure a Sonnet gate on standard tickets against the Opus gates in the log

## Why

The pairing table gates a `standard` ticket (built by `builder-standard`,
Sonnet 5.5) with `ticket-reviewer-opus` (Opus 5.5, high), by the rule that a
different model gates. On the `standard` tickets of the last eight batches the
Opus gate was the largest line of the ticket — larger than the build it
checked — and the table has never been measured against the alternative the
rule also allows: `ticket-reviewer-sonnet` at xhigh, which gates `hard`
tickets today and is a different model from nothing a Sonnet builder wrote.

This is a measurement, not a change: one batch of `standard` tickets gated on
Sonnet xhigh, with its findings read against the Opus gates in the log. The
rule changes only if the numbers say so, in a ticket of its own.

## Reproduction

Opus gate 1 cost against the build it gated, `standard` tickets, from
`reference/history.md`'s 2026-10-31 and 2026-11-01 entries:

| Ticket                  | Build (Sonnet high) | Gate 1 (Opus high) | Gate verdict    |
| ----------------------- | ------------------- | ------------------ | --------------- |
| repo-130                | $2.13               | $3.67              | PASS, 6 lows    |
| repo-133 (build)        | $1.25               | $2.65              | PASS, 5 lows    |
| repo-120                | $1.25               | $3.62              | PASS, 4 lows    |
| lg-69                   | $2.71               | $4.14              | PASS, 4 lows    |
| lg-80 (tools-54 second) | $1.22               | $3.11              | CONCERNS, 1 med |
| lg-75                   | $2.29               | $2.68              | PASS, 4 lows    |
| lg-72                   | $5.05               | $3.92              | FAIL, 1 high    |
| repo-121 (tools-5e)     | $1.23               | $3.21              | PASS, 5 lows    |
| repo-124                | $2.00               | $2.26              | FAIL, 1 high    |
| repo-128 (tools-97)     | $2.75               | $4.26              | PASS, 2 lows    |

Ten gates, $33.52, two highs. Sonnet xhigh gates on `hard` tickets in the same
period cost $2.04 to $4.41 (repo-131 $2.04 and $2.08, lg-78 $2.52, lg-77 $2.77,
lg-67 $3.28, lg-71 $3.27, lg-66 $4.41) and found highs on lg-66 (gate 2) and
repo-131 (gate 1). The two populations are not comparable as they stand —
different tickets, different builders — which is why this is a ticket.

## Build

1. Pick the next batch of three or more `standard` tickets the owner selects
   (`SKILL.md` step 2), and in the dispatch use `ticket-reviewer-sonnet` at its
   pinned xhigh for gate 1 of each, depth `medium` as the Opus row gets. Say in
   each gate dispatch that it is this ticket's measurement. Nothing else about
   the batch changes: rounds, gate 2 and landings follow the table.
2. For each ticket record: gate 1's cost from `node scripts/agent-cost.mjs
   --agent <id>`, its verdict, its counts by severity, and the number of
   findings the orchestrator or the builder refuted.
3. Read the ten Opus rows above the same way from their gates' full reports on
   the pull request threads (verdict, counts by severity, refuted).
4. Write both tables into this ticket's Log and in `reference/history.md`'s
   entry for the batch, and state the comparison: cost per gate, findings per
   gate, highs, refuted findings. A conclusion the numbers do not support is a
   `high` on a measurement ticket (`gate.md`), so state what the numbers show
   and no more; three tickets is enough to see cost, not enough to see the
   rate of a `high`, and the Log says so.
5. If the Sonnet gates found fewer or no more refuted findings at a lower
   cost, file a `needs-decision` ticket to change the `standard` row; if not,
   close this one with the numbers.

## Done when

1. At least three `standard` tickets have a gate 1 on `ticket-reviewer-sonnet`
   recorded in their `## Review` with the model named in the header line.
2. This ticket's Log holds both tables (Build 2 and 3) with every cost read
   from `agent-cost.mjs` and every count from a gate's own section.
3. The batch's `reference/history.md` entry names this ticket and carries the
   same rows.
4. Either a follow-up `needs-decision` ticket exists naming the row change
   with these numbers as its reproduction, or the Log closes the question.

## Log

- 2026-11-01 — Filed from the 2026-11-01 review's reading of the eight
  batches' accounting tables (session tools-5d); the table above is copied
  from the entries, not re-run.
- 2026-11-10 — **The measurement, read.** Built by a Sonnet 5.5 builder
  (`builder-standard`) on `repo-139-sonnet-gate-measure` from `a100f429`. Every
  cost is `node scripts/agent-cost.mjs --agent <id>`, one flag per id, run in
  this worktree on 2026-11-10; every verdict and count is the gate's own
  `## Review` section (`origin/main` for repo-135 and repo-143, branch
  `repo-129-split-isolation` at `b06ff43f` for repo-129, #783 still open at that
  head). The pull request threads (#768, #769, #783) each hold the gate's full
  report as a comment opening with the same `## Review` header; I scanned them
  for the refutation words below and took the counts from the ticket sections. "Carried" is a finding the gate graded `high`,
  `med` or `low`; "dropped" is one the gate itself discarded in its own
  section, which is not a refutation. **Refuted** is the Build's own count — a
  finding the orchestrator, the builder, the fixer or the lander showed false
  with a command — and it is 0 for all thirteen gates: I read each ticket's
  `## Log` after its `## Review` for `refut`, `disprov`, `push(ed) back`,
  `survive`, `not a defect`, `does not reproduce` and the like (the scripts are
  in this branch's scratch directory, not committed), and each pull request
  thread for the same words. The only hits are lines inside a gate's own
  dropped bullets (repo-130's "refuted: a planted `--gate-unread`…", lg-75's
  six "refuted:" attacks), which the gate wrote about its own hunt.

  **Table 1 — gate 1 on `ticket-reviewer-sonnet`, xhigh, depth medium
  (repo-139's measurement; the model is named in each section's header line).**

  | Ticket      | PR            | Gate agent        | Cost                       | Active / wall   | Verdict            | high / med / low | Carried | Dropped by the gate | Refuted |
  | ----------- | ------------- | ----------------- | -------------------------- | --------------- | ------------------ | ---------------- | ------- | ------------------- | ------- |
  | repo-135    | #768 (merged) | a15dd5725ad66b749 | $1.2729                    | 7m47s / 7m43s   | PASS               | 0 / 0 / 2        | 2       | 3                   | 0       |
  | repo-143    | #769 (merged) | aec8a87b632a0757d | $1.5398                    | 8m42s / 8m30s   | CONCERNS           | 0 / 1 / 3        | 4       | 3                   | 0       |
  | repo-129    | #783 (open)   | ab4e40f6d905a7cfe | $2.7353                    | 18m17s / 17m58s | PASS               | 0 / 0 / 6        | 6       | 4                   | 0       |
  | **3 gates** |               |                   | **$5.5480** (mean $1.8493) |                 | 2 PASS, 1 CONCERNS | 0 / 1 / 11       | 12      | 10                  | 0       |

  repo-129's section also carries one `note` (a proof the Log called
  unprovable, which the gate proved); it is not counted. repo-143 had a gate 2
  (Opus, narrow, over the round, $2.66 in history.md's row): it found no high,
  graded gate 1's F1 fixed and F2 and F3 fixed in part, and added two lows.
  repo-135 and repo-129 had no second gate.

  **Table 2 — gate 1 on `ticket-reviewer-opus`, high, from each ticket's own
  `## Review` (gate 1 only; the second gates of lg-72 and repo-124 are not
  counted).**

  | Ticket       | PR   | Gate agent        | Cost                        | Depth          | Verdict                    | high / med / low | Carried | Dropped by the gate  | Refuted |
  | ------------ | ---- | ----------------- | --------------------------- | -------------- | -------------------------- | ---------------- | ------- | -------------------- | ------- |
  | repo-130     | #705 | a13948a25296173e9 | $3.6669                     | full           | PASS                       | 0 / 0 / 6        | 6       | 5                    | 0       |
  | repo-133     | #703 | a9b25b58e28a24bb9 | $2.6522                     | full           | PASS                       | 0 / 0 / 5        | 5       | 4                    | 0       |
  | repo-120     | #704 | ad53efd821d7f2651 | $3.6215                     | full           | PASS                       | 0 / 0 / 4        | 4       | 4                    | 0       |
  | lg-69        | #679 | a384e6abcbc30f56f | $4.1441                     | standard, full | PASS                       | 0 / 0 / 4        | 4       | 3                    | 0       |
  | lg-80        | #684 | a5a83659356c98655 | $3.1060                     | medium         | CONCERNS                   | 0 / 1 / 1        | 2       | 2                    | 0       |
  | lg-75        | #689 | af6765259f6a770e6 | $2.6847                     | medium         | PASS                       | 0 / 0 / 4        | 4       | 6                    | 0       |
  | lg-72        | #694 | a443c4164ab9d2259 | $3.9194                     | full           | FAIL                       | 1 / 0 / 4        | 5       | 4                    | 0       |
  | repo-121     | #643 | a215459a18c55fd59 | $3.2141                     | standard       | PASS                       | 0 / 0 / 5        | 5       | 5 (one by the owner) | 0       |
  | repo-124     | #639 | a7a865f605e2356a0 | $2.2586                     | standard       | FAIL                       | 1 / 0 / 4        | 5       | 1                    | 0       |
  | repo-128     | #660 | a84bc6bb4cec21e22 | $4.2579                     | full           | PASS                       | 0 / 0 / 2        | 2       | 3                    | 0       |
  | **10 gates** |      |                   | **$33.5254** (mean $3.3525) |                | 7 PASS, 1 CONCERNS, 2 FAIL | 2 / 1 / 39       | 42      | 37                   | 0       |

  All ten costs equal `reference/history.md`'s rows to the cent. The ticket's
  Reproduction table listed only the top finding of its CONCERNS and FAIL rows;
  the sections also carry lg-80's low and the four lows each on lg-72 and
  repo-124 (the totals above include them). The depths are the gate sections'
  own words and are not uniform: five `full`, two `standard`, two `medium`, one
  both.

  **The comparison, and no more.**

  |                              | Sonnet xhigh (3 gates)     | Opus high (10 gates)            |
  | ---------------------------- | -------------------------- | ------------------------------- |
  | Cost per gate                | $1.27 to $2.74, mean $1.85 | $2.26 to $4.26, mean $3.35      |
  | Wall per gate                | 7m43s to 17m58s            | 8m57s to 14m41s                 |
  | Findings carried per gate    | 2, 4, 6 (mean 4.0)         | 2 to 6 (mean 4.2)               |
  | Dropped by the gate per gate | 3, 3, 4 (mean 3.3)         | 1 to 6 (mean 3.7)               |
  | Cost per carried finding     | $0.46                      | $0.80                           |
  | `high`                       | 0 of 3 gates               | 2 of 10 gates (repo-124, lg-72) |
  | `med`                        | 1 of 3 (repo-143 F1)       | 1 of 10 (lg-80)                 |
  | Refuted afterwards           | 0                          | 0                               |

  What the numbers show: on these tickets a Sonnet gate cost about 55 % of an
  Opus gate on average ($1.85 against $3.35; the cheapest Opus gate, $2.26,
  is below the dearest Sonnet one, $2.74, so the ranges overlap), and
  carried about as many findings, 4.0 a gate against 4.2. Neither population
  had a finding shown false afterwards. The Sonnet gates graded one `med`,
  repo-143's F1, which the round fixed and an Opus gate 2 confirmed fixed.

  What they do not show:
  - **The rate of a `high`.** Three gates is enough to see cost, not enough to
    see how often a gate finds a `high`. Had a Sonnet gate the Opus rate of 2
    in 10, the chance of 0 in 3 is 0.8^3, 51 %: the absence of a `high` among
    the three tells nothing. The ticket's own note that Sonnet xhigh found
    highs on `hard` tickets (lg-66 gate 2, repo-131 gate 1) is copied from the
    ticket, not re-read here.
  - **Misses.** "Refuted" counts false findings. A finding a gate never made
    cannot be refuted, and only repo-143 had a second reader, narrow and over
    the round; repo-135 and repo-129 had none. Zero refuted does not separate
    two gates that differ in what they miss.
  - **Like for like.** The tickets differ (a status script, a Cloudflare
    Worker, a vitest split against Opus's ten), as do the depths and the
    builders' costs; the cost of one repo-129 gate, $2.74, is already above
    three of the Opus gates. `agent-cost.mjs` was run the same way on all
    thirteen, so the ratio of means is not a reading artefact; whether the
    absolute figures are low is repo-112's question, not this one's.
  - **The pairing rule.** A `standard` build is `builder-standard`, Sonnet 5.5,
    and `ticket-reviewer-sonnet` is Sonnet 5.5. These three Sonnet gates read
    Sonnet builds, the same model reviewing itself. `SKILL.md`'s pairing
    notes say "a different model, not a cheaper one", and PR #778 (repo-138,
    ready) applies it to the filing row for exactly this pairing. Nothing here
    tests whether that matters.

  Build 5: the Sonnet gates found no more refuted findings (0 against 0) at a
  lower cost ($1.85 against $3.35 a gate), so the branch files
  [repo-145](./repo-145-whether-the-standard-rows-opus-gate-should-become-a-sonnet-gate.md)
  as `needs-decision`, with these tables as its reproduction and the options
  priced from them. It says in the ticket that "no more refuted" is a tie at
  zero and does not discriminate.

  **Done when, by line.**
  1. Three gate 1s on `ticket-reviewer-sonnet`, the model in the header line:
     repo-135 and repo-143 on `main`; repo-129's is on #783's branch and
     reaches `main` when it merges. Met for two on `main` and one on a branch
     until then.
  2. Both tables above, costs from `agent-cost.mjs`, counts from the sections:
     met.
  3. **Awaiting.** `reference/history.md` is not edited here (the
     orchestrator's close-log pull request writes it). The event is the
     tools-86 batch log merging; the reading is that its entry names repo-139
     and carries the rows in the branch's scratch file
     `history-rows.md`. The lander writes the `awaiting:` line.
  4. A follow-up `needs-decision` ticket exists: repo-145.

  What the brief had wrong:
  - **The Why's "a different model from nothing a Sonnet builder wrote"** is
    false for the `standard` row. `builder-standard` and `ticket-reviewer-sonnet`
    both pin Sonnet 5.5, so the row the ticket measures breaks the rule it
    cites in `SKILL.md` ("a different model, not a cheaper one"). It is the
    open question of the follow-up, not a footnote to it.
  - **Build 3's "ten Opus rows … verdict, counts by severity, refuted"**
    assumed the Reproduction table held the counts; it held the top finding
    of each non-PASS row only. The counts above are from the sections.
  - **Build 4 asked for the rows in `reference/history.md`**, which this
    branch must not edit; they are in `history-rows.md` for the batch log.

  Not folded in, and why: the third Sonnet row the history entry expected was
  repo-126's gate 1; repo-126 did not start, and repo-129's gate stood in, so
  the 2026-11-08 history entry's sentence "The third is repo-126's gate 1" is
  stale (it is an entry, not a page of rules; the batch log is the place for
  it). No other already-specified piece became free.
