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

**2026-10-17 — Measured. Of 1,019 places, 200 locate and 15 carry hours; the
number the decision turns on is 14 of the 74 located places of a kind that keeps
hours (18.9%), and the larger loss is upstream of hours.** Builder: Claude
Sonnet 5.5. Branch `pl-56-hours-coverage`, base `origin/main` b9f01370.

### What changed in `src`

One export, as the ticket expected, and it did not change what `locate` does.
`api/src/grounding/valhalla.ts`:

- `chooseResult` is now a four-line wrapper over a new exported
  `chooseGeocoderResult`, which returns the whole chosen `GeocoderResult`.
  The ladder inside it is the same code; only `agreedPoint` (returned
  `best.coordinates`) became `agreedResult` (returns `best`). **There is no
  second chooser.**
- `GeocoderResult` gained `raw`, the reply row as received, so a caller reads
  `osm_type`, `osm_id`, `category`, `type` and `extratags` off the row that was
  chosen rather than matching it back to the reply by position. `locate` never
  reads it.
- Exported so the harness builds the production query: `placeQuery`,
  `GEOCODER_RESULT_LIMIT`, `geocoderResults`, `GeocoderResult`.

Behaviour unchanged, shown by the suites that pin the ladder, run on the
changed file: `npx vitest run tools/planner/api/test/grounding-valhalla.test.ts
tools/planner/api/test/grounding-fixtures.test.ts` → 2 files, 114 of 114 passed
(pl-34's ten captures and pl-37's rung 2 are in them).

### The harness, and the refusal

`api/test/live/hours-coverage.ts`, run with `node --import tsx`. It is under
`test/` (typechecked), not named `*.test.ts` (no vitest project collects it) and
refuses first.

```
$ node --import tsx tools/planner/api/test/live/hours-coverage.ts > refuse.out 2>&1; echo "exit=$?"
exit=1
Error: Refusing: PLANNER_LIVE_RUN=1 is not set. This harness makes about a thousand requests to a public service — set PLANNER_LIVE_RUN=1 to run it.
```

The exit code was read from a file, not through a pipe. The gate is the first
statement of `main()`, so no request, no scratch directory and no fixture read
happens before it.

### Step 2 — the count

`PLANNER_LIVE_RUN=1 PLANNER_HOURS_COUNT_ONLY=1 node --import tsx …/hours-coverage.ts`
→ `111 records, 2594 place mentions, 1019 distinct places, 6 briefs`. **1,019,
as the filing said; the fixtures have not moved.** The filing's other figures
also reproduce: 2,090 accepted candidates (2,594 mentions because a `between`
names two), 604 places named by a specialist other than `route-and-logistics`
or `lodging`, and 8 places named under more than one brief (the by-brief table
below counts such a place under each brief that named it, which is why
`road-trip` reads 705 there and 703 in the table after it).

**1,018 queries for 1,019 places:** two places differ only in how `name|locality`
is cased or spaced and `placeQuery` joins them to one string. One request each
is made per distinct query.

### Step 3 — how it was run

- The query is `placeQuery(place)`, `format=jsonv2`, `limit=10`
  (`GEOCODER_RESULT_LIMIT`), plus `extratags=1`, to `nominatim.openstreetmap.org`.
  The row is chosen by `chooseGeocoderResult(results, place, tripContextFor(brief))`
  with the brief's own `TripContext`. A place named under more than one brief is
  judged under the brief that named it most; for the 8 that have another,
  **0 chose a different row under the other brief's context** (`briefsThatChooseDifferently`).
- Pause 1.1 s between request starts, one at a time, `User-Agent:
webtools-planner/1.0 (+https://github.com/webtools; pl-56 opening-hours coverage measurement)`.
  Every reply was written to disk as it arrived (scratch `raw/`, not committed),
  so the run resumes; the regeneration of the record after the exclusion list
  was written ran with `PLANNER_HOURS_OFFLINE=1` and made 0 requests
  (`1018 queries, 1018 on disk, 0 to ask`).
- **Proved on five places first**, with the sample's replies kept and reused by
  the full run: 5 queries, 5 answered 200, extratags present on the replies
  (`Forillon National Park, Gaspé` carried a 3-key `extratags`), and
  `chooseGeocoderResult` returned a row for all 5. **None of the five had
  hours**, so the hours-reading path was proved on a synthetic reply instead:
  `rowFor` over a `tourism=museum` row with
  `opening_hours=Jun 01-Aug 31 Mo-Su 09:00-17:00` and
  `check_date:opening_hours=2025-06-01` gives `season: true`, `checkDateWithinTwoYears:
true`; the same with `Mo-Fr 09:00-17:00` and `2019-05-05` gives `season: false`,
  `false`; no hours and a null `extratags` both give no hours. The full run's
  15 real hits are the other half of that proof.
