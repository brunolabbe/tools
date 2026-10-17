---
id: pl-56
tool: planner
title: Measure how often OpenStreetMap knows the opening hours of a place a specialist proposed
kind: work-package
status: ready
milestone: P3
depends_on: []
difficulty: standard
note: Needs the owner to open the firewall for the run, as dl-50 did
---

# pl-56 — How often does the map know when a place is open?

**Packages:** `api`: a harness under `api/test/live/` and one record under
`api/test/fixtures/live/`. No behaviour change. If `src` has to change, it is an
export, and the Log says which one and why.

## Why

Analysis §5 ranks opening hours, closed days and season windows second among
the things grounding is worth buying, after distances. Distances landed in
pl-24 through pl-28. Hours have not been started, and every plan still carries
one plan-wide `opening-hours` entry in its unchecked list
(`itinerary/src/unchecked.ts`).

**Decided by the owner on 2026-10-17, and not reopened here:** hours are a
**check pass after the fan-out**, the shape pl-27 gave travel time. They are
not tool use on `ModelProvider`. A specialist proposes, code finds out when the
place is open, and the composer places or drops the item. The cost is the one
the roadmap names: a pass can reject what was proposed, but it cannot cause a
specialist to propose something else.

**What the owner did not decide is the source, and two things measured at
filing are why.** This ticket gets the number that decision needs. The build
tickets are not filed until it is in.

## What was measured at filing

1. **The geocoder as deployed drops the tag at import.** `compose.planner.yaml`
   runs `mediagis/nominatim:4.4` with no `IMPORT_STYLE`, so the import uses the
   default `full` style. That style's `settings/import-full.lua` at `v4.4.0`
   keeps exactly one unused key as an extra tag:
   `flex.set_unused_handling{extra_keys = {'place'}}`. The `extratags` style
   (`import-extratags.lua`) keeps everything but `tiger:*`. So adding
   `extratags=1` to `locate`'s query, which looks free, returns nothing until
   the import is redone. The Overpass instance pl-29 already runs on the same
   extract holds every tag, and the Nominatim replies `locate` already receives
   carry `osm_type` and `osm_id`. That is the other route. Neither route is
   chosen here.

2. **OSM rarely has hours for the data already captured.** In
   `api/test/fixtures/overpass-nearby.json`, the real Montréal→Québec City
   corridor capture, 4 of 657 elements carry `opening_hours`. By kind:

   | Kind                 | Elements | With `opening_hours` |
   | -------------------- | -------: | -------------------: |
   | `tourism=attraction` |       72 |                    4 |
   | `tourism=viewpoint`  |      128 |                    0 |
   | `historic=*`         |      449 |                    0 |
   | other                |        8 |                    0 |

   Most viewpoints and historic markers have no hours to record, so the
   denominator that matters is the attractions, and 4 of 72 is thin. **This is
   not the number the decision needs.** These are discovery finds along a rural
   corridor. They are not the places specialists actually propose: the museums,
   restaurants, ferries and parks in `candidatesAccepted`, some in cities.

What can answer it is the 111 recorded live runs under
`api/test/fixtures/live/`. They hold 2,090 accepted candidates naming **1,019
distinct places** (by lower-cased `name|locality`): 705 from `road-trip`,
71 from `motorised-touring`, 69 from `backcountry`, 63 from `multi-city`,
62 from `city-and-culture` and 57 from `resort`. 837 of them come from the
three Québec briefs. 604 were proposed by a specialist other than
`route-and-logistics` or `lodging`.

## Build

1. **The harness.** Put it at `tools/planner/api/test/live/hours-coverage.ts`
   and run it with `node --import tsx`. pl-40's three constraints hold for the
   same reasons: it lives under `test/` so it is typechecked; it is not named
   `*.test.ts`, so no vitest project collects it; and **it refuses before its
   first request unless `PLANNER_LIVE_RUN=1` is set.** This harness spends no
   money. It gates anyway, because it makes about a thousand requests to a
   public service whose usage policy is the constraint (step 3), and a stray
   run is the thing that policy is about.

