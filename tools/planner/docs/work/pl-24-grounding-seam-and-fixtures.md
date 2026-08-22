---
id: pl-24
tool: planner
title: The grounding seam, its fixture default, and the state a run grounds in
kind: work-package
milestone: P3
status: done
depends_on: []
---

# pl-24 — One seam for everything that reaches outside

**Packages:** `contract` (the run state and its progress frame), `agent` (the
interface), `api` (the fixture implementation, the config, health).

## Why

[00-ANALYSIS.md §5](../00-ANALYSIS.md): **everything that reaches outside goes
through one seam**, and the default implementation answers from checked-in
fixtures so a fresh clone plans a trip with no key and no bill. That argument is
already won once — `ModelProvider` is the worked example, and
`createModelProvider` in `api/src/server.ts` is the only file in the tool that
knows a backend by name. This is the same move for the second and last thing
that leaves the process.

Contract-first, for the reason [pl-4](./pl-4-plan-document-contract.md) and
[pl-16](./pl-16-the-plan-run.md) were: four packages depend on `contract`, and
[pl-27](./pl-27-travel-time-reaches-the-composer.md) and
[pl-28](./pl-28-valhalla-adapter.md) are meant to run in parallel over this
seam. Two tickets editing `run.ts` at once is the collision this ordering exists
to prevent.

Nothing in this ticket grounds anything. It builds the seam, the thing behind it
that answers offline, and the vocabulary a run needs to say it is grounding —
and it leaves the pass that uses it to pl-27. That split is deliberate: the seam
is a contract decision and the pass is a pipeline change, they fail differently,
and pl-5 is the ticket in this tool's history that shows what happens when the
two ride together.

## Build

1. **`contract/src/run.ts` — a `grounding` status.** Between `fanning-out` and
   `composing`:

   ```
   fanning-out ─► grounding ─► composing
             └──────────────────►┘
   ```

   **The edge that skips it stays legal**, and for the same reason
   `composing → done` skips `reviewing`: a run configured with a provider that
   knows nothing, or one with no leg to measure, does no grounding, and emitting
   a state it spent no time in is _never fake progress_ broken for the sake of a
   diagram. Read that file's note on `RUN_TRANSITIONS` before writing this one —
   the precedent is exact and the wording should acknowledge it rather than
   re-derive it.

2. **`RunProgress` gains a grounding frame** carrying `{ done, total }`. The
   total is knowable before the first lookup goes out — it is the number of
   distinct lookups the pass has decided to make — which is the same property
   that lets the fan-out say "4 of 7 specialists" instead of showing a spinner.
   Where it is not knowable, `null`, per §7 and the repo rule.

3. **`agent/src/grounding.ts` — the interface.** Model it on `provider.ts`,
   including the register of its header comment: the smallest thing that can
   carry one grounding call, with the reasons a vendor is not named above it.

   Two methods, not one generic `query(string)`. §5 ranks four specific
   questions — distances, opening hours, existence, prices — and a generic
   string-in-string-out seam is a search box that every caller then has to parse
   differently. This slice needs the first:

   - `locate(place)` → coordinates and the source they came from, or `null`.
   - `travel(origins, destinations, mode)` → a matrix of distance, duration and
     source, each cell `null` where the backend has no answer.

   **`travel` is a matrix and not a pair, and that is a decision worth the extra
   type.** The packer's problem is circular if it is not: travel time between
   consecutive items is only knowable once you know the order, and the order is
   what the packer is deciding. Measuring every pair up front dissolves it — the
   packer receives a table and packs under it — and every routing backend worth
   using offers exactly that call for exactly this reason. Pairwise is then the
   1×1 case, so nothing is lost, and one matrix call is **one** call against
   `MAX_GROUNDING_CALLS` rather than n². See
   [pl-27](./pl-27-travel-time-reaches-the-composer.md), which is the caller.

   **`null` is the answer for "nobody established it", and it is not an error.**
   That is `Candidate`'s rule about `durationMinutes` and `season` applied one
   layer down: a backend that does not know where Chibougamau is must not be
   able to say so by returning a plausible pair of numbers, and a caller must
   not be able to confuse "no data" with "the call failed".

   `mode` is an enum with `driving` in it today. It exists so that the day a
   `TripShape` of `motorised-touring` wants a snowmobile trail network, that is
   a new member and not a signature change.

