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
4. **Failure maps to core codes, and never to a thrown run.** Unreachable is
   `UNREACHABLE`, a slow instance is `TIMEOUT`, both from `@webtools/core`, both
   already retryable there. An unroutable pair — an island, a seasonal road
   closed in the direction asked — is a **`null` cell, not an error**: the
   backend answered, and the answer is that there is no route. pl-27 step 4 is
   what happens next, and it is a plan with a named gap rather than a failure.
5. **A timeout on every request**, and it is short. A run holds a queue slot
   while it grounds, `MAX_CONCURRENT_RUNS` is 2, and an instance rebuilding its
   tiles will hang rather than refuse.
6. **This endpoint does not go through the SSRF guard**, and
   [pl-26](./pl-26-lift-the-ssrf-guard.md) explains why at length: it is an
   address this deployment wrote down, not one a stranger handed us. Do not
   reach for `allowPrivateAddresses` to make a guarded fetch work against a LAN
   address — that switch disables the check for everything.
7. **Ops, written down where an operator will find it** — `docs/02-DEPLOYMENT.md`
   and `compose.prod.yaml`: which extract, how tiles are built and how long it
   takes, roughly what the tiles cost on disk, and what re-running the build for
   fresher OSM data involves. This is the half of a self-hosted decision that
   gets skipped and then has to be rediscovered a year later by whoever notices
   the roads are out of date.
8. **`/api/health` names the provider and never the endpoint.** pl-24 step 7
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