- Full run: 1,013 requests, **every one HTTP 200** (`grep -vc " 200 q=" run.log`
  → 0), no retry, no 429.

**The firewall.** Opened by the owner on 2026-10-17 (time not recorded to me).
The orchestrator reached it at 2026-10-17T15:40:11Z. I first reached it at
**2026-10-17T15:44:16Z** (`curl …/status?format=json` → 200). First
measurement request 15:44:21Z; last harness request **16:03:46Z**; two
single-request controls by hand (below) at 16:04:25Z and 16:04:27Z, which is
my **last request: 2026-10-17T16:04:27Z**. 1,020 requests in all (1,013 + 5 +
2 controls; the 5 sample places are among the 1,018 queries). closed: by the
owner, time to be recorded

### Results

The record is `api/test/fixtures/live/hours-coverage/2026-10-17.json`: 1,019
rows (matches the count above), the exclusion list, and the first and last
request times. Tables are the harness's own output.

**Located / not located, with hours, by brief.** A place named under more than
one brief counts under each, so the columns add to more than 1,019; the last
row is the distinct count.

|                    | places | located | with hours | of located | kinds that keep hours | of those with hours | of those |
| ------------------ | -----: | ------: | ---------: | ---------: | --------------------: | ------------------: | -------: |
| road-trip          |    705 |     142 |          5 |       3.5% |                    42 |                   4 |     9.5% |
| motorised-touring  |     71 |      14 |          0 |       0.0% |                     3 |                   0 |     0.0% |
| backcountry        |     69 |      14 |          1 |       7.1% |                     2 |                   1 |    50.0% |
| multi-city         |     63 |      21 |          7 |      33.3% |                    14 |                   7 |    50.0% |
| city-and-culture   |     62 |       8 |          2 |      25.0% |                     8 |                   2 |    25.0% |
| resort             |     57 |       6 |          0 |       0.0% |                     5 |                   0 |     0.0% |
| **all (distinct)** |  1,019 |     200 |         15 |       7.5% |                    74 |                  14 |    18.9% |

City versus rural, the split the filing asked for: `multi-city` + `city-and-culture`
= 9 of 22 places of kinds that keep hours (40.9%); the three Québec briefs = 5
of 47 (10.6%). Both numerators are small and one of the Québec five is a false
location (below).

**Why a place was not located, by primary brief** (a place judged under the
brief that named it most; sums to 1,019):

| brief             | places | located | empty reply | declined by `chooseResult` |
| ----------------- | -----: | ------: | ----------: | -------------------------: |
| road-trip         |    703 |     140 |         561 |                          2 |
| city-and-culture  |     62 |       8 |          37 |                         17 |
| multi-city        |     63 |      21 |          33 |                          9 |
| motorised-touring |     71 |      14 |          55 |                          2 |
| backcountry       |     63 |      11 |          51 |                          1 |
| resort            |     57 |       6 |          50 |                          1 |
| **all**           |  1,019 |     200 |         787 |                         32 |

**With hours, by `category=type`, located places** (200 located; the last
column is the denominator the exclusion list below puts each kind in):