4. **Every reply carries its own `Source`.** `contract/src/candidate.ts` already
   has `Source` and `Provenance` and this seam returns them — it does not invent
   a parallel shape. A grounded fact with no source is refused by
   `provenanceSchema` today and that is the behaviour to keep.

5. **`api/src/grounding/fixtures.ts`** — the default implementation, beside the
   scripted model provider, because that pair is what a fresh clone runs. It
   answers from payloads under `api/test/fixtures/` for the places the six
   checked-in candidate sets actually name, and returns `null` for everything
   else. **It must not interpolate.** A fixture provider that computes a
   great-circle distance for an unknown pair is grounding wearing a costume, and
   it would make pl-27's tests pass against nothing.

6. **`api/src/config.ts`** — `GROUNDING_PROVIDERS = ["fixtures"]`,
   `GROUNDING_PROVIDER` defaulting to `fixtures`, and `MAX_GROUNDING_CALLS`
   defaulting to `40`, both already in
   [01-ARCHITECTURE.md](../01-ARCHITECTURE.md)'s configuration table. An unknown
   provider name falls back to the fixture one rather than throwing — copy
   `modelProvider()`'s comment and its argument, which is that the failure is
   visible in `/api/health` and nobody will mistake a fixture answer for a
   measured one.

7. **`api/src/server.ts`** — `createGroundingProvider`, the only file that names
   a backend, and `context.grounding`. `/api/health` reports
   `grounding: { provider }` beside the existing `agent: { provider, model }`.
   **Never a key, never an endpoint** — the health route is unauthenticated and
   a self-hosted endpoint is infrastructure detail.

8. **The budget counts calls, not lookups.** `MAX_GROUNDING_CALLS` is a bill
   control (§9), and it belongs to pl-27's pass — but decide the shape here so
   both tickets agree: the pass is handed a ceiling and refuses to exceed it, in
   the same way `applyBudget` degrades the roster _before_ anything is sent
   rather than discovering the ceiling halfway through. A run that stopped
   grounding at lookup 41 with no account of the other nineteen would have paid
   for a plan that cannot say what it checked.

## Not in this ticket

The pass that calls any of it, the cache, and any real backend. They are
[pl-27](./pl-27-travel-time-reaches-the-composer.md),
[pl-25](./pl-25-grounding-cache.md) and
[pl-28](./pl-28-valhalla-adapter.md).

Also not here: **grounding inside a specialist's own call.** §5's items 2 and 3
— opening hours and existence — are things a specialist wants while it is
proposing, not afterwards, and reaching them means tool use on `ModelProvider`,
which that file deliberately does not have ("add them when the caller exists").
Travel time is genuinely not that shape: it is the composer's input, so a pass
between the fan-out and the composer is the right structure for this slice and
may well be the wrong one for the next. Say so in the header comment rather than
letting the next ticket discover it.

## Done when

- `/api/health` reports the grounding provider by name, and a test asserts the
  response contains no key and no endpoint.
- An unknown `GROUNDING_PROVIDER` yields the fixture provider, asserted in
  `api/test/config.test.ts` beside the `MODEL_PROVIDER` case.
- The fixture provider returns a located place with a `Source` for a place in
  the checked-in sets, and `null` — not a throw, not a guess — for one that is
  not. Both asserted, and the same for a matrix cell.
- `canRunTransition` accepts `fanning-out → grounding`, `grounding → composing`
  and `fanning-out → composing`, and rejects `grounding → done`.
- `npm run check` and `npm test -- --project planner` pass. The suite count goes
  up; no existing test changes meaning.

## Log

**2026-08-22 — built.** The seam, the fixture provider behind it, and the
vocabulary a run needs to say it is grounding. Nothing grounds anything yet;
that is pl-27.

