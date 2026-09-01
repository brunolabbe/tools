---
id: pl-37
tool: planner
title: locate cannot see the trip it is grounding
kind: fix
milestone: P3
status: done
depends_on: [pl-34]
---

# pl-37 — `locate` cannot see the trip it is grounding

## Why

pl-34 fixed a geocoder that answered the wrong country confidently, and it
fixed it with the only evidence `locate` has: the candidate's own `locality`.
That works, and it is measured — nine of ten captured lookups resolve, the
tenth declines honestly. But it leaves one whole class of query with nothing
to reason from, because **`LocateRequest` carries a `Place` and nothing
else**:

```ts
export interface LocateRequest {
  place: Place;
  signal?: AbortSignal | undefined;
}
```

`Place.locality` is `string | null`
(`tools/planner/contract/src/candidate.ts:263`) and a model omits it
routinely. When it is `null`, pl-34's rule has no hint to score with, so a
reply whose rows disagree is declined — correctly, and at the cost of a place
the plan could have located. The captured case is a bare `Percé`
(`api/test/fixtures/nominatim-search-perce-bare.json`): the town in Québec and
Nez Perce County, Idaho, 3 882 km apart. `locate` declines it today.

**The trip already knows.** The brief has a `destination`
(`tools/planner/contract/src/brief.ts:508`) before any specialist runs, and
`api/src/runs/discovery.ts` already draws a corridor from the brief's origin
and destination. Every one of those is upstream of the `locate` call in
`api/src/runs/travel.ts` and none of it reaches the seam. A geocoder being
asked "where is Percé" on behalf of a Québec road trip is being asked a
question the caller can already narrow and does not.

**This would also have dissolved pl-34's regression rather than needing a
tiebreak for it.** `Gaspé, Québec` returns the town and the Gaspé peninsula,
118.6 km apart; pl-34 separates them with a `SETTLEMENT_ADDRESS_TYPES`
allowlist because the locality alone cannot. A destination narrows a town from
a peninsula directly, on distance, with no vocabulary of OSM address types to
maintain. The allowlist is the cheaper thing that fits pl-34's evidence; this
is the thing that generalises.

## Build

1. **Widen the seam.** Add trip context to `LocateRequest` in
   `tools/planner/agent/src/grounding.ts` — the brief's destination as the
   free-text prose it is, on the same "nothing may parse structure out of it"
   rule `Place.locality` carries. It is optional: `discovery.ts` grounds
   corridor endpoints before the fan-out and a brief may have declined a
   destination (`contract/src/brief.ts:505` — "A declined destination is an instruction").
2. **Thread it from both call sites.** `api/src/runs/travel.ts:295` and
   `api/src/runs/discovery.ts:226`. Neither has the brief in hand today, so
   this is a plumbing change through `MeasureInput` and its discovery
   equivalent, not a one-liner at the call.
3. **Fix the cache key, and treat this as the trap.** `locateKey` in
   `api/src/grounding/cache.ts` is keyed on the requested `Place` and nothing
   else — pl-34's Log confirms it reads nothing from the reply. A seam that
   answers differently per trip while the key ignores the trip **serves one
   trip's Saint-Jean to another's**. The key has to include whatever context
   the answer depends on, or the context has to be proven not to change the
   answer. There is no third option and the failure is silent.
4. **Use it in `chooseResult`** (`api/src/grounding/valhalla.ts`) as another
   unlabelled hint alongside the locality's fragments, so a bare name with a
   destination behind it scores like a localised one.
5. **Re-run pl-34's ten captured replies.** They are checked in under
   `api/test/fixtures/nominatim-search-*.json` and
   `grounding-valhalla.test.ts` already drives all ten through `locate` in one
   block. Nine locate and one declines today; a bare `Percé` with a Québec
   destination should join the nine without moving any of the others.

## Done when

- A bare `Percé` with a Québec destination locates the Québec town, pinned
  over `nominatim-search-perce-bare.json`, and still declines with no
  destination.
- `locateKey` is shown to distinguish two runs whose destinations differ, by a
  test that fails if the context is dropped from the key.
- pl-34's ten-capture block still passes, with any changed outcome named
  rather than absorbed.
- If the widened `LocateRequest` changes what a provider may return,
  `@planner/contract` and pl-27's `UncheckedConstraint` vocabulary say so —
  the same clause pl-34 carried and deferred.

## Log

**2026-08-30 — filed from pl-34's second round, id checked rather than
assumed.** `pl-36` is the highest id on `origin/main`; no open pull request
and no ref on `origin` carries a higher one; `pl-33` is held by another
in-flight session and is not this. So `pl-37`.

