---
id: pl-36
tool: planner
title: Two more OSM sources built and dropped before they can be attributed
kind: fix
milestone: P3
status: in-flight
depends_on: []
note: finding 1 built; finding 2's provenance taxonomy is an open decision
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

**2026-08-30 — both traces re-reproduced against `80bfc64`, then finding 1
built and finding 2 taken as far as its open decision allows.** Branch
`pl-36`, based on `origin/main` at `80bfc64`.

### The premise still holds, and one citation had drifted

pl-33 landed as `80bfc64` and rewrote `valhalla.ts`, `cache.ts`, `fixtures.ts`,
`discovery.ts`, `orchestrator.ts`, `plan.ts` and `compose.ts` — the ground both
findings stand on — so neither was taken on trust.

**The three citations in this subsection are pinned to `80bfc64`**, because
that is the tree the defect was reproduced in and this branch has since moved
two of the files. Check them with
`node scripts/citations.mjs <this file> --rev 80bfc64`, not against the working
tree, where they are the fix rather than the defect.

- **Finding 1 reproduces**, at `tools/planner/api/src/runs/travel.ts:285-296`
  and not `286-296`: the block had moved up one line. `located` was still
  `Map<string, Coordinates>`, and `outcome.value.source` was read in exactly one
  place in the tool — the cache's own write-back,
  `tools/planner/api/src/grounding/cache.ts:422` — and nowhere that reaches a
  plan.
- **Finding 2 reproduces**, at
  `tools/planner/agent/src/providers/scripted-fan-out.ts:89-98`, unmoved.
  Nothing copied a `Find`'s `sources` anywhere; `prompt.ts`'s `discoveryBlock`
  renders a find's name, kind, coordinates and tags and a bare "has independent
  editorial coverage" flag, and never a URL.

### Finding 1 — the geocode's `Source` rides on the leg it made measurable

`measured()` in `api/src/runs/travel.ts` now cites the geocoder that placed a
leg's two ends alongside the router that measured between them. `measureTravel`
keeps a `geocoded: Map<string, Source>` beside `located`, filled only for places
_this pass_ looked up, and `tableFor` hands the two ends' entries to `measured`.

**Why there, and what was weighed against it.** Three homes were possible and
the brief explicitly refused to assume the first:

- **A field on `Place`** — the one the ticket warned against. It is a contract
  edit to a type every candidate carries twice, a `placeSchema` change, a nullable
  column, and it repeats one identical citation across every place on the plan.
  It also has no answer for a `Place` a model proposed with `coordinates: null`,
  which is most of them.
- **A new plan-wide field on `PlanRevision`**, beside `coverage` and `reading`.
  Defensible — those two set the precedent that evidence a live backend answered
  once at compose time is stored rather than derived — but it is a contract edit,
  a migration and a fourth list on the revision, to say something the existing
  `Provenance.sources` list can already say.
- **On the fact the geocode produced**, which is what was built. A route between
  two geocoded points is a number _derived from_ both reads: a wrong geocode is a
  wrong distance, so citing only the router under-reports what the plan depended
  on. Costs no contract change, no migration and no rewrite of stored candidates,
  and it lands in the column pl-35 already renders.

**A geocoded coordinate is never itself rendered** — nothing under `web/src`
reads a `latitude` — so the leg is not merely a convenient home, it is the only
user-visible fact a `locate` call produces. An end that arrived carrying its own
coordinates contributes nothing, because nothing looked it up.

**This uncovered a live defect in pl-35's own fix.** `travelSourcesOf` in
`PlanView.tsx` deduplicated on `source.url` alone, and this provider cites **one**
URL for everything it answers — `openstreetmap.org/copyright`, the attribution
page the ODbL asks for rather than the deployment's endpoint — telling its
services apart in the _title_. So the moment a leg cited both, the plan would have
credited one of the two backends it used and dropped the other silently.
`ProvenanceNote` had the same key, where it was a React duplicate-key warning that
does not fail a test. Both now key on URL and title. Harmless before this ticket,
because every measured leg carried the router and nothing else.

### Finding 2 — the plumbing is built, the taxonomy is an open decision

**Provenance is no longer the model's to state.** `candidateProposalSchema` in
`agent/src/ask.ts` now omits `provenance` alongside `id` and `specialist`, and
`accept()` in `agent/src/orchestrator.ts` stamps it — `MODEL_ASSERTED` for every
candidate, which is precisely what every plan said before this ticket. Nothing
about a run's output changed; only who decides.

That is not tidying. `provenanceSchema` accepts
`{"kind":"grounded","sources":[…]}`, `askSpecialist` validated a model reply
straight into it, and `ProvenanceNote` renders a `grounded` candidate as
**Sourced** with its sources as live links — so a specialist could mark its own
invention as checked and hang a clickable link off a URL nobody had ever
fetched. The one field whose job is to say whether the model is to be believed
was a field the model filled in. This is the same rule this repo already wrote
down for `id` and `specialist` and it is required under **every** answer to the
taxonomy question below, including "stays `model-asserted` forever" — which is
why it was built before the decision rather than after.

