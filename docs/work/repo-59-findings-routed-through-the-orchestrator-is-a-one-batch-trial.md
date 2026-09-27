---
id: repo-59
tool: repo
title: Findings routed through the orchestrator is a one-batch trial, with a revert criterion
kind: chore
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-59 — Findings routed through the orchestrator is a one-batch trial, with a revert criterion

## Why

The orchestration rework of 2026-09-26 moved a gate's findings back through the
orchestrator: the gate returns its section and findings to the orchestrator,
which pastes them to a resumed builder or a fresh `fixer`, and the gate never
sees the build's report (`orchestrate-tickets` steps 4 to 8). From 2026-09-01
to that date the gate messaged the builder directly, a design adopted because
both relay corruptions recorded until then were introduced at the orchestrator
hop.

The owner accepted the reversal on 2026-09-26 **as a one-batch trial**, on the
assessment below, and asked for a stated revert criterion. The assessment, in
full, so the row that closes this can be held against it:

- **Relay reliability.** Three orchestrator relay failures are recorded in
  `reference/history.md`, and all three were paraphrases — a sound-premise
  finding relayed as a conclusion, a citation given as fact that was a
  sibling's, a gate record described instead of pasted. No pasted relay has
  failed. The peer channel's recorded failures were silent: two messages queued
  and never read (2026-09-13), a resumed builder's final report lost
  (2026-09-14), three exchanges dead on type-name addressing, and one pair that
  agreed and then both stopped (repo-19). The hub's failure mode is the visible
  one, and the paste rule targets its recorded cause.
- **Quality.** Two structural gains: the gate cannot confirm a build report it
  never sees, and step 7's verdict comparison per acceptance line is a check
  nobody performed before. The fixer route rests on one measurement — a
  one-line reword at 70,665 on Haiku against a 784,264 resume (repo-56).
- **Token cost.** The orchestrator already received every gate's findings in
  full under the peer design; the new cost is the outbound paste and one or two
  turns per round. A committed gate section is 9.6 KB at the median and 21 KB at
  the 90th percentile over 112 records, roughly 2.5 k to 5 k tokens. One
  orchestrator turn at the measured context costs about $0.14 on Opus 5 and
  about $0.06 on Opus 5.5, so a round adds $0.20 to $0.50 against agents that
  cost $0.50 to $9 each. Context grows about 5 k tokens per round.
- **The unmeasured cost is throughput.** Under peer messaging a builder and a
  gate iterated without waiting on the orchestrator. Now every round waits on
  one serial actor that is running the other tickets too. Nothing measured
  says by how much; that is what this ticket measures.

**Baseline**, the two orchestration sessions on the devcontainer, priced with
`node scripts/agent-cost.mjs --agent …` on 2026-09-26 under the peer design:

| Session            | Agents | Orchestrator billed turns | Mean context per turn | Orchestrator | Agents | Orchestrator share |
| ------------------ | ------ | ------------------------- | --------------------- | ------------ | ------ | ------------------ |
| `25f57670`, Opus 5 | 21     | 258                       | 269 k                 | $54.63       | $15.85 | 78%                |
| `3824926b`, Opus 5 | 7      | 125                       | 215 k                 | $24.02       | $40.05 | 37%                |

## Build

**Done by the orchestrator of the first batch dispatched under the 2026-09-26
definitions, at its close-out (`SKILL.md` step 12) — not by a dispatched
builder.** A builder that picks this up before such a batch has run stops and
reports, per the maintenance rule.

1. Price the batch with one `node scripts/agent-cost.mjs --agent <id> …` over
   every agent id the batch dispatched. Record the orchestrator row's share of
   the total, and the `cold=` count of every builder and gate.
2. For every round of every ticket, measure the **hop**: the last timestamp in
   the gate's transcript to the first timestamp in the transcript of the agent
   that received its findings — the resumed builder's next record, or the
   fixer's first. Beside it, the `active=` figure of that receiving agent's
   round. Per ticket, record the number of rounds and the wall time from the
   builder's dispatch to the pull request opening.
3. Put all of it in the batch's history row, and evaluate the criterion below
   in this ticket's Log.

## The revert criterion

