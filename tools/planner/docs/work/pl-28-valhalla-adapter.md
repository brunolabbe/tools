---
id: pl-28
tool: planner
title: A real routing backend behind the seam, self-hosted
kind: work-package
milestone: P3
status: ready
depends_on: [pl-24, pl-25]
---

# pl-28 — Valhalla behind the seam

**Packages:** `api` (the adapter, the config), plus `docs/02-DEPLOYMENT.md` and
the compose file.

## Why

A fixture provider proves the seam. It does not prove the tool: every distance
in it was written by hand, and a plan built on it is still a claim about
machinery. P3's milestone is _the plan is true_, and this is the ticket that
makes any of it true.

**The backend is Valhalla, self-hosted, decided 2026-08-22.** The record of the
argument, because a cheaper-looking answer will be proposed again:

- **The target is a mini-PC** (Intel N-150, four E-cores, officially capped at
  16 GB DDR5), which is the whole constraint. Valhalla's graph is tiled and
  mmap'd, so resident memory tracks the tiles actually touched rather than the
  size of the extract, and a Québec-or-larger region is untroubled on that
  ceiling. OSRM was the alternative and is fine at runtime — its pinch is
  contraction, which wants several times the `.pbf` in RAM and would mean
  building the graph on another machine and copying artifacts over. A pipeline
  with a second machine in it is a pipeline nobody re-runs.
- **No per-call bill and no metered terms.** Google's Routes API is the most
  accurate option and its terms restrict retaining route data, which collides
  head-on with §5's cache: a distance is good for a year and
  [pl-25](./pl-25-grounding-cache.md) stores it for one. Choosing a metered
  vendor would mean re-deciding the TTL policy, so the cache design is itself an
  argument for self-hosting.
- **Load is trivial and is not the criterion.** `MAX_GROUNDING_CALLS` is 40 per
  run over matrices of a few dozen places, behind a cache. Neither engine would
  notice. The choice is an ops choice, and it was made on ops.

## Read first: this is two services, not one

**Valhalla does not geocode.** It routes. `locate` — a place name in,
coordinates out — is a geocoder's job, and pl-24's seam has both methods, so a
"Valhalla provider" that implements only `travel` leaves half the seam
unimplemented and pl-27's pass with nothing to fill `Place.coordinates` from.

Settle this before writing the adapter. The options, with the recommendation
first:

1. **Nominatim on the same regional extract**, alongside Valhalla. Same data,
   same box, one more container, and the volume behind pl-25's cache is nothing.
2. **The public Nominatim**, whose usage policy is roughly one request a second
   with a real `User-Agent` and caching expected — which the cache already
   satisfies. Cheaper to stand up, and it makes the tool depend on somebody
   else's free service.
3. **Photon or Pelias.** Better at fuzzy names, heavier to run.

Whichever it is, it is a **second implementation behind the same seam**, not a
second seam, and `createGroundingProvider` stays the only file naming either.

## Build

1. **`api/src/grounding/valhalla.ts`** — `travel` over `/sources_to_targets`,
   which answers the whole matrix in one request and is why pl-24's seam is
   matrix-shaped. `locate` over whichever geocoder the section above picks.
2. **Config** — `GROUNDING_PROVIDER=valhalla`, plus the endpoint URLs. Endpoints
   are operator configuration with no default: a routing URL that quietly
   defaults to somebody's public instance is a surprise bill or a surprise
   outage, and there is no sensible localhost guess either.
3. **Fixtures from real payloads.** Capture actual `/sources_to_targets` and
   geocoder responses against the running instance, check them in under
   `api/test/fixtures/`, and parse them offline. The repo rule is not
   negotiable here and the reason is sharper than usual: a hand-written fixture
   for a routing engine is a fixture that agrees with your parser by
   construction.
4. **Index anything keyed by a model-produced string with a `Map`, and hand
   back copies, not internals.** Both are pl-24 review findings and both are
   about a lookup table, which this adapter will have more of than the fixture
   did — a place-id cache, a response index, whatever `/sources_to_targets` gets
   keyed by. A plain object answers for `constructor`, `__proto__` and
   `toString`; and `Object.freeze` is shallow, so returning a table's own entry
   lets a caller that adjusts coordinates in place corrupt it for the rest of
   the process. pl-24's log has the worked example of each.
