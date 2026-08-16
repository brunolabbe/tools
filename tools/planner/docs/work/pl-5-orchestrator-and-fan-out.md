---
id: pl-5
tool: planner
title: The orchestrator and the specialist fan-out
kind: work-package
status: in-flight
milestone: P2
depends_on: [pl-4, pl-15]
---

# pl-5 — The orchestrator and the specialist fan-out

**Packages:** `agent`, `api` (and `web` for run progress)

## Why

This is the ticket where the tool becomes what it claims to be: a brief goes in,
the specialists that trip actually needs run on it, and candidates come out. The
roster being **a pure function of the brief** rather than a chain of conditionals
is the whole design ([00-ANALYSIS.md §4](../00-ANALYSIS.md)) — a resort week does
not need a route specialist, a skidoo weekend lives or dies on conditions, and a
specialist with nothing to say costs money and pads the plan.

It stops before composing. Packing days is arithmetic and belongs in
`itinerary`, in ordinary TypeScript with ordinary tests (§2).

## Build

1. **The roster as a table.** `rosterFor(brief)` maps trip shape and brief
   contents to a specialist list, as data — a table a test asserts against. If it
   becomes conditionals inside the orchestrator, "which agents ran and why" stops
   being answerable, which is the question anyone debugging a bad plan asks first.
2. **The specialists**, sharing one shape: brief in, `Candidate[]` out, prompt and
   output schema per specialist. Start with the three that carry the most trips —
   **route & logistics**, **lodging**, **activities** — and add conditions & gear,
   food, budget and practicalities behind the same interface. A specialist that
   proposes a schedule is a bug, not a feature.
3. **Fan out in parallel, join once.** The specialists depend on the brief and not
   on each other, so the run costs the slowest rather than the sum. The join
   before composing is a real barrier — the composer cannot pack a day without
   every candidate.
4. **The run is a job**, on `@webtools/core`'s transition machinery, with SSE:
   `queued → fanning-out → composing → reviewing → done | failed | canceled`.
   Progress is per-specialist and genuinely knowable, because the roster's size is
   fixed before the fan-out starts. Report `null` where a total is not known
   rather than inventing one.
5. **A per-run budget, enforced before the fan-out, not during it.** Cap the
   roster, the grounding calls and the tokens; degrade the roster to fit and record
   which specialists were dropped (§9). Discovering the ceiling mid-fan-out means
   paying for half a plan.
6. **Partial results are shipped with the gap named.** One specialist failing or
   timing out must not fail the run: the plan says "lodging was not checked". The
   repo's _never fake progress_ rule in this domain — a quietly invented hotel is
   worse than an admitted hole (§7).
7. **Every specialist reply is schema-validated** before anything acts on it, with
   a bounded re-ask inside the agent and `AGENT_MALFORMED_REPLY` past it. Specialists
   get no credentials and no write tools; from Phase 4 on they are reading hostile
   text (§5), and the habit has to exist before the grounding does.
8. **Scripted specialists for CI.** Extend the scripted provider so each
   specialist has a deterministic answer for the checked-in briefs from pl-3. The
   whole fan-out must run offline with no key.

Traps worth knowing in advance:

- **A specialist sees the brief and only the brief** — not the raw answers, not
  the tree, not another specialist's output. There is no transcript to be
  tempted by any more, but the rule predates that and outlives it: threading
  anything larger multiplies the bill by the roster size, and the `TripBrief`
  indirection is what makes a specialist testable from a fixture at all.
