---
id: repo-58
tool: repo
title: Trial a gate split by angle, run as a workflow whose verdict is computed in code
kind: chore
status: done
milestone: null
depends_on: []
difficulty: hard
---

# repo-58 — Trial a gate split by angle, run as a workflow whose verdict is computed in code

## Why

The orchestration rework of 2026-09-26 added a trial to
`.claude/skills/orchestrate-tickets/reference/dispatching.md`: split a large
branch's gate into three gates on one model, each with an angle —
`acceptance`, `defects`, `invariants` — on the argument that a gate's cost grows
faster than its length, since every turn re-reads the transcript so far. The
sentinelle repository reviews every diff with parallel angles. A second-pass
review of that change (session code-09, 2026-09-26) found the split could not
be run end to end in this repo, and the section was shelved before it merged.
Four things blocked it, each read off the staged files:

1. **The record script refuses it.** `scripts/review-record.mjs` requires the
   first section's first line to be exactly `## Review`, and refuses a second
   `### Gate 1`. The gate role had each angle return `### Gate <n> — <angle>`,
   so three angles of one round cannot share a number, and the first one's
   heading loses its angle when it becomes `## Review`.
2. **Two angles cannot satisfy the section format.** `review-ticket`'s
   `gate.md` requires a `findings` line — the count of what the defect hunt
   returned, carried and dropped — and only the `defects` angle runs the hunt
   (steps 1, 2, 3 and 6).
3. **Nothing writes the ticket's verdict.** The angle table assigned `gate.md`
   step 7, the verdict, to no angle, and "the ticket's verdict is the worst of
   the angles'" had no writer: the lander commits every section verbatim and
   may not compose one.
4. **The cost argument counted turns only.** Each angle pays its own farm,
   build, page read and ticket read before its first turn of review, which the
   `n²/2` argument leaves out. **Measured the same day and refuted** — see the
   Log: setup is about 2% of a gate's cost.

Blockers 1 to 3 are properties of that design, not of splitting. Each goes away
if the angles return **data** rather than sections, and one party that is not a
model merges them.

## The question, answered

**Fix, by trial — not drop.** Asked as fix-or-drop, with the recommendation to
measure how a gate's cost splits between setup and review turns first. The
measurement (Log, 2026-09-26) found review turns dominate, which was the
ticket's own condition for "fix". The owner chose on 2026-09-26, in session,
between four options — a trial first, building the workflow gate outright,
giving the gate agent the `Agent` tool to fan out itself, and dropping the split
for a sharper single gate — and took the trial.

What is still unknown, and what the trial is for: **whether angles find more**.
The cost case is modelled, not measured, and it is roughly neutral once the
angles' overlapping reads are counted; the wall-clock case is strong for large
gates (top quartile runs a median 163 minutes). Yield is the whole argument, and
nobody has measured it here.

## Build

### 1. The shape to trial

A **Workflow** run by whoever dispatches the gate — `orchestrate-tickets`' main
session, or the session running `review-ticket` — never by the gate agent itself.

- **Five angles, in parallel**, each an `agent()` with `agentType` naming a
  pinned gate definition, so the different-model pairing in
  `orchestrate-tickets`' `SKILL.md` holds and no `model` is passed. Each gets the
  ticket id, the base and head shas, the scratch directory and its angle — and,
  as today, nothing from the build.

  | Angle              | Owns (`gate.md`)                               | Phrased as something to run                                               |
  | ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------- |
  | `verification-gap` | step 4                                         | revert the fix, confirm each new test goes red; a positive control first  |
  | `edge-case`        | step 3, step 6 reliability and performance     | drive the known edges: unknown totals, cancel mid-job, redirects, Windows |
  | `security`         | step 5 shell, redaction, SSRF; step 6 security | point it at a hostile input first, then the candidates                    |
  | `conventions`      | step 5, everything else                        | one command per rule where one exists                                     |
  | `intent`           | step 4 against the ticket's `Why`              | list every diff hunk no `Done when` line or `Build` step accounts for     |

  `edge-case` owns the `findings` line, since it runs the defect hunt.