| kind                     | located | with hours |   rate | denominator |
| ------------------------ | ------: | ---------: | -----: | ----------- |
| boundary=administrative  |      56 |          0 |   0.0% | excluded    |
| boundary=national_park   |      19 |          0 |   0.0% | excluded    |
| tourism=motel            |      11 |          0 |   0.0% | keeps hours |
| tourism=hotel            |      10 |          1 |  10.0% | keeps hours |
| place=island             |       7 |          0 |   0.0% | excluded    |
| aeroway=aerodrome        |       6 |          0 |   0.0% | keeps hours |
| highway=bus_stop         |       6 |          0 |   0.0% | excluded    |
| man_made=lighthouse      |       6 |          0 |   0.0% | keeps hours |
| boundary=protected_area  |       5 |          0 |   0.0% | excluded    |
| leisure=nature_reserve   |       4 |          0 |   0.0% | excluded    |
| place=city               |       4 |          0 |   0.0% | excluded    |
| railway=station          |       4 |          0 |   0.0% | keeps hours |
| tourism=museum           |       4 |          4 | 100.0% | keeps hours |
| amenity=restaurant       |       3 |          1 |  33.3% | keeps hours |
| tourism=attraction       |       3 |          1 |  33.3% | keeps hours |
| aeroway=terminal         |       2 |          0 |   0.0% | keeps hours |
| amenity=ferry_terminal   |       2 |          0 |   0.0% | keeps hours |
| amenity=marketplace      |       2 |          2 | 100.0% | keeps hours |
| amenity=university       |       2 |          0 |   0.0% | keeps hours |
| building=train_station   |       2 |          1 |  50.0% | keeps hours |
| highway=tertiary         |       2 |          0 |   0.0% | excluded    |
| historic=castle          |       2 |          2 | 100.0% | keeps hours |
| landuse=railway          |       2 |          0 |   0.0% | excluded    |
| leisure=garden           |       2 |          0 |   0.0% | keeps hours |
| place=islet              |       2 |          0 |   0.0% | excluded    |
| place=locality           |       2 |          0 |   0.0% | excluded    |
| place=neighbourhood      |       2 |          0 |   0.0% | excluded    |
| place=village            |       2 |          0 |   0.0% | excluded    |
| amenity=cafe             |       1 |          1 | 100.0% | keeps hours |
| amenity=charging_station |       1 |          1 | 100.0% | keeps hours |
| tourism=viewpoint        |       1 |          1 | 100.0% | excluded    |

Twenty-three kinds with one located place and no hours: `amenity=bar`, `college`,
`parking`, `place_of_worship`, `pub`, `shelter`; `boundary=political`;
`building=service`, `yes`; `highway=rest_area`, `service`; `landuse=cemetery`,
`construction`, `recreation_ground`; `leisure=swimming_pool`; `natural=beach`,
`cape`, `cave_entrance`; `place=hamlet`, `square`; `shop=seafood`;
`tourism=caravan_site`; `water=lake`. (The harness prints all of them; the
list above is the same rows, collapsed.)

**With hours, by proposing specialist.** A place named by several specialists
counts under each.

|                     | places | located | with hours | of located | kinds that keep hours | of those with hours | of those |
| ------------------- | -----: | ------: | ---------: | ---------: | --------------------: | ------------------: | -------: |
| lodging             |    320 |      34 |          1 |       2.9% |                    24 |                   1 |     4.2% |
| food                |    259 |      15 |          3 |      20.0% |                     9 |                   3 |    33.3% |
| activities          |    194 |      52 |          8 |      15.4% |                    16 |                   7 |    43.8% |
| route-and-logistics |    126 |      91 |          2 |       2.2% |                    15 |                   2 |    13.3% |
| budget              |    110 |      35 |          2 |       5.7% |                     9 |                   2 |    22.2% |
| practicalities      |     68 |      10 |          0 |       0.0% |                     6 |                   0 |     0.0% |
| conditions-and-gear |     24 |       2 |          0 |       0.0% |                     0 |                   0 |        — |

**Of the 15 located places with hours:** 1 carries a season (Ljubljana Castle,
`Jan-Apr,Oct-Dec 09:00-19:00; May-Sep 09:00-22:00`); 2 carry
`check_date:opening_hours` (both the Testaccio market, `2022-10-16`); **0 have
one within two years of the run.** So the tag is rarely dated, and where it is
dated it is 4 years old. The seasons half of §5's item 2 is almost entirely
not in this data: the other 14 values are weekly patterns, `24/7`, or a single
range. The season test is a month name, an ISO date or `easter` in the raw
string; no grammar was parsed.

**The denominators, both.**

| denominator                             | places | with hours |  rate |
| --------------------------------------- | -----: | ---------: | ----: |
| all 1,019 places named                  |  1,019 |         15 |  1.5% |
| all located                             |    200 |         15 |  7.5% |
| located, kinds that keep hours          |     74 |         14 | 18.9% |
| the same, counting each OSM object once |     54 |         10 | 18.5% |

Counting objects once matters: the 200 located places are **119 distinct OSM
objects**, because the same museum comes back from `Exploramer, Sainte-Anne-des-Monts`
and `Exploramer, Sainte-Anne-des-Monts, Québec`. The 15 with hours are **11
objects**. The 15 are, by mention weight, 35 of 2,594 place mentions (1.3%);
the 200 located are 1,440 of them (55.5%), because the places that locate are
the ones named most often (a boundary or a national park, named by many
candidates).

