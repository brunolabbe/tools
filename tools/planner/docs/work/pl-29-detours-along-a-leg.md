---
id: pl-29
tool: planner
title: Find what is worth stopping for along a leg
kind: work-package
milestone: P3
status: ready
depends_on: [pl-24, pl-27, pl-28]
---

# pl-29 — The waterfall six kilometres off the 132

**Packages:** `contract` (the run states, and one taxonomy decision), `agent`
(the seam's discovery method, and what a specialist is given), `api` (the
adapter, the pass, the fixtures).

## Why

[00-ANALYSIS.md §5's amendment of 2026-08-22](../00-ANALYSIS.md) — **grounding
may propose and not only check.** Read it before this; the argument is there and
is not repeated here.

The short version: §2's five failures are all ways a proposed thing is wrong, and
none of them is the good thing never being proposed. A model asked for stops
between Montréal and Percé returns the famous ones. Nothing in the tool as built
would ever surface the one the locals would name, and that omission is what a
traveller actually notices — §1's whole premise is that the user cannot state up
front what they want, because what they wanted was the thing they had not heard
of.

## Read first: this changes when grounding runs

pl-27 puts grounding in a pass **after** the fan-out, because a distance is the
composer's input and nothing earlier needs it. Discovery is the opposite: the
finds are input to a **specialist**, which has to read them before it can propose
anything. So this ticket adds a second pass, before the fan-out.

```
queued ─► grounding ─► fanning-out ─► grounding ─► composing ─► done
          discover                    measure
```

Two passes, one state, entered twice — the state means "we are looking things
up", which is honest both times, and two names for one activity would be a
distinction the UI has to explain. It needs `queued → grounding` and
`grounding → fanning-out` added to `RUN_TRANSITIONS` beside pl-24's edges, and
every skip edge stays legal for the same reason pl-24 gives.

**The corridor does not need the route specialist to have run.** That looked
circular and is not: origin, destination and any waypoints are in the brief, so
the routing backend can draw the line from the brief alone. Do not wait for
`route-and-logistics` — that is the circular version, and it would also mean the
specialist that proposes legs never gets to see what is beside them.

## Build

1. **The seam gains discovery, and it returns finds — not `Candidate`s.**
   `nearby(corridor, radiusMetres, kinds)` over pl-24's `GroundingProvider`. What
   comes back is what a database knows: a name, a location, its tags, and its
   sources. It is emphatically not a `Candidate`, which has an author, a prose
   summary and a cost band — those are judgements, and §4's rule that **a
   specialist proposes** is what says who makes them.

   So the chain is: **data proposes to the specialist, the specialist proposes to
   the composer.** Discovery is not a new specialist and does not go on the
   roster; it is material handed to `activities`, `food` and
   `conditions-and-gear` in their prompts. §4's "a specialist that has nothing to
   say should not have been run" is undisturbed.

2. **The adapter, over the same extract pl-28 already builds from.** Overpass is
   the recommendation: it self-hosts, its `around:` filter takes a polyline
   directly, and a regional instance is a few gigabytes rather than the hundred
   a planet instance needs. The alternative is `osm2pgsql` into PostGIS and
   `ST_DWithin` against the route line — faster and more joinable, at the cost of
   running Postgres. Pick one, and write the rejected one's reasoning into the
   log.

3. **Notability is a separate signal, and it is the honest half of "worth".** OSM
   says a viewpoint exists; it does not say anyone should go. Free signals worth
   attaching to a find, each as its own `Source`: a **Wikipedia** article nearby
   (their geosearch API is free and unkeyed), that article's pageviews, and
   **Wikivoyage**, which is actual editorial travel writing under a CC licence
   with downloadable dumps. Attach them; do not fuse them into a score in this
   ticket. A single number would be arithmetic pretending to be taste, and the
   ranking belongs to the specialist that reads them.

4. **Filter geometrically, then route.** Distance from the point to the route
   polyline is free and rules out almost everything. Only the survivors get a
   real detour cost — route origin→P→destination against pl-28's backend and
   subtract the baseline — and that count is what `MAX_GROUNDING_CALLS` bounds.
   Measuring the detour to two hundred POIs is the version of this that gets
   switched off in production.

5. **One taxonomy decision, and do not jam it into the nearest existing type.**
   A corridor with almost no data in it produces a plan that looks exactly like
   one through the Loire, and the difference is invisible — which is
   `unchecked.ts`'s own argument for existing. But a `PlanGap` names a
   specialist that did not contribute, and every specialist here worked fine.

   Recommendation: a new `UncheckedConstraintKind` — coverage, named for what was
   thin. The test the root `CLAUDE.md` gives for a wrong code is whether the copy
   has to be re-worded where it is raised, and both existing types fail it here.
   It is still a contract change to an enum four packages read, so propose it and
   say so rather than adding it quietly.

6. **`Provenance` gains nothing, and that is the recommendation.** A POI from a
   database _was_ read somewhere, so `grounded` is true of it, and a third member
   for "exists but unjudged" would put a distinction in the type that belongs in
   the copy. What has to change is what the plan view _says_: "verified" must not
   read as "recommended" once some verified lines are database rows nobody
   vouched for. Fix the sentence, not the union — and if that turns out to be
   impossible to word, come back and argue for the member with the failed wording
   as the evidence.

7. **OSM tags are hostile text.** A `name` is a string a stranger typed, and it
   goes into a specialist's prompt. §5's last bullet already covers this and a
   database feels safer than a web page, which is exactly the reason to write the
   test: a fixture whose `name` tag contains an instruction, asserted to reach the
   plan as inert text or not at all.

8. **Nothing here books anything or vouches for safety.** A discovered
   backcountry viewpoint is a place on a map, not a route anyone has cleared. The
   permanent boundaries in §8 apply unchanged, and discovery makes the second one
   easier to violate by accident.

## Done when

- A corridor query against a checked-in Overpass payload returns the finds inside
  the radius and none outside it, offline.
- A find carrying a Wikipedia article is distinguishable on the plan from one
  that is only an OSM node, and both are distinguishable from a model-asserted
  candidate.
- The detour cost is measured only for finds that survive the geometric filter,
  and the number of routing calls is asserted — not the timing.
- A corridor with no finds produces the plan pl-27 would have produced, plus the
  coverage note. Byte-identical days.
- An OSM `name` containing an injection string reaches the plan as text or is
  refused by `candidateSchema`; it never reaches a prompt as an instruction.
- `queued → grounding → fanning-out → grounding → composing` is legal, each skip
  edge is legal, and a run that discovers nothing never enters the state.
- `itinerary/test/purity.test.ts` passes — no part of this reached the packer.
- `npm run check` and `npm test -- --project planner` pass. The image gate and
  the e2e suite do not run locally; say so rather than reporting green.

## Log
