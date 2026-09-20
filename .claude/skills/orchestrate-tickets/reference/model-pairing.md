# Why each builder row reads as it does

Provenance for the model-pairing table that `.claude/agents/builder.md` and
`SKILL.md`'s _Which model built it_ both carry. Moved here from `builder.md` on
2026-09-20, where it had been lines 11 to 151 of a 296-line file loaded into every
builder — narrative that no builder needs to build, on the page that costs every
dispatch. Nothing below is an instruction; the table is the instruction and it
lives on those two pages.

## The field and what it rates

**A ticket rates its own work** in its optional `difficulty` frontmatter field,
and the caller maps it to a model — reading *inherit* as **the orchestrator's own
model, passed to the builder explicitly**, which is how `orchestrate-tickets` step 3
has dispatched since 2026-09-04.

**`difficulty` rates the work as it will be once its decisions are answered** —
not how blocked it is now. The two are orthogonal and collapsing them destroys the
field: a ticket with an open decision is not dispatchable *at all*, whatever its
rating, so encoding that here says nothing a dispatcher can act on while hiding
the thing it can. Measured 2026-09-02, the first time anything tried to use this
scale: eight tickets rated by a reader that was warned about exactly this, and the
correlation came back perfect — every `hard` had an open decision, the single
`standard` had none. One of them was reasoned as *"the fix is mechanical, but the
ticket carries an unresolved call"*, which is a mechanical job wearing a `hard`
label because nobody has answered a question yet. **Rate the build, not the
blockage**; `npm run status` already reports the blockage.

**`hard` names a model because `inherit` cannot keep its promise.** The row used
to read *inherit*, with *"never below the default"* as its reason — but *inherit*
is whoever is orchestrating, and the skill already knew what that costs.
`orchestrate-tickets` step 4 said it in its own words, about the gate: pass
`model: "opus"` *"when the builder ran Sonnet, which happens when **you** are
Sonnet and the ticket inherits"* — step 4's wording at repo-27, quoted as it
stood; repo-28 widened when it applies, because a `standard` ticket now builds on
Sonnet by rating rather than by inheritance. Under a Sonnet orchestrator that
applied to `hard` too — the one category defined as contract-touching and
seam-reaching was built by Sonnet, the floor was violated, and nothing reported
it. `mechanical` never had this problem because it names a model. `hard` was the
only row that stated a floor and then delegated it. See
[repo-27](../../../../docs/work/repo-27-difficulty-must-change-a-dispatch.md).

**The rating comes from the ticket, never from the orchestrator's guess.** The
author has read the work; the orchestrator's intake reads a seam map and
deliberately not the briefs (~27,800 est. tokens for nine candidates is what that
avoids). An unrated ticket is not a problem to solve by rating it at dispatch —
inherit and move on.

**`hard` and absent collapse onto one pairing under an Opus orchestrator.** Both
build on Opus and both gate on Sonnet, so the four-row table behaves as three
whenever the orchestrator runs Opus (measured 2026-09-12, two of four tickets in
one batch). Nothing is mis-dispatched — the checker still differs from the
checked on every branch — and the collapse is recorded so nobody reads the two
rows as producing different pairs.

## What the head-to-head measured, because the argument was wrong first

`mechanical` mapped to `sonnet` when the table was written, argued from the eight
recorded cases of a builder refusing to transcribe a wrong brief. That evidence is
real and it is all drawn from **`hard`** tickets; generalising it to a category
that did not exist yet was the error. Two controlled trials, identical prompts,
separate worktrees, 2026-09-01:

|                                        | haiku 4.5   | sonnet 5 |
| -------------------------------------- | ----------- | -------- |
| a one-line dead link                   | **$0.2536** | $0.4043  |
| dl-36: a DER encoding rule, with tests | **$0.5683** | $0.9288  |

Both produced correct work both times. On dl-36 the two encoders were **verified
functionally identical over counters 0–70,000, with zero divergences**, and
haiku's test was the better of the two — it asserted the exact expected hex per
case, where the other asserted properties and a round-trip.

**Cost is almost entirely context re-reading**, not generation: on the dead link,
output tokens were $0.014 of a $0.254 bill. So the saving comes from the rate, not
from doing less work — haiku made *more* calls and read *more* context in both
trials and was cheaper anyway. It was also slower: 444 s against 268 s on dl-36.

