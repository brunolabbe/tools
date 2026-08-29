---
id: pl-33
tool: planner
title: Capture a real Overpass payload, and wire up notability
kind: fix
milestone: P3
status: ready
depends_on: [pl-29]
---

# pl-33 — The two halves of pl-29 that could not be built here

## Why

[pl-29](./pl-29-detours-along-a-leg.md) built the discovery seam, the Overpass
adapter's query and parser, the geometric filter, the two-pass grounding state,
and the `coverage` taxonomy member — everything that does not depend on a
network this environment could reach. Two things do, and neither could be
built there, for the same reason pl-30 exists beside pl-28: this environment
has no route to `overpass-api.de`, `en.wikipedia.org` or a Wikivoyage dump, and
no runnable Overpass-compatible engine was found on npm within pl-29's
time-boxed search.

**The first is a captured payload.** `nearby`'s tests in
`api/test/grounding-valhalla.test.ts` run against a hand-composed body,
disclosed as such in that file's own header — the same shape `pl-28`'s
`locate` was in before `pl-30`. `overpassQuery` (exported from `valhalla.ts`)
already builds the exact request; what is missing is a real reply to parse.

**The second is `Find.notability`.** The type exists and is tested at the
rendering layer (`agent/test/prompt.test.ts`), but no adapter populates it:
Wikipedia's geosearch API and Wikivoyage's dumps are both unreachable from
here, so `ValhallaGroundingProvider.nearby` always returns `notability: []`.
§5's amendment names both as free, unkeyed signals worth attaching — this
ticket is what actually attaches them.

## Build

1. **Capture `nearby`'s payload.** pl-29's Log carries the exact copy-pasteable
   capture block — the query text (`overpassQuery`, unchanged, so the capture
   uses the real request) and the curl invocation. Run it against a reachable
   Overpass instance (the public one, respecting its usage policy — one
   request, an identifying purpose in a comment — or a self-hosted instance
   over a small regional extract) and check the reply in under
   `api/src/grounding/fixture-data.ts`'s sibling in this file's own package,
   `api/test/fixtures/overpass-nearby.json`. Rewrite
   `grounding-valhalla.test.ts`'s `nearby` tests to parse it, keeping the
   synthetic hostile-name and prototype-key tests exactly as they are — those
   are deliberately hand-composed and pl-29's header says why.
2. **Wikipedia geosearch.** `GET https://{lang}.wikipedia.org/w/api.php` with
   `list=geosearch`, a coordinate and a radius, unkeyed and free. Which
   language to ask is not obvious from a `Find` alone — decide it here, and
   record the decision rather than guessing silently. One call per find is
   the naive shape; consider whether a single call over the whole corridor's
   bounding box (geosearch also accepts a bounding box) is cheaper against
   `MAX_GROUNDING_CALLS`, the same argument pl-29's detour-cost matrix already
   makes for one call over many.
3. **Wikivoyage.** Its own API mirrors Wikipedia's; whether it is worth a
   second call per find or can share the first is this ticket's to decide,
   with the reasoning written down.
4. **Both attach as `Source[]` on `Find.notability`**, per the type's existing
   contract — url, title, fetchedAt, nothing fused into a score.

## Done when

- `nearby`'s core parsing tests run against a payload captured from a real
  Overpass instance, with the same disclosure pl-28's `travel` tests give
  theirs.
- A find near a place with a Wikipedia article carries a `notability` entry
  for it, proven against a captured reply.
- `npm run check` and `npm test -- --project planner` pass.

## Log