- **Each angle returns a `schema`**, not a section: its findings with severity,
  anchored citation and reproduction; its acceptance rows where it owns them;
  its `dropped` lines; its hunt count; and the population it covered against the
  population that exists.
- **The script merges and decides, in code.** Findings are concatenated, never
  summarised — two findings on one coordinate stay two rows, marked. The verdict
  is `gate.md`'s severity table applied mechanically: any `high` or `unproven`
  row is FAIL, any `med` or `unproven (gate)` is CONCERNS. The section is
  rendered from the merged object by the script, so `review-record.mjs` lands it
  unchanged, as one `## Review` or one `### Gate <n>`. No model writes the
  verdict, and no model summarises a summary — the loss `gate.md` step 3
  records on pl-10 and pl-18.

### 2. The trial

Run it once, on **one large branch that has already been gated** — top quartile
by gate cost. Prefer one where a later ticket fixed a defect that branch shipped:
whether the angles catch what the single gate missed is the best signal
available. Compare against the recorded gate, and record in the Log:

- every finding each side carried, and **each finding only one side found,
  reproduced** — an unreproduced unique finding counts for neither;
- cost of each shape from `node scripts/agent-cost.mjs`, and wall-clock;
- the reading against the criteria below.

**Adopt if** the angles reproduce every finding the single gate carried (or
refute the missing one by command), find at least one confirmed finding it did
not, and cost no more than 1.5× it. These thresholds are the brief's proposal,
set before the run so the result cannot move them; the owner may change them
before the trial runs, not after.

### 3. Then, either way

- **Adopted:** save the script as a named workflow; make `orchestrate-tickets`
  step 5 and `review-ticket`'s dispatch run it above a size threshold the trial
  suggests, and the single gate below it; give each angle its section in
  `gate.md`; replace the shelved section in `dispatching.md` with the rule; and
  amend `review-ticket`'s "One model, not a panel", which this does not
  contradict — one model, one verdict, computed.
- **Not adopted:** delete the shelved section, and fold what the trial taught
  about single-gate steps (red-on-base, the `intent` hunk list, a security step)
  into `gate.md`, or file it.

### Traps

- **Workflow opt-in.** The Workflow tool runs only when the user asked for it or
  a skill's instructions say to call it. The trial is asked for; adoption means
  the skills say it, in so many words.
- **Worktrees.** Workflow agents run in the dispatching session's directory
  unless isolated, and the orchestrator's is the shared checkout. Every angle
  needs `isolation: 'worktree'` passed, whatever its definition declares —
  verify the definition's `isolation` is honoured through `agentType` before
  relying on it, and remember `verification-gap` mutates its tree.
- **The pinned definitions read the whole gate.** `ticket-reviewer-*` read
  `gate.md` in full at their first command. An angle needs its slice: either a
  paragraph in `roles/reviewer.md` for a dispatch that names an angle, or angle
  definitions of their own. Measure which before choosing.
- **Cost is read from the wrong files unless checked.** `agent-cost.mjs` reads
  a dispatch's task output files. Workflow agents write `agent-<id>.jsonl` under
  the workflow's transcript directory; confirm the script reads those before
  stating either shape's cost.
- **`intent` and `conventions` are judgement angles**, and `dispatching.md`
  records a judgement question coming back as an echo. Keep them phrased as the
  runs in the table, or fold them into the others.
- **Not the gate agent fanning out itself.** Nesting is allowed by the platform
  (three levels by default), and was rejected: `gate.md` step 3 excludes it
  because it hides cost from `agent-cost.mjs`, and a model would do the merge.

## Done when

- The trial is recorded in the Log: the branch and shas, both shapes' carried
  findings, each unique finding with its reproduction, both costs from
  `agent-cost.mjs`, both wall-clocks, and the reading against the adoption
  criteria.
