---
id: pl-36
tool: planner
title: Two more OSM sources built and dropped before they can be attributed
kind: fix
milestone: P3
status: done
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

## Review

### Gate 1 — 2026-08-30, at `cc970dd`

**Gate: FAIL** — on exactly one acceptance line, the taxonomy criterion, which
the branch had deliberately left open and marked `status: in-flight` rather than
claiming. The gate said so explicitly and confirmed the bookkeeping was right.

**This record is the coordinator's relay, not the reviewer's own text.** The
reviewer's report did not reach this session verbatim, so what follows is
transcribed from the dispatching agent's summary and is marked as such rather
than presented as a quotation. Whoever holds the original should replace this
subsection with it.

| Done when                                                                     | Proof                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A geocoded place's `Source` survives from `locate` to somewhere a reader sees | proven — confirmed by the gate                                                    |
| A decision recorded for a discovery-derived candidate's provenance            | **unproven** — the one FAIL. Left open on purpose and answered in the round below |
| Whatever is rendered follows pl-29 Build step 6's copy rule                   | proven — confirmed by the gate                                                    |
| `npm run check` and `npm test -- --project planner` pass                      | verified — the gate re-ran them                                                   |

- **high** · the taxonomy acceptance line is unanswered. Resolved in round 2:
  `model-asserted`, permanently, with the argument in the Log.
- **low** · `travel-measure.test.ts:334,335,370` carry literal NUL bytes, which
  make plain `grep` return nothing on the file. Correct as `placeIdentity()`
  output — the gate mutation-tested the fixtures twice and they are
  load-bearing, not tautological — but rewritten as `placeIdentity(place(...))`
  calls in round 2. **A relay that these were committed corruption was withdrawn
  by the coordinator after checking with `od -c`; they were not.**
- **low** · the Log cited `grep -rn reading tools/planner/web/src` as returning
  three comments; it returns seven. Conclusion unaffected. Passage rewritten in
  round 2 rather than the number patched, since rendering the field made it
  stale.
- **low** · `citations()`'s `.slice(0, MAX_SOURCES)` has no test above two
  sources. Rated low by the gate because the code's own comment says why it
  cannot bite. Left unpinned, with the reasoning recorded under
  "Not done, and could have been".
- **verified by the gate, end to end against the base** · the self-certification
  closure — a model can no longer state its own `provenance`.
- **findings** · 1 high (now closed), 3 low.

### Gate 2 — 2026-08-31, on the `reading` fold-in

**Gate: PASS**, one `low`. Scoped to the fold-in alone, as reserved above.
**Written from the coordinator's relay, not the reviewer's own text** — the same
caveat Gate 1 carries, and for the same reason.

What it reproduced rather than took on trust:

- **Both new tests mutation-tested in both directions.** Deleting
  `<RouteReading …>` at `PlanView.tsx:235` reddened the positive test; deleting
  the `reading.length === 0` guard reddened the negative. Neither is vacuous.
- **`revision()`'s fourth parameter defaults such that every pre-existing caller
  is unchanged** — the fixture-builder change this Log flagged as the one item
  outside the coordinator's own sizing.
- **The copy renders as intended** — "Background on this route is something we
  read at a source — reading it is not recommending it" — with no endorsing
  language, matching `TravelSources`'s already-shipped capitalised-noun cadence.
- **Every caller of `citations()` read, and the reachability argument
  confirmed**: `measured()` is called from exactly one site with a two-element
  array, so at most three sources against a ceiling of five. The guard is dead
  today and leaving it unpinned was right.

- **low** · `agent/src/orchestrator.ts` and `agent/src/ask.ts` still described
  the discovery-candidate taxonomy as an open question, after the commit that
  settled it. Neither file was in that commit's diff, so the staleness was
  _produced_ by the decision rather than inherited. **Fixed in this round**, with
  the note below, which is the part worth more than the corrected sentences.
- **findings** · 0 high, 0 med, 1 low (closed).

### Gate 3 — 2026-08-31, at `72f68ea` — defect hunt run by the reviewer, at `medium`, over `origin/main...72f68ea`

**Gate: PASS**

**What I re-derived vs. what I am not re-deriving.** Gates 1 and 2 already recorded
in the ticket are, by their own text, "the coordinator's relay, not the reviewer's
own text" — so I did not treat either as ground truth. I re-read the whole diff
myself, re-ran the suites, re-resolved the ticket's own citations, and
independently traced each Done-when line to its test. I am not re-deriving pl-29's
or pl-35's own history, which this ticket only references.

