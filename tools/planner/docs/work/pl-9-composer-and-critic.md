---
id: pl-9
tool: planner
title: The composer and the critic — the itinerary package
kind: work-package
status: done
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

**2026-08-16 — built.** `@planner/itinerary` exists: `dates`, `season`, `cost`,
`limits`, `pack`, `critic`, `compose`, `unchecked`. 112 tests over six files,
`npm run check` green, `npm test -- --project planner` at 330. Registered in the
root `tsconfig.json` and `tsconfig.tests.json`; **`vitest.config.ts` needed no
change** — the planner project already globs `tools/planner/*/test/**`, so the
"add a vitest project" step in the brief was a step that does not exist for a
package inside an existing tool. Worth knowing before the next one.

**Travel time was decided first, and it had to be.** The brief called it a
prerequisite for step 3 rather than something to improvise, and it was: the
roadmap's three options lead to three different packers. Decided **pack without
it and name the gap** — option one. The consequences landed as
`UNCHECKED_CONSTRAINTS`, and P2's milestone wording changed with it (roadmap).

**`PlanGap` could not carry it, and this is the one contract friction found.**
Every `PlanGapReason` is about a _specialist_ — failed, dropped, not applicable,
found nothing. "We could not check travel time" is not a statement about a
specialist at all: route-and-logistics ran perfectly and returned good
candidates, and what is missing is a distance nobody has.
`specialist-not-applicable` would put a false sentence in front of a user about
a specialist that worked. So the unchecked list lives on `ComposeResult` and
**does not survive a reload** — pl-10 renders it from the compose call, and a
plan read back out of the database has lost it. If it should persist,
`PlanGapReason` needs a member that is about a constraint rather than about a
specialist. That is a contract change and it is deliberately not made here.

**What the brief had wrong or left open, in the order it bit:**

- **Deal-breakers cannot be checked in code, and §7 says they can.**
  `dealBreakers` is `Slot<string[]>` of free text — "no more than one night in
  any campground without showers". No arithmetic decides whether a candidate
  violates that, and a keyword match would fail both ways while _looking_ like a
  check, which is worse than none. It is stated as unchecked and the specialists
  that read the brief carry it. Making it real means a structured constraint the
  composer can evaluate, not a cleverer string search. §7's row is aspirational
  as written.
- **`pinnedCandidateIds` is not enough to honour a pin.** The contract's helper
  returns ids, and "may not move" needs the placement — so the composer takes
  the whole previous `PlanRevision` and derives day and position itself
  (`pinnedPlacements`, exported here rather than added to the contract). The
  guarantee is exact about what it can promise: **a pin fixes the day and the
  order among pins**, not an absolute position, because `PlanItem.position` must
  be dense and a day may end up shorter than the index the pin was at.
- **Pins outrank both the fit checks and the season filter**, deliberately. A
  silently deleted pin is the worst possible answer to a pin, so a pin that makes
  a day impossible produces an over-full day for the critic to find — which is
  what actually gives the critic something to do, since the packer never
  over-fills a day on its own.
- **A day count can exceed `MAX_PLAN_DAYS`.** 60 nights is 61 days and the
  contract caps a plan at 60, so the longest trips this tool accepts lose their
  last day. Reported as `trip-truncated` rather than clamped in silence.
- **`possibleMonthDays` needs a leap year, not the real one.** A window spanning
  a year starting in a common year yields 365 distinct `MM-DD`s and would rule
  out anything whose season is `02-29`. It is answered from 2000's calendar.

**A finding for [pl-5](./pl-5-orchestrator-and-fan-out.md), from the fixtures.**
Composing all six checked-in sets, the route candidates are routinely over the
day's drive budget and get dropped — the road-trip fixture proposes a 5½-hour
leg to a party that answered `half-day`, and the resort fixture a 5-hour
transfer. The composer is right to refuse them and names the gap, but the result
is a road trip with no drives in it. **The route specialist must respect
`driveAppetite` when it proposes a leg**, or every leg it writes will be thrown
away downstream. It reads the brief, so it has the answer; nothing yet makes it
use it. Same for `pace` and `effort`.

**What is deliberately not in here.** No travel time, no opening hours, no
distance — all three are grounding and all three are named on every plan rather
than approximated. No `startsAt` on any item: a wall-clock start is a claim that
something outside the plan fixes it, and without opening hours nothing could.
No currency conversion, ever — a rate is a fact with an age, which makes it
grounding.

#### Amended 2026-08-16 by pl-15

**A leg now has both its ends, and nothing here changes.** This log argues that
travel time, `daily-distance` and `machine-range` are unchecked because
`Place.coordinates` is null and so there is no leg to compute.
[pl-15](./pl-15-candidate-legs.md) made a candidate either `at` a place or
`between` two, so the second half of that premise is gone: a drive carries its
origin and its destination as structure. What is still missing is a **distance
along** one, which is grounding and is Phase 3.

The conclusion is untouched — all three stay on `UNCHECKED_CONSTRAINTS`, the
composer reads no endpoints, and the tests that assert `travel-time` on every
trip shape are unchanged. Recorded because the reason is now narrower than the
sentence that carried it, and a right conclusion resting on a dead premise is
what rots first. The wording in `unchecked.ts` and `compose.ts` moved with it.