- Adopted: a named workflow exists; a gate above the threshold dispatched by
  `orchestrate-tickets` runs it and lands its section with
  `scripts/review-record.mjs` unchanged; its verdict matches `gate.md`'s table
  applied by hand to the same rows. Not adopted: `dispatching.md` carries no
  angle split.
- `dispatching.md`'s shelved section is gone either way.

## Review

**Gate: CONCERNS** — 2026-09-26 · `e50cf8194786993f095e9ab42108c0834b26ca9c...4c070696522576c1372bce0696208c7af86d7d32` · record review of the Log claims at the depth the dispatch named (six numbered checks: recall and new findings, cost, wall-clock, the adoption verdict, baseline fairness, the two pages) — no source diff, nothing to code-review

| Done when                                                                                                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The trial is recorded in the Log: the branch and shas, both shapes carried findings, each unique finding with its reproduction, both costs from `agent-cost.mjs`, both wall-clocks, and the reading against the adoption criteria | **verified, with one exception** — branch and shas present and correct (round 1 of pl-39 at `8849c14...489bce9`; the trial workflow `wf_0849a545-e13`); the carried-findings account (3 of 5: B1, B3, B4) matches the raw per-angle JSON results, not only the Log summary of them; no finding was unique to one side needing separate reproduction (0 new findings on the angle side); both weighted-unit and dollar costs reproduce exactly by re-running the `sumUsage` export of `agent-cost.mjs` over the `agent-<id>.jsonl` files of the workflow (2,895 k, 7,939 k, 8,600 k, $17.20, $15.88, all matching); both wall-clocks reproduce from the timestamps recorded in the transcripts (19m41s against 19.6 min); the reading against the three adoption criteria is correct on the recomputed numbers (all three fail). The exception is the baseline-selection justification, see the finding below |
| Adopted: a named workflow exists and lands its section unchanged with a matching verdict; not adopted: `dispatching.md` carries no angle split                                                                                    | **verified** — a search for the word angle across `dispatching.md`, `SKILL.md`, `gate.md`, `roles/reviewer.md`, `roles/common.md` finds only a historical note in `dispatching.md` (heading "Splitting a gate by angle, trialled and dropped") and one sentence in `SKILL.md`; neither instructs dispatching a split                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| The shelved section of `dispatching.md` is gone either way                                                                                                                                                                        | **verified** — the previous "Do not dispatch this" section no longer exists in `dispatching.md`, replaced by the historical note above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

- **med** · The account in the Log of why pl-39 was chosen as the trial baseline claimed it was the largest first round gate on a source change that carried findings (the trial entry dated 2026-09-26, the "The case" bullet, as it stood before this round). False as written: two other tickets each record a first round gate larger than round 1 of pl-39 (2,895,249.5 weighted units by the weighting `agent-cost.mjs` itself uses, derived from the transcript of that round) and each carried a finding. `docs/work/repo-35-a-citation-cannot-be-pinned-to-a-commit.md:1066` "dispatched as sonnet against an opus build" records that gate as PASS, and `docs/work/repo-35-a-citation-cannot-be-pinned-to-a-commit.md:1078` "No test exercises a citation that is both pinned and a self-citation" is the one low finding it carried; its round 1 priced at 4,131,416 units. `tools/planner/docs/work/pl-43-repack-named-days-and-diff.md:557` "plus 7 independent mutation reproductions" records that gate as PASS, and `tools/planner/docs/work/pl-43-repack-named-days-and-diff.md:588` "with no test exercising that branch" is the one low finding it carried; its round 1 priced at 3,952,066 units. Only the comparison against dl-50 was checked in the original text (`tools/downloader/docs/work/dl-50-a-human-check-without-an-account.md:184` "returned 0 findings above the checked", larger at 4,805,566 units and carrying none); these two, also larger and not zero, were not. The unit prices are reproduced from the file of each transcript, not from any committed record: extracted round 1 by the boundary the dispatch itself defines (first assistant record to the first subsequent user record carrying string content), then priced with the same weighting `agent-cost.mjs` uses.
- **findings** · record review at the six checks the dispatch named returned 1; 1 carried, 0 dropped.
- NFR: security n/a · performance n/a · reliability n/a · maintainability — the one med above is itself a documentation accuracy gap in the justification the ticket gives for its methodology, which the finding covers.

