---
id: pl-24
tool: planner
title: The grounding seam, its fixture default, and the state a run grounds in
kind: work-package
milestone: P3
status: ready
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