`GroundingProvider` is in `agent/src/grounding.ts` with `locate` and `travel`,
both taking a request object rather than positional arguments — `ModelProvider`'s
shape, so the two seams read alike and so a signal has somewhere to live. The
matrix is a bare `readonly (readonly (TravelEstimate | null)[])[]` with a
`travelCell(matrix, origin, destination)` accessor beside it, because a nested
array is trivial to transpose by hand and the mistake is invisible on a square
one. `GroundingBudget` and `groundingBudget(max)` are there too: the brief said
to _decide_ the budget's shape here and leave the spending to pl-27, and fifteen
tested lines is a firmer agreement between two tickets than a paragraph.

**The brief was wrong about where the fixtures live, and it matters.** It said
`api/test/fixtures/`. The runtime stage of `Dockerfile` copies each workspace's
`package.json` and `dist` and nothing else, so a provider reading from `test/`
passes the suite and throws in the shipped image — and it is the _default_
provider, so that is every container nobody has given a real backend to. The
data is a checked-in `.ts` table at `api/src/grounding/fixture-data.ts` instead,
which is exactly what `scripted-fan-out.ts` already does for the scripted model
provider and for the same reason. Anything pl-25 or pl-28 checks in that the
running service must read belongs under `src` on this argument.

**Fixture sources point at `fixtures.invalid`.** Every reply carries a `Source`
because `provenanceSchema` refuses a grounded fact without one — and that source
reaches the plan view as a link the user reads as "we checked this". A
plausible URL at a real gazetteer that nothing ever fetched is precisely the
failure the provenance mechanism exists to make visible, so the host is the TLD
RFC 2606 reserves to never resolve, and the title says it is a fixture. Same
argument as the scripted provider reporting itself as `scripted` in health.

`fetchedAt` is frozen at the date this table was written rather than stamped
from the clock, so the provider stays deterministic. It ages on purpose: when
pl-25 lands, these facts age out like any others, and a fixture that stayed
eternally fresh would be the one input the TTL could never be tested against.

**Two things the brief did not mention, both forced by the contract change:**

- `Place.coordinates` was an inline anonymous type. `locate` returns the same
  shape, so it is now an exported `Coordinates` interface with a
  `coordinatesSchema`, and `placeSchema` composes it. Structurally identical —
  a name for what was already there, so the seam and the contract cannot drift
  apart field by field.
- `RUN_STATUSES` gaining a member broke `web`'s `LABELS`, which is an exhaustive
  `Record<Run["status"], string>` — the check caught it, which is the map doing
  its job. `RunView` gained the label and a `grounding` case in its progress
  reducer. The counts change meaning with the status (specialists during the
  fan-out, lookups after), so the case also clears `running`: leaving the last
  roster on screen would say specialists were still being asked.

**The fixture answers `null` far more often than it answers.** That is the
design and the tests are mostly about it — an unknown place, a region that is a
scope rather than a place (`Central Europe`), and the Mont-Albert plateau
traverse, which is seven hours on foot with no road, so both ends are in the
gazetteer and the pair is deliberately absent from the leg table. A cell that is
asked for, exists, and has no answer is the case pl-27 has to handle honestly.
A place is zero from _itself_ and that is the one derived answer, but only for a
place the gazetteer holds: answering zero for a name nobody has heard of would
invent the place and measure it in the same breath.

Leg keys join the two ends with an escaped NUL. A space would let
`"quebec city"` + `"rimouski"` collide with `"quebec"` + `"city rimouski"`;
there is a test for it.

`canRunTransition` now accepts `fanning-out → grounding` and
`grounding → composing`, and `fanning-out → composing` stays legal — the same
argument `composing → done` already won, one state earlier. `grounding → done`
and `grounding → reviewing` are refused: grounding measures what the fan-out
proposed and hands it on; it cannot finish a run.

**30 new tests; the planner suite is 562 and `npm run check` is green.** No
existing test changed meaning. Nothing was added to `01-ARCHITECTURE.md` because
its configuration table already carried `GROUNDING_PROVIDER` and
`MAX_GROUNDING_CALLS` — this ticket implemented rows that were already written.

**For pl-27:** the budget counts _calls_, not lookups, so one matrix over eight
places is one call and sixty-four pairs. Counting pairs would make the cheap
thing look expensive and push you back to n² pairwise requests to stay under the
cap. `fixturePlaceKey` is exported so a caller can deduplicate its place list
the same way the lookup will, rather than paying for a wider matrix than it
needs.