**Tree confirmed.** `git checkout --detach 72f68ea` then `git log --oneline -1`
returns `72f68ea Merge remote-tracking branch 'origin/main' into pl-36`, matching
the sha I was given. `git diff --stat origin/main...72f68ea` shows the branch's own
12-file, 1020-line change (3 non-merge commits: `cc970dd`, `4c7be18`, `fc91c93`).
All line numbers below are against this tree.

| Done when                                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A geocoded place's `Source` survives from `locate` to somewhere a reader can see it                                                                  | proven — `api/test/travel-measure.test.ts:302-384` (three tests: both ends geocoded, neither, one of two), rendering side proven by `web/test/plan-view.test.tsx:717-763`                                                                                                                                                                               |
| A decision recorded for discovery-derived candidate provenance, and a find's sources reach it, or a reasoned argument that it stays `model-asserted` | proven — the reasoned-refusal path was taken (Log, "The decision"); enforced at `agent/src/ask.ts:71-76` (`candidateProposalSchema` omits `provenance`) and `agent/src/orchestrator.ts:367,373` (`accept` stamps `MODEL_ASSERTED` on both `provenance` and `cost.provenance`); self-certification closure proven by `agent/test/fan-out.test.ts:85-121` |
| Whatever is rendered follows pl-29 Build step 6's copy rule                                                                                          | proven — `web/src/plan/Provenance.tsx:111` copy unchanged, asserted at `web/test/plan-view.test.tsx:690` for the new `RouteReading` section specifically                                                                                                                                                                                                |
| `npm run check` and `npm test -- --project planner` pass                                                                                             | verified — ran both: `npm run check` exits 0; planner project reports 53 files, 823 tests passing, matching the Log. Also ran full `npm test` (115 files, 1772 tests passing), which exercises `packages/core/test/host-resolution.test.ts` against this branch — it passes and this branch touches nothing that scan covers                            |

**Independently reproduced, not just read:**

- `node scripts/citations.mjs` on this ticket: 10/10 resolve against the working
  tree. Against `--rev 80bfc64` one citation fails, which the Log's own pinning
  instructions already predict — not a defect.
- No literal NUL bytes remain in `travel-measure.test.ts`, confirming the round-2 fix.
- `KEY_SEPARATOR` at `api/src/grounding/place-key.ts:79` is the NUL escape, matching
  the separator reused in `citations()` and in the dedup keys.
- `costEstimateSchema` is a `.refine`d `ZodObject`, which has no `.omit` — confirms
  why `cost.provenance` is overwritten rather than schema-omitted.
- No read of `Place.coordinates.latitude` anywhere under `web/src` — confirms the
  load-bearing premise for hanging the citation on the leg rather than on `Place`.
- `discoveryBlock` in `agent/src/prompt.ts:229-243` renders name, kind, coordinates
  and tags, never a URL — confirms the premise behind leaving discovery-derived
  provenance `model-asserted`.
- The corridor-endpoint `locate` at `api/src/runs/discovery.ts:484-499` does still
  discard `outcome.value.source` — the disclosed deferral is accurately described.
- The PR title passes `node scripts/commit-message.mjs --text`.

**Settled findings, not proposed as new work:**

- **low, already settled** · `citations()`'s `.slice(0, MAX_SOURCES)` is unpinned by
  a test. Gate 1 rated it low and the ticket argues why (unreachable through its
  only caller today). I agree and am not re-raising it.
- **low, already settled** · the corridor-endpoint `locate` still drops its
  `Source`. Argued in the same section. I agree and am not re-raising it.
- **dropped** · a collision risk in the new url-plus-separator-plus-title dedup key:
  `sourceSchema.title` is `z.string()` and could in principle carry an embedded
  separator from external data, which would only ever coalesce two citations, never
  fail in a security-meaningful way, and the same strategy is already load-bearing
  in this file. Not worth carrying at `medium` depth.
- **findings** · defect hunt at medium, run by the reviewer, over
  `origin/main...72f68ea`: 0 new findings; 2 carried-forward-and-settled, not
  counted as open; 0 dropped in the unresolved-disagreement sense.
- NFR: security — n/a for new attack surface, the change removes a
  self-certification hole rather than adding one · performance — n/a, one extra
  `Map` per `measureTravel` call · reliability ✓ — spot-checked two mutations and
  both reproduced the described failures · maintainability ✓.

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

