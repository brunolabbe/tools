---
id: repo-111
tool: repo
title: Re-gate fresh, run three tickets at once, offer batches by tool, and push before the suites
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
awaiting: Done when 17 — the first batch under these rules; per ticket, whether CI on the draft went red on something the dropped local suite run would have caught
---

# repo-111 — A fresh gate 2, three tickets in flight, batches by tool, no suite before the gate

## Why

The owner asked on 2026-10-18 why gates take so long. The answer was measured
on lg-40 (PR #548, a one-ticket batch on base 960f4b26), from its three agent
transcripts: builder `a9dd02de949ac55d2`, gate `a5490055183b61b89`, fixer
`aacd38c83247e1abd`, under
`~/.claude/projects/-workspaces-tools/76d8bfd3-5bf4-4dc1-8f0f-5cfd08c6379a/subagents/`.
[lg-40's clock](../../.claude/skills/orchestrate-tickets/reference/lg-40-timeline.drawio.svg)
is the measurement that motivated this change, and
[the flow](../../.claude/skills/orchestrate-tickets/reference/flow.drawio.svg)
is the loop as it runs under it.

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

**A builder ran the tool's suites up to four times per ticket**: preflight
before its push, preflight again in each round, the landing's `--land`
preflight, and CI on the draft, and the gate waited for the first of them,
since the draft opened only after it. `roles/builder.md` quoted "a
twelve-minute preflight"; measured on 2026-10-18 at `335efcd4` (dl-129's
filing, branch `dl-129-trim-the-browser-resolver-suite`, PR #568), a
downloader preflight is about two to three minutes:
`npm test -- --project downloader` ran 84.30, 104.16 and 101.88 s, and
`npm run check` 9 s on a built tree.

**Intake asked for a batch but not for the decisions inside it.** The reason
relayed with the owner's decision is that lg-30, lg-32, lg-33, lg-39 and lg-40
each came back from gate 1 with a `med` that was an open decision (about 74
minutes of round and gate 2 on lg-40). Read against the files, that reason
does not hold as stated; see the Log of 2026-10-18, round 2.

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

Later the same day, each from options the Fable session put with
`AskUserQuestion`:

- **Intake offers batches by tool, under the cap, and asks the candidates'
  open decisions in the same checkpoint.** Options: one question whose options
  are batches by tool (recommended, **chosen**); a separate tool question
  first; the orchestrator picks when the owner names no tool. The orchestrator
  still never picks the batch.
- **Push and open the draft before the slow checks, and run no suite in the
  fix round.** Offered as points 3 and 4 beside the first two; the owner: "1,
  2, 3 and 4 seem like real wins". The quality trade is that a gate may open a
  head CI has not yet proven, which it already grades `unproven (gate)`.
- **How this ticket lands: a WAIVED record and `status: done` in this pull
  request.** Options: WAIVED record, status done (recommended, **chosen**);
  leave `ready` and close it later.
- **A third gate, when one runs, is a fresh dispatch too**, taken under this
  ticket on its builder's note that no page said how a gate 3 runs; gate 3's
  rules are otherwise unchanged.

**Re-asked 2026-10-18, after the premise of the intake rule was refuted** (Log,
round 2): none of the five ledger tickets named as its reason carried a
`## Decision` heading, and every open decision in their `## Review` sections
was a gate finding. Options: **keep A as built** (recommended by the builder
and the Fable session, **chosen**); trim it to batches by tool. The reason that
stands for asking open decisions at intake is the cheap one: a decision a
brief already poses costs a question at intake, or a round after gate 1. The
claim that it would have saved those five rounds is withdrawn, and the benefit
is unmeasured.

**A gate dispatch carries a sweep budget** (owner, 2026-10-18, from the
options "fold into repo-111" (recommended, **chosen**), "file as repo-112" and
"leave it"). Each probe a gate prompt asks for names its population, the
prompt names one time budget for all sweeps (15 minutes by default), and a
search the orchestrator cannot size becomes a measurement ticket. The reason
is lg-59's gate 1 and lg-40's gate 2 (Log, round 4).

**Points 3 and 4 re-asked 2026-10-18 with a measurement: keep 3, revert 4.**
The owner had kept both on the premise of a ten-to-twelve-minute downloader
preflight. dl-129's filing (branch `dl-129-trim-the-browser-resolver-suite`,
draft PR #568, measured at base `335efcd4`) found
`npm test -- --project downloader` at 84.30, 104.16 and 101.88 s in a fresh
worktree (124 files, 2,590 tests; runs 2 and 3 beside other agents' vitest
workers), with `parallel-ranges.test.ts` finishing 18–20 s after the rest, and
CI's `npm test` step at `335efcd4` (run 39126762378) at 231 s on ubuntu and
388 s on Windows; the Fable session timed `npm run check` at 9 s. The old
figures predate dl-117 (merged 2026-10-16). Options, put by the Fable session
with `AskUserQuestion`: **keep 3, revert 4** (recommended, **chosen**); keep
both; revert both. So the builder's first build still skips the suites (point
3, and Done when 17's `awaiting:` stands), and a fix round runs preflight in
full before its push again (point 4 reverted).

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
   provenance of every change here, linking the two figures, which are copied
   into `reference/`.
7. `SKILL.md` step 2 and `.claude/agents/seam-mapper.md`'s _What you return_:
   batches by tool, a held tool left out or offered beside its session, open
   decisions quoted by the seam map and asked at intake.
8. `roles/builder.md` _Before you report_, _Your report_ and _When you are
   resumed with findings_, and `roles/fixer.md` _The work_: `npm run check`
   and `preflight.mjs --only mergeTree,ciCommands,review,title`, no full
   suite; `SKILL.md` step 4 reads CI's state on the head; `reference/sizing.md`
   says the suites run twice per ticket. **Superseded in part by the re-ask of points 3 and 4 (Decision, "keep 3, revert 4"):** the round
   runs preflight in full again (Build 11).
9. `SKILL.md` step 8: a third gate is a fresh dispatch too.
10. The sweep budget: `reference/dispatching.md` _A gate prompt carries_,
    `roles/reviewer.md` _What makes a gate worth its cost_,
    `reference/sizing.md` _What a batch pays for_, and
    `reference/model-pairing.md`'s 2026-10-18 section.
11. The re-ask of points 3 and 4: restore the round's full preflight in
    `roles/builder.md` and `roles/fixer.md` from their `origin/main` wording,
    reword `reference/sizing.md` and `SKILL.md` step 4 to match, and replace
    every stale preflight or suite figure with the dl-129 measurement.

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
   provenance of every change here — the options, the owner's choice, the
   measurement — and links to both figures; `git check-ignore` prints nothing
   for either figure's path.
8. This ticket's Log carries the recipe that recomputes the gate's
   cache-read figures and its output: 99 and 73 responses, 16,953,045 and
   28,624,318 cache-read tokens.
9. `npm run check` exits 0 and preflight exits 0 on the branch.
10. `SKILL.md` step 2 makes each `AskUserQuestion` option one tool's batch of
    at most the cap, recommended first with seam notes and a rough cost; leaves
    out a tool another session holds or offers it as "beside <session>'s
    batch"; offers only the named tool's batches when the owner named one, and
    otherwise recommends the tool with the most unblocked `ready` tickets; and
    asks the candidates' open decisions in the same checkpoint.
11. `.claude/agents/seam-mapper.md` _What you return_ groups candidates by
    tool and quotes each candidate's open-decision lines as findings, still
    under about forty lines.
12. `roles/builder.md` _Before you report_ has the builder run `npm run check`
    and `preflight.mjs --only mergeTree,ciCommands,review,title`, then push
    and open the draft, and run no full suite; _Your report_ asks for CI's
    state on the head; _When you are resumed with findings_ step 2 runs no
    full suite. **Superseded in part by the re-ask of points 3 and 4 (Decision, "keep 3, revert 4"):** its last clause; Done when 23 replaces it.
13. `roles/fixer.md` _The work_ runs `npm run check` and the fast preflight
    checks for a round, and no full suite. **Superseded by the re-ask of
    points 3 and 4 (Decision, "keep 3, revert 4"):** Done when 23 replaces it.
14. `SKILL.md` step 4 checks CI's state on the head in place of a local suite
    run, and `reference/sizing.md` _What a batch pays for_ says the suites run
    twice per ticket. **Superseded in part by the re-ask of points 3 and 4 (Decision, "keep 3, revert 4"):** the sizing clause; Done when 23 replaces
    it.
15. `SKILL.md` step 8 says a third gate is also a fresh dispatch.
16. `## Review` carries the owner's WAIVED line, `status` is `done`, and
    `node scripts/status.mjs --json` exits 0.
17. The first batch under these rules records, per ticket, whether CI on the
    draft went red on something the dropped local suite run would have
    caught. A gate cannot prove this before the merge; it is owed in the Log.
18. `reference/dispatching.md` _A gate prompt carries_ has each probe name its
    population (the alphabet, or the seed and the count), one time budget for
    all sweeps (15 minutes by default), sizing before writing, and "a search
    you cannot size … is a measurement ticket".
19. `roles/reviewer.md` _What makes a gate worth its cost_ keeps "Enumerate,
    never sample" unchanged and adds, beside it, a sweep budget: no sweep
    started once it is spent, the covered population reported as a finding
    with `unproven` for what the uncovered part carries, and one background
    job with one exit file past the 600 s cap, waited on once rather than
    polled, saying that every poll is a turn re-reading the transcript.
20. `reference/sizing.md` _What a batch pays for_ has one bullet with the
    lg-59 and lg-40 wait figures.
21. `reference/model-pairing.md`'s 2026-10-18 section has the sweep-budget
    decision, its three options and the lg-59 measurement.
22. `roles/common.md` _Preflight runs longer than a foreground call allows_
    scopes its recipe to preflight, `--land` and a suite run, and sends a
    gate's sweeps to `roles/reviewer.md` _What makes a gate worth its cost_ by
    name, with the reason that every poll re-reads a large transcript.
23. `roles/builder.md` _When you are resumed with findings_ step 2 and
    `roles/fixer.md` _The work_ carry their pre-branch wording (a round runs
    preflight in full before its push), with the measured figure in place of
    the old one; `reference/sizing.md` says a first build runs no suite
    locally and the suites still run in each round's preflight, the landing's
    `--land` and CI on every push; `SKILL.md` step 4 says "a first build runs
    no full suite".
24. `grep -rn -E '598 s|twelve-minute|ten minutes|10–12 min|nine minutes|9 min' .claude/skills docs/work/repo-111-*.md`,
    outside `reference/history.md`, the two figures and quotations of the old
    figure, prints no current claim that a downloader preflight or suite takes
    that long; the Log lists the matches before and after.

## Review

**Gate: WAIVED** — 2026-10-18 · Bruno Labbé (owner) · the owner's own rule edit, built on the owner's decisions with no gate (adr/006 point 6); chosen in AskUserQuestion, transcribed by the builder.

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
  from a state its own tests never began from". Five other uses of "wake" about
  builders and agents in general now say "resume": `dispatching.md` (twice),
  `worktree-hygiene.md`, `fixer.md` and `concurrency.md`.
- **Checks, at the head before this entry (`4aeb22d9`).** `npm run check`
  exit 0. `node scripts/preflight.mjs --base origin/main`, titled as the pull
  request, exit 0: `no conflicts with any other open pull request head`
  (8 heads), `ok    npm run check`,
  `ok    npx vitest run scripts/test/status.test.ts`,
  `preflight passed (exit 0)`. `git check-ignore` on both figure paths printed
  nothing (exit 1).
- **Unmeasured:** whether a fresh gate 2 costs less than lg-40's woken one. The
  first batch under the rule is the reading.

**2026-10-18, round 2 — four more rule changes and the landing** (same
builder, resumed by the owner's Fable session with the decisions above).

- **The intake reason does not survive the files.** Relayed: lg-30, lg-32,
  lg-33, lg-39 and lg-40 each came back from gate 1 with a `med` that was an
  open decision, each costing a round and a gate 2. Run in
  `tools/ledger/docs/work/`,
  `grep -n '^## Decision\|^### Gate\|^## Review' lg-30-*.md lg-32-*.md lg-33-*.md lg-39-*.md lg-40-*.md`
  prints a `## Review` for all five, a `### Gate 2` for lg-33, lg-39 and lg-40
  only, and **no `## Decision` heading in any of them**. Each of those meds
  reads "no `Done when` line depends on it" and was raised by the gate's own
  probes (lg-40's F1/F2 by a sweep over reordered days). An intake question
  could not have asked them, and lg-30 and lg-32 paid no gate 2. The rule
  stands as the owner chose it; its recorded reason in `model-pairing.md` says
  this, and its benefit is unmeasured.
- **`--only` cannot say "everything but the suites"**: `preflight.mjs`'s
  `check` runs `npm run check` and then `npm test -- --project <tool>` per
  touched tool (its header, check 1). So the builder runs `npm run check`
  itself beside `--only mergeTree,ciCommands,review,title`. **Follow-up for a
  later ticket, not filed here:** a preflight flag that skips only the suites.
  `ciCommands` is added to the three checks the dispatch named: it is `ci.yml`'s
  own check job (lockfile sync, `status.mjs --json`, `status.test.ts`), and the
  four ran in 16.2 s on this branch (`date +%s.%N` either side:
  1792363313.84 → 1792363330.07), last line
  `preflight passed (only mergeTree, ciCommands, review, title; the other checks did not run) (exit 0)`.
- **Owed by the first batch under these rules** (Done when 17): per ticket,
  whether CI on the draft went red on something the dropped local suite run
  would have caught. Whoever runs that batch records it in its history entry.
- **Superseded:** the first entry's "`status` stays `ready`". The owner chose
  a WAIVED record and `done`; `## Review` carries the owner's words as given,
  transcribed by the builder. It has neither half `docs/01-TICKETS.md` asks of
  a gate record, because no gate ran.
- **The brief had wrong:** `SKILL.md` step 1 runs `ListAgents` but not
  `git worktree list`, so step 2 names both.
- **Folded in:** `roles/fixer.md`'s landing bullet said to post "the
  `report.md` your dispatch names … the orchestrator wrote it", where
  `SKILL.md` step 9 has the gate write `gate-<n>@<sha>.full.md` and the
  harness refuse `report.md`. It now names the `.full.md`.
- **The flow figure is redrawn** by the Fable session for the rules as they
  stand after this change and copied over `reference/flow.drawio.svg`; three
  historical "woken" mentions stay in its notes, outside Done when 4's `*.md`
  pathspec.

**2026-10-18, round 3 — the owner's answers to round 2's open decisions.**

- **Decision A re-asked and kept.** The Fable session re-ran the count at
  `origin/main` and the owner chose "keep A as built" over "trim to batches by
  tool"; the recommendation was the builder's and the Fable session's. Re-run
  here at `origin/main` = `335efcd4`:
  `git grep -c '^## Decision' origin/main -- <the five lg-30, lg-32, lg-33, lg-39, lg-40 ticket paths>`
  printed nothing and exited 1, which is zero matches in each of the five.
  The Decision section records the answer and the reason that stands.
- **`awaiting:` added** for Done when 17, by the owner's choice (option a),
  in the shape of the existing lines; the Log bullet of round 2 stays as the
  account of why it is owed.
- **Retitled the pull request** to
  `docs(repo): fresh gate 2, three in flight, batches by tool, no suite before the gate (repo-111)`,
  option (a); the ticket's own title already names the four.

**2026-10-18, round 4 — a sweep budget for gates**, the owner's decision
above, folded in. The lg-59 figures were relayed from a gate still running;
re-read here from its transcript,
`196311b6-27e1-4ec1-a958-40fd27d0130d/subagents/agent-a2fd8c8650f059328.jsonl`
(`ticket-reviewer-sonnet`, "Gate 1 lg-59"), with this branch's scratch
scripts:

- `split.py <transcript> 2026-10-18T22:57:00Z` printed
  `gate 1: 153 responses, 29,710,447 cache-read, 194,185 per response` and
  `gate 2: 2 responses, 636,875 cache-read, 318,437 per response` — the second
  line is the two responses after 22:57Z, not a gate 2. So 155 responses; the
  relayed "~322k re-read per turn" is its latest turns, and the mean is 196k.
- `span.py` printed a first record at `21:24:40.517Z` and a last at
  `22:57:28.037Z`: 92.8 minutes.
- `waits.py <transcript>` (each Bash call whose command waits, with its
  duration) printed `tool calls: 167, 72.1 min inside; waits: 14, 49.5 min, 0
at the 600 s cap`. Its match counts two non-waits (a `kill … sleep 1` of
  1.5 s and a `sleep 200; ls` of 0.0 s): 12 finished waits, 49.5 minutes, and
  a 13th still open at 22:57:28Z, which matches the relayed 13. Four of the
  finished ones, 585.4–589.4 s, are the 600 s cap (the script's 595 s
  threshold missed them); the open one is the relayed fifth.
- **Not re-run:** the relayed split of the rest into 13 minutes of probes and
  22 of model time.

**2026-10-18, round 5 — `common.md` and `reviewer.md` reconciled.** Round 4's
report found `roles/common.md`'s wait recipe (`until [ -s <exit file> ]`, and
"start another" past the cap) prescribing the polling the new reviewer rule
forbids for a gate's sweeps. The owner's session chose to keep the recipe for
preflight, `--land` and a suite run, where the agent has nothing else to do,
and to scope it there with a pointer to the reviewer rule (Done when 22). The
per-turn figure for lg-59 now reads "about 318k a turn after 155 of them, 196k
on average" on `reviewer.md` and `model-pairing.md`, so neither number stands
for the other; `git grep -n -E '318k|322k|196k|194k' -- .claude/skills` is how
the two places were found.

**2026-10-18, round 6 — points 3 and 4 re-asked; stale figures replaced.**
The owner's answer and its measurement are in the Decision section. The
measurement is dl-129's filing (branch `dl-129-trim-the-browser-resolver-suite`,
draft PR #568); its CI figures were re-read here with
`gh run view 39126762378 --json headSha,jobs`: head `335efcd4`, ubuntu
`Run npm test` 12:20:09Z → 12:24:00Z (231 s), Windows 12:20:18Z → 12:26:46Z
(388 s). The local runs and the 9 s `npm run check` are relayed, not re-run.

- **Restored:** `roles/builder.md` _When you are resumed with findings_ step 2
  is `origin/main`'s line again (`git diff origin/main` on the file no longer
  touches it), and `roles/fixer.md` _The work_ carries `origin/main`'s
  preflight bullet and exit-16 bullet, with "two to three minutes on a
  downloader branch … (dl-129's filing, PR #568, 2026-10-18)" in place of "ten
  minutes". The first-build rule in _Before you report_ stays; its exit-16
  line now reads "none of the checks after it has run", true for both runs.
- **Figures**, from
  `grep -rn -E '598 s|twelve-minute|ten minutes|10–12 min|nine minutes|9 min' .claude/skills docs/work/repo-111-*.md`
  outside `reference/history.md` (plus "ten to twelve", the spelling this
  branch used). Before:
  - `roles/builder.md` 107: "`--land` runs preflight in full once per ticket —
    ten to twelve minutes on a downloader branch" → replaced by the measured
    84–104 s project and 9 s check, sourced.
  - `roles/common.md` 115: "a downloader preflight runs past it (598 s for the
    suite alone)" → "A downloader preflight fits inside it now — its project
    ran 84–104 s on 2026-10-18 at `335efcd4` … where it ran 598 s before
    dl-117".
  - `roles/fixer.md` 42: "a full run here costs ten to twelve minutes on a
    downloader branch" → removed with the reverted round bullet.
  - this ticket's Why, 63–64: "A downloader preflight is ten to twelve
    minutes" → the measured figure, sourced.
  - this ticket's Log, 48: "for 39 minutes" — a false positive of `9 min`.
  - `review-ticket/gate.md` 99: "the downloader project runs nine minutes" —
    **not in this branch's diff, left as it is; a stale line for the next
    review session.**

  After: the same grep prints `common.md`'s "598 s before dl-117" and
  `model-pairing.md`'s and this ticket's "ten-to-twelve-minute" and "a
  twelve-minute preflight", each quoting the old figure as old; the Log's
  "39 minutes"; this ticket's Done when 24; and `gate.md` 99.

- **Not replaced: the two figures.** `reference/flow.drawio.svg` still says
  "preflight 10–12 min on a downloader branch", "downloader project ≈9 min",
  "downloader ≈9–10 min", "preflight.mjs ≈10–12 min", and draws the reverted
  rule ("No preflight", "report (no preflight in the round)"). Its text lives
  twice, rendered and in the embedded diagram model, so it is the Fable
  session's to regenerate. `lg-40-timeline.drawio.svg` is a dated measurement
  and stays.
- **`origin/main` moved** to `f58473f4` (lg-56, lg-41, dl-128, repo-110,
  lg-52) during this round. None of it touches a path on this branch, and
  preflight diffs `origin/main...HEAD`, so the branch was not merged.
