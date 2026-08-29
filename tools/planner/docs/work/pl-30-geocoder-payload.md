---
id: pl-30
tool: planner
title: Capture a real geocoder payload and hold locate's parser to it
kind: fix
milestone: P3
status: ready
depends_on: []
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

**How thin, exactly.** Its whole body can be replaced with `return null;` and
the planner suite stays green. None of its seven branches is pinned by anything,
and no test on that branch ever receives a non-null `LocatedPlace`.

**And the failure it hides looks like an honest answer, which is the hardest
kind to notice.** `runs/travel.ts` calls `locate` for every place a run's
candidates name, so with `GROUNDING_PROVIDER=valhalla` the first plan a
deployment builds executes this code. If Nominatim answers a shape it does not
expect, it returns `null`; every place stays uncoordinated; `pointsOf` drops all
of them; `travel` short-circuits before any request goes out. The operator then
has a service reporting `{"grounding":{"provider":"valhalla"}}` at `/api/health`
and producing plans that every single time carry a `travel-time` unchecked
constraint — which is precisely the sentence an honest plan says when a backend
genuinely could not measure something. Nothing distinguishes the two from
outside. That is the cost of this ticket staying open, and it is why it is a
`fix` rather than a `chore`.

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

**2026-08-29 — `depends_on` was circular; dropped `pl-28`.** pl-28's own Log
says it cannot go `done` until this ticket lands, while this ticket's
frontmatter waited on pl-28 — a cycle `npm run status` can't resolve, and it
was also handing pl-29 a blocker that could never clear. Before:

```
$ npm run status -- --show pl-30
  depends on  pl-28
  blocked by  pl-28 (ready)
$ npm run status -- --tool planner
  · pl-30  ... (waits on pl-28)
```

pl-28's code is already on `main`:

```
$ git log --oneline --all | grep pl-28
60e48e7 feat(planner): measure legs against a real routing engine, self-hosted (pl-28) (#74)
```

So the edge is satisfied in substance; only pl-28's own ticket bookkeeping
waits on this one. Set `depends_on: []`. After:

```
$ npm run status -- --show pl-30
  depends on  nothing
  unblocked
$ npm run status -- --tool planner
  • pl-30  Capture a real geocoder payload and hold locate's parser to it
```

pl-28's frontmatter stays `status: ready` — closing it is still gated on this
ticket producing a fixture, which did not happen (below).

**2026-08-29 — baseline reproduced before touching anything.** `firstCoordinates`
in `api/src/grounding/valhalla.ts` replaced with `return null;` (scratch script,
restore via `trap ... EXIT INT TERM` doing `cp` then `touch` then rebuild, so a
kill mid-mutation can't leave a stale mutated `dist` behind):

```
$ npm run build --workspace=@planner/api   # 0.385s
$ npm test -- --project planner
 Test Files  50 passed (50)
      Tests  702 passed (702)
```

702/702 — up from pl-28's Log's 698/698 by the 4 tests pl-31 added since,
unrelated to this file. Confirms the gap pl-30 exists to close is still open:
the harness cannot fail on this function. File restored and rebuilt by the
trap; diff against `git status` after was empty.

**2026-08-29 — Phase A: no capture, and not for the reason pl-28 hit.** Probed
connectivity per host (the sandbox refuses a chained/looped command as
"too complex to verify... stays inside the worktree", so one `curl` per host):

```
$ curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org
200
$ curl -s -o /dev/null -w "%{http_code}" https://nominatim.openstreetmap.org
(times out)
$ curl -s -o /dev/null -w "%{http_code}" https://photon.komoot.io
(times out)
$ curl -s -o /dev/null -w "%{http_code}" https://api.mapbox.com
(times out)
```

Confirms the brief: only npm and GitHub are reachable, no public or self-hosted
geocoder is.

Searched `registry.npmjs.org/-/v1/search?text=nominatim` (and a second pass on
`offline geocoding server`) for this ticket's equivalent of
`@valhallajs/valhallajs` — a package shipping a _runnable_ engine rather than a
client of the public API. Everything else in both result sets is a thin HTTP
wrapper around `nominatim.openstreetmap.org`. One is not:
`@mailwoman/nominatim` — `npx @mailwoman/nominatim serve` stands up a genuine
Nominatim-compatible `/search` over the "Mailwoman" engine
(`github.com/sister-software/mailwoman`, 2 stars, commits as of today — a real,
maintained project, not a placeholder). Its own repo shows the analogue of
pl-28's synthetic-`.pbf`-through-the-real-pipeline move:
`packages/resolver-wof-sqlite/test/integration/build-candidate.test.ts` builds a
tiny fixture gazetteer and runs it through the project's own production
`buildCandidateTable`, not a hand-written reply.

**Stopped there — deliberately, on a licensing finding this ticket's brief
never anticipated, not on feasibility.**

```
$ curl -s https://api.github.com/repos/sister-software/mailwoman/license
"license": {"spdx_id": "NOASSERTION", ...}   # LICENSE.md: AGPL-3.0-only OR LicenseRef-Commercial
```

This repo's own `LICENSE` is MIT, and the root `CLAUDE.md` documents `repo-1`
preparing this repo for public release. Generating a fixture by running an
AGPL/commercial dual-licensed engine, then checking that output into an MIT
tree headed for the public, is a different question from the laundering pl-28's
builder rejected — nothing here would be hand-written or lifted from a test
suite, the payload would be genuinely produced by real code — but whether an
AGPL tool's _output_, embedded in an otherwise-MIT repo, carries any of that
license's obligations forward is a real, unsettled question and not mine to
resolve unilaterally mid-ticket. So the capture was not attempted.

**What a networked, licensing-cleared machine would need**, either path: (a)
the brief's own — `mediagis/nominatim` over Docker against a small `.pbf`, per
`docs/02-DEPLOYMENT.md`'s grounding section, needing Docker and a route to
`download.geofabrik.de` (or an extract already on disk); or (b) `npx
@mailwoman/nominatim serve` against a hand-built tiny WOF SQLite admin table run
through `@mailwoman/resolver-wof-sqlite`'s own `buildCandidateTable`, once
someone with standing over this repo's licensing has cleared it — the
engineering shape is a near-direct copy of pl-28's Valhalla capture and would
not be the long pole.

Both tickets stay open. `firstCoordinates` and
`api/test/grounding-valhalla.test.ts` are unchanged on this branch.
