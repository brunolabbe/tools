---
id: repo-139
tool: repo
title: Measure a Sonnet gate on standard tickets against the Opus gates in the log
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
awaiting: Done when 3 — the tools-86 batch close-log PR merges to main, and its reference/history.md entry names repo-139 and carries Table 1, Table 2 and the comparison rows of this Log
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

## Review

**Gate: FAIL** — 2026-11-10 · `a100f429..a72e9c53` · Opus 5.5, depth medium. Measurement ticket; the branch also files repo-145 (`needs-decision`), checked as one finding block against the checks the dispatch supplied. Build skipped: the diff is two markdown files. PR #792 at `a72e9c53`: `check` (CI and pr-title), `changes`, `codeql`, `CodeQL`, `dependency-review` success; the test matrix skipped (all-`.md` diff).

| Done when                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Three `standard` tickets have a Sonnet gate 1 in their `## Review`, the model in the header                 | **verified** by reading: repo-135 and repo-143 on `origin/main`, repo-129 on `repo-129-split-isolation` at `b06ff43f` (PR #783 open, as the dispatch directs); each header reads "Sonnet 5.5, depth medium (repo-139's measurement…)", all three are `difficulty: standard`, and each agent's transcript names its ticket and head sha and its type `ticket-reviewer-sonnet`                                                                                                                                                                       |
| 2. Both tables in the Log, every cost from `agent-cost.mjs`, every count from a gate's own section             | **verified**: `node scripts/agent-cost.mjs` with the 13 `--agent` ids gives every cost, active and wall in the Log to four decimals (Sonnet total $5.5480, mean $1.8493; Opus $33.5254, $3.3525); each id's first prompt names the ticket and head sha its row gives; all 13 verdicts and high/med/low/dropped counts equal the gate-1 sections; ratio, carried means (4.0, 4.2), dropped means (3.3, 3.7) and per-finding costs ($0.46, $0.80) recompute. Depth column matches the sections (five `full`, two `standard`, two `medium`, one both) |
| 3. The batch's `reference/history.md` entry names this ticket and carries the same rows                        | **awaiting** — the merge of the tools-86 batch's close-log pull request to `main`; the reading is that its `reference/history.md` entry names repo-139 and carries the rows of the build's `history-rows.md` (the 13 costs to the cent, verdicts and high/med/low counts), which today match the Log to the cent (F4)                                                                                                                                                                                                                              |
| 4. A follow-up `needs-decision` ticket names the row change with these numbers, or the Log closes the question | **verified**: repo-145, `needs-decision`, reproduction is the Log's table; its option pricing is F1                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Check (from the dispatch): repo-145's format, id and fields                                                    | **verified**: `npm run -s status -- --json` exit 0, `problems: []`, repo-145 `needs-decision`, `mechanical` (honest for its recommended option (a), as `docs/01-TICKETS.md` asks); `next-id.mjs repo` → claimed only by `PR#792`, next free repo-146; no other PR claims 145                                                                                                                                                                                                                                                                       |
| Check (from the dispatch): options priced from the Log's numbers, arithmetic right                             | **not met** — arithmetic right, pricing not supported by the numbers (F1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Check (from the dispatch): the "different model" rule and PR #778 described accurately                         | **verified** for #778 (filing row to `ticket-reviewer-opus` by the owner's second answer (ii), over option (i)); F2 and F3 below                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Check (from the dispatch): "0 refuted" over 13 Logs and 13 PR threads                                          | **verified** — no finding of the 13 gate 1s shown false, withdrawn or "does not reproduce" by a builder, lander, orchestrator or later gate (population below)                                                                                                                                                                                                                                                                                                                                                                                     |