## What the second head-to-head measured, for `standard`

`standard` mapped to *inherit* until repo-28, on the reasoning that somebody read
the work and said it was ordinary, which is a statement and not a dispatch. The
trial that settled it, 2026-09-06/07 — one synthetic subject, an RFC 7233
`Content-Range` parser with tests, two `builder` dispatches whose prompts differed
by **one character**, neither builder told it was in a trial, and a grading oracle
**pre-registered before either implementation existed** (`sha256 357fc4bb22b20f95`),
27 scored cases and 6 delegated judgement calls deliberately left unscored:

|                     | sonnet 5  | opus 5    |
| ------------------- | --------- | --------- |
| scored oracle cases | **27/27** | **27/27** |
| billed cost         | **$2.36** | $4.23     |
| cache-read volume   | 8,597,089 | 5,584,076 |

Both models were confirmed from their own task-output files rather than assumed.
Cost is billed volume with `cache_read_input_tokens` counted at 96–97% of input,
which independently reproduces repo-17's ~94% — the field repo-17 lacked when it
reported an "8% saving" that was wrong by an order of magnitude.

**The one capability difference went Sonnet's way**, which is the opposite of the
direction the argument for large builders predicts. The brief asserted that
nothing in the tree parsed `Content-Range`; that was false, and the Sonnet builder
caught it and said so where the Opus builder did not. One instance, not a pattern.

**And the saving does not survive the gate, which is why this row was a decision
and not a calculation.** A Sonnet build must be gated by Opus, and the gate is the
larger consumer: the old pairing cost **$7.20** a ticket and the new one **$7.18**
— a 0.3% difference, a wash. The upper-bound reading is a 36% *loss*. **repo-28
therefore recommended leaving this row alone, and the owner overrode that
recommendation**, on the volume-adjusted reading that it is cost-neutral with the
capability evidence mildly in Sonnet's favour. The row is there on an owner
decision against the filer's advice, not on a cost case — recorded so nobody
re-derives a saving from it. See
[repo-28](../../../../docs/work/repo-28-the-standard-sonnet-trial.md). One later
measurement runs the other way: on a two-round gate each, the Opus gate on a
Sonnet-built `standard` ticket cost 187,338 against 296,234 for the Sonnet gate on
an Opus-built `hard` one (2026-09-17) — one batch, not a rule.

**What it costs the dispatcher, and this is the live consequence.** `standard` is
the largest rated category, and it is the one row whose gate disagrees outright
with `ticket-reviewer.md`'s `model: sonnet` default — the unrated row disagrees
only under a Sonnet orchestrator — so the gate's model cannot be set once per
batch. (This paragraph said "three of the four rows" on `builder.md` from repo-28
until 2026-09-20; against the gate column it was never three.) Before repo-28 that default was right whenever the builder
inherited Opus; it is now wrong for every rated `standard` ticket, and it fails
**silently** — a Sonnet build gated by Sonnet looks exactly like a compliant pair.
`SKILL.md`'s _Which model built it, and which gated it_ carries the pairing table;
it is the dispatcher's rule.

**A ticket filed and built in the same dispatch cannot be governed by its rating**,
because the rating is written after the model was chosen. `repo-36` was filed
`standard`, built on Opus and gated on Sonnet (2026-09-07); nothing went wrong,
and the general case is not safe — had the build inherited Sonnet, the pair would
have been Sonnet-on-Sonnet under a `standard` label with nothing to catch it. Gate
such a ticket as the model the builder actually ran, not as the label says.

## The one thing that actually went wrong, and the rule it earned

dl-36's acceptance required the new test to be run red against the unfixed source
and said so. The sonnet builder ran it, got a failure, and then volunteered that
its own red was weak — the test failed on a missing function rather than a wrong
value, because the extraction was part of the fix. The haiku builder did not run
it. It wrote an in-test block asserting that a **local copy** of the old function
produced high-bit values, and reported that as "the test is red-green".

The diff was fine; the *claim* was not. A gate catches that — it is an acceptance
line, and acceptance-to-test traceability is what `ticket-reviewer` checks — but a
report also travels to the orchestrator, who relays it, and nothing gates that
path. Hence the rule that stayed on `builder.md`: **never report a verification you
did not run.**
