---
id: pl-23
tool: planner
title: A pinned out-of-season candidate's currency changed meaning, and nothing tests it
kind: chore
status: ready
milestone: null
depends_on: []
---

# pl-23 — The one candidate that can be placed and filtered out at once

**Packages:** `itinerary` (tests, and possibly one comment)

## Why

`uncheckedFor` decides whether to say "costs came back in two currencies and
nothing here converts between them" by reading the costs of what was placed
(`itinerary/src/unchecked.ts:194`):

```ts
const placed = candidates.filter((candidate) => placedIds.has(candidate.id));
```

`candidates` there is **everything the fan-out proposed, placed or not**. Before
[pl-10](./pl-10-plan-view-and-provenance.md) the same ids were looked up in
`season.kept` — the set that survives the season filter — and the two disagree
for exactly one kind of candidate.

**A pinned candidate outranks the season filter**, deliberately and with a
comment saying so at `itinerary/src/compose.ts:141`: a pin is the user's
decision, so `packable` keeps a candidate that is out of season when its id is
pinned. That candidate can therefore be **placed on a day and absent from
`season.kept` at the same time** — it is the only candidate that can be both. So
its currency used to be invisible to this check and now counts, and a plan whose
only second currency is on a pinned out-of-season item gained a
`budget-currency` note it did not have before.

The new behaviour is very likely the correct one — the item is on the plan and
its cost is real, so declining to sum is the honest answer — and that is the
argument, not the evidence. **The change was silent**: pl-10's Log did not
mention it, and the review that caught it recorded it as `low` and left it
alone because nothing can reach it yet. Nothing calls `compose()` with
`previous` outside tests, because re-plan is Phase 4.

**The gap is narrower than "mixed currencies are untested".** They are tested,
twice — `itinerary/test/compose.test.ts:470` and
`itinerary/test/unchecked.test.ts:119` — and neither passes a `previous`, so
neither has a pinned item in it, so neither can tell the two behaviours apart.
That is the whole finding: the one input that distinguishes them is the one no
test constructs.

## Build

1. **A `compose` case with a `previous` revision whose pinned item is out of
   season**, carrying the only cost in a second currency. Assert the
   `budget-currency` note is present and names both currencies. That test fails
   against the pre-pl-10 lookup and passes against this one, which is what makes
   it worth writing rather than a restatement.
2. **Assert the item is on a day**, in the same test. If the pin stopped
   outranking the season filter the note would disappear for an unrelated
   reason, and a test that only checked the note would report the wrong cause.
3. **Say so in `unchecked.ts`.** One sentence at the currency lookup: `placed` is
   the full candidate list on purpose, because a pinned out-of-season candidate
   is on the plan and out of `season.kept`. The line looks arbitrary without it,
   and the next person to tidy it towards `season.kept` will have no reason not
   to.
4. **Nothing else changes.** If the assertion count moves anywhere else,
   something went wrong.

Traps worth knowing in advance:

- **Do not "fix" the behaviour.** This ticket pins down what the code does and
  argues for it; it is not a licence to change the answer. If you conclude the
  old lookup was right, stop and say so — that is a contract-shaped decision
  about what a plan claims, not a refactor.
- **`ALL_YEAR` and `null` are different**, and neither is "out of season".
  `season: null` is _nobody established it_, which produces its own
  `season-unknown` note. The candidate this ticket needs has a real season
  window that the trip's dates fall outside of.
- **The fixtures are checked in per trip shape.** Build the case from those
  rather than inventing a seventh — `compose.test.ts` already has the helpers.

## Done when

- One `compose` test places a pinned, out-of-season candidate carrying the only
  second currency, and asserts both that it is on a day and that
  `budget-currency` names both currencies.
- `unchecked.ts` says why the currency lookup reads every candidate rather than
  `season.kept`.
- No other test's assertions change, and the planner suite's count moves by
  exactly the tests added.
- `npm run check` and `npm test -- --project planner` pass.

## Log

### 2026-08-22 — pinned down, behaviour unchanged

Worked through the argument and agreed with it: a pinned out-of-season
candidate is on the plan, its cost is real, and declining to sum across two
currencies is the honest answer. So the post-pl-10 lookup stays and this ticket
is the test that says why.

- `itinerary/test/compose.test.ts` gains one test in _what it says it did not
  check_: a `previous` revision pins a candidate whose season is `12-01`–`03-15`
  against a July trip, carrying the only EUR cost beside a CAD lodging. It
  asserts the item is on a day **and** that `budget-currency` names `CAD and
EUR`, so a regression in the pin-outranks-season rule reports itself rather
  than showing up as a missing note.
- `itinerary/src/unchecked.ts` gains a three-line comment at the `placed`
  lookup saying the full candidate list is deliberate.
- Nothing else changed. Planner suite: **526 before, 527 after**, 40 files both
  times.

Checked the test earns its place rather than restating: with `compose` reverted
to `candidates: season.kept`, `compose.test.ts` goes 48 passed / 1 failed and
the one failure is the new test. That also confirms the brief's central claim —
no other test in the suite can tell the two lookups apart.

What the brief got wrong: nothing material. Two small notes for the next
reader:

- The brief cites `unchecked.ts:194` for the lookup; it is at line 92 in the
  file as it stands (194 falls inside the `budget-currency` block further down,
  which reads `placed`). The code it quotes is the right code.
- Building the case from the checked-in per-shape fixtures was not the shortest
  path. The fixtures are realistic trips and none has a single-currency-plus-one
  shape that a pin could flip, so bending one would have meant editing a shared
  fixture — the test uses `helpers.ts`'s `briefFor`/`candidate` builders and
  `compose.test.ts`'s own `asRevision`, which is what the surrounding
  mixed-currency and re-planning tests already do.
