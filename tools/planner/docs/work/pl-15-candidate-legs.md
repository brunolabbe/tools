---
id: pl-15
tool: planner
title: A candidate is at a place or runs between two
kind: work-package
status: done
milestone: P2
depends_on: [pl-4]
---

# pl-15 — A candidate is at a place or runs between two

**Packages:** `contract` (and the six checked-in candidate sets under it)

## Why

`Candidate` had a single `place`, so a drive leg's endpoints lived in its prose.
The road-trip fixture said **"Montréal to Rimouski via the 132"** in its title
and put `Route 132, Bas-Saint-Laurent` in the one `Place` it had. A human reads
the two towns; nothing else can.

Three things this tool intends to do all need both ends as structure:

- **Travel time** between consecutive items — §2's failure 1, and the first
  entry on `UNCHECKED_CONSTRAINTS`. A leg needs two endpoints before a distance
  between them means anything, and coordinates alone do not supply them: a leg
  with one point has nowhere to measure to.
- **A detour.** "Is a forty-minute diversion worth this attraction" is measured
  off a leg. With one point there is nothing to divert from. Note that this is
  **composer** work and not a specialist feature — `activities` proposes the
  attraction, `route-and-logistics` proposes the leg, and code decides whether
  the diversion fits the day. A route specialist that considered attractions
  would be reading another specialist's output, which is the rule this tool
  does not break.
- **Conditions along a route** — roadworks, a closure, weather on one corridor
  rather than another. Those are properties of a span, not of a dot, and the
  motorcycle case ("the weather is better on the other road") is unanswerable
  while a route is one point.

None of the three is built. All three are unbuildable while the endpoints are
prose, and every one of them would otherwise have needed this change **plus** a
re-run of every stored candidate. Doing it before [pl-5](./pl-5-orchestrator-and-fan-out.md)
writes the first route specialist is what makes it cost six fixtures instead.

Raised in conversation on 2026-08-16, before pl-5 started, and scoped there to
endpoints only — see _What this deliberately does not do_.

## Build

1. **`CandidateLocation`, a discriminated union** in `contract/src/candidate.ts`:
   `{ kind: "at"; place }` or `{ kind: "between"; from; to }`, with
   `candidateLocationSchema` beside it. `Candidate.place` becomes
   `Candidate.location`.
2. **`location.at()` and `location.between()`** as constructors, in the shape
   `slot` in `brief.ts` already uses — a namespace rather than two bare exports,
   because `at` and `between` are words too common to take from a barrel.
3. **The six checked-in candidate sets** move onto it. The six
   `route-and-logistics` candidates become `between`; everything else wraps as
   `at`.
4. **Tests** for the properties the union exists for, and a fixture-level
   assertion that every route candidate is a leg.

Traps worth knowing in advance:

- **A leg whose `from` equals its `to` is legal**, and rejecting it would make a
  scenic loop unrepresentable — the same mistake as ordering a `SeasonWindow`,
  which would make winter unrepresentable.
- **Which specialists may produce which kind is not enforced in the contract.**
  A `between` from `lodging` is nonsense, and it is still the packer's business:
  `BUCKET_OF` in `@planner/itinerary` decides what is done with a candidate, and
  the contract decides what is representable. Enforcing the pairing here would
  put the roster's semantics in the schema.
- **No migration.** `plan_candidates.candidate_json` is text and nothing writes
  it yet — only `api/test/schema.test.ts` inserts a row. The shape change is
  free precisely because pl-5 has not run.

## What this deliberately does not do

**A leg carries no distance.** `distanceKm` was considered and dropped on
2026-08-16: a model-stated distance would make `machine-range` and
`daily-distance` checkable in Phase 2, and there is precedent for trusting a
model-stated number (`durationMinutes` is one, and the packer charges days
against it). It was left out because the field would ship unused — the composer
work to consume it is a separate ticket — and because §5 puts distances first in
what grounding buys, which is where a distance with provenance comes from. The
two constraints stay on `UNCHECKED_CONSTRAINTS` until then.

**Nothing consumes the endpoints yet.** The composer does not read them, and
`travel-time` is still unchecked on every plan. This ticket makes the data
representable; Phase 3 makes it true.

## Done when

- `Candidate.location` is the union, and a leg with one end does not parse.
- All six checked-in sets are on it, every `route-and-logistics` candidate among
  them is a `between`, and a test asserts that rather than a reviewer.
- No coordinates were lost in the move.
- `npm run check` and `npm test -- --project planner` pass.

## Log

**2026-08-16 — done.** The union, the constructors, the six fixtures, and six
tests: four on the union in `candidate.test.ts`, two on the fixture set in
`fixtures.test.ts`. 336 planner tests pass, up from 330. `npm run check` green.

Four things the brief did not know:

- **`Candidate.place` had no consumers at all.** Not the packer, not the critic,
  not the API — only three test builders and the fixtures. The composer's
  `BUCKET_OF` keys off `specialist`, so a candidate's location was written and
  never read. That is what made a breaking union cheap rather than invasive, and
  it is also the more uncomfortable finding: the field had been carried since
  pl-4 without a single reader, so nothing would have caught it being wrong.
- **Four of the six route candidates already carried coordinates**, and the
  first pass at the migration wrote `null` over all four. Two of the endpoint
  choices were wrong for the same reason: for the backcountry traverse and the
  resort flight, the coordinate-bearing place _is_ one of the two ends (Mont
  Albert, and Cancún International Airport), not a corridor between them. Both
  were corrected and a check in the migration script now asserts no coordinate
  was lost. Worth stating plainly: **grounding data already exists in these
  fixtures**, so "coordinates are null until Phase 3" is true of what the tool
  produces and not of what it has been given.
- **`test/fixtures/` is in `.oxfmtrc.json`'s `ignorePatterns` and oxfmt formats
  these files anyway.** The pattern does not match at
  `tools/planner/contract/test/fixtures/` depth — it would need `**/`. So the
  compact style in the candidate sets is oxfmt's own output, not authored, and
  a fixture edit must be followed by `npm run format` or `format:check` fails.
  Nothing depends on the ignore working, so it is left as it is rather than
  fixed into a repo-wide reformat, but the next person to assume fixtures are
  hand-formatted will lose the same twenty minutes.
- **The endpoints came out of the fixtures rather than out of a map.** Every
  place name written into a leg was already in that candidate's title or summary
  or on a sibling candidate — the resort leg ends at the airport its title
  names, the backcountry traverse ends at the hut its lodging candidate is. The
  one candidate that resisted is the resort's, which bundles a flight and a
  transfer into one candidate and therefore has three points, not two; the leg
  is Ottawa → Cancún and the transfer stays in the summary. If that turns out to
  matter, the fix is two candidates, not three points.
