---
id: pl-62
tool: planner
title: Food chooses among restaurants and cafés fetched from map data around the trip's towns, instead of proposing from memory
kind: work-package
status: ready
milestone: P3
depends_on: [pl-60]
difficulty: hard
---

# pl-62 — Food discovery: real establishments propose, the specialist chooses

**Packages:** `agent` (the kinds list, `findsFor`'s routing, `food`'s discovery
block and `role`), `api` (the town pass's food query, its fixtures, the live
re-measure, and the `invention.ts` harness's stratum map), and `tools/planner/CLAUDE.md`
plus one rules file (named in Build 8). **No contract change is intended.** One
comment in `contract/src/unchecked.ts` may need a word, and Build 8 says what to do
about it.

## Why

[pl-60](pl-60-lodging-discovery.md) (PR #607) gave `lodging` a list of real places to
sleep, fetched from OpenStreetMap through Overpass around the towns a trip names,
and its Log asked whether `food` should follow. The owner answered on 2026-10-24
(_Decision — answered_ on pl-60, the open decision at the end of its Log): **call
the route working and file `food`'s discovery ticket now.** This is that ticket. The
other two options were to first file an existence check for map-sourced premises, and
to file nothing; pl-60's question 4 had already put `food` out of its own scope, to be
filed "as its own ticket if this one works".

**Every figure below is pl-60's, restated from its Log** as the branch of PR #607
stood on 2026-10-24. That branch had not merged when this ticket was filed, so
nothing here links to a line of it; each number is written out so it survives the
squash merge. The order is the order the Log reports them.

1. **The share of mentions that name a premises rose where finds were given.**
   `lodging` went from 33 of 418 (7.9%) in pl-58 to 301 of 443 (67.9%). Split by set,
   the rise is all in the sets that carry finds: set A, which has none by design, went
   from 11 of 95 to 1 of 83 (1.2%), and sets B to D are 300 of 360 (83.3%), against
   pl-58's 22 of 323 (6.8%) read the same way. The classification has judgement cases
   a reader may reverse, and pl-60's gate widened the band to **49.2% to 75.4%**
   (PR #607's gate 2 comment; the Log carries it). Every reading in the band is six
   to ten times pl-58's 7.9%.
2. **`food` was the control, and stayed flat.** 41 of 395 (10.4%) against pl-58's 43
   of 407 (10.6%); by places, 30 of 170 (17.6%) against 26 of 186 (14.0%). pl-60
   did not touch `food`, so it moved by sampling only.
3. **The join pl-36 said had never been scored was scored.** A candidate whose
   `place.name` equals a find's `name` in the same record, after case and diacritic
   folding: `lodging` reading town finds, 333 of 360 (92.5%); `activities` and `food`
   reading corridor finds, 8 of 1,165 over the ten earlier run directories (0.7%) and
   12 of 606 in the new run. A specialist handed a list it can use names from it.
   `food` is handed a list it cannot use: **none of the corridor's four kinds
   (`viewpoint`, `waterfall`, `attraction`, `historic-site`) can be a restaurant.**
4. **The defects that remain sit on `food` in part.** In pl-58's web check, 5 of 40
   objects were not confirmed; the three that were a real premises **in another
   town** were all `food`'s (two smokehouses and a brewery-pub), and the two not
   found were `lodging`'s. A town list in front of `food` reaches the first class,
   because a premises chosen from a list is in the list's town. This ticket does not
   claim the web check will show it, and pl-58's Log does not give a `food`-only
   object count, so Build 7 computes one.
5. **A find can be a stale map entry.** `lodging`'s not-confirmed rate after pl-60 is
   2 of 9 objects, 22.2% (95% Wilson 6.3–54.7), against pl-58's `lodging`-only 2 of
   19, 10.5% (2.9–31.4); the intervals overlap almost entirely, so the rate **cannot
   be shown to have moved**. Both of the new misses were map entries the model chose
   from the list: **Le Loup Marin**, closed in October 2014 on the web's evidence
   (one forum reply, so a judgement call that reads `not-found`, also not confirmed,
   if reversed), and **La Rêvasse**, which the web does not know. The defect changed
   kind, from an invented name to an entry that is stale or unverifiable; with two
   events it is an observation and not a rate. Whatever `food` is handed will carry
   the same class, and restaurants close more often than hotels.
6. **The town pass's shape**, which this ticket extends rather than rebuilds:
   `GroundingProvider.nearbyPoint` (seam option (b) of pl-60's Build 2, a request of
   a point, a radius and kinds), a **10 km** radius, **at most 4 towns** taken from
   the brief's named stops and then its destination, **at most 10 finds per town**,
   the closest first, one `locate` and one `nearbyPoint` per town, and a coverage
   sentence for each town that was not found, came back empty, was refused by the
   budget, or fell past the cap. Per-shape call counts for the six set A shapes are in
   pl-60's Log; Build 2 reuses them as the base.
7. **The public Overpass instance answers 406 to the adapter as it stands**, because
   the adapter sends no user agent ([pl-61](pl-61-overpass-discovery-sends-no-user-agent.md),
   PR #608). pl-60 captured its fixtures with a scratch script that sent an
   identifying user agent, and this ticket's capture does the same, so **this ticket
   does not depend on pl-61**. A deployment on the public instance gets no town finds
   for `food` either until pl-61 lands, and the town pass reports that as "nothing
   on the map", the way it does for `lodging`.

**What differs from pl-60, so this is not read as a copy of it.**

- **`food` already reads finds.** `lodging` was a new reader of a new list.
  `food` is in the set of specialists handed finds since pl-29, and on pl-60's
  branch `findsFor` routes by kind with one test: a find whose kind is a lodging kind
  goes to `lodging` alone, and everything else goes to the three corridor readers.
  **A restaurant kind added to the list with no routing change would go to
  `activities` and `conditions-and-gear` as well**, which changes two of the three
  corridor-reader prompts that pl-60 pins byte for byte to the base. (The third pin is
  `food`'s own, and Build 4 breaks it on purpose: see Build 4.) Routing is therefore
  part of the change, not a detail of it (Build 2).
- **A town list does not cover a meal on the road.** The corridor pass draws a line
  from origin to destination; the town pass looks at the towns the brief names. A
  lunch between two stops is in neither. Decision 2 is about which pass `food` reads.
- **Restaurants outnumber places to sleep in a town** by a margin nothing here has
  measured, so the per-town cap decides which ten are shown, and "closest to the
  town's point" is a ranking that favours a town centre. Build 1 measures density
  before the cap is chosen. **Build 1 found the premise false on the map for these
  nine localities**: 117 food finds against 141 places to sleep at 10 km, more food in
  three localities, less in four and the same in two (the Log's Build 1 entry). The point about the ranking
  stands: Gaspé's and Percé's ten closest all sit within 300 m of the town's point.
- **The role string is `food`'s and says what a meal is.** pl-58's `role` for `food`
  reads "meals that are part of the trip rather than fuel for it", and it is the
  second change to that string within a week if Build 4 appends to it, as pl-60
  appended to `lodging`'s.
- **The sets that carry finds see two towns.** pl-60's `run.ts` hands sets B to D
  lodging finds from its nine-town capture through stand-in locates: `Percé Rock`
  stands in Percé, and `Forillon National Park` and `Gaspésie` stand in their own
  captures. Food finds in sets B to D therefore come from Percé and Forillon only
  (Gaspésie, the peninsula, had none for lodging either), and from one checked-in
  capture, so the same list every time. This is the measurement's shape; the Log says
  which shapes it leaves unmeasured.

## Build

Written for the owner's answers of 2026-10-24 (_Decision — answered_), each the
recommendation: the meal set without `fast_food`, the town pass added to what `food`
reads, a separate food query per town, and no screen. Decisions 5 and 6 are asked at
their stops (_Decision — answered_ says when).

1. **Capture first, and stop with the counts.** From a scratch script and not through
   the seam, send the food query for the nine localities pl-60's Build 1 used: Amqui,
   Bonaventure, Carleton-sur-Mer, Forillon National Park, Gaspé, Gaspésie, Matane,
   Percé and Rivière-du-Loup. Take each point from pl-60's checked-in
   `overpass-lodging-towns.json` (`towns[].point`), so nothing is re-geocoded. Build the
   query text through the built `overpassPointQuery` and send it with an identifying
   user agent, serially, 5 s apart, one retry after an HTTP 429 as pl-60 did, and record
   each query's status and time. Count the finds by town, **by OSM element type** (node,
   way, relation), **by tag value** (each of Decision 1's tags, counted apart), and at
   2, 6 and 10 km from one `out center tags` reply captured at 25 km. Count what
   `findFrom` would drop: elements with no name. Count a tag Decision 1 excluded
   (`fast_food`, if it did) apart anyway, as pl-60 counted huts apart, so the owner
   sees what the exclusion costs. Then report, over the named finds, **how many carry
   each of `website`, `phone`, `email`, `opening_hours` and `check_date`, counted on
   those exact keys**, and beside it the wider reading Decision 4 also gives
   (`website` ∪ `contact:website` ∪ `url`, `phone` ∪ `contact:phone`, `email` ∪
   `contact:email`, and "at least one of the three" on each reading), so the food table
   is comparable with the lodging one. This is the table Decision 4 turns on. If Decision 3 is (b), also send each town's query
   once with the lodging and food clauses combined, and record that query's time and
   reply size, so the answer can be revisited with the numbers. The capture needs
   outbound access to Overpass, which the sandbox firewall may block: ask the owner
   to open it. **Stop here**, commit the Log, and report the counts as an open decision
   (Decision 6).
2. **Fetch food finds per town, in the pass that exists.** Extend pl-60's town pass
   (`runs/lodging.ts` on that branch, and `discover` in `runs/discovery.ts`) as
   Decision 3 says. Name the food kinds as a list beside `LODGING_KINDS`, give each its
   `KIND_FILTERS` clause and its kind matcher, and make `DiscoveryKind` their union.
   **Change `findsFor` so that each reader sees only its own kinds**: `lodging`, the
   lodging kinds; `food`, the food kinds **and** the corridor kinds it is handed today
   (a change to what `food` sees of the corridor is not this ticket's); `activities`
   and `conditions-and-gear`, the corridor kinds alone. A test builds the prompts of
   `activities` and `conditions-and-gear` from one fixed `Find[]`, with a food find
   added, and compares them with the base commit's; `food`'s prompt changes on purpose
   (Build 4, `Done when` 1). Keep the per-town cap, add one for food, and
   argue it in the Log. The Log gives the number of calls a run of each of the six set
   A shapes spends and asserts it, beside pl-60's column (18, 12, 6, 14, 4 and 23 calls
   for `road-trip`, `backcountry`, `motorised-touring`, `city-and-culture`, `resort`
   and `multi-city`). Re-plans: pl-60's `revise.ts` re-runs both passes when a re-plan
   names any finds reader. Say what that costs for a re-plan naming only `lodging`,
   only `food` and only `activities`, and pin those three numbers.
3. **Hand the finds to `food`, in its own words.** `food` is already in
   `READS_FINDS`. Give it a block for the town's food finds whose closing sentence is
   its own: pl-60's `lodging` block ends "A night's sleep is not optional", which is
   wrong for a meal, and the corridor readers' "an empty list above is not a gap to
   fill" is wrong for a town with real restaurants in it. The block is rendered per
   specialist, so `lodging`'s block and the prompts of `activities` and
   `conditions-and-gear` stay byte for byte what the base has (a test). `food`'s own
   prompt differs from the base's by Build 4's sentences, and by this block when food
   finds exist.
4. **Extend `food`'s `role`.** pl-58's string stays. Append that a premises is chosen
   from the finds given for its town when one fits the party and what they cannot eat,
   and that a kind of place is the fallback when the list is empty or nothing in it
   fits. The Log quotes the string before and after, as pl-60's quoted `lodging`'s.
   **This breaks a test pl-60 left green, on purpose.** `agent/test/prompt.test.ts` ›
   "the %s prompt is byte-identical to the base commit's, with and without places to
   sleep in the finds" runs `activities`, `food` and `conditions-and-gear` against
   pl-60's `pl60-base-prompts.json`. The appended sentences turn the `food` case red.
   Take `food` out of that list, keep the other two, and pin `food` in a new test
   against the same snapshot plus the sentences this step appends and nothing else
   (`Done when` 1). Say in the Log that the existing test was changed and why.
   `food` keeps respecting what the party said they cannot eat: nothing in a find's
   tags is evidence about a diet, and the block says so in as many words.
5. **Hostile text.** A restaurant's `name`, `description`, `website` and `cuisine`
   are a stranger's words. Keep pl-29's caps (`MAX_FIND_NAME_CHARS`, `MAX_FIND_TAGS`,
   `MAX_FIND_TAG_CHARS`), never fetch a URL from a tag, and add a fixture food find
   whose `name` carries an instruction, asserted to reach `food`'s prompt as quoted
   data.
6. **Measure the join for `food`.** At no cost: over the `food` candidates of the new
   run's sets B to D, count how many have a `place.name` equal to a find's `name` in the
   same record, after the folding pl-60 used (`matched of written`), beside pl-60's
   333 of 360 for `lodging` and 8 of 1,165 for the corridor readers. Do not add
   provenance on the strength of the count: pl-36 says what must be shown first, and a
   change is a new ticket.
7. **Re-measure with pl-57's harness.** Add `pl-62` to `invention.ts`'s stratum map,
   with `food` alone, since the web check follows `food`'s named premises; a label with
   no entry is refused, as pl-60 found. The label is `pl62-<date>`, which pl-60's
   generalised pattern already accepts. Classify the new run's places by pl-57's
   committed rubric, by hand: copy the rubric object byte for byte, carry the
   classifications of pl-58's and pl-60's files for a key already classified, and list
   in the Log the judgement cases a reader may reverse, with the sensitivity band they
   give (for `food`: a name that restates its locality plus a category, such as a
   `Restaurant de <town>`; a chain outlet from a tag Decision 1 included; a bar that
   serves no meals). Report `food`'s named-premises share on mentions and on places,
   split by set A and sets B to D, beside pl-58's 43 of 407 and 26 of 186 and pl-60's 41
   of 395 and 30 of 170, and **`lodging`'s share beside pl-60's 301 of 443 as the
   control**, since this ticket does not change what `lodging` is handed. Then
   web-check `food`'s named premises in pl-58's ordered-key procedure, up to 40 objects
   or all of them, in a general-purpose agent with WebSearch, as in pl-57, pl-58 and
   pl-60. Report the not-confirmed rate per object with a 95% Wilson interval beside
   pl-58's `food`-only count, which the Log computes from pl-58's committed
   `verdicts.json` (an object is `food`'s when `food` proposed any of its checked keys,
   and one proposed by both specialists is counted in each, said so). For each object
   not confirmed, the Log says whether it was **a wrong-town premises, a premises not
   found, a premises the web says closed, or other**, and whether the capture holds it
   as a map entry, so the stale-entry finding of pl-60 is counted for `food` and not
   assumed.
8. **Edit `tools/planner/CLAUDE.md` and one rules file, named here so the builder may.**
   After pl-60 three paragraphs of `tools/planner/CLAUDE.md` say which specialists read
   finds and that `lodging` reads the town pass's: the rule "A specialist reads the
   brief, and only the brief", the paragraph headed "Grounding may propose and not only
   check", and the paragraph "`coverage` names a corridor the ground was thin along".
   `.claude/rules/planner-unchecked-constraints.md` carries a clause pl-60 reworded in
   the same way. Reword each to say the town pass hands finds to `lodging` and `food`.
   Add no new rule; pl-60 checked that by counting the bold-led lines before and after
   (`grep -c '^\*\*'`), and this build does the same. `contract/src/unchecked.ts` has a
   comment on `coverage` that pl-60 extended to towns "nowhere to sleep in". If it
   names lodging alone, **stop and report**: pl-60's owner answer authorised that
   comment edit for pl-60 only, and a contract file is not edited unilaterally.
9. **Prepare the run's offline food finds, then stop: the paid run is the owner's
   reserved decision** (Decision 5). The Log records the authorisation's date before
   the run starts, and a run date that is the run's real date.

   **The preparation has a trap, found by running it at pl-60's head.** `run.ts` ›
   `lodgingFinds` answers sets B to D's town queries from `overpass-lodging-towns.json`
   through a stubbed `fetch` that picks a town's reply **by the point in the query body
   and by nothing else**, and answers `{ elements: [] }` for a point it does not know.
   A food query at the same town point therefore gets the lodging reply. Measured with
   the built adapter at pl-60's head (`3669c20b`) and that stub, offline: asked for kinds
   that the lodging reply holds none of, `nearbyPoint` makes one request and returns
   **no finds, not finds of the wrong kind**, because a find's kind comes from the
   element's own tags and only among the kinds asked. Gaspé: 24 finds for the lodging
   kinds, 0 for the corridor kinds; Percé 40 and 0; Forillon National Park 17 and 0. And
   **0 of the 140 named elements in the lodging capture carry any of Decision 1's food
   tags** (options (a), (b) and (c) each). So an unrouted stub would hand `food` an empty
   list in every set B to D record without any error, and the town pass would report
   "no places to eat" for towns the map may well have places to eat in (Build 1 counts
   them). The run's `food` join would show it, but only after the paid run.

   So, before the stop: store Build 1's capture as a checked-in fixture beside
   `overpass-lodging-towns.json` and **route the stub by the query's kinds as well as its
   point** (a clause is `"tourism"=…` for lodging and `"amenity"=…` or `"shop"=…` for
   food; under Decision 3 (b) the combined query is answered with both replies' elements).
   Make a query that matches no capture throw instead of answering `{ elements: [] }`,
   so a mis-routed query fails loudly. A test asserts that a lodging query is answered
   with the lodging reply, a food query with the food reply, and an unknown one by an
   error (`Done when` 13).

If the owner answers Decision 4 with option (b), the commit that records the answer
adds a Build step and a `Done when` line for it. They are not written here, because the
screen's shape depends on which tags the answer names.

## Decision — answered 2026-10-24 by the owner

Six decisions. **Decisions 1 to 4 were asked before a builder was dispatched**, because
each changes what is built, and the owner answered all four on 2026-10-24, each time as
the filing builder's recommendation, through the session's question. "Leave open" was
not offered as a listed option; a free-text answer was. **Decisions 5 and 6 are still
open**: **Decision 6 is asked at Build 1's stop**, with the capture's counts, since
"hold a question until you can bring a measurement", and **Decision 5 at the stop
before the paid run**, as pl-58's and pl-60's were. Their recommendations are the
filing builder's and are not settled.

**What was not measured when this was filed.** Overpass was unreachable from the filing
builder's sandbox (`curl -m 25` to `https://overpass-api.de/api/status` returned
`http=000` after 25 s on 2026-10-24; an earlier try returned HTTP 502), so
**no restaurant, café or bakery count exists** for any town. Everything below that
mentions restaurant density is a reason to measure it in Build 1, not a number.

### 1. Which OSM tags count as food?

Eleven were read from iD's tagging presets on GitHub
(`openstreetmap/id-tagging-schema`, `data/presets/<key>/<value>.json`, fetched on
2026-10-24 because the OSM wiki is not reachable from here, as pl-60 found). Each has
`geometry: ["point", "area"]`, so the area form is not optional here either:
`amenity=restaurant`, `cafe`, `fast_food`, `bar`, `pub`, `ice_cream`, `food_court`,
`biergarten`, `shop=bakery`, `shop=pastry` and `shop=deli` all return nodes, ways and
relations, and `overpassPointQuery`'s `nwr` clause and `out center tags` already ask for
all three.

- **(a) The meal set, without `fast_food`:** `amenity=restaurant|cafe|bar|pub` and
  `shop=bakery`. Costs: a town whose only food is a chain counter reads as thin, and
  the model falls back to a kind of place. Gains: `food`'s `role` asks for "meals that
  are part of the trip rather than fuel for it", and a closest-ten cap is not filled
  with chain outlets. `fast_food` is captured and counted apart in Build 1.
- **(b) The set the dispatch named:** (a) plus `amenity=fast_food`. Costs: chain
  outlets crowd a closest-first cap in a town with a strip. Gains: no town is empty
  because its only food is a counter.
- **(c) (b) plus `ice_cream`, `food_court`, `biergarten`, `shop=pastry` and `shop=deli`.**
  Costs: the largest replies and the most classification judgement. Gains: coverage of
  what a traveller might eat.
- **(d) Leave open.**

**Recommendation: (a).** It matches the sentence `food` already carries, and the
capture prices what it leaves out.

**Chosen: (a), by the owner on 2026-10-24.**

### 2. Which finds does `food` read?

`food` already reads the corridor pass's finds (pl-29), and none can be a restaurant.

- **(a) The town pass's food finds, added to the corridor finds it already reads.**
  Costs: a lunch on the road between two stops is in neither pass; `findsFor` grows
  a kind-based route for three readers. Gains: the finds sit in the same towns `food`
  writes `place.locality` for, `activities` and `conditions-and-gear` are untouched
  (a byte-identical test), and the town pass's caps and coverage sentences extend.
- **(b) The corridor pass's, by adding the food kinds to `DISCOVERY_KINDS`.** Costs:
  food kinds share `MAX_DISCOVERY_FINDS` = 40 with viewpoints, waterfalls, attractions
  and historic sites, so a corridor through towns fills the 40 with restaurants and the
  ranking (`CLOSEST_RESERVED` and notability backing) was designed for sites;
  `activities` and `conditions-and-gear` prompts change; the corridor pass
  asks the map for what lies within 6 km of a straight line between the two ends. Gains: a meal on the road.
- **(c) Both.** Costs: the sum of (a)'s and (b)'s, and two lists of restaurants that
  can name the same premises. Gains: both cases.
- **(d) Leave open.**

**Recommendation: (a).** `food`'s measured defects are about a premises in the wrong
town, which a town list reaches, and (b) changes two other specialists' prompts under a
cap built for sites. The road lunch is a gap this ticket names and does not close.

**Chosen: (a), by the owner on 2026-10-24.** `Done when` 1, 2, 7 and 13 stand as
written; the rewrites below are not taken.

`Done when` 1, 2, 7 and 13 are written for (a). If the owner answers (b) or (c), the
commit that records the answer rewrites them. In both, line 1 stops pinning `activities`
and `conditions-and-gear` to the base and pins them to a named snapshot that includes
the food kinds the corridor now hands them, and Builds 2 and 3 are reworded in the same
commit.

- **Under (b)** no town food query exists. Line 2's food query becomes the corridor
  pass's query with the food kinds added, at the corridor's own 6 km and not at a radius
  Decision 6 chose, and Decision 6 is moot. Line 13's "food query at the same point" is
  replaced by the corridor query carrying the food kinds, answered with the food
  capture's reply, and Build 9's stub is reworded to match. Line 7's coverage sentence
  for a town with no food finds is replaced by the corridor pass's own thin-corridor
  sentence (the town pass is not used for food), with a case for each of the six set A
  shapes that has a corridor.
- **Under (c)** the town pass stays, so lines 2 and 13 keep their town food query and
  Decision 6 still applies to it; each gains a case for the corridor pass's food kinds
  beside the town one, and line 7 keeps its town sentence and adds the corridor pass's
  thin-corridor sentence, with a case for each of the six set A shapes that has a
  corridor.

### 3. What does it cost in calls, and in what shape?

pl-60's Log gives the town pass's own cost per set A shape. From its table, the town
pass spends **2** queries for `road-trip`, **1** for `backcountry`, **0** for
`motorised-touring`, **1** for `city-and-culture`, **0** for `resort` and **3** for
`multi-city`, each with the `locate`s the pass adds (2, 0, 0, 0, 0 and 4, in the same order). The pass is
bounded at 8 of `MAX_GROUNDING_CALLS` = 40. These are derived from pl-60's table and
are not measured for `food`; Build 2 asserts the real numbers.

- **(a) One more `nearbyPoint` per located town, for the food kinds.** Adds the same
  number of queries again per shape (`road-trip` +2, `backcountry` +1,
  `city-and-culture` +1, `multi-city` +3, the other two 0), so the totals become 20,
  13, 6, 15, 4 and 26, and the pass's ceiling 12 of 40. The `locate`s are cache hits,
  so no more are paid. Costs: more requests to an Overpass instance that answered 429
  once in pl-60's 10 queries. Gains: `lodging`'s query text and reply are untouched,
  so `lodging` stays a clean control for the re-measure, and a food query that times
  out does not take the places to sleep with it.
- **(b) The food kinds in the same query as the lodging kinds.** The call counts do
  not change from pl-60's. Costs: the query text changes for `lodging` too, a larger
  reply on a path with a 28 s deadline whose slowest lodging capture took 30.1 s at
  `[timeout:80]` (pl-60's Build 1), and the per-town cap has to be per category or
  restaurants crowd the ten places to sleep out. A failed query then loses both.
  Gains: no extra requests.
- **(c) A separate food pass with its own `locate`s.** The same queries as (a) plus
  a repeat of any `locate` that missed, because a name nobody could locate is not
  cached (`multi-city`'s `Central Europe`: +1). Costs: more than (a) for no gain over
  it. Listed so the mapping is not hidden.
- **(d) Leave open.**

**Recommendation: (a),** for the control it keeps and the failure it isolates.
Build 1 times (b) once per town, so the answer can be revisited with a number.

**Chosen: (a), by the owner on 2026-10-24.** Build 1 still sends the combined query
once per town and records its time and reply size, so the answer can be revisited.

If the owner answers (b), the commit that records the answer rewords `Done when` 2 so
that "the food query" is the combined query, with its finds split by kind afterwards,
and `Done when` 4's numbers are pl-60's column unchanged. Build 9's stub then answers a
combined query with both captures' elements, and `Done when` 13 gains a case for it: a
combined query is answered with both captures' elements, the two replies split by kind
afterwards, and a query matching neither capture still throws.

### 4. Should a find be screened for staleness or existence?

pl-60's Log offered this as option (b) of its open decision and the owner chose to file
`food` first. The evidence is two events in nine objects, so it is a question to answer
with a measurement and not a rate. **One measurement was available without any network**
and is in the Log: pl-60's own lodging capture, 140 named distinct elements.

- **Contact tags, on two readings of which keys count** (140 named distinct elements
  in both). On the **exact keys** `website`, `phone` and `email`: `website` 49 of 140
  (35.0%), `phone` 25 (17.9%), `email` 15 (10.7%), at least one of the three 53
  (37.9%), none of them 87 (62.1%). On the **wider reading**, which also counts
  `contact:website`, `contact:phone`, `contact:email` and `url` (`website` ∪
  `contact:website` ∪ `url` 58, `phone` ∪ `contact:phone` 26, `email` ∪
  `contact:email` 16): at least one 62 (44.3%), none 78 (55.7%). The filing first
  printed the wider counts as though they were the exact keys' (round 1 below
  corrects it). Build 1 reports both readings for `food`.
- **`check_date` is on 3 of 140 (2.1%)**, `opening_hours` on 0 (lodging; food may differ,
  which Build 1 counts).
- **The nine web-checked objects:** the two not confirmed, `Le Loup Marin` (node, tags:
  `building`, `canvec:*`, `name`, `tourism`) and `La Rêvasse` (way, a street address and
  `internet_access`), carry **no contact tag**. Of the seven that exist, four carry
  `website` (Auberge internationale de Forillon, Motel et Chalets Natabel, Motel Bellevue,
  Manoir de Percé) and three carry none (Motel L'Eglantier, Auberge La Petite École de
  Forillon, Camping Petit-Gaspé). **A screen on "no website, phone or email" flags
  5 of 9, catches 2 of 2 misses, and flags 3 of 7 that exist**, on either reading:
  none of the five carries a `contact:*` key or `url` either.

- **(a) No screen in this ticket.** The re-measure reports `food`'s tag presence and its
  not-confirmed objects by tag, and the owner decides with `food`'s numbers. Costs: a
  stale restaurant can be handed to the model with nothing to say it is unverified.
  Gains: the sample doubles on the same rubric before a rule is built on 2 events.
- **(b) A code-side screen on tags:** mark, or drop, a find with no `website`, `phone`
  or `email`, or with a `check_date` older than a threshold. Costs: on lodging's numbers
  a "drop" would remove more than half of the named finds (62.1% on the exact keys,
  55.7% on the wider reading) and three real premises of seven;
  `check_date` is on 2.1% so cannot carry the screen alone; and the model already sees
  every tag in the block, so a "mark" adds a signal it can read for itself. Gains: it
  reaches exactly the class pl-60 found.
- **(c) A lookup after the specialists run** (pl-57's option 3): check each named
  premises on the web. Costs: a new seam, a vendor or a search tool in the product
  path, and its own fixtures; it is its own ticket and not a `food` detail. Gains: the
  only option that finds a closed place that still has a website.
- **(d) Leave open.**

**Recommendation: (a),** because the measured screen is wrong about three real
premises in seven and the class is two events. The Log's tag-presence table for `food`
is what lets the owner answer (b) or (c) with `food`'s numbers.

**Chosen: (a), by the owner on 2026-10-24.** No Build step or `Done when` line is
added for a screen.

### 5. The paid run's shape (asked at the stop before it)

pl-60's observed cost per session, from its Log: Haiku 5.5 `low` $0.1558,
`medium` $0.1836, `high` $0.2348, Sonnet 5.5 `low` $2.2501, Opus 5.5 `low` $4.3891;
110 records, $7.2134 in all against a $10 bound, and pl-58's was 112 records at $7.08.
These are lodging-prompt costs, and `food`'s block carries more finds per town
(unmeasured), so the totals below are a floor.

- **(a) Mirror pl-58 and pl-60:** the five model and effort pairs over `run.ts`'s sets
  A to D, about 110 records, about $7.2, with `--max-usd` split per session under a
  $10 bound.
- **(b) Drop Opus:** 92 records, about $2.8 on pl-60's costs. Loses the one pair that
  was in both earlier runs at the strongest model, so the comparison with pl-58 and
  pl-60 is over four pairs and not five, and Opus's 55 of 66 lodging join is not
  matched by a `food` figure.
- **(c) Sonnet and Opus only:** 37 records, about $6.6. Loses Haiku's three efforts,
  which were 73 of pl-60's 110 records and its cheapest evidence across efforts; the
  total falls by under $0.6 against (a), so it saves almost nothing for what it drops.
- **(d) Leave open.**

**Recommendation: (a),** so the re-measure is the same shape as both earlier runs and
`lodging` stays a comparable control. The decision stays the owner's, as the model
families, efforts, runs and `--max-usd` were for pl-58 and pl-60.

### 6. The food pass's radius and per-town cap (asked at Build 1's stop)

pl-60's owner chose a 10 km radius for lodging from a capture of the nine towns, and
its builder chose ten finds per town, the closest first. Restaurants are denser and a meal is eaten close to where
the party stays.

- **(a) The same, 10 km and ten.** Costs: the ten nearest the town's point, in a dense
  town, are all in its centre, and a bakery 9 km out is not reached. Gains: one number
  for both lists.
- **(b) A smaller radius, such as the corridor's 6 km, with the same cap.**
  Costs: a thinner town loses finds the capture counted at 10 km. Gains: closer meals.
- **(c) Choose from Build 1's table of counts at 2, 6 and 10 km,** as the owner chose
  pl-60's radius from its own. Costs: the owner reads one table at the stop that Build 1
  already has, and the code waits for the answer. Gains: the radius and cap come from
  `food`'s own counts and not from lodging's.
- **(d) Leave open.**

**Recommendation: (c),** because restaurant density is unmeasured, so (a) and (b) are
each a guess at a number the capture will give, and (c) costs nothing beyond the stop
Build 1 makes anyway.

## Done when

Each line is provable by the test or command it names. The towns are the nine of Build
1; the shapes are the six of Build 2.

1. **Routing** (for Decision 2 (a); Decision 2 says how it is reworded otherwise). In
   `tools/planner/agent/test/prompt.test.ts` (or the spec holding pl-60's equivalent),
   which no longer runs `food` in its existing byte-identical-to-base test (Build 4), the prompts of `activities`, `conditions-and-gear` and
   `lodging`, built from one fixed brief and one fixed `Find[]` that includes a lodging
   find and a food find, are byte-identical to the same three prompts at the build's
   base commit (the Log names its sha; a snapshot taken at that commit), and `food`'s
   prompt built from the same inputs with no food find equals the base's `food` prompt
   plus the sentences Build 4 appends, and nothing else.
2. **The query, offline** (for Decisions 2 (a) and 3 (a); those decisions say how it is
   reworded otherwise). Against a checked-in Overpass payload captured through the
   built `overpassPointQuery` for the nine towns, at the radius Decision 6 chose, the
   food query returns the finds
   inside each town's radius and none outside it, and returns a way or a relation as a
   find with a coordinate from its `center` and a source URL of its own element type.
   The Log gives, for each of the nine towns, the count of food finds including the zero
   towns, split by element type and by tag value, and the tag-presence table of Build 1
   (`website`, `phone`, `email`, `opening_hours`, `check_date`) over the named finds, on
   the exact keys and on the wider reading Decision 4 defines.
3. **The six decisions answered.** The heading above reads _Decision — answered_ once
   Decisions 1 to 4 are, and the Log names the option chosen for each of the six, who
   chose it and the date; Decisions 5 and 6 are recorded there at their stops. The tags
   of Decision 1, the pass of Decision 2, the query shape of Decision 3 and the radius
   and cap of Decision 6 are the ones the code ships.
4. **Calls.** For each of the six set A shapes (`backcountry`, `city-and-culture`,
   `motorised-touring`, `multi-city`, `resort`, `road-trip`), a run under the scripted
   provider spends the number of grounding calls the Log asserts, by method, beside the
   pl-60 column. The test is in `tools/planner/api/test/`, asserts calls and not timing,
   and the town pass spends no more than the ceiling the Log states.
5. **Re-plans.** `revisions.test.ts` (or its successor) pins `nearbyCalls` and
   `nearbyPointCalls` for a re-plan naming only `lodging`, only `food` and only
   `activities`, at the numbers the Log states.
6. **Hostile text.** A food find whose `name` is an instruction reaches `food`'s prompt
   as quoted data, and the adapter makes one request per call for a reply whose tags
   hold two URLs (the equivalents of pl-60's two tests).
7. **No finds** (for Decision 2 (a); Decision 2 says how it is reworded otherwise). With
   a scripted provider whose food query returns no finds, each of
   the six set A shapes produces the same days as the build's base commit does for the
   same brief and scripted model, byte for byte, and the plan carries a coverage
   sentence naming each town that has no food finds.
8. **The live run.** The Log gives the command, the families, efforts, runs and
   `--max-usd` the owner set, the authorisation's date, the measured cost, and two join
   counts as `matched of written`: the new run's `food` candidates in sets B to D, and
   its `lodging` candidates in sets B to D, each with its record count.
9. **The re-measure.** The Log gives `food`'s named-premises share on mentions and on
   places for the new run, split into set A and sets B to D, beside pl-58's 43 of 407
   and 26 of 186 and pl-60's 41 of 395 and 30 of 170; `lodging`'s share beside pl-60's
   301 of 443; the sensitivity band of the judgement cases it lists; and the
   population and files each count comes from.
10. **The web check.** The Log gives `food`'s not-confirmed rate per object with its
    object count and a 95% Wilson interval, beside pl-58's `food`-only figure computed
    from pl-58's `verdicts.json`, and for each object not confirmed its class
    (wrong-town, not found, closed or other) and whether the capture holds it as a map
    entry.
11. **The harness.** `invention.ts --after pl62-<date>` accepts the label and its stratum
    is `food`'s named premises alone (`api/test/invention-population.test.ts`, a case
    beside pl-60's); and three commands exit 0, with each exit code taken without a
    pipe: `PLANNER_INVENTION_OFFLINE=1 PLANNER_INVENTION_CHECK=1 node --import tsx
tools/planner/api/test/live/invention.ts` with no argument, with
    `--after pl58-2026-10-21`, and with `--after pl60-2026-10-24`.
12. **The documents.** The three paragraphs of `tools/planner/CLAUDE.md` and the rules
    file clause of Build 8 name `food` as a reader of the town pass, and the diff adds
    no rule: `grep -c '^\*\*' tools/planner/CLAUDE.md` gives the same count before and
    after.
13. **The offline stub** (for Decisions 2 (a) and 3 (a); those decisions say how it is
    reworded otherwise). A spec in `tools/planner/api/test/` shows that the stubbed
    `fetch` `run.ts` builds for the town queries answers a lodging query with the
    lodging capture's reply for that town, a food query at the same point with the food
    capture's reply, and a query matching neither capture with a thrown error and not
    with an empty reply. It runs offline.
14. **Gates.** `npm run check` exits 0, and `npm test -- --project planner` passes with
    the file and test counts the Log gives. The e2e suite and the image gate do not run
    locally; the Log says so rather than reporting them green.

## Log

**2026-10-24 — Filed (builder, Sonnet 5.5), at the orchestrator's dispatch, on the
owner's answer of the same day to pl-60's open decision.** `node scripts/next-id.mjs pl`
printed `next free: pl-62` (it names `PR#608 pl-61` as the last id held). Docs only; no
source changed.

- **Re-read, not relayed.** The figures in _Why_ were read from pl-60's ticket as
  `git show origin/pl-60-lodging-discovery:tools/planner/docs/work/pl-60-lodging-discovery.md`
  printed them at head `3669c20b`, and the code facts (`findsFor`, the kinds lists, the
  caps, the call table) from that branch's `agent/src/prompt.ts`, `agent/src/grounding.ts`,
  `api/src/runs/lodging.ts` and `api/src/runs/discovery.ts`. Two things the dispatch
  carried were checked: the 49.2–75.4% band is in PR #607's gate 2 comment and in pl-60's
  Log (the Log first said 57.3–75.4%, and was corrected at landing); and pl-60's
  Log says the owner left the firewall open after the web check.
- **The tag set, fetched.** `restaurant`, `cafe`, `fast_food`, `bar`, `pub`, `ice_cream`,
  `food_court`, `biergarten` under `data/presets/amenity/` and `bakery`, `pastry`,
  `deli` under `data/presets/shop/` of `openstreetmap/id-tagging-schema`, each by
  WebFetch of `raw.githubusercontent.com/.../main/data/presets/<key>/<value>.json` on
  2026-10-24. All eleven report `geometry: ["point", "area"]` and a single tag; the
  `restaurant` preset's `terms` include `bar`, `brasserie`, `cafe` and `canteen`. That
  is the editor's own "used on", as pl-60 said of the lodging presets, and not the OSM
  wiki's.
- **Measured offline, on pl-60's lodging capture (the only OSM data in the repo).**
  `git show origin/pl-60-lodging-discovery:tools/planner/api/test/fixtures/overpass-lodging-towns.json`
  read by a scratch script that de-duplicates the nine towns' elements by `type/id` and
  counts tag keys over the named ones: `distinct elements: 155 named: 140`;
  `website 58 of 140 41.4%`; `phone 26 of 140 18.6%`; `email 16 of 140 11.4%`;
  `opening_hours 0 of 140 0.0%`; `check_date 3 of 140 2.1%`; `any of website|phone|email
62 of 140`. **(These five counts fold in `contact:*` and `url`, which the line does not
  say; round 1 below corrects them to the exact keys' 49, 25, 15, 53.)** For the nine objects pl-60 web-checked, a second pass found `website` on
  Auberge internationale de Forillon, Motel et Chalets Natabel, Motel Bellevue and
  Manoir de Percé, and no contact tag on the other five (Le Loup Marin and La Rêvasse,
  the two not confirmed; Motel L'Eglantier, Auberge La Petite École de Forillon and
  Camping Petit-Gaspé). The scratch scripts (`tags.mjs`, `nine.mjs`) are not committed.
  **This is lodging data.** Whether restaurants carry contact tags at a similar rate is
  not known, and Build 1 measures it.
- **Not measured, and why.** Restaurant, café and bakery density for any town: Overpass
  was unreachable from this sandbox on 2026-10-24 (`curl -m 25 -A 'webtools-planner/0.9
(pl-62 filing probe)' https://overpass-api.de/api/status` → `http=000 t=24.999957`; an
  earlier call returned HTTP 502, body discarded). The call counts in Decision 3 are
  derived from pl-60's table and not run. Food-only not-confirmed rate for pl-58:
  pl-58's Log gives no `food`-only object count and its `verdicts.json` was not read
  here; Build 7 computes it.
- **`depends_on` is pl-60 alone.** pl-61 is not a prerequisite: pl-60's own Log
  captured its fixtures with a user agent through a scratch script and wrote its tests
  against the checked-in payload, and Build 1 here does the same. It is named in _Why_
  so the builder knows a deployment on the public instance gets no `food` finds until
  it lands.
- **Difficulty `hard`, rated for the work once answered**, as `docs/01-TICKETS.md` asks.
  Weighed against `standard`: the seam, the town pass, the harness label and the
  coverage machinery already exist from pl-60, which is the case for `standard`. It is
  `hard` because what is left is judgement and not mechanism: the routing change that
  keeps two other specialists' prompts byte-identical, a per-category cap in a pass
  whose lists differ in size by an amount nobody has measured, a block and a `role` for
  a specialist whose job is not "a night is not optional", a hand classification with
  new judgement cases (chains, bars, `Restaurant de <town>`), two stops for the owner,
  and a paid run read for an effect `lodging`'s control must be allowed to qualify.
  Decision 4's option (b) or (c) would raise the size and not the rating.
- **Folded in: nothing.** The filing is the whole of this branch. pl-60's Log says
  its landing adds no roadmap row for this ticket, and none is added here either.
- **Checks at filing**: recorded in the dispatch's report (`npx oxfmt`, `npm run
check`, `node scripts/status.mjs --json`, the title check and preflight's fast
  checks).
- **No `## Review` section.** A filing has no work to review, and a gate on the filing
  is recorded outside it (`docs/01-TICKETS.md`, _The review gate_).

**2026-10-24 — Round 1: gate 1's five findings (builder, Sonnet 5.5).** The narrow gate on
`a4d3c4cb` returned CONCERNS (2 med, 3 low); its report is on PR #612. The owner chose,
the same day, to fix all five, including an investigation of F4, to keep F1 graded `med`
(the other option was to regrade it `high`, which is FAIL), and to **leave Decisions 1 to
6 open for the batch that builds this ticket**. The other options were to answer the four
pre-dispatch decisions with the filing's recommendations, or for the owner to answer
them. None is answered here, and `status` stays `needs-decision`.

- **F1 (med), the tag counts — reproduced and fixed.** On the same 140 named elements of
  `overpass-lodging-towns.json`, counted on the exact keys: `node stale.mjs data/towns.json
data/verdicts.json` (the gate's scripts, run against the gate's extraction of pl-60's
  fixture at `3669c20b`) printed `raw elements 158 distinct 155 named 140`, `website 49
of 140 35.0%`, `phone 25 of 140 17.9%`, `email 15 of 140 10.7%`, `any of
website|phone|email 53 of 140; none 87 (62.1%)`. `node variants.mjs data/towns.json`
  printed `website|contact:website|url 58`, `phone|contact:phone 26`,
  `email|contact:email 16`, `any of website,url,contact:*,phone,email 62`. So the
  filing's 58, 26, 16, 62 and 78 were the wider reading's. My scratch script counted
  `website`, `contact:website` and `url` together and I wrote the result as the three
  keys'. Decision 4 now gives both readings by name, the screen's 5 of 9, 2 of 2 and 3 of
  7 hold on both (`keys.mjs` shows the five carry no `contact:*` key or `url`), the
  "halve a town's list" cost reads "more than half (62.1% exact, 55.7% wider)", and
  Build 1 and `Done when` 2 report both readings for `food`. The recommendation is
  unchanged: the corrected figures make the drop cost larger.
- **F2 (med), two acceptance lines assume Decision 2 (a) — fixed.** Decision 2 now
  carries a paragraph, as Decision 4 does, saying how the answer rewrites `Done when` 1
  and 7 and Builds 2 and 3 if the owner picks (b) or (c). `Done when` 1 and 7 say they
  are written for (a). Decision 3 gained the matching paragraph for its (b), which
  leaves `Done when` 2's "the food query" with no separate query (the gate folded this
  into F2).
- **F3 (low), pl-60's `food` pin — reproduced and fixed in the brief.**
  `prompt.test.ts` at pl-60's head has `test.each(["activities", "food",
"conditions-and-gear"])` › "the %s prompt is byte-identical to the base commit's, with
  and without places to sleep in the finds", against `pl60-base-prompts.json`: three pins,
  not two. Build 4 now names the existing test, says Build 4's appended sentences turn its
  `food` case red on purpose, and says to take `food` out of that list and pin it in a new
  test against the same snapshot plus the appended sentences. Build 3 and _Why_ no
  longer say the three corridor readers' prompts stay byte-identical.
- **F4 (low), the paid run's stub — investigated, and the answer is in Build 9.** The
  stub is `run.ts` › `lodgingFinds`' `fetchStub`: it picks a town's reply by
  `query.includes(",<lat>,<lon>);")` and answers `{ elements: [] }` for no match. To find
  out what the adapter makes of a lodging reply under other kinds, a second tree at
  pl-60's head (`git worktree add --detach … 3669c20b`, the farm, `npm run build`)
  loaded the built `ValhallaGroundingProvider` with a copy of that stub and asked
  `nearbyPoint` at 10 km with three kind lists. `node --import tsx f4.mts <tree>`
  (scratch, not committed):

  ```
  Forillon National Park   lodging kinds (control)      requests 1 finds 17 [["motel",3],["guest-house",1],["camp-site",10],["hotel",1],["hostel",2]]
  Forillon National Park   corridor kinds (disjoint)    requests 1 finds 0 []
  Forillon National Park   unknown kinds: restaurant, cafe  requests 1 finds 0 []
  Gaspé                    lodging kinds (control)      requests 1 finds 24 [["hotel",4],["chalet",9],["camp-site",1],["guest-house",3],["apartment",1],["motel",4],["caravan-site",2]]
  Gaspé                    corridor kinds (disjoint)    requests 1 finds 0 []
  Gaspé                    unknown kinds: restaurant, cafe  requests 1 finds 0 []
  Percé                    lodging kinds (control)      requests 1 finds 40 [...]
  Percé                    corridor kinds (disjoint)    requests 1 finds 0 []
  Percé                    unknown kinds: restaurant, cafe  requests 1 finds 0 []
  distinct elements 155, named 140
  Decision 1 (a): restaurant|cafe|bar|pub, shop=bakery: 0 of 140 []
  Decision 1 (b): (a) + fast_food: 0 of 140 []
  Decision 1 (c): (b) + ice_cream|food_court|biergarten, shop=pastry|deli: 0 of 140 []
  ```

  (The labels are shortened here; the control's counts equal pl-60's 17, 24 and 40.) So
  the answer is **no finds, not finds of the wrong kind**: `findFrom` takes a find's
  kind from `kindOf`, which matches the element's own tags and only among the kinds the
  request asked, and none of the lodging capture's 140 named elements carries a food
  tag. **What is not measured:** there is no food kind at pl-60's head, so the third
  row passes names the type system does not know, and the 0 of 140 applies the tags
  Decision 1 lists, not a built food matcher. It is the same code path, and the claim is
  that path's reading, not a run of code that does not exist yet. The second tree was
  removed afterwards. The direction is Build 9: store a food capture, route the stub
  by the query's kinds as well as its point, throw on a query that matches no capture
  (a new `Done when` line, 13). **Placed in Build 9 and not Build 7**, as the dispatch
  said, because Build 7 is the re-measure and the stub is the paid run's preparation.

- **F5 (low), decision format — fixed.** Decision 6 (c) now lists a cost and a gain and
  its recommendation gives a reason. Decision 5's (b) and (c) now say what each loses
  against pl-58 and pl-60's five-pair shape: (b) four pairs and no Opus figure, (c) 73
  of pl-60's 110 records and under $0.6 saved.
- **Checks at this round:** recorded in the dispatch's report (`npx oxfmt`, `npm run
check`, `node scripts/status.mjs --json`, preflight).

**2026-10-24 — Round 2: gate 2's remaining clauses (fixer, Sonnet 5.5).** Gate 2 on
`2bb857b4` returned CONCERNS (1 med, 2 low; no high), its report is on PR #612, and
the round was applied under the severity floor with no gate 3. The text only changed;
Decisions 1 to 6 stay open and `status` stays `needs-decision`.

- **F2 (med), clause (i), Decision 2 (b) leaves lines 2 and 13 unmeetable.** Decision 2's
  paragraph now names `Done when` 1, 2, 7 and 13, and gives (b) its own rewrite: line 2's
  food query becomes the corridor query with the food kinds at the corridor's 6 km,
  Decision 6 is moot, line 13's food case becomes the corridor query carrying the food
  kinds with Build 9's stub reworded to match, and line 7 takes the corridor pass's
  thin-corridor sentence. Lines 2 and 13 now say they are written for Decisions 2 (a)
  and 3 (a).
- **F2 (med), clause (ii), (c) lost its town sentence in line 7.** The paragraph is now
  split into a (b) rule and a (c) rule. Under (c) lines 2 and 13 keep the town food
  query and gain a corridor case, Decision 6 still applies, and line 7 keeps its town
  sentence and adds the corridor pass's thin-corridor sentence.
- **F2 (med), clause (iii), Decision 3 (b) left `Done when` 13 unchanged.** Decision 3's
  paragraph now says line 13 gains a case: a combined query is answered with both
  captures' elements, split by kind afterwards, and a query matching neither still
  throws.
- **F3 (low), Build 2 still compared `food` to the base.** Build 2's test now builds the
  prompts of `activities` and `conditions-and-gear` and compares them with the base's,
  and says `food`'s prompt changes on purpose (Build 4, `Done when` 1). `lodging`'s
  prompt is pinned by `Done when` 1.
- **low, Build 9's "towns the map has plenty in".** Reworded to "towns the map may well
  have places to eat in (Build 1 counts them)", since no count exists.
- **Dropped by gate 2, not changed:** the F4 bullet's "as the dispatch said" and Build
  7's execution order.
- **Checks at this round:** recorded in the dispatch's report (`npx oxfmt`, `npm run
check`, `node scripts/status.mjs --json`, preflight).
- **Thread:** gate 1's and gate 2's full reports are comments on PR #612.

**2026-10-24 — Decisions 1 to 4 answered (owner, through the session's question).**
`status` moves from `needs-decision` to `ready` in this commit, as `docs/01-TICKETS.md`
says, and the heading reads _Decision — answered_. The four were put to the owner in one
question with the filing's options, the recommendation first; the owner chose the
recommendation each time: **1 (a)** the meal set without `fast_food`
(`amenity=restaurant|cafe|bar|pub`, `shop=bakery`); **2 (a)** the town pass's food
finds added to the corridor finds `food` already reads; **3 (a)** one more
`nearbyPoint` per located town; **4 (a)** no screen. Decisions 5 and 6 stay open, to be
asked at their stops. `difficulty` stays `hard`.

- **pl-60 has merged**, as `aa834403` (#607), after this ticket was filed. The planner
  tree there is pl-60's branch head `3669c20b` unchanged (`git diff --stat 3669c20b
aa834403 -- tools/planner` lists only this ticket and pl-61's), so every "on pl-60's
  branch" and "at pl-60's head" above reads as `main` for code. The branch is deleted
  and `3669c20b` is not an ancestor of `main`, so it stands only as the provenance of
  the measurements made at it. The fixtures Build 1 and 9 name are on `main`:
  `api/test/fixtures/overpass-lodging-towns.json` and
  `agent/test/fixtures/pl60-base-prompts.json`.

**2026-10-24 — Build 1: the food capture, and the counts Decision 6 is asked from
(builder, Opus 5.5).** Branched from `89a38d30` (`origin/main`) as
`pl-62-food-town-pass`. Stopped here, as Build 1 says: **no source, test or fixture
changed**. The scratch scripts and every raw reply are in the dispatch's scratch
directory, `pl-62/build/` (`capture.mjs`, `retry.mjs`, `count.mjs`, `combined.mjs`) and
`pl-62/build/raw/` (24 files, one per request, each holding the query, the user agent,
the status, the time and the reply text verbatim). Nothing of it is checked in: the
fixture Build 9 and `Done when` 2 name is captured at the radius Decision 6 chooses,
through `overpassPointQuery` once Build 2 gives it the food kinds, so this capture is
the evidence for the decision and not that fixture.

- **Network.** `curl -s -m 40 -A 'webtools-planner/0.9 (pl-62 food capture)'
https://overpass-api.de/api/status` → `http=200 t=38.472164`. The filing's
  `http=000` was the sandbox of the day, not the instance.
- **The query, and what the brief had wrong about it.** Build 1 says to build the text
  "through the built `overpassPointQuery`". That cannot be done before the stop: the
  function maps `DiscoveryKind`s through `KIND_FILTERS`, which has no food kind until
  Build 2 adds one, and Build 1 writes no code. So `capture.mjs` builds the text with a
  copy of the function's template that takes filters directly, and **first proves the
  copy byte-identical to the built function**: for each of the nine towns,
  `pointQuery(point, 10000, <the eight lodging filters>, 28)` equals both
  `overpassPointQuery(point, 10_000, LODGING_KINDS, 28)` from `api/dist` and the
  `query` pl-60 stored in `overpass-lodging-towns.json` (printed `template check: 9 of 9
towns equal overpassPointQuery and the stored query`). The food query is then that
  template with one `nwr[...]` clause each for `"amenity"="restaurant"`, `"cafe"`,
  `"bar"`, `"pub"`, `"shop"="bakery"` and, counted apart, `"amenity"="fast_food"`,
  `around:25000` at each town's `towns[].point`, `[timeout:80]` (pl-60's for 25 km),
  `out center tags;`.
- **How it was sent.** `fetch` from Node 22.23.3, `POST` to
  `https://overpass-api.de/api/interpreter`, headers `content-type: text/plain` and
  `user-agent: webtools-planner/0.9 (pl-62 food capture)`, not through the adapter
  (whose `user-agent: node` is answered 406, pl-61). Serial, 5 s apart. Commands:
  `node capture.mjs <worktree> <scratch>/pl-62/build`, then for the 502s below
  `node retry.mjs <worktree> <scratch>/pl-62/build "food25:Forillon National Park"
"combined10:Bonaventure" "combined10:Forillon National Park" "combined10:Gaspé"
"combined10:Gaspésie"`, then `node count.mjs raw` and `node combined.mjs raw
<worktree>/tools/planner/api/test/fixtures/overpass-lodging-towns.json`, each run
  from `pl-62/build/`.
- **Requests and timings: 24 to Overpass, 16:44:40 to 17:00:05 UTC**, plus the status
  probe. No HTTP 429. **Six HTTP 502s**, each in 0.35 to 0.38 s, with the body "This
  Overpass API server is currently at capacity … Retry your request using exponential
  backoff". The brief's "one retry after an HTTP 429" did not cover them, so
  `retry.mjs` re-asked each 502 after 30 s, then 60 s, at most three times; one (Gaspé's
  combined query) needed two re-asks. The food queries: 9 HTTP 200 in 22.1 to 42.0 s,
  one of them Forillon's re-ask (31.4 s), no `remark`. The combined queries: below.
- **What a find is, here.** As `findFrom` keeps it: a coordinate (`lat`/`lon`, or
  `center`), a non-empty trimmed `name`, and a tag among the asked ones; within a
  radius by haversine from the town's point to that coordinate, as `nearbyPoint`
  re-filters. Counted offline from the one 25 km reply per town. A cross-check: the
  combined query below asks the server for 10 km directly, and its food elements per
  town (named and unnamed) equal this count's 10 km named plus unnamed, town for town.

**Food finds (Decision 1 (a)'s tags) by town and radius, by element type**
(`n`ode, `w`ay, `r`elation):

| Town                   | 2 km           | 6 km            | 10 km           | 25 km             |
| ---------------------- | -------------- | --------------- | --------------- | ----------------- |
| Amqui                  | 7 (n4 w3 r0)   | 7 (n4 w3 r0)    | 9 (n6 w3 r0)    | 18 (n13 w5 r0)    |
| Bonaventure            | 7 (n4 w3 r0)   | 8 (n5 w3 r0)    | 8 (n5 w3 r0)    | 13 (n10 w3 r0)    |
| Carleton-sur-Mer       | 6 (n6 w0 r0)   | 6 (n6 w0 r0)    | 6 (n6 w0 r0)    | 20 (n15 w4 r1)    |
| Forillon National Park | 0              | 1 (n1 w0 r0)    | 2 (n2 w0 r0)    | 20 (n20 w0 r0)    |
| Gaspé                  | 15 (n15 w0 r0) | 15 (n15 w0 r0)  | 17 (n17 w0 r0)  | 20 (n20 w0 r0)    |
| Gaspésie (peninsula)   | 0              | 0               | 0               | 0                 |
| Matane                 | 15 (n8 w7 r0)  | 17 (n9 w8 r0)   | 17 (n9 w8 r0)   | 21 (n11 w10 r0)   |
| Percé                  | 19 (n10 w9 r0) | 21 (n11 w10 r0) | 23 (n13 w10 r0) | 29 (n16 w13 r0)   |
| Rivière-du-Loup        | 7 (n7 w0 r0)   | 33 (n29 w4 r0)  | 35 (n31 w4 r0)  | 41 (n35 w6 r0)    |
| **All 9, summed**      | 76 (n54 w22)   | 108 (n80 w28)   | 117 (n89 w28)   | 182 (n140 w41 r1) |
| All 9, distinct        | 76             | 108             | 116             | 161               |

- **Two zero localities at 2 km and one at 6 and 10 km**, and neither is a town: the
  peninsula has none at any radius, and the park has 0, 1 and 2. **Forillon National
  Park's 25 km reply holds exactly Gaspé's 27 elements** (the same `type/id` set; the
  query texts differ), so the park's food is Gaspé's and only past 10 km. One element is
  in both Gaspé's and Forillon's 10 km lists, which is why 117 summed is 116 distinct.
- **Ways are 28 of 117 (23.9%) at 10 km**, against lodging's 65 of 141, and only one
  relation exists at any radius. The area form still matters: Matane's 17 include 8
  ways and Percé's 23 include 10.
- **Rivière-du-Loup's finds lie mostly 2 to 6 km from its point**: 7 at 2 km, 33 at 6 km.

**By tag value**, counted apart, so an element carrying two meal tags counts under each
(two do: `Café boulangerie Toujours Dimanche`, node 14313763800, `amenity=restaurant`
and `shop=bakery`; `Le Fournand Boulangerie`, way 598360367, `amenity=cafe` and
`shop=bakery`). Restaurant / café / bar / pub / bakery:

| Town                   | 2 km                | 6 km                  | 10 km                 | 25 km                  |
| ---------------------- | ------------------- | --------------------- | --------------------- | ---------------------- |
| Amqui                  | 3 / 1 / 1 / 2 / 0   | 3 / 1 / 1 / 2 / 0     | 4 / 1 / 1 / 3 / 0     | 9 / 2 / 3 / 4 / 0      |
| Bonaventure            | 5 / 0 / 0 / 1 / 1   | 6 / 0 / 0 / 1 / 1     | 6 / 0 / 0 / 1 / 1     | 8 / 2 / 0 / 1 / 2      |
| Carleton-sur-Mer       | 3 / 1 / 1 / 0 / 1   | 3 / 1 / 1 / 0 / 1     | 3 / 1 / 1 / 0 / 1     | 11 / 4 / 2 / 2 / 1     |
| Forillon National Park | 0 / 0 / 0 / 0 / 0   | 1 / 0 / 0 / 0 / 0     | 2 / 0 / 0 / 0 / 0     | 10 / 5 / 3 / 1 / 1     |
| Gaspé                  | 6 / 5 / 2 / 1 / 1   | 6 / 5 / 2 / 1 / 1     | 8 / 5 / 2 / 1 / 1     | 10 / 5 / 3 / 1 / 1     |
| Gaspésie               | 0                   | 0                     | 0                     | 0                      |
| Matane                 | 8 / 2 / 3 / 2 / 1   | 9 / 3 / 3 / 2 / 1     | 9 / 3 / 3 / 2 / 1     | 13 / 3 / 3 / 2 / 1     |
| Percé                  | 15 / 1 / 0 / 2 / 2  | 16 / 2 / 0 / 2 / 2    | 17 / 2 / 0 / 3 / 2    | 20 / 4 / 1 / 3 / 2     |
| Rivière-du-Loup        | 4 / 2 / 1 / 0 / 0   | 19 / 5 / 3 / 5 / 1    | 20 / 6 / 3 / 5 / 1    | 24 / 8 / 3 / 5 / 1     |
| **All 9, summed**      | 44 / 12 / 8 / 8 / 6 | 63 / 17 / 10 / 13 / 7 | 69 / 18 / 10 / 15 / 7 | 105 / 33 / 18 / 19 / 9 |

**What the code would drop or exclude, summed over the nine (2 / 6 / 10 / 25 km):**
food elements with no name, which `findFrom` drops, 1 / 4 / 7 / 13 (at most 4 in one
town, Matane at 10 km). **`amenity=fast_food`, excluded by Decision 1 (a)**, named
18 / 24 / 26 / 42 (unnamed 1 / 1 / 2 / 7). At 10 km by town: Amqui 3, Bonaventure 1,
Carleton-sur-Mer 1, Forillon 2, Gaspé 3, Gaspésie 0, **Matane 10**, Percé 1,
Rivière-du-Loup 5. So the exclusion costs 26 finds against the 117 kept (22.2%), and
in Matane 10 against 17.

**Tag presence over the named food finds, de-duplicated by `type/id` across towns.**
Beside it, the lodging capture's 140 at 10 km from Decision 4 (exact keys).

| Key                       | Food, 10 km: 116, exact | Food, wider reading | Food, 25 km: 161, exact | Lodging, 10 km: 140, exact |
| ------------------------- | ----------------------- | ------------------- | ----------------------- | -------------------------- |
| `website`                 | 31 (26.7%)              | 31 (26.7%)          | 36 (22.4%)              | 49 (35.0%)                 |
| `phone`                   | 22 (19.0%)              | 22 (19.0%)          | 29 (18.0%)              | 25 (17.9%)                 |
| `email`                   | 5 (4.3%)                | 5 (4.3%)            | 6 (3.7%)                | 15 (10.7%)                 |
| at least one of the three | 36 (31.0%)              | 36 (31.0%)          | 46 (28.6%)              | 53 (37.9%)                 |
| none of the three         | 80 (69.0%)              | 80 (69.0%)          | 115 (71.4%)             | 87 (62.1%)                 |
| `opening_hours`           | 12 (10.3%)              |                     | 16 (9.9%)               | 0 (0.0%)                   |
| `check_date`              | 2 (1.7%)                |                     | 3 (1.9%)                | 3 (2.1%)                   |

The wider reading (`website` ∪ `contact:website` ∪ `url`, `phone` ∪ `contact:phone`,
`email` ∪ `contact:email`) adds nothing for food at either radius: no named food find
carries one of the wider keys without the exact one. Lodging's wider "at least one" was
62 of 140 (44.3%). Decision 4 is answered (a), so this is the record it asked for and
not a reopening.

**Food against lodging at 10 km, by locality** (lodging from pl-60's fixture): Amqui 9
and 8, Bonaventure 8 and 8, Carleton-sur-Mer 6 and 8, Forillon National Park 2 and 17,
Gaspé 17 and 24, Gaspésie 0 and 0, Matane 17 and 14, Percé 23 and 40, Rivière-du-Loup 35
and 22; **117 against 141 in all**. _What differs from pl-60_'s "restaurants outnumber
places to sleep in a town" is false on this map for these nine, and is corrected there
in this commit.

**What a closest-first cap shows** (finds shown of finds in the radius, summed over the
nine; a town where the cap binds is named):

| Radius | Cap 10                                                                        | Cap 15                                                    | Cap 20                                     |
| ------ | ----------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| 2 km   | 57 of 76; binds in Gaspé (15), Matane (15), Percé (19)                        | 72 of 76; binds in Percé                                  | 76 of 76                                   |
| 6 km   | 62 of 108; binds in Gaspé (15), Matane (17), Percé (21), Rivière-du-Loup (33) | 82 of 108; binds in Matane, Percé, Rivière-du-Loup        | 94 of 108; binds in Percé, Rivière-du-Loup |
| 10 km  | 65 of 117; binds in Gaspé (17), Matane (17), Percé (23), Rivière-du-Loup (35) | 85 of 117; binds in Gaspé, Matane, Percé, Rivière-du-Loup | 99 of 117; binds in Percé, Rivière-du-Loup |

- **Where the cap binds, the ten closest are the centre**: the tenth-closest food find
  is 237 m from Gaspé's point, 276 m from Percé's, 733 m from Matane's and 2,274 m from
  Rivière-du-Loup's; the farthest inside 10 km is 8,852, 9,004, 2,577 and 9,843 m. In
  the other five localities the cap does not bind at 10 km (9, 8, 6, 2 and 0 finds).
- **The radius moves few finds; the cap moves many.** 6 km to 10 km adds 9 of 117
  (Amqui 2, Forillon 1, Gaspé 2, Percé 2, Rivière-du-Loup 2), and with a cap of ten it
  adds 3 shown finds (62 to 65). Cap 10 to cap 15 at 10 km adds 20 shown finds.
- **The ten closest by tag** at 10 km, restaurant / café / bar / pub / bakery: Gaspé 4 /
  4 / 1 / 0 / 1, Matane 4 / 2 / 2 / 2 / 1, Percé 8 / 0 / 0 / 2 / 0, Rivière-du-Loup 6 /
  2 / 1 / 1 / 0. Bars and pubs together are 1 to 4 of each capped ten.

**The combined query (Decision 3 (b)'s shape), sent once per town as the answer to
Decision 3 asks**: the eight lodging clauses and the five food clauses in one
`overpassPointQuery`-shaped text at 10 km, `[timeout:28]`, the timeout `nearbyPoint`
derives from the default 30 s deadline. The lodging-only column is pl-60's checked-in
reply for the same point, radius and timeout. That fixture stores each reply parsed,
so its wire size is unknown; both sides are compared as compact JSON.

| Town                   | Tries (status, s)          | Combined: wire, compact, elements (lodging / food) | Lodging only: compact, elements |
| ---------------------- | -------------------------- | -------------------------------------------------- | ------------------------------- |
| Amqui                  | 200 24.5                   | 6,517 B, 5,197 B, 17 (8 / 9)                       | 2,170 B, 8                      |
| Bonaventure            | 502 0.4; 200 43.4          | 5,533 B, 4,375 B, 21 (11 / 10)                     | 2,896 B, 11                     |
| Carleton-sur-Mer       | 200 35.6                   | 3,933 B, 3,099 B, 15 (9 / 6)                       | 1,723 B, 9                      |
| Forillon National Park | 502 0.4; 200 37.6          | 6,008 B, 4,716 B, 22 (20 / 2)                      | 4,357 B, 20                     |
| Gaspé                  | 502 0.4; 502 0.4; 200 38.4 | 15,390 B, 12,264 B, 43 (26 / 17)                   | 7,159 B, 26                     |
| Gaspésie               | 502 0.4; 200 34.7          | 653 B, 512 B, 2 (1 / 1)                            | 366 B, 1                        |
| Matane                 | 200 29.9                   | 10,252 B, 7,968 B, 35 (14 / 21)                    | 4,310 B, 14                     |
| Percé                  | 200 29.4                   | 20,053 B, 15,765 B, 63 (40 / 23)                   | 10,609 B, 40                    |
| Rivière-du-Loup        | 200 27.7                   | 21,083 B, 16,712 B, 64 (29 / 35)                   | 7,114 B, 29                     |

- The lodging element counts equal pl-60's fixture's, town for town.
- **7 of 9 combined queries took over 28 s and 5 of 9 over 30 s**, which `nearbyPoint`'s
  default deadline would have abandoned. **That is the instance's load, not the query's
  size**: Gaspésie's, with 2 elements, took 34.7 s, and the food-only 25 km queries took
  22.1 to 42.0 s in the same quarter-hour, while pl-60's 25 km lodging queries took
  11.3 to 30.1 s. So this run cannot separate (a)'s two queries from (b)'s one on time,
  and it does not price the food query at the radius Decision 6 chooses: **unmeasured**,
  and Build 9's fixture capture times it. Decision 3 stays (a).

**Open decision: Decision 6, the food pass's radius and per-town cap.** Put to the
orchestrator with the options as Decision 6 words them; not settled here.

- (a) The same, 10 km and ten. The table: 65 of 117 finds shown; the cap binds in four
  towns, whose ten are each town's centre (the tenth within 237 m to 2,274 m).
- (b) A smaller radius, such as the corridor's 6 km, with the same cap: 62 of 108
  shown. It loses Forillon's second find, Amqui's two outer ones, and two each in Gaspé,
  Percé and Rivière-du-Loup.
- (c) Choose from Build 1's table of counts at 2, 6 and 10 km: the table above.
- (d) Leave open.

**Builder's recommendation: (a), 10 km and ten.** The reason Decision 6 gave for a
different number was density, and the capture says food is not denser than lodging
here (117 against 141 at 10 km), so the case for two numbers is gone. The radius barely
matters between 6 and 10 km (9 finds in 117), so the one that matches `lodging` keeps
the two lists over the same circle. The cap of ten does cut four towns' lists to their centres,
which suits "a meal close to where the party stays" and keeps `food`'s block no longer
than `lodging`'s, so Decision 5's lodging-based cost floor still applies. If the owner
wants more choice in a dense town, the next option to price is (c) with 10 km and
fifteen: 85 of 117 shown, 20 more finds in four towns' blocks.

**Where the next builder starts.** Build 2, once Decision 6 is answered. The food tags
are Decision 1 (a)'s; the template proof above is the check that Build 2's new
`KIND_FILTERS` entries produce the text this capture sent (the same clause strings,
`"amenity"="restaurant"` and so on). Build 9's fixture is a fresh capture of the nine
towns through the built `overpassPointQuery(point, <radius>, <food kinds>, 28)`, sent
the same way (`capture.mjs`'s `send`, the same user agent or one naming the fixture),
and should expect HTTP 502 "at capacity" from the public instance and back off rather
than fail.