Chosen by the user over the alternative pl-34 left on the table — naming an
ambiguous `locate` outcome in the seam and in `UncheckedConstraint` — which
remains unfiled and is a different ticket: this one gives `locate` more to
reason with, that one gives it more ways to say it could not. They compose and
neither blocks the other, though doing this one first shrinks how often the
other's new vocabulary is reached for.

**Not started here.** pl-34 deliberately stopped at the seam: widening
`LocateRequest` is contract-adjacent and touches four packages, which is more
than a fix for a wrong coordinate should carry.

**2026-09-01 — built, on `origin/main` at `6f29eb0`.** Branch
`pl-37-locate-cannot-see-the-trip`. The gap was reproduced on the merged code
before anything was changed, and three of the brief's claims turned out to be
wrong about the tree they described.

### The reproduction, before the build

Two halves, both against `6f29eb0`:

- **Runtime.** A temporary spec drove `ValhallaGroundingProvider.locate` over
  `api/test/fixtures/nominatim-search-perce-bare.json` with
  `{ name: "Percé", locality: null }`. Query sent: `Percé`. Result: `null`. The
  reply's two rows are
  `town | Percé, Le Rocher-Percé, Gaspésie–Îles-de-la-Madeleine, Québec, Canada`
  and `county | Nez Perce County, Idaho, United States`, 3 882 km apart.
- **The seam.** Adding `trip: { destination: "Québec" }` to that same call
  failed to compile: `TS2353: Object literal may only specify known properties,
and 'trip' does not exist in type 'LocateRequest'`. There was nowhere to put
  it, which is this ticket's title as a compiler error.

**And the trip did know.** `execute` in `api/src/runs/orchestrator.ts` holds
`brief` at the `measureTravel` call, and `discoverAlongCorridor` already takes a
`TripBrief` in `DiscoverInput`. The premise held in full; nothing pl-36 did had
dissolved it.

### What the brief had wrong

**Its line numbers are stale, and `scripts/citations.mjs` reports 5/5.** Build
step 2 names `api/src/runs/travel.ts:295` and `api/src/runs/discovery.ts:226`.
On `6f29eb0` the `locate` calls are at `travel.ts:310` and `discovery.ts:491`;
line 295 is `const total = places.toLocate.length + 1;` and line 226 is blank.
The checker passes because **a bare `file:line` with no quoted text beside it is
checked for existing, not for saying anything** — worth knowing before trusting
a green run of it. pl-36 is what moved them, having inserted the `geocoded` map
and the `Source` capture into exactly this loop, which is the hazard its own Log
names: the set of files an event edits is not the set it invalidates.

**Build step 2's "neither has the brief in hand today" is half wrong.**
`discoverAlongCorridor` has taken `brief: TripBrief` since pl-29. Only
`MeasureInput` needed a new field, and the orchestrator's end was one line. This
came in smaller than the brief sized it.

**Build step 4 asks for something that regresses lookups that work today, and
this build refused it.** It says to use the destination "as another unlabelled
hint alongside the locality's fragments". `bestMatches` keeps only the
top-scoring rows, so blending lets evidence about the _trip_ outvote evidence
about the _place_ — and a trip routinely contains places outside its
destination. Built as a blend and measured: `Saint-Jean` with
`locality: "Newfoundland"` on a trip to New Brunswick, over
`nominatim-search-ambiguous-limit10.json`, goes from locating St. John's
correctly to returning `null`, because both rows then score 1, disagree by
~1 400 km, and are both `city` so the settlement tiebreak cannot help. What was
built is a **ladder** instead — locality, then the reply's own agreement, then
the destination — which is additive by construction, so nothing that located
before pl-37 can move.

**The Why's claim that a destination "narrows a town from a peninsula directly,
on distance" does not follow from Build step 1.** Step 1 specifies the
destination as free-text prose, and prose is matched against `display_name`, not
measured against. Over the captured `Gaspé, Québec` reply a destination of
`Gaspésie, Québec` matches the town row and the peninsula row equally, so it
ties exactly as the locality does and pl-34's `SETTLEMENT_ADDRESS_TYPES`
allowlist is still what separates them. Narrowing on distance would need the
destination's _coordinates_ — a different ticket and a different seam shape.
**pl-34's allowlist is therefore not dissolved by this ticket and must not be
removed on the strength of that paragraph.**

### The measurement that changed the design: no tiebreak behind a destination

The first cut factored the locality's ladder and the destination's into one
helper, so the settlement tiebreak ran behind both. That is wrong, and a capture
says so rather than an argument.

