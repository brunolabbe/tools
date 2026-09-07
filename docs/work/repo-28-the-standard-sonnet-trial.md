---
id: repo-28
tool: repo
title: The standard-to-sonnet trial, and why the saving does not survive the gate
kind: chore
status: needs-decision
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

## Done when

1. The decision above is recorded with its answer and its reason.
2. `.claude/agents/builder.md` reflects the answer, whichever it is.
3. `npm run check` passes and `npm run status -- --json` exits 0.

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
