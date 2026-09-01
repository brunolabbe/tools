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

## Review

**Gate: PASS** — 2026-09-01 · `origin/main...HEAD` (381532e) · self-run defect hunt, full diff read + mutation reproduction of every documented falsification

_Added when committing, not by the reviewer: the record is **pinned to
`381532e`**, a pre-squash branch sha, and its citations resolve only there —
`node scripts/citations.mjs <this file> --section Review --rev 381532e`. It is
kept rather than remapped because the tests it cites do not exist at the base
commit, so no sha that survives the squash-merge can resolve them; after merge
the tree is reachable through this ticket's pull request. The gate was **Sonnet,
against an Opus build**, and it reviewed `381532e` — which predates the fourth
rung added below in the Log's second round._

| Done when                                                                                                    | Proof                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bare `Percé` + Québec destination locates the town, and still declines with no destination                   | `grounding-valhalla.test.ts:1028` (locates) ✓ · `:1037` (declines) ✓                                                                                                                                           |
| `locateKey` distinguishes two runs whose destinations differ, by a test that fails if the context is dropped | `grounding-cache.test.ts:892` / `:923` / `:930` ✓ — reproduced: dropping `trip` from `locateKey` fails 3 of the 4 new cache tests, the positive one stays green as designed                                    |
| pl-34's ten-capture block still passes, with any changed outcome named                                       | `grounding-valhalla.test.ts:895` (unmodified pl-34 test, still 9/10) ✓ · `:914` (new: with a Québec destination, 10/10, nine unmoved) ✓                                                                        |
| Widened `LocateRequest` — whether it changes what a provider may return                                      | **verified** — `locate` still returns `LocatedPlace \| null`; zero diff to `tools/planner/contract/` or `tools/planner/itinerary/`; no `UncheckedConstraintKind` added (`contract/src/unchecked.ts` untouched) |

