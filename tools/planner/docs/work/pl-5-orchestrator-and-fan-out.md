---
id: pl-5
tool: planner
title: The orchestrator and the specialist fan-out
kind: work-package
status: ready
milestone: P2
depends_on: [pl-4]
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
- **Cancel must kill the whole fan-out.** In-flight provider calls take the
  `AbortSignal` that `ModelRequest` already carries.

## Done when

- `rosterFor` is table-driven and tested per trip shape, including a shape where a
  specialist is deliberately absent.
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

_Not started._
