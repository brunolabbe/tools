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

**2026-10-17 — Measured, and corrected after gate 1 (round 2 below). Of 1,019
places, 200 locate and 15 carry hours. Of the 74 located places of a kind that
keeps hours, 14 carry them (18.9%) — but only 35 of the 74 are the place that was
proposed, and 13 of those 35 carry hours (37%). Whether any of it reaches the
deployed stack depends on an OSM extract the owner has not named.** Builder:
Claude Sonnet 5.5. Branch `pl-56-hours-coverage`, base `origin/main` b9f01370.

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
  → 0, on the harness's own log, which holds only harness requests). Two by-hand
  control requests (below) are in a separate `controls.log` with times taken from
  `date`, to the second. No retry, no 429.

**The firewall.** Opened by the owner earlier on 2026-10-17; the owner did not
give me, or the orchestrator, the time. The orchestrator reached it at
2026-10-17T15:40:11Z. I first reached it at **2026-10-17T15:44:16Z**
(`curl …/status?format=json` → 200). First measurement request 15:44:21Z; last
harness request **16:03:46Z**; my two controls at 16:04:25Z and 16:04:27Z, which
were **my last requests**. 1,020 requests in all from this builder (1,013 + 5
sample + 2 controls; the 5 sample places are among the 1,018 queries). The gate
made later requests; its last, per the orchestrator, was at 16:15:49Z, which is
the last request of the whole ticket. **Closed: by the owner, at about
2026-10-17T16:50Z** (their answer "Closing it now", given then; the closing
time itself was not stated).

### Results