**Folded in: `CostEstimate.provenance` is overwritten in the same `accept()`.**
One field over, the same self-certification, and the version that would have
done the most damage — §5 ranks prices the fastest-ageing thing this tool
touches and they are what a reader acts on. It is overwritten rather than
omitted because `costEstimateSchema` is `.refine`d and a refined schema has no
`.omit`; splitting it to omit the field would be a contract edit, which belongs
with the taxonomy decision and not smuggled in beside it.

**What is deliberately not built: which sources a candidate written off a `Find`
should carry.** The ticket asked for a decision or a reasoned refusal, and this
is a subagent's report rather than a decision — the options, their costs and a
recommendation went to the dispatching agent as an open decision. Two facts
found while sizing them belong here whatever is chosen:

- **`Provenance.tsx`'s own doc comment already asserts the answer**, and no code
  path makes it true: "Discovery turns a database row into a `Candidate` a
  specialist judged worth writing about, and that candidate's `provenance` is
  `grounded`". pl-29 shipped the copy fix that makes `grounded` safe to say —
  "reading it is not recommending it" — for behaviour that does not exist. So
  the taxonomy may be less open than this ticket's own Why section supposed;
  what is genuinely open is whether that sentence was a decision or a
  description of intent.
- **The hard half is matching, not naming.** Under every option that attributes,
  something has to know which find a proposal came from, and nothing carries
  that: the prompt gives the model a find's name in quotes and takes back free
  prose, so the only code-side join available today is on the place name.
  Attaching an OSM citation to a candidate that is _not_ the find is worse than
  attaching none, so that mechanism is a decision in its own right and was not
  guessed at.

`accept()` is now the single place any of those answers lands, which is what
this half of the ticket bought.

### Not done, and could have been

- **`PlanRevision.reading` is stored and never rendered** — pl-33's Wikivoyage
  sources, a third instance of pl-35's "stored is not shown" shape, in the file
  this branch already had open two functions above `TravelSources`. Not folded
  in: it is not specified anywhere, it needs its own copy decision ("about this
  route" is not "we checked this"), and pl-36's scope is the two gaps traced
  above. Worth a ticket; naming it here so the next agent does not have to find
  it again. Confirmed by `grep -rn reading tools/planner/web/src`, which returns
  only `App.tsx`'s unrelated `useState` and three comments.
- **The corridor-endpoint `locate` in
  `tools/planner/api/src/runs/discovery.ts:484-502` still drops its
  `Source`**, and that is argued rather than overlooked. Nothing user-visible is
  derived from a corridor endpoint's coordinates: the corridor's product is the
  `Find` list, and each find carries its own OSM citation from Overpass. Citing
  the geocoder for a line nobody is shown would be attribution theatre. If a
  future ticket renders the corridor itself, this stops being true.

### Gates

```
$ npm run build                            # 0
$ npx vitest run tools/planner/api/test/travel-measure.test.ts   # 9 passed
$ npx vitest run tools/planner/web/test/plan-view.test.tsx       # 22 passed
$ npx vitest run tools/planner/agent/test/fan-out.test.ts        # 18 passed
$ npm test -- --project planner            # 53 files, 821 tests, all passing
$ npm run check                            # 0
```

Baseline for the planner project at `80bfc64` is **816**, measured by stashing
this branch's diff and re-running rather than read back from a note; this branch
adds five tests — three in `travel-measure`, one in `plan-view`, one in
`fan-out`.

**Every new assertion was made to fail first**, because a test that only ever
passed proves the fixture and not the code:

- `citations([cell.source, ...ends])` → `[cell.source]`: 2 of the 3 new travel
  tests failed, `expected [ 'OpenStreetMap, routed by Valhalla' ] to deeply
equal [ …(2) ]`. The third is the negative — an end nothing looked up cites no
  geocoder — and stayed green, which is what makes the pair worth having.
- `travelSourcesOf`'s key → `source.url`: the new plan-view test failed.
- `ProvenanceNote`'s React key → `source.url`: the same test failed **only**
  through its `console.error` spy. React does not fail a render on a duplicate
  key, it warns and renders both anyway, so without the spy that fix would have
  been unpinned — the warning is visible in `--reporter=verbose` and nothing in
  this suite turns it into a failure.
- Dropping `provenance: MODEL_ASSERTED` from `accept()`: failed with `expected
undefined to deeply equal { kind: 'model-asserted' }` — undefined, because the
  schema now strips what the model sent. Dropping the `cost` line instead:
  failed with `expected { kind: 'grounded', …(1) } to deeply equal { kind:
'model-asserted' }`, which is the model's invented citation arriving intact.

**`status` is `in-flight`, not `done`.** Done-when's second bullet asks for a
recorded decision about a discovery-derived candidate's provenance, and this
session was told to bring that as options rather than settle it. A ticket
claiming `done` over an unanswered acceptance line would be the one thing
`npm run status` cannot afford to be wrong about.
