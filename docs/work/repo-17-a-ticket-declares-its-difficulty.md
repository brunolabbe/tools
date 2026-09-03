---
id: repo-17
tool: repo
title: A ticket declares its difficulty, and the orchestrator maps it to a builder's model
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-17 — A ticket declares its difficulty

## Why

`orchestrate-tickets` dispatches three subagents, and **two of the three pinned a
model on purpose while the third inherited by accident.** Measured against
`origin/main@7fe18af`, before this change:

| Agent             | Frontmatter         | Where the choice was argued                                                       |
| ----------------- | ------------------- | --------------------------------------------------------------------------------- |
| `seam-mapper`     | `model: sonnet`     | read a lot, return a little — the whole point of the file                         |
| `ticket-reviewer` | `model: sonnet`     | "Why the frontmatter pins a model", 16 lines, with the measurement that forced it |
| `builder`         | **no `model:` key** | nowhere — not in the agent file, not in `SKILL.md`, not in `dispatching.md`       |

So the agent that writes every line of code this process ships ran on whatever
the orchestrator happened to be, and no document in the tree said that was
deliberate. The question was whether the orchestrator should instead **choose**
the builder's model per ticket, between `haiku`, `sonnet` and `opus`, the way it
already chooses the gate's.

Three things shaped the answer.

### 1. The orchestrator is deliberately the one participant that has not read the ticket

Step 2 exists to keep it that way. `seam-mapper` reads the candidates in full so
the orchestrator does not — **~27,800 est. tokens for nine candidates, one of them
14,809 on its own**, recorded at `SKILL.md` step 2. And the mapper's return
contract forbids exactly the judgement a difficulty routing would need: _"you do
not recommend which tickets to run"_, and _"Do not include ticket summaries,
restatements of the briefs, or your opinion of which batch to run"_.

**This is the finding that decided the design.** Routing by difficulty is not a
flag on a dispatch. Computed orchestrator-side it is a contract change to
`seam-mapper` plus a judgement made by an agent that read the ticket once for a
different purpose. Put on the ticket, it is a field filled in by the one person
who has actually read the work.

### 2. The gate rule is coupled to it, and had already failed once at scale

`SKILL.md` step 4 and `ticket-reviewer.md` hold one rule: the gate runs on a
**different** model from the builder, never `haiku` and never `fable`, because
_"a gate from a small model still reads as PASS"_. The Sonnet default was correct
only because builders were assumed to inherit Opus.

That assumption failing silently is not hypothetical — it is the recorded reason
the pin exists: **11 tickets, 22 gates, zero gated by a model other than the one
that built them.** Variable builder models do not break the rule, but they remove
the assumption that made the default safe.

### 3. What a small builder loses is the thing this skill leans on hardest

`SKILL.md`'s longest passage is about builders **refusing to transcribe a wrong
brief** — eight recorded corrections across three sessions: three in the second
(an id, a ticket's status, and a "prototype-pollution defence" framing the builder
refused and the next gate upheld), four in the fourth, and one in the sixth, where
a gate finding's every premise held and its conclusion was false; the builder
reproduced it, refuted it, applied nothing, and wrote the regression test the
finding had actually been pointing at.

**It fails green.** A builder that transcribes produces a passing branch and a
plausible Log, and the gate is then the only thing standing where the current
arrangement catches the error twice. That is the argument against `haiku` for
builders specifically, and it is stronger than the cost argument in the other
direction.

### The cost side, which is real and was already measured

`sizing.md` prices a builder round at **100 k / 94 k / 118 k tokens** across three
rounds of one 123-line docs ticket — _"cost rises as the work shrinks"_, because a
resumed builder pays a full context reload. So a cheap model on a genuinely
mechanical ticket saves a real number. **The same page prices the downside**: a
branch that needed extra rounds cost 978 k against a sibling's 322 k, _"and the
difference was rounds, not difficulty"_. One wrong model call buys a rebuild round
plus its gates plus the orchestrator's relay context — more than the saving, in
the units the page already uses. The asymmetry settled it, not the per-token rate.

## The decision, and its answer

**Which model runs a builder, and who chooses it.** Answered 2026-09-01 by the
repo owner, from four options put with their costs:

- **Amended 2026-09-01, by measurement: `mechanical` maps to `haiku`, not
  `sonnet`.** The original mapping is in the Log below with the two trials that
  overturned it.
- **Chosen: the ticket declares a `difficulty`, and the mapping to a model lives
  in one place.** `mechanical` · `standard` · `hard`, optional, absent meaning
  inherit. The field never names a model, so no ticket ages when a model is
  renamed or retired, and the mapping is one table in `.claude/agents/builder.md`.
- **Chosen: optional and blank everywhere.** All 89 existing tickets keep the
  status quo; nobody back-rates work they have not read. Absent has to keep
  meaning "inherit", or adding the field would silently re-dispatch every open
  ticket at a different model.
- Rejected — `builder_model: sonnet|opus` on the ticket: simplest to consume, but
  it hardcodes a model name into 89 files and ages badly.
- Rejected — a prose line in `## Build`: no parser change, but only readable by
  whoever reads the whole ticket, which the orchestrator deliberately does not do.
  Frontmatter is the one part of a ticket readable at near-zero cost.
- Rejected — the orchestrator routes from a seam-map difficulty rating: needs the
  mapper's "no opinions" contract amended, and asks for §1's judgement from the
  agent least placed to make it.
- Rejected — leave it undocumented: the reason this ticket existed.

**Not decided here, and deliberately:** `ticket-reviewer.md`'s own `model: sonnet`
pin is argued from a measurement and was not touched.

## Build

1. `scripts/status.mjs` — `difficulty` in `FIELDS` as optional, a `DIFFICULTIES`
   list beside `KINDS` and `STATUSES`, validation in `validate()`, the default to
   `null`, the JSDoc record type, and a row in `--show`. No column in the table:
   the table is what a person reads and this field is for a dispatcher.
2. `scripts/test/status.test.ts` — the rejection, the optionality, the spelled-out
   `null`, the value reaching the record, and the `--show` row.
3. `docs/01-TICKETS.md` — the field table row and what the field is for.
4. `.claude/agents/builder.md` — the mapping table and why `haiku` is out.
5. `.claude/skills/orchestrate-tickets/SKILL.md` and `reference/dispatching.md` —
   who reads the field, and that the gate's `resolvedModel` check is now
   load-bearing rather than a backstop.

## Done when

1. The decision above is recorded on this ticket with its answer and its reason. ✓
2. `builder.md` says what model a builder runs on and why. ✓
3. `dispatching.md` says who chooses it and from what, and `SKILL.md` step 4 says
   the `resolvedModel` check is now load-bearing. ✓
4. No agent file's `model:` pin other than the builder's changed. ✓ — `builder.md`
   still pins nothing, which is now the documented answer rather than the silence.
5. `npm run check` passes and `npm run format` has been run over any changed `.md`.
6. `npm run status -- --show repo-17` parses and `npm run status -- --json`
   exits 0.

## Log

- **2026-09-01** — Filed and implemented in one branch, out of a conversation
  about whether the orchestrator could pick a builder's model by difficulty.

  **Id.** `repo-17` confirmed free against both lists `docs/01-TICKETS.md`
  requires: `docs/work/` topped out at `repo-16`, and a grep for `repo-1[7-9]` and
  `repo-[2-9][0-9]` over the tree returned only `repo-40`, `repo-80`, `repo-90`
  and `repo-99`, all `scripts/status.mjs` test fixtures. No remote branch and no
  pull request — any state — named `repo-17` or higher.

  **The framing this started from had one thing wrong**, and it is the reason the
  field is on the ticket rather than in the dispatcher. The question was posed as
  "could the orchestrator choose the builder model by difficulty", which reads as
  a dispatch-time flag. It is not: the orchestrator does not read the tickets, on
  purpose and with a number attached, and the agent that _does_ read them is
  instructed to return no opinions. The cheap-looking version of this change was a
  contract change to `seam-mapper`.

  **Two things measured while filing that were not in the framing:** two of the
  three dispatched agents already pinned a model and only the builder did not — so
  this was a gap in an otherwise deliberate pattern, not a new policy; and
  `sizing.md` already priced both sides of the trade, which meant the cost
  argument needed no new measurement, only reading.

  **The five new tests were run red first.** With `scripts/status.mjs` reverted
  and the tests in place: `5 failed | 109 skipped`, naming all five. With the
  change: `114 passed`. The parser rejects an unknown key by file and line
  (`status.mjs:86-89`) and CI's `check` job reads `--json`'s exit code, so a field
  added to a ticket without the parser change takes the whole board down — which
  is why the parser landed in the same commit as the first ticket to carry the
  field.

  **This ticket carries `difficulty: standard`, and it is the only one in the tree
  that carries the field at all.** Deliberate: a rating on a `done` ticket is dead
  weight by this ticket's own argument, and it is here as the worked example the
  next author copies. Ordinary rather than `hard` — a parser field with a
  three-value taxonomy is judgement, but it reaches no contract and no seam.

  **Not gated.** No `ticket-reviewer` was dispatched; the change was made directly
  at the user's request rather than through the orchestrate loop, so there is no
  `## Review` section and this line is the record of that instead of a verdict
  nobody gave. The mechanical checks that did run are named in _Done when_.