**The exclusion list** (in the record under `exclusions`, and as
`EXCLUDED_KINDS` in the harness). Chosen from what each kind is, not from its
rate. **That is argued and not proved:** the first full run printed the rates
beside the kinds before I wrote the list, so the claim "written blind" is not
available. The check that matters is that only one excluded kind has a place
with hours, `tourism=viewpoint` (1 of 1, an observatory with `Mo-Su 10:00-17:40`),
and the ticket names viewpoints itself. A kind that is merely unlikely to have
hours (an aerodrome, a station, a lighthouse, a motel) stays in, which makes
the 18.9% a floor for the right denominator rather than a ceiling.

| pattern                  | why it keeps no hours                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `boundary=*`             | an administrative, park or protected-area boundary is an area with no door; premises inside it are other objects |
| `place=*`                | a city, village, island or square is a settlement or a landform, not a premises                                  |
| `natural=*`              | a cape, beach or cave mouth is a landform; nobody opens or closes it                                             |
| `highway=*`              | a bus stop, a road and a rest-area strip are road furniture or a road                                            |
| `landuse=*`              | land cover (railway land, cemetery, recreation ground); not a premises                                           |
| `water=*`                | a lake is a water body                                                                                           |
| `leisure=nature_reserve` | an area, like the boundary kinds; its visitor facilities are other objects                                       |
| `tourism=viewpoint`      | the ticket's own example of a kind with nothing to open                                                          |

126 of 200 located places are excluded. **A national park is the case a reader
may dispute:** a park such as Forillon does have seasons for its services, but
the OSM object that comes back is the boundary relation, which carries no
`opening_hours` for any of the 19; the services are separate objects this query
does not reach.

### What the numbers say beyond hours

1. **The binding constraint is location, not tag coverage.** 787 of 1,019
   queries (77.2%) came back **empty** and 32 more (3.1%) came back with rows
   the chooser declined (17 of the 62 `city-and-culture` places, 9 of the 63
   `multi-city`; e.g. `Galleria Borghese, Rome`: the one row's `display_name`
   says `Roma`, so the locality `Rome` matches nothing). Any hours source that
   starts from an OSM id is capped by `locate`'s 200.
2. **Most of the empties are not places.** A sample of 40 empty queries is
   `Percé village inn, Percé`, `Gaspé guesthouse or inn, Gaspé`, `Local bakery
and cheese shop, Gaspé Peninsula`, `Snowmobile rental outfitter near the
chosen trail region`: specialists propose a kind of place at a locality
   about as often as a named premises. 320 of the 1,019 places are named by
   `lodging`, and 34 of them locate. That is not a Nominatim failure.
3. **Some are real places the query shape misses.** Control, by hand, one
   request each: `Parc national de la Gaspésie, Sainte-Anne-des-Monts, Québec`
   (named by 34 candidates) → `[]`; `Parc national de la Gaspésie` alone → a row,
   `leisure=nature_reserve`, relation 7485827. `Roscioli, Campo de' Fiori, Rome`
   and `Hotel Raphael, Rome, Centro Storico` are empty too. The reply is
   deterministic and not a throttle (the same run had 200 rows). **Inferred, not
   measured:** the deployed Nominatim runs the same search code over a smaller
   extract, so it should answer the same `[]`. I could not reach it.
4. **A false location is among the 15, and another is outside it.** `Québec City, Québec City, QC`
   chose `amenity=charging_station` way/1491549954 (`24/7`), and the same name
   with the locality `Québec City, Québec` chose a railway station (no hours). The ladder's settlement
   tiebreak is `addresstype`-based and a charging station named after the city
   passed. It is production's behaviour and I did not change it; it means one of
   the 14 kept-kind hits is a wrong place, so the honest range for the
   floor-denominator rate is 13 to 14 of 74, 17.6% to 18.9%.
5. **Unmeasured:** the deployed extract's own age and tag content (the public
   instance is the planet at today's date; pl-29's Overpass is on the same
   extract as the deployed Nominatim, per the filing, and holds every tag, but
   I did not query it); the size of the database an `extratags` re-import
   adds; and any metered source.

### Folded in, and not

Nothing folded in. The one piece of work this made nearly free is the locate
defect in point 3 (a qualified query returns `[]` where the bare name finds the
place). It is not small or already specified: whether `locate` should retry with
the name alone changes pl-34/pl-37's ambiguity guarantees and the cache key, so
it is a decision and is in the open decision below, not done here. The hours
build tickets are not filed, as the ticket says.

### Gates