### Gate 2

`git diff 4c070696522576c1372bce0696208c7af86d7d32..42c33de12bf6e4a9d9161def0fa7dd212d362e83` — one file, one hunk, `docs/work/repo-58-trial-a-gate-split-by-angle.md` (plus 4, minus 3).

- **med finding, fixed.** The sentence now reads: it was chosen for having the most items to recall, not for size, three larger first round gates on source changes carried fewer, dl-50 none, which would have made criterion 1 true by default, and repo-35 and pl-43 one low finding each. Verified against the same numbers derived independently in the round above: round 1 of pl-39 carried 5 items (B1 through B5) against dl-50 at 0, repo-35 at 1 low, and pl-43 at 1 low. The arithmetic of the new sentence and its comparison set match the recomputation exactly, and it no longer asserts pl-39 was the largest. No new unverifiable claim was introduced.
- **Did not** re-run the wider six item check this round; the diff touches only the one sentence the finding named, and nothing else changed.

## Log

- 2026-09-26 — filed while shelving the section, from the second-pass review's
  reproduction above. Nothing built.
- 2026-09-26 — **measured, and the question answered: trial, then fix or drop.**
  Read 130 `ticket-reviewer-*` transcripts under
  `~/.claude/projects/-workspaces-tools/*/subagents/`, found by their
  `.meta.json` `agentType`; 119 reached a build, 11 never ran one and were left
  out. Billed requests were grouped by `requestId` as `agent-cost.mjs` does, and
  weighted input 1, cache write 1.25 (5 m) or 2 (1 h), cache read 0.1, output 5.
  "Setup" is every request up to the one issuing the first `npm run build`,
  which slightly understates it, since the build's output lands in the next.
  - Setup share of cost: median **2%** (p25 1%, p75 7%); in the top quartile by
    cost, under 1%. Through the first full `git diff`: median 6%. Blocker 4 does
    not hold.
  - Wall-clock: median 39 minutes, p75 149; top quartile median 163.
  - Context after the ticket and diff are read is a median 71 k of a 205 k final
    context. Modelled as angles splitting the rest evenly with no overlap, 2, 3
    and 5 angles cost 0.79×, 0.71× and 0.66× a single gate's cache reads; real
    angles overlap in what they read, so treat cost as roughly neutral.
  - A first cut ended setup at the _last_ build and read a 57% median: gates
    rebuild on every re-gate and base comparison. The boundary matters.
  - None of the 345 recorded subagents was nested (`spawnDepth` 1 on all).

  The measuring scripts were scratch and are not committed; the method above is
  enough to rerun them.