### Finding 2 — the plumbing is built; the taxonomy is answered below

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
taxonomy question below, including the "stays `model-asserted` forever" that was
in fact chosen — which is why it was built before the decision rather than
after.

**Folded in: `CostEstimate.provenance` is overwritten in the same `accept()`.**
One field over, the same self-certification, and the version that would have
done the most damage — §5 ranks prices the fastest-ageing thing this tool
touches and they are what a reader acts on. It is overwritten rather than
omitted because `costEstimateSchema` is `.refine`d and a refined schema has no
`.omit`; splitting it to omit the field would be a contract edit, which belongs
with the taxonomy decision and not smuggled in beside it.

### The decision: a discovery-derived candidate stays `model-asserted`

**Permanently, and this is the reasoned refusal Done-when's second bullet asked
for as its alternative.** Put as options with costs to the dispatching agent
rather than settled here; the user chose this one. The recommendation that went
up was the other one — `grounded`, matching what `Provenance.tsx` already
claimed — and **the measurement the gate brought is what changed the answer**,
so it is recorded here rather than the verdict alone.

**There is no data. Not a small sample — none.** `finds` never reaches
`runFanOut` in any test in this repo; all six checked-in candidate fixtures
carry only `{brief, candidates}`; nothing has ever run a `Find` through a
specialist prompt and captured what name came back. So the join every
attributing option depends on — deciding which find a proposal was written from
— would be built against **zero** observations of what a specialist actually
echoes. The prompt hands a model a find's name in quotes and takes back free
prose, so the only code-side join available is on the place name, and its
false-match rate is not estimated low, it is unmeasured. **Attributing
OpenStreetMap to the wrong candidate is worse than attributing nothing**: it is
a citation that says "we read this about this thing" where the second "this" is
a different place. Attributing nothing merely says the assistant is talking,
which is true.

That is also pl-29 Build step 6's own precedent one layer out, and it now reads
the same way at both layers: `Provenance` gains nothing from a third member,
because the distinction that matters — a routing engine's answer versus a
database row nobody reviewed — belongs in the copy, and the copy already says
it.

**What would have to exist before this is worth reopening**, so the next agent
does not re-derive it: **a labelled corpus of real specialist replies generated
with actual `finds` in the prompt** — enough runs, against a real model, with
the finds recorded beside the candidates that came back, that the name-match
join has a measured false-match rate rather than an assumed one. Until that
exists there is nothing to evaluate a join against, and a join nobody can score
is the thing this decision refuses. A `Find`'s own `sources` remain correct,
populated and unused by the fan-out; nothing about them was deleted.

**One consequence, fixed in this commit.** `Provenance.tsx`'s header asserted in
the present tense that a discovery-derived candidate's `provenance` _is_
`grounded`. No code path ever made that true and under this decision none will,
so it was affirmatively wrong and is now corrected — with a note in the file
about **why it survived review**, which is the part that will recur: it was a
present-tense claim about a _different package_ (`agent`), inside a doc comment
justifying a change to _this_ one, where it reads as motivation rather than as
behaviour. Nothing in this repo can fail on that. The tell is grammatical, not
technical.

`accept()` in `agent/src/orchestrator.ts` is the single place that answer lands,
which is what this half of the ticket bought.

### Folded in on the second round — `PlanRevision.reading` now renders

The first round left this as "not done, and could have been": pl-33 plumbed
`reading` end to end — `runs/discovery.ts` to `runs/orchestrator.ts:393` to the
`reading_json` column in `db/plans.ts:391` to `contract/src/plan.ts:300`, capped
by `MAX_REVISION_READING` — and then rendered it nowhere, so a Wikivoyage entry
the tool fetched and stored was visible only through `sqlite3`. A **third**
instance of pl-35's "stored is not shown" shape, two functions above
`TravelSources` in a file this branch already had open. The user asked for it
here rather than as its own ticket.

`RouteReading` in `web/src/plan/PlanView.tsx` mirrors `TravelSources` and reuses
`ProvenanceNote` rather than adding a second renderer, so the non-endorsing
sentence stays the one sentence this file has for a grounded fact.

**The copy was the only open part, and it is `what="Background on this route"`**
— proposed rather than escalated. It takes `TravelSources`'s cadence (a noun
phrase naming the claim, as against the shipped per-item `"this"` and
`"the cost"`), so the rendered sentence is "Background on this route is
something we read at a source — reading it is not recommending it". That
trailing clause earns more here than anywhere else it is used: editorial
coverage of a whole region is the citation a reader is likeliest to read as an
endorsement of the trip, and §5's amendment is explicit that "OSM says a
viewpoint exists; it does not say anyone should go". Rejected: anything with
"recommended", "highlights" or "worth reading" in it, all of which are the
endorsement pl-29 Build step 6 removed.