5. **Failure maps to core codes, and never to a thrown run.** Unreachable is
   `UNREACHABLE`, a slow instance is `TIMEOUT`, both from `@webtools/core`, both
   already retryable there. An unroutable pair — an island, a seasonal road
   closed in the direction asked — is a **`null` cell, not an error**: the
   backend answered, and the answer is that there is no route. pl-27 step 4 is
   what happens next, and it is a plan with a named gap rather than a failure.
6. **A timeout on every request**, and it is short. A run holds a queue slot
   while it grounds, `MAX_CONCURRENT_RUNS` is 2, and an instance rebuilding its
   tiles will hang rather than refuse.
7. **This endpoint does not go through the SSRF guard**, and
   [pl-26](./pl-26-lift-the-ssrf-guard.md) explains why at length: it is an
   address this deployment wrote down, not one a stranger handed us. Do not
   reach for `allowPrivateAddresses` to make a guarded fetch work against a LAN
   address — that switch disables the check for everything.
8. **Ops, written down where an operator will find it** — `docs/02-DEPLOYMENT.md`
   and `compose.prod.yaml`: which extract, how tiles are built and how long it
   takes, roughly what the tiles cost on disk, and what re-running the build for
   fresher OSM data involves. This is the half of a self-hosted decision that
   gets skipped and then has to be rediscovered a year later by whoever notices
   the roads are out of date.
9. **`/api/health` names the provider and never the endpoint.** pl-24 step 7
   already says so; it matters more here, because now there is something behind
   it worth not advertising.

## Done when

- The adapter parses checked-in real payloads into the seam's types, offline,
  with no network call in any test.
- An unroutable pair yields a `null` cell; an unreachable instance yields
  `UNREACHABLE`; a slow one yields `TIMEOUT`. Three tests, none of them touching
  a socket.
- `GROUNDING_PROVIDER=valhalla` with no endpoint configured fails at boot with a
  clear message rather than starting and failing on the first run.
- `/api/health` reports the provider name and no endpoint — asserted on the
  response body, not by reading the code.
- A logged config object contains no endpoint credentials, asserted the way
  `logging.test.ts` already does for the downloader.
- The deployment document tells someone who has never seen Valhalla how to get
  from a `.osm.pbf` to a running instance, and pl-2's compose service names it.
- `npm run check` and `npm test -- --project planner` pass. The image gate in
  `.github/workflows/planner.yml` is what proves the container still boots, and
  it does not run locally — say so rather than reporting green.

## Log

**2026-08-23 — built, with one disclosed hole.** Steps 1–9 are implemented. Step
3 is **half** captured, which is why this ticket is not `done`: the routing
payload is real and the geocoder payload could not be obtained at all. Details
below, and the remainder is [pl-30](./pl-30-geocoder-payload.md).

### The geocoder is Nominatim, on the same extract

Option 1, as recommended. It is a second implementation behind the same seam:
`createGroundingProvider` in `api/src/server.ts` still has one `switch` and one
case per backend, and `valhalla` is one case however many services sit behind
it. `/api/health` reports one name.

### The fixture, and exactly what is real about it

**There is no Docker in this environment, no route to geofabrik.de, and no
route to any public Valhalla or Nominatim.** Only the npm registry is
reachable. So the ticket's procedure — download a regional extract, build tiles,
capture — could not be run as written.

What was done instead, and it is worth reading before anyone treats the fixture
as second-best:

1. `@valhallajs/valhallajs@3.7.0` — the Valhalla project's **own** Node package,
   which ships prebuilt `valhalla_build_config`, `valhalla_build_tiles` and the
   engine itself — installs from npm.
