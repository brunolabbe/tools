---
id: pl-30
tool: planner
title: Capture a real geocoder payload and hold locate's parser to it
kind: fix
milestone: P3
status: ready
depends_on: [pl-28]
---

# pl-30 — The half of pl-28 step 3 that could not be captured

> **On the id.** pl-29 was already taken by
> [detours along a leg](./pl-29-detours-along-a-leg.md); this is pl-30 and not
> pl-29, and the two are unrelated.

## Why

[pl-28](./pl-28-valhalla-adapter.md) step 3 asked for fixtures captured from a
real running Valhalla **and a real geocoder**, and said why in terms that leave
no room to negotiate: _a hand-written fixture for a routing engine is a fixture
that agrees with your parser by construction._ The same sentence is true of a
geocoder.

Half of it was done. `api/test/fixtures/valhalla-sources-to-targets.json` came
out of Valhalla 3.7.0's own matrix serialiser, and it settled the one thing
nobody could have guessed — an unroutable pair is a cell that is **present**
with `"time": null, "distance": null`, not an omission, not a zero and not an
error.

**The geocoder half was not, and nothing was written in its place.** Nominatim
wants PostgreSQL, PostGIS and an import of the same extract; the environment
pl-28 was built in had no PostgreSQL, no Docker, no route to geofabrik.de and
no route to the public instance either. Rather than hand-write a payload and
call it captured, `locate`'s reply parsing was written against Nominatim's
documented shape and **asserted by nothing**. Only its transport behaviour —
unreachable, slow, empty result, nothing to ask about — has a test.

So there is one function in this tool whose correctness rests on somebody's
memory of a JSON document: `firstCoordinates` in
`api/src/grounding/valhalla.ts`. That is exactly the position pl-28 step 3
exists to prevent, and it is worth a ticket rather than a paragraph.

## Build

1. **Stand up a geocoder and capture `/search`.** A machine with Docker and
   network is all it takes: the `mediagis/nominatim` image imports a `.pbf` and
   serves. A **city-sized** extract is plenty — this fixture is about the shape
   of one reply, not about coverage. `docs/02-DEPLOYMENT.md`'s grounding section
   is the procedure.

2. **Capture at least three replies**, because the interesting ones are not the
   hit:
   - a place that matches — the shape of a result, and whether `lat`/`lon` are
     the strings the documentation says they are;
   - a name that matches **nothing** — is it `[]`, or an object, or a 404? The
     adapter answers `null` for the first and would answer `UNREACHABLE` for the
     third, and those are different sentences on a plan;
   - a name that matches **more than one place** — "Saint-Jean" with no locality.
     `place-key.ts` names this as the ambiguity nothing in the tool can resolve
     today, and says a seam that could answer "more than one place matches" is
     where the fix would go. A captured payload is what makes that arguable
     rather than hypothetical.

3. **Hold the parser to them, offline**, beside the travel tests in
   `api/test/grounding-valhalla.test.ts`, and fix whatever the payload disagrees
   with. Expect it to disagree with something: it always does, and that is the
   whole reason for this ticket.

4. **Amend pl-28's Log rather than editing its brief**, in the shape pl-24's Log
   already uses for an amendment. The gap is recorded there and a reader who
   finds it must be able to find the answer.

## Done when

- A real Nominatim `/search` reply is checked in under `api/test/fixtures/`,
  with its provenance written where the fixture is read.
- `locate` parses it into `LocatedPlace` offline, with no network in any test.
- A no-match reply yields `null` — not an error, and asserted against whatever
  Nominatim actually returns rather than against `[]` assumed.
- pl-28's Log says the gap is closed and by what.

## Log