**Sizing, since the estimate was flagged as an estimate.** It came in at the
13-line component plus a test, as the coordinator sized it, and **one mechanical
extra that was not in the estimate**: `revision()` in
`web/test/plan-fixtures.ts` hard-coded `reading: []`, so it needed a fourth
optional parameter and a `type Source` import before any test could set the
field. Two lines and an import — named rather than absorbed, because the whole
point of flagging an estimate is that the difference gets reported.

Deduplication is not repeated in the view: `runs/discovery.ts` already dedupes
by URL as it builds the list, and a second answer to a settled question is how
two dedup rules drift apart.

### Not done, and could have been

- **The corridor-endpoint `locate` in
  `tools/planner/api/src/runs/discovery.ts:484-502` still drops its
  `Source`**, and that is argued rather than overlooked. Nothing user-visible is
  derived from a corridor endpoint's coordinates: the corridor's product is the
  `Find` list, and each find carries its own OSM citation from Overpass. Citing
  the geocoder for a line nobody is shown would be attribution theatre. If a
  future ticket renders the corridor itself, this stops being true.
- **`citations()`'s `.slice(0, MAX_SOURCES)` is left unpinned, deliberately.**
  The gate rated it low and left the call here. It is unreachable through the
  only caller: `measured()` is handed exactly one routing source and two ends,
  so three, against a ceiling of five. Pinning it would mean exporting a private
  helper from `runs/travel.ts` purely to assert a branch no caller can enter —
  widening the module's surface to test unreachable code, which is a worse trade
  than the guard costs. It stays because it is not decoration: a `Provenance`
  over `MAX_SOURCES` is one `provenanceSchema` refuses on the way to the
  database, and that loses the whole revision rather than one citation. The day
  a seam returns more sources, that seam's own change makes this reachable and
  the test belongs with it.

### Gates

```
$ npm run build                            # 0
$ npx vitest run tools/planner/api/test/travel-measure.test.ts   # 9 passed
$ npx vitest run tools/planner/web/test/plan-view.test.tsx       # 24 passed
$ npx vitest run tools/planner/agent/test/fan-out.test.ts        # 18 passed
$ npm test -- --project planner            # 53 files, 823 tests, all passing
$ npm run check                            # 0
$ node scripts/citations.mjs <this file>   # every citation resolves
```