- **high** · F1 · no `Done when` line of repo-139 depends on it; repo-145's options do · repo-145's (b) and (c) savings, and "about 55 %", compare three `medium` Sonnet gates with ten Opus gates of which five ran `full` and one "standard, full", and the filing licenses the pooling with "the costs do not sort by depth". By mean they do: `full` $3.62 (5 gates), `medium` $2.90 (lg-80, lg-75), `medium` + `standard` $2.82 (adding repo-121, repo-124); 4 of 5 `full` gates cost more than every non-`full` one. Depth-matched, a Sonnet gate is 64–66 % of an Opus gate, saving about $1.00 a gate, not $1.50: (b) about $10 over ten, not $15; (c) about $7, not $10.50. The filing's own last paragraph says "ten rows of mixed depth cannot price an option" and then prices (a), (b) and (c) from them. False in the unsafe direction for the owner's choice: it overstates what (b) and (c) save by half. The Log's own "about 55 % … on these tickets" is a true description, and its _Like for like_ bullet names the depths, but not that they run in the direction of the gap. Direction: give the depth-matched figure beside the pooled one in repo-145's table and options, drop "the costs do not sort by depth", and add the direction to the Log's bullet.
- **med** · F2 · no `Done when` line of repo-139 depends on it; repo-145's Done when 1 does · repo-145's Done when 1 asks `grep -n 'different model'` to find "a sentence that still holds for every row of the table (for (a) and (d): unchanged)". On `main` the unchanged sentence does not hold for every row: the `fixer` row (Sonnet 5.5, `.claude/agents/fixer.md`) is gated at gate 2 by "the ticket's own gate row", which for `hard` and `mechanical` is `ticket-reviewer-sonnet` (Sonnet 5.5). So the line cannot be met as written under the recommended option, and the Why's "which `SKILL.md`'s pairing notes rule out" omits that the table already carries one same-model pairing, which a reader weighing (a) on the rule should know. Direction: reword the line to the rows (b)/(c) touch, and name the fixer pairing in the Why.
- **low** · F3 · safe direction · repo-145 says #778 applied the rule "to the filing row"; #778 also moves the docs-only chore row's gate (builder `builder-standard`) to `ticket-reviewer-opus`, so the owner's answer reached two rows. Nothing chosen rests on the omission; it strengthens (a).
- **low** · F4 · `history-rows.md` carries every cost, verdict and high/med/low count of the Log to the cent, but not the Opus rows' depth, carried and dropped columns, nor Table 1 as a table (repo-135 and repo-143 by pointer to the tools-ca rows). Done when 3's reading ("the same rows") will have to decide whether that is the same.
- **dropped** · "the absence of a `high` among the three tells nothing": at a 2-in-10 rate P(0 of 3) is 0.512 against 1 at a zero rate, so it tells little, not nothing; the overstatement runs in the cautious direction and no option rests on it.
- **dropped** · (c)'s "costs roughly the same as today on the rest": under (c) lg-80's CONCERNS (no round today) gains an Opus gate 2, while lg-72 and repo-124 swap an Opus gate 1 for a Sonnet one; the three net out close to today. Not a defect.
- **dropped** · repo-128's lander found five read-only cases where the gate's low counted three: the finding stood and was fixed, so not a refutation.
- **dropped** · repo-145 `difficulty: mechanical`: `docs/01-TICKETS.md` rates a `needs-decision` filing by its recommended option, (a), which builds nothing. Not a defect.
- **dropped** · "the owner has just ruled that a Sonnet filer under a Sonnet gate breaks 'a different model'": repo-138's second answer chose (ii) on a question that stated the break; the paraphrase holds.
- **findings** · the hunt returned 9; 4 carried (F1–F4), 5 dropped.
- "0 refuted" population: 13 of 13 Logs (keyword search, then every entry naming gate 1 read; gate 2 sections of repo-143, lg-72, repo-124 read), 13 of 13 PR threads (keyword search over the gate reports and lander preambles; not read line by line).
- Invariants: markdown only; every code invariant skipped. NFR: security n/a · performance n/a · reliability n/a · maintainability — F2, F4.

### Gate 2

