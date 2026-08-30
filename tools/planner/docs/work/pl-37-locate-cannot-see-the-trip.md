---
id: pl-37
tool: planner
title: locate cannot see the trip it is grounding
kind: fix
milestone: P3
status: ready
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