`npm run check` → exit 0. `npx oxlint tools/planner/api` → 0 errors (3
pre-existing `no-await-in-loop` warnings elsewhere). `npx vitest run
…/live-records.test.ts …/live-gate.test.ts …/grounding-valhalla.test.ts` → 3
files, 257 of 257; `live-records.test.ts` now walks the new record as one more
case, and no `*.test.ts` was added, so the `planner` project collects the same
test files. The record carries no credential-shaped string.

### OPEN DECISION — where would hours come from, if at all

Owner's choice; I cannot ask. **Recommendation: option 1, built small, with
the locate question (option 4) put to the owner alongside it.**

All three options share the same ceiling. Whatever the source, a place needs an
identity first, and `locate` identifies 200 of 1,019 (119 objects). The
numbers each option is bought against:

|                                                      | people it would help | measured                                           |
| ---------------------------------------------------- | -------------------- | -------------------------------------------------- |
| a located place of a kind that keeps hours has hours | 14 of 74             | 18.9% (13 of 74 if the charging station is struck) |
| the same, city briefs only                           | 9 of 22              | 40.9%                                              |
| the same, Québec briefs only                         | 5 of 47              | 10.6%                                              |
| of everything specialists proposed                   | 15 of 1,019          | 1.5%; 11 objects                                   |

1. **Build on Overpass by OSM id.** `locate` already receives `osm_type` and
   `osm_id`; the pass asks the Overpass instance pl-29 already runs, batched,
   for the tags of the located ids: **one extra call per run, no re-import, no
   change to the deployed geocoder.** Cost in these numbers: at most 119 ids over
   the whole 111-run corpus (ids per run not measured); it can decide something for ~1.5% of what is proposed overall and ~19% of located premises,
   about 41% in a city brief. A pass can reject, not cause a different proposal
   (the owner's framing). Needs a parser for the grammar and "unknown" rendered
   as unknown, which is a build ticket's problem. Risk: the deployed extract's
   tags may be older than the public planet I measured (unmeasured).
2. **Re-import Nominatim with the `extratags` style.** Same coverage as option
   1, since `extratags` carries the same tag; no extra call at run time, but an
   operator re-import on every deployment that wants hours, a bigger database
   (size **not measured** here), and it keeps hours inside the geocoder where
   the extract's age cannot be separated from `locate`'s. Costs more than 1 for
   the same numbers; I do not recommend it unless the owner wants to retire
   Overpass for this tool.
3. **Do not build hours from OSM.** The plan-wide `opening-hours` line in
   `unchecked.ts` stays. This is defensible: 11 objects across a thousand
   places is thin, the seasons half is 1 of 15 and the tag is never fresh (0 of
   15 within two years). **What would have to be true for a metered source to be
   worth reopening:** (a) per-place hours on well over 18.9% of premises kinds
   in the briefs that matter (cities), on a sample of this size, which this
   ticket's data cannot yet say for any vendor; (b) an identification route not
   capped by `locate`'s 20%, since a vendor still needs the place first, so the
   locate gap in point 1 has to close or the vendor must do its own matching;
   (c) terms that allow retaining a result for the day §5 gives hours as a
   cache life, unlike the year pl-28 needed for distances and which collided
   with the route vendors' retention terms. I read no vendor's terms. (d) a
   per-lookup price that a plan's premises can carry (not measured: the count
   of premises per plan).
4. **Alongside any of them: decide whether `locate` should fall back to the bare
   name.** It is the largest lever on all three options, and it is not an hours
   decision. Reproduction: `curl -A '…' 'https://nominatim.openstreetmap.org/search?q=Parc%20national%20de%20la%20Gasp%C3%A9sie%2C%20Sainte-Anne-des-Monts%2C%20Qu%C3%A9bec&format=jsonv2&limit=10'`
   → `[]`; the same with `q=Parc%20national%20de%20la%20Gasp%C3%A9sie` → one row.
   A fallback would raise the located count, and with it the hours cap, and it
   would reopen what pl-34 refused (a confident coordinate from a name that
   several places share). Not measured: how many of the 787 it would recover. It
   needs its own ticket and a measurement before the owner is asked to choose.

Why 1 over 3: it is the cheapest of the three that keeps the owner's decided
shape (a check pass), it costs nothing to run when no place locates, and it
concentrates where §5 says the damage is (a slow week in Rome: 9 of 22 there
against 5 of 47 on the Québec roads). Why not more than that: the sample is 22
city places and the claim is "about 40%", not a rate. If the owner's judgement
is that 1.5% end to end is not worth a parser, option 3 is the honest answer
and nothing here argues against it.