The record is `api/test/fixtures/live/hours-coverage/2026-10-17.json`: 1,019
rows (matches the count above), the exclusion list, the first and last harness
request times, and per row the chosen row's `display_name`, whether it is inside
the documented Québec extract, and (for the 74 located rows of a kind that keeps
hours) a hand `reading` of whether it is the place proposed. Tables are the
harness's own output, regenerated from the replies on disk (0 requests).

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
string; no grammar was parsed. **That is the count for what `locate` finds
today.** The 32 places the chooser declines include three more values the harness's
regex counts as seasonal (Schönbrunn, a season range; Musei Capitolini and
Centrale Montemartini, holiday closures; below), so the seasons half is 2 of 27
if the declines are recovered (the regex's own count is 4), not 1 of 15.

**The denominators.** The first gate showed one denominator is not enough:
"a located place of a kind that keeps hours" includes a town resolved to its
railway station. Three further cuts are in the table, each from the record.

| denominator                                          | places | with hours |  rate | objects | objects with hours |
| ---------------------------------------------------- | -----: | ---------: | ----: | ------: | -----------------: |
| all places named                                     |  1,019 |         15 |  1.5% |     119 |                 11 |
| all located                                          |    200 |         15 |  7.5% |     119 |                 11 |
| located, park kinds restored to the denominator      |    102 |         14 | 13.7% |      60 |                 10 |
| located, kinds that keep hours                       |     74 |         14 | 18.9% |      54 |                 10 |
| of those, city briefs (multi-city, city-and-culture) |     22 |          9 | 40.9% |      19 |                  7 |
| of those, **the chosen row is the named premises**   |     35 |         13 | 37.1% |      25 |                  9 |

"Objects" counts each OSM object once: the 200 located places are **119
distinct OSM objects**, because the same museum comes back from
`Exploramer, Sainte-Anne-des-Monts` and `Exploramer, Sainte-Anne-des-Monts, Québec`.
The 15 with hours are **11 objects**. By mention weight the 15 are 35 of 2,594
place mentions (1.3%); the 200 located are 1,440 of them (55.5%), because the
places that locate are the ones named most often.

**What the chosen row is, for the 74 located kept-kind rows** (gate 1 enumerated
all 74 against `display_name`; I classified them the same way and our counts of
the 35 named premises agree; the classification is the `reading` column of the
record and `READING_OF_KEPT_ROWS` in the harness, by query, so it can be
argued with row by row):

| reading                     | rows | with hours | objects | objects with hours | what it is                                                                                                                                                                                                                                      |
| --------------------------- | ---: | ---------: | ------: | -----------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `named-premises`            |   35 |         13 |      25 |                  9 | the proposed name is the object's own                                                                                                                                                                                                           |
| `kind-of-place`             |   19 |          0 |      12 |                  0 | "Motel in Percé", "Hotel near Via Veneto": a kind of place resolved to one arbitrary instance                                                                                                                                                   |
| `settlement-to-premises`    |   14 |          1 |      13 |                  1 | a town named, a station, church, Telus building, parking lot, brasserie, aerodrome, cégep or university inside it returned (`Rimouski`, `Amqui`, `Gaspé, Gaspé, Gaspésie`, `Toronto, Ontario, Toronto`, `Québec City, QC` → a charging station) |
| `wrong-continent`           |    3 |          0 |       3 |                  0 | `Resort kids' club` → Phillip Island, Australia; `Resort shallow pool` → Sky Valley, California; `Trailside lodge` → New York State                                                                                                             |
| `neighbourhood-to-premises` |    1 |          0 |       1 |                  0 | `Salario / Pinciano, Rome` → The Hoxton                                                                                                                                                                                                         |
| `arguable-landmark`         |    2 |          0 |       1 |                  0 | `Cap-des-Rosiers, …` → the lighthouse: plausible, not what was written                                                                                                                                                                          |

**I was wrong in round 1** to write that one of the 14 hits was a false
location and "another outside it", giving a range of 13 to 14 of 74. The gate
read all 74 rows and 39 are not the named place. The hit that is false is still
one (the charging station named after Québec City, under `settlement-to-premises`);
the error was in how many _non-hit_ rows are wrong, which matters because an
hours pass keyed on `locate`'s OSM id would read a station's hours as a town's
and one arbitrary motel's hours for "a motel in Percé". None of the 19
`kind-of-place` rows or the other wrong rows but the charging station has
hours in this sample, so no other wrong hours would have been shown **here**; that is luck of the sample and not
a property of the method. 18.9% is therefore a number about _kinds_, and 37%
(13 of 35, 9 of 25 objects) is a number about _named premises_; the decision is
about the second, and the first is not a floor or a ceiling of it.

One more caveat: 9 of the 1,019 places carry `coordinates` in at least one
fixture, and `runs/travel.ts` locates only `coordinates === null`, so
production would not locate those mentions (`node …/gate-1/coords.mjs`). One,
`Porte Saint-Louis`, is of a kept kind with no hours, which would make the kept
denominator 73. The effect is negligible and I left it.

**The exclusion list** (in the record under `exclusions`, and as
`EXCLUDED_KINDS` in the harness). Chosen from what each kind is, not from its
rate. **That is argued and not proved:** the first full run printed the rates
beside the kinds before I wrote the list, so the claim "written blind" is not
available. Only one excluded kind has a place with hours, `tourism=viewpoint`
(1 of 1, an observatory with an entrance and `Mo-Su 10:00-17:40`), and the
ticket names viewpoints itself. **Round 1 called 18.9% "a floor for the right
denominator". That is withdrawn:** 125 of the 126 excluded places have no hours,
and 28 of them are parks (`boundary=national_park` 19, `boundary=protected_area`
5, `leisure=nature_reserve` 4), whose seasons are what §5's item 2 is about.
Restoring them to the denominator gives 14 of 102 (13.7%), in the table above.
So the supported statement is a range that depends on one choice (parks in or
out) and one reading (named premises or any row): 13.7% to 37.1%.

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
4. **The chooser returns a premises for a town, and an arbitrary instance for
   a kind of place.** Covered by the reading table above: 39 of 74 kept-kind
   rows are not the place proposed, and the single false hit of the 15 is
   `Québec City, Québec City, QC` → `amenity=charging_station` way/1491549954
   (`24/7`). The chooser is production's, unchanged by this ticket. That the
   pl-34 ladder returns a coordinate for these is a fine thing for distance and
   the wrong thing for hours; it is a cost of option 1 below, not a defect of
   this ticket.
5. **The public instance holds the planet; the documented deployment does not.**
   `docs/02-DEPLOYMENT.md` names `OSM_EXTRACT_URL=…/north-america/canada/quebec-latest.osm.pbf`
   and `compose.planner.yaml` feeds that one variable to Valhalla, Nominatim
   (`PBF_URL`) and Overpass (`OVERPASS_PLANET_URL`). **Whether the owner's
   deployment runs it is unknown: the owner answered "I don't know offhand"
   (2026-10-17, to the orchestrator's question).** Restricting the record to
   rows whose chosen `display_name` ends in Québec, Canada (`insideQuebecExtract`
   in the harness; `node …/gate-1/extract.mjs` reproduces
   `locatedInQuebec: 163, keptInQuebec: 46, keptInQuebecWithHours: 5`, and
   `city-brief kept 22 of which in Québec 0`):

   | denominator, documented extract only               | places | with hours |  rate | objects | objects with hours |
   | -------------------------------------------------- | -----: | ---------: | ----: | ------: | -----------------: |
   | all located                                        |    163 |          6 |  3.7% |      86 |                  4 |
   | located, park kinds restored                       |     74 |          5 |  6.8% |      36 |                  3 |
   | located, kinds that keep hours                     |     46 |          5 | 10.9% |      30 |                  3 |
   | of those, city briefs                              |      0 |          0 |     — |       0 |                  0 |
   | of those, **the chosen row is the named premises** |     17 |          4 | 23.5% |      11 |                  2 |

   The 4 hits among 17 named premises are two objects (Exploramer, Musée de la
   Gaspésie, each under two spellings); the fifth kept-kind hit is the charging
   station. **Under the documented extract every Rome, Vienna, Trieste, Graz and
   Ljubljana figure in this Log is a number about a database the deployment
   would not have.** The deployed `locate` would also answer differently there
   (a place outside the extract is `[]`), which this table models only by
   dropping the rows.

6. **The Rome/Vienna declines are a measured lever, and it is moot under the
   documented extract.** The 32 declined replies hold 13 rows with
   `opening_hours` (gate 1, `tables.mjs`: `unlocatedReplyWithHours: 13`, all in
   city briefs). Re-choosing the same replies with the locality's endonym
   (Rome → Roma, Vienna → Wien, and the same for the trip destination; the same
   chooser, changed input; a scratch script, not committed) gives `{ declined:
32, located: 26, withHours: 12, seasonal: 3 }`. The seasonal three are
   Schönbrunn (`Apr 1-Jun 30,Sep 1-Oct 31 08:00-17:30; Jul 1-Aug 31 …`), Musei
   Capitolini and Centrale Montemartini (dated closures). `node --import tsx
…/gate-1/alias.mts <tree> <raw>` reproduces the first four:
   `Galleria Borghese: locality "Rome" -> declined | "Roma" -> tourism=museum oh=Tu-Su 09:00-19:00`.
   This is the **measured** lever. Round 1's claim that a bare-name fallback is
   "the largest lever" was not measured and is withdrawn. What was measured of
   it: `Parc national de la Gaspésie` bare returns a `leisure=nature_reserve`
   row, an excluded kind with no `opening_hours`, so it adds nothing to a
   numerator; `Galleria Doria Pamphilj` bare returns `[]` (gate 1's probe).
7. **Unmeasured:** the deployed extract (extent and age); pl-29's Overpass (I did
   not query it; per the filing it is on the same extract as Nominatim and holds
   every tag); the size of the database an `extratags` re-import adds; any
   metered source; premises per plan; ids per run.

### Folded in, and not

Nothing folded in. The one piece of work this made nearly free is a change to
`locate`: the exonym/endonym decline (point 6) and the qualified-query `[]`
(point 3). Neither is small or already specified: either changes pl-34/pl-37's
ambiguity guarantees and the cache key, so each is a decision, and is in the
open decision below, not done here. The hours build tickets are not filed, as
the ticket says.

### Gates

Round 1: `npm run check` → exit 0. `npx oxlint tools/planner/api` → 0 errors
(3 pre-existing `no-await-in-loop` warnings elsewhere). `npx vitest run
…/live-records.test.ts …/live-gate.test.ts …/grounding-valhalla.test.ts` → 3
files, 257 of 257; `live-records.test.ts` now walks the new record as one more
case (257 at head against 256 at base), and no `*.test.ts` was added, so the
`planner` project collects the same test files. The record carries no
credential-shaped string. Round 2's reruns are in gate 2's section above.

**Where the record lives.** The ticket named `fixtures/live/hours-coverage/`, so
it stays there. It is not a live-run record (no `briefFixture`, no
`candidatesAccepted`); `live-records.test.ts` walks every string leaf whatever the
shape, which is wanted. **Any other walker over `fixtures/live/**` that expects
live-run records must skip `hours-coverage/`**, as this harness does by name
prefix (`recordFiles`). The harness's header says so. I did not move the record
because the ticket's path was explicit and the only consumer that reads
everything there, the credential test, benefits from reading it.

### Round 2 — gate 1's findings (2026-10-17)

Gate 1 returned FAIL on `8e79a014` for what the Log concluded, not for the
numbers: its recomputation matched the record on all 1,019 rows. What changed:

- **Reading of the 74 kept rows** (high): added as data and tables above. The
  false-location count of round 1 is withdrawn.
- **Extract** (high): the documented `quebec-latest.osm.pbf` table above. The
  owner does not know which extract is deployed, so the decision below is costed
  both ways and the recommendation says what it depends on.
- **"Floor" claim** (med): withdrawn; the parks-restored row is in the
  denominator table.
- **Bare-name lever** (med): replaced with the measured endonym lever.
- **`run.log`** (low): the two hand-typed `control (curl)` lines were removed from
  the harness's log into `controls.log`; the record's `lastRequestAt` is now the
  harness's own last request, `2026-10-17T16:03:46.961Z`, and
  `grep -vc " 200 q=" run.log` prints 0 again.
- **Firewall** (low): the owner's answer is recorded above.
- **Coordinates** (low): noted above.
- **Walker** (low): noted above.

The checks after the changes are the reruns in gate 2's section above.

### OPEN DECISION — where would hours come from, if at all

Owner's choice; I cannot ask. **Round 1 recommended option 1. After correcting the
figures the recommendation is now option 3, for now, and the one fact that would
reverse it is named below.**

Every option needs a place identified first, and `locate` identifies 200 of
1,019 (119 objects) on the public planet. Two facts the first answer left out:
only 35 of the 74 located kept-kind rows are the place that was proposed, and
the planet is probably not the deployed extract. The figures each option is
bought against:

|                                                        | places | with hours | objects with hours |
| ------------------------------------------------------ | -----: | ---------: | -----------------: |
| **Public planet instance** (what the harness measured) |        |            |                    |
| any located row of a kind that keeps hours             |     74 | 14 (18.9%) |           10 of 54 |
| same, parks restored                                   |    102 | 14 (13.7%) |           10 of 60 |
| the chosen row is the named premises                   |     35 | 13 (37.1%) |            9 of 25 |
| of those, city briefs                                  |     15 |  9 (60.0%) |            7 of 12 |
| of those, the other briefs                             |     20 |  4 (20.0%) |            2 of 13 |
| **Documented `quebec-latest.osm.pbf` only**            |        |            |                    |
| any located row of a kind that keeps hours             |     46 |  5 (10.9%) |            3 of 30 |
| the chosen row is the named premises                   |     17 |  4 (23.5%) |            2 of 11 |
| city briefs                                            |      0 |          0 |                  0 |

1. **Build on Overpass by OSM id.** `locate` already receives `osm_type` and
   `osm_id`; the pass asks the Overpass instance pl-29 already runs, batched,
   for the located ids' tags: **one extra call per run, no re-import.** What it
   buys, conditional on the extract:
   - _If the deployed extract holds the cities (wide):_ hours for 13 of 35
     named-premises rows, 7 of 12 objects in city briefs, rising by 12 hours
     rows if `locate` is also taught Roma/Wien (point 6, which is its own
     decision). A pass can reject, not cause a different proposal.
   - _If it is the documented Québec extract:_ hours for **2 objects across the
     111 runs** (Exploramer, Musée de la Gaspésie), none in any city brief,
     because none of those places exist in it.
   - **A cost the first answer left out:** an hours pass keyed on `locate`'s OSM
     id would read a station's hours as a town's and one arbitrary motel's hours
     for "a motel in Percé". 39 of the 74 located kept-kind rows are not the
     place proposed. It needs a guard that the chosen object is the _named_
     premises, which does not exist and is not the pl-34 ladder (that ladder
     answers "where", not "is this the thing"). The guard's cost is unmeasured;
     it would also drop `kind-of-place` rows, which is right.
   - Plus a parser for the grammar and "unknown" rendered as unknown (a build
     ticket's problem). The deployed extract's tag age is unmeasured.
2. **Re-import Nominatim with the `extratags` style.** Same coverage as option
   1 on either extract (same tag), no extra call at run time, but an operator
   re-import on every deployment that wants hours, a bigger database (size
   **not measured**), and the same guard. Costs more than 1 for the same
   numbers; I do not recommend it unless the owner wants to retire Overpass for
   this tool.
3. **Do not build hours from OSM.** The plan-wide `opening-hours` line in
   `unchecked.ts` stays. On the documented extract this is clearly right: 2
   objects. On a wide extract it forgoes 7 city objects in this corpus and a
   hit rate near 60% on named city premises, in a sample of 15 rows. The seasons
   half is 1 of 15 (2 of 27 with the endonym fix) and 0 of 15 hours values are
   dated within two years. **What would have to be true for a metered source to
   be worth reopening:** (a) per-place hours well above the OSM rate for named
   city premises, measured on a sample bigger than this one, which nothing here
   says of any vendor; (b) an identification route not capped by `locate`'s
   200 of 1,019 (a vendor does its own place matching); (c) terms that allow
   retaining a result for the day §5 gives hours as a cache life, which is not
   the year pl-28 needed for distances and which collided with route vendors'
   retention terms (I read no vendor's terms); (d) a per-lookup price that a
   plan's premises can carry (premises per plan unmeasured).
4. **Alongside any of them: `locate` and city names.** The Rome/Vienna decline
   (point 6) is a measured, small, city-only change to `locate`, and it is moot
   under the documented extract. It is not an hours decision, and a
   bare-name fallback is not recommended here at all: it is unmeasured and would
   reopen what pl-34 refused.

**Why 3 now, and what reverses it.** Under the documented extract option 1
reaches 2 objects, so nothing is worth building; under a wide extract it reaches
a real number of city premises but needs a name guard nobody has written and a
sample of 15 rows is all there is. The recommendation therefore depends on one
fact the owner can read in a minute: `OSM_EXTRACT_URL` in the deployment's
`.env`. If it is the documented Québec extract, option 3 stands. If the
deployed `OSM_EXTRACT_URL` already holds the cities the city briefs name,
option 1 with the name guard is the cheapest way to start, and I would then
want the guard measured on a second sample before any ticket is filed. Round 1
recommended option 1 on figures that were wrong in two ways at once; I am not
keeping it for continuity.

### The owner's answers, and the fixes made at landing (2026-10-17)

- 2026-10-17 — The open decision above is answered. Question: "where should
  planner's opening hours come from?" Options: don't build from OSM yet (option
  3, recommended by the builder and by gate 2) / I'll check my .env first /
  Overpass by OSM id anyway (option 1) / re-import Nominatim with extratags
  (option 2). **Answer: "Don't build from OSM yet" — option 3.** No hours build
  tickets are filed. It reopens if the deployed `OSM_EXTRACT_URL` turns out to
  hold the cities.
- 2026-10-17 — Question: pursue matching English and local place names
  (Rome → Roma, Vienna → Wien) in `locate`? Options: not now (the
  orchestrator's recommendation, not the builder's or the gate's) / file a
  ticket. **Answer: "Not now".** No ticket is filed.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, the reversal
  condition — "The reversal condition is right in its first clause and
  uncosted in its second. … The remedy is to cost the \"wants to run\" branch,
  or to drop it so that the reversal reads only \"if the deployed
  `OSM_EXTRACT_URL` already holds the cities\"." The owner chose the drop.
  `sed '/^### The owner/q' tools/planner/docs/work/pl-56-measure-opening-hours-coverage.md | grep -c "wants to run"`
  → 0.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, the seasons count —
  "\"the seasons half is 4 of 27\" uses the harness's regex. That regex counts
  two holiday-closure values as seasons … Only 2 of 27 are season ranges
  (Ljubljana Castle and Schönbrunn)." The Log now says 2 of 27 and names the
  regex's own count of 4. `sed '/^### The owner/q' tools/planner/docs/work/pl-56-measure-opening-hours-coverage.md | grep -c "4 of 27"`
  → 0.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, the provenance
  comment — "the `READING_OF_KEPT_ROWS` comment says the reading was
  \"independently re-read by the first gate (it agreed on the 35 named
  premises)\" … This is false about provenance." The comment now says the map
  equals the first gate's earlier classification on all 74 rows, not a second
  independent read. `grep -c "independently re-read" tools/planner/api/test/live/hours-coverage.ts`
  → 0.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, the pointers to
  round-2 checks — "the Log says \"Round 2 reruns are in the next section\" and
  \"Checks after the changes are in the report that follows this push\". No
  section of the Log carries round-2 check results; the second sentence points
  outside the repo." Both sentences now point to the reruns in gate 2's
  section above. `sed '/^### The owner/q' tools/planner/docs/work/pl-56-measure-opening-hours-coverage.md | grep -c "next section\|report that follows"`
  → 0.