- **Build step 4 refusal, independently reproduced.** Implemented the literal blend ("destination as another unlabelled hint alongside the locality's fragments") in `chooseResult` and ran it: exactly 2 of 95 tests in `grounding-valhalla.test.ts` fail — `a destination that narrows nothing does not get a settlement tiebreak` and `a locality that says where is not diluted by a destination that says elsewhere`, the latter failing precisely as described (St. John's, Newfoundland on a New Brunswick trip goes from `{47.5646794, -52.7066964}` to `null`). Reverted cleanly. The refusal is justified on a real, reproduced regression, not a hypothetical.
- **Settlement-tiebreak-behind-destination removal, independently reproduced.** Reinstated a tiebreak behind rung 3 and ran the suite: `a destination that narrows nothing does not get a settlement tiebreak` goes red, answering the Québec town `{48.5222989, -64.2136423}` on the circular `perce` hint that also matches `Nez Perce County, Idaho` — exactly the false-confidence failure the builder's Log describes. Reverted cleanly.
- **Mutation-testing claim, independently reproduced for all 7 documented falsifications**, each applied to `valhalla.ts` / `cache.ts` / `travel.ts` / `discovery.ts`, run, then reverted: third rung removed → 3 failed (bare-Percé locate, six-continents case, ten-with-destination block); tiebreak added behind destination → 1 failed; destination blended into locality hints → 2 failed; `trip` dropped from `locateKey` → 3 of 4 cache tests failed, the 4th (positive, same-destination) stayed green; `trip` dropped from `travel.ts`'s call → 1 failed; `trip` dropped from `discovery.ts`'s call → 1 failed; `tripContextFor` returning `{ destination: "" }` for a declined slot → 1 failed. All 7 exactly matched the Log's claimed counts. Walked all 20 new tests (36 new `expect(` calls) across the five touched files for logical soundness; none read as tautological or unreachable.
- **Cache key.** Intra-run consistency verified by reading, not assuming: `orchestrator.ts` computes `tripContextFor(brief)` once per run (`travel.ts:362`) and `discovery.ts` computes it once per corridor call (`discovery.ts:224`) from the same immutable `brief`, so every `locate` call in one run shares one `trip` value — no path produces two different trip contexts for one run. Collision check: `locateKey` = `placeIdentity(place) + KEY_SEPARATOR + destination-part`; `KEY_SEPARATOR`/`ABSENT` are control characters stripped by `normalisePart` before joining, so no user-controlled string can forge a separator across the (name, locality, destination) boundary — no two distinct triples can collide.
- **pl-34's allowlist.** `SETTLEMENT_ADDRESS_TYPES` (`valhalla.ts:206`) unchanged, still `{city, town, village, municipality}`, still referenced exactly once (`valhalla.ts:976`), still behind locality only — no second reference was added behind the destination rung.
- **Fourth-rung measurement (item 6), exhaustive.** Walked all 14 checked-in Nominatim captures programmatically (shared substring ≥3 chars between rows, disagreement > `SAME_PLACE_METRES`, post-settlement-filter survivor count). **1 of 14** — `nominatim-search-ambiguous-limit10.json` — could exercise a fourth rung: the fragment `canada` ties the two `city`-type rows (New Brunswick, Newfoundland), both settlement types, so the existing settlement tiebreak leaves them tied unresolved. Confirmed by implementing a literal 4th rung and running `locate({ place: { name: "Saint-Jean", locality: "Canada" }, trip: { destination: "New Brunswick" } })`: resolves to `{45.272764, -66.0627914}` with the rung, still `null` without a trip. `gaspe-quebec.json` and `perce-bare.json` (the other two multi-row captures) always resolve at rung 1 alone, because in both, exactly one of the two disagreeing rows is a settlement type. No shipped test currently exercises this — it requires a `locality: "Canada"` case nobody has written.
- **Invariants.** `LocateRequest`/`TripContext` live in `@planner/agent/src/grounding.ts`, where `LocateRequest` already lived pre-pl-37 (confirmed against `origin/main`) — not `@planner/contract`; this is the seam a provider implements, not the tool's shared contract, so no unilateral contract edit occurred. No bare `Error`, no `console`, no `any` in the diff (scanned). `npm run check` — 0. `npm test` — 115 files, 1813 tests, matching the Log's claimed counts exactly. Ticket frontmatter is `status: done`; Log records three "what the brief had wrong" findings. `node scripts/commit-message.mjs --text "fix(planner): let locate see the trip it is grounding (pl-37)"` — exit 0. Diff touches only `tools/planner/` — one tool.
- NFR: security n/a (destination never reaches the query, no new external surface) · performance — cross-run cache hit-rate cost is reasoned not measured, disclosed by the builder, bounded to cross-destination pairs · reliability ✓ (ladder additive by construction, confirmed by mutation) · maintainability — **low**, already disclosed in the ticket's own Log (`MIN_HINT_CHARS` now filters a destination too, with no dedicated test); settled, not new work to propose.
- **findings** · self-run hunt (no delegate) returned 0 new findings beyond what the ticket's own Log already discloses and settles.

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

**Its line numbers are stale, and `scripts/citations.mjs` still reports them
resolved.** Build step 2 names `api/src/runs/travel.ts:295` and
`api/src/runs/discovery.ts:226`. At `6f29eb0` the `locate` calls are in fact at
`api/src/runs/travel.ts:310` and `api/src/runs/discovery.ts:491`, while line 295
is the doc comment `* \`Place\` — see \`measured\` for where it lands …`and line
226 is`],`, the tail of an unrelated array literal.

**The four line numbers in this paragraph are evidence about `6f29eb0` and not
about the working tree**, where this branch has since moved both files — check
them with `node scripts/citations.mjs <this file> --rev 6f29eb0`, which is the
case the script's own header calls out as the one it cannot judge for you.

The checker reports the _brief's_ two as fine because **a bare `file:line` with
no quoted text beside it can only be checked for existing**. That is the
script's design and not a gap in it: its header says it "cannot tell you a
citation is semantically right … It can tell you a citation cannot possibly be
right, which is the half that is checkable". So a clean run over this file means
none of its citations is _impossible_, which is a weaker sentence than "they
point at what they claim". pl-36 is what moved them, having inserted the
`geocoded` map and the `Source` capture into exactly this loop, which is the
hazard its own Log names: the set of files an event edits is not the set it
invalidates.

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

**2026-09-01, second round — the fourth rung, after the gate falsified the
argument against it.** Gate verdict PASS; the user chose the fourth rung from
the options the first round put up as an open decision, and this is that rung.

### The argument I was wrong about, and the measurement that says so

The first round recommended keeping three rungs and gave one reason: a fourth
would be "an unexercised branch no capture reaches". **That was an assumption
wearing a measurement's clothes — I never counted.** The gate did, and it is
false.

Reproduced here before building to it, rather than taken from the relay. The
survey walks all fourteen `nominatim-search-*.json` captures and asks, for every
comma- or slash-separated fragment of ≥ `MIN_HINT_CHARS` that at least two rows
share: does that hint leave two or more survivors, do they disagree beyond
`SAME_PLACE_METRES`, and does the `SETTLEMENT_ADDRESS_TYPES` filter still leave
them unresolved? The distance helper was cross-checked first against the two
numbers `valhalla.ts` states — it returns 3 882.3 km for the bare `Percé` pair
and 118.6 km for the `Gaspé` pair.

**1 of 14 reaches it**, exactly as the gate reported:

```
>>  nominatim-search-ambiguous-limit10.json  (6 rows) REACHES RUNG 4:
      hint "canada" -> 2 survivors, 2 after settlement filter, types ["city"]
```

`City of Saint John, … New Brunswick / Nouveau-Brunswick, Canada` and
`St. John's, Newfoundland, Newfoundland and Labrador, Canada`, **1 054 km**
apart — not the "~1 400 km" the first round wrote into a test comment, which is
corrected in this commit — and **both `addresstype: city`**, so the allowlist
narrows nothing and the tiebreak returns them as tied as it found them.

The gate's account of the other two multi-row captures also holds: in
`gaspe-quebec` and `perce-bare` exactly one of the disagreeing rows is a
settlement type, so both finish at the tiebreak and neither could ever have
exercised this. That is _why_ the first round's survey-by-intuition came out
wrong — the two replies I had spent the round staring at are precisely the two
that cannot show it.

**The gate's method is sound and I did not find anything it counts that it
should not.** Its survivor-count test is the same three questions the code asks,
in the same order.

### What the rung is

After the settlement tiebreak fails, the destination narrows the locality's
survivors:

```ts
const settled = agreedPoint(shortlist.filter(isSettlement));
if (settled !== null) return settled;
return agreedPoint(bestMatches(shortlist, hintsFrom(trip?.destination ?? null)));
```

`locate({ place: { name: "Saint-Jean", locality: "Canada" }, trip: { destination: "New Brunswick" } })`
now answers `{45.272764, -66.0627914}` and answers `null` with no trip. Both
halves are tests; the positive one was written first and failed with
`expected null to match object { coordinates: … }` before the rung existed.

**Additive, on the same terms as the other three.** It runs only where all three
above it have declined — which today returns `null` — so the only outcome it can
change is a decline. The ten-capture regression block re-ran unchanged: nine
located at the coordinates they already had, and the tenth still joins them via
the no-locality path. Nothing moved.

### One thing no capture can settle, recorded as unmeasured

**The rung narrows `shortlist` — the locality's survivors — and not the
settlement filter's subset.** The argument is that
`SETTLEMENT_ADDRESS_TYPES`'s own note says a type not on it "is not _rejected_;
it merely fails to be preferred": narrowing the filtered subset would make it
reject after all, so two rows of an unfamiliar type would become unresolvable by
any destination and an incomplete allowlist would start costing lookups — the
one thing pl-34 designed it never to do.

**That choice is argued, not measured, and I checked rather than assumed this
time.** Swapping `shortlist` for `results` in the rung and re-running the file:
**97 passed, nothing failed.** In the only reply that reaches the rung both
survivors are settlements, so the two sets are equal and no checked-in capture
can distinguish the designs. It is written down in `chooseResult`'s header so
that the first capture which does separate them is recognised as evidence rather
than as noise.

### Gates, second round

```
$ node <survey over the fourteen captures>                          1 of 14 reaches rung 4
$ npx vitest run .../grounding-valhalla.test.ts                     97 passed
$ npm run build                                                     0
$ npm test -- --project planner                                     53 files, 845 tests
$ npm test                                                          115 files, 1815 tests
$ npm run format
$ npm run check                                                     0
```

Two tests added, 843 → 845. `origin/main` moved to `7d56035` during this round
(`repo-13`, one file, `docs/work/repo-13-codeql-false-positives-recur.md`); it
touches nothing this branch does, so the branch was left on `6f29eb0` rather
than rebased for a docs-only commit.

**Still not measured**, unchanged from the first round: no e2e run, no container
build, no request against a real Nominatim.

### On `scripts/citations.mjs`, phrased correctly this time

The first round called it a gap that a bare `file:line` with no quoted text is
checked only for existing. It is not a gap, it is the script's stated design —
its header says it "cannot tell you a citation is _semantically_ right … It can
tell you a citation cannot possibly be right, which is the half that is
checkable." So a 5/5 on this file means **none of its citations is impossible**,
which is a weaker and more useful sentence than "they resolve".

### The gate record above, and how to read its line numbers

**It is a snapshot of `381532e` and it has deliberately not been amended.** It
therefore predates the fourth rung, which was added afterwards at the user's
direction, on the strength of the gate's own 1-of-14 measurement. Editing the
record to mention the rung would misrepresent what the reviewer actually saw, so
the rung is recorded here instead and the record stands as written.

**A record pins to the sha it reviewed; a Log passage pins to a sha that
survives.** These are two different pins in one file and the difference is not
cosmetic:

- The **record** is pinned to `381532e`, a pre-squash branch sha. Its citations
  are into tests this branch introduced — `grounding-valhalla.test.ts:1028`,
  `grounding-cache.test.ts:892` — and those lines **do not exist at the base**,
  so no sha that outlives the squash-merge can resolve them. After merge the
  tree is reachable through this ticket's pull request.
- The **Log's** "what the brief had wrong" passage is pinned to `6f29eb0`,
  because it is evidence _about the base commit_ and the base survives.

Check them separately: `--rev 381532e` for the record, `--rev 6f29eb0` for the
Log. Note that **`--section` is advertised in `scripts/citations.mjs`'s usage
line and is not implemented** — passing it silently changes nothing and you get
the whole file, which is easy to misread as a filtered pass.

**One mis-citation in the record, recorded rather than corrected.** Its cache-key
paragraph says `orchestrator.ts` computes `tripContextFor(brief)` once per run,
and then points at `travel.ts` line 362. The prose names the right file and the
parenthetical does not. At `381532e` the line it means is
`tools/planner/api/src/runs/orchestrator.ts:362`, which is
`trip: tripContextFor(brief)`; `travel.ts` line 362 is an unrelated `return`,
and a bare `travel.ts` is in any case ambiguous across three tracked files.
**The finding is sound; only the pointer is wrong.** It is left as the reviewer
wrote it, because a gate record is a snapshot, and corrected here.

Its own citation is therefore the one `FAIL` that
`node scripts/citations.mjs <this file> --rev 381532e` reports, and that is the
expected state rather than something still to fix — the passage above is what it
resolves to.

### A method caveat worth more than the numbers it produced

The first round reported that the brief's `discovery.ts:226` was "blank". It is
not — at `6f29eb0` it is `],`. The mistake was not arithmetic: **the line was
read off the working tree, where this branch had already inserted code above it,
rather than off the commit the claim was about.** That produces a _confident
wrong_ citation, which is strictly worse than a dangling one — a dangling
citation announces itself, and a confident wrong one reads as evidence and gets
repeated.

The same slip is what left a bare `travel.ts` line 310 ambiguous in the first
round, and it is the same shape as the gate's own bare `travel.ts` above. The
rule that falls out:
**resolve a citation against the tree the sentence is about, and name that tree
in the sentence** — `--rev` exists for exactly this and costs one flag.

### What was argued versus what was counted

Worth keeping visible, because the split is what the gate caught. The first
round's refusal of a fourth rung was filed under "measured" and was not: no
survey had been run, and the two captures the round had spent its time in are
precisely the two that cannot exercise the branch. The gate counted, and the
answer was 1 of 14 rather than 0. Everything else in the first round that
claimed a measurement had one behind it — the gate reproduced all seven
falsifications at the exact counts claimed. The lesson is narrow and worth
carrying: **an exhaustive claim about a fixture corpus is cheap to actually
run**, and a survey over fourteen files is a script, not a judgement.