2. A tiny `.osm.pbf` was written by hand with `protobufjs`: five nodes in a
   square loop with a spur, plus a two-node fragment deliberately **not**
   connected to it, all at Null Island so nobody reads the numbers as a real
   road. Writing OSM PBF by hand is a `BlobHeader`/`Blob` envelope around a
   `PrimitiveBlock` with dense nodes; the one trap is that `protobufjs`
   camel-cases snake_case field names, and a `zlib_data` that silently does not
   encode produces a 32-byte file and no error.
3. `valhalla_build_tiles` built a real graph from it — the same sixteen-stage
   pipeline a regional extract goes through, finishing in `validate` and
   `cleanup`.
4. The matrix was taken through the actor's raw string path, which is
   `/sources_to_targets`'s own handler and its own serialiser.

**So the geometry is invented and the payload is not.** The four things a parser
can get wrong here — field names, nesting, units, and the shape of an answer
with no route — are all Valhalla's, and a capture over a real Québec extract
would settle exactly the same four. The one that mattered:

```
{"from_index":0,"to_index":2,"time":null,"distance":null}
```

An unroutable pair is a cell that is **present**, with both numbers `null`. Not
omitted, not zero, not an error, not a shorter row. Four plausible guesses, one
answer, and it is the case pl-28 step 5 and pl-27's whole gap vocabulary turn
on. Also settled: `time` is **seconds**, `distance` is in whatever `units` the
request asked for — so the adapter states `units: "kilometers"` rather than
trusting a default — and every cell carries its own `from_index`/`to_index`.

`oxfmt` indents the fixture, and **`test/fixtures/` in `.oxfmtrc.json`'s
`ignorePatterns` does not actually exempt it** — worth knowing, and left alone
rather than fixed here, because widening that pattern is a toolchain change with
no ticket. Every key, value and numeric literal survived, `0.0` and `null`
included; only whitespace moved.

### The geocoder payload is missing, and nothing was written in its place

Nominatim needs PostgreSQL, PostGIS and an import — none available, and neither
is the public instance. Searching npm for a package shipping a _recorded_
Nominatim reply turned up nothing whose provenance could be trusted, and
laundering someone else's hand-written payload through their tarball would fail
this ticket's own standard rather than meet it.

So `firstCoordinates` is written against Nominatim's documented shape and
**asserted by nothing**. `locate`'s tests cover only what needs no invented
payload: the _question_ it asks (name and locality together — dropping locality
is how Saint-Jean in Québec becomes Saint-Jean in New Brunswick), an unreachable
geocoder, a slow one, and a blank place that is answered without a request.
[pl-30](./pl-30-geocoder-payload.md) carries the rest. **Do not mark this ticket
done until that lands.**

### Where the brief was wrong or out of date

- **`docs/02-DEPLOYMENT.md` is repo-wide, at the root**, not
  `tools/planner/docs/02-DEPLOYMENT.md`, which does not exist and would collide
  with `02-ROADMAP.md` if it did. The grounding section went into the root one.
- **"pl-2's compose service names it" cannot be satisfied, because that service
  does not exist.** pl-2 steps 5 and 6 were deliberately not bundled on
  2026-08-14 and are still open. What landed instead is `compose.planner.yaml` —
  the routing engine, the geocoder and the tile-build profile — with the three
  settings the `planner` service will need written at the bottom of it, so pl-2
  is a paste rather than a derivation. This is the shape
  [adr/004](../../../../docs/adr/004-one-compose-fragment-per-tool.md) decided,
  and it is additive: the repo-wide rename that ADR also decided is a `repo-`
  ticket and is **not** started here, so nothing that works today stops working.
- **The brief predates adr/004**, which was written the day after it and which
  reallocates part of step 8: the compose split is repo-wide work, pl-2 owns the
  planner service, and "pl-28 step 8 still owns the tile ops that an operator
  will need" is the sentence this ticket was held to.
- **No new error code was needed, and none was invented.** A boot
  misconfiguration is `AppError("INTERNAL", "<clear operator message>")`, which
  is precisely what the downloader's `PROXY_URL` already does in its own
  `config.ts`. Reaching for `AGENT_UNCONFIGURED` would have meant rewording it
  at the call site, which the root `CLAUDE.md` names as the tell that a code is
  the wrong one. `@planner/contract` is untouched.

