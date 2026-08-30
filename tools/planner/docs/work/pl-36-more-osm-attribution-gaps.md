---
id: pl-36
tool: planner
title: Two more OSM sources built and dropped before they can be attributed
kind: fix
milestone: P3
status: ready
depends_on: []
---

# pl-36 — Two more OSM sources built and dropped before they can be attributed

## Why

[pl-35](./pl-35-travel-source-unattributed.md) was "stored is not shown": a
`Source` citing OpenStreetMap was built correctly and never rendered. Gate D,
reviewing pl-29's fold-in of that fix, traced two more attribution gaps of
the **same shape** — but one step earlier. In both of these, the `Source` is
built and then **discarded before it reaches anything that could store it**,
so there is nothing for a future rendering fix to point at. Fixing pl-35's
view without these two would still leave every geocoded place and every
discovered POI unattributed.

Traced, not assumed — both confirmed against `15162df`:

**1. The geocoding source is discarded, not just unshown.** `locate` builds a
proper `Source` — `GEOCODED_BY = "OpenStreetMap, geocoded by Nominatim"` in
`api/src/grounding/valhalla.ts` — but the caller keeps only the coordinates:

```
$ sed -n '286,296p' tools/planner/api/src/runs/travel.ts
  const located = new Map<string, Coordinates>();
  /** Places with no coordinates, and why — `unknown` or `refused`, per place. */
  const unlocated = new Map<string, ItemTravel>();
  for (const each of places.all) {
    if (each.place.coordinates !== null) located.set(each.key, each.place.coordinates);
  }

  for (const each of places.toLocate) {
    try {
      const outcome = await provider.locate({ place: each.place, signal });
      if (outcome.kind === "answered") located.set(each.key, outcome.value.coordinates);
```

`located` is typed `Map<string, Coordinates>` — there is no field in it for a
`Source` to survive in even if the line above kept one. `outcome.value.source`
is read nowhere. This is upstream of pl-35's fix: `PlanItem.travelFromPrevious`
only ever carries a _travel_ `Provenance` (pl-27's `measured` leg), never a
_place_ one, so a geocoded coordinate's own citation has no column to land in
at all today — not a rendering gap, a plumbing one.

**2. A discovered find's source never reaches its candidate.** `Find.sources`
is populated by the Overpass adapter (`api/src/grounding/valhalla.ts`'s
`findFrom`), and a specialist reads a find's `name`, `kind` and `tags` in its
prompt (`agent/src/prompt.ts`'s `discoveryBlock`) — but nothing carries a
find's `sources` into the `Candidate` a specialist writes off it. The scripted
provider stamps every candidate `model-asserted` regardless:

```
$ sed -n '89,98p' tools/planner/agent/src/providers/scripted-fan-out.ts
function draft(input: Draft): CandidateProposal {
  return {
    title: input.title,
    summary: input.summary,
    location: input.location,
    durationMinutes: input.durationMinutes ?? null,
    cost: input.cost ?? null,
    season: input.season ?? null,
    bookingLeadTimeDays: input.bookingLeadTimeDays ?? null,
    provenance: MODEL_ASSERTED,
  };
}
```

and a real model is asked for JSON the same schema accepts either way — there
is no code path anywhere that copies a find's `sources` onto the candidate a
specialist proposes from it. pl-29's own feature discovers OSM rows and then
loses their attribution the moment a specialist turns one into a candidate.

## The question this ticket does not answer

**A candidate a model proposed _from_ a `Find` is neither cleanly `grounded`
nor cleanly `model-asserted`, and `Provenance` has two members.** pl-29's
Build step 6 declined to reopen that taxonomy on purpose — "`Provenance`
gains nothing, and that is the recommendation... a third member for 'exists
but unjudged' would put a distinction in the type that belongs in the copy."
That argument was about a _discovered POI's own_ provenance once a specialist
already decided to write about it, and it stood. It does not obviously settle
_this_ question, which is one layer removed: is a candidate whose existence
came from a find `grounded` (the place is real; a specialist merely wrote
prose about it) or `model-asserted` (the specialist's judgement that it is
worth doing is the actual claim, and the place being real is incidental)?
Both readings are defensible and they are not the same fact to a user.

**Whoever builds this has to answer that, or argue plainly that it does not
need answering — this ticket deliberately does not pick one.** The geocoding
half (finding 1) has no equivalent ambiguity: a located coordinate is either
plumbed through with its `Source` or it is not, and `Provenance`'s existing
two members already cover it the way pl-27 covers a measured leg.

## Done when

- A geocoded place's `Source` survives from `locate` to somewhere a reader can
  see it — the contract change this needs (if any) is this ticket's to design,
  not assumed to be "add a field to `Place`" without checking what else reads
  `Place`.
- Either a decision is recorded for how a discovery-derived candidate's
  provenance is represented (reusing `grounded`, reusing `model-asserted` with
  the reasoning written down, or a taxonomy change argued for on its own
  merits — not smuggled in), and a find's `sources` reach it; or a reasoned
  argument for why this should stay `model-asserted` forever, matching pl-29's
  Build step 6's own precedent for the discovered-POI-as-candidate case one
  layer up.
- Whatever is rendered follows pl-29 Build step 6's copy rule: a `grounded`
  line must not read as an endorsement, even less so here than for a measured
  distance.
- `npm run check` and `npm test -- --project planner` pass.

## Log

**2026-08-29 — filed per gate D's trace, during pl-29's review.** Not folded
into pl-29: neither `api/src/runs/travel.ts` nor
`agent/src/providers/scripted-fan-out.ts` is touched by that branch (verified
against `origin/main...origin/pl-29-detours-along-a-leg`), unlike pl-35 where
`Provenance.tsx` was already open for an adjacent reason. Both traces above
confirmed independently against `15162df` before filing.