**Gate: FAIL** — 2026-11-10 · `a72e9c53..3020bc6e` · Opus 5.5, depth narrow, scoped to the round (one commit, `3020bc6e`; `--first-parent --no-merges`, no merges in range). The branch also files repo-145 (`needs-decision`), checked as one finding block. Build skipped: the diff is two markdown files. PR #792 at `3020bc6e`: `check` (CI and pr-title), `changes`, `codeql`, `CodeQL`, `dependency-review` success; the test matrix skipped (all-`.md` diff).

| Done when / earlier finding                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2. Both tables in the Log, every cost from `agent-cost.mjs`       | **verified**: the 13 costs re-read with `node scripts/agent-cost.mjs` equal the Log to four decimals; the round's by-depth table recomputes (`depth.mjs`, scratch): pooled $3.3525, 55 %, $1.50; `full` n 5 $3.6236, 51 %, $1.77; `medium` n 2 $2.8953, 64 %, $1.05; `medium` plus `standard` n 4 $2.8158, 66 %, $0.97; each depth read off its gate-1 header                                                                                                                                                                                                                                                                                                 |
| 3. The batch's `reference/history.md` entry carries the same rows | **awaiting** — the merge of the tools-86 batch's close-log pull request to `main`; the reading is that its entry names repo-139 and carries `history-rows.md`'s rows, 30 of whose 33 table rows equal the Log's verbatim today (the other three, the accounting row and two headers, by design)                                                                                                                                                                                                                                                                                                                                                               |
| 1 and 4                                                           | unchanged by the round; gate 1's **verified** stands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Check (from the dispatch): repo-145's format, id and fields       | **verified**: `npm run -s status -- --json` exit 0, `problems: []`; repo-145 `needs-decision`, `mechanical` (Question 1 recommends (a); Question 2 recommends none and its largest option is one table cell); one `## Decision — open` heading with each question marked `open` on its own line, as `docs/01-TICKETS.md` asks; `next-id.mjs repo` → `PR#792 repo-145`, next free repo-146                                                                                                                                                                                                                                                                     |
| Check (from the dispatch): options priced from the numbers        | Question 1 **verified** (every pooled and matched figure recomputes); Question 2 (ii) **not met** (N1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F1 (high) — pooled prices                                         | **fixed in part**: every Question 1 option now carries the depth-matched figure beside the pooled one, the lg-69 exclusion is stated in both tickets, and "four of five `full` gates cost more than every non-`full` gate, lg-69 excluded" holds (repo-133, $2.65, is the fifth). What remains is the last paragraph's "two to four rows at a depth cannot price an option", which reads against the matched prices the options carry from those same rows — the shape of the "ten rows … cannot price an option" sentence F1 quoted. The remainder is graded `low`: it disclaims rather than claims, and the Decision's preamble says which figure is nearer |
| F2 (med) — fixer pairing                                          | **fixed in part**: the Why states the `fixer` → `ticket-reviewer-sonnet` pairing accurately (`fixer.md` and `ticket-reviewer-sonnet.md` both `claude-sonnet-5-5` on `main`; the row's "the ticket's own gate row, dispatched fresh" verbatim), Question 2 holds three options and resolves none, and Done when 1 as reworded is met under every option. Remaining, `med`: the F2 bullet                                                                                                                                                                                                                                                                       |
| F3 (low)                                                          | **fixed**: PR #778's diff against the base moves exactly the filing and docs-only chore rows' gates to `ticket-reviewer-opus`; the Why names both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F4 (low)                                                          | **fixed**: `history-rows.md` now carries Table 1, Table 2 with depth, carried and dropped, the comparison and the by-depth table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

- **high** · N1 · no `Done when` line of repo-139 depends on it; repo-145's Question 2 does · Option (ii) says an Opus gate 2 "ran $2.26 to $2.66 … Risk: it adds that cost to every such round". The round already pays a gate 2 on `ticket-reviewer-sonnet`; (ii) replaces it, it does not add one. The three Opus gate-2 costs re-read (`a53678c8df440f471` $2.2648 repo-124, `a844f810d7cd154e7` $2.3999 lg-72, `a00afc8ed2491174a` $2.6604 repo-143) are right, but 16 narrow Sonnet gate 2s from `history.md`, re-read with `agent-cost.mjs`, run $1.03 to $2.93, mean $1.62, so the swap adds about $0.64 to $1.04 a round (mean $0.82), not $2.26 to $2.66: (ii)'s cost is overstated about threefold, in the direction that steers the owner off (ii). lg-72's gate 2 also ran "depth medium, scoped to the round", not narrow. Direction: state (ii) as a swap and price the difference, or say it is unpriced and give no figure.
- **med** · F2, fixed in part · no `Done when` line of repo-139 depends on it; repo-145's Done when 2 does · The Why says the table carries "one same-model pairing" (gate 1's own unqualified sentence, copied). It misses two facts. `review-ticket/SKILL.md`'s _A different model reviews_ already says the landing `fixer` "is a different model from the gate" — Done when 1's own `grep -n 'different model'` prints it — which is false on `mechanical` and `hard` tickets; Build 2 names one sentence of that section ("the matching sentence"), so under (i) and under (iii) the fixer sentence stays false while Done when 2 is met. And the `builder-web` row (Sonnet 5.5) is gated by "the ticket's own gate row", so on a `hard` ticket it is Sonnet under Sonnet too: a build step, which (iii)'s "covers a ticket's build and not a `fixer`'s round" would still break. Direction: name both in the Why and Question 2, and put the fixer sentence in Build 4's scope.
- **low** · N2 · `history-rows.md`'s tickets line (the build's scratch file, not the branch) says "a saving of about $1.00 a gate, not $1.50" with no n; both tickets say the matched figure rests on two to four gates and is "about $1.00", not a measured one. Unsafe only for a later reader of `history.md`; nothing the owner chooses rests on it.
- **dropped** · the Log's "overstate … by about half" as overclaiming: the n caveat sits in the same Log entry above it, and the direction holds by exact permutation of the nine non-lg-69 Opus costs, `full` against the rest (one-sided 6 of 126, 0.048).
- **dropped** · "two ways of reading the same four numbers": the `medium` row reads two of them; nothing rests on the wording.
- **dropped** · classifying `standard` as `medium`: `gate.md` names no `standard` depth, before or since the 2026-10-24 review that defined the three, and defaults to `medium`; lg-80's gate read it so; both rows are given.
- **findings** · the hunt returned 7: 2 new carried (N1, N2), 2 folded into gate-1 verdicts (F1's and F2's remainders), 3 dropped.
- Invariants: markdown only; every code invariant skipped. NFR: security n/a · performance n/a · reliability n/a · maintainability — F2, N2.