- **2026-09-01, later the same day — the `mechanical` mapping was measured and
  changed.** It shipped as `sonnet` with `haiku` argued out. The argument was the
  eight recorded cases of a builder refusing to transcribe a wrong brief — real
  evidence, **all of it drawn from `hard` tickets**, generalised to a category
  that did not exist when those corrections happened. That was the error.

  Two controlled head-to-heads, identical prompts, separate worktrees, one model
  each:

  | trial                                                      | haiku 4.5           | sonnet 5        |
  | ---------------------------------------------------------- | ------------------- | --------------- |
  | a one-line dead link in `.claude/skills/add-tool/SKILL.md` | **$0.2536** / 142 s | $0.4043 / 156 s |
  | dl-36, a DER encoding rule with tests                      | **$0.5683** / 444 s | $0.9288 / 268 s |

  Both produced correct work both times. On dl-36 the two encoders were verified
  functionally identical over counters 0–70,000 with zero divergences, and
  haiku's test asserted the exact expected hex per case where the other asserted
  properties and a round-trip.

  **Three things the measurement corrected, and the first is the one to keep:**

  - **`subagent_tokens` is not a cost proxy.** The first comparison was reported
    from it — 30,368 against 33,102, "an 8% saving". It excludes cache reads,
    which are ~94% of the bill. Priced properly the gap was 37%, and against the
    Opus a builder actually inherits it was **4×** ($1.0107 at the same volume).
    A cost claim off that field is wrong by an order of magnitude.
  - **Cost is context re-reading, not generation.** Output was $0.014 of the dead
    link's $0.254. haiku made more calls and read more context in both trials and
    was still cheaper, because the rate is half. It is also slower — 1.65× on
    dl-36.
  - **A gate is a real net, and it is not free.** haiku saved $0.36 on dl-36; a
    rejected builder round costs about $0.93 plus a re-gate. The rating pays while
    the cheaper builder is usually right, which on this evidence it was.

  **The one real failure, which earned a rule rather than a reversal.** dl-36's
  acceptance required the new test run red against the unfixed source. The sonnet
  builder ran it and then volunteered that its own red was weak. The haiku builder
  did not run it: it asserted in-test that a _local copy_ of the old function
  produced high-bit values and reported that as "the test is red-green". The diff
  was fine; the claim was not. `builder.md` now carries **"never report a
  verification you did not run"**, naming the substitution case, because a gate
  sees the diff while the orchestrator's relay sees the report and nothing gates
  that path. A smaller one, not worth a rule: that builder's commit subject said
  "close dl-36 with gate record" when no gate had run — though it appended a Log
  entry and correctly did **not** fabricate a `## Review` section.

  **What the trials could not settle**, said plainly: n=2, on one repo, with two
  briefs that were both correct. Neither trial tested a `mechanical` rating that
  turned out to be wrong, which is the risk the argument above actually rests on.

  **Deliberately not folded in:** nothing rated any of the 8 other open tickets.
  Back-rating work this session has not read is the exact judgement §1 argues the
  orchestrator should not make, and the field is optional so that the queue does
  not need it.
