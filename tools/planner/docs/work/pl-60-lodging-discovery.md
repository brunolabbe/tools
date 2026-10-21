---
id: pl-60
tool: planner
title: Lodging chooses among real establishments fetched from map data, instead of proposing from memory
kind: work-package
status: needs-decision
milestone: P3
depends_on: [pl-58]
difficulty: hard
---

# pl-60 — Lodging discovery: real establishments propose, the specialist chooses

**Packages:** `agent` (the set of specialists handed `Find[]`, the discovery
prompt block, `lodging`'s `role`), `api` (the discovery pass, the adapter's query,
the fixtures, the live re-measure), and `tools/planner/CLAUDE.md` (one rule, named
in Build 8). **No contract change is planned.** Whether one is needed is
question 3 under _Decision — open_, and the answer is not this filing's to give.

## Why

[00-ANALYSIS.md §5's amendment of 2026-08-22](../00-ANALYSIS.md) made grounding a
source of candidates and not only a check, and [pl-29](pl-29-detours-along-a-leg.md)
built it for corridors: map data proposes to a specialist, the specialist proposes
to the composer. `activities`, `food` and `conditions-and-gear` are handed
`Find[]` today. `lodging` is not, and it is the specialist whose output most
needs a real premises behind it, because it is the one a traveller books.

**The evidence is in pl-58**, whose branch is `pl-58-name-a-premises` (PR #593).
It had not merged when this ticket was filed, so everything below is cited from
its ticket's Log at that branch's head `6fc01891`, in prose and not by link, and
`depends_on` waits for it. Three facts, each re-read from that Log:

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
recommendation of (a).** This ticket is that route. It is `needs-decision`
because the four questions below sit under it and none is settled on `main`.

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
  list costs a query clause and not a signature change.
- **pl-36 settled that a candidate written from a `Find` stays `model-asserted`**,
  because nothing can say which find a proposal came from and the name-match join
  that would say it had never been scored. That holds here until a measurement
  says otherwise, and Build 6 is that measurement. pl-36's premise that no run has
  been captured with finds in it is stale: pl-40's live records for sets B to D
  carry a `finds` array (`run.ts`'s `serializeFinds`), parsed offline from the one
  real Overpass capture the repo holds, so the join can be scored on existing
  records for `activities` and `food` at no cost.

## Build

Written for the recommended answers to the four questions. The commit that
records the answers re-states any step they change, and re-rates `difficulty` if
they move it. **Do not start before the answers are on this ticket.**

1. **Capture first, and stop with the counts.** Add the lodging kinds (the OSM tag
   values are the builder's to list from the OSM wiki, with the rejected ones in
   the Log) to `DISCOVERY_KINDS` and `KIND_FILTERS`, with the query reaching a
   town's radius, and capture a real Overpass reply for **the distinct
   `place.locality` of the `lodging` candidates in the set A `road-trip` record of
   each of pl-58's five run directories**
   (`api/test/fixtures/live/claude-<family>-5-5-<effort>-pl58-2026-10-21/`). The
   Log gives the town count, the number of lodging finds returned per town
   including zero, and whether the three campgrounds Parks Canada names for
   Forillon (Petit-Gaspé, Des-Rosiers, Cap-Bon-Ami) are among the finds for
   Gaspé. The capture needs outbound access to an Overpass instance, which the sandbox
   firewall may block, so ask the owner to open it. **If the
   answer to question 1 sets a zero-find threshold, apply it here. If it sets
   none, stop after this step**, commit the Log, and report the counts as an open
   decision: a source that returns nothing for the towns that matter is the
   precondition for everything below.
2. **Fetch finds per town, before the fan-out.** Where the towns come from is the
   builder's call to propose and the Log's to argue: the brief's origin,
   destination and waypoints are the only stops known before `lodging` runs. A
   town costs grounding calls against `MAX_GROUNDING_CALLS`, so the Log gives the
   number of calls a run of each brief shape spends and asserts it, as pl-29's
   discovery pass does for the corridor. Re-plans: `revise.ts` decides whether a
   re-plan re-runs discovery from `hasCorridor(brief) && specialists.some(readsFinds)`,
   so adding `lodging` to the reading set makes a re-plan that names `lodging`
   re-run it. Say what that costs.
3. **Hand the finds to `lodging`.** Add `lodging` to `READS_FINDS` in
   `agent/src/prompt.ts` and give it the discovery block. The block today ends
   with "Use it only if it is genuinely worth this trip — an empty list above is not
   a gap to fill", which is the right sentence for `activities` and the wrong one for
   lodging, where a night's sleep is not optional. The block is rendered per
   specialist, so lodging's wording is its own, and the other three specialists'
   prompts are byte-identical to what they are today (a test).
4. **Rewrite `lodging`'s `role`.** pl-58's sentence (a proposal names one premises
   or says it is a kind of place, with `place.name` holding the kind) stays or goes
   according to question 2. Say which in the Log, and why. This is the second change
   to the same string within a week; the Log quotes both.
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
   committed rubric, by hand, with `invention.ts --after pl60-<date>`'s label
   written as pl-58 wrote its own (read how first), and report `lodging`'s
   named-premises share on mentions and on places beside pl-58's 33 of 418 and 25
   of 162. Then web-check `lodging`'s named premises in pl-58's ordered-key
   procedure, up to 40 objects or all of them, and report the not-confirmed rate
   with a 95% Wilson interval beside pl-58's `lodging`-only count (which the Log
   computes from pl-58's `verdicts.json`, since pl-58 gives it only for both
   specialists together). WebSearch runs in a general-purpose agent, as in pl-57
   and pl-58.
8. **Edit one rule in `tools/planner/CLAUDE.md`, named here so the builder may.** "A
   specialist reads the brief, and only the brief" says `activities`, `food` and
   `conditions-and-gear` are handed `Find[]`, and "it hands its finds to the three
   specialists above and stops there". Both change if `lodging` joins, and the
   paragraph after it describes discovery as a corridor query. Reword them to the
   set that ships, and add a dated amendment to §5 in `00-ANALYSIS.md` only if
   question 1 chooses a source other than the one §5 names. Do not add a second
   new rule.

## Decision — open

Four questions, each with its options, costs and a recommendation. The ticket
poses them so the next agent does not settle them in a builder's prompt. None is
settled on `main`: pl-29 chose Overpass for corridor discovery, which is not a
decision about lodging by town, and pl-58 deferred the specificity field to "a
later ticket only if the re-measure justifies a scoped lookup".

**1. Which data source finds real lodging?** The grounding seam
(`GroundingProvider`) is where it is named in either case, in the one file §5
says holds deployment choices.

- **(a) OSM through Overpass, pl-29's adapter extended.** Costs: new query
  clauses and fixtures, no new vendor, no key, no bill per call, and the
  hostile-text defence already exists. Risks: coverage of lodging is unmeasured
  (fact 3 above), and §5's own amendment warns that OSM is dense in Europe and the
  Saint Lawrence and sparse elsewhere. A thin town makes the plan look as good as a
  dense one unless `coverage` says otherwise.
- **(b) A paid places or search API.** Costs: a key, a per-call bill that
  `MAX_GROUNDING_CALLS` then has to count in money and not only in calls, a new
  vendor whose terms on storing results the builder must read before the fixtures
  are committed, and URLs and descriptions arriving in larger volume as hostile
  text. Gains: coverage and currency that OSM cannot promise.
- **(c) Both: OSM by default, a places API where a key is configured.** The most
  code and two sets of fixtures, for a feature whose coverage is not yet known.

**Recommendation: (a)**, gated by Build 1's capture. The seam makes (b) an
adapter added later, not a rewrite, and Build 1 puts a number on the one thing the
choice turns on before the prompt is touched. If the capture is poor, the
owner has the counts to choose (b) with.

**2. May `lodging` still propose a kind of place when finds are thin, or must it
choose from finds?**

- **(a) It may fall back to a kind of place when its town's list is empty or
  nothing in it fits.** Costs: a thin town keeps the unverifiable proposals that
  are 90.8% of mentions today, and code cannot tell a fallback from a choice
  except by name-matching (question 3). Gains: a plan never has a hole where a
  night should be.
- **(b) It must choose from finds, and a town with none yields no lodging
  candidate.** Costs: a hole in the plan exactly where the map is thin, which
  is §5's "works better in Rome than in Nunavik" failure at the level of a
  night's sleep; and it needs a `PlanGap` or a `coverage` entry that names a town,
  where `coverage` names a corridor today, so it may be a contract change.
- **(c) A fallback only on an empty list, never when finds exist.** Costs: a
  model that finds nothing fits in a non-empty list is forced into a bad choice.
  Gains: the simplest rule to test.

**Recommendation: (a),** because the fallback degrades to exactly today's
behaviour and the remedy for the thin town is the coverage note, which exists. If
the note cannot name a town without a contract change, the builder stops and says
so: that is a contract question and not the builder's.

**3. Does `@planner/contract`'s `Place` need a specificity field?** pl-58
deferred it ("a specialist field follows in a later ticket only if the re-measure
justifies a scoped lookup"), and `Place` today is `{name, locality, coordinates}`.

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

**Recommendation: (a) for now,** with Build 6's join count as the evidence that
reopens it. A field the first consumer does not read is the guess `CLAUDE.md`'s
second-consumer rule warns against; a later lookup ticket is the consumer.

**4. Is `food` in scope?** `food` already reads finds, and none of its finds can
be a restaurant (see _Why_). pl-58's record puts all three wrong-town objects on
`food`.

- **(a) `lodging` only, and `food` as its own ticket if this one works.** Costs:
  the 3 of 5 measured defects that sit on `food` stay. Gains: one specialist and
  one set of tag clauses to measure, and lodging's finds are few per town.
- **(b) `lodging` and `food` together.** Costs: restaurants outnumber hotels in a
  town by a wide margin, so the prompt block and the call count grow in a way
  nothing has measured, and two specialists' changes confound one live run. Gains:
  reaches the other 3 of 5 defects.
- **(c) `food` only.** Costs: ignores the owner's choice of the lodging route. Not
  recommended; listed so the mapping is not hidden.

**Recommendation: (a),** because the owner's route names lodging and a second
specialist doubles a paid measurement. File food as a ticket from this one's Log
rather than folding it in.

## Done when

Worded for the recommended answers. The commit that records the owner's answers
re-states any line they change.

- `readsFinds` returns `true` for exactly four of the seven specialists,
  `activities`, `food`, `conditions-and-gear` and `lodging`, and `false` for
  `route-and-logistics`, `budget` and `practicalities`. The test is in
  `tools/planner/agent/test/`.
- The system prompts of `activities`, `food` and `conditions-and-gear`, built from
  one fixed brief and one fixed `Find[]`, are byte-identical to what they are on
  `origin/main`. A test pins the three.
- Against a checked-in Overpass payload captured for the towns Build 1 names, the
  lodging query returns the finds inside each town's radius and none outside it,
  offline. The Log gives the count of finds per town, including the zero towns, and
  says whether the three Forillon campgrounds are among Gaspé's finds.
- A lodging find whose `name` is an instruction reaches `lodging`'s prompt as
  quoted data and nothing in a find's tags is fetched. The test is in
  `tools/planner/agent/test/prompt.test.ts` or the discovery spec, whichever holds
  pl-29's equivalent.
- For each of pl-58's six set A shapes (`backcountry`, `city-and-culture`,
  `motorised-touring`, `multi-city`, `resort`, `road-trip`), a run under the
  scripted provider spends the number of grounding calls the Log asserts for that
  shape. The test asserts calls, not timing.
- With a scripted provider whose lodging query returns no finds, each of the six
  set A shapes produces the same days as `origin/main` does for the same brief and
  scripted model, byte-identical, and the plan carries the note question 2's answer
  names.
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
- `tools/planner/CLAUDE.md`'s two sentences about which specialists read finds
  name the set that ships and say nothing else new.
- `npm run check` exits 0 and `npm test -- --project planner` passes with the file
  and test counts the Log gives. The e2e suite and the image gate do not run
  locally; the Log says so rather than reporting them green.

## Log

**2026-10-21 — Filed (builder, Sonnet 5.5), on the owner's decision of the same
day,** at the orchestrator's dispatch. `node scripts/next-id.mjs pl` printed `next
free: pl-60`. Docs only; no source changed.

- **Re-read, not relayed.** Every figure in _Why_ was read from
  `git show origin/pl-58-name-a-premises:tools/planner/docs/work/pl-58-specific-lodging-food-proposals.md`
  at `6fc01891`. The brief's "OSM / pl-56's geocoder had rows for 9 of the 51
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
- **No `## Review` section.** A filing has no work to review, and a gate on the
  filing is recorded outside `## Review` (`docs/01-TICKETS.md`, _The review gate_).