`runs/discovery.ts` grounds the corridor's **own endpoints**, so for the
destination endpoint the place being located and the destination handed as
context are the _same string_. Over `nominatim-search-perce-bare.json` the hint
`perce` matches **both** rows — `Percé, …` and `Nez Perce County, Idaho, …` —
so nothing is narrowed, and exactly one survivor is a settlement. A tiebreak
behind that answers Québec with real confidence and no evidence, which is
precisely what pl-34 refused, arriving through a hint that only looks like
evidence.

So `SETTLEMENT_ADDRESS_TYPES` runs only behind a **locality**, exactly as pl-34
wrote it, and a destination must produce a shortlist that agrees on its own or
produce nothing. The cost is named rather than hidden: a bare `Gaspé` on a trip
to `Gaspésie` declines where `Gaspé, Québec` locates. Nothing captured measures
that pair — there is no `q=Gaspé` capture — and the failure direction is "not
located", which pl-34 argues is the safe one.

### What was built

| where                            | what                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent/src/grounding.ts`         | `TripContext { destination: string }` and `LocateRequest.trip?`. Prose, nothing parsed out of it, optional because a brief may decline it. |
| `api/src/grounding/valhalla.ts`  | `chooseResult`'s third rung. `localityHints` renamed `hintsFrom` — two callers now, neither of them about locality specifically.           |
| `api/src/grounding/cache.ts`     | `locateKey(place, trip)`, keyed unconditionally on the context.                                                                            |
| `api/src/runs/discovery.ts`      | `tripContextFor(brief)`, exported; both corridor endpoints located with it.                                                                |
| `api/src/runs/travel.ts`         | `MeasureInput.trip`, passed to `locate` and to nothing else.                                                                               |
| `api/src/runs/orchestrator.ts`   | one line: `trip: tripContextFor(brief)`.                                                                                                   |
| `api/src/grounding/fixtures.ts`  | a note saying why a gazetteer lookup ignores the field.                                                                                    |
| `api/src/grounding/place-key.ts` | folded in — see below.                                                                                                                     |

**The destination narrows the choice and never the query.** It is not appended
to `q`. Appending it would ask the geocoder a different question — a place
genuinely outside the destination would stop being _found_ rather than stop
being disambiguated — and it would invalidate every capture in
`grounding-valhalla.test.ts`, which are keyed by the exact query sent. Pinned by
a test.

`tripContextFor` lives in `runs/discovery.ts` because that is where the brief is
already read: `hasCorridor` and `corridorEndpoints` are there and the
orchestrator already imports from it. A fourth module holding one four-line
brief reader would be a module named for a type rather than for a job. It is
deliberately **not** `hasCorridor`'s test — a brief may decline its origin and
still name a destination, and the measuring pass wants the second alone.

### The cache key, which is where this ticket said the trap was

`locateKey` now takes the trip context and always includes it, normalised the
same way every other part of a key is, with `ABSENT` for a request that has
none. The parameter is **required, not optional**, so every call site has to
decide rather than inherit a default — which is what turned two test files into
compile errors that had to be read, rather than a silent behaviour change.

Unconditional rather than clever: whether the trip changes _this_ answer is
knowable only inside the provider, and `CachingGroundingProvider` wraps
whichever `GroundingProvider` it was handed. The cost is a lower cross-run hit
rate, and it is bounded — a run's destination is constant, so every lookup
within one run still shares a partition and `runPlaces`'s intra-run
deduplication is untouched. Only two runs to different destinations stop sharing
a row, which is the pair that must not.

### Done when, against what is checked in

- **Bare `Percé` + a Québec destination locates the Québec town over
  `nominatim-search-perce-bare.json`, and still declines with no destination.**
  Both, as a pair in one describe.
- **`locateKey` shown to distinguish two runs whose destinations differ, by a
  test that fails if the context is dropped.** Four tests, over a double that
  answers _by destination_ — a double answering identically could only ever have
  caught this on a call count, and a call count says the cache is less useful,
  not that it is wrong.
- **pl-34's ten-capture block still passes, with any changed outcome named.** It
  does, unchanged, and a second block re-runs all ten _with_ a Québec
  destination: ten located, and the nine at the coordinates they already had.
  One test rather than ten, because what is pinned is the set — a change that
  located the tenth by moving one of the nine would pass ten assertions
  rewritten one at a time.
- **Whether the widened `LocateRequest` changes what a provider may return.** It
  does not. `locate` still answers `LocatedPlace | null`, `Provenance` is
  untouched and no `UncheckedConstraintKind` is added, so neither
  `@planner/contract` nor pl-27's vocabulary had anything to say. pl-34's open
  question — that `null` says "ambiguous" in a voice that only says "unmatched"
  — is **unchanged and still open**; this ticket narrows how often it is reached
  rather than answering it, exactly as pl-37's filing note predicted.

### Every new assertion was made to fail first

Twenty new tests. Each falsification below was applied to source, run, then
reverted:

- **Third rung removed** (`return null` in place of the destination narrowing) —
  3 failed: the bare-`Percé` locate, the six-places-on-three-continents case,
  and the ten-with-a-destination block.
- **Settlement tiebreak added behind the destination** — 1 failed: "a
  destination that narrows nothing does not get a settlement tiebreak".
- **Destination blended into the locality's hints**, which is Build step 4 as
  written — 2 failed: that same test, and "a locality that says where is not
  diluted by a destination that says elsewhere".
- **`trip` dropped from `locateKey`** — 3 of the 4 cache tests failed. The
  fourth is the positive half (two runs to one destination still share a row)
  and stayed green, which is what makes it worth having: a key that simply
  missed every time would pass the other three.
- **`trip` dropped from `travel.ts`'s locate call** — 1 failed.
- **`trip` dropped from `discovery.ts`'s locate call** — 1 failed.
- **`tripContextFor` returning `{ destination: "" }` for a declined slot** — 1
  failed.

### Folded in

**`api/src/grounding/place-key.ts`'s header was made false by this change and is
corrected in the same commit.** It said `placeIdentity` "is the cache's key for
`locate`, half of its key for `travel`". It is now part of both. The note also
records what did _not_ change and why: a trip is not part of a place's identity,
and folding it into `placeIdentity` would have followed the destination into
`runPlaceKey` and split one run's matrix rows on something constant across the
run. `place-key.test.ts`'s "is the string the cache keys by" assertion moved
from `toBe` to `toContain`, which is what it already asserted about `travelKey`.

### Not done, and could have been

- **A bare `Gaspé` with a `Gaspésie` destination is not made to work**, and that
  is the tiebreak decision above rather than an oversight. It needs either the
  settlement tiebreak behind a destination — refused, measured — or the
  destination's coordinates, which is a different seam. No capture exists for
  `q=Gaspé`, so nothing here could have measured it either way.
- **`citations()`'s `.slice(0, MAX_SOURCES)` in `runs/travel.ts` is still
  unpinned**, exactly as pl-36 left it and for pl-36's reasons. This branch has
  that file open and could have; it did not, because nothing about pl-37 makes
  the branch reachable and the trade pl-36 weighed has not moved.
- **`MIN_HINT_CHARS` now filters a destination as well as a locality**, so a
  destination of `"QC"` contributes nothing and the lookup declines as before.
  That is an existing rule applied to a new source rather than a new decision,
  and it has no test of its own — the constant's own tests cover the behaviour.

### Gates

```
$ git fetch origin && git rev-parse origin/main                    # 6f29eb0
$ npm run build                                                    # 0
$ npx vitest run tools/planner/api/test/grounding-valhalla.test.ts # 95 passed
$ npx vitest run tools/planner/api/test/grounding-cache.test.ts    # 52 passed
$ npx vitest run tools/planner/api/test/travel-measure.test.ts     # 12 passed
$ npx vitest run tools/planner/api/test/discovery-pass.test.ts     # 23 passed
$ npm test -- --project planner                                    # 53 files, 843 tests
$ npm test                                                         # 115 files, 1813 tests
$ npm run format                                                   # one test file reflowed
$ npm run check                                                    # 0
$ node scripts/citations.mjs <this file>                            # 5/5 — see above
```

The planner baseline at `6f29eb0` is **823**, pl-36's own measured figure,
unchanged by the two downloader commits that landed after it; this branch adds
**20** — 9 in `grounding-valhalla`, 4 in `grounding-cache`, 3 in
`travel-measure`, 4 in `discovery-pass`. `npm test` was run in full rather than
only the planner project because `@planner/agent`'s seam moved, even though no
package outside `tools/planner` imports it.

One spec runs in ~0.5–0.7 s warm here, against ~6 s for the whole planner
project and ~38 s for everything, so iteration was per-spec throughout.

**Not measured, and named rather than reasoned about:** no e2e run
(`npm run e2e:planner`), no container build, and no request against a real
Nominatim. Every geocoder claim here rests on the fourteen checked-in captures
and pl-37 added none — the two multi-row replies it turns on
(`nominatim-search-perce-bare.json` and
`nominatim-search-ambiguous-limit10.json`) were captured by pl-34.
