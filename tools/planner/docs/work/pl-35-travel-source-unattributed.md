---
id: pl-35
tool: planner
title: A measured leg's OSM attribution is stored and never shown
kind: fix
milestone: P3
status: done
depends_on: []
---

# pl-35 — A measured leg's OSM attribution is stored and never shown

## Why

Every one of the four real Nominatim replies pl-30 captured carries a
`licence` field: `Data © OpenStreetMap contributors, ODbL 1.0.` The ODbL asks
for attribution wherever the data it covers is shown, and `valhalla.ts`
already took that seriously when it was written — `OSM_ATTRIBUTION`
(`https://www.openstreetmap.org/copyright`) is exactly the citation pl-28's
own comment says the ODbL requires, and every `locate`/`travel` result
carries it as a `Source`.

**Stored is not shown.** Confirmed freshly, not carried from an earlier
transcript:

```
$ grep -rl "fetchedAt" tools/planner/web/src
tools/planner/web/src/plan/Provenance.tsx
$ grep -rl "travelFromPrevious" tools/planner/web/src
(no output)
$ grep -n "ProvenanceNote" tools/planner/web/src/plan/PlanView.tsx
43:import { ProvenanceNote } from "./Provenance.tsx";
351:          <ProvenanceNote provenance={candidate.cost.provenance} what="the cost" />
355:      <ProvenanceNote provenance={candidate.provenance} what="this" />
```

`ProvenanceNote` — the component that renders a `Provenance`'s `sources` as
links, with title and date — is wired up for a candidate's own provenance and
its cost's, and nothing else. `PlanItem.travelFromPrevious`
(`tools/planner/contract/src/plan.ts:114`) is a separate `ItemTravel` union
whose `measured` member carries its own `provenance: Provenance`
(`tools/planner/contract/src/travel.ts:95`) — the **same** `Provenance` type
`ProvenanceNote` already knows how to render — and nothing in `PlanView.tsx`
reads it. Every geocoded and routed leg the tool measures carries a `Source`
citing OpenStreetMap that no user of the plan ever sees.

This is an attribution obligation the data model already satisfies and the
view does not, not a parsing or grounding defect — `firstCoordinates`, the
travel matrix, and the `Source` objects `valhalla.ts` builds are all correct
today. Filed as its own ticket rather than folded into
[pl-34](./pl-34-locality-free-query-confident-wrong-place.md), which is about
the geocoder query, not the plan view.

## What this is not

- Not a fixture, parser, or grounding defect. `ItemTravel.measured.provenance`
  is populated correctly by `runs/travel.ts` today.
- Not blocking pl-28 or pl-30, which are about the seam producing a correct,
  sourced measurement — this is about a correct, sourced measurement never
  reaching the page.

## Done when

- A decision is recorded for how a measured leg's source is shown — reusing
  `ProvenanceNote` against `item.travelFromPrevious`'s `provenance` where
  `kind === "measured"` is one candidate shape, not a mandate; the wording and
  placement in the day view are left open.
- The `not-established` and `over-budget` `ItemTravel` kinds are considered
  too: whatever is added should not claim a source for a leg nothing
  measured.
- A component or integration test pins that a measured leg's citation reaches
  the rendered page.

## Log

**2026-08-29 — filed per the coordinator's direction, id `pl-35`.** Found
while closing pl-30/pl-34; re-verified independently rather than carried from
an earlier session's transcript, per the commands above. No fix attempted —
the coordinator asked that the UI wording be left open rather than picked
here.

**2026-08-29 — folded into pl-29, not built separately.** The coordinator's
original call to file this rather than fix it was reconsidered: pl-29's
branch was already editing `web/src/plan/Provenance.tsx` for an adjacent
reason (Build step 6's copy fix, so `grounded` cannot read as an
endorsement), and attribution for an OSM-derived leg is the same paragraph
of the same component, changed by the agent already holding the context.
Filing it would have cost a future dispatch, gate, PR and merge to move a
few lines; folding it in cost one resume.

**What was rendered, and where** — `tools/planner/web/src/plan/PlanView.tsx`,
a new `TravelSources` component, wired into `Document` after `Unchecked`.
One deduplicated, plan-wide list of every distinct `Source` a `measured`
`ItemTravel` carries across the current revision's days, rendered through
the existing `ProvenanceNote` component (not a second renderer) with
`what="Distance and travel time on this plan"` — the same "is something we
read at a source — reading it is not recommending it" sentence pl-29's Build
step 6 wrote, so a measured leg cannot read as an endorsement any more than
a discovered POI can.

**What was rejected, and why** — a `ProvenanceNote` block under every single
item with a measured leg. Every leg on one plan is measured by the same
backend in the same run, so a per-item block would repeat one citation as
many times as there are legs — real clutter on a multi-day trip, and the
risk pl-35's own Why section anticipated on the other side of "too thin". A
per-day summary was also rejected: the source does not change with the day,
so a per-day list would repeat the same one or two sources once per day for
no reason. The plan-wide, deduplicated list is the shape a map's own "©
OpenStreetMap contributors" caption already takes — shown once, wherever the
data appears, not once per feature.

**`not-established` and `over-budget` legs contribute nothing**, by
construction: `travelSourcesOf` only reads `travel.provenance` on the
`measured` branch of the `ItemTravel` union, so a leg nothing measured has
no `Provenance` for the function to reach in the first place — pl-35's
Done-when named this as a trap and TypeScript's own narrowing is what closes
it, not a runtime check that could be forgotten.

**Tested, paired per the coordinator's instruction that a negative assertion
alone proves nothing:**

```
$ npx vitest run tools/planner/web/test/plan-view.test.tsx
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

Two new tests, in a `describe("travel sources", ...)` block. The positive one
is the half that actually proves something — it fails if `TravelSources` were
deleted or never wired in — and it also pins deduplication directly: two
items whose `travelFromPrevious` cite the identical `Source` object render
**one** link, not two. Verified live, both directions:

- Removed the `<TravelSources days={revision.days} />` wiring line: the
  positive test failed on `findByText(/distance and travel time on this
plan/i)` timing out, 20/21. Restored, 21/21.
- Broke deduplication (salted each source's map key with `Math.random()`
  instead of keying by `source.url`): React itself warned about a duplicate
  key, and the assertion failed with `expected [...] to have a length of 1
but got 2`. Restored, 21/21.

The first attempt at the positive test used only one measured leg, which
passed whether or not deduplication existed at all — caught before trusting
it, by deliberately breaking dedup and watching the original test stay green.
Rewritten to use two items sharing one `measured` object before either
mutation check above was run for real.

**Merge-clean recheck against `origin/pl-30-geocoder-fixtures`**, as asked,
since this file also exists there with `status: ready`:

```
$ git fetch origin pl-30-geocoder-fixtures
$ git merge-tree $(git merge-base HEAD origin/pl-30-geocoder-fixtures) HEAD origin/pl-30-geocoder-fixtures
```

See this ticket's own commit for the exact output; recorded in the pl-29
report rather than duplicated here twice. The one file both branches touch
is this one, and the conflict is exactly the two `status` lines and the two
different `## Log` tails — an ordinary merge conflict a person resolves by
keeping both Logs and this ticket's `done`, not a sign either branch did
anything wrong.

**Not done here**: nothing about `pl-34` (the geocoder query issue) or any
other open pl-30-branch ticket. This entry closes pl-35 alone.