- 2026-09-26 — **the trial ran, and the split is not adopted: it failed all three
  criteria.** Run by the main session (Opus) as workflow `wf_0849a545-e13`, with
  every item the angles carried adjudicated by a Sonnet refuter, since the author of this
  brief was the one running it.
  - **The case.** pl-39's first-round gate: `8849c14...489bce9`, 2,133 lines in
    19 files, one Sonnet gate at `high` effort that took 20 minutes and returned
    CONCERNS with five items — B1 (med) the run budget's sizing ignores the
    fallback that doubles a bill, B2 (low) `compaction` is never asserted by
    name, B3 (low) the Log counts six transitive packages where there are five,
    B4 `ANTHROPIC_CUSTOM_HEADERS` can override the configured key, B5 (open
    decision) an empty `MODEL_PROVIDER` boots `scripted`. It was chosen for
    having the most items to recall, not for size: three larger first-round
    gates on source changes carried fewer — dl-50's none, which would have made
    criterion 1 true by default, and repo-35's and pl-43's one low finding each.
  - **The run.** Five angles on Sonnet at `xhigh` (the pinned gate effort
    today), each given the attack items of the original gate prompt that fell
    in its territory, in their own worktrees; then one Sonnet refuter per angle
    that had anything to adjudicate (three did). Every angle reviewed
    `489bce9`. The verdict computed in code was CONCERNS, the same as the
    single gate's.
  - **Recall: 3 of 5.** B1 (edge-case, med), B3 (intent), B4 (security, as an
    open decision it graded high) reproduced and matched. **B2 was seen twice
    and lost at the seam**: edge-case dropped it by reading ("same `default`
    branch as the other three"), which contradicts the acceptance line's "each
    by its own test"; intent routed it to verification-gap as an
    `outside_angle` note, which nothing delivers between parallel agents; and
    verification-gap marked that row `proven`. **B5 was decided rather than
    surfaced**: edge-case dropped it, with a reason matching the owner's
    eventual answer, where the single gate brought it as a decision.
  - **New findings: 0.** The hunts returned 15 candidates between them
    (edge-case 8, intent 4, security 3) and carried 3, all three matching
    baseline items.
  - **Cost: 2.7×.** Weighted as in the entry above: the angles 7,939 k units
    against the first round's 2,895 k (2.7×), 8,600 k with the refuters (3.0×);
    `node scripts/agent-cost.mjs` prices the run at $17.20, $15.88 of it the
    angles. **Wall-clock: none saved** — 19.6 minutes against 20, since the
    slowest angle alone took 16.
  - **Criteria:** every carried item reproduced — no, B2; at least one new
    confirmed finding — no; at most 1.5× the cost — no.

  What the trial taught, beyond the verdict:
  - **The partition assumption was the flaw in the cost model.** Each angle
    cost 0.29 to 0.73× the whole first round, because each re-read the ticket,
    the diff and most of the source it needed. The 0.66× estimate in the entry
    above assumed angles divide the reading, and they do not.
  - **A split loses what falls between angles.** A hand-off needs a carrier; a
    routing stage would add a round of agents to a shape already at 2.7×.
  - **Computing the verdict in code worked** and matched, and it is the one
    piece worth keeping if a split is ever tried again.
  - **The confounds:** one branch; an attack list, given to both shapes, that
    did much of the finding in each; `xhigh` against the baseline's `high`,
    which inflates the angles' cost by an amount not measured here — it would
    have to exceed 1.8× to bring the angles inside 1.5×.
  - **Two traps in this brief resolved:** `agent-cost.mjs` reads a workflow's
    `agent-<id>.jsonl` files as they are, and `isolation: 'worktree'` was
    honoured. **One trap it missed:** a workflow agent that detaches its
    worktree's HEAD leaves the worktree behind — all eight did, and were
    removed by hand.
  - **On sharpening the single gate instead:** the trial gives no evidence
    that red-on-base tests, an intent hunk list or a security step add
    findings. The angles running exactly those found nothing the single gate
    missed, so nothing is folded into `gate.md` on this evidence.

  Done when: the trial is recorded above; not adopted, so `dispatching.md`
  carries no angle split, and its shelved section is replaced by a note of the
  result.

- 2026-09-27 — **gate 1 transcribed** by the lander (Opus, the author of the
  trial) from the reviewer's own dry-run file, with `scripts/review-record.mjs`:
  the normalised diff against that file is empty — nothing altered or dropped.
  Its one med, the baseline claim, is fixed in `42c33de`; the reviewer's full
  report is on the pull request thread.
- 2026-09-27 — **gate 2 transcribed** the same way: normalised diff empty,
  nothing altered or dropped. It finds the med fixed. The record's headline
  stays CONCERNS, as the reviewer notes, because gate 1's verdict is a fact
  about `4c07069`; nothing is left open at `42c33de`.