### Decisions the brief left open

**`Source.url` is `https://www.openstreetmap.org/copyright`, never the
endpoint.** A source is stored on the plan and rendered to the user as a link
they read as "we checked this". A private routing URL there is a dead link that
publishes the deployment's topology into the plan document — `/api/health`'s
rule, one layer along — and the thing actually behind the number is OSM's data,
whose licence requires that attribution be shown anyway. So the honest citation
and the safe one are the same string.

**A place with no coordinates is not sent.** Valhalla routes between points and
has nothing to snap a bare name onto, so such a place is left out of the request
and its row and column come back `null`. In practice pl-27's pass locates
everything it can first, so this is residue rather than the norm — but a place
that would not locate must not become a guessed point.

**Boot refuses before the database is opened.** `createGroundingProvider` now
runs ahead of `mkdirSync`/`new Database`, so a misconfigured endpoint does not
leave a storage directory and a database file behind for a service that was
never going to start.

**`indexCells` keys the reply in a `Map`, built from validated integers** — step
4, and pl-24's review before it. The reply is not a model's, but it is not ours
either, and `from_index` reaches an array subscript where the string
`"constructor"` would find `Array.prototype.constructor` rather than nothing. It
is also keyed by the reply's own indices rather than by nesting order: the two
agree today, and a caller that assumed the order would have no way to notice the
day they do not.

**A body that is not a `sources_to_targets` reply throws rather than answering a
table of nulls.** Nulls would report "nobody could measure these legs" for a URL
pointing at the wrong service, which is the plan quietly lying about what it
checked. There is a test that breaks if that is softened.

**The timeout is 5 s and both signals are one signal on the wire.**
`AbortSignal.any([caller, AbortSignal.timeout(ms)])`, and `#reachFailure` asks
the **caller's** signal first — both causes surface as an `AbortError`, and only
that order separates "someone stopped this run" (`CANCELED`, not retryable) from
"the backend was too slow" (`TIMEOUT`, retryable). Reversing those two lines is
one of the mutations below, and it goes red.

### One existing test changed meaning, deliberately

`config.test.ts`'s "falls back to the fixture provider when the grounding name
is unknown" used `valhalla` as its example of an unknown name. pl-28 makes that
a real name. The example is now `osrm`; the assertion is about the fallback and
not about that word, and the comment says so.

### Gates

- `npm run check` — exit 0.
- `npm test -- --project planner` — **693 passed, 49 files**, up from **669 in
  47 files** at `origin/main` (measured, not derived: the suite was run against
  a stash of this branch). 24 new tests, 2 new files.
- `npm test` — **1390 passed, 99 files**.
- `npm run format` — run; the deployment doc, the adapter and the fixture were
  all reformatted by it.
- **The image gate in `.github/workflows/planner.yml` does not run locally and
  has not run.** Nothing here changes what the container ships — no workspace
  dependency was added, and `packages/core/test/image-closure.test.ts` is green
  — but that scan proves the list and never the image. `GROUNDING_PROVIDER` still
  defaults to `fixtures`, so the gate still starts the planner container alone,
  which is what adr/004 says it must keep doing.
- **Nothing about `compose.planner.yaml` has been run.** No Docker here. Neither
  image tag was pulled or verified, the `healthcheck` shells out to `curl` and
  whether that image ships one is unchecked, and both facts are written into the
  file and into the deployment doc rather than left for someone to discover.

**Twelve mutations, twelve red.** Each new assertion was checked by breaking the
code under it and confirming the failure: dropping `estimate`'s null guard so an
unroutable cell measures as zero; reporting seconds as minutes; reporting
kilometres as metres; losing the `TimeoutError` branch; asking the deadline
before the caller's signal; answering a wrong body with nulls instead of
failing; sending a place with no coordinates anyway; dropping the locality from
the geocoder query; starting with no endpoint; accepting an endpoint that is not
a URL; putting the endpoint in the `/api/health` body; and logging the endpoints
at boot. All twelve restored.
