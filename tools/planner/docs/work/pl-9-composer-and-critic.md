---
id: pl-9
tool: planner
title: The composer and the critic — the itinerary package
kind: work-package
status: ready
milestone: P2
depends_on: [pl-4]
---

# pl-9 — The composer and the critic

**Packages:** a new `tools/planner/itinerary`, scoped `@planner/itinerary`

## Why

This is the ticket that makes [00-ANALYSIS.md §2](../00-ANALYSIS.md) true rather
than aspirational: **models generate candidates; code schedules and checks.**
Drive times, day packing, budget sums, opening-hour conflicts and season windows
are arithmetic and constraint satisfaction, and asking a model to do them is
asking it to be bad at something a computer is perfect at. §2 is blunt that this
is the most common way an AI itinerary embarrasses itself.

It is the third piece of Phase 2 and the only one with no ticket until now.
[pl-4](./pl-4-plan-document-contract.md) fixed its input (`Candidate`), its
output (`PlanDay`, `PlanItem`) and how it is allowed to fail (`PlanGap` for a
plan with holes, `PLAN_INFEASIBLE` for no plan at all), which is what makes it
specifiable.

**It does not depend on [pl-5](./pl-5-orchestrator-and-fan-out.md).** pl-4
checked in a candidate set per trip shape, so this package can be built and
tested against real candidates with no fan-out, no model and no run. The two
tickets can run in parallel, and this one should not wait.

## Build

1. **The package.** `tools/planner/itinerary`, scoped `@planner/itinerary`, per
   the root `CLAUDE.md`'s "adding a tool" steps 2–3 applied to a package: its own
   `tsconfig.json` referencing `contract`, a project in the root `tsconfig.json`,
   a vitest project in `vitest.config.ts`, and one `references` line in
   `tsconfig.tests.json`. **No model, no network, no clock** — the same purity
   rule `intake` carries, for a different reason: everything here must be exact.
2. **The season filter, before anything else.** A candidate outside its own
   season window for the trip's dates never reaches packing (§7). Two traps, both
   from pl-4: a `SeasonWindow` may **wrap the new year** (`12-01` to `04-15` is a
   ski season, not a bug), and `season: null` means **not established**, not "all
   year" — an unknown window is passed through and left to the critic, never
   silently treated as open.
3. **The day packer.** Candidates in, `PlanDay[]` out, under the constraints the
   brief and the candidates actually carry: the party's effort appetite, item
   durations, the budget, and per-shape limits like a road trip's
   `maxDailyDriveHours`. Days are dense from index 0, and **`PlanDay.date` is
   null when the brief's dates are a window or open** — the packer must work off
   `dayIndex` and treat the calendar as an annotation.
4. **Respect pins.** A re-plan may not move a pinned item; it packs around it
   (§6). `pinnedCandidateIds` from the contract is the input, and this is the
   whole reason `pinned` lives on the item.
5. **The constraint check, in code.** Deal-breakers from the brief, budget sums
   over cost bands, booking lead times against the days until departure. A plan
   that violates a hard constraint **is not shipped** — that is a promise about
   what the tool checked, and it is what `PLAN_INFEASIBLE` reports when nothing
   can satisfy it. Distinguish it carefully from a plan with gaps, which ships.
6. **The critic.** An adversarial feasibility pass over the packed result whose
   findings go back to the packer, in **bounded rounds** (`MAX_CRITIC_ROUNDS`,
   default 2) — then ship with whatever it could not fix named as a `PlanGap`.
   Unbounded, the critic and the packer argue on the clock.
7. **Budget arithmetic over bands, not points.** A `CostEstimate` is a `low`/`high`
   band with a `basis` of `per-person` or `per-party`; summing a trip means
   summing bands and multiplying the per-person ones by the party size. The result
   is a band, and it must never be presented as a figure.

Traps worth knowing in advance:

- **Travel time is not available in Phase 2, and this ticket must not pretend
  otherwise.** `Place.coordinates` is `null` until grounding lands, so the packer
  cannot compute a leg. See the roadmap's _Still open_ entry — the decision on how
  Phase 2 handles it is a prerequisite for step 3, not something to improvise
  here. Whatever is decided, the honest form is a named gap, never an invented
  duration.
- **Never fake a section.** A day the packer could not fill is a `PlanGap`, not a
  plausible-looking filler item.
- **The composer reads the brief and the candidates, and nothing else.** Not the
  answers, not the tree, not a specialist's prompt.

## Done when

- `@planner/itinerary` exists, is in the root `tsconfig.json`, `vitest.config.ts`
  and `tsconfig.tests.json`, and imports nothing from `agent`.
- Packing runs against **each** of pl-4's six checked-in candidate sets and
  produces days that satisfy their own constraints, asserted per shape.
- A test proves a pinned item is not moved by a re-pack.
- A test proves an out-of-season candidate never reaches packing, **including the
  year-wrapping case**, and that a `null` season is not treated as all-year.
- A constraint set nothing can satisfy raises `PLAN_INFEASIBLE`, and is
  distinguishable in test from a plan that ships with a `PlanGap`.
- The critic terminates in bounded rounds on a case it cannot fix, and names the
  gap rather than looping.
- No model, no network and no clock anywhere in the package.
- `npm run check` and `npm test -- --project planner` pass.

## Log

_Not started._
