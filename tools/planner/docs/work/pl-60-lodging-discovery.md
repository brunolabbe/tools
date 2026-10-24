---
id: pl-60
tool: planner
title: Lodging chooses among real establishments fetched from map data, instead of proposing from memory
kind: work-package
status: done
milestone: P3
depends_on: [pl-58]
difficulty: hard
---

# pl-60 — Lodging discovery: real establishments propose, the specialist chooses

**Packages:** `agent` (the set of specialists handed `Find[]`, the discovery
prompt block, `lodging`'s `role`, and `grounding.ts`, which holds both
`DISCOVERY_KINDS` and the seam a town query goes through), `api` (the discovery
pass, the adapter's query and its reply parser in `grounding/valhalla.ts`, the
fixtures, the live re-measure, and the `invention.ts` harness, whose run label
Build 7 widens), and `tools/planner/CLAUDE.md` (one rule, named in Build 8).
**No contract change.** The owner answered question 3 on 2026-10-21: no `Place`
specificity field.

## Why

[00-ANALYSIS.md §5's amendment of 2026-08-22](../00-ANALYSIS.md) made grounding a
source of candidates and not only a check, and [pl-29](pl-29-detours-along-a-leg.md)
built it for corridors: map data proposes to a specialist, the specialist proposes
to the composer. `activities`, `food` and `conditions-and-gear` are handed
`Find[]` today. `lodging` is not, and it is the specialist whose output most
needs a real premises behind it, because it is the one a traveller books.

**The evidence is in pl-58**, whose branch is `pl-58-name-a-premises` (PR #593).
It had not merged when this ticket was filed, so everything below is cited from
its ticket's Log in prose and not by link, and `depends_on` waits for it. The Log
was read as the branch stood at `6fc01891` (2026-10-21, 01:53Z); that sha lives
only on the branch and stops resolving once #593 squash-merges, so every figure
used is also written out here. Three facts, each re-read from that Log:

1. **Asking the model to name a premises did not make it do so.** pl-58 changed
   the `role` strings of `lodging` and `food` to say a proposal names one
   premises or says plainly that it is a kind of place. The share of mentions that
   name a premises went `lodging` 47 of 402 (11.7%) to 33 of 418 (7.9%), and
   `food` 36 of 322 (11.2%) to 43 of 407 (10.6%). Neither rose. Proposals that
   are a kind of place now say so, `motel` at `Percé`, and a code check cannot
   look a kind of place up. That is 90.8% of the two specialists' 825 mentions
   after the change. pl-58's Log does not claim the prompt caused the fall: the two
   populations are different samples of the same five model and effort pairs, and
   no interval was computed on the mentions.
2. **What they do name is wrong about one time in eight.** In pl-58's web check, 5
   of 40 objects were not confirmed, 12.5% (95% Wilson 5.5–26.1): 3 in another
   town and 2 not found. That clears the owner's bar (above about 10%, lower bound
   above 5%) by 0.5 points on the lower bound, and it moves to 4 of 40, which does
   not clear it, if one judgement call (`pit caribou|gaspé`) is read the other
   way. pl-58 also says the rate cannot be shown to have moved from pl-57's
   3 of 19. **Read from the record** (`invention/pl58-2026-10-21/2026-10-21.json`
   on that branch, the `specialists` field of each row) and not stated in
   pl-58's Log: the three wrong-town objects were all proposed by `food` (two
   smokehouses and a brewery-pub, each a real premises in another town), and the
   two not found by `lodging` (two Forillon campgrounds, under names Parks Canada
   does not use). A lodging route reaches the second pair and not the first.