**Revert if, over the batch's rounds, the median hop exceeds the median active
time of the round it carried, or any hop exceeds one hour.** The first says the
wait on the orchestrator cost more than the work it delivered; the second is the
cache TTL, past which the receiving wake is cold as well as late
(`sizing.md`). A trip means the revert is the default, decided in advance by
the owner: the orchestrator files the revert ticket — restore `SendMessage` and
`ListAgents` on the builder and gate definitions, retire the `fixer`, restore
step 5's direct addressing from `dispatching.md`'s _What was measured about the
channel_ — and puts it to the owner as the batch's close-out question with the
figures attached. The owner may still keep the design; the ticket is what makes
that a decision rather than a drift.

The threshold is a proposal by the agent that filed this, chosen because both
halves are readable from timestamps `agent-cost.mjs` already parses; the owner
did not set a number. Correct it here before the batch if it is wrong.

## Done when

- The first batch's history row carries the orchestrator share, every builder's
  and gate's `cold=`, and per ticket the rounds, the dispatch-to-PR wall time
  and each round's hop beside its active time.
- This ticket's Log states the median hop, the median active time, the longest
  hop, and whether the criterion tripped.
- Tripped: a revert ticket is filed and named here, and the close-out put it to
  the owner. Not tripped: the trial is over, and the sentence in
  `orchestrate-tickets` step 6 that names this ticket is removed in the same
  pull request.

## Review

