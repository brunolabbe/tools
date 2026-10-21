---
id: pl-60
tool: planner
title: Lodging chooses among real establishments fetched from map data, instead of proposing from memory
kind: work-package
status: ready
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
was read as the branch stood at `fce56408` (2026-10-21, 02:14Z); that sha lives
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
   keeps the area form changes the parser too. The capture needs outbound access to
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
   two points", in `agent/src/grounding.ts`, and a town is one point. Report both
   options with the cost found in the code, and wait for the owner:
   - **(a) A degenerate corridor: the town's point twice**, or two points a few
     metres apart. No seam change. The cost is a corridor that is not one:
     `distanceToCorridorMetres` and the `around:` polyline then measure a segment
     of zero length, and the type's doc-comment stops being true.
   - **(b) A sibling seam method**, a `nearby`-for-a-point on `GroundingProvider`
     with its own request type. Every adapter implements it (the fixture provider,
     the Overpass adapter, the cache), the seam gets wider, and the Log's call
     accounting gets a second shape. The gain is a request type that says what a town is.
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
- Against a checked-in Overpass payload captured for the towns Build 1 names, the
  lodging query returns the finds inside each town's radius and none outside it,
  offline, and returns a way or relation as a find with a coordinate from its
  `center`. The Log gives the count of finds per town, including the zero towns,
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