### Gate 3

**Gate: CONCERNS** — 2026-11-10 · `3020bc6e..80fc0631` · Opus 5.5, depth narrow, scoped to gate 2's N1 fix and the F2 remainder's fix (one commit, `80fc0631`; `--first-parent --no-merges`, no merges in range). Build skipped: the diff is two markdown files. Nothing gates 1 and 2 settled was re-gated.

| Earlier finding / Check (from the dispatch)                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 (high) — (ii) priced as an addition                                                            | **fixed**: (ii) now reads as a swap ("this replaces it") priced as a difference. `node scripts/agent-cost.mjs`, one `--agent` per id: the 16 narrow `ticket-reviewer-sonnet` gate 2s run $1.0337 to $2.9263, sum $25.9532, mean $1.6221; the three Opus gate 2s $2.2648, $2.3999, $2.6604, mean $2.4417; difference $0.8196, $0.6427 to $1.0383. Every figure in repo-145's (ii) and repo-139's Log matches. The Sonnet population is named as unfiltered, the Opus one as three, lg-72's depth as `medium` scoped to the round (its gate 2 header says so), and the figure is read as "about $0.80". Range wording: P1 |
| F2 (med) — the two pairings and the fixer sentence                                                | **fixed in part**: the Why names both pairings, quotes the `fixer` and `builder-web` rows' "the ticket's own gate row" as `orchestrate-tickets/SKILL.md` has them on `main`, and quotes `review-ticket/SKILL.md`'s _A different model reviews_ sentence ("is a different model from the gate") accurately; agent frontmatter on `main` gives `claude-sonnet-5-5` for `fixer`, `builder-web` and `ticket-reviewer-sonnet`. Two clauses remain: the F2 bullet                                                                                                                                                             |
| Check: Question 2's options say which pairing each reaches                                        | **verified** by reading: (i) neither; (ii) the `fixer`'s round, not `builder-web`; (iii) the `fixer`'s round by exemption, `builder-web` still broken as worded. (ii)'s claim that it makes the fixer sentence true is the F2 remainder                                                                                                                                                                                                                                                                                                                                                                                 |
| Check: Build 4 and Done when 2 cover the fixer sentence under (i) and (iii); Done when 2 provable | **verified** for (i) and (iii): Build 4 names the sentence and the edit; Done when 2's added clause is checkable by the `grep -n 'different model'` it names and a read of the table. Not covered under (ii): the F2 remainder                                                                                                                                                                                                                                                                                                                                                                                          |
| Check: Question 2 open, no recommendation                                                         | **verified**: `**Question 2 — … pairing: open**`; no "Recommended" in Question 2 (the one in the file is Question 1's (a))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Check: validity                                                                                   | **verified**: `npm run -s status -- --json` exit 0, `problems: []`; repo-139 `ready`, `standard`; repo-145 `needs-decision`, `mechanical`; both `depends_on: []`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F1 remainder (low), N2 (low)                                                                      | not in this gate's scope; N2's file is not on the branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

- **med** · F2, fixed in part · repo-145's Done when 2 depends on the first clause; no `Done when` line of repo-139 depends on either · Two clauses of the round's text are false, both in the unsafe direction. (1) Build 4 says under (ii) the fixer sentence "becomes true and needs no edit", and (ii) says it "makes the … fixer sentence true". (ii) moves only a gate 2 over a `fixer`'s round; a `fixer` that lands with no round of its own (SKILL.md step 6, "only the landing is left", lows fixed at the landing) transcribes a Sonnet gate's section on a `mechanical` or `hard` ticket and is Sonnet itself. `history.md` on `main` has it: lg-91 (`hard`, one gate, "Sonnet 5.5, depth full") landed by a `fixer` "one low at landing + landing", and lg-101 (`hard`, one gate, "Sonnet 5.5, depth full") the same. So under (ii) a build meets Done when 2 with the sentence still false. (2) The Why says `history.md`'s two `builder-web` dispatches (lg-93, repo-143) were "both `standard`, so none has paired yet". Both paired: lg-93's `builder-web` step was gated by `ticket-reviewer-sonnet` gate 2 (`a6fd87563b7599062`; a filing, whose row on `main` gates on `ticket-reviewer-sonnet`), and repo-143's by a `ticket-reviewer-sonnet` gate 1 (its header: "Sonnet 5.5, depth medium (repo-139's measurement…)"). The Why also states the `builder-web` pairing for `hard` only, where on `main` every row whose gate is `ticket-reviewer-sonnet` (`mechanical`, `hard`, the filing row until #778 merges) pairs it. Not a `high`: the options' pairings over a `fixer`'s round and their costs are right, and the owner is told `builder-web` is in scope only if named; but whether to name it is a choice the owner makes from (2). Direction: state the landing-only case under (ii) and put the fixer sentence in Build 4 and Done when 2 under every option, or scope it under (ii); replace "none has paired yet" with the two pairings as recorded and name the Sonnet gate rows.
- **low** · P1 · no `Done when` line depends on it · "The swap adds about $0.64 to $1.04 a round" is each Opus reading less the Sonnet mean, not a spread of rounds; pairing the readings directly gives −$0.66 to +$1.63. False in the safe direction for the owner, who is told to read the mean as "about $0.80". The wording is gate 2's own N1 direction, copied.
- **dropped** · Question 2's heading names only the `fixer` pairing; its body names both, and a heading names a question, not its scope.
- **dropped** · `a39c20a654034cb3b`'s $1.2172 has its output estimated for 42 of 43 responses (`agent-cost.mjs`'s own note); it is the script's method, the same figure `history.md` and gate 2 used; how far the estimate is off is unmeasured.
- **findings** · the hunt returned 5: 2 folded into F2's verdict, 1 new carried (P1), 2 dropped.
- Invariants: markdown only; every code invariant skipped. NFR: security n/a · performance n/a · reliability n/a · maintainability — F2.

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

  The cost row by depth (round 1 of the gate, re-derived from the ten costs in
  Table 2; all three Sonnet gates ran `medium`, so the depth-matched Opus
  figure is the one to read a saving against):

  | Opus gates, by the depth the section names           | n   | Mean cost | Sonnet mean as a share | Saving per gate (Sonnet mean $1.85) |
  | ---------------------------------------------------- | --- | --------- | ---------------------- | ----------------------------------- |
  | all ten, pooled                                      | 10  | $3.35     | 55 %                   | $1.50                               |
  | `full` (repo-130, 133, 120, 72, 128)                 | 5   | $3.62     | 51 %                   | $1.77                               |
  | `medium` (lg-80, lg-75)                              | 2   | $2.90     | 64 %                   | $1.05                               |
  | `medium` plus `standard` (adding repo-121, repo-124) | 4   | $2.82     | 66 %                   | $0.97                               |

  lg-69's "standard, full" gate ($4.14) is in the pooled row and in neither
  depth row. "Standard" is not a depth name any more (the gate on lg-80 read it
  as `medium`); the last row treats it as `medium`, and its n is 4 and the
  `medium` row's is 2, so these are two ways of reading the same four numbers,
  not four readings. Four of the five `full` gates cost more than every gate
  that was not `full` and not lg-69's (the fifth, repo-133 at $2.65, sits below
  three of the four, lg-80, lg-75 and repo-121, and above repo-124).

  What the numbers show: on these tickets a Sonnet gate cost about 55 % of an
  Opus gate on average pooled ($1.85 against $3.35), and 64 % to 66 % of the
  Opus gates that ran at the depth the Sonnet ones did ($2.82 to $2.90). The
  cheapest Opus gate, $2.26, is below the dearest Sonnet one, $2.74, so the
  ranges overlap. A Sonnet gate also
  carried about as many findings, 4.0 a gate against 4.2. Neither population
  had a finding shown false afterwards. The Sonnet gates graded one `med`,
  repo-143's F1, which the round fixed and an Opus gate 2 confirmed fixed.

  What they do not show:
  - **The rate of a `high`.** Three gates is enough to see cost, not enough to
    see how often a gate finds a `high`. Had a Sonnet gate the Opus rate of 2
    in 10, the chance of 0 in 3 is 0.8^3, 51 %: the absence of a `high` among
    the three tells little. The ticket's own note that Sonnet xhigh found
    highs on `hard` tickets (lg-66 gate 2, repo-131 gate 1) is copied from the
    ticket, not re-read here.
  - **Misses.** "Refuted" counts false findings. A finding a gate never made
    cannot be refuted, and only repo-143 had a second reader, narrow and over
    the round; repo-135 and repo-129 had none. Zero refuted does not separate
    two gates that differ in what they miss.
  - **Like for like.** The tickets differ (a status script, a Cloudflare
    Worker, a vitest split against Opus's ten), as do the depths and the
    builders' costs; the cost of one repo-129 gate, $2.74, is already above
    three of the Opus gates. **The depth difference runs in the direction of
    the gap**: the three Sonnet gates ran `medium`, and five of the ten Opus
    gates ran `full` and cost more ($3.62 against $2.82 to $2.90 at `medium`),
    so the pooled 55 % and $1.50 overstate what a Sonnet gate saves against an
    Opus gate of the same depth, by about half: the matched saving is about
    $1.00 a gate (64 % to 66 %). `agent-cost.mjs` was run the same way on all
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

- 2026-11-10 — **Round 1, gate 1 (Opus, depth medium) on `a72e9c53`: FAIL, one
  high.** The gate verified the measurement (every cost, verdict and count in
  the Log) and failed repo-145's pricing. Each finding, reproduced before it
  was changed:
  - **F1 (high), reproduced.** `node depth.mjs` (scratch, over the ten Opus
    costs and the three Sonnet ones) prints: Sonnet mean 1.8493; pooled n 10
    mean 3.3525, share 0.552, saving 1.5032; `full` n 5 mean 3.6236, 0.510,
    1.7742; `medium` n 2 mean 2.8953, 0.639, 1.0460; `medium` plus `standard`
    n 4 mean 2.8158, 0.657, 0.9665. They equal the gate's figures ($2.90,
    $2.82, $3.62; 64 % to 66 %). Fixed: the comparison above carries a by-depth
    table and its _Like for like_ bullet says the depth difference runs in the
    direction of the gap; repo-145 gives every option pooled and depth-matched
    ((b) about $15 or $10 over ten, (c) $10.50 or about $7) and no longer says
    the cost "does not sort by depth".
  - **F2 (med), reproduced.** `.claude/agents/fixer.md` and
    `ticket-reviewer-sonnet.md` both pin `claude-sonnet-5-5`
    (`git grep -n -E '^model'` on `origin/main`), and `SKILL.md`'s `fixer` row
    sends gate 2 to "the ticket's own gate row", which is
    `ticket-reviewer-sonnet` on `mechanical` and `hard`. Not resolved here:
    repo-145 states it in the Why as a fact, puts it as Question 2 with three
    options, and rewords its Done when 1 so it is met under every option.
  - **F3 (low), reproduced.** `git diff origin/main origin/repo-138-filing-row
    -- .claude/skills/orchestrate-tickets/SKILL.md` moves two gate cells to
    `ticket-reviewer-opus`: the filing row and the docs-only chore row.
    repo-145's Why names both.
  - **F4 (low), reproduced.** The first `history-rows.md` lacked the Opus rows'
    depth, carried and dropped columns, and Table 1 as a table. It now carries
    the Log's columns.
  - Also changed: "the absence of a `high` among the three tells nothing" now
    reads "tells little" (a dropped note of the gate: at the Opus rate P(0 of 3)
    is 0.51, against 1 at a zero rate).

