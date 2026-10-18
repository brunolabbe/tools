---
id: repo-111
tool: repo
title: Re-gate with a fresh narrow gate, and run at most three tickets at once
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-111 — A fresh gate 2, and three tickets in flight

## Why

The owner asked on 2026-10-18 why gates take so long. The answer was measured
on lg-40 (PR #548, a one-ticket batch on base 960f4b26), from its three agent
transcripts: builder `a9dd02de949ac55d2`, gate `a5490055183b61b89`, fixer
`aacd38c83247e1abd`, under
`~/.claude/projects/-workspaces-tools/76d8bfd3-5bf4-4dc1-8f0f-5cfd08c6379a/subagents/`.
Two figures from that analysis show the loop as it ran before this change:
[the flow](../../.claude/skills/orchestrate-tickets/reference/flow.drawio.svg)
and [lg-40's clock](../../.claude/skills/orchestrate-tickets/reference/lg-40-timeline.drawio.svg).

**The chain was build 26 min, gate 1 31, round 1 (builder resumed) 36, gate 2
38, landing 8**, from 02:49:50Z to 05:17:12Z, 147 minutes. The five
orchestrator relays between them came to 7–8 minutes, about 5%.

**Gate 2 was the gate-1 agent, woken with `SendMessage`, and it cost more than
gate 1.** `reference/dispatching.md` said "A woken gate costs a fraction of a
fresh one; never dispatch a fresh reviewer for round two". Split at the wake
(04:27:08Z), the gate's transcript reads:

|               | Responses | Cache-read tokens | Per response | Tool calls |
| ------------- | --------- | ----------------- | ------------ | ---------- |
| gate 1        | 99        | 16,953,045        | 171,242      | 110        |
| gate 2, woken | 73        | 28,624,318        | 392,113      | 82         |

The wake was 63% of the agent's cache reads. Every turn re-read gate 1's
whole transcript, and gate 2 spent 24.2 minutes inside tool calls, 18.8 of
them waiting on background sweeps (3.2, 0.7, 10.0 at the 600 s foreground cap,
and 4.7 minutes), each poll a turn. It re-farmed and rebuilt, re-ran the
ledger project and `npm run check`, re-ran gate 1's exhaustive probes (d, over
±10.00 reordered; j, a 505,120-case sweep) at the new head and at the gated sha
as a control in a second worktree, then six new attacks. The agent sat idle
for 39 minutes between gate 1's return (03:48:20Z) and the wake: idle costs no
tokens, and only lengthens the accounting table's wall column. Across
`reference/history.md`'s rows, gate agents average 24 min active over 94 min
wall (n=107); single-gate agents 14/26, two-gate agents 27/93.

**On a wide batch the orchestrator's own turns become the queue.** The tools-e0
batch (2026-10-18, base 029641b4, eleven pull requests in its accounting table)
kept its orchestrator 2h28m04s active over 2h47m19s of wall: saturated, so
every relay waited behind others. dl-114's gate (2026-10-13) was 15m17s active
over 9h42m18s, with two cold restarts. `reference/concurrency.md` said
"Reviewers occupy slots. A cap of four means four agents total", and no step
of `SKILL.md` applied a cap.

**This does not amend [adr/006](../adr/006-gate-records-carry-no-citations.md).**
Its decision 3 is "two gates: the first, and one re-gate scoped to the fix
round"; the count and the scope stay, and only who runs the re-gate changes.
Gate 3's rules are unchanged.

## Decision — answered 2026-10-18 by the owner

Put by the Fable session with `AskUserQuestion`. First "Cut the waiting"; then
the options **"Fresh narrow gate 2"** (recommended) and **"Cap concurrent
tickets"**. **Chosen: both.** A direct builder–gate channel was considered and
rejected by the owner, because it makes the process less trustable.

- **Gate 2 is a fresh, narrow gate, not a wake.** A new reviewer of the pairing
  table's model for the ticket, handed gate 1's section and full report, its
  probe scripts, the refutations and the round's range. The scope is today's
  step 8; two gates stay the default; gate 1's agent is released after gate 1,
  and its worktree's removal rules are unchanged.
- **At most N tickets in flight per orchestrator, applied at intake. N = 3**,
  the recommended default: the owner chose the cap without fixing N.

## Build

1. `.claude/skills/orchestrate-tickets/SKILL.md`: step 2 states the cap, with
   N, the queue in `board.md` and the tools-e0 measurement; step 3 dispatches
   one builder per ticket in flight; step 8 dispatches a fresh gate 2 and
   gives the token measurement; the pairing table's "a round's mechanical
   fixes, and a landing" row names gate 2 as dispatched fresh; "Reporting to
   the user" names each ticket that waited for a slot.
2. `reference/dispatching.md` _Re-gating_ lists what a gate-2 dispatch
   carries; _A gate prompt carries_ points to it.
3. `roles/reviewer.md`: "When you are woken to re-gate" becomes "When you are
   dispatched as gate 2", for a fresh worktree that verifies each finding with gate 1's probe.
4. `reference/sizing.md` _What a batch pays for_: the resumed gate's cost, and
   the orchestrator's queue. `reference/concurrency.md`'s first paragraph
   names the cap.
5. Every other "wake" or "woken" in `.claude/skills/**/*.md` outside
   `reference/history.md` is reworded or retargeted.
6. `reference/model-pairing.md`: a dated 2026-10-18 section with the
   provenance of both changes, linking the two figures, which are copied into
   `reference/`.

## Done when

1. `SKILL.md` step 8 dispatches a new reviewer for gate 2, says gate 1's agent
   is not messaged again, and gives the per-turn token measurement as the
   reason; the pairing table's "a round's mechanical fixes, and a landing" row
   names gate 2 as dispatched fresh.
2. `reference/dispatching.md` _Re-gating_ lists every item a gate-2 dispatch
   carries: the gated sha and the new head, the round as
   `git log --first-parent --no-merges <gated sha>..<new sha>`, gate 1's
   section file and `.full.md` report by path with its findings pasted, gate
   1's probe scripts by path, each refutation as a command and its output, and
   `gate-2` as its scratch directory.
3. `roles/reviewer.md` has a section "When you are dispatched as gate 2" and
   none named "When you are woken to re-gate"; that section has gate 2 farm and
   build its fresh worktree, and verify each gate-1 finding with the probe script that found it.
4. `git grep -n -i -E 'woken|wake' -- '.claude/skills/*.md' ':!.claude/skills/orchestrate-tickets/reference/history.md'`
   prints only lines of `reference/model-pairing.md`'s 2026-10-18 section, each
   describing the wake as the rule this change replaced.
5. `SKILL.md` step 2 states the cap and names N, three tickets in flight, with
   the rest waiting in `board.md`; step 3 dispatches one builder per ticket in
   flight; "Reporting to the user" asks for each ticket that waited for a slot;
   `reference/concurrency.md`'s first paragraph names the same cap in place of
   "a cap of four".
6. `reference/sizing.md` _What a batch pays for_ carries the cost of a resumed
   gate and the orchestrator's queue.
7. `reference/model-pairing.md` carries a dated 2026-10-18 section with the
   provenance of both changes — the options, the owner's choice, the
   measurement — and links to both figures; `git check-ignore` prints nothing
   for either figure's path.
8. This ticket's Log carries the recipe that recomputes the gate's
   cache-read figures and its output: 99 and 73 responses, 16,953,045 and
   28,624,318 cache-read tokens.
9. `npm run check` exits 0 and preflight exits 0 on the branch.

## Log

**2026-10-18 — filed and built in one branch** (Opus 5.5, a general-purpose
agent dispatched by the owner's Fable 5.1 session), on base `335efcd4`.

- **No gate.** This is the owner's own rule edit, decided in conversation
  (adr/006, decision 6: the owner's review session changes the rules), so it
  lands by the owner's choice without one. `status` stays `ready`, as
  `roles/builder.md` leaves a ticket filed on its branch; there is no lander
  to set `done`.
- **N is the one parameter the owner may change in review.** Three is the
  recommended default; the owner chose the cap without fixing it.
- **The reproduction.** `split.py`, run as
  `python3 -I split.py <gate transcript> 2026-10-18T04:27:08Z`:

  ```python
  import json, sys

  path, split = sys.argv[1], sys.argv[2]
  best = {}
  for line in open(path):
      r = json.loads(line)
      if r.get("type") != "assistant":
          continue
      m = r["message"]
      key = r.get("requestId") or m.get("id")
      u = m.get("usage") or {}
      if key not in best or u.get("output_tokens", 0) > best[key][1].get("output_tokens", 0):
          best[key] = (r["timestamp"], u)
  for name, keep in (("gate 1", lambda t: t < split), ("gate 2", lambda t: t >= split)):
      rows = [u for t, u in best.values() if keep(t)]
      cr = sum(u.get("cache_read_input_tokens", 0) for u in rows)
      print(f"{name}: {len(rows)} responses, {cr:,} cache-read, {cr // max(len(rows), 1):,} per response")
  ```

  Output on `agent-a5490055183b61b89.jsonl`:

  ```
  gate 1: 99 responses, 16,953,045 cache-read, 171,242 per response
  gate 2: 73 responses, 28,624,318 cache-read, 392,113 per response
  ```

  A second script over the same file, pairing each `tool_use` with its
  `tool_result`, gave `gate 1: 110 tool calls` and
  `gate 2: 82 tool calls, 24.2 min inside tool calls`. It summed 11.8 minutes
  for gate 1 against the 9 the analysis gave, because a sum counts parallel
  calls twice; no page quotes gate 1's figure. The four sweep waits inside
  gate 2's 24.2 minutes are the analysis's figures, not re-run here. The chain's ends are the
  builder's first record, `2026-10-18T02:49:50.748Z`, and the fixer's last,
  `2026-10-18T05:17:12.066Z`: 147 minutes, where the analysis said 148.

- **The brief had one thing loose.** The flow figure draws the old step 8
  ("Wake the same gate once", "a wake costs a fraction of a fresh gate"). It is
  linked as the loop before this change rather than redrawn, so it does not
  become a second copy of the rule to keep in step; the `.svg` files are
  outside Done when 4's `*.md` pathspec for that reason.
- **Folded in:** `reference/defect-shapes.md` pointed at
  _When you are woken to re-gate_ for a quote ("Probe a fix from a seed state
  its own tests never started from") that section did not carry. It now points
  at _What makes a gate worth its cost_, where the sentence is "Start a fix
  from a state its own tests never began from". Four other uses of "wake" about
  builders and agents in general now say "resume": `dispatching.md` (twice),
  `worktree-hygiene.md`, `fixer.md` and `concurrency.md`.
