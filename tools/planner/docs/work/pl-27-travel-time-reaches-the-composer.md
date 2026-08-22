---
id: pl-27
tool: planner
title: Measure the legs, pack under them, and stop naming travel time as unchecked
kind: work-package
milestone: P3
status: ready
depends_on: [pl-24]
---

# pl-27 — The gap Phase 2 promised to name, closed

**Packages:** `api` (the pass, the run wiring), `itinerary` (the packer takes a
travel table), `contract` (where a measured leg lives on the document).

## Why

This is the ticket §5's ranking exists to point at. **Distances and travel times
first** — it fixes §2's failure 1, the most common way an AI itinerary is wrong,
and it is the single largest thing grounding buys this tool.

It is also the answer to the question the roadmap has carried in _Still open_
since 2026-08-16: _whether Phase 2's composer can pack under travel time at
all._ The answer then was **no — pack without it and name the gap**, because
`Place.coordinates` was null and there was nothing to measure a leg with. Both
halves of that have now moved: [pl-15](./pl-15-candidate-legs.md) gave a
candidate two ends, and [pl-24](./pl-24-grounding-seam-and-fixtures.md) gives us
something that can measure between them. The gap was always meant to close here.

Read [`itinerary/src/unchecked.ts`](../../itinerary/src/unchecked.ts) before
starting. Its first entry is unconditional — _"How long it takes to get from one
of these to the next was not checked. Nothing here measured a distance."_ —
and making that sentence conditional is the visible half of this ticket.

## Build

1. **First, the contract decision: a measured leg is stored, not derived.**
   Settle it before writing anything, because `web` and `api` both read it.

   The recommendation is to **store** it — on the item or the revision, as a
   grounded fact with its `Provenance` — and it deliberately goes the other way
   from [pl-10](./pl-10-plan-view-and-provenance.md), which refused to store
   `UncheckedConstraint[]` and derived it from the revision instead. The two are
   different in the way that matters: `unchecked` is a _derivation_ from things
   the revision already holds, so deriving it cannot disagree with the days it
   is printed beside. A measured distance is _evidence_ — it came from outside,
   at a moment, from a source — and there is nothing on the revision to re-derive
   it from. Its cache row will expire; the plan must still be able to say what it
   was packed against and when that was read. A plan that silently re-measures on
   read is a plan whose days no longer follow from its numbers.

2. **The pass lives in `api`, between the fan-out and the composer.**
   `@planner/itinerary` has `no model, no network, no clock`, enforced by
   `itinerary/test/purity.test.ts` and not by good intentions, so the package
   that packs days must not be the package that fetches distances. The travel
   table arrives as an **argument** to `compose`, exactly as `TripCapacity`
   arrives as a required argument to `runFanOut` — and for the same reason: a
   caller that forgets it should be a compile error rather than a plan quietly
   packed under nothing.

3. **What the pass does**, in `api/src/runs/`:
   - Collect the distinct `Place`s across the run's candidates — both ends of
     every `between`, the one place of every `at`.
   - `locate` them, filling `Place.coordinates`, which has been nullable since
     pl-4 waiting for precisely this.
   - **One `travel` matrix over the located places** — one call, not n². This is
     why pl-24's seam is matrix-shaped; read its step 3.
   - Move the run through `grounding` and emit `{ done, total }` frames. Skip
     the state entirely when there is nothing to measure, per pl-24 step 1.

   **The counts change meaning when the status does** — specialists during the
   fan-out, lookups from `grounding` onward — and pl-24's review caught the UI
   still saying "N of M specialists done" underneath them. `progressLine` in
   `RunView.tsx` now switches its noun on the status, so the frames this pass
   emits are already rendered correctly; the trap is only worth knowing if you
   add a third thing that counts.

   Deduplicate the place list with the provider's own normalisation rather than
   a second one — `fixturePlaceKey` is exported for exactly this. Two spellings
   of one place sent as two rows is a wider matrix than the run needs to pay
   for, and a normaliser reimplemented at the call site is one that will drift.

4. **A place that will not locate is not a failure.** It has no coordinates, its
   legs have no measurement, and it is still a perfectly good candidate — the
   plan says travel time was unchecked _for those items_, and packs the rest
   under measured numbers. This is the `PlanGap` philosophy one level down: a
   partial answer that admits its edges beats both a thrown run and a filled-in
   guess. The fan-out's rule that one specialist failing does not fail the run is
   the precedent, and the same rule should govern the backend being down
   entirely: the plan is the Phase 2 plan, with the gap named, not an error page.

5. **The packer packs under it.** `itinerary/src/pack.ts` currently charges the
   day's drive budget for `route-and-logistics` candidates' own
   `durationMinutes`. It now also has to charge the transition between
   consecutive items. Watch the interaction with `CANDIDATE_LIMIT_OF` and
   `dayCapacity` — this is the arithmetic pl-9 got wrong once already, in the
   other direction, and `agent/test/limits-agree.test.ts` exists because those
   two tables drift.

6. **Three unchecked entries were caused by one missing distance, and all three
   have to be reconsidered — not just the famous one.** `travel-time`,
   `daily-distance` (a backcountry party's `maxDailyDistanceKm`) and
   `machine-range` (a machine's `rangeKm`) each say "same cause: ends without a
   distance between them" in that file. Leaving two of them unconditional while
   the first becomes conditional would leave text that is no longer true beside
   text that is, which is worse than either. Recommendation: do all three; the
   distance is in hand and each is one comparison.

   Each becomes conditional on **what was actually measured**, per candidate,
   not on whether a grounding provider was configured. A run against a backend
   that answered for four places out of nine says so about the five.

7. **Provenance on every item** (§5). A leg measured by a backend is `grounded`
   with the source that measured it; everything else stays `model-asserted`, and
   the plan view already renders the difference as of pl-10.

8. **Two documents state the old behaviour as a rule and both have to move.**
   `tools/planner/CLAUDE.md` says the unchecked list carries _"travel time
   always, because `Place.coordinates` is null until grounding"_, and
   `02-ROADMAP.md` carries the 2026-08-16 decision in _Still open_. Neither is
   describing a limitation any more once this lands. Amend rather than delete,
   the way §3 and §7's amendments are handled in this tool: the reasoning was
   right for Phase 2 and the record of why is worth keeping.

## Done when

- Composing a checked-in candidate set with a grounding provider that answers
  produces a plan whose days respect measured transition times, and one with a
  provider that answers `null` for everything produces **exactly today's plan** —
  byte-identical days. That second assertion is what proves the change is
  additive.
- `uncheckedFor` omits `travel-time` when every placed item's transitions were
  measured, includes it naming the specific candidates when only some were, and
  still includes it unconditionally when nothing was. Three tests.
- The same three cases for `daily-distance` and `machine-range`, or a written
  decision in the Log for why one of them stayed unconditional.
- A stored plan re-read after its cache row expires shows the same distances and
  the same `fetchedAt` — the storage decision from step 1, proven rather than
  asserted.
- A run whose grounding backend throws still writes a revision, and that plan
  names travel time as unchecked.
- `itinerary/test/purity.test.ts` still passes, which is the check that no
  network reached the packer.
- `npm run check` and `npm test -- --project planner` pass. Several existing
  `unchecked` tests change meaning here — that is expected, and each change
  belongs in the Log.

## Log