- 2026-11-10 — **Round 2, gate 2 (Opus, depth narrow, scoped to the round) on
  `3020bc6e`: FAIL, one high.** The gate verified the 13 costs and the by-depth
  table and left Done when 1, 2 and 4 met. Each finding, reproduced before it was
  changed (fixer, Sonnet 5.5):
  - **N1 (high), reproduced.** repo-145's option (ii) said an Opus gate 2 "adds"
    $2.26 to $2.66 to every such round, but the round already pays a gate 2 on
    `ticket-reviewer-sonnet`. `node scripts/agent-cost.mjs`, one `--agent` per
    id, on the 16 narrow Sonnet gate 2s from the gate's report: $1.0337 to
    $2.9263, mean $1.6221 (sum $25.9532); on the three Opus gate 2s
    (`a53678c8df440f471` $2.2648, `a844f810d7cd154e7` $2.3999,
    `a00afc8ed2491174a` $2.6604): mean $2.4417. The difference is $0.82 a round,
    $0.64 to $1.04, which equals the gate's. Fixed: (ii) is a swap with that
    difference, the populations named as unfiltered and lg-72's depth given as
    `medium` scoped to the round, and the figure read as "about $0.80".
  - **F2 remainder (med), reproduced.** `grep -n 'different model'
    .claude/skills/review-ticket/SKILL.md` prints the sentence that a mechanical
    last round's `fixer` "is a different model from the gate", false on
    `mechanical` and `hard`; `SKILL.md`'s `builder-web` row gates on "the ticket's
    own gate row", Sonnet under Sonnet on a `hard` ticket (`history.md` records
    only lg-93 and repo-143, both `standard`). Fixed in repo-145: the Why names
    both pairings and the sentence, Question 2 says which pairing each option
    reaches (none of them reaches `builder-web` as worded), Build 4 and Done when
    2 put the fixer sentence in scope under (i) and (iii). Nothing in Question 2
    is resolved and it carries no recommendation.
  - **N2 (low), reproduced.** The build's scratch `history-rows.md` (tickets
    line) said "a saving of about $1.00 a gate, not $1.50" with no n. Fixed in
    that file, which is not on the branch: it now says the figure is from two to
    four Opus gates at the depth, so indicative and not measured, for the batch
    log's close-out.
  - **F1 remainder (low), reproduced.** repo-145's last paragraph said "two to
    four rows at a depth cannot price an option" beside matched prices drawn from
    those rows. Now: the depth-matched figures "rest on two to four gates, so they
    are indicative and not measured", and an unread depth has no figure.

