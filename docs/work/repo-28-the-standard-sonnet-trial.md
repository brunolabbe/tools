---
id: repo-28
tool: repo
title: The standard-to-sonnet trial, and why the saving does not survive the gate
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-28 — The standard-to-sonnet trial

## Why

repo-27 (branch `repo-27-difficulty-maps-to-a-model`, PR #170) pinned `hard` to
`opus` and deliberately left `standard` alone, holding the `standard` → `sonnet`
half for a head-to-head rather than an argument. Its Build step 6 specifies that
trial and says to file it as its own ticket. This is that ticket, filed after the
trial ran, so it carries the result rather than the intent.

The question it answers: **should a `standard` ticket dispatch its builder on
Sonnet instead of inheriting Opus?**

## What was run

2026-09-06/07. One synthetic subject — `parseContentRange`, an RFC 7233 §4.2
`Content-Range` response-header parser for `packages/core`, with tests. Chosen
because it has many distinct ways to be wrong; repo-17's two trials both ended
_"Both produced correct work both times"_, which measures cost and nothing else,
and its own Log names that as the gap: _"neither trial tested a `mechanical`
rating that turned out to be wrong, which is the risk the argument above actually
rests on."_

- Two `builder` dispatches, backgrounded, in their own isolated worktrees.
- **Prompts byte-identical apart from one character** — the branch name, `-a`
  against `-b`, because git refuses a second checkout of the same branch.
  Verified by `diff`: one line differs.
- Neither builder was told it was in a trial.
- **The grading oracle was pre-registered before either implementation existed**:
  `sha256 357fc4bb22b20f95`, 2026-09-06T23:13:36Z. 6 must-accept cases with
  expected values, 21 must-reject, and 6 **recorded but not scored**.
- Both models confirmed from their own task-output files rather than assumed:
  `claude-sonnet-5` and `claude-opus-5`.

The six unscored cases are the ones the brief explicitly delegates — leading
zeros, values past `MAX_SAFE_INTEGER`, whitespace strictness, unit case, and
`bytes */0`. Scoring a delegated judgement call as an error would have measured
obedience, not correctness. **That pre-registration earned its keep**: the Opus
builder ended its report asking to be told whether `bytes */0` should reject,
having read the brief's "complete-length not greater than `last`" as scoped to
the satisfied form. That exact input was already on the not-scored list, written
hours before its code existed.

### Deviations from repo-17's protocol, declared

1. **Neither branch was gated.** repo-17 gates; this used the pre-registered
   oracle as the round signal instead — a branch failing a pre-registered case is
   a branch that would have come back. Cheaper and more objective than a
   reviewer's judgement, but it means the extra-round rate was inferred from
   correctness rather than observed from a gate.
2. **The subject is synthetic**, where repo-17's second trial was a real ticket.
   No unclaimed `standard` ticket existed: repo-24, repo-25 and dl-40 were all
   live in peer sessions.
3. **The gate figure below is a proxy**, taken from repo-27's own gate rather
   than from gating these branches.

## What it measured

**Correctness: a tie.** Both implementations scored **27/27** on the
pre-registered oracle — every valid shape parsed with the right numbers, all 21
rejections rejected, each with a distinct machine-readable reason.

|                     | Sonnet 5  | Opus 5    |
| ------------------- | --------- | --------- |
| scored oracle cases | **27/27** | **27/27** |
| billed cost         | **$2.36** | $4.23     |
| requests            | 107       | 81        |
| wall clock          | 13.2 min  | 11.2 min  |
| cache-read volume   | 8,597,089 | 5,584,076 |

Cost is computed from billed volume — `cache_read_input_tokens` included, at
96–97% of all input tokens — which independently reproduces repo-17's ~94% and is
the field it lacked when it reported "an 8% saving" that was wrong by an order of
magnitude. These are published API rates, not an invoice.

**Sonnet costs 56% of Opus for the same correct result — a 44% saving, $1.87 per
build.** Taken alone, that is the case for the change. It is also the wrong unit.

### The saving does not survive the gate

The cross-model rule means a Sonnet builder must be gated by Opus. Measured on
repo-27's gate: 161 requests, 11,182,450 cache-read tokens — **more context than
either builder read**. Priced both ways:

|                                     | builder | gate  | per ticket |
| ----------------------------------- | ------- | ----- | ---------- |
| today: opus builds, sonnet gates    | $4.23   | $2.97 | **$7.20**  |
| proposed: sonnet builds, opus gates | $2.36   | $4.82 | **$7.18**  |

**A 0.3% difference. The change moves the cost, it does not remove it** — and it
moves it onto the larger of the two consumers, because the gate reads more than
the builder does. The upper-bound reading is worse: pricing the Sonnet gate's
_measured_ volume at Opus rates gives $7.43 and a per-ticket **loss** of $2.59
(36%). The $4.82 figure scales that volume by 0.65, the ratio Opus actually used
against Sonnet on the identical build task — a fair adjustment, but an assumption
carried from a build task to a gate task, not a measurement. **The true figure is
somewhere between a wash and a 36% loss, and nothing here puts it in profit.**

### The one capability difference, in Sonnet's favour

The brief asserted _"nothing in the tree parses it, and each caller reaches for
its own regex."_ That was false, and it was my error: `parseContentRangeTotal`
has existed all along, used twice in `progressive.ts`:
`tools/downloader/engine/src/download/http.ts:114 "export function parseContentRangeTotal"`

**The Sonnet builder caught it and said so. The Opus builder did not mention it.**
That is one instance, not a pattern, and it is the exact behaviour repo-17's
argument for keeping builders large rests on — eight recorded cases of a builder
refusing to transcribe a wrong brief. Here the cheaper model produced it and the
more expensive one did not.

Both builders pushed back on the brief elsewhere and both were right: neither of
the 14 `CORE_ERROR_CODES` fits a malformed header, `packages/core` never throws,
and the brief cited a `packages/core/CLAUDE.md` that does not exist — three flaws
in my instrument, inherited identically by both sides, so they bias nothing.

## The decision, and its answer

**Should `standard` map to `sonnet`?** Recommendation: **no** — not because Sonnet
is worse, which this trial gives no evidence for, but because the saving is an
artefact of measuring the builder alone. Under the cross-model rule the two halves
are coupled, and the coupled figure is a wash at best.

Options, for the record:

- **Recommended — leave `standard` at `inherit`.** The cost case is the only case
  that was ever made for it, and it does not survive the pairing.
- Map `standard` → `sonnet` anyway, on the volume-adjusted reading that it is
  cost-neutral and the capability evidence mildly favours Sonnet. Costs nothing
  and gains nothing on this evidence; adds a per-ticket pairing check for the
  largest rated category against a recorded failure of 11 tickets, 22 gates, none
  gated by a different model.
- Revisit the **gate** instead. The gate is the larger consumer and nothing has
  ever measured whether it needs to be. That is a different ticket and a better
  question than this one.

**Not decided here:** `ticket-reviewer.md`'s `model: sonnet` pin, untouched by
repo-17 and untouched here.

### Answered 2026-09-07 — option 2, against this ticket's own recommendation

Recorded with its provenance, because a decision that overrode a recommendation
is a different fact from one that followed it, and only the record carries which.

|                                      |                                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Question**                         | Should a `standard` ticket dispatch its builder on Sonnet instead of inheriting Opus?                                                                                                                                      |
| **Options put**                      | (1) leave `standard` at `inherit`, **this ticket's recommendation and offered first**; (2) map `standard` → `sonnet` on the volume-adjusted reading; (3) revisit the gate instead, as a separate ticket                    |
| **Chosen**                           | **(2), map it.**                                                                                                                                                                                                           |
| **Whose recommendation it overrode** | **This ticket's own.** The filer recommended (1) on the grounds that the 44% builder saving is an artefact of measuring the builder alone, and that the coupled figure is a wash at best                                   |
| **Stated grounds for the answer**    | The volume-adjusted reading — cost-neutral, with the capability evidence mildly favouring Sonnet                                                                                                                           |
| **How it was taken**                 | The orchestrator put the three options to the owner with (1) first and recommended; the owner chose (2). Relayed to this branch with that provenance attached, and re-read here against this ticket's text before building |

**What the answer does not change.** The measurements above stand exactly as
written: the coupled per-ticket figure is still $7.20 against $7.18, still a 0.3%
wash, and the upper-bound reading is still a 36% loss. **The change is not
justified by a saving and must not be cited as one** — it is an owner decision
that the move is free and that the one capability observation points the right
way. Option 3 — measuring whether the gate needs to be the larger consumer —
remains unfiled and is still the better question.

## Build

Nothing to build until the decision is answered.

**Land this after PR #170**, whichever way the decision goes: both touch
`.claude/agents/builder.md`. That ordering is deliberately _not_ a `depends_on`
entry — repo-27's ticket file does not exist on `main` yet, and a `depends_on`
naming a ticket the branch cannot see is a `dangling-dependency` that takes
`npm run status -- --json` to exit 1, which is the whole CI gate. Reproduced here
before it was removed.

1. If the answer is _leave it_: record the answer in this ticket, set `status`
   to `done`, and add one line to `.claude/agents/builder.md` under the table
   saying the `standard` row was measured and left deliberately, so the next
   reader does not re-open it from the same cost intuition. Cite this ticket.
2. If the answer is _map it_: change the `standard` row, and in the same commit
   make `SKILL.md` step 4's per-ticket pairing check explicit for `standard`,
   because the gate's correct model then varies across most of the board.

**Built 2026-09-07 on `repo-21-orchestration-skill-loop`, step 2.** Not a branch
of its own: repo-21 rewrites `SKILL.md` from 674 lines to 347 in the same window,
and step 2's "in the same commit" cannot be honoured across two branches racing
the same page. `#170` was confirmed merged first — `gh pr view 170` reports
`MERGED` at 2026-09-07T11:41:13Z, and `repo-27`'s file reads `status: done` on
`main` — so the ordering this section requires held.

## Done when

1. The decision above is recorded with its answer and its reason.
2. `.claude/agents/builder.md` reflects the answer, whichever it is.
3. `npm run check` passes and `npm run status -- --json` exits 0.

**Verdicts, 2026-09-07.**

1. **proven** — _Answered 2026-09-07_ above, with the question, the three options,
   which was chosen, and that it went against this ticket's own recommendation.
2. **proven** — the `standard` row reads `` `sonnet` ``, and the change is now
   machine-checked from the other side: `SKILL.md` carries
   `.claude/agents/builder.md:23` "| `standard` | `sonnet` |" as an anchored
   citation, and `ci.yml` runs
   `node scripts/citations.mjs …/SKILL.md --require-anchors` on every push. Revert
   the row and that job goes red naming this line.
3. **proven** — `npm run check` exit 0, `node scripts/status.mjs --json` exit 0,
   `npm test` 2170 passed.

## Review

**Gate: PASS** — 2026-09-07 · `origin/main...HEAD` (`5065aed`) · own defect hunt, no `code-review` dispatch (subagent has no `Skill` tool), Sonnet against an Opus build

Same checkout as repo-21's gate (one branch, shared commits); see that ticket's header for setup detail. Re-verified at the final tip `5065aed`; nothing in this ticket's own files changed between `928e3ac` and `5065aed`.

| Done when                                          | Proof                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Decision recorded with answer and reason        | _Answered 2026-09-07_ section present: question, 3 options with the recommended one marked, which was chosen, whose recommendation it overrode, how it was taken ✓                                                                                                                                 |
| 2. `builder.md` reflects the answer                | `builder.md:23`'s `standard` row reads `sonnet`, confirmed by direct read and by `citations.mjs` resolving `SKILL.md`'s citation of it. Machine-checked from the other side: reverting the row turns `ci.yml`'s citations step red, reproduced independently as part of repo-21's Build 1.4 test ✓ |
| 3. `npm run check` passes, `status --json` exits 0 | Reproduced at `5065aed`: both exit 0 ✓                                                                                                                                                                                                                                                             |

- **low** · The ticket's own Done-when-3 test-count claim ("2170 passed") is correct — reproduced independently at 129 files / 2170 tests, matching exactly.
- **dropped** · none.
- **findings** · own defect hunt returned 1; 1 carried (low, above), 0 dropped.

NFR: security n/a · performance n/a — the cost/gate-parity arithmetic ($7.20 vs $7.18) is re-derivable from the numbers given; not re-run, since it is a historical measurement this branch's diff does not re-execute · reliability n/a · maintainability — the decision's provenance table is a good model of the "how it was taken" rule the ticket itself argues for.

**Shared observation, not a finding.** `.claude/agents/ticket-reviewer.md` — the file I am — carries no comment beside its untouched `model: sonnet` pin, which repo-28 leaves deliberately out of scope. The residual risk is stated clearly at the two places a dispatcher actually consults before it would bite (`SKILL.md`'s pairing table, and this ticket's own Log), just not in the pin's own file. Not raised as a finding; this is a deferred question for the repo's owner, not a settled one.

## Log

- **2026-09-07** — Filed after running the trial, so it carries the result rather
  than the intent. Id confirmed free against both lists: `docs/work/` topped out
  at `repo-27`, `git grep "repo-28\b"` returned nothing, no remote branch and no
  pull request named it.

  **repo-27 is cited as PR #170 rather than linked**, because its ticket file
  does not exist on `main` yet and `scripts/citations.mjs` resolves
  repo-relative — a link into an unmerged sibling branch fails.

  **What I got wrong before measuring.** I estimated break-even at "near a 30%
  extra-round rate" while writing repo-27, reasoning from the builder cost alone.
  On the builder alone the real figure is 79%, which is far more favourable to
  Sonnet than I guessed. Including the gate there is no break-even to compute,
  because the pairing starts at parity or worse. **Both of my numbers were wrong
  and they were wrong in opposite directions**, which is the tell that I was
  reasoning about the wrong unit rather than being imprecise about the right one.

  **The trial branches** `core-content-range-a` (Sonnet) and
  `core-content-range-b` (Opus) were left in place, unmerged and unpushed. Both
  contain correct, tested work that nothing has asked for. The real follow-up
  they surfaced is not the parser but the duplication the Sonnet builder found:
  `parseContentRangeTotal` already exists in the downloader and is lenient where
  this one is strict. Consolidating those is a real ticket in `tools/downloader`,
  not filed here, because it belongs to a tool this ticket has no business
  reaching into.

- **2026-09-07, second pass — the decision came back as an override, and it was
  built on `repo-21`'s branch rather than its own.** The full record is under
  _Answered 2026-09-07_ above; what belongs here is what the build found.

  **Both relayed facts were re-checked before building on them, and both held.**
  `gh pr view 170` reports `MERGED` at 2026-09-07T11:41:13Z with merge commit
  `7862e9c`, and `repo-27`'s file on `main` reads `status: done` — so the "land
  this after PR #170" ordering was satisfied, verified rather than taken from the
  relay. Build step 2's wording was read from this file, not from the relay, and
  it asks for exactly what was done.

  **The pairing consequence is bigger than the table row, and it is the reason
  step 2 couples them.** With `standard` on Sonnet, three of four difficulty rows
  now disagree with `ticket-reviewer.md`'s `model: sonnet` default, and the row
  that moved is the largest rated category. The failure it introduces is
  **silent**: a `standard` ticket gated by the default is a Sonnet build checked
  by Sonnet, which produces a normal-looking gate record and trips nothing. That
  is the same shape as the violation repo-27 fixed for `hard`, one row over —
  a default that was right by accident and stopped being right when something
  underneath it changed.

  So `SKILL.md` now carries a four-row pairing table with a gate column, and loop
  step 4 names `standard` in one clause, because step 4 is what an orchestrator
  reads mid-loop and the table is what it reads once.

  **Placement was questioned rather than transcribed.** repo-28 was written
  against a 674-line `SKILL.md`; the page is 350 lines on this branch and the
  question of whether the rule belongs there at all was put explicitly. It does:
  the gate's model is a **dispatch decision**, and the orchestrator is the only
  participant that makes it — the builder cannot choose its reviewer by design,
  and `dispatching.md` is prompt mechanics. Moving it would split one decision
  across two pages, which is exactly what this branch's own one-instruction-one-file
  rule forbids. The addition costs **no net lines**: the table replaces three
  prose bullets that said less.

  **The row is now checked from both sides.** `SKILL.md` cites
  `.claude/agents/builder.md:23` "| `standard` | `sonnet` |" as an anchored
  citation, and `ci.yml`'s `check` job runs `citations.mjs --require-anchors` over
  `SKILL.md` on every push (repo-21). Reverting the row without updating the skill
  turns CI red naming the line — which is the drift class repo-21 exists to catch,
  applied to this ticket's own change on the day it landed.

- **One thing left undone, named rather than absorbed.**
  `.claude/agents/ticket-reviewer.md`'s `model: sonnet` pin is now wrong for the
  largest rated category, and this ticket declares it out of scope
  (_"Not decided here"_). That scope call is respected: the pin is untouched and
  no warning was added beside it, because the dispatch rule lives in `SKILL.md`
  and a second copy is the disease repo-21 just treated. **The residual risk is
  therefore real and stated**: an orchestrator that forgets to pass `model` gets
  Sonnet-gates-Sonnet on a `standard` ticket, silently. Whether the pin should
  become an explicit `null`, a comment, or stay as it is, is a decision for the
  owner and a follow-up ticket — not something to settle inside this build.

- **`commit-message.mjs` has no opinion about ticket ids, which is worth knowing
  before anyone designs around it.** Asked whether two ids in one subject are
  accepted, the answer is yes — and so is **none**:
  `node scripts/commit-message.mjs --text "fix(repo): a subject with no id at all"`
  exits 0. It enforces type, format and scope (a `fix` with no scope is rejected,
  naming the allowed set) and nothing else. The id-in-the-subject convention is
  `CLAUDE.md`'s and is unenforced, exactly as `CLAUDE.md` itself says.