2. **The input is the recorded places, not a new list.** Read every
   `candidatesAccepted` in `api/test/fixtures/live/**`. Take each `Place` a
   candidate names, both ends of a `between` included, and dedupe on
   lower-cased `name|locality` as the figures above did. For each place, keep
   the brief fixture and the specialists that named it. Re-count before
   anything else and put the count in the Log. If it is not 1,019, the
   fixtures moved, and the Log says by how much.

3. **Locate through the production code path, against the public instance.**
   The deployed stack has no Nominatim with hours in it (finding 1), and none
   is reachable from the container. `nominatim.openstreetmap.org` imports with
   extratags, and pl-30 captured its fixtures from it.
   - Build the query with the same function `locate` uses (`placeQuery` in
     `api/src/grounding/valhalla.ts`), add `extratags=1`, and keep
     `limit=GEOCODER_RESULT_LIMIT` and `format=jsonv2`.
   - Pick the result with the same `chooseResult`, passing the brief's
     `TripContext` exactly as the run would. **`chooseResult` returns
     coordinates and this ticket needs the chosen result itself.** Exporting a
     variant that returns the whole result is the one `src` change this ticket
     expects. Do not write a second chooser: a harness that picks differently
     from production measures a geocoder nobody runs.
   - Policy: at most one request per second, a `User-Agent` naming the
     project, and no parallelism. Write the raw replies to disk as they arrive,
     so an interrupted run resumes instead of re-asking.
   - The firewall blocks the host from this container. The owner opens it for
     the run, as for dl-50's test-key lines, and the Log records when it was
     opened and closed.

4. **Record per place:**
   - located or not;
   - the chosen result's `osm_type`/`osm_id`, `category` and `type`;
   - whether `extratags.opening_hours` is present, and its raw value;
   - whether that value carries a season, meaning a month name or a date
     range, since seasons are the other half of §5's item 2;
   - `check_date:opening_hours` when present. A tag set in 2016 is a different
     fact from one checked last spring.

   Do not parse the full `opening_hours` grammar here. Whether it parses is a
   build ticket's question, and a homemade parser would turn this measurement
   into a review of that parser.

5. **The report.** Commit one record,
   `api/test/fixtures/live/hours-coverage/<date>.json`, holding the per-place
   rows. Raw Nominatim replies are scratch and are not committed. The Log
   carries tables for:
   - located / not located, by brief;
   - with hours, by `category=type`, for the located places;
   - with hours, by brief, which is the city-versus-rural split:
     `city-and-culture` and `multi-city` against the three Québec briefs;
   - with hours, by proposing specialist;
   - of those with hours, how many carry a season, and how many have a
     `check_date` newer than two years.

   **Then the denominator, argued.** Some kinds never have hours: a
   viewpoint, a summit, a stretch of road. Counting them makes coverage look
   worse than it is, and dropping them by hand is where a measurement turns
   into an opinion. Write the exclusion list into the record with a one-line
   reason per kind, and give both figures: all located places, and places of
   kinds that keep hours.

6. **End the Log with the decision this measurement exists for, as options
   with a recommendation.** You cannot ask the owner, so label it an open
   decision. At minimum:
   - **build on Overpass by OSM id**: one extra call per run and no
     re-import;
   - **re-import Nominatim with the `extratags` style**: no extra call, but an
     operator step on every deployment that wants hours, and a bigger
     database;
   - **do not build hours from OSM**: coverage too thin to beat the plan-wide
     line we have now. Say what would have to be true for a metered source to
     be worth reopening, given that pl-28's reasoning about vendors' retention
     terms applies here too.

   Each option carries its cost in the numbers measured here.

## Done when

- Running the harness without `PLANNER_LIVE_RUN=1` exits non-zero before any
  request. The Log shows the command and its exit code, taken without a pipe.
- The places record is committed, and its count matches the Log's.
- The Log carries the tables in step 5, both denominators, and the exclusion
  list with its reasons.
- The Log ends with the open decision in step 6, as options with costs and a
  recommendation.
- `npm run check` passes, and the `planner` vitest project is unchanged in
  what it collects.

## Log
