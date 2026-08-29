---
id: pl-34
tool: planner
title: A locality-free geocoder query resolves confidently to the wrong country
kind: fix
milestone: P3
status: ready
depends_on: []
---

# pl-34 — A locality-free geocoder query resolves confidently to the wrong country

## Why

pl-30 captured real Nominatim `/search` replies to hold `firstCoordinates` in
`api/src/grounding/valhalla.ts` to something other than memory. The parser
came through clean — a no-match is a real `[]`, `lat`/`lon` are real strings,
both already handled. What the captures exposed instead is upstream of the
parser, in the **query** `locate` sends, and it is worse than the failure
pl-30's brief predicted.

pl-30 predicted "Saint-Jean in Québec becomes Saint-Jean in New Brunswick" —
still Canada, still plausible, the kind of wrong a reader might catch on a
map. The captured reply says the real failure is not that: `q=Saint-Jean` with
no locality returns Saint-Jean, **Toulouse, France**, and raising `limit` to
10 does not recover a Québec result at all — it recovers New Brunswick,
Newfoundland, Jersey, Belgium and Kinshasa, matched across languages
(`Sint-Jan`, `St John`), and no Canada-adjacent guess is even close.

**This is reachable in production, not a corner someone would need to
construct.** `Place.locality` is `string | null`
(`tools/planner/contract/src/candidate.ts:263`), and `placeQuery` in
`valhalla.ts` filters empty parts before joining `name` and `locality` — so a
candidate whose `locality` is `null` sends the geocoder the bare `name`:

```ts
function placeQuery(place: Place): string {
  return [place.name, place.locality]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(", ");
}
```

A model omits `locality` routinely — it is optional in the contract and
nothing today requires a specialist to fill it. The result is not a `null`
`LocatedPlace` and not an `UncheckedConstraint`: it is a **confident, sourced,
wrong coordinate**. `pointsOf` sends it, `travel` measures a real distance to
it, and the plan reports `travel-time` as `measured` between (say) Montréal
and a point in France. pl-27's gap vocabulary has nothing that names this,
because from the plan's point of view nothing went wrong — a place was
located, a leg was measured, a source is attached. The wrongness is entirely
in which place got located.

## Reproduction

Pinned as tests in `tools/planner/api/test/grounding-valhalla.test.ts`
(`describe("locate, over a payload a real Nominatim wrote")` and
`describe("what the ambiguous-name replies show, beyond what locate reads")`),
over the real captures pl-30 checked in:

- `nominatim-search-ambiguous-limit1.json` — `q=Saint-Jean&limit=1`
  (production's actual request shape: `locate` always asks for `limit=1`).
  First and only result: Saint-Jean, Toulouse, Haute-Garonne, France —
  `lat=43.6648247, lon=1.5041143`. A `locate` call for
  `{ name: "Saint-Jean", locality: null }` resolves to exactly this,
  non-null, sourced.
- `nominatim-search-ambiguous-limit10.json` — the same query at `limit=10`,
  captured only for this ticket's evidence (`locate` never requests more than
  one). None of the ten results is in Québec. The six distinct places are
  Toulouse (France), Saint John (New Brunswick), St. John's (Newfoundland),
  St John (Jersey), Sint-Jan (Belgium) and Lingwala (Kinshasa) — Nominatim
  matched across languages and place types, not just across Canadian
  provinces.
- The ten results are **not ordered by `importance`**: the highest
  (`0.6016`, St. John's, Newfoundland) is at index 2, behind `0.5848`
  (Toulouse, the one actually returned at `limit=1`) and `0.5813` (New
  Brunswick). So "ask for more and take the best-scored one" is not free —
  Nominatim's own ranking already put Toulouse ahead of both Canadian
  results at `limit=1`, and "first" and "best" are not the same claim even
  inside one reply.

## What this is not

- **Not a `firstCoordinates` defect.** The parser reads `body[0]` correctly;
  the reply's `body[0]` is simply the wrong place. Nothing in
  `api/src/grounding/valhalla.ts`'s reply-parsing changed for this ticket.
- **Not the pl-30-predicted failure mode**, which was a same-country
  near-miss. This capture did not exercise "`locality` present but the
  geocoder still picks the wrong same-name place inside one country" — that
  remains a real, separate risk this ticket does not have evidence for either
  way.
- **Not something `pointsOf` or `travel` can catch downstream.** Both receive
  a `Place` that is fully formed — coordinates, a source, nothing marked
  uncertain — because the wrongness happened one layer up, in what `locate`
  was asked.

## Options — none chosen here

1. **Require a locality before geocoding.** Refuse (or fall back to
   `UNCHECKED`) a `locate` call for a place with `locality: null`, and push
   the requirement upstream — either the contract stops treating `locality`
   as optional, or specialists are prompted/validated to fill it. Closes the
   exact case reproduced here. Does not help when `locality` is present but
   still ambiguous (the pl-30-predicted case), and costs whatever the tool
   loses by refusing to locate a place a model genuinely could not name a
   locality for.
2. **Raise the request `limit` and disambiguate on `display_name`.** Ask for
   more than one result and pick the one whose `display_name` best matches
   what is known about the place (country, region, the brief's destination)
   rather than trusting Nominatim's own order. Works with or without a
   `locality`. Costs a scoring rule that is itself a small parser with its
   own edge cases, and this capture already shows the naive version of it
   (highest `importance`) would still have picked a European result over
   both Canadian ones.
3. **Reject a result whose `display_name` omits the locality.** When
   `locality` is present, require it (or a normalised form of it) to appear
   in the candidate's `display_name` before accepting the result; otherwise
   answer `null` rather than a guess. Cheap and directly closes the
   pl-30-predicted case. Does not touch the case reproduced here, since it
   only fires when `locality` is present — `Saint-Jean` with no locality has
   nothing to check the reply against.

These are not mutually exclusive — (1) and (3) address different halves of
the same failure and (2) is an alternative to both. Choosing between them,
and what a rejected/refused `locate` should mean for the plan (a new
`UncheckedConstraint`? a different one from the existing `travel-time`?), is
this ticket's Build, not written here.

## Done when

- A decision is recorded for which of the options above (or a fourth) closes
  this gap, with the tradeoffs above weighed rather than re-derived.
- The chosen fix is implemented and the reproduction above (or an equivalent
  captured case) is pinned as a test that fails without it.
- If the fix changes what `locate` or `travel` can return, `@planner/contract`
  and pl-27's `UncheckedConstraint` vocabulary are updated to say so, rather
  than silently returning `null` for a case the plan should be able to name.

## Log

**2026-08-29 — filed from pl-30's real captures, per the coordinator's
direction, id held rather than computed (`pl-33` is in use elsewhere).** No
fix attempted here — see "Options" above. The claim this ticket exists to
carry forward is narrow and load-bearing: **`firstCoordinates` was already
correct; the query was not.** Verified independently before filing:

```
$ grep -rn "place_id" tools/planner/api/src
(no output)
```

Nothing in this tool reads Nominatim's `place_id` at all, so claim 4 from the
capture (`place_id` differs between the two captures for the same `osm_id`)
is informational for this ticket and not a live defect — noted rather than
acted on. `api/src/grounding/cache.ts`'s `locateKey`/`travelKey` are keyed on
the requested `Place`, never on anything the reply returns.