- 2026-11-10 — Owner's answer at the tools-86 checkpoint 11 (relayed in the
  lander's dispatch from the orchestrator; the owner's own reply, not a gate's):
  gate 3 (CONCERNS, `80fc0631`) left one `med` (F2, fixed in part) and one low
  (P1). Question: how to fix them. Options: fix at the landing with no fourth
  gate, or fix and then run a narrow gate 4. Chosen: fix at the landing, no
  fourth gate, which was the orchestrator's recommendation. For F2 the owner's
  remedy is to put the fixer sentence in Build 4 and Done when 2 under every
  option.

- 2026-11-10 — Fixed at landing by owner choice: gate 3, F2 clause 1 — "Build 4
  says under (ii) the fixer sentence 'becomes true and needs no edit', and (ii)
  says it 'makes the … fixer sentence true'". repo-145's (ii) now states the
  landing-only case (lg-91 #734, lg-101 #752 on `history.md`), and Build 4 and
  Done when 2 put the fixer sentence in scope under every option. Proof:
  `git diff 80fc0631 HEAD -- docs/work/repo-145-whether-the-standard-rows-opus-gate-should-become-a-sonnet-gate.md | grep -c '^-.*round and makes the'`
  → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 3, F2 clause 2 — "The Why
  says … 'both `standard`, so none has paired yet'". repo-145's Why now records
  the two pairings (lg-93's gate 2 `a6fd87563b7599062`; repo-143's gate 1) and
  names the rows that pair `builder-web` (`mechanical`, `hard`, the filing row
  until #778 merges); Question 2's lead-in follows. Proof:
  `git diff 80fc0631 HEAD -- docs/work/repo-145-whether-the-standard-rows-opus-gate-should-become-a-sonnet-gate.md | grep -c '^-.*so none has paired yet'`
  → `1`.
- 2026-11-10 — Fixed at landing by owner choice: gate 3, P1 — "The swap adds about
  $0.64 to $1.04 a round is each Opus reading less the Sonnet mean, not a spread
  of rounds". repo-145's (ii) now says the swap adds $0.82 on the means, that
  $0.64 to $1.04 is the spread of the three Opus readings, and that pairing
  every Opus reading with every Sonnet reading gives -$0.66 to +$1.63
  (2.2648 - 2.9263 and 2.6604 - 1.0337). Proof:
  `git diff 80fc0631 HEAD -- docs/work/repo-145-whether-the-standard-rows-opus-gate-should-become-a-sonnet-gate.md | grep -c '^-.*swap adds about'`
  → `1`.