Baseline for the planner project at `80bfc64` is **816**, measured by stashing
this branch's diff and re-running rather than read back from a note; this branch
adds seven tests — three in `travel-measure`, three in `plan-view` (one of them
the `reading` render's negative half), one in `fan-out`.

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
- Unwiring `<RouteReading reading={revision.reading} />` from `Document`: the
  `reading` render's positive test failed. Its negative half — a revision that
  read nothing shows no such section — stayed green, which is exactly why the
  positive one is the half that proves anything.

### Second round, after the gate

The gate returned **FAIL on one line only**, the taxonomy criterion this session
deliberately left open and marked `in-flight` rather than claiming. That is now
answered above and `status` is `done`.

- **`travel-measure.test.ts` no longer contains a literal NUL.** Its three
  gazetteer keys were `placeIdentity()` output written out by hand, which is
  correct — `KEY_SEPARATOR` at `tools/planner/api/src/grounding/place-key.ts:79`
  is a NUL (`U+0000`), and `cache.ts` and `valhalla.ts` build keys the same way — and it
  was still worth changing: a literal NUL makes the file binary to `grep`, which
  then returns nothing at all rather than no match, and the gate hit that itself
  while resolving line numbers. They are now
  `[placeIdentity(place("Rimouski", "Québec, Canada"))]` and so on, matching the
  `two places that share a name` block above them. **This was briefly relayed to
  me as committed file corruption; it was not, and I did not go looking for
  more** — the coordinator withdrew that reading after checking with `od -c`, and
  a scan of the three files this branch touches finds no NUL byte outside string
  escapes.
- **A miscount in this Log, fixed by rewriting the passage rather than the
  number.** It claimed `grep -rn reading tools/planner/web/src` returns
  "`App.tsx`'s unrelated `useState` and three comments"; it returned seven
  matches, not four. The conclusion it supported was right — nothing rendered
  `PlanRevision.reading` — but the passage is gone now that the field renders,
  because a count that is about to be stale is worse than no count.

**A note for whoever edits source here next, because it cost real time twice.**
The Edit tool writes a **literal NUL byte** when the replacement text asks for a
NUL escape, silently turning a `.ts` file binary — after which plain `grep -n`
returns nothing for patterns that are plainly present, which reads as a failed
edit rather than as a damaged file. Caught with `od -c`, repaired with `perl -i
-pe 's/\x00/.../'`. Check with `perl -ne 'print if /\x00/'`, not with `grep`,
which is the tool the problem disables.

### Third round — the rule did not catch its own neighbours

Gate 2 found `agent/src/orchestrator.ts` and `agent/src/ask.ts` still calling
the discovery-candidate taxonomy an open question — "is an open decision… the
answer lands here… whatever it turns out to be", "pl-36's remaining question" —
after the commit that settled it. Reproduced by reading both against this Log's
own decision section before touching either. Both corrected; the tense on the
_code_ was already right, and it was the tense on the _process_ that was wrong.

**The gate's own observation is the finding: this is the same defect this round
diagnosed in `Provenance.tsx`, and it recurred immediately, in the two files
that actually govern the decision.** So the question worth answering is not what
the sentences should have said. It is why the rule written a few hours earlier
did not cover the paragraph next door.

**Because the rule was written about a symptom.** It said the tell was
_grammatical_ — a comment describing what some **other package** does is an
assertion nothing here can check. That is true, and it is one case of something
wider. These two comments are the opposite shape on every axis it named: they
describe **this** package, they were **true** when written, and they are about a
_question_ rather than about behaviour. The narrow rule cannot see them, because
scope was never the mechanism.

**The mechanism is the falsifier, and the wider rule is one question: must the
change that would make this sentence untrue edit the file the sentence is in?**

| sentence                                                         | what would falsify it           | in this file's diff? |
| ---------------------------------------------------------------- | ------------------------------- | -------------------- |
| "a discovery-derived candidate's `provenance` is `grounded`"     | a commit in `agent`             | no — went stale      |
| "whether it should be `grounded` is an open decision"            | a decision recorded in a ticket | no — went stale      |
| "`cost.provenance` is overwritten because the schema is refined" | editing this object literal     | yes — safe           |
| "it is `model-asserted`; the argument is in pl-36's Log"         | editing this object literal     | yes — safe           |

The second row is the one the narrow rule missed and the one that is easiest to
write, because **a decision recorded in a ticket's Log touches no source file at
all** — there is no commit anywhere that a reviewer of `orchestrator.ts` would
see. That is precisely what the gate meant by the staleness being _produced_ by
the decision rather than inherited: this Log entry is the diff that falsified
those two comments, and it is in another directory.

`Provenance.tsx`'s note has been rewritten to teach the wider rule rather than
the narrow one, in the file that teaches it — leaving a rule this branch has
just shown to be too small, in the paragraph that states it, would have been the
same mistake a third time.

**This repo has now recorded the same mechanism three times in three media**, and
that is the reason to write it down rather than to fix three sentences. pl-35's
Log has it for citations: "a citation can go stale from a change on a branch that
never touches the file carrying it… the edit-list and the re-derive-list are not
the same list." This round has it for a cross-package doc comment, and now for an
in-package one. Same shape every time: **the set of files an event edits is not
the set of files it invalidates**, and nothing in this repo computes the second
from the first. `scripts/citations.mjs` closes exactly one corner of it — a
`file:line` a tool can re-resolve — and prose is the rest of it, unchecked.

**Considered and rejected: leaving the two comments as a historical record of
what was open at the time.** It is a legitimate answer and it is the wrong one
here, for three reasons. A doc comment is read in the present tense by default —
nobody opens `accept()` for archaeology, they open it to learn what the code does
now. The history already has a home built for it, dated and append-only, which is
this Log. And a stale "this is an open decision" is worse than a stale "why",
because it is an _invitation_: the next agent reads it, reopens a question that
was settled on a measurement, and pays for the round pl-36's decision section
exists to prevent. History belongs where it is dated; a comment says what is
true now, and points.

**Scope note.** Three files changed this round — the two stale comments and
`Provenance.tsx`'s rule — all already in this branch's diff. No source behaviour
changed and no test was added or altered, so the suites below are the same
assertions as round 2 over corrected prose.
