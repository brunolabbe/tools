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

## Review

**Gate: CONCERNS, since addressed** — 2026-08-22 · `origin/main...HEAD` ·
`review-ticket` on Opus, delegating to `code-review` at medium on Sonnet. Both
findings are fixed in the round below; the verdict is left as it was given
rather than rewritten, because a gate that edits itself once the work is done
records nothing.

| Done when                                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health` reports the grounding provider by name; a test asserts no key, no endpoint                                     | `tools/planner/api/test/health.test.ts:37` "names the grounding provider too, and says nothing else about it" ✓                                                                                                                                                                                                                         |
| Unknown `GROUNDING_PROVIDER` yields the fixture provider, beside the `MODEL_PROVIDER` case                                   | `tools/planner/api/test/config.test.ts:47` "falls back to the fixture provider when the grounding name is unknown" ✓                                                                                                                                                                                                                    |
| Fixture provider: located place + `Source` for a known place, `null` for unknown — both for `locate` and for a matrix cell   | `tools/planner/api/test/grounding-fixtures.test.ts:29` "finds a place the checked-in candidate sets name, with a source", `:62` "answers null — not a guess, not a throw", `:104` "measures a leg the candidate sets actually propose", `:140` "has no driving answer for a walking leg, and says so with null" ✓                       |
| `canRunTransition` accepts `fanning-out→grounding`, `grounding→composing`, `fanning-out→composing`; rejects `grounding→done` | `tools/planner/contract/test/run.test.ts:63` "lets the fan-out reach grounding, and grounding reach the composer", `:75` "lets `fanning-out` reach `composing` without passing through `grounding`" ✓                                                                                                                                   |
| `npm run check` and `npm test -- --project planner` pass; suite count up; no existing test changes meaning                   | verified directly: `npm run check` exit 0; `npm test -- --project planner` → 566/566, 42 files; baseline at `origin/main` → 532/40 files (confirmed by running the suite there); the only pre-existing test files touched (`config.test.ts`, `health.test.ts`, `run.test.ts`) received insertions only, no deleted/altered assertions ✓ |

- **med · fixed** · `web/src/plan/RunView.tsx:88` — the `snapshot` reducer case
  set `total`/`done` from `run.rosterSize`/`run.specialistsDone`, the fan-out's
  counters and the only ones a `Run` carries. A client landing via `snapshot`
  while `status === "grounding"` therefore rendered "5 of 5 details checked"
  with zero lookups done. **The same line of the same bug was also in the
  mount-time `useState` initialiser**, which the review did not name and which
  is the more likely path in practice — a reload, not a reconnect. Both now go
  through one `countsFrom(run)` helper that answers `{ total: null, done: 0 }`
  during grounding, so the bar is indeterminate until a real frame arrives.
- **med · fixed** · `contract/src/run.ts:288` and `api/src/routes/events.ts:24`
  — both doc comments claimed `grounding`, like `roster`, "describes a moment
  that has already passed" and that "the `Run` already carries the count", which
  the diff never made true. Narrowed to say the `Run` carries the fan-out's
  count _and no other_, and that a client attaching during grounding has no
  number to put under the label. Giving `Run` a grounding count is left to
  pl-27, named there.
- **Coverage the gate asked for, added:** `web/test/run-view.test.tsx`, 8 tests.
  `RunView` had no test file at all, which is why this component absorbed two
  _never fake progress_ defects in one branch without a red build. Both defects
  above now have a case that fails without the fix.

- NFR: security — fixture provider fetches nothing (no SSRF surface), health leaks no key/endpoint (tested), gazetteer/leg lookups moved to `Map` closing a prototype-pollution hole (fixed in review round, tested against `constructor`/`__proto__`/`toString`) · performance — one matrix call replaces n² pairwise calls, budget checked before spend, no issue · reliability — `AbortSignal` honoured between lookups, `NaN`/`Infinity` ceiling closed; the snapshot/reconnect gap above is the one live reliability gap · maintainability — extensively commented on the `ModelProvider` precedent, budget and matrix accessor are unit-tested; `RunView`'s reducer had zero test coverage of its own, which is the gap that let both findings through; closed by `run-view.test.tsx`

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

> **Amended 2026-08-23 by pl-27: do not do this, and the export is gone.**
> `fixturePlaceKey` was `placeKey(name)` — accent-stripped, lower-cased and
> **name only**, which is right for deciding whether this provider's own small
> table holds an answer and wrong for deciding that two candidates mean the
> same place. pl-27 took the advice above and merged Saint-Jean in Québec with
> Saint-Jean in New Brunswick: the survivor's coordinates were written onto both
> candidates and persisted, and both indexed one matrix cell, so the plan
> reported a `measured`, `grounded` transition to the wrong province. Composing
> the six checked-in sets, three of them collided.
>
> The advice's _shape_ was right — one normaliser, never a reimplementation —
> and only the function was wrong. A caller that needs a place's identity uses
> `placeIdentity` in `api/src/grounding/place-key.ts`, which the grounding seam
> owns and the cache keys `locate` and `travel` by. **This matters most to
> pl-28**, which will key places too.

**2026-08-22 — review round.** A code review over the branch found four defects,
all confirmed by hand before fixing and all now covered by a test.

**The gazetteer answered for names it does not hold.** `FIXTURE_PLACES` was a
plain object indexed by a normalised place name, and that name comes from a
candidate a model wrote. `{}["constructor"]` is a function rather than
`undefined`, so a place called "Constructor" came back _located_, carrying the
`Object` constructor where a caller expects a coordinate — and worse, `estimate`
read the same prototype hit as a table entry and reported a confident
zero-distance leg for it. That is exactly the fabrication the file's own doc
comment says it must never commit, arriving through the one door nobody was
watching. It is a `Map` now, like `FIXTURE_DRIVING` beside it, so a miss can only
mean "not in the table". Worth carrying into pl-28: **any table keyed by a string
a model produced wants a `Map`, not an object.**

**`locate` handed out the table's own object.** `Object.freeze` is shallow, so a
caller rounding or converting coordinates in place would have rewritten the
gazetteer for the rest of the process — and every later lookup in that worker.
It returns a copy now, which is what `estimate` was already doing; the two were
inconsistent rather than deliberate.

**The run view called a lookup a specialist.** The line under the bar was
hard-coded to "N of M specialists done", so the whole grounding phase would have
rendered "2 of 6 specialists done" directly beneath a header reading "Checking
the details" — and with a null total, "Working out which specialists this trip
needs…" while it was doing nothing of the sort. The reducer comment added in the
first round claimed the count "stays true" across the new case; it did not. The
noun now switches on the status, in `progressLine`.

**A `NaN` ceiling disabled the budget.** `Math.trunc(NaN)` is `NaN` and
`spent >= NaN` is false, so the naive clamp granted unlimited calls from the one
construct whose whole job is to refuse them. Latent — `int()` in the config
always yields a finite number — but it is a hole in a spend guard, so it is
closed rather than argued about.

Also fixed: `run.ts` and `routes/events.ts` both justified the `snapshot` frame
with "every `RunProgress` variant but `roster` names a specialist", which the new
`grounding` variant made false. No code misbehaved; the sentence was simply no
longer true, and a stale justification is how the next change gets made against a
rule that no longer holds.

**566 in the planner suite, 1139 repo-wide, `npm run check` green.** The four
fixes cost four tests. Nothing in the seam's shape changed, so pl-25, pl-26,
pl-27 and pl-28 are unaffected.

**2026-08-22 — gate round.** `review-ticket` on the finished branch, which is a
different thing from the code review that preceded it: it traced each of the five
"Done when" lines to the test that proves it, checked the Build steps against
what was actually built, and re-ran the suite at `origin/main` to confirm the
Log's own numbers. All five trace. Both disclosed deviations — step 5's fixture
location and step 8's fully-built budget — match the code. The baseline was 532
across 40 files, so 562 and then 566 are right, and the three pre-existing test
files took insertions only.

It also found a defect the defect-hunt had missed, and it is the third instance
of one root cause in this branch. **`Run` carries the fan-out's counters and no
others.** `RunView` fed them to `progressLine` unconditionally, so a client that
arrived while the run was grounding rendered "5 of 5 details checked" with zero
lookups done. The review named the `snapshot` reducer; the mount-time `useState`
initialiser had it too, and that is the likelier path — a reload rather than a
reconnect. Both now go through one `countsFrom(run)`, which answers
`{ total: null, done: 0 }` during grounding: there is no grounding count to show,
and §7's answer to a total nobody knows is an indeterminate bar.

The two doc comments I narrowed in the review round were still wrong. They said
`grounding`, like `roster`, "describes a moment that has already passed" and that
"the `Run` already carries the count" — asserting an invariant this diff never
established. They now say the `Run` carries the fan-out's count _and no other_,
and hand the question of a grounding count to pl-27.

**The real finding is that `RunView` had no test file at all.** It absorbed two
_never fake progress_ defects in one branch without a red build, and both were
found by reading rather than by running. `web/test/run-view.test.tsx` is 8 tests
covering both, plus the indeterminate-bar cases at each end. **Any component that
renders a count wants a test before it renders a second kind of count** — that is
the transferable half, and it is why the gate is a separate pass from the defect
hunt: a defect hunt finds what is wrong in the diff, a gate asks what the diff
left unproven.

**574 in the planner suite, 1147 repo-wide, `npm run check` green.**