3. **The data source is not obviously OSM.** pl-56's geocoder run, which pl-58
   reuses, has a row for 9 of the 51 stratum keys, because pl-56 read pl-57's
   places and the other 42 keys are new strings. It located 3 of those 9. That is
   a name lookup against Nominatim, 3 of a 9-key sample. It is **not** a measure
   of whether Overpass returns the lodging that stands in a town, which nobody
   has measured. [00-ANALYSIS.md §5's amendment of 2026-10-17](../00-ANALYSIS.md)
   already says an empty geocoder reply mostly means a proposal too vague to look
   up, and this is the opposite direction (the map proposes, nothing is looked up
   by name), so the figure neither supports nor weakens OSM here. It means the
   first step of the build has to measure it.

**Decided by the owner on 2026-10-21, and not reopened here.** At pl-58's close
the owner was asked which way to go after the measurement above. The options
were: (a) a lookup that checks named lodging and food places after the
specialists have run (pl-57's option 3), recommended by pl-58's Build 5 to 7 agent
and by the orchestrator; (b) a discovery route: before the lodging specialist
runs, real establishments in each town are fetched from data and the specialist
chooses among them, as pl-29's pass already does for `activities`, `food` and
`conditions-and-gear`; (c) close analysis §5's third item, existence (pl-57's
option 4); or (d) decide later. **The owner chose (b), against the
recommendation of (a).** This ticket is that route. It was filed `needs-decision`
with four questions under it; the owner answered them the same day, and
_Decision — answered_ below records each.

**What differs from pl-29, so the route is not read as a copy of it.**

- **The unit is a town, not a corridor.** pl-29 draws a line from the brief's
  origin and destination and asks for everything within a radius of it
  (`nearby(corridor, radiusMetres, kinds)`). A lodging find is wanted at the places
  a traveller stops, and `lodging` runs in the same fan-out as
  `route-and-logistics`, so the stops are not known when discovery runs. The
  discovery pass is also gated by `hasCorridor(brief)`: a brief with no origin or no
  destination, such as an all-inclusive resort week, gets no discovery today and
  would need the lodging pass to run anyway.
- **`DISCOVERY_KINDS` has no lodging kind.** Its four members are `viewpoint`,
  `waterfall`, `attraction` and `historic-site`, each one Overpass clause in
  `KIND_FILTERS` in `api/src/grounding/valhalla.ts`. `food` is in `READS_FINDS`
  and is handed finds, none of which can be a restaurant. pl-29 says extending the
  list costs a query clause and not a signature change, and that is true of the
  list. It is not true of the query's shape: `overpassQuery` emits
  `node[<filter>](around:…)` and `out body`, so a clause added to `KIND_FILTERS`
  finds nodes only, and OSM maps lodging as areas as well (Build 1).
  `NearbyRequest.corridor` is also a `Corridor`, "at least two points", and a
  town is one (Build 2).
- **pl-36 settled that a candidate written from a `Find` stays `model-asserted`**,
  because nothing can say which find a proposal came from and the name-match join
  that would say it had never been scored. That holds here until a measurement
  says otherwise, and Build 6 is that measurement. pl-36's premise that no run has
  been captured with finds in it is stale: pl-40's live records for sets B to D
  carry a `finds` array (`run.ts`'s `serializeFinds`), parsed offline from the one
  real Overpass capture the repo holds, so the join can be scored on existing
  records for `activities` and `food` at no cost.

## Build

Written for the owner's answers of 2026-10-21 (_Decision — answered_): OSM through
Overpass, `lodging` only, a fallback to a kind of place, no `Place` field.

1. **Capture first, and stop with the counts.** The capture asks for what OSM
   holds, which is more than nodes. `overpassQuery` in `api/src/grounding/valhalla.ts`
   emits `node[<filter>](around:…)` with `out body`, so a lodging kind added to
   `DISCOVERY_KINDS` and `KIND_FILTERS` and run through it would return nodes only.
   OSM's wiki says `tourism=camp_site` can be a node or an area and
   `tourism=hotel` has an area form, and an area gets no clause from that query and
   no coordinate from `out body`. A zero for Forillon's campgrounds on a node-only
   query would read as thin coverage and would not be evidence of it. So: capture
   with `nwr[<filter>](around:R,lat,lon)` and `out center tags`, from a scratch script
   and not through the seam, which Build 2 decides. Take the OSM tag values from the
   OSM wiki, with the rejected ones in the Log. The towns are **the distinct
   `place.locality` of the `lodging` candidates in the set A `road-trip` record of
   each of pl-58's five run directories**
   (`api/test/fixtures/live/claude-<family>-5-5-<effort>-pl58-2026-10-21/`). The
   Log gives the town count, the number of lodging finds returned per town
   including zero, **those counts split by OSM element type** (node, way,
   relation), and whether the three campgrounds Parks Canada names for Forillon
   (Petit-Gaspé, Des-Rosiers, Cap-Bon-Ami) are among the finds for Gaspé, and as
   which element type. The adapter's reply parser reads `element.lat` and
   `element.lon`, which a way does not carry (it carries `center`), so a build that
   keeps the area form changes the parser too. `findFrom` also builds the find's
   source URL as `https://www.openstreetmap.org/node/<id>`, hard-coded, and OSM ids
   are unique only within a type, so a way or relation must take its URL from the
   element's `type` (`/way/<id>`, `/relation/<id>`) beside its `center`, or it
   links to an unrelated node. The payload `Done when` 3 checks in is re-captured
   through the built `overpassQuery`, which that function's doc-comment exports so
   a capture builds "the _exact_ query this adapter sends", and not through the
   scratch script's hand-written query. The capture needs outbound access to
   an Overpass instance, which the sandbox firewall may block, so ask the owner to
   open it. **The owner set no zero-find threshold, so stop after this step**,
   commit the Log, and report the counts as an open decision: a source that
   returns nothing for the towns that matter is the precondition for everything
   below, and the owner chose OSM on the strength of a capture not yet taken.
2. **Fetch finds per town, before the fan-out.** Where the towns come from is the
   builder's call to propose and the Log's to argue: the brief's origin,
   destination and waypoints are the only stops known before `lodging` runs. A
   town costs grounding calls against `MAX_GROUNDING_CALLS`, so the Log gives the
   number of calls a run of each brief shape spends and asserts it, as pl-29's
   discovery pass does for the corridor. Re-plans: `revise.ts` decides whether a
   re-plan re-runs discovery from `hasCorridor(brief) && specialists.some(readsFinds)`,
   so adding `lodging` to the reading set makes a re-plan that names `lodging`
   re-run it. Say what that costs.

   **Stop condition: how a town goes through the seam is not settled, and the
   builder does not choose.** `NearbyRequest.corridor` is a `Corridor`, "at least
   two points", in `agent/src/grounding.ts`, and a town is one point. Report the
   three options with the cost found in the code, and wait for the owner:
   - **(a) A degenerate corridor: the town's point twice**, or two points a few
     metres apart. No seam change, and the geometry already copes:
     `distanceToCorridorMetres` in `api/src/grounding/geometry.ts` handles a
     one-point corridor (`api/test/geometry.test.ts`, "a one-point corridor is the
     distance to that point"), `distanceToSegmentMetres` handles "a corridor whose
     two ends coincide" on purpose, and `overpassQuery` takes any number of points.
     The costs are the `Corridor` doc-comment ("at least two points"), which stops
     being true, and `Find.detourMinutes` ("on the way from one end of the corridor
     to the other"), which `detourCosts(origin, destination, …)` in
     `api/src/runs/discovery.ts` prices and which then means nothing for a town.
   - **(b) A sibling seam method**, a `nearby`-for-a-point on `GroundingProvider`
     with its own request type. Every implementer takes it: the fixture provider,
     the Overpass adapter and the cache, `RunGrounding` in `cache.ts` (the
     outcome-wrapped surface `discovery.ts` calls, which `test/live/run.ts` and
     three specs implement: `travel-measure`, `discovery-pass`,
     `discovery-prompt-bound`), and the six `GroundingProvider` doubles in
     `revisions`, `brief-edits`, `travel-pass` (2) and `grounding-cache` (2). The
     seam gets wider and the Log's call accounting gets a second shape. The gain is
     a request type that says what a town is, and it has a precedent:
     `articlesNear(NotabilityRequest)` is already a seam method that is "deliberately
     one point, not a corridor".
   - **(c) Widen `NearbyRequest` to accept either a corridor or a point.** One
     method, but every caller and adapter branches on a union.

   The builder's recommendation goes in the report with the counts from Build 1.

3. **Hand the finds to `lodging`.** Add `lodging` to `READS_FINDS` in
   `agent/src/prompt.ts` and give it the discovery block. The block today ends
   with "Use it only if it is genuinely worth this trip — an empty list above is not
   a gap to fill", which is the right sentence for `activities` and the wrong one for
   lodging, where a night's sleep is not optional. The block is rendered per
   specialist, so lodging's wording is its own, and the other three specialists'
   prompts are byte-identical to what they are today (a test).
4. **Rewrite `lodging`'s `role`.** The owner chose a fallback (question 2 (a)), so
   pl-58's sentence (a proposal names one premises or says plainly that it is a kind
   of place, with `place.name` holding the kind) stays, and the rewrite adds that
   the premises is chosen from the finds given when its town has any that fit, and
   that a kind of place is the fallback when its list is empty or nothing in it
   fits. This is the second change to the same string within a week; the Log
   quotes both. pl-58 edits the same string, so this builds on pl-58 merged
   (`depends_on`), not beside it.
5. **Hostile text.** A find's `name` and tags are a stranger's words, and a lodging
   find carries more of them than a viewpoint does (a `website`, a `phone`, a
   `description`). Keep the pl-29 caps (`MAX_FIND_NAME_CHARS`, `MAX_FIND_TAGS`,
   `MAX_FIND_TAG_CHARS`), never fetch a URL from a tag, and add a fixture lodging
   find whose `name` carries an instruction, asserted to reach `lodging`'s prompt
   as quoted data.
6. **Measure the join pl-36 said was missing.** First, at no cost: over the
   `activities` and `food` candidates in the sets B to D records already under
   `api/test/fixtures/live/`, count how many have a `place.name` equal to a find's
   `name` in the same record, after case and diacritic folding. That is the join's
   rate on a specialist that already reads finds. Then run the live harness,
   `run.ts`, on the pl-58 shape (the same five model and effort pairs, set A and
   `road-trip` sets B to D) with lodging finds in the prompt. `run.ts` builds sets
   B to D's finds offline from one captured reply and never calls a live Overpass,
   so lodging finds come the same way, from Build 1's checked-in capture, and set A
   stays without finds by design. Say which shapes that leaves unmeasured. Then
   count, over `lodging` candidates written in a run that was given at least one
   find, how many have a `place.name` equal to a find's `name`, on the same
   folding. The paid run is the owner's
   reserved decision on model families, efforts, runs and `--max-usd`, as pl-58's
   was, and the Log records the authorisation's date before the run starts. Do not
   add provenance on the strength of the count: pl-36 says what must be shown first,
   and a change is a new ticket.
7. **Re-measure with pl-57's harness.** Classify the new run's places by pl-57's
   committed rubric, by hand, with `invention.ts --after pl60-<date>`. **That label
   is refused as the harness stands:** on pl-58's branch `RUN_PATTERN` is
   `/^pl58-\d{4}-\d{2}-\d{2}$/`, and pl-58's own gate recorded that the next
   re-measure has to edit the harness. Widen the pattern, or generalise it to a
   `pl<n>-` prefix, as the harness change this step needs; the Log says which and
   its test (`api/test/invention-population.test.ts` covers the label), and the
   default run with no argument must still reproduce pl-57's record, checked as
   pl-58 checked it. Report `lodging`'s
   named-premises share on mentions and on places beside pl-58's 33 of 418 and 25
   of 162. Then web-check `lodging`'s named premises in pl-58's ordered-key
   procedure, up to 40 objects or all of them, and report the not-confirmed rate
   with a 95% Wilson interval beside pl-58's `lodging`-only count (which the Log
   computes from pl-58's `verdicts.json`, since pl-58 gives it only for both
   specialists together). WebSearch runs in a general-purpose agent, as in pl-57
   and pl-58.
8. **Edit `tools/planner/CLAUDE.md`, named here so the builder may.** Two
   adjacent paragraphs say which specialists read finds and how, and both change.
   In the rule "A specialist reads the brief, and only the brief": "plus, since
   pl-29, what a corridor discovery pass found nearby" and "`activities`, `food` and
   `conditions-and-gear` are handed `Find[]`". In the paragraph after it, headed
   "Grounding may propose and not only check": "it hands its finds to the three
   specialists above and stops there", and the paragraph's description of discovery
   as a corridor query. Reword those sentences to the set that ships and to the town
   pass beside the corridor pass. Add no new rule. The owner chose OSM, the source
   §5 names, so no `00-ANALYSIS.md` amendment is needed; add one only if the build
   finds §5 wrong, and say so in the Log.

## Decision — answered 2026-10-21 by the owner

Four questions were filed under `needs-decision`, each with its options, costs and
a recommendation. The owner answered all four on 2026-10-21, each time as the
builder's recommendation, through the orchestrator's question, with "leave open"
offered as an option every time. None had been settled on `main`: pl-29 chose
Overpass for corridor discovery, which is not a decision about lodging by town,
and pl-58 deferred the specificity field to "a later ticket only if the
re-measure justifies a scoped lookup".

**1. Which data source finds real lodging?** The grounding seam
(`GroundingProvider`) is where it is named in either case, in the one file §5
says holds deployment choices. Options:

- **(a) OSM through Overpass, pl-29's adapter extended, gated by Build 1's
  capture.** Costs: new query clauses and fixtures, no new vendor, no key, no
  bill per call, and the hostile-text defence already exists. Risks: coverage of
  lodging is unmeasured (fact 3 above), §5's own amendment warns that OSM is
  dense in Europe and the Saint Lawrence and sparse elsewhere, and the adapter's
  query is node-only today (Build 1). A thin town makes the plan look as good as a
  dense one unless `coverage` says otherwise.
- **(b) A paid places or search API.** Costs: a key, a per-call bill that
  `MAX_GROUNDING_CALLS` then has to count in money and not only in calls, a new
  vendor whose terms on storing results the builder must read before the fixtures
  are committed, and URLs and descriptions arriving in larger volume as hostile
  text. Gains: coverage and currency that OSM cannot promise.
- **(c) Both: OSM by default, a places API where a key is configured.** Gains: no
  bill unless an operator opts in, and a better source where OSM is thin. Costs:
  the most code and two sets of fixtures, for a feature whose coverage is not yet
  known.
- **(d) Leave open.**

**Chosen: (a), the builder's recommendation.** The seam makes (b) an adapter
added later, not a rewrite, and Build 1 puts a number on the one thing the choice
turns on before the prompt is touched. The owner set no zero-find threshold, so
Build 1 stops with its counts.

**2. May `lodging` still propose a kind of place when finds are thin, or must it
choose from finds?** Options:

- **(a) It may fall back to a kind of place when its town's list is empty or
  nothing in it fits.** Costs: a thin town keeps the unverifiable proposals that
  are 90.8% of mentions today, and code cannot tell a fallback from a choice
  except by name-matching (question 3). Gains: a plan never has a hole where a
  night should be.
- **(b) It must choose from finds, and a town with none yields no lodging
  candidate.** Gains: every lodging candidate would be a premises taken from map
  data, so the not-found class pl-58 measured on `lodging` (2 of its 5 not
  confirmed) would stop arising. Costs: a hole in the plan exactly where the map is
  thin, which is §5's "works better in Rome than in Nunavik" failure at the level of
  a night's sleep; and it needs a `PlanGap` or a `coverage` entry that names a
  town, where `coverage` names a corridor today, so it may be a contract change.
- **(c) A fallback only on an empty list, never when finds exist.** Gains: the
  simplest rule to test. Costs: a model that finds nothing fits in a non-empty
  list is forced into a bad choice.
- **(d) Leave open.**

**Chosen: (a), the builder's recommendation,** because the fallback degrades to
exactly today's behaviour and the remedy for the thin town is the coverage note,
which exists. If the note cannot name a town without a contract change, the
builder stops and says so: that is a contract question and not the builder's.
Option (b) was put to the owner with its gain stated.

**3. Does `@planner/contract`'s `Place` need a specificity field?** pl-58
deferred it, and `Place` today is `{name, locality, coordinates}`. Options:

- **(a) No field.** A lodging candidate that carries a find's coordinates and
  name is a premises by construction; any other is a kind of place or a fallback.
  Costs: code can tell them apart only by comparing names with finds, which pl-36
  says has never been scored. Gains: no contract change, no migration, no change to
  the four packages that read `Place`.
- **(b) Add a field to `Place` and `placeSchema`.** Costs: a contract change that
  every package reading `Place` follows, a stored-revision migration, and a
  decision on whether the model or the orchestrator sets the field (a model
  stating its own provenance is what pl-36 removed). Gains: a later existence or
  hours check knows which candidates it can look up.

**Chosen: (a), the builder's recommendation, for now,** with Build 6's join count
as the evidence that reopens it. A field the first consumer does not read is the
guess the root `CLAUDE.md` warns against; a later lookup ticket is the consumer.

**4. Is `food` in scope?** `food` already reads finds, and none of its finds can
be a restaurant (see _Why_). pl-58's record puts all three wrong-town objects on
`food`. Options:

- **(a) `lodging` only, and `food` as its own ticket if this one works.** Costs:
  the 3 of 5 measured defects that sit on `food` stay. Gains: one specialist and
  one set of tag clauses to measure, and lodging's finds are few per town.
- **(b) `lodging` and `food` together.** Costs: restaurants outnumber hotels in a
  town by a wide margin, so the prompt block and the call count grow in a way
  nothing has measured, and two specialists' changes confound one live run. Gains:
  reaches the other 3 of 5 defects.
- **(c) `food` only.** Gains: reaches the 3 wrong-town defects, the larger share
  of the measured ones. Costs: ignores the owner's choice of the lodging route, and
  leaves the 2 not-found campgrounds. Not recommended; listed so the mapping is not
  hidden.
- **(d) Leave open.**

**Chosen: (a), the builder's recommendation.** Questions 3 and 4 were asked as one
question with four combinations, plus "leave both open"; the owner chose lodging
only with no `Place` field. `food` is filed from this ticket's Log as its own
ticket if the route works, and is not folded in here.

## Done when

Worded for the owner's answers of 2026-10-21. A line that compares against a base
means the commit the build branches from, with pl-58 merged, and not `origin/main`
as it moves.

- `readsFinds` returns `true` for exactly four of the seven specialists,
  `activities`, `food`, `conditions-and-gear` and `lodging`, and `false` for
  `route-and-logistics`, `budget` and `practicalities`. The test is in
  `tools/planner/agent/test/`.
- The system prompts of `activities`, `food` and `conditions-and-gear`, built from
  one fixed brief and one fixed `Find[]`, are byte-identical to the same three
  prompts built at the build's base commit (the Log names its sha). A test pins
  them as a snapshot taken at that commit.
- Against a checked-in Overpass payload captured through the built `overpassQuery`
  for the towns Build 1 names, the lodging query returns the finds inside each
  town's radius and none outside it, offline, and returns a way or relation as a
  find with a coordinate from its `center` and a source URL of its own element
  type (`/way/<id>` or `/relation/<id>`, not `/node/<id>`). The Log gives the count of finds per town, including the zero towns,
  split by element type, and says whether the three Forillon campgrounds are among
  Gaspé's finds and as which element type.
- Build 2's stop condition is answered by the owner on this ticket, the Log
  records which of its three options for a town through the seam was chosen, and
  the grounding-call test below uses that shape.
- A lodging find whose `name` is an instruction reaches `lodging`'s prompt as
  quoted data and nothing in a find's tags is fetched. The test is in
  `tools/planner/agent/test/prompt.test.ts` or the discovery spec, whichever holds
  pl-29's equivalent.
- For each of pl-58's six set A shapes (`backcountry`, `city-and-culture`,
  `motorised-touring`, `multi-city`, `resort`, `road-trip`), a run under the
  scripted provider spends the number of grounding calls the Log asserts for that
  shape. The test asserts calls, not timing.
- With a scripted provider whose lodging query returns no finds, each of the six
  set A shapes produces the same days as the build's base commit does for the same
  brief and scripted model, byte-identical (a snapshot taken at that commit, as
  above), and the plan carries the coverage note question 2's answer relies on.
- The Log gives the live run's command, the families, efforts, runs and
  `--max-usd` the owner set, the authorisation's date, the measured cost, and the
  join count of Build 6 twice, as `matched of written`: over the `activities` and
  `food` candidates of the existing sets B to D records, and over the `lodging`
  candidates of the new run's sets B to D records.
- The Log gives `lodging`'s named-premises share on mentions and on places for
  the new run, beside pl-58's 33 of 418 and 25 of 162, on pl-57's rubric, with the
  population and files each counts, and `lodging`'s not-confirmed rate per object
  with its object count and a 95% Wilson interval, beside pl-58's `lodging`-only
  figure as the Log computes it.
- `invention.ts --after pl60-<date>` accepts a label of that form and refuses a
  malformed one (`api/test/invention-population.test.ts`), and the default run with
  no argument still exits 0 on `PLANNER_INVENTION_OFFLINE=1 PLANNER_INVENTION_CHECK=1`,
  its exit code taken without a pipe.
- The two paragraphs of `tools/planner/CLAUDE.md` Build 8 names name the set of
  specialists that ships and the town pass beside the corridor pass, and the diff to
  that file adds no new rule.
- `npm run check` exits 0 and `npm test -- --project planner` passes with the file
  and test counts the Log gives. The e2e suite and the image gate do not run
  locally; the Log says so rather than reporting them green.

## Review

**Gate: CONCERNS** — 2026-10-24 · `8a6dcf9a..55fd5df8` · Sonnet 5.5, depth full (hard) · a slice: Builds 1–5, four rows `unproven (scope)`

Pull request #607, `gh pr checks 607` read once at head `55fd5df8`: every check `pass` (`check`, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `e2e`, `docker`, `codeql`, `CodeQL`, `dependency-review`, `changes`). `55fd5df8` differs from `8098626c`, the sha the Log's checks name, by the ticket file only.

| Done when                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `readsFinds` is true for exactly four of seven                                                         | `agent/test/prompt.test.ts` › "readsFinds is true for exactly activities, food, conditions-and-gear and lodging" ✓ (asserts the sorted four and `false` for the other three)                                                                                                                                                                                                                                         |
| 2. Three corridor readers' prompts byte-identical to the base                                             | `agent/test/prompt.test.ts` › "the %s prompt is byte-identical to the base commit's, with and without places to sleep in the finds" ✓. I regenerated `pl60-base-prompts.json` at `8a6dcf9a`: `cmp` exit 0. A planted change showing lodging finds to `activities`, `food`, `conditions-and-gear` failed that test each time (1 failed of 30)                                                                         |
| 3. Lodging query over a checked-in payload; ways and relations at `center` with their own type in the URL | `api/test/grounding-valhalla.test.ts` › "the capture answers the query this adapter builds, for each of the nine towns", "%s: the finds inside the radius, by element type, and none outside it", "a way or a relation is a find, at its center, with a source url of its own type" ✓. The Log's counts and the campground claim: I confirmed the three Forillon campgrounds are in Forillon's reply and not Gaspé's |
| 4. Build 2's stop condition answered and the test uses the shape                                          | Log entry of 2026-10-24 records the owner's option (b); `api/test/lodging-run.test.ts` › "%s spends the calls pl-60's Log asserts" counts `nearbyPoint` apart from `nearby` ✓                                                                                                                                                                                                                                        |
| 5. An instruction in a find's name reaches lodging's prompt as quoted data; no tag is fetched             | `agent/test/prompt.test.ts` › "a lodging find whose name is an instruction reaches lodging's prompt as quoted data, after the warning" ✓; `api/test/grounding-valhalla.test.ts` › "nothing in a find's tags is fetched: one request per call, to Overpass" ✓                                                                                                                                                         |
| 6. Each set A shape spends the calls the Log asserts                                                      | `api/test/lodging-run.test.ts` › "%s spends the calls pl-60's Log asserts" ✓. The Log's "Base" column is measured here, not derived: I ran the six shapes at `8a6dcf9a` and got 14, 11, 6, 13, 4, 16 calls, equal to the Log's column, and equal per method to the branch's counts minus the town pass                                                                                                               |
| 7. No-find scripted provider gives the base's days, byte for byte, and the coverage note                  | `api/test/lodging-run.test.ts` › "%s: the days are byte-identical to the base commit's, and the plan names the towns it could not check" ✓ (days compared to `pl60-base-days.json`, `coverage` compared exactly). I regenerated the days file at `8a6dcf9a`: `cmp` exit 0. A planted change to one item's note failed all six                                                                                        |
| 8. Live run's command, cost, join counts in the Log                                                       | **unproven (scope)** — Build 6, not built; the dispatch scopes this slice to Builds 1–5                                                                                                                                                                                                                                                                                                                              |
| 9. Named-premises share and web-checked rate in the Log                                                   | **unproven (scope)** — Builds 6–7, not built                                                                                                                                                                                                                                                                                                                                                                         |
| 10. `invention.ts --after pl60-<date>`                                                                    | **unproven (scope)** — Build 7, not built                                                                                                                                                                                                                                                                                                                                                                            |
| 11. The two `tools/planner/CLAUDE.md` paragraphs                                                          | **unproven (scope)** — Build 8, not built                                                                                                                                                                                                                                                                                                                                                                            |
| 12. `npm run check` exits 0; planner project passes; e2e and image gate not claimed locally               | `check`, `test (ubuntu-latest)`, `e2e` and `docker` all `pass` at `55fd5df8`. The Log cites 81 files and 1644 tests at `8098626c`; I did not re-run the whole project locally (the api project, 36 files and 835 tests, ran once under a mutation: exit 0)                                                                                                                                                           |

- **med** · no `Done when` line depends on it · **Towns past the cap vanish with no coverage entry.** `lodgingTowns` in `api/src/runs/lodging.ts` takes `[...mustSee, destination].slice(0, 4)`, and nothing names what was cut. A road trip with six `mustSee` stops and a destination: located `["S1","S2","S3","S4"]`, and the coverage list has no sentence about S5, S6 or the destination. The module header says the note names every town "that came back with nothing, could not be found or was never asked about"; a town cut by the cap was never asked about and is not named. The destination is last in the list, so it is the first dropped. `mustSee` allows 20 notes, so the condition occurs. Two remedies, open decision, recommend (a): (a) a coverage sentence naming the towns beyond the cap; (b) reword the header to say overflow is silent and put the destination first. Probe: `zz-gate-towns.test.ts`, case 3.
- **med** · no `Done when` line depends on it · **The town query's budget claim is asserted by nothing.** `CachingGroundingProvider.#nearbyPoint` in `api/src/grounding/cache.ts` claims one call or refuses with `REFUSED`; `grounding-cache.test.ts` only has `nearbyPoint` doubles. Planted: the claim deleted from `#nearbyPoint` (`if (spend !== null && !spend.budget.claim())` replaced by `if (false as boolean)`). Result: `npx vitest run --project planner tools/planner/api` exit 0, 36 files and 835 of 835 tests pass. `lodging-run.test.ts` counts calls beneath the cache, which the mutation does not change, and `lodging-pass.test.ts` uses a double that returns `REFUSED`. The Log's "never spends more than 8 of 40" is unasserted.
- **low** · **A second town reached through already-claimed finds is reported as empty.** `discoverLodging` drops finds the first town kept, then counts `kept.length === 0` as "nothing". `["Percé", "Percé, Québec"]` both located at one point, one shared motel: finds `["Motel du Rocher"]`, and coverage "No places to stay around Percé, Québec are on the map." Same for two towns whose finds all overlap (case 6a). The sentence is false (the map has them) in the safe direction, and costs a second town's two calls. `lodging-pass.test.ts` › "a premises two towns both reach is handed over once" asserts the finds and not the coverage. Needs a town with ten or fewer finds, all shared. Probe cases 5a and 6a.
- **low** · **The lodging-only re-plan test does not pin the coverage it claims to.** `api/test/revisions.test.ts` › "naming only lodging re-runs both passes (pl-60), and the revision carries what they found" asserts `nearbyCalls` 1 and `nearbyPointCalls` 1 exactly, which is the new cost, but its coverage line is `not.toEqual(base.coverage)`. Planted: `revise.ts` appending the base's coverage to the new entries. Result: `revisions.test.ts`, 1 failed of 33, and the failure is the sibling "naming food on a corridor brief" test; the lodging-only test passed. Real code replaces, and I measured the list: one town sentence, nothing duplicated. No live defect.
- **low** · **A test title says something false.** `agent/test/prompt.test.ts` › "lodging with no places to sleep has no block, so its prompt is the one it had before pl-60": Build 4 appended two sentences to `lodging`'s `role`, so its prompt is not the base's. The body compares two head prompts. False text in the safe direction; nothing relies on it.
- **low** · no live call site · **`findFrom`'s `/copyright` fallback is also lodging's dedupe key.** `identity()` in `lodging.ts` uses the first source URL, so any two finds whose element has no `type` or a non-numeric `id` collide across towns. The same change moves the corridor pass's URL for a typeless element from `/node/<id>` to `/copyright`. All 657 elements of `overpass-nearby.json` have `type: "node"`, and Overpass always sends `type` and `id`.
- **dropped** · `kindOf`'s new precedence changing the corridor pass: 657 elements of `overpass-nearby.json`, each through the real adapter's `nearby` at base and at head with the four `DISCOVERY_KINDS`: 0 differ (276 kept at both). The corridor pass always asks all four, so the asked set equals the old "all". Not a defect.
- **dropped** · a destination equal to the origin is asked about (case 2). The module says the origin "is left out" and the code only never adds `brief.origin`; keeping a destination that happens to be the origin is a product choice.
- **dropped** · a stop name carrying an instruction reaches the coverage sentence, cut to 60 characters (case 8). It is the traveller's own text, `coverage` is in no prompt (grep over `agent/src`), and the 500-character bound is tested.
- **dropped** · a failed town query reads "nothing on the map". The Log states it as the corridor pass's rule, and the 406 behind it is pl-61 (#608).
- **findings** · the hunt returned 10; 6 carried (2 med, 4 low), 4 dropped.
- NFR: security ✓ (source URL host fixed, type allowlisted: 27 hostile elements in `hostile-elements.json` never left `openstreetmap.org`; the odd ids `-5`, `1.5`, `1e+21` give display-only links, and no code fetches a find's URL) · performance — the town pass is serial, up to four queries at a 30 s client deadline each, wall time on a live Overpass unmeasured (Build 6) · reliability — above (budget claim, silent cap) · maintainability ✓.

### Gate 2

**Gate: PASS** — 2026-10-24 · round `55fd5df8..2a3aa467` (base `a99bde49`; the merge of `main` touches no `tools/planner/` file and is not the round) · Sonnet 5.5, depth full · nothing in the round is a `high`

Pull request #607, `gh pr checks 607` read once, head `2a3aa467`: `check` (both), `test (ubuntu-latest)`, `test (windows-latest, informational)`, `e2e`, `docker`, `codeql`, `CodeQL`, `dependency-review`, `changes` all `pass`.

**Gate 1's six findings**

| Finding                                                                          | Verdict   | How verified                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 med, towns past the cap vanish                                                | **fixed** | Gate 1's town probe, case 3, on the new head: coverage is now "Places to stay around S5, S6 and Dest were not looked up: this plan asks about at most 4 towns, the stops it names first." `lodging-pass.test.ts` › "towns past the cap are named, so a stop the pass never asked about is not silent" and "twenty towns past the cap are counted rather than listed, inside the contract's bound" |
| F2 med, town query's budget claim unasserted                                     | **fixed** | Gate 1's `#nearbyPoint` mutation (claim replaced by `if (false as boolean)`) on the new head: 3 failed of 81 in `grounding-cache.test.ts` (2) and `lodging-pass.test.ts` (1, "over the real cache and budget, the pass claims at most 8 calls however many towns a brief names"); unmutated, 102 of 102                                                                                           |
| F3 low, a second town reached through claimed finds reported empty               | **fixed** | Probe cases 5a and 6a: coverage `[]` in both; finds unchanged. `lodging-pass.test.ts` › "a town whose finds were all handed over for an earlier town is not reported as having none"                                                                                                                                                                                                              |
| F4 low, lodging-only re-plan test does not pin coverage                          | **fixed** | Gate 1's `revise.ts` append mutation: 2 failed of 33 in `revisions.test.ts`, and the lodging-only test is one of them (gate 1: it passed). The test now asserts the exact coverage list                                                                                                                                                                                                           |
| F5 low, a test title said something false                                        | **fixed** | `prompt.test.ts` title reworded to what its body compares; body unchanged                                                                                                                                                                                                                                                                                                                         |
| F6 low, `/copyright` fallback is lodging's dedupe key and moved the corridor URL | **fixed** | Gate 1's 27 hostile elements through the built adapter's corridor `nearby`: every typeless or invalid-type element is `/node/7`, base's URL; through `nearbyPoint` they are still `/copyright`. `identity()` falls back to name and position unless the URL names an element; `lodging-pass.test.ts` › "two finds with no element url are two finds, not one, even across towns"                  |

**Done when**

| #   | Line                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–7 | as gate 1                                                   | proven at gate 1. The round edited `lodging.ts`, `valhalla.ts` and the specs; at the new head `lodging-run.test.ts` (calls, byte-identical days), `prompt.test.ts` (byte-identical corridor prompts), `lodging-pass.test.ts`, `grounding-valhalla.test.ts`, `grounding-cache.test.ts`, `revisions.test.ts`, `invention-population.test.ts`: 7 files, 286 of 286, exit 0 |
| 8   | Live run's command, cost, both joins in the Log             | **verified** — the Log's table sums to $7.2134 and its records to 110 (23+25+25+18+19 files on disk). My own join script: 333 of 360 over 80 records (Haiku 225/225, Opus 55/66, Sonnet 53/69); 8 of 1,165 over 163 records before the run; 12 of 606 for the run's `activities` and `food`. Authorisation dated 2026-10-24 is in the Log                               |
| 9   | Named-premises share, not-confirmed rate and pl-58's figure | **verified** — 301 of 443 (67.9%) and 17 of 76 recomputed from the committed classification and records; 2 of 9, Wilson 6.3–54.7, recomputed; pl-58's 2 of 19 interval (2.9–31.4) recomputed. See the low finding on the sensitivity band                                                                                                                               |
| 10  | `invention.ts --after pl60-<date>`                          | **proven** — `invention-population.test.ts` › "--after pl60-<date> is accepted, and its files are the run's own" and the `test.each` that refuses a malformed label; default run, `--after pl58-2026-10-21` and `--after pl60-2026-10-24` each exit 0 with `PLANNER_INVENTION_OFFLINE=1 PLANNER_INVENTION_CHECK=1`, read from a file, not a pipe                        |
| 11  | The `CLAUDE.md` paragraphs add no new rule                  | **verified** — the diff re-words three paragraphs (the owner's answer widened the brief's two) and adds no imperative sentence; the rules-file paragraph adds one clause to an existing exception; the contract diff is 13 changed lines, 0 outside comments                                                                                                            |
| 12  | `npm run check` and the planner project                     | **proven (CI)** — `check` and `test (ubuntu-latest)` pass at `2a3aa467`; `e2e` and `docker` also pass. I did not run `npm run check` or the whole planner project locally                                                                                                                                                                                               |

- **low** · no `Done when` line depends on it · **The Log's "judgement cases a reader may reverse" omits `manoir de percé|percé`, and its sensitivity band understates the downside.** The key carries 36 of `lodging`'s 301 named mentions with no edge tag; it is a locality plus a category noun, the shape of the rubric's `locality-plus-category` case that the Log moved the three campgrounds under. Reversed alone: 265 of 443 (59.8%). Reversed with the Auberge internationale's two keys, which the Log does list: 218 of 443 (49.2%), below the Log's stated 57.3%. The liberal end is the Log's 75.4%. The direction does not move: pl-58 is 33 of 418 (7.9%). The falsehood runs in the safe direction (a reader sees a narrower band than exists, and "a majority" survives the Log's band but not the double reversal). Reproduction: `compare.mjs` and `sample.mjs` below, the mention counts in `lodging-named.json`.
- **dropped** · a corridor element with an explicit `way` type now links `/way/<id>` where base wrote `/node/<id>`: no live call site, the corridor query asks nodes only (by the new comment in `valhalla.ts`; I did not read the query itself).
- **dropped** · the claim, as the dispatch states it, that set B's stopping point equals pl-58's: the rule (`activities` plus `food` candidates, 100 or 15 runs) is unchanged by the round and the corridor finds shown are equal in all 80 sets B to D records, but per-record candidate counts differ by live sampling (equal in 18 of 60 set B records). Read as the rule, it holds.
- **findings** · the hunt returned 3 new (1 carried, 2 dropped); gate 1's six are verdicts above and are not counted again.
- NFR: security ✓ (no credential in 113 added files: `grep -ril` printed nothing, exit 1, and found a planted `x-api-key` line in a control copy) · performance n/a (the town pass's cost was gate 1's; the live run's wall time was not re-measured) · reliability ✓ (budget claim now asserted) · maintainability ✓.

## Log

**2026-10-21 — Filed (builder, Sonnet 5.5), on the owner's decision of the same
day,** at the orchestrator's dispatch. `node scripts/next-id.mjs pl` printed `next
free: pl-60`. Docs only; no source changed.

- **Re-read, not relayed.** Every figure in _Why_ was read from
  `git show origin/pl-58-name-a-premises:tools/planner/docs/work/pl-58-specific-lodging-food-proposals.md`
  at `6fc01891`, the branch head when it was read (the gate found `fce56408` at
  filing time; round 1 re-cites from that, see below). The brief's "OSM / pl-56's geocoder had rows for 9 of the 51
  stratum keys and located 3" is true of pl-58's Log, and reads like a coverage
  rate it is not: pl-58 says pl-56 "read 9 of these 51 keys only (it read pl-57's
  places)", so the 42 without a row were never sent. The ticket says so in _Why_,
  fact 3.
- **Two facts the brief did not carry, both checked.** `DISCOVERY_KINDS` has four
  members and no lodging kind, so `food` is handed finds that cannot name a
  restaurant. And the five not-confirmed objects split 3 `food`, 2 `lodging` in
  pl-58's record, which changes what question 4 costs. The mapping was read with
  a scratch script on the record's `rows[].specialists`, not stated in pl-58's Log.
- **Settled on `main`, and cited.** Provenance for a candidate written from a find
  is `model-asserted`, permanently, per pl-36 (`orchestrator.ts`'s `accept`
  doc-comment). pl-29 chose Overpass over `osm2pgsql` for corridors. Neither
  settles lodging by town, so questions 1 and 3 are open.
- **Difficulty `hard`, rated for the work once answered.** The query shape changes
  from a line to a point, the pass's gate (`hasCorridor`) changes, `lodging`'s
  `role` is rewritten a second time, a rule in `tools/planner/CLAUDE.md` changes,
  and the re-measure is a paid live run followed by a hand classification and a
  web check. Question 3 option (b) would add a contract change.
- **Folded in: nothing.** The roadmap's Phase 3 text about existence stops at
  pl-57 and does not mention pl-58, so there is no line that points at pl-58's
  outcome to complete. Writing pl-58's result into the roadmap belongs in pl-58's
  own landing, and writing pl-60 there before pl-58 merges would cite a measurement
  that is not on `main`.
- **A stale premise found while reading.** `accept`'s doc-comment in
  `agent/src/orchestrator.ts` says no run in this repo has been captured with
  `finds` in it. `run.ts` records `finds` for sets B to D (pl-40, `serializeFinds`),
  so the comment predates the records. It is source, so this filing leaves it; Build
  6 uses the fact, and whoever builds this ticket may correct the comment in the
  same change.
- **Checks at filing**, in the worktree after the farm, a hand link of
  `node_modules/@webtools/ui` and `npm run build`: `npm run status -- --show pl-60`
  prints `needs-decision`, `difficulty hard`, `blocked by pl-58 (ready)`.
  `npm run status -- --json` exits 0. `npm run check` exits 0.
  `npx vitest run scripts/test/status.test.ts`: 139 passed (139).
  `node scripts/commit-message.mjs --text` on the title: exit 0.
  `node scripts/preflight.mjs --only mergeTree,ciCommands,review,title --base
origin/main`: exit 0, with `main` merged in at `aaccab20` first.
- **No `## Review` section.** A filing has no work to review, and a gate on the
  filing is recorded outside `## Review` (`docs/01-TICKETS.md`, _The review gate_).

**2026-10-21 — Round 1: the owner's answers, and the filing gate's seven findings
(builder, Sonnet 5.5).** The narrow gate on `2631db40` returned CONCERNS (1 med, 6
low). Its report is on PR #600. `status` moves from `needs-decision` to `ready` in
this commit, with the owner's answers (_Decision — answered_), as
`docs/01-TICKETS.md` says. `difficulty` stays `hard`: the answers narrowed the
options and left the seam shape, the area-aware query and the harness change in.

- **F1, med, a node-only query — reproduced and fixed in the Build.**
  `grep -n 'node\[\|out body' tools/planner/api/src/grounding/valhalla.ts` prints
  line 1212 (`` `  node[${KIND_FILTERS[kind]}](${around});` ``) and line 1213
  (`out body;`), and the parser reads `element.lat` (line 1450). Build 1 now names
  the node-only shape, has the capture ask for `nwr` with `out center tags` from a
  scratch script, splits the counts by element type, and notes the parser change.
  Not measured: how Forillon's campgrounds are mapped; no Overpass query was run.
- **F2, low, Build 8 and the `Done when` line — fixed.** `tools/planner/CLAUDE.md`
  has the rule at "A specialist reads the brief, and only the brief" and the
  sentence "it hands its finds to the three specialists above" in the next paragraph,
  "Grounding may propose and not only check". Build 8 names both paragraphs and the
  sentences in each; the `Done when` line asks that the diff add no new rule instead
  of "say nothing else new".
- **F3, low, the run label — fixed.** `git show
origin/pl-58-name-a-premises:tools/planner/api/test/live/invention.ts | grep -n
RUN_PATTERN` prints `121: export const RUN_PATTERN = /^pl58-\d{4}-\d{2}-\d{2}$/;`.
  Build 7 says so and the Packages line lists the harness. A `Done when` line grades
  the new label.
- **F4, low, a town is one point and the seam takes a line — fixed as a stop
  condition, not a choice.** `Corridor` is `readonly Coordinates[]` with "at least two
  points" in its doc-comment. Build 2 gives three options (a degenerate corridor, a
  sibling method, a widened request) and stops the builder for the owner. Packages
  lists `grounding.ts`. **The orchestrator asked for this to be reported.**
- **F5, low, the sha — fixed.** _Why_ cites PR #593 and the branch, names `fce56408`
  as the head read with the caveat that it stops resolving at squash-merge, and
  writes the figures out.
- **F6, low, "`origin/main`" moves — fixed.** Two `Done when` lines compare
  against the build's base commit, with pl-58 merged, as a snapshot.
- **F7, low, uneven options — fixed.** Question 2 (b) now states its gain, the
  not-found class stopping, in the first position of the option. Question 1 (c) and
  question 4 (c), the other two options that listed costs only, each now state a
  gain. Question 1 gained option (d) and question 4 gained (d), "leave
  open", as the owner was offered.
- **Checks at round 1:** `npm run status -- --show pl-60` prints `ready`,
  `blocked by pl-58 (ready)`. `npm run status -- --json` exits 0, taken without a
  pipe. `npm run check` exits 0. `npx oxfmt --check` on this file is clean.
- **Not done:** the owner's wording for questions 3 and 4 as asked (one question,
  four combinations) is recorded in the answered section as relayed by the
  orchestrator, and the options listed under each are the builder's own, not a
  transcript of what the owner saw.

**2026-10-21 — Landing (fixer, Sonnet 5.5).** Gate 2 (narrow, `a5338498`) returned
PASS with five new lows. The owner chose, the same day, to fix the four fully
stated ones at the landing without a re-gate, and N3 stays as recorded. Both gates'
full reports are comments on PR #600, which is where the records live: this filing
has no `## Review` section and no `--land`.

- 2026-10-21 — Fixed at landing by owner choice: gate 2, N1 — "A way's find would
  link to a node. `findFrom` in `api/src/grounding/valhalla.ts` builds the source as
  `https://www.openstreetmap.org/node/${String(id)}`." Build 1 now names the source
  URL taken from the element's `type` beside `center`, and `Done when` 3's way clause
  asks for `/way/<id>` or `/relation/<id>`, not `/node/<id>`.
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "/way/<id>"` → 2 (0 at the gate's
  head); `grep -n 'openstreetmap.org/node' tools/planner/api/src/grounding/valhalla.ts`
  prints line 1469, the hard-coded `node`, as the gate states.
- 2026-10-21 — Fixed at landing by owner choice: gate 2, N2 — "The brief never says
  that `Done when` 3's checked-in payload must be re-captured through the built
  `overpassQuery`." Build 1 and `Done when` 3 now say it.
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "through the built \`overpassQuery\`"`→ 2 (0 at the gate's head);`overpassQuery`'s doc-comment, `valhalla.ts` lines
  1197–1198, says it is exported so a capture builds "the _exact_ query this adapter
  sends".
- 2026-10-21 — Fixed at landing by owner choice: gate 2, N4 — "Build 2's option
  costs are uneven against the code … The step says 'Report both options' and then
  lists three." Option (a) now states that `distanceToCorridorMetres` and
  `distanceToSegmentMetres` already cope (`api/test/geometry.test.ts`, "a one-point
  corridor is the distance to that point") and names the real costs, the `Corridor`
  doc-comment and `Find.detourMinutes` via `detourCosts`. Option (b) now names
  `RunGrounding`, its four implementers, the six `GroundingProvider` doubles and the
  `articlesNear` precedent. The step says "the three options".
  `awk '/^## Log/{exit} {print}' <ticket> | grep -c "Report both"` → 0 (1 at the
  gate's head). Checked against the code: `grep -n "implements GroundingProvider"`
  on `revisions`, `brief-edits`, `travel-pass` and `grounding-cache` under
  `tools/planner/api/test/` prints 1, 1, 2 and 2 classes (6); `RunGrounding` is
  typed in `test/live/run.ts`, `discovery-pass`, `discovery-prompt-bound` and
  `travel-measure`.
- 2026-10-21 — Fixed at landing by owner choice: gate 2, N5 — "_Why_ says pl-58's Log
  'was read as the branch stood at `fce56408`'. The Log's 'Re-read, not relayed' says
  it was read 'at `6fc01891`, the branch head when it was read'." _Why_ now cites
  `6fc01891` and its commit time, `git show -s --format='%h %cI' 6fc01891` → `6fc01891
2026-10-21T01:53:14+00:00` (it was `fce56408`, 02:14Z). The filing Log's "Re-read,
  not relayed" entry and round 1's F5 entry are history and stay as written: they
  say `fce56408` was the head at filing time, which is the gate's reading, and the
  figures are the same at both (gate 1's diff of the two moves only `withoutParks`,
  which this ticket does not cite).
- **Not fixed, as the owner chose:** N3, the area form conditional in Build 1 and
  unconditional in `Done when` 3, stays recorded in gate 2's report.

**2026-10-24 — Intake answer: how far the first dispatch goes (orchestrator,
relayed to the builder).** Question (orchestrator, 2026-10-24): "How far should the
first builder-hard dispatch go before it comes back to you?" Options: (1) Build 1
and price the seam — capture, commit the counts, read the cost of Build 2's seam
options (a), (b), (c) from the code with no seam code written, then stop
(recommended); (2) Build 1 only, as written; (3) do not start pl-60. **Chosen by
the owner: option 1, the orchestrator's recommendation.** It widens Build 1's
"stop after this step" by the costing only. No prompt, role, specialist or seam
code is written under it.

**2026-10-24 — Build 1: the capture, and Build 2's seam priced (builder, Opus
5.5).** Branched from `8a6dcf9a` (`origin/main`, pl-58 merged as #593). Stopped
here, as Build 1 and the intake answer say. The scratch scripts and every raw reply
are in the dispatch's scratch directory, under `build/` and `build/raw/`. No
payload is checked in: `Done when` 3's payload is re-captured through the built
`overpassQuery` once Build 2 has changed it.

- **The towns: 9 distinct `place.locality` values, from 23 `lodging` candidates.**
  Read from `candidatesAccepted` (`specialist === "lodging"`, every one
  `kind: "at"`) of `set-a-road-trip.json` in each of the five
  `claude-*-pl58-2026-10-21/` directories: haiku high 4, haiku low 4, haiku
  medium 3, opus low 6, sonnet low 6. No `lodging` candidate was rejected. The
  localities, with mentions: Gaspé 8, Percé 6, Forillon National Park 2,
  Rivière-du-Loup 2, Amqui 1, Bonaventure 1, Carleton-sur-Mer 1, Gaspésie 1,
  Matane 1. Two are not towns: `Gaspésie` is the peninsula, and `Forillon National
Park` a park.
- **Each town's point** came from one Nominatim search per town (`q=<locality>, Québec`,
  `limit=1`, an identifying user agent, 1.5 s apart). Seven are the town's
  `boundary=administrative` relation. Forillon is `boundary=national_park`
  (relation 1603116), and Gaspésie is `natural=peninsula` (relation 15597971), whose
  point is inland at 48.615, −66.067. **`Bonaventure, Québec` came back as a
  railway station in Montréal** (node 7052605738, 600 km away). It was re-asked
  as `Bonaventure, Gaspésie, Québec`, which returned the village (relation
  8271759, 48.045, −65.493). A town pass that geocodes a bare locality inherits
  pl-37's ambiguity problem. `locate`'s `chooseResult` exists for that problem, and this
  capture did not go through it.
- **The tag set** is `tourism=` `hotel`, `motel`, `guest_house`, `hostel`,
  `chalet`, `apartment`, `camp_site`, `caravan_site`. **It was not read from the OSM wiki:
  `wiki.openstreetmap.org` is unreachable from this container** (curl timed out
  after 20 s; WebFetch `ECONNREFUSED`). It was taken instead from iD's tagging presets,
  `openstreetmap/id-tagging-schema` `data/presets/tourism/<value>.json` on GitHub.
  Their `geometry` field is the editor's own "used on": all eight are
  `["point","area"]`, and `camp_site` and `caravan_site` add `vertex`. Rejected:
  `alpine_hut` and `wilderness_hut` (backcountry shelters, unstaffed or
  hut-booked, not a premises a road-trip party books; captured anyway and counted
  apart, 0 to 3 per town at 25 km), `camp_pitch` (a pitch inside a `camp_site`, so
  it would count one campground many times; not queried), and anything outside
  `tourism=*` (`building=hotel` names a building and not a use).
- **The query** came from `build/capture.mjs` and not through the seam: one
  `nwr["tourism"="<value>"](around:25000,<lat>,<lon>);` clause per value, then
  `out center tags;`, `[timeout:80]`. It was captured once at 25 km per town and counted
  offline by haversine distance from the town's point at 2, 6, 10 and 25 km. 6 km
  is `DISCOVERY_RADIUS_METRES`, the corridor pass's radius. A find is counted as
  `findFrom` would keep it: a coordinate (`lat`/`lon`, or `center` for a way or a
  relation) and a non-empty `name`.
- **Queries made: 11 to Overpass and 10 to Nominatim**, serial, no retries.
  Overpass: 9 for the capture (one per town, 5 s apart, all HTTP 200 in 11.3 to
  30.1 s, no `remark`), and 2 for the adapter probe below. Nominatim: 9, plus the
  Bonaventure re-ask.
- **Lodging finds per town, by element type (`n`ode, `w`ay, `r`elation):**

  | Town                   | 2 km            | 6 km             | 10 km            | 25 km              |
  | ---------------------- | --------------- | ---------------- | ---------------- | ------------------ |
  | Amqui                  | 4 (n3 w1 r0)    | 6 (n3 w3 r0)     | 8 (n4 w4 r0)     | 30 (n10 w20 r0)    |
  | Bonaventure            | 4 (n2 w2 r0)    | 6 (n4 w2 r0)     | 8 (n5 w3 r0)     | 18 (n9 w9 r0)      |
  | Carleton-sur-Mer       | 5 (n4 w1 r0)    | 7 (n5 w2 r0)     | 8 (n6 w2 r0)     | 24 (n9 w14 r1)     |
  | Forillon National Park | 1 (n1 w0 r0)    | 8 (n6 w2 r0)     | 17 (n9 w6 r2)    | 46 (n25 w18 r3)    |
  | Gaspé                  | 7 (n3 w3 r1)    | 9 (n3 w5 r1)     | 24 (n16 w7 r1)   | 47 (n27 w17 r3)    |
  | Gaspésie (peninsula)   | 0               | 0                | 0                | 0                  |
  | Matane                 | 7 (n0 w7 r0)    | 13 (n2 w11 r0)   | 14 (n2 w11 r1)   | 25 (n9 w15 r1)     |
  | Percé                  | 29 (n4 w24 r1)  | 37 (n9 w27 r1)   | 40 (n12 w27 r1)  | 47 (n13 w33 r1)    |
  | Rivière-du-Loup        | 8 (n6 w2 r0)    | 18 (n14 w4 r0)   | 22 (n17 w5 r0)   | 39 (n31 w8 r0)     |
  | **All 9**              | 65 (n23 w40 r2) | 104 (n46 w56 r2) | 141 (n71 w65 r5) | 276 (n133 w134 r9) |

  **There is one zero town at every radius, and it is the peninsula**: `Gaspésie`'s point
  had 2 elements within 25 km, a nameless lodging element and a hut. Every
  locality that is a town had at least 4 finds at 2 km and 6 at 6 km. Unnamed lodging
  elements, which `findFrom` drops, were 0 to 5 per town at 6 km and up to 23 at
  25 km (Rivière-du-Loup).

- **The area form is not optional.** At 6 km, 58 of the 104 finds (55.8%) are ways
  or relations, and at 2 km 42 of 65 (64.6%) are. A node-only clause would have
  returned 46 at 6 km, and none of Matane's 7 at 2 km. The measurement settles
  gate 2's N3 (the area form conditional in Build 1 and unconditional in `Done when` 3):
  the build keeps the area form, so it needs both the parser's `center` read and the
  type-derived source URL.
- **The three Forillon campgrounds Parks Canada names are all in OSM, as
  `tourism=camp_site`, and all are areas:** `Camping Petit-Gaspé`, way 1013617284;
  `Camping Des-Rosiers`, relation 3009120; and `Campig Cap-Bon-Ami` (sic),
  relation 3007267. **They are among Gaspé's finds only at 25 km**: their centres
  are 16.8, 19.1 and 19.1 km from Gaspé's point, so none is a Gaspé find at 2, 6 or
  10 km. From Forillon National Park's point they are 8.5, 9.2 and 9.9 km away: finds at
  10 km and not at 6. A node-only query finds none of them at any radius.
  So whether a candidate that says `Forillon National Park campground` reaches them
  turns on the town pass's radius, and on whether the pass asks about the park,
  which is not a town. Both are Build 2's to settle.
- **The public instance refuses the adapter as it stands.**
  `#overpassJson` sends only `content-type: text/plain`, and Node 22.23.3's
  `fetch` fills in `user-agent: node` (measured against a local server,
  `build/ua-echo.mjs`). The probe built `ValhallaGroundingProvider` from `dist`,
  pointed it at `https://overpass-api.de/api`, and called `nearby` with Gaspé's point twice and
  `["viewpoint"]`. It got **HTTP 406 in 0.45 s**, raised as `UNREACHABLE` with
  `details: { status: 406 }`. The identical `overpassQuery` text, sent with an
  identifying user agent, got HTTP 200 in 12.8 s with 3 elements
  (`build/probe.mts`, `build/raw/probe.json`). So the header is the cause, and
  the public instance accepts the built query, including Build 2 option (a)'s
  `around:` with the same point twice. Not fixed here, as the dispatch said. It touches
  no deployment that follows `.env.example`, which points `OVERPASS_URL` at a
  self-hosted instance. It does not block `Done when` 3 either: that re-capture needs
  the built query's text, not the adapter's `fetch`. But a deployment whose `OVERPASS_URL` is the public instance
  discovers nothing on any run, and by design `discovery.ts`'s `nearby` turns that
  `UNREACHABLE` into the "very little on the map" coverage sentence. pl-33's
  latency figures, "with the query the adapter really sends", were not re-checked.
- **Which of the nine towns a brief names before `lodging` runs** (an input to
  Build 2, which decides where the towns come from): the set A `road-trip` brief
  leaves from `Montréal, Québec`, goes to `Gaspésie`, and its `mustSee` is
  `Percé Rock, Forillon National Park`. **14 of the 23 mentions are in towns no
  brief field names**: Gaspé 8, Rivière-du-Loup 2, and Amqui, Bonaventure,
  Carleton-sur-Mer and Matane 1 each. The 9 the brief does reach are Percé 6
  (through `Percé Rock`), Forillon 2 and Gaspésie 1. `locate` would decline
  `Gaspésie` (`peninsula` is deliberately absent from `SETTLEMENT_ADDRESS_TYPES`).
  Not measured: whether it locates `Percé Rock` or `Forillon National Park`.

**Build 2's stop condition, priced from the code; no seam code was written.** Some work
is shared by all three options and does not separate them: a lodging `DiscoveryKind`, its
`KIND_FILTERS` clauses and `kindOf`; the `nwr` and `out center` query; `findFrom`
reading `center` and taking its URL from `type`; the town pass in `discovery.ts`
and its wiring in `orchestrator.ts` and `revise.ts`; and inverting
`revisions.test.ts`'s "naming only lodging never asks" test, which pins the
re-plan cost the Build says to state. The counts below come from `grep -rn "implements
GroundingProvider"`, `grep -rn "RunGrounding\b"`, `grep -rn "request\.corridor"`
and `grep -rn "corridor:"` over `tools/planner/{agent,api}/{src,test}`:

- **(a) A degenerate corridor.** None of the 9 `GroundingProvider` implementers or the
  5 `RunGrounding` implementers changes, and no `NearbyRequest` literal does. Two
  doc-comments in `agent/src/grounding.ts` stop being true (`Corridor`, "at least
  two points"; `Find.detourMinutes`, "from one end of the corridor to the other"),
  and a town find's `detourMinutes` gains a third meaning of `null`. Overpass
  accepts the doubled point (the probe above). There is also a cost the ticket did not name:
  the corridor pass and the town pass share one method and one counter. So
  `revisions.test.ts`'s `RecordingGrounding.nearbyCalls` (asserted `1` and `0`) and
  `discovery-pass.test.ts`'s `nearbyCalled` count both passes, and `Done when` 6's
  per-shape call test has to tell them apart by inspecting a request's geometry.
- **(b) A sibling method.** 14 implementers, as the ticket lists them, in 11 files,
  plus the two interfaces (`agent/src/grounding.ts`, and `cache.ts`, which also
  holds two of the implementers): 12 files. Each implementer takes the method: the 9
  `GroundingProvider`s (`FixtureGroundingProvider`, `CachingGroundingProvider`,
  `ValhallaGroundingProvider`, and the 6 test doubles: `brief-edits` 1,
  `revisions` 1, `travel-pass` 2, `grounding-cache` 2) and the 5 `RunGrounding`s
  (`CachingGroundingProvider.forRun` and the literals in `test/live/run.ts`,
  `discovery-pass`, `discovery-prompt-bound` and `travel-measure`; the spreads in
  `travel-measure` take theirs from the literal). Each double's body is a line or
  two (`return []`, or a throw). `nearby` is uncached, so the cache table and its
  `kind` column are untouched. Gains: a request type that says what a town is, a
  separate call count per pass, and `articlesNear` as the precedent.
- **(c) Widen `NearbyRequest`.** It is cheaper than the ticket says if the union is
  additive (`{ corridor } | { point }`, with `corridor` kept). Then **one** reader branches,
  `ValhallaGroundingProvider.nearby`, which reads `request.corridor` twice (the
  query and the `distanceToCorridorMetres` re-filter), and the 19 existing
  `NearbyRequest` literals (1 in `discovery.ts`, 16 in `grounding-valhalla.test.ts`,
  1 each in `discovery-pass` and `discovery-prompt-bound`) compile unchanged. A
  discriminated union with a renamed field touches all 19. Either way it keeps
  (a)'s one method and one counter.
- **Builder's recommendation: (b).** The capture says the town pass is worth
  building: 8 of 9 localities have finds at every radius, and the zero is a
  peninsula. Its finds behave differently from a corridor's: no detour, a radius
  chosen per town, and half of them areas. (b) is the only option where a test,
  a log line or the `Done when` 6 call count can see which pass spent a call
  without inspecting coordinates. Its cost is mechanical: 12 files, most of them
  one-line doubles. (c), additive, is the cheaper fallback with honest types.

**Open decisions, for the owner (not settled here):** the zero-find counts above,
which Build 1 reports because no threshold was set, and Build 2's seam option. The
radius a town pass asks with is content, like `DISCOVERY_RADIUS_METRES`, and
Build 2 argues it in the Log. The table gives its cost: Forillon's campgrounds
are 16.8 to 19.1 km from Gaspé's point.

- **Folded in: nothing.** The filing Log offered this ticket's builder the stale `accept` doc-comment in
  `agent/src/orchestrator.ts` (no run "has been captured with `finds` in it"), but
  fixing it is a source edit. This branch is docs-only and titled `docs(planner):`,
  and a `.ts` path would change what its title may say. The fix belongs with Build 6,
  which uses the fact. The adapter's missing user agent is a one-line change
  beside `locate`'s `USER_AGENT`. It is held back because the dispatch says a 406 is a
  finding for this stop, not a fix.
- **Checks:** `npx oxfmt` on this file, `npm run check`, and preflight's fast
  checks; the dispatch's report carries their results. No test was added, so no
  spec ran.

**2026-10-24 — The owner's answers to Build 1's four open decisions (relayed by
the orchestrator to the builder, the same day).** The owner answered all four on
2026-10-24, through the orchestrator's question. This answers Build 2's stop
condition (`Done when` 4).

1. **The zero-find counts (Build 1's stop).** Options: (1) proceed to Build 2 on
   this capture; (2) set a threshold and first capture towns from the other five
   set A shapes; (3) stop pl-60. **Chosen: (1)**, the builder's recommendation.
2. **How a town goes through the seam (Build 2's stop condition).** Options: (b) a
   sibling `nearby`-for-a-point method on `GroundingProvider`; (c) widen
   `NearbyRequest` additively, keeping `corridor`; (a) a degenerate corridor, the
   town's point twice. **Chosen: (b)**, the builder's recommendation.
3. **The town pass's radius.** Options: 10 km; 6 km, the corridor's
   `DISCOVERY_RADIUS_METRES`; the builder proposes one; 25 km. **Chosen: 10 km**,
   by the owner directly; the builder had recommended none. At 10 km Build 1's
   capture gives 141 finds over the 9 localities, Gaspé 24 and Percé 40, and
   Forillon's three campgrounds are reached from the park's point and not from
   Gaspé's.
4. **The adapter's missing Overpass user agent.** Options: (1) file a defect
   ticket; (2) fold it into Build 2; (3) leave it. **Chosen: (1)**, the builder's
   recommendation. The orchestrator files it separately, so this branch does not
   change the user agent. The checked-in payload is still captured through the
   built `overpassQuery` text, sent from a capture script with an identifying user
   agent.

**2026-10-24 — Builds 2 to 5 (builder, Opus 5.5). Stopped before Build 6's paid
run, as the dispatch says.** The base is `8a6dcf9a`. The baselines that two
`Done when` lines compare against were written in commit `9356f7b5`, whose source is
the base's (`git diff --stat 8a6dcf9a b7075060` touches this file only), by scratch
scripts that are not committed and that nothing in the suite re-runs:
`agent/test/fixtures/pl60-base-prompts.json` holds the three corridor readers'
prompts, built from `agent/dist` with `pl60-prompt-inputs.json`.
`api/test/fixtures/pl60-base-days.json` holds the six set A drafts' days. Two
writes of the days file were byte-identical (`cmp`).

- **Build 2, the seam: option (b), as the owner chose.** `NearbyPointRequest`
  (`point`, `radiusMetres`, `kinds`) and `GroundingProvider.nearbyPoint` are in
  `agent/src/grounding.ts`, and `RunGrounding.nearbyPoint` is in `cache.ts`; it is
  uncached and budgeted, as `nearby` is. **The costing was exact.** With the method
  added and nothing else, `npx tsc --build tsconfig.tests.json` failed on 14
  implementers: the 6 test doubles, the 4 `RunGrounding` literals,
  `CachingGroundingProvider` and its `forRun`, and the two source providers. Each
  double gained a line or two. The lodging kinds are a second list, `LODGING_KINDS`,
  beside `DISCOVERY_KINDS`, which stays the corridor's four; `DiscoveryKind` is
  their union. Their eight `tourism=*` values are Build 1's set.
- **The adapter.** `overpassPointQuery` emits `nwr[<filter>](around:R,lat,lon)` and
  `out center tags`. `nearbyPoint` re-filters every find by haversine distance from
  the point. The corridor's `overpassQuery` keeps its node-only shape: changing what
  it asks for would change pl-29's finds, which nothing here measures. `findFrom`
  reads `center` when an element has no `lat`/`lon`, and takes the url path from the
  element's `type` (`node`, `way` or `relation`; anything else gets the copyright
  page). **One defect the brief did not name, fixed in the same change:** `kindOf`
  used to return the first kind whose tags matched among all kinds, so a hotel in a
  listed building (`tourism=hotel`, `historic=*`) would have come back from a town
  query as a `historic-site`. It now chooses only among the kinds the request asked
  for, with the old precedence (`grounding-valhalla.test.ts`, "a hotel in a listed
  building is a hotel to a town query, never a historic site").
- **Where the towns come from (Build 2's proposal, argued here).** `lodgingTowns` in
  the new `api/src/runs/lodging.ts` takes the brief's named stops first (a road
  trip's `mustSee`, a multi-city trip's `cities`), then its destination. It
  deduplicates case-insensitively and keeps at most `MAX_LODGING_TOWNS` = 4. The
  origin is left out, because it is where the party sets off from and not where it
  sleeps. Those fields are the only stops a brief knows before `lodging` runs. Build
  1 measured what they miss: 14 of the 23 set A road-trip mentions are in towns no
  field names, and those keep the kind-of-place fallback. Per town, the pass makes
  one `locate` and, if the town is located, one `nearbyPoint` at
  `LODGING_RADIUS_METRES` = 10 000 (the owner's). It keeps the
  `MAX_LODGING_FINDS_PER_TOWN` = 10 closest finds and de-duplicates across towns by
  source url. Both caps are the builder's, and are content. Ten is 10 of Percé's 40,
  so four towns hand `lodging` at most the 40 a corridor may hand a specialist.
- **Calls per brief shape** (`api/test/lodging-run.test.ts`, "%s spends the calls
  pl-60's Log asserts"). These are real runs on the fixture grounding default: calls
  reaching the provider beneath the cache, by method. The town pass's own calls are
  its `nearbyPoint`s plus the `locate`s it adds. A destination the corridor pass
  already located is a cache hit. A name nobody could locate is not cached, so it is
  asked again.

  | Shape             | locate | travel | nearby | nearbyPoint | Total | Town pass's own                                       | Base |
  | ----------------- | ------ | ------ | ------ | ----------- | ----- | ----------------------------------------------------- | ---- |
  | road-trip         | 15     | 1      | 0      | 2           | 18    | 4 (`Percé Rock`, `Forillon National Park`; 2 queries) | 14   |
  | backcountry       | 9      | 1      | 1      | 1           | 12    | 1 (1 query; its locate was a hit)                     | 11   |
  | motorised-touring | 5      | 1      | 0      | 0           | 6     | 0 (no town)                                           | 6    |
  | city-and-culture  | 11     | 1      | 1      | 1           | 14    | 1                                                     | 13   |
  | resort            | 3      | 1      | 0      | 0           | 4     | 0 (no town)                                           | 4    |
  | multi-city        | 19     | 1      | 0      | 3           | 23    | 7 (4 locates, `Central Europe` a miss; 3 queries)     | 16   |

  `articlesNear` was 0 everywhere: the fixture corridor finds nothing to back. The
  base column is the total minus the town pass, read off the per-call log of a
  scratch dump, which is in the dispatch's scratch directory. It is not a
  measurement at the base commit. The pass never spends more than `2 ×
MAX_LODGING_TOWNS` = 8 of `MAX_GROUNDING_CALLS`.

- **Re-plans.** `revise.ts` now re-runs discovery when the re-plan names any finds
  reader and the brief has a corridor or a town, and it re-runs **both** passes.
  Re-running one pass alone would have to carry the base's coverage entries for the
  other, and nothing in a stored `UncheckedConstraint` says which pass wrote it. The
  cost is that a re-plan naming only `lodging` re-asks the corridor for nothing it
  reads: up to 4 calls, plus up to 6 geosearch tiles and the reading lookups. A
  re-plan naming only `food` re-asks up to 8 town calls in the same way.
  `revisions.test.ts`'s "naming only lodging never asks" test asserted the old
  behaviour, and is now "naming only lodging re-runs both passes (pl-60)":
  `nearbyCalls` 1 and `nearbyPointCalls` 1.
- **The coverage note (question 2's remedy).** It needs no contract change, because
  `detail` is free text. One sentence per outcome names its towns, each name cut to
  60 characters, so four 500-character names stay inside `MAX_UNCHECKED_DETAIL_CHARS`
  (`lodging-pass.test.ts`, "a long town name is cut"):
  - could not be found: "Where … is/are could not be found on the map, so places
    to stay there were not checked."
  - nothing found: "No places to stay around … are on the map. Somewhere to stay
    there may exist without this plan having found it."
  - refused: "Places to stay around … were never looked up: the run had already used
    the number of lookups it is allowed."
  - no town at all: "This trip names no town to stay in, so the map was not checked
    for places to stay."

  A failed town query (a 406, say) reads as "nothing found", the corridor pass's
  rule. With the fixture default, each of the six set A drafts has the same days as
  the base, byte for byte, and carries its note (`lodging-run.test.ts`, "%s: the days
  are byte-identical to the base commit's, and the plan names the towns it could not
  check").

- **`Done when` 3's payload**, `api/test/fixtures/overpass-lodging-towns.json`. It
  holds one verbatim reply per Build 1 town, each to the exact text
  `overpassPointQuery(point, 10_000, LODGING_KINDS, 28)` builds from `api/dist`
  (`[timeout:28]` is what `nearbyPoint` derives from the default 30 s
  `GROUNDING_DISCOVERY_TIMEOUT_MS`). The replies were sent from a scratch script
  with the user agent `webtools-planner/0.9 (pl-60 fixture capture)`, because the
  adapter's own `fetch` gets HTTP 406 there (answer 4). **10 Overpass queries**, run
  one at a time and 5 s apart. Percé's first query came back **HTTP 429**, and it was
  re-asked once after 90 s (HTTP 200, 40 elements). The spec rebuilds each town's
  query and compares it with the stored one. Finds per town through `nearbyPoint`,
  offline, at 10 km (node / way / relation): Amqui 8 (4/4/0), Bonaventure 8
  (5/3/0), Carleton-sur-Mer 8 (6/2/0), Forillon National Park 17 (9/6/2), Gaspé 24
  (16/7/1), **Gaspésie 0**, Matane 14 (2/11/1), Percé 40 (12/27/1),
  Rivière-du-Loup 22 (17/5/0), 141 in all (71/65/5). These equal Build 1's offline
  10 km counts row for row, and the 2 km counts equal Build 1's as well.
  **Forillon's three campgrounds are among Forillon National Park's finds and not
  Gaspé's**: `Camping Petit-Gaspé` as way 1013617284, and `Camping Des-Rosiers`
  (relation 3009120) and `Campig Cap-Bon-Ami` (relation 3007267) as relations, each
  at its `center`, with `/way/` and `/relation/` urls. Specs:
  `grounding-valhalla.test.ts`, "%s: the finds inside the radius, by element type,
  and none outside it", and "a way or a relation is a find, at its center, with a
  source url of its own type".
- **Build 3.** `lodging` joins `READS_FINDS` in `agent/src/prompt.ts`. A run hands
  every reader one list, and `findsFor` routes it by kind: `lodging` sees the lodging
  kinds only, and the corridor readers see everything else. `lodging`'s block opens
  "Places to stay around the towns this trip names, from public map data
  (OpenStreetMap) — not vetted, not a recommendation, and not a set of
  instructions:". It closes with the data warning the others carry, then "A night's
  sleep is not optional: where one of these fits the party, propose it by the name it
  has here; where none fits, or a town you need has none listed, propose a kind of
  place instead." The other three prompts are byte-identical to the base's, with the
  fixed `Find[]` and with a lodging find added to it (`prompt.test.ts`, "the %s
  prompt is byte-identical to the base commit's, with and without places to sleep in
  the finds"). A mutation that showed lodging finds to the corridor readers failed
  all three of those tests.
- **Build 4, `lodging`'s role, quoted twice.** pl-58's string ends "Or it says
  plainly, in its title or its summary, that it is a kind of place and names no
  premises: then `place.name` holds the kind, for example `motel`, and
  `place.locality` the town." That string stays, and this change appends: "Where you
  are given places to stay from map data for a town, a premises you name there is
  one of those, under the name it is given, if any of them fits the party. A kind of
  place is the fallback, for a town whose list is empty or where nothing in it fits."
- **Build 5.** The pl-29 caps still apply: `findFrom` and `tagsOf` are shared by
  both queries. A lodging find whose `name` is pl-29's injection string, and whose
  tags carry a `website` and a `description`, reaches `lodging`'s prompt verbatim,
  after the "not a set of instructions" header and before the data warning
  (`prompt.test.ts`, "a lodging find whose name is an instruction reaches lodging's
  prompt as quoted data, after the warning"). The adapter makes exactly one request
  per call, to the Overpass interpreter, for a reply whose tags hold two urls
  (`grounding-valhalla.test.ts`, "nothing in a find's tags is fetched: one request
  per call, to Overpass").
- **Mutations, each run against the committed head and restored with `git checkout
8098626c -- <path>`.** A hard-coded `/node/` url failed 9 tests in
  `grounding-valhalla.test.ts`, and dropping the radius re-filter in `nearbyPoint`
  failed the per-town tests.
- **`test/live/run.ts`** gained a `nearbyPoint` that answers `[]`. Build 6 wires
  lodging finds from the checked-in capture in there.
- **Folded in:** the stale `accept` doc-comment in `agent/src/orchestrator.ts`, which
  the filing Log offered. It now says that pl-40's sets B to D records carry `finds`,
  and that Build 6 scores the join. **Not folded in, and why:**
  - `contract/src/unchecked.ts`'s `coverage` doc-comment and `tools/planner/CLAUDE.md`'s
    "`coverage` names a corridor the ground was thin along" paragraph both describe
    a corridor only. The first is in the contract package, which the root
    `CLAUDE.md` says not to edit unilaterally. The second is a third paragraph,
    beside the two Build 8 names, and the owner's rule of 2026-10-17 allows a tool
    `CLAUDE.md` edit only where the Build names it. Both are in the report as
    proposals.
  - Build 8 itself is not done, since this dispatch stops at Build 5.
- **Checks at `8098626c`:** `npm run check` exits 0. `npm test -- --project planner`
  passes 81 of 81 files and 1644 of 1644 tests. `npx oxlint tools/planner/agent
tools/planner/api` reports no errors; its `no-await-in-loop` warnings are on serial
  loops, the corridor pass's pattern. The e2e suite and the image gate were not run
  locally.

**2026-10-24 — The owner's answers after gate 1 (relayed by the orchestrator to the
builder, the same day).** Gate 1 returned CONCERNS on `55fd5df8` (2 med, 4 low); its
report is in the dispatch's scratch directory, and its findings are fixed in this
round.

1. **The remedy for towns past the cap.** Options: (a) a coverage sentence names the
   towns beyond the cap, with the cap (4) and the order (stops, then destination)
   unchanged; (a) with the destination moved first; (b) overflow stays silent, with the
   destination first. **Chosen: (a)**, gate 1's recommendation.
2. **Which of gate 1's findings to fix in this round.** Options: all six; the two meds
   only; none. **Chosen: all six**, the orchestrator's recommendation.
3. **Build 6's paid-run shape.** Options:
   - (a) mirror pl-58: Haiku 5.5 `low`, `medium` and `high`, Sonnet 5.5 `low`, Opus 5.5
     `low`, over `run.ts`'s sets A to D. About 112 records, estimated at $7.4–7.8, with
     `--max-usd` split per session under a $10 total bound;
   - (b) drop Opus: about 94 records, about $3.1, bound $5;
   - (c) Sonnet and Opus only: about 37 records, about $6.9, bound $10.

   **Chosen: (a)**, the builder's recommendation. **This is the paid run's
   authorisation, dated 2026-10-24.** The run itself waits for a key: none is on this
   machine (`stat /home/pwuser/.planner-live-key`: "No such file or directory",
   2026-10-24).

4. **The corridor-only descriptions of `coverage`.** Options: reword both in Build 8
   (the comment in `contract/src/unchecked.ts`, a comment only, and the third
   `tools/planner/CLAUDE.md` paragraph); `CLAUDE.md` only; leave both. **Chosen: reword
   both**, the builder's recommendation. This authorises a comment-only edit to
   `tools/planner/contract/src/unchecked.ts`, with no type, schema or export changed.
   The paragraph that begins "**`coverage` names a corridor the ground was thin
   along**" joins Build 8's two. Build 8's "the diff to that file adds no new rule"
   binds all three.

**2026-10-24 — Round 1: gate 1's six findings, Build 7's harness label, Build 8, and
Build 6's preparation (builder, Opus 5.5). Stopped before the paid run, which
waits for a key.** Each finding was reproduced before it was fixed: the new test
failed against `55fd5df8`'s code. Each mutation below was run against `2aef6e2e`
(the fixes) or `7d64b049` (the label), one at a time, and restored with
`git checkout <sha> -- <path>`, using a scratch script that is not committed
(`mutations.sh`).

- **F1 (med), towns past the cap.** `discoverLodging` now names every town past
  `MAX_LODGING_TOWNS` in one sentence: "Places to stay around … were not looked up:
  this plan asks about at most 4 towns, the stops it names first." The sentence names
  four of them and counts the rest ("… and 13 more"), so twenty stops stay inside the
  500-character bound. The cap and the order are unchanged (answer 1). Tests in
  `lodging-pass.test.ts`: "towns past the cap are named, so a stop the pass never
  asked about is not silent", and "twenty towns past the cap are counted rather than
  listed, inside the contract's bound". Mutation: the overflow loop deleted, which
  failed both.
- **F2 (med), the town query's budget claim.** The code was right and nothing
  asserted it. In `grounding-cache.test.ts`, "claims one call when asked, and is
  refused, reaching nothing, once the budget is spent" and "is never cached: the
  same town asked twice is two calls". In `lodging-pass.test.ts`, "over the real
  cache and budget, the pass claims at most 8 calls however many towns a brief
  names", which runs seven towns against `CachingGroundingProvider` and
  `groundingBudget(40)` and finds 8 claimed.
  - Gate 1's mutation (`if (spend !== null && !spend.budget.claim())` replaced by
    `if (false as boolean)` in `#nearbyPoint`) failed both cache tests.
  - Deleting the cap (`const towns = named;`) failed the 8-call test.
- **F3 (low), a town reached through finds an earlier town claimed.** The sentence
  now follows what the map answered, not what remained after de-duplication. Test:
  "a town whose finds were all handed over for an earlier town is not reported as
  having none" (`Percé` and `Percé, Québec`, one shared motel: coverage `[]`).
  Mutation: `answer.length` put back to `kept.length`, which failed it.
- **F4 (low), the lodging-only re-plan's coverage.** `revisions.test.ts`'s "naming
  only lodging re-runs both passes" now pins the list exactly: the one town
  sentence, and none of the base's. Gate 1's mutation, `revise.ts` appending the
  base's coverage, now fails both re-plan tests; before, it failed only the `food`
  one.
- **F5 (low), a false test title.** It is now "lodging with no places to sleep has
  no block: its prompt is the one it gets with no finds at all". That is a text
  change only, with no mutation.
- **F6 (low), the copyright fallback.**
  - `identity()` in `lodging.ts` treats a source url as a find's identity only
    when it names an element (`/node|way|relation/<id>`). Otherwise it uses name
    and position.
  - `findFrom` takes the type an element with no usable `type` must be: `"node"`
    for the corridor query, so its urls are the base's again, and `null` for the
    town query.
  - Tests: `lodging-pass.test.ts`'s "two finds with no element url are two finds,
    not one, even across towns", and `grounding-valhalla.test.ts`'s "an element
    with no type links as a node from the corridor query, as before pl-60, and to
    nothing from a town query".
  - Mutations: `identity` taking any url failed the first test, and the corridor
    passing `null` failed the second.
- **Build 7, the harness label (`Done when` 10).** `RUN_PATTERN` in
  `test/live/invention.ts` is generalised to `^pl([1-9]\d*)-(\d{4}-\d{2}-\d{2})$`
  rather than widened to `pl58|pl60`. The new `runLabel` reads the ticket and the
  date from the label, and the record's `ticket` is now the label's own
  (`pl-${string}`) where it was a fixed `"pl-58"`.
  - Tests in `invention-population.test.ts`: "--after pl60-<date> is accepted,
    and its files are the run's own", "a malformed label, %s, is refused" (eight
    labels, among them `pl-60-…`, `pl060-…`, `PL60-…` and `pl60-2026-1-24`), "the
    record names the label's own ticket, read from its directories alone", and the
    existing "a label without the -pl<n>- shape is refused".
  - Mutation: the pattern put back to `pl(58)-`, which failed two of them.
  - Run directly, never through a pipe, from a script that writes each exit code
    to a file (`invention-check.sh`):
    - `PLANNER_INVENTION_OFFLINE=1 PLANNER_INVENTION_CHECK=1 node --import tsx
tools/planner/api/test/live/invention.ts`: exit 0, "check: the committed
      record equals its regeneration; every sampled place has a verdict".
    - The same with `--after pl58-2026-10-21`: exit 0, the same line, so pl-58's
      record still regenerates.
    - With `--after pl-60-2026-10-24`: exit 1, "--after takes a label like
      pl60-2026-10-24, got pl-60-2026-10-24".
- **Build 8 (`Done when` 11).** Three paragraphs of `tools/planner/CLAUDE.md` now
  name the four readers and the town pass beside the corridor pass:
  - "A specialist reads the brief, and only the brief": `activities`, `food` and
    `conditions-and-gear` read the corridor pass's finds; `lodging` reads the town
    pass's.
  - "Grounding may propose and not only check": both queries, and the four
    specialists.
  - "`coverage` names a corridor the ground was thin along": now "… or a town the
    map had nowhere to sleep in".

  No rule was added: `grep -c '^\*\*'` counts 25 rule paragraphs before and after,
  and the only bold-led line the diff changes is the `coverage` one. The comment on
  `coverage` in `contract/src/unchecked.ts` gained a paragraph on towns, and two
  phrases now say "corridor or town". `git diff -U0` on that file changes no line
  outside a comment.

- **Build 6, preparation only.**
  - `test/live/run.ts`'s `lodgingFinds` gives sets B to D's `lodging` the places to
    stay from `overpass-lodging-towns.json`, offline, through
    `ValhallaGroundingProvider.nearbyPoint` and `discoverLodging`, with its own
    `locate`: `Percé Rock` stands in Percé, and `Forillon National Park` and
    `Gaspésie` stand in their own captures. The corridor's finds and its stand-in
    `locate` are untouched, so sets B to D's corridor finds are pl-58's.
  - Set B's stopping rule still counts `activities` and `food` candidates only
    (`FINDS_READERS` in `run.ts`), so lodging joining `readsFinds` does not change
    when set B stops.
  - The wrapper, `run-pl60.mjs`, is pl-58's `run-pl58.mjs` with the label
    `pl60-<date>`. Its five pairs, per-session caps (1, 1, 1, 5 and 10) and prices
    are pl-58's. It refuses a total above $10 and refuses a session directory that
    exists. It is in the dispatch's scratch directory, not committed, as pl-58's was.
  - **Dry run** under the scripted provider into scratch:
    `node run-pl60.mjs 2026-10-24 - <scratch>/dry/live <scratch>/dry/logs 10`, exit 0.
    Five sessions, each exit 0, 25 records and $0.0000 observed; "all five sessions
    done, observed $0.0000 of $10". A second invocation threw "… exists already;
    run.ts would overwrite it".
  - In the Opus session's records, every set B, C and D record carries 20 lodging
    finds (Percé's 10 and Forillon's 10; Gaspésie has none) beside its 40 corridor
    finds. All 20 are in `lodging`'s prompt, under its own block, and none is in
    `activities`'. Set A carries no finds. `lodging`'s set B prompt is 6,941
    characters against 2,499 for set A's `road-trip`, about 1.1k tokens more, which
    is inside the estimate behind answer 3.
  - **Not done:** the paid run (no key on this machine), the hand classification
    of its records, and the web check, which runs in a separate general-purpose
    agent, as in pl-58.
- **Checks at `e036ef77`:** `npm run check` exits 0. `npm test -- --project planner`
  passes 81 of 81 files and 1662 of 1662 tests. The later commits are
  `test/live/run.ts`, which `npm run check` typechecks, and this Log.

**2026-10-24 — The owner's answers for the paid run (relayed by the orchestrator to
the builder, the same day).**

5. **The key.** The owner placed it at `/home/pwuser/.planner-live-key` on 2026-10-24.
   The orchestrator checked it with `stat` (mode 600, 106 bytes, owner `pwuser`) and
   did not read it. The builder did not read it either: it is passed by path to the
   wrapper, which hands it to each child's environment.
6. **The rules file.** Question: should pl-60 reword
   `.claude/rules/planner-unchecked-constraints.md`'s `coverage` paragraph, which still
   says "a thin corridor"? Options: (a) reword it in pl-60; (b) leave it; (c) file it
   separately. **Chosen: (a)**, the builder's recommendation, under Build 8's bound
   that the diff adds no new rule.

**2026-10-24 — Build 6, the live run; Build 7, the re-measure; and the web check's
pre-registration (builder, Opus 5.5).** The authorisation is answer 3 above (shape (a),
dated 2026-10-24, a $10 total bound).

- **The rules file (answer 6).** In `.claude/rules/planner-unchecked-constraints.md`,
  "A thin corridor is not a function of the brief" now reads "A thin corridor, or a
  town the map had nowhere to sleep in (pl-60), is not a function of the brief". That
  is one line removed and two added (`git diff -U0`). `grep -c '^\*\*'` counts 5
  bold-led lines before and 5 after, so no rule was added.
- **The run.** It was started at 03:40Z (its first session's log was created at
  03:40:18Z, and its exit file was written at 04:07:56Z) from the worktree with
  `setsid nohup`, pid
  237458 (also its process group), through a scratch launcher (`launch-live.sh`). The
  command was `node run-pl60.mjs 2026-10-24 /home/pwuser/.planner-live-key
tools/planner/api/test/fixtures/live <scratch>/live-logs 10`. The key reached only
  the children's environment, and nothing printed or logged it. The wrapper exited
  0, every session exited 0, and the spend stop never tripped. The run date is the
  run's real date (03:39Z, 2026-10-24 UTC).

  | Session (`fixtures/live/`)                | `--max-usd` | Records | A   | B                       | C   | D   | Observed |
  | ----------------------------------------- | ----------- | ------- | --- | ----------------------- | --- | --- | -------- |
  | `claude-haiku-5-5-low-pl60-2026-10-24`    | 1.00        | 25      | 6   | 15 (cap, 65 candidates) | 3   | 1   | $0.1558  |
  | `claude-haiku-5-5-medium-pl60-2026-10-24` | 1.00        | 25      | 6   | 15 (cap, 84)            | 3   | 1   | $0.1836  |
  | `claude-haiku-5-5-high-pl60-2026-10-24`   | 1.00        | 23      | 6   | 13 (106)                | 3   | 1   | $0.2348  |
  | `claude-sonnet-5-5-low-pl60-2026-10-24`   | 5.00        | 19      | 6   | 9 (105)                 | 3   | 1   | $2.2501  |
  | `claude-opus-5-5-low-pl60-2026-10-24`     | 7.18        | 18      | 6   | 8 (104)                 | 3   | 1   | $4.3891  |

  **Total: 110 records, $7.2134 observed against the $10 bound**, inside the
  $7.4–7.8 estimate's lower side (pl-58: 112 records, $7.08). Set B's candidates are
  `activities` plus `food`, set B's stopping rule. `servedModels` equals the requested
  model in every record (`sessions.mjs`).

- **Credentials.** `grep -ril -E 'sk-ant|x-api-key|authorization'` over the five
  directories (110 files) printed nothing (exit 1). The same command over a planted
  control file (`{"headers":{"x-api-key":"planted"}}`) printed it (exit 0). Records
  committed at `5d835d32`.
- **The join, `matched of written`** (`join.mjs`: a candidate matches when any
  `place.name` equals a find's `name` in the same record, after NFD diacritic and case
  folding; sets B to D records that carry finds):
  - Over the `activities` and `food` candidates of the existing records, the ten
    directories before pl-60 (pl-40/pl-57's five and pl-58's five), compared with the
    corridor finds they were shown: **8 of 1,165**, over 163 records. Every match is a
    Québec City landmark (`Observatoire de la Capitale` 5, `Plaines d'Abraham` 2,
    `Porte Saint-Louis` 1). The new run's `activities` and `food` gave 12 of 606, the
    same three names.
  - Over the new run's `lodging` candidates in sets B to D, compared with the lodging
    finds they were shown: **333 of 360**, over 80 records. By family: Haiku 225 of 225,
    Opus 55 of 66, Sonnet 53 of 69.
  - pl-36's join, scored at last: a specialist that reads corridor finds almost never
    writes one by name (0.7%), and `lodging` reading town finds almost always does
    (92.5%). **Provenance is not changed on this count.** pl-36 says what must be shown
    first, and a change is a new ticket.
- **The hand classification.** `invention/pl60-2026-10-24/classification.json` copies
  pl-57's rubric object byte for byte. The new run has 700 places, through
  `collectPlaces`.
  - **334 carried** with their class and tags: 289 from pl-58's file and 45 found only
    in pl-57's.
  - **366 new, classified by hand.** I read each `name|locality`, its use (`at` or
    `between`) and its specialists, with no web lookup, and followed pl-57's and
    pl-58's own cases for the same strings (looked up with `lookup.mjs`). One line per
    key is in the scratch `classify/assign.txt`. New: 76 `named-premises`, 227
    `kind-of-place`, 37 `settlement-or-area`, 26 `route-or-transit`.
  - **One carried park key was re-judged by the park rules:** `forillon national
park|gaspé peninsula, québec` is only a `between` endpoint in this run, so
    `settlement-or-area` with `park-area`.
  - Totals: 207 `named-premises`, 351 `kind-of-place`, 102 `settlement-or-area`, 40
    `route-or-transit`.
  - **Judgement cases a reader may reverse.** The three campgrounds the run named from
    finds (`camping parc nature gaspé|gaspé` 16 lodging mentions, `camping de la baie de
percé|percé` 9, `camping baie de gaspé|gaspé` 8) are `kind-of-place` with
    `locality-plus-category`, because each name restates its locality plus a category,
    the rubric's own `Camping de Carleton-sur-Mer` case. `auberge internationale de
forillon|gaspé` (43, plus 4 under `gaspé (cap-aux-os)`) is `named-premises`,
    because Forillon is not the candidate's locality, the way pl-58 took `camping
des-rosiers|forillon national park`. `central market (centralna tržnica)|ljubljana`
    is `named-premises`, because it carries the established Slovene name; pl-58 took the
    bare `central market|ljubljana` as a kind.
    `manoir de percé|percé` (36 lodging mentions, no edge tag) is `named-premises`
    too, though it is a locality plus a category noun, the shape of the rubric's
    `locality-plus-category` case that the three campgrounds were moved under; a
    reader may reverse it. (Added at landing, below.)
- **The re-measure** (`PLANNER_LIVE_RUN=1 node --import tsx
tools/planner/api/test/live/invention.ts --after pl60-2026-10-24`, which makes no
  request). The after population is the new run's 110 records alone: 700 places and
  2,693 mentions, by the same rubric. The before population is pl-58's, read from its
  Log:

  |                          | pl-58 (mentions)  | **pl-60 (mentions)**   | pl-58 (places)    | pl-60 (places)    |
  | ------------------------ | ----------------- | ---------------------- | ----------------- | ----------------- |
  | `lodging` named-premises | 33 of 418 (7.9%)  | **301 of 443 (67.9%)** | 25 of 162 (15.4%) | 17 of 76 (22.4%)  |
  | `food` named-premises    | 43 of 407 (10.6%) | 41 of 395 (10.4%)      | 26 of 186 (14.0%) | 30 of 170 (17.6%) |
  - **Split by set** (`sensitivity.mts`, the same keys and classes). The rise is
    entirely where finds were given:
    - pl-60: set A, which has no finds by design, **1 of 83 (1.2%)**; sets B to D,
      which have finds, **300 of 360 (83.3%)**.
    - pl-58, read the same way: set A 11 of 95 (11.6%); sets B to D 22 of 323 (6.8%).
  - **Set A fell, from 11 of 95 to 1 of 83.** With no list, Build 4's role points
    `lodging` at the kind-of-place fallback, which is the behaviour question 2 (a)
    chose.
  - `food`, which pl-60 did not touch, is flat on mentions, as a control should be.
  - **Sensitivity on the judgement cases:**
    - With the three `locality-plus-category` campgrounds moved to `named-premises`,
      `lodging` is 334 of 443 (75.4%).
    - With the Auberge internationale's two keys moved to `kind-of-place`, it is 254 of
      443 (57.3%).
    - With `manoir de percé|percé` moved to `kind-of-place` alone, it is 265 of 443
      (59.8%).
    - With `manoir de percé|percé` and the Auberge internationale's two keys all moved
      to `kind-of-place`, it is 218 of 443 (49.2%).
    - **The band is 49.2% to 75.4%**, not 57.3% to 75.4%. pl-58's 33 of 418 (7.9%) is
      far below either end.
  - Not claimed: that this is caused by more than the finds and the role together. The
    finds come from one checked-in capture, so sets B to D see the same 20 lodging
    finds every time.

- **The checks after it, read directly, with no pipe** (`remeasure.sh`):
  - `PLANNER_INVENTION_OFFLINE=1 PLANNER_INVENTION_CHECK=1 node --import tsx
tools/planner/api/test/live/invention.ts` (the default): exit 0.
  - The same with `--after pl58-2026-10-21`: exit 0.

  So pl-57's and pl-58's records still regenerate with the new run's directories on
  disk.

- **The harness change this step needed.** `stratumOrder` takes the specialists whose
  named premises form the stratum, and `STRATUM_SPECIALISTS` in `invention.ts` maps
  each ticket to them: `pl-58` to `lodging` and `food`, as before, and `pl-60` to
  `lodging` alone, since Build 7 web-checks `lodging`'s named premises. A ticket with
  no entry is refused. Test: `invention-population.test.ts`, "pl-60's stratum is
  lodging's named premises alone; pl-58's stays lodging's and food's".
  - Not renamed: the record's field `sampleByObject.lodgingOrFood` and the printed
    label "lodging-or-food". Renaming them would change pl-58's committed record. Under
    `pl60` every key in that stratum is `lodging`'s.
- **pl-58's `lodging`-only not-confirmed rate** (`pl58-lodging-rate.mts`, over its
  committed `verdicts.json`: an object is `lodging`'s when `lodging` proposed any of
  its checked keys). **2 of 19 objects (10.5%, 95% Wilson 2.9–31.4)**. Both are Forillon
  campgrounds, `not-found`: `Camping des Rivières` and `Des-a-Gauche campground`. None
  of `lodging`'s 19 objects was also `food`'s.

**The web check's pre-registration (Build 7).** It is committed and pushed before any
search runs; this commit is the pre-registration, as pl-58's `d3ca4190` was. The
search itself runs later, in a separate general-purpose agent with WebSearch, after
the owner opens the firewall. The builder runs none.

- **Budget:** `invention/pl60-2026-10-24/verdicts.json`'s `budget`, with no checks.
  It is pl-58's budget, adapted: up to 40 objects or all of them, one first query per
  object, up to two more for a key whose own locality the object leaves open, the
  three queries before `not-found`, and a cap of 90 queries and 20 page fetches.
- **The stratum:** `lodging`'s named-premises keys, **17 keys**, in the harness's seeded
  order (seed 20261020, from the worksheet above). Keys that name one premises share
  one first query, so **17 keys make 9 objects**. That is fewer than 40, so the walk is
  planned to take every key and stop `exhausted`. Petit-Gaspé's first query is pl-58's,
  verbatim; every other one is query 1 of the budget, the name with its locality as
  written (Gaspé added for the key with no locality).

| #   | key                                                       | planned first query                                        | object            |
| --- | --------------------------------------------------------- | ---------------------------------------------------------- | ----------------- |
| 1   | `le loup marin\|`                                         | Le Loup Marin Gaspé                                        | object 1          |
| 2   | `la rêvasse\|cap-des-rosiers, gaspé`                      | La Rêvasse Cap-des-Rosiers                                 | object 2          |
| 3   | `la rêvasse\|cap-des-rosiers`                             | La Rêvasse Cap-des-Rosiers                                 | object 2 (repeat) |
| 4   | `auberge internationale de forillon\|gaspé (cap-aux-os)`  | Auberge internationale de Forillon Cap-aux-Os              | object 3          |
| 5   | `motel l'eglantier\|percé`                                | Motel L'Eglantier Percé                                    | object 4          |
| 6   | `le loup marin\|gaspé`                                    | Le Loup Marin Gaspé                                        | object 1 (repeat) |
| 7   | `motel et chalets natabel\|percé`                         | Motel et Chalets Natabel Percé                             | object 5          |
| 8   | `motel bellevue\|percé`                                   | Motel Bellevue Percé                                       | object 6          |
| 9   | `auberge internationale de forillon\|gaspé`               | Auberge internationale de Forillon Cap-aux-Os              | object 3 (repeat) |
| 10  | `auberge la petite école de forillon\|`                   | Auberge La Petite École de Forillon Gaspé                  | object 7          |
| 11  | `petit-gaspé campground, forillon national park\|gaspé`   | Petit-Gaspé campground Forillon National Park Parks Canada | object 8          |
| 12  | `auberge la petite école de forillon\|gaspé (forillon)`   | Auberge La Petite École de Forillon Gaspé                  | object 7 (repeat) |
| 13  | `auberge la petite école de forillon\|gaspé (cap-aux-os)` | Auberge La Petite École de Forillon Gaspé                  | object 7 (repeat) |
| 14  | `la rêvasse\|cap des rosiers`                             | La Rêvasse Cap-des-Rosiers                                 | object 2 (repeat) |
| 15  | `manoir de percé\|percé`                                  | Manoir de Percé Percé                                      | object 9          |
| 16  | `auberge la petite école de forillon\|forillon`           | Auberge La Petite École de Forillon Gaspé                  | object 7 (repeat) |
| 17  | `auberge la petite école de forillon\|gaspé`              | Auberge La Petite École de Forillon Gaspé                  | object 7 (repeat) |

- **For the agent that runs it:** fill `verdicts.json`'s `checks` in this order, each
  key's `queries[0]` the planned first query above. Then write the record with
  `PLANNER_INVENTION_OFFLINE=1 node --import tsx tools/planner/api/test/live/invention.ts
--after pl60-2026-10-24`. The check is the same command with
  `PLANNER_INVENTION_CHECK=1`, its exit code taken without a pipe. Report the
  not-confirmed rate per object with a 95% Wilson interval, beside pl-58's 2 of 19
  above.
- **Expect most of these to exist.** Every one of the 9 objects is a name the run
  handed `lodging` from the town capture. The check still matters: a map entry is not
  proof that the premises is open, and the 27 `lodging` candidates that did not match
  a find are not in the stratum unless they are named premises.
- **Not done here:** the searches, the verdicts and the per-object rate (Done when 9's
  second half).

**2026-10-24 — Build 7's web check: the verdicts and the per-object rate
(general-purpose agent, Opus 5.5).** WebSearch ran in a **general-purpose agent**, as in
pl-57 and pl-58, at `8741d2de` (the pre-registration `89fdedc3` with `main` merged in;
`git diff --stat 89fdedc3 8741d2de -- tools/planner/` is empty). The searches ran from
14:36:33Z to about 14:42Z, after the pre-registration was pushed.

**Firewall.** The owner opened it on 2026-10-24 and gave no time. **The orchestrator first
observed it open at 14:34Z** (`curl https://wiki.openstreetmap.org` → 200, after an earlier
timeout). **Left open after the check, by the owner's choice** (2026-10-24).
WebSearch runs on the vendor's side; both WebFetch calls returned a page.

**Spend against the budget: 16 queries and 2 page fetches**, against a cap of 90 and 20,
1.78 queries per object (pl-58: 1.23). **Every first query ran in the pre-registered order
and wording**, one per object, objects 1 to 9 in key order. The 7 further queries:

- Le Loup Marin, 2: queries 2 and 3 of the budget, because query 1 found no current listing.
- La Rêvasse, 3: queries 2 and 3, then a fourth, `La Rêvasse Percé gîte rue Saint-Michel`.
  That fourth one is the further query the budget allows for a locality the results leave
  open. This run's own Overpass capture puts La Rêvasse (way 373624823,
  `addr:hamlet` Cap des Rosiers, 16 rue Saint-Michel) with its centre at about 48.525,
  −64.214, which is Percé and not Cap-des-Rosiers.
- Motel L'Eglantier, 2: query 1 returned booking aggregators only, so two more were run, as
  pl-58 did for Hotel Duca d'Alba.

Each check's `queries` holds every query run for it. The fetches were the Routard forum
thread (Le Loup Marin) and a Centris url (L'Eglantier), which now serves a results page
that does not mention the motel. Every other piece of evidence is a page **seen in the
search result**, not fetched, and each note says which.

**The verdicts, 17 keys and 9 objects:** 12 `exists`, 0 `exists-elsewhere`, 2 `closed`, 3
`not-found`. Each object:

1. **Le Loup Marin** (keys 1 and 6): **closed**, 2014. A Routard forum thread, fetched,
   has a post of 2015-02-22 ("En 2012, j'ai séjourné au Gîte du Loup Marin près de
   Forillon") and a reply of 2015-02-23 ("le Gite du Loup marin est desormais fermé depuis
   Octobre 2014"). None of the three queries found a listing, a directory entry or a
   website. **Judgement call:** the closure rests on one unofficial reply. Without it, the
   verdict would be `not-found`, which is also not confirmed, so the rate does not move.
   OSM still holds it as `tourism=guest_house` (node 351976272, a CanVec building import,
   near Cap-aux-Os), and the run handed it to `lodging` as a find.
2. **La Rêvasse** (keys 2, 3 and 14): **not-found**. The queries were "La Rêvasse
   Cap-des-Rosiers", `"La Rêvasse"`, "La Rêvasse gîte hébergement Cap-des-Rosiers Gaspé"
   and "La Rêvasse Percé gîte rue Saint-Michel". pl-56 has no OSM row for any key in this
   stratum. **We did not find it.** It is in OSM, as above.
3. **Auberge internationale de Forillon** (keys 4 and 9): **exists**. Québec Vacances lists a
   youth hostel in the village of Cap-aux-Os at 2095 boulevard Grande-Grève, Gaspé. Cap-aux-Os
   is a sector of the town of Gaspé, so both keys' localities hold.
4. **Motel L'Eglantier** (key 5): **exists**, at 193 Route 132 Ouest, Percé, which is OSM's
   address too. The evidence is Skyscanner listings carrying guest reviews from 2020 and
   2021, and a Centris sale listing's search summary that calls it a twelve-unit motel in
   business for over 30 years. No tourism-office listing and no site of its own was found.
   It is the weakest `exists`: whether it operates today rests on aggregators.
5. **Motel et Chalets Natabel** (key 7): **exists**, at 196 route 132 Ouest, Percé (Québec
   Vacances; Yellow Pages). OSM gives 25 Route 132.
6. **Motel Bellevue** (key 8): **exists**, at 183 route 132 Ouest, Percé (Bonjour Québec,
   season 1 April to 30 November 2026; Québec Vacances).
7. **Auberge La Petite École de Forillon** (keys 10, 12, 13, 16 and 17): **exists**, at
   1826 boulevard de Forillon, Gaspé, a few minutes from Cap-aux-Os beach and the park
   (Québec Vacances; Sortir au Québec). The key at `gaspé (cap-aux-os)` is judged by
   municipality, as pl-58 judged Gaspé's sectors.
8. **Petit-Gaspé campground** (key 11): **exists**, as the South Area campground of Forillon
   (Parks Canada; Tourisme Gaspésie). The first query is pl-58's, verbatim.
9. **Manoir de Percé** (key 15): **exists**, at 212 route 132 Ouest, Percé (Tourisme
   Gaspésie; Québec Vacances, a booking window of 30 May to 1 October 2026).

**Every one of the 9 objects is an entity in the run's lodging capture**
(`overpass-lodging-towns.json`), read by name with a scratch script. **Both objects that are
not confirmed are map entries**: one the web says closed in 2014, one the web does not know.
pl-58's two `lodging` objects that were not confirmed were names that Parks Canada does not
use. No element in this run's capture, which covers Forillon National Park's point and Gaspé's
at 10 km, has a name containing `Rivières` or `Gauche`. The defect has changed kind. It is no longer an
invented name; it is a stale or unverifiable map entry. The sample is 2 events, so this is
an observation, not a rate.

**The record.** `PLANNER_INVENTION_OFFLINE=1 node --import tsx
tools/planner/api/test/live/invention.ts --after pl60-2026-10-24` gave exit 0 and wrote
`invention/pl60-2026-10-24/2026-10-24.json` only. Its `stratumDraw`: seed 20261020,
**17 keys taken for 9 of 40 objects, stop `exhausted`**, as planned. `withoutParks` is the
same 9 objects, because no key in the stratum is tagged `park-visit`.

**The rate per object (Done when 9's second half).** It is the harness's `render` line,
recomputed with a scratch Wilson script, which agrees:

| stratum                                                          | objects | not confirmed | rate  | 95% Wilson |
| ---------------------------------------------------------------- | ------- | ------------- | ----- | ---------- |
| pl-58, `lodging` only (above, from its `verdicts.json`)          | 19      | 2             | 10.5% | 2.9–31.4   |
| **pl-60, `lodging`'s named premises**                            | **9**   | **2**         | 22.2% | 6.3–54.7   |
| pl-60, sensitivity: Motel L'Eglantier also read as not confirmed | 9       | 3             | 33.3% | 12.1–64.6  |

The two intervals overlap almost entirely, so **this sample cannot say the rate moved**, in
either direction. Nine objects is the whole stratum and not a draw from it. That is because
the run named few distinct premises: 17 keys, against pl-58's 51. Against the owner's
earlier bar (above about 10%, lower bound above 5%), 22.2% (6.3–54.7) clears it, on 2 events
in 9. Per key, the harness gives 5 of 17 not confirmed, 29.4% (13.3–53.1).

**Checks, each exit code read from a file and never through a pipe** (`run-harness.sh`):

- `PLANNER_INVENTION_OFFLINE=1 PLANNER_INVENTION_CHECK=1 node --import tsx
tools/planner/api/test/live/invention.ts` gave exit 0, `111 live records, 2594 place
mentions, 1019 distinct places`, and "check: the committed record equals its
  regeneration; every sampled place has a verdict". So pl-57's record is unchanged.
- The same with `--after pl60-2026-10-24` gave exit 0, `110 live records, 2693 place
mentions, 700 distinct places`, and the same check line.
- The same with `--after pl58-2026-10-21` gave exit 0, with pl-58's 5 of 40 unchanged.
- **The check can fail.** With `la rêvasse|cap-des-rosiers` flipped to `exists` in
  `verdicts.json`, the pl-60 check gave exit 1, "the committed record is not what the inputs
  regenerate". The verdicts were then regenerated from the scratch generator that wrote them
  (`gen-verdicts.py`), and the check gave exit 0 again (`mutate.sh`).
- At `4f5bb20c`: `npx vitest run tools/planner/api/test/live-records.test.ts
tools/planner/api/test/invention-population.test.ts` passed 391 of 391, and
  `live-records` walks the three `pl60-2026-10-24` invention files. `npm run check` exited 0. `npm test -- --project planner` passed 81 of 81 files and 1776 of 1776 tests, exit 0.
  That is 114 more than at `e036ef77` (1662), which is before the run's 110 records were
  committed. Where the 114 come from was not itemised. The e2e suite and the image gate were
  not run locally.

**What the brief had wrong, or left open.**

- The budget gives no rule for a first query that finds only booking aggregators.
  pl-58's Duca d'Alba precedent was followed (L'Eglantier, 2 more).
- The budget's "the name in the local language" is the name itself when the name is
  already French. Query 3 therefore added French category words (`gîte`, `hébergement`),
  as pl-58's query 3 did for Camping des Rivières.
- The record's field `sampleByObject.lodgingOrFood` and the printed "lodging or food" label
  name a `lodging`-only stratum here, as the previous entry says.

**Folded in: nothing.** Two things were offered. Filing `food`'s ticket waits on the open
decision below. Correcting OSM's La Rêvasse and Le Loup Marin is outside this repository.

**Open decision, for the owner (the builder does not choose).** Question 4's answer files
`food` "as its own ticket if this one works". Two measurements bear on whether it works.
The named-premises share rose: `lodging`'s mentions went from 33 of 418 (7.9%) to 301 of
443 (67.9%), and to 300 of 360 (83.3%) where finds were given. The not-confirmed rate on
what `lodging` names cannot be shown to have fallen: 2 of 9, 22.2% (6.3–54.7), against
2 of 19, 10.5% (2.9–31.4). Both of its misses are map entries.

- **(a) Call the route working, and file `food`'s discovery ticket now.** It costs a docs
  pull request, and later the restaurant clauses, their call count and a paid run, which
  question 4 (b) said nothing has measured. It carries the finding that a find can be a
  stale map entry into that ticket's brief.
- **(b) First file an existence check scoped to map-sourced premises.** For example, a find
  with no `website`, or one past a `check_date`, is flagged, or is checked by a lookup.
  Then decide on `food`. It costs a ticket and a measurement before `food`. It reaches
  exactly the class this check found, and only that class.
- **(c) File nothing. Land pl-60 on the measurement and leave `food` and existence open.**
  It costs nothing now. The staleness finding then lives only in this Log.

**Recommendation: (a).** The prompt-only route moved nothing, and the share of named
premises it was meant to raise went from 7.9% to 67.9% of mentions. 2 events in 9 objects cannot carry (b)'s
premise yet. The `food` ticket's own re-measure doubles that sample on the same rubric.
(b) is the honest alternative if the owner reads both misses as the start of a pattern.

**2026-10-24 — The owner's answers to the web check's open decision and the firewall
(relayed by the orchestrator to the lander, the same day).**

1. **The open decision on `food` (above).** Options: (a) call the route working and
   file `food`'s discovery ticket now; (b) first file an existence check scoped to
   map-sourced premises; (c) file nothing now, land pl-60 on the measurement.
   **Chosen: (a)**, the web-check agent's recommendation. The filing is dispatched
   separately as **pl-62**; this branch does not file it, and adds no roadmap row for
   it.
2. **The firewall.** The owner opened it for the web check and gave no time; the
   orchestrator first observed it open at 14:34Z. **Chosen: leave it open** after the
   check. The Firewall paragraph of the web check's entry says so in place of "Closed:
   not observed by the builder".

- 2026-10-24 — Fixed at landing by owner choice: gate 2, low — "The Log's 'judgement
  cases a reader may reverse' omits `manoir de percé|percé`, and its sensitivity band
  understates the downside. The key carries 36 of `lodging`'s 301 named mentions with
  no edge tag; it is a locality plus a category noun, the shape of the rubric's
  `locality-plus-category` case that the Log moved the three campgrounds under.
  Reversed alone: 265 of 443 (59.8%). Reversed with the Auberge internationale's two
  keys, which the Log does list: 218 of 443 (49.2%), below the Log's stated 57.3%."
  The two bullets are corrected where the Log makes them (the judgement cases and the
  sensitivity list of the re-measure). `node
.../gate-2/sample.mjs <tree> <outdir>` at `2a3aa467`, then `node
.../land/band.mjs <outdir>/lodging-named.json` →
  `manoir mentions 36 auberge two keys 47`, `manoir reversed 265 of 443 (59.8%)`,
  `manoir + auberge reversed 218 of 443 (49.2%)`, and the Log's own `auberge reversed
254 of 443 (57.3%)` and `campgrounds to named-premises 334 of 443 (75.4%)` unchanged.
  The band is 49.2–75.4%; the direction does not move (pl-58 is 33 of 418, 7.9%).
  Gate 2's section is untouched.