**Gate: FAIL** — 2026-09-27 · `e50cf81...f350477` · code-review at medium (a maintenance ticket carrying no source diff; the depth applied was tracing every checkable claim and rule edit against origin/main and the raw batch transcripts) · `origin/main` moved to `5ecebb0` (#293, repo-58) after this branch was cut; that commit touches nothing this ticket names.

| Done when                                                                                                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first batch history row carries the orchestrator share, every builder and gate `cold=`, and per ticket the rounds, dispatch-to-PR wall time and each round hop beside its active time | proven — `.claude/skills/orchestrate-tickets/reference/history.md`, "## Session 2026-09-26 — base a1a417b": the Per agent table gives `cold=0` on every builder and gate row (`cold=1` appears once, on the one fixer item 9 names as the exception), and the Hops table pairs each hop with the receiving round active time; round counts and wall times are given per ticket below that table |
| This ticket Log states the median hop, the median active time, the longest hop, and whether the criterion tripped                                                                         | proven — the Log entry dated 2026-09-26 states all four, and each is independently reproducible from the batch task transcripts (see findings below)                                                                                                                                                                                                                                            |
| Not tripped: the trial is over, and the sentence in orchestrate-tickets step 6 that names this ticket is removed in the same pull request                                                 | **FAILED** — see the high finding below                                                                                                                                                                                                                                                                                                                                                         |

- **high** · The criterion did not trip (confirmed independently below), so Done-when line 3 requires the SKILL.md step 6 sentence naming this ticket be removed in this pull request. It was not: `.claude/skills/orchestrate-tickets/SKILL.md@e50cf81:124 "one-batch trial"` reads identically on this branch head, and `git diff e50cf81..f350477 -- .claude/skills/orchestrate-tickets/SKILL.md` touches only step 9 (the `--title` caveat) and the relaying table — never lines 120-126, which still link this ticket and say the routing "is a one-batch trial."
- **med** · `roles/reviewer.md`, under "## When you are woken to re-gate," now tells a re-gating gate: "If the round moved lines your earlier sections cite, return a corrected copy of each as a file — words and verdicts unchanged, coordinates re-resolved against the new head." `records.md@e50cf81:65 "The lander does that pinning"` assigns the identical repair, for the identical situation (a later fix moving the lines an earlier, already-committed round cited), to the lander instead — "the reviewer returns text and never edits a file... not the builder editing the record." Neither page acknowledges the other. A re-gated gate this batch already had two instructions in conflict for who repairs a moved coordinate.
- **med** · `agents/seam-mapper.md`'s new example: "On 2026-09-26 every hit was that shape (dl-45, dl-57, dl-68, and repo-52)." No branch in the batch touches `dl-45` — `git log --oneline --all -- tools/downloader/docs/work/dl-45-keep-the-failover-mirrors.md` was last touched by dl-56, before this batch. dl-69 (PR #289, head `55c40b3`) instead displaces citations in `dl-55` and `dl-68`; the named pair should very likely read `dl-55, dl-57, dl-68, and repo-52` — one digit off in the rule own worked example.
- **med** · The Log entry this ticket carries ends "This dispatch closed repo-59 and filed two follow-up tickets (`repo-61`, `repo-62`) from the skill findings." That is stale on the branch that wrote it: `repo-61` was filed in `12779a1`, then deleted in the very next commit, `f350477` ("withdraw repo-61"). No correction, no `WITHDRAWN` marker, no forward pointer, per the discipline `records.md@e50cf81:35 "withdrawn in place, never deleted"` states for a claim that reached a record.
- **low** · `.claude/skills/orchestrate-tickets/SKILL.md` step 12 still reads "The first batch under the 2026-09-26 definitions also closes repo-59" — accurate as history, but with the trial now over and this ticket done, nothing marks the sentence closed, and it is the last place in the skill naming this ticket at all.
- **findings** · code-review at medium returned 5; 5 carried, 0 dropped.
- NFR: security n/a (no source change) · performance n/a · reliability — a future orchestrator reading step 6 as it stands is told the trial is still live, contradicting a done ticket · maintainability — the reviewer.md/records.md conflict above is the concern.

### Gate 2

**Verdict: FAIL** — 2026-09-27 · `f350477..423e8ad` · re-gate of gate 1 findings only, code-review at medium on the lines this round touched

Gate 1 findings, verdicts:

- **high** (SKILL.md step 6 sentence not removed) — **fixed**. Verified `grep -c repo-59 .claude/skills/orchestrate-tickets/SKILL.md` = 0 (matches the coordinator own check). Step 6 paragraph replaced with an inline measurement, no ticket link; step 12 lost its own repo-59 sentence too, which was the low finding below.
- **med** (`roles/reviewer.md` re-gate bullet contradicts `records.md`'s "the lander does that pinning") — **fixed**. `records.md` now reads: "The lander does that pinning, when it transcribes the multi-round section — unless a re-gating reviewer has already returned its earlier sections re-resolved against the new head, as `roles/reviewer.md` asks since 2026-09-26, in which case the lander commits those as given." This names the reviewer.md bullet as the exception path rather than leaving two silent, conflicting instructions. `roles/reviewer.md` itself is unchanged this round and still agrees with the new text.
- **med** (`agents/seam-mapper.md`'s "dl-45" example does not match any branch in the batch) — **fixed**, and more accurate than gate 1 asked for. The line now reads "(dl-57 and dl-63 by dl-70, dl-55 and dl-68 by dl-69, and repo-52 by repo-50)". I had verified dl-55 and dl-68 for dl-69 and repo-52 for repo-50 at gate 1; re-checked dl-63 now: `git diff a1a417b 512fcb5 -- tools/downloader/docs/work/dl-63-ipv6-special-ranges.md` shows the same shape — a pin repointed from `1a502348816d545aae3ca1656d29163e7de03c78:132` to `a1a417b:132` in a merged record dl-70 displaced. The corrected list is fully accurate; gate 1 itself missed that dl-63 was also omitted, and this round fixed that too.
- **med** (this ticket Log claims "filed two follow-up tickets (`repo-61`, `repo-62`)" without noting `repo-61`'s withdrawal in the same branch) — **fixed**. A new dated Log entry ("2026-09-27 — Correction to the entry above") states the true state without deleting the original, consistent with `records.md`'s withdrawn-in-place discipline even though it does not use the literal `WITHDRAWN` marker.
- **low** (`SKILL.md` step 12 stale "also closes repo-59" sentence) — **fixed** as a side effect of the same edit that fixed the high finding; both paragraphs naming this ticket are gone from `SKILL.md`.

Cross-check requested by the coordinator: `roles/reviewer.md`'s re-gate bullet and `records.md`'s new sentence now agree — reviewer.md says a re-gating gate returns "a corrected copy of each as a file... coordinates re-resolved against the new head," and records.md says that when it has, "the lander commits those as given." I swept `.claude/skills/orchestrate-tickets/` for every other mention of "lander" and "re-resolv" (`grep -rn`): `.claude/skills/orchestrate-tickets/reference/history.md@e50cf81:3982 "cannot be re-resolved by the reviewer"`, from the twentieth session (2026-09-20, superseded), still states the old rule — but that page is dated provenance, not an active instruction (its own preamble says it is kept out of SKILL.md because it is evidence rather than instruction), and it predates this branch change by six sessions. No other active rule page in roles, reference/dispatching.md or agents/fixer.md asserts the lander alone re-resolves at re-gate.

Gate 1 own section cited nothing on the branch tip: all three substantive citations named there were pinned to the main commit this ticket was based on, which this round cannot move. No corrected copy is needed; the words and verdicts in gate 1 are unchanged.

New problem in the file this round touched:

- **high** · **Gate 1's `## Review` section was never committed.** The ticket carries `status: done` and, per this diff, the round edited `docs/work/repo-59-findings-routed-through-the-orchestrator-is-a-one-batch-trial.md` (the Log correction) — but the file has no `## Review` heading anywhere: `grep -n "^## Review\|^## Log"` finds only `## Log`. `node scripts/preflight.mjs --base origin/main --title "chore(repo): record the 2026-09-26 batch and fold its defects into the role pages (repo-59)"` exits 5: `review FAIL docs/work/repo-59-...md is marked done but has no ## Review section`. This is precisely the failure `roles/builder.md`'s own new rule (this batch's own item 1 fix) exists to prevent, and it blocks this round from shipping regardless of the five findings above all being fixed. None of the fixer's four claimed commands (`oxfmt --check`, `citations-gate.mjs`, `status.mjs --json`, `git diff --stat`) is `preflight.mjs`; all four reproduce true, and none of them was sufficient. Landing this round requires committing gate 1's section (unedited: `/tmp/claude-1000/-workspaces-tools/211b7201-90ab-4171-9754-2cfed46f95af/scratchpad/repo-59/records/gate1-review.md`) and this `### Gate 2` subsection together, above `## Log`.

Fixer claims, reproduced:

- `npx oxfmt --check .` → 0. Reproduced: exit 0, "All matched files use the correct format."
- `node scripts/citations-gate.mjs --against origin/main` → 0. Reproduced: exit 0, "106 enforced, 0 failing... 0 raised."
- `node scripts/status.mjs --json` → 0. Reproduced: exit 0.
- `git diff --stat f350477..423e8ad` → 5 files. Reproduced: 5 files exactly (seam-mapper.md, SKILL.md, history.md, records.md, the repo-59 ticket).

- **findings** — 5 named findings from gate 1: 5 fixed, 0 refuted. 1 new finding this round: 1 carried (high), 0 dropped.
- NFR: security n/a · performance n/a · reliability — unchanged from gate 1 other than the new finding above · maintainability — the records.md/reviewer.md reconciliation is a real improvement; the missing `## Review` section is the opposite.

## Log

- 2026-09-26 — filed on the owner's decision to accept the routing reversal as a
  one-batch trial. The assessment and baseline above were taken in the session
  that reviewed the rework; nothing has run under the new definitions yet.
- 2026-09-26 — the trial ran on the 2026-09-26 batch (4 tickets, 8 gates, 28
  dispatches including wakes). **Criterion not tripped.** Median hop 42 s,
  median receiving active 9m35s, maximum hop 11m08s (owner decisions, both
  times). Orchestrator share 8.0% against baseline 78% and 37%; both halves
  from `node scripts/agent-cost.mjs` at the batch's task files. `cold=` on
  every builder and gate: 0 — the 1-hour TTL held. Wall times: pl-51 3 rounds
  ~37 m; dl-70 2 rounds ~36 m; dl-69 2 rounds ~1h46m total (record repaired
  +8 m); repo-50 3 rounds ~2h32m total (record repaired +10 m). The routing
  stays. This dispatch closed repo-59 and filed two follow-up tickets (`repo-61`,
  `repo-62`) from the skill's findings.
- 2026-09-27 — **Correction to the entry above:** `repo-61` was withdrawn before
  merge and never landed — `scripts/preflight.mjs` already takes `--title`, and
  `orchestrate-tickets` step 9 now passes it. Only `repo-62` was filed. The step 6
  sentence naming this ticket is removed per this ticket's third Done-when line,
  which the first push of this branch missed (gate 1, high).