- **A brief arrives with its `refine` slots unknown**, and that is the normal
  case rather than a degraded one. The wizard stops at core-complete and offers
  the draft there (decided 2026-08-14, see the roadmap's _Still open_), so the
  first plan is usually built from the minimum. Specialists must read an unknown
  slot as unknown and say what they could not account for — never guess a value
  and never refuse to propose. pl-3's three-state slot makes this identical to
  the declined case, which is the point: there is one path, not two.
- **Season filtering happens before the composer**, not inside it: a candidate
  outside its own season window should never reach packing (§7).
- **A specialist that ignores the brief's appetite answers writes candidates the
  composer throws away.** Found by [pl-9](./pl-9-composer-and-critic.md) on
  2026-08-16, composing the six checked-in fixture sets: the route candidates are
  routinely over the day's drive budget and get dropped. The road-trip fixture
  proposes a 5½-hour leg to a party that answered `half-day`, and the resort
  fixture a 5-hour transfer — so a road trip comes out with no drives in it and a
  `no-candidates-found` gap where its route should be. The composer is right to
  refuse them; the fix is upstream. **`driveAppetite`, `pace` and `effort` are
  constraints on what a specialist may propose, not context for its prose**, and
  the numbers those answers translate into are in `itinerary/src/limits.ts`. A
  leg longer than the day allows has to be split or not proposed.
- **The composer is built and it takes the gaps from here.** `compose()` in
  `@planner/itinerary` accepts a `gaps` array and carries it onto the revision
  untouched, because it cannot tell "never on the roster" from "failed" — those
  are this ticket's to know. It adds only `no-candidates-found`, for a
  schedulable specialist that returned candidates and got none of them onto a
  day. It also returns an `unchecked` list that **does not persist**; see
  [pl-10](./pl-10-plan-view-and-provenance.md).
- **A route candidate is a leg, and a leg has two ends.** `Candidate.location`
  is a union as of [pl-15](./pl-15-candidate-legs.md): `at` a place, or
  `between` two. A route specialist that returns `at` has put its endpoints in
  its prose, which is the shape the fixtures had before pl-15 and the shape a
  model will produce again unless the prompt and the output schema both say
  otherwise. Travel time, a detour off a leg, and conditions along one corridor
  rather than another are all unbuildable without both ends — none of them is in
  this ticket, and all of them are foreclosed by getting this wrong here.
- **Cancel must kill the whole fan-out.** In-flight provider calls take the
  `AbortSignal` that `ModelRequest` already carries.

## Done when

- `rosterFor` is table-driven and tested per trip shape, including a shape where a
  specialist is deliberately absent.
- **Every candidate the route specialist returns is a `between`**, asserted per
  checked-in brief. The fixture side of this is already asserted in
  `contract/test/fixtures.test.ts`; this is the same rule held against the
  fan-out's own output.
- A run against the checked-in briefs produces candidates from every rostered
  specialist, streams per-specialist progress, and survives one specialist being
  made to fail — with the gap present in the output and no fabricated content.
- The budget path is tested: a roster that exceeds the cap is degraded before the
  fan-out and the drop is recorded.
- Nothing in this ticket packs a day or writes a schedule.
- **The candidates a specialist returns are placeable.** For each checked-in
  brief, `compose()` over the fan-out's output places at least one candidate from
  every rostered schedulable specialist, or the test says which one it dropped and
  why. This is the assertion that catches a specialist ignoring `driveAppetite`,
  and it is cheap because the composer is already pure.
- `npm run check` and `npm test -- --project planner` pass.

## Log

### 2026-08-16 — the library half is built; the run-as-a-job half is blocked on the contract

`@planner/agent` now does everything from the brief to the candidate set. What is
**not** built is the run as a persisted job with an SSE surface, and the reason is
below rather than in a commit message, because it is a decision somebody has to
make rather than work somebody has to do.

**Branched off pl-15 (PR #31), not off `main`.** `Candidate.location` is the
union pl-15 introduced and every route candidate here is `between` two places.

#### What landed

- **`roster.ts` — the roster as a table.** Nine rows, each naming a specialist, the
  shapes it has something to say about, a named condition and the sentence that
  put it there. `rosterFor(brief)` filters; it decides nothing. Every specialist
  that does **not** run comes back with the sentence that kept it out, and those
  become `specialist-not-applicable` gaps — the reassurance half of §7.
- **`budget.ts` — the cap, enforced before the fan-out.** `applyBudget` cuts from
  the back of `SPECIALIST_ORDER`, which is the judgement about what a plan loses
  least by losing; `rosterGaps` turns the cut into
  `specialist-dropped-for-budget`. A cap of zero is honoured rather than clamped.
- **`specialists.ts` — one shape for all seven**, plus `TripCapacity` and
  `CANDIDATE_LIMIT_OF`.
- **`prompt.ts` — the brief, and only the brief**, rendered with every unanswered
  slot shown as `not answered` and nothing defaulted.
- **`ask.ts` — one specialist call**, with the reply validated against
  `candidateSchema.omit({id, specialist})` and a bounded re-ask that feeds the
  parse failure back. `AGENT_REFUSED` is terminal, a `length` stop is re-asked
  with that said, and past the attempts it is `AGENT_MALFORMED_REPLY`.
- **`orchestrator.ts` — `runFanOut`.** Parallel, joined once, per-specialist
  progress, gaps for everyone who did not contribute, and cancellation that kills
  the whole thing.
- **`providers/scripted-fan-out.ts` — 48 checked-in candidates**, keyed by trip
  shape and specialist, so the whole fan-out runs offline with no key.

#### Decisions worth carrying

**`agent` does not import `@planner/itinerary`, and the ceilings are an
argument.** The brief is right that the numbers a specialist must respect are in
`itinerary/src/limits.ts`, and `01-ARCHITECTURE.md`'s dependency table says
`agent` depends on `contract`. Both are kept: `runFanOut` takes a **required**
`TripCapacity`, and a caller writes
`{ dayCount: tripSpan(dates).dayCount, ...dayCapacity(brief) }`. Required rather
than optional on purpose — a caller who forgets it writes the exact bug pl-9
found, and forgetting should be a compile error.

The one thing that had to be restated is which of the day's two budgets a
specialist's output is charged to, which is `itinerary`'s `BUCKET_OF` seen from
the proposing side. It is `CANDIDATE_LIMIT_OF`, and the drift is not left to
care: `placeable.test.ts` imports both tables and asserts they agree.
`@planner/itinerary` is therefore a **devDependency** of `agent`, used by two
test files and by no production file.

**The scripted provider answers by name.** Every specialist prompt opens with
`Trip shape: <shape>` and `Specialist: <id>`, which the model needs anyway — a
specialist that does not know which specialist it is answers as all of them — and
which `readMarkers` reads back. `ScriptedProvider` looks the pair up in
`SCRIPTED_FAN_OUT` and falls through to its plain reply list for anything else,
so the existing script behaviour is untouched. A pair with no entry gets an empty
list, never a plausible one.

**The turn counter is not advanced for a fan-out reply.** Specialists run
concurrently, so "the third reply" would depend on which of them the event loop
reached first, and a script that differs per run is not a script.

**Ids are derived, not generated.** `<runId>-<specialist>-<n>`, the same argument
the composer's day ids make: this package has no clock and no randomness, so the
same run composed twice produces the same plan.

**A cancellation is not a gap.** "Lodging was not checked because you stopped the
run" would leave a canceled draft looking like a completed one with holes, so the
per-specialist catch rethrows a cancellation instead of recording it.

#### What the brief got wrong, and what composing turned up

- **`depends_on` said `[pl-4]`.** It is `[pl-4, pl-15]` in practice and the
  front matter now says so — every route candidate here is `between` two places
  and none of this compiles against `Candidate.place`.
- **pl-4's resort fixture has a `route-and-logistics` candidate, and §4 says it
  should not exist.** "A resort week needs lodging, food and practicalities, and
  a route specialist would produce noise about airport transfers" is the
  analysis's own sentence, so the roster has no route row for `resort` — which
  means the fixture's 5-hour Ottawa→Cancún transfer is a candidate this fan-out
  would never propose. pl-9 separately found that the composer drops it. Two
  independent mechanisms agreeing that a candidate should not be there is a
  reason to believe the roster, not the fixture; the fixture is pl-4's realistic
  _candidate set_ rather than a claim about who ran, so it is left alone.
- **At the architecture's `MAX_SPECIALISTS` default of 5, the budget specialist
  is dropped on every six-specialist shape** — backcountry, motorised-touring and
  multi-city. That is the cap working as designed and it is recorded as a gap on
  each of those plans, but it is worth a content review: the default was chosen
  before there was a roster to apply it to, and "budget is always the one we
  cannot afford" is a sentence somebody should either accept or change the number
  over.
- **`empty-day` is common and it is honest.** Composing the scripted fan-out
  leaves five empty days of eight on the resort week and six of thirteen on the
  multi-city trip, because the script proposes a handful of good options rather
  than one per day. Soft findings, they ship, and they are a fair description of
  what a scripted provider knows.
- **A plan can still be `PLAN_INFEASIBLE` from the cost side and it very nearly
  was.** The resort script proposes two properties, the packer places each as its
  own day's anchor, and the party is charged for both — two low ends summed past
  the 7,000 CAD budget. The critic's first round drops the dearest and the plan
  ships, so nothing fails; but "propose two hotels for one week and be billed for
  both" is a real modelling gap between what a lodging specialist means and what
  the packer does with it. Not this ticket's to fix — it is a property of
  `BUCKET_OF`'s one-anchor-per-day rule — and it is written down here because the
  next person to see a doubled hotel bill should not have to rediscover it.

#### What is not built, and why it stopped here

Build steps 4 (the run as a job with SSE) and the `web` progress view are **not
done**. Both need `@planner/contract` to grow, and the preamble for this ticket
is explicit that the contract is not to be edited unilaterally — the repo's rule
and this ticket's instructions agree, so the work stopped at the seam rather than
crossing it.

Concretely, the remaining half needs four additions to the contract, none of
which changes anything that exists:

1. **`RunStatus` and its `TransitionTable`** — `queued → fanning-out → composing
→ reviewing → done | failed | canceled`, on `@webtools/core`'s machinery. It
   belongs in `contract` for the reason the downloader's job FSM does: `web`
   renders the state and `api` enforces it, and neither should own it.
2. **A `RunEvent` union and its zod schema** — the SSE frames. The
   per-specialist shape is already settled and tested as `FanOutProgress` in
   `@planner/agent`; the wire type is the same information plus a run id and a
   timestamp, and the agent's version should probably be dropped in favour of it
   rather than mapped between.
3. **`ROUTES.plans`, `ROUTES.plan`, `ROUTES.runEvents`** and their url helpers.
4. **A `Run` summary type** for `POST /api/plans`'s response.

The api-side work behind those is: migration 4 for a `plan_runs` table (migration
2 already has `plans`, `plan_candidates`, `plan_revisions`, `plan_days` and
`plan_items`, and its comments already anticipate pl-5 adding the run a candidate
came from), an in-process queue bounded by `MAX_CONCURRENT_RUNS`, the SSE route,
and `createModelProvider`'s existing seam passing `RUN_TOKEN_BUDGET` and
`MAX_SPECIALISTS` down as the `RunBudget` this package already takes. None of it
is large; all of it is downstream of the contract question.

It is [pl-16](./pl-16-the-plan-run.md), split out rather than left as a checklist
on a ticket whose other seven steps are done — the format doc's own advice.
**Which of the four the contract should carry is that ticket's first step and is
deliberately not answered there either**: it names the options and the argument
each way, which is as far as this work can honestly go.

The brief above is left as it was written rather than trimmed to match, the way
§3 and §7 are kept and overridden rather than rewritten. This ticket stays
`in-flight` until somebody who owns the roadmap decides whether it closes here,
with step 4 and the `web` half now pl-16's.

#### Green

`npm run check` passes. `npm test -- --project planner` is 420 tests across 31
files, 84 of them new here.
