---
id: pl-27
tool: planner
title: Measure the legs, pack under them, and stop naming travel time as unchecked
kind: work-package
milestone: P3
status: done
depends_on: [pl-24, pl-25]
---

# pl-27 — The gap Phase 2 promised to name, closed

**Packages:** `api` (the pass, the run wiring), `itinerary` (the packer takes a
travel table), `contract` (where a measured leg lives on the document).

## Why

This is the ticket §5's ranking exists to point at. **Distances and travel times
first** — it fixes §2's failure 1, the most common way an AI itinerary is wrong,
and it is the single largest thing grounding buys this tool.

It is also the answer to the question the roadmap has carried in _Still open_
since 2026-08-16: _whether Phase 2's composer can pack under travel time at
all._ The answer then was **no — pack without it and name the gap**, because
`Place.coordinates` was null and there was nothing to measure a leg with. Both
halves of that have now moved: [pl-15](./pl-15-candidate-legs.md) gave a
candidate two ends, and [pl-24](./pl-24-grounding-seam-and-fixtures.md) gives us
something that can measure between them. The gap was always meant to close here.

Read [`itinerary/src/unchecked.ts`](../../itinerary/src/unchecked.ts) before
starting. Its first entry is unconditional — _"How long it takes to get from one
of these to the next was not checked. Nothing here measured a distance."_ —
and making that sentence conditional is the visible half of this ticket.

## Build

1. **First, the contract decision: a measured leg is stored, not derived.**
   Settle it before writing anything, because `web` and `api` both read it.

   The recommendation is to **store** it — on the item or the revision, as a
   grounded fact with its `Provenance` — and it deliberately goes the other way
   from [pl-10](./pl-10-plan-view-and-provenance.md), which refused to store
   `UncheckedConstraint[]` and derived it from the revision instead. The two are
   different in the way that matters: `unchecked` is a _derivation_ from things
   the revision already holds, so deriving it cannot disagree with the days it
   is printed beside. A measured distance is _evidence_ — it came from outside,
   at a moment, from a source — and there is nothing on the revision to re-derive
   it from. Its cache row will expire; the plan must still be able to say what it
   was packed against and when that was read. A plan that silently re-measures on
   read is a plan whose days no longer follow from its numbers.

2. **The pass lives in `api`, between the fan-out and the composer.**
   `@planner/itinerary` has `no model, no network, no clock`, enforced by
   `itinerary/test/purity.test.ts` and not by good intentions, so the package
   that packs days must not be the package that fetches distances. The travel
   table arrives as an **argument** to `compose`, exactly as `TripCapacity`
   arrives as a required argument to `runFanOut` — and for the same reason: a
   caller that forgets it should be a compile error rather than a plan quietly
   packed under nothing.

3. **What the pass does**, in `api/src/runs/`:
   - Collect the distinct `Place`s across the run's candidates — both ends of
     every `between`, the one place of every `at`.
   - `locate` them, filling `Place.coordinates`, which has been nullable since
     pl-4 waiting for precisely this.
   - **One `travel` matrix over the located places** — one call, not n². This is
     why pl-24's seam is matrix-shaped; read its step 3.
   - Move the run through `grounding` and emit `{ done, total }` frames. Skip
     the state entirely when there is nothing to measure, per pl-24 step 1.

   **The counts change meaning when the status does** — specialists during the
   fan-out, lookups from `grounding` onward — and pl-24's review caught the UI
   still saying "N of M specialists done" underneath them. `progressLine` in
   `RunView.tsx` now switches its noun on the status, so the frames this pass
   emits are already rendered correctly; the trap is only worth knowing if you
   add a third thing that counts.

   Deduplicate the place list with the provider's own normalisation rather than
   a second one — `fixturePlaceKey` is exported for exactly this. Two spellings
   of one place sent as two rows is a wider matrix than the run needs to pay
   for, and a normaliser reimplemented at the call site is one that will drift.

   > **This paragraph is wrong, and following it produced this ticket's worst
   > defect.** It is kept because a brief is a record of what was believed, and
   > because the reasoning in its second half is right — one normaliser, not a
   > reimplementation — while the function it names is the wrong one. See _What
   > the brief had wrong_, point 8. Use `placeIdentity` from
   > `api/src/grounding/place-key.ts`; `fixturePlaceKey` no longer exists.

4. **A place that will not locate is not a failure.** It has no coordinates, its
   legs have no measurement, and it is still a perfectly good candidate — the
   plan says travel time was unchecked _for those items_, and packs the rest
   under measured numbers. This is the `PlanGap` philosophy one level down: a
   partial answer that admits its edges beats both a thrown run and a filled-in
   guess. The fan-out's rule that one specialist failing does not fail the run is
   the precedent, and the same rule should govern the backend being down
   entirely: the plan is the Phase 2 plan, with the gap named, not an error page.

5. **The packer packs under it.** `itinerary/src/pack.ts` currently charges the
   day's drive budget for `route-and-logistics` candidates' own
   `durationMinutes`. It now also has to charge the transition between
   consecutive items. Watch the interaction with `CANDIDATE_LIMIT_OF` and
   `dayCapacity` — this is the arithmetic pl-9 got wrong once already, in the
   other direction, and `agent/test/limits-agree.test.ts` exists because those
   two tables drift.

6. **Three unchecked entries were caused by one missing distance, and all three
   have to be reconsidered — not just the famous one.** `travel-time`,
   `daily-distance` (a backcountry party's `maxDailyDistanceKm`) and
   `machine-range` (a machine's `rangeKm`) each say "same cause: ends without a
   distance between them" in that file. Leaving two of them unconditional while
   the first becomes conditional would leave text that is no longer true beside
   text that is, which is worse than either. Recommendation: do all three; the
   distance is in hand and each is one comparison.

   Each becomes conditional on **what was actually measured**, per candidate,
   not on whether a grounding provider was configured. A run against a backend
   that answered for four places out of nine says so about the five.

7. **Provenance on every item** (§5). A leg measured by a backend is `grounded`
   with the source that measured it; everything else stays `model-asserted`, and
   the plan view already renders the difference as of pl-10.

8. **Two documents state the old behaviour as a rule and both have to move.**
   `tools/planner/CLAUDE.md` says the unchecked list carries _"travel time
   always, because `Place.coordinates` is null until grounding"_, and
   `02-ROADMAP.md` carries the 2026-08-16 decision in _Still open_. Neither is
   describing a limitation any more once this lands. Amend rather than delete,
   the way §3 and §7's amendments are handled in this tool: the reasoning was
   right for Phase 2 and the record of why is worth keeping.

## Done when

- Composing a checked-in candidate set with a grounding provider that answers
  produces a plan whose days respect measured transition times, and one with a
  provider that answers `null` for everything produces **exactly today's plan** —
  byte-identical days. That second assertion is what proves the change is
  additive.

  **Amended 2026-08-23, at the second gate: the first half of that cannot be
  shown on a checked-in set, and is proven elsewhere.** Two facts, both now
  asserted rather than assumed. The six checked-in sets are two to four
  candidates over four to thirteen days, and the packer fills days evenly, so
  **no checked-in set ever puts two chargeable items on one day** — what shares
  a day is an activity and its anchor, and an anchor's arrival is recorded and
  never charged. And the fixture backend can answer only two kinds of transition
  on these sets: a place measured from itself, which is `0`, and nothing. So a
  run against the default backend is byte-identical to the ungrounded one _by
  arithmetic_, and an assertion over it would pass even if the packer
  double-charged. That a non-zero transition changes a day is proven in
  `itinerary/test/pack.test.ts` on one-constraint-at-a-time candidates; the
  premise that makes the end-to-end case arithmetic is guarded in
  `itinerary/test/compose.test.ts` and in the api suite, so the day a fixture
  grows, both go red instead of quietly passing for a new reason.

- `uncheckedFor` omits `travel-time` when every placed item's transitions were
  measured, includes it naming the specific candidates when only some were, and
  still includes it unconditionally when nothing was. Three tests.
- The same three cases for `daily-distance` and `machine-range`, or a written
  decision in the Log for why one of them stayed unconditional.
- A stored plan re-read after its cache row expires shows the same distances and
  the same `fetchedAt` — the storage decision from step 1, proven rather than
  asserted.
- A run whose grounding backend throws still writes a revision, and that plan
  names travel time as unchecked.
- `itinerary/test/purity.test.ts` still passes, which is the check that no
  network reached the packer.
- `npm run check` and `npm test -- --project planner` pass. Several existing
  `unchecked` tests change meaning here — that is expected, and each change
  belongs in the Log.

## Review

**This section is committed, and that is new.** Gates were being written in
throwaway worktrees and discarded with them, so a ticket that had been reviewed
twice looked, in the repo, exactly like one nobody had read. The builder writes
it down now — a review nobody can find did not happen.

**A verdict is recorded as it was given.** It is never softened in place, and
"since addressed" is not a verdict — an earlier draft of this section wrote
`FAIL, since addressed` above nine rows all reading "Fixed", which is a thing a
skimmer reads as a pass. What was fixed belongs in the disposition column, one
finding at a time, where a reader can check it.

### Gate 1 — FAIL

2026-08-23 · `review-ticket` over `origin/pl-25-grounding-cache...HEAD`,
delegating the defect hunt to `code-review`.

What it verified clean, so that a later reader does not re-derive it: the
packer arithmetic is correct (`lastCandidateId` was traced through pins,
`PLACEMENT_ORDER` and the stable sort, confirming that append order **is** final
order within a day, which is what makes charging a transition as you go exact
rather than an estimate); migration 6 is forward-only and its recreated trigger
is equivalent to the one it replaces plus the new column; the
recorded-but-not-charged anchor is coherent; both disclosed deviations from the
brief — the fixture location argument and `daily-distance`/`machine-range`
staying unconditional — were done as described; and the within-day conditional
logic is right.

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Disposition                                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **high** | **The place key collided, and the damage persisted.** The pass deduplicated its place list with the fixture provider's `fixturePlaceKey` — accent-stripped, lower-cased, **name only**. Two different places sharing a name became one `RunPlace`; `withCoordinates` wrote the survivor's point onto **both** candidates, persisted and non-null thereafter so no later run would re-locate them; and both ends indexed the same matrix cell. The plan then reported a `measured`, `grounded` transition **to the wrong place**. "Saint-Jean" QC beside "Saint-Jean" NB is enough to trigger it. | Fixed. `api/src/grounding/place-key.ts` now owns `placeIdentity` — name **and** locality — and the cache's `locateKey`/`travelKey` are built on it, so the seam has one normaliser and the pass asks it. `api/test/place-key.test.ts` and `api/test/travel-measure.test.ts` cover it. See _the second gate_ in the Log. |
| **med**  | **Stale base.** The branch sat on `671f73a` while pl-25 had landed the per-lookup `GroundingOutcome` that makes the pass's `null`-interpretation unnecessary.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Fixed. Rebased; `whyUnanswered` and `matrixRefused` deleted.                                                                                                                                                                                                                                                            |
| **med**  | **The omission over-claimed on cross-day hops.** Dropping `travel-time` once every within-day pair was measured said, by silence, that the getting-about had been checked — while the overnight hop is _never_ measured.                                                                                                                                                                                                                                                                                                                                                                         | Fixed. An unconditional entry names the first item of each day that follows another. Not measured and not charged: that half of the original argument stands.                                                                                                                                                           |
| **med**  | **The additivity test compared a thing to itself.** It built two `SilentGrounding` harnesses and compared one to the other, so the acceptance line the ticket calls "what proves the change is additive" was never asserted; `draft`'s `grounding === undefined` branch was dead.                                                                                                                                                                                                                                                                                                                | Fixed. It compares a silent backend against `draft(undefined)` — the real boot path — on day index, position **and** candidate.                                                                                                                                                                                         |
| **med**  | **The cache-expiry acceptance was not exercised.** The plan was re-read twice without advancing the clock past the travel TTL, so "after its cache row expires" proved nothing.                                                                                                                                                                                                                                                                                                                                                                                                                  | Fixed. A movable clock, advanced past the 4,320-hour lifetime, the cache table emptied, and a fresh lookup asserted to stamp a _different_ `fetchedAt` so the case cannot pass vacuously.                                                                                                                               |
| **low**  | `total` was off by one when nothing located: the matrix step was counted but never resolved, leaving the bar short of its own total for a run with nothing left to do.                                                                                                                                                                                                                                                                                                                                                                                                                           | Fixed. The counter counts steps finished; `done` reaches `total` on every path.                                                                                                                                                                                                                                         |
| **low**  | A contradictory comment on `PackedItem.travelFromPrevious` said `null` covered "wherever the grounding pass had no answer", which `ItemTravel` had already stopped being true.                                                                                                                                                                                                                                                                                                                                                                                                                   | Fixed.                                                                                                                                                                                                                                                                                                                  |
| **low**  | Edits to `tools/planner/docs/03-STATUS.md`. No ticket touches that prose — the same rule already applied to dl-15 and dl-17 — and `repo-1-retire-the-narrative` is retiring it.                                                                                                                                                                                                                                                                                                                                                                                                                  | Reverted to base exactly.                                                                                                                                                                                                                                                                                               |
| **low**  | The Log's suite numbers were wrong: "574 → 630" compared against `main` while the branch was based on pl-25.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Fixed, with the method recorded: check out the actual base, `npm run build` there first (a stale `dist` makes ~46 tests fail confusingly), then run.                                                                                                                                                                    |

**The most valuable thing this gate produced is about code that no longer
exists.** Before pl-25's per-lookup outcome, the seam answered `T | null` for
both "nobody knows" and "the budget refused", and this pass inferred the
difference in a helper called `whyUnanswered` by reading `RunGrounding.refused`
around each call and attributing the delta to the call that caused it. The gate's
verdict: **sound today, but only by coincidence** — a sequential locate loop, one
writer, one budget, no retry above it, and not one of those four asserted
anywhere. Parallelise that loop with one call of budget left and two lookups in
flight and an answered lookup ships to the plan as `over-budget`, which is the
precise fabrication `ItemTravel` exists to prevent. The helper is deleted and the
fact is a value now; this paragraph is here because the reasoning is what stops
it being rebuilt the next time the seam looks like it only has two answers.

- NFR: **security** — the pass fetches nothing itself, so no SSRF surface is
  added; the colliding key above was the one integrity defect and it is closed
  by construction rather than by care. **Performance** — one matrix per run
  whatever the place count, the budget claimed before the work; the Log records
  that a sparse backend re-requests most of the matrix each run, because pl-25
  does not cache a negative answer and an unstored cell keeps its whole row and
  column in the wanted sets. **Reliability** — a backend that is down, one that
  knows nothing, and one whose budget is spent each produce a plan rather than
  an error page, and each says something different on the unchecked list; a
  cancellation is the one thing that still propagates. **Maintainability** —
  the three-state `ItemTravel` puts the distinction in the compiler's hands at
  every call site rather than in a comment, which is what let the `null`
  inference be deleted in one place rather than hunted for.

### Gate 2 — CONCERNS

2026-08-23, over the round that answered gate 1.

**The high was verified closed rather than taken on trust**, and how is worth
recording because it is the standard: the reviewer diffed the `placeIdentity`
move against `76152c4` and confirmed it byte-identical to the code it replaced,
checked that all three call sites in the pass use it, **mutated it back to
name-only and confirmed 4 tests go red across 3 files** — including the
pass-level guard, not just the unit one — and then ran its own 11-case collision
battery: NUL forging, separator forging, boundary shifting, NFC/NFD, Turkish
casing. The separator is unforgeable and Saint-Jean is genuinely fixed. It also
confirmed `whyUnanswered` and `matrixRefused` are at zero occurrences repo-wide,
that no reachable state lets a plan claim travel was checked when it was not,
and that all nine gate-1 findings were fixed rather than papered over.

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **med**  | **The plan view breaks, and it ships broken.** `web/src/plan/PlanView.tsx:412` keyed the unchecked list by `constraint.kind`, which was unique per list until this ticket made `travel-time` repeat. The reviewer ran the real boot path: **both `multi-city` and `road-trip` come back with two `travel-time` entries**, so it is every plan a default deployment produces, not an edge case. React warns each render, and on re-render — a revision switch, a pin — reconciliation can carry one entry's text under the other's position or drop one. `plan-view.test.tsx` only ever passed single-entry lists. | Fixed in `web`, despite `web` not being in this ticket's package list. The distinction that decides it: the _absence_ of a renderer for `travelFromPrevious` is a gap this ticket inherits and may leave, and a regression this ticket _causes_ is not — a broken file does not get to stay broken because it sits outside a package list. `keyFor` keys on the entry's whole content; `plan-view.test.tsx` renders two entries of one kind and fails on React's duplicate-key warning, verified by reinstating the old key and watching it go red.                                                                                                                                             |
| **med**  | **The collision class is narrowed, not closed.** Two places sharing a normalised name _and_ locality still merge — including both `null`, which the contract permits and a model routinely emits. Worse, `runPlaces` discarded the one piece of evidence that settles it: given two entries with **different non-null coordinates** it kept the first and dropped the second.                                                                                                                                                                                                                                     | Split. The provable half is fixed: `runPlaceKey` appends the coordinates when a place has them, so two places the inputs prove distinct are two rows, two cells and two sets of written-back coordinates. The unprovable half is decided and written down in `place-key.ts` and `runPlaceKey` — unmerging two identical unlocated places would ask a backend the identical question twice and get the identical answer, so it buys nothing; the ambiguity is in the question and needs an identifier a `Candidate` does not carry, or a seam that can answer "more than one place matches". Named for pl-28. The overclaiming sentence in `place-key.ts` now says locality _narrows_ the class. |
| **med**  | **The trap was still baited for pl-28.** `fixturePlaceKey` had no production caller left, but its doc still recommended, to the next author assembling a matrix, the exact practice that produced the high.                                                                                                                                                                                                                                                                                                                                                                                                       | Deleted, not annotated. In its place is a comment saying why there is deliberately no such export and pointing at `placeIdentity`. The guard test now asserts against `placeKey` itself — the function `locate` and `estimate` actually call — which makes it stronger than asserting against a wrapper.                                                                                                                                                                                                                                                                                                                                                                                        |
| **med**  | **The additivity test could not fail for the reason it names.** Against the default backend every measured transition on a checked-in set is `0 minutes / 0 metres` into an anchor, so the silent and answering plans agree **by arithmetic**; the packer could double-charge or invert the transition and the assertion would still pass.                                                                                                                                                                                                                                                                        | Fixed by making the test assert its own premise, and by amending the Done-when rather than pretending. Two structural facts, both now guarded: the six checked-in sets are 2–4 candidates over 4–13 days, so the packer never puts two _chargeable_ items on one day (`compose.test.ts`); and the fixture backend can only ever answer zero or nothing for the pairs that do arise (`travel-pass.test.ts`). A non-zero transition changing a day is proven in `pack.test.ts`. Both guards go red the day a fixture grows, instead of the end-to-end case quietly passing for a new reason.                                                                                                      |
| **low**  | The anti-vacuity guard was itself vacuous: `expect(fresh?.source.fetchedAt).not.toBe(...)` passes when `fresh` is `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Fixed — `expect(fresh).not.toBeNull()` first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **low**  | Three prose sites stated a rule the code stopped following when the overnight entry landed — `travel-time` absent once every transition was measured. It is now always present on a multi-day plan, and the roadmap paragraph contradicted its own next sentence.                                                                                                                                                                                                                                                                                                                                                 | Fixed in `CLAUDE.md`, `contract/src/unchecked.ts` and `02-ROADMAP.md`. The rulebook entry also now states the two consequences a future agent needs: the kind is not a unique key, and on a multi-day plan the entry never disappears.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **low**  | `unchecked.test.ts`'s "does not ask for a measurement of the trip to the day's bed" asserted nothing of the kind — an anchor _is_ a transition, and the case passed only because `NOTHING_MEASURED` takes the plan-wide branch regardless.                                                                                                                                                                                                                                                                                                                                                                        | Renamed to what it should have been asserting, and made to assert it: the bed's arrival is recorded when measured, and measuring it takes `travel-time` off a one-day plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **low**  | `measuredOrNull`'s doc called it "the one place the union is read"; the union is read in three `src` files and this helper is called from none of them.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Fixed — it now says what it is for (a reader that wants the numbers and treats both empties alike) and that anything which must _say_ which empty it is reads `kind`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **low**  | The gate record softened its own verdict: `FAIL, since addressed` over nine rows reading "Fixed".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Fixed. The verdict is recorded as given, per gate, and the addressing lives in the dispositions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Acceptance lines, as the reviewer traced them:**

| Done when                                                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A checked-in set with a provider that answers produces days respecting measured transitions; one answering nothing produces byte-identical days       | Second half: `api/test/travel-pass.test.ts` "a backend that knows nothing leaves the plan it would have had", comparing day/position/candidate against the real boot path ✓. First half: **amended** — no checked-in set can show it, for two structural reasons now guarded in `itinerary/test/compose.test.ts` and `travel-pass.test.ts`; the behaviour itself is proven in `itinerary/test/pack.test.ts` "charges the transition to the day, so a day that fitted three now fits two" ✓ |
| `uncheckedFor` omits `travel-time` when every transition was measured, names candidates when some were, is unconditional when none were — three tests | `itinerary/test/unchecked.test.ts` "omits it when every transition on the plan was measured", "names the candidates it could not measure the trip to, when only some answered", "still says it plan-wide when nothing was measured" ✓ — plus two the ticket did not ask for: the overnight entry, and the budget refusal                                                                                                                                                                   |
| The same three cases for `daily-distance` and `machine-range`, **or** a written decision for why one stayed unconditional                             | Written decision taken, in the Log and in `contract/src/unchecked.ts`: `TravelMode` has one member and a road measurement does not say how far a party walks. `unchecked.test.ts` "keeps naming daily distance, because a driving matrix is not a walking one" ✓                                                                                                                                                                                                                           |
| A stored plan re-read after its cache row expires shows the same distances and the same `fetchedAt`                                                   | `api/test/travel-pass.test.ts` "shows the same distances and the same fetchedAt after the cache row expires" — movable clock advanced past the 4,320-hour lifetime, cache table emptied, and a fresh lookup asserted to stamp a _different_ time so the case cannot pass vacuously ✓                                                                                                                                                                                                       |
| A run whose grounding backend throws still writes a revision, and that plan names travel time as unchecked                                            | `api/test/travel-pass.test.ts` "a backend that throws still writes a revision, and the plan says so" ✓                                                                                                                                                                                                                                                                                                                                                                                     |
| `itinerary/test/purity.test.ts` still passes                                                                                                          | ✓ — the pass lives in `api`; nothing in `@planner/itinerary` gained a network, a model or a clock                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check` and `npm test -- --project planner` pass                                                                                              | ✓ — see the Log for the baseline and the method                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Gate 3 — PASS

2026-08-23, over the round that answered gate 2. Nothing high, nothing med, and
no acceptance line left unproven.

**It was verified by mutation rather than by reading**, which is the standard
worth copying. Reinstating `key={constraint.kind}` reddens exactly one test, on
React's real warning. Reverting `runPlaceKey` to identity-only reddens the
coordinate-split case. Recomputing the ends instead of pinning them reddens
three `travel-pass` cases, with every measured transition disappearing. And
raising the fixture self-pair to 45 minutes reddened **only the premise** while
leaving the days unchanged — which is the proof that the amended Done-when is
honest and that the original could never have failed. The reviewer also
re-derived `runPlaceKey`'s injectivity independently and found the
unprovable-collision argument sound on its merits.

**One thing the gate found that both earlier rounds missed:** composing all six
checked-in sets, the old `kind` key collided on **three** shapes — `road-trip`,
`city-and-culture` and `multi-city`. Gate 2 named two. `city-and-culture` was a
third nobody had looked for, and the fix was already distinct on all six. That
is the argument for asserting a property over real input rather than over the
lists a test author thinks of, and it is why the distinctness guard added below
runs across every fixture: writing it, the mutation reddened exactly those three
shapes by name.

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                   | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **low**  | **The duplicate-key test guarded on React's prose.** It filtered warnings with `arg.includes("same key")`; React 19.2.8's message happens to contain it, and a rewording would empty the filter and leave the test passing while checking nothing. The three positive assertions do not cover for it, because duplicate keys still render both children on a first mount. | Closed by asserting the property instead of the symptom. The key moved to the contract as `uncheckedConstraintKey`, and `itinerary/test/unchecked.test.ts` asserts distinctness over the entries `uncheckedFor` actually emits, for all six checked-in sets and for a plan carrying all three `travel-time` sentences at once. The warning spy is kept as belt to that braces. Verified by mutating the key to `constraint.kind`: 5 tests across 2 files go red, naming `road-trip`, `city-and-culture` and `multi-city`. |
| **low**  | **The `,` separator could be forged.** `candidateIds.join(",")` makes `["a,b"]` and `["a","b"]` one key. Unreachable today, but `Candidate.id` is only `z.string().min(1)`, and the rest of the tool uses NUL precisely because a separator must be unforgeable.                                                                                                          | Fixed — NUL throughout `uncheckedConstraintKey`, with the argument stated where the function is, pointing at the longer version in `place-key.ts`.                                                                                                                                                                                                                                                                                                                                                                        |
| **low**  | **Three live pointers at a deleted function.** The gate-2 Log described a guard that no longer existed in that form; **Build step 3 still instructed the reader to use `fixturePlaceKey`**, which is the advice that produced the high; and pl-24's handover note still advertised the export. Whoever picks up pl-28 reads one of the last two.                          | All three fixed. Build step 3 carries a note saying it is wrong and why, and the point is now recorded in _What the brief had wrong_ as point 8 — which is where the next agent looks, rather than only in a gate table. pl-24's Log is amended in place with the full argument and a pointer to `placeIdentity`.                                                                                                                                                                                                         |
| **low**  | **The prose overstated by a shade.** Three sites said the entry never disappears "on a multi-day plan"; the precise claim is a plan with placed items on **two or more days**. A multi-day trip whose season filter puts every placed item on one day, all measured, emits no entry.                                                                                      | Reworded in `CLAUDE.md`, `contract/src/unchecked.ts` and `02-ROADMAP.md`, each also naming the one-day case explicitly so the exception is not left for a reader to discover.                                                                                                                                                                                                                                                                                                                                             |

**Not carried, on the reviewer's own instruction:** gate 2's record says the old
key produced duplicates on "both `multi-city` and `road-trip`" where there were
three. It is left as reported. A gate records what was found at the time, and
retrofitting it would make the record less useful, not more — the fact that the
third shape went unnoticed for a round is itself the finding.

## Log

**2026-08-23 — built, on top of pl-25's branch rather than on `main`.**

The branch was cut from `origin/main` and rebased onto
`origin/pl-25-grounding-cache` partway through, deliberately: pl-25 built the
cache and wired nothing to it ("no grounding pass calls any of this yet —
pl-27"), so two branches that never met would have shipped a dead table. That is
why this diff carries migration **6** and pl-25's is 5, and why the run's
provider is `groundingForRun(context.grounding, groundingBudget(…))` rather than
the bare seam. **If you are reading this on a `main` that never took pl-25, the
base is the first thing to check.**

Rebased twice more as pl-25 answered its own review: onto `671f73a`, which
lands the per-lookup `GroundingOutcome`, and onto `76152c4`, which narrows
`AppContext["grounding"]` to `{ name, forRun }` so the un-budgeted seam is
unreachable from a run. The second of those is why this branch's only use of the
context is `groundingForRun(context.grounding, …)`; the first is why the pass
has no opinion about a `null` any more. Both are described under _the second
gate_ below. **Rebasing onto a sibling branch three times is the cost of running
two tickets over one seam at once, and it was still cheaper than shipping a
cache nothing called.**

### What was built

- **`contract/src/travel.ts`** — `MeasuredTravel` (distance, duration,
  `Provenance`) and `ItemTravel`, the three-state fact a plan carries about one
  transition. `PlanItem.travelFromPrevious` is `ItemTravel | null`, stored in
  `plan_items.travel_json` by migration 6, which also recreates
  `plan_items_only_pinned_is_mutable` so the new column is on the frozen side of
  "only pinned may change".
- **`itinerary/src/travel.ts`** — `TravelTable`, one method, `between(from, to)`,
  answering an `ItemTravel` and never a bare `null`. `NOTHING_MEASURED` is the
  named way to say a run grounded nothing. It is a **required** argument to
  `compose` and `pack`, per step 2, so 25 call sites in tests had to name it —
  which is the point.
- **`itinerary/src/pack.ts`** — a day charges each item's own
  `durationMinutes` **plus** the measured transition from the item before it on
  that day. `DayState.lastCandidateId` makes the incremental charge exact rather
  than approximate; see the note there.
- **`itinerary/src/unchecked.ts`** — `uncheckedFor` now takes the plan's `days`
  instead of a `placedIds` set, and `compose` hands it the very `PlanDay[]` it is
  about to store. The two paths agreed before by two implementations being
  careful; they now agree by construction.
- **`api/src/runs/travel.ts`** — the pass. Distinct places across the run's
  candidates (deduplicated by `placeIdentity` — the first draft used the fixture
  provider's key and that is this ticket's high), one `locate` each for those
  with no coordinates yet, one `travel` matrix over the located ones, coordinates
  written back onto the candidates before they are stored, `{ done, total }`
  frames, and the run moved through `grounding` only when there is something to
  measure.

### What the brief had wrong, or did not know

**1. Making `travel-time` conditional on within-day pairs alone would have made
the mechanism dead in practice.** The brief says to measure "the transition
between consecutive items". I first excluded the day's **anchor**, reasoning
from pl-9 that where you sleep consumes no part of the day. Composing all six
checked-in candidate sets against the fixture provider then produced **not one
measured transition on any shape**: every day of every fixture plan is one
non-anchor item plus its lodging. The rule now measures and records the trip to
the bed and still does not _charge_ the day for it — `fits` cannot refuse an
anchor on budget, so charging it could only ever produce an over-full day the
critic rejects, which turns "the hotel is a long way off" into a plan the user
does not get. The asymmetry is deliberate and `transitionTo` argues it.

Worth stating plainly for whoever reads this next: **a design here is not
finished until it has been run against the six sets.** Both halves of that
mistake were invisible to the unit tests, which construct their own days.

**2. The overnight hop between days is not measured, and that is a real gap.**
A transition is a _within-day_ pair. Cross-day would have been the more complete
answer and it does not work: the packer fills days least-loaded-first, bucket by
bucket, so the item preceding day 2's first item in final document order changes
retroactively as later buckets land on day 1. Within a day the packing order and
the final order coincide exactly — pinned, then drive, then activity, then
anchor, and `sortByBucket` is stable — which is what makes the incremental charge
exact. A cross-day charge would be an approximation the stored value then
contradicts.

**Amended at the second gate:** not charging it was right, not _mentioning_
it was not. A list whose only job is naming what went unchecked cannot go quiet
about the longest moves on the trip, so the hop now gets an entry of its own,
unconditionally.

**3. Step 6's recommendation is not taken, and the Done-when's alternative is —
`daily-distance` and `machine-range` stay unconditional.** The brief says "the
distance is in hand and each is one comparison". The distance in hand is a
**driving** one: `TravelMode` has one member and the pass asks for `driving`. A
backcountry party's `maxDailyDistanceKm` is a distance on foot and a machine's
`rangeKm` is a distance along a trail network, and neither is answered by asking
a routing engine how you would drive it. pl-24 makes the point on purpose — it
holds both ends of the Mont-Albert plateau traverse and no leg between them,
because there is no road. Dropping those two entries because a road distance came
back would be claiming to have checked a hiking day against the wrong
measurement. **What did change is their copy**: both said "— see travel time",
which now points at an entry that is often absent, so each states its own cause.
They become checkable when `TravelMode` gains the members pl-24 shaped it for.

**4. Step 7 read as putting `grounded` provenance on the candidate; it is on the
measurement.** Knowing where a place is is not evidence that the thing proposed
there exists — that is §5's item 3, a different question — so
`Candidate.provenance` stays `model-asserted` and `MeasuredTravel.provenance` is
the `grounded` one. `Place.coordinates` is filled where a lookup answered, and an
existing coordinate is never overwritten: four of the six route candidates came
with coordinates from pl-15, and re-writing them would turn checked-in data into
whatever a deployment's backend happened to say.

**5. pl-24 said a lookup skipped for budget should be a `PlanGap`. It cannot
be.** `PlanGap` names a `Specialist` and every `PlanGapReason` is about the
fan-out; route-and-logistics ran perfectly. The honest carrier is the unchecked
list, which is exactly the argument `unchecked.ts` already makes for not being a
`PlanGap`. So a refusal is `ItemTravel`'s `over-budget`, it is stored on the
item, and it produces its own `travel-time` entry with its own sentence.

**6. The seam could not yet tell a refusal from "nobody knows".** It can now:
pl-25's `671f73a` returns a per-cell `GroundingOutcome`, and the workaround this
paragraph used to describe is deleted. Kept because the reasoning is the record
of why nobody should rebuild it — see _the second gate_ below.

**8. Build step 3 names the wrong function, and following it caused the
high.** "Deduplicate the place list with the provider's own normalisation —
`fixturePlaceKey` is exported for exactly this." Its second half is right and is
the rule this ticket ended up enforcing: one normaliser, never a
reimplementation. Its first half points at the fixture provider's _table
lookup_, which drops `locality`, and using it as an identity merged two places
that share a name — so the plan reported a `measured`, `grounded` transition to
the wrong province. The identity a caller wants is `placeIdentity` in
`api/src/grounding/place-key.ts`, which the seam owns and the cache keys by;
`fixturePlaceKey` is deleted. The brief paragraph carries a note saying so, and
pl-24's handover note has been amended, because those are the two places
somebody starting pl-28 would read.

**7. `Run` gains no grounding count.** pl-24's log named this ticket for one.
Its Build section does not ask for it, `RunView` already shows an indeterminate
bar during grounding, and a column would be a second thing to keep true. The
frames carry the count; a client that attaches mid-grounding sees a bar it can
believe.

### The second gate, and what it deleted

**The place key collided, and the damage persisted.** The pass deduplicated its
place list with the fixture provider's `fixturePlaceKey`, which is
accent-stripped, lower-cased and **name only**. Two different places that share
a name therefore became one `RunPlace`: `withCoordinates` wrote the survivor's
point onto both candidates — persisted, and non-null thereafter, so no later run
would re-locate them — and `tableFor` indexed both to the same matrix cell, so
the plan reported a `measured`, `grounded` transition to somewhere the traveller
was not going. "Saint-Jean" in Québec beside "Saint-Jean" in New Brunswick is
enough. That is the worst failure this tool has: a fabrication with a source on
it.

What makes it instructive rather than merely a bug is that **the correct key
already existed one file away**. pl-25's `locateKey` keeps `locality` and
deliberately does not strip accents, and its comment says normalising is "the
fixture provider's business" — a sentence about that provider's own table
lookup, which the pass read as a licence to use that lookup as an identity. The
fix is not local: `api/src/grounding/place-key.ts` now owns `placeIdentity`, the
cache's `locateKey`/`travelKey` are built on it, and the pass deduplicates by
it. One normaliser, owned by the seam, because pl-28 will key places too and a
third would be how this recurs. `api/test/place-key.test.ts` asserts the
collision case, and asserts that the fixture provider's own `placeKey` still
collapses it, so the distinction cannot quietly be undone. (`fixturePlaceKey`
was still in the tree at this point and the guard named it; the third gate had
it deleted — see below.)

**No migration for the rows the old key poisoned.** They only ever existed
against the fixture provider in a developer's database, and both the plan
candidates and the grounding cache are disposable at this stage.

**`whyUnanswered` is gone, and it should never come back.** Before `671f73a` the
seam answered `T | null` for both "nobody knows" and "the budget refused", so
the pass inferred the difference by reading `RunGrounding.refused` around each
call and attributing the delta. The review's verdict on it is the part worth
keeping: it was **sound only by coincidence** — a sequential locate loop, one
writer, one budget, no retry above it, and not one of those asserted anywhere.
Parallelise that loop with one call of budget left and two lookups in flight and
an answered lookup ships as `over-budget`. pl-25 now returns a per-cell
`GroundingOutcome`, so the fact is a value: `unanswered(outcome)` is one line and
the pass has no other opinion about an empty result. `matrixRefused` went with
it — refusal is per cell, and a matrix can be genuinely mixed.

**Everything goes through `forRun`.** `RunGroundingSource extends
GroundingProvider`, so `context.grounding.locate(…)` still compiles today and
would spend no budget at all. Nothing in this diff calls it; the only thing read
off the context is `name`, for `/api/health`.

**The omission was over-claiming.** Dropping `travel-time` once every within-day
pair was measured said, by silence, that the getting-about had been checked —
while the overnight hop from the end of one day to the start of the next is
_never_ measured. On a list whose entire job is naming what went unchecked,
silence is a claim. There is now an unconditional entry naming the first item of
each day that follows another. The argument for not _charging_ that hop stands
and is unchanged; it was never an argument for not mentioning it.

**Two acceptance lines were not actually being asserted**, which is the tell that
a test can pass and prove nothing:

- The additivity case built two `SilentGrounding` harnesses and compared one to
  the other. It now compares a silent backend against `draft(undefined)` — the
  real boot path, which builds the default provider and wraps it in the cache —
  and compares day index, position **and** candidate rather than a flat list of
  ids.
- The cache-expiry case re-read the plan twice without moving the clock. It now
  runs on a movable clock, advances past the travel lifetime, deletes every
  cache row, and re-reads: the distances and the `fetchedAt` are the ones the
  plan was packed under, with nothing behind them but the revision.

**`Source.fetchedAt` is no longer a constant.** pl-25 gave the fixture provider
the injected clock — through `createGroundingProvider(config, now)`, so the
provider that stamps a `Source` and the cache that ages it read the same time —
and a fixture answer is now stamped when it was handed over. The expiry test
therefore injects no provider at all: it takes the boot path, moves one clock,
and asserts against the harness's own `NOW` rather than against
`FIXTURE_FETCHED_AT`, which no longer exists. It also asserts that a _fresh_
lookup at the advanced clock stamps a different time, so the case cannot pass
against a provider whose timestamp never moves — which is exactly what pl-24
shipped and pl-25 had to defuse.

### The third gate, and the file this ticket had to open after all

**pl-27 broke the plan view, and the shape of that is the pl-24 pattern this
ticket's own brief warns about.** `PlanView.tsx` keyed the unchecked list by
`constraint.kind`, which was a unique key for as long as `uncheckedFor` emitted
one entry per kind — a property nothing wrote down and nothing tested, because
until now it was simply true. Making `travel-time` repeat broke it from a
package nobody opened, and the test that would have caught it lives in `web`,
where `plan-view.test.tsx` only ever passed single-entry lists. Every plan a
default deployment produces today has two `travel-time` entries, so this was not
a corner: it was shipping.

The rule that decided it, since `web` was not in this ticket's declared
packages: **the absence of a renderer for `travelFromPrevious` is a gap this
ticket inherits and may leave; a regression this ticket causes is not.** A
broken file does not get to stay broken because it sits outside a package list.
`keyFor` keys on the entry's whole content, and the new case fails on React's
duplicate-key warning — verified by reinstating the old key and watching it go
red, because a test for a warning is exactly the kind that can pass while
asserting nothing.

**The collision class was narrowed, not closed, and the two halves needed
different answers.** `runPlaceKey` now appends a place's coordinates when it has
them, so two places the inputs _prove_ distinct — same name, same locality,
different known points — are two rows rather than one. The old shape kept the
first and dropped the second, which threw away the only evidence a `Place`
carries beyond its prose.

The unprovable half is decided rather than left implicit: two places with the
same name, the same locality and **no** coordinates stay merged, because
unmerging them buys nothing. The run would ask `locate({ name: "Le Manoir",
locality: null })` twice and a backend would answer the identical question
identically, so both candidates carry the same point either way. The ambiguity
is in the question, not in the deduplication, and closing it needs something a
`Candidate` cannot carry today — an identifier, or a seam that can answer "more
than one place matches". Written down in `place-key.ts` and named for pl-28.

Doing that safely forced a structural fix worth having anyway. `between` is
asked about the candidates the _composer_ holds, and those are the ones this
pass has already written coordinates into — so a key recomputed from them would
no longer match an index built before the write-back. `endsOf` pins each
candidate's two keys once, by candidate id, which survives `withCoordinates`
untouched. The hazard is removed rather than commented.

**`fixturePlaceKey` is deleted.** It had no production caller left, and its doc
comment still recommended, to the next author assembling a matrix, the exact
practice that caused this ticket's high — with `place-key.ts` two files away
saying "pl-28 will key places too". A comment now stands where it was, saying
why there is deliberately no such export. The guard test asserts against
`placeKey` itself, the function the provider really calls, which is a stronger
assertion than the wrapper ever supported.

**The additivity acceptance could not fail for the reason it named, and the
honest fix was to amend the Done-when.** Against the default backend, every
measured transition on a checked-in set is zero minutes into an anchor — a place
measured from itself — so the silent and answering plans agree by arithmetic and
the packer could double-charge or invert the sign undetected. Two structural
facts sit under that, and both are now asserted rather than assumed: the six
checked-in sets are two to four candidates over four to thirteen days, so the
packer never puts two chargeable items on one day; and the fixture leg table
holds nothing for the pairs that do arise. Neither is fixable from this ticket —
the first is the shape of the fixtures, the second is pl-24's table — so the
Done-when says what is proven and where, and two guards go red the day either
fact changes. **An acceptance line that cannot fail is worse than one that is
missing, because it reads as covered.**

**Three prose sites had gone stale in one step**, all saying `travel-time`
disappears once every transition is measured — which the overnight entry made
false in the same round that introduced it. `CLAUDE.md` is the one that mattered:
it is what a future agent acts on, and it now states both consequences plainly —
the kind is not a unique key, and on a multi-day plan the entry never
disappears.

Two smaller things, recorded because each is a way a test can lie. The
anti-vacuity guard added last round was itself vacuous — `not.toBe` passes for
`null`, so renaming Rimouski in the gazetteer would have turned it into a no-op
silently. And `unchecked.test.ts` had a case called "does not ask for a
measurement of the trip to the day's bed" that asserted nothing of the kind: an
anchor **is** a transition, and it passed only because `NOTHING_MEASURED` takes
the plan-wide branch whatever the items are.

**One export re-opened in pl-25's file.** `UNKNOWN`, `REFUSED` and `answered`
were unexported by pl-25 as "three exports with no consumer", with the note that
the day something outside that file needs to _build_ an outcome, exporting them
is the change. `travel-measure.test.ts` stands a `RunGrounding` double up, so
that day arrived; the alternative was writing `{ kind: "unknown" }` at the call
site, which is the thing the naming exists to prevent.

### The fourth round, and where an entry's identity belongs

**The duplicate-key test was guarding on React's prose, and I had said so
myself.** The previous round's comment noted that duplicate keys still render
both children on a first mount — and then left the only assertion that could
catch a regression as a filter over a warning's wording. A reworded message and
the filter is empty, the three positive assertions still pass, and the test
checks nothing.

The fix moved the key rather than exporting it. `keyFor` was a local function in
`PlanView.tsx`, and the instruction was to export it so a test could assert
distinctness over real `uncheckedFor` output — but that output lives in
`@planner/itinerary`, and `web` depends only on `@planner/contract`. Exporting
would have meant either adding an itinerary devDependency to `web` for one test,
or asserting over lists a test author hand-built, which is the weakness that let
this through in the first place. **`uncheckedConstraintKey` is contract
vocabulary**, for exactly the reason `UNCHECKED_CONSTRAINTS` is: "when are two
entries the same entry" is a statement about the data, not about how React
reconciles a list, and a second reader that invented its own would be free to
disagree. With it in the contract, `itinerary` can assert the property over the
entries the composer really emits, and `web` renders with the same function.

**Asserting over real input immediately found what two rounds of reading had
not.** Mutating the key back to `constraint.kind` reddens five tests across two
files, and names the shapes: `road-trip`, `city-and-culture` and `multi-city`.
Gate 2 had found two of those by running the boot path; `city-and-culture` was a
third nobody had looked for. The lists a test author thinks of are not the lists
a composer emits.

**A separator a value can contain is a separator a value can forge.** The key
joined candidate ids with a comma, so `["a,b"]` and `["a","b"]` were one key.
Unreachable today — kind and detail are already unique per emit site, and ids
are `uuid-specialist-n` — but `Candidate.id` is only `z.string().min(1)`, and I
had made this exact argument in `place-key.ts` two rounds earlier and then not
applied it one file over. NUL throughout now.

**Three live pointers at a function this ticket deleted**, and the one that
mattered was not in the code. Build step 3 still told the reader to deduplicate
with `fixturePlaceKey` — the advice that produced this ticket's high — and
pl-24's handover note still advertised the export. Those are the two documents
somebody starting pl-28 reads. Both now carry an amendment in place rather than
an edit: the advice's _shape_ was right and only the function was wrong, which
is worth keeping visible. It is also recorded as point 8 of _What the brief had
wrong_, because a gate table is not where the next agent looks for that.

**And the prose overstated by a shade.** Three sites said `travel-time` never
disappears "on a multi-day plan"; the true claim is a plan with placed items on
two or more days. A multi-day trip whose season filter lands every placed item
on one day, all measured, emits no entry — contrived, since the packer fills
evenly, but the sentence as written was false there. All three reworded, each
naming the one-day case rather than leaving it to be discovered.

**One thing about running the suite, which cost time twice.** Vitest resolves
`@planner/contract` through its `dist`, so a contract change does not reach the
suite until `npm run build` has run. Mutating `uncheckedConstraintKey` and
seeing every test still pass is not evidence the guard is weak; it is evidence
the build is stale. That is the same trap the gate-1 note records about baseline
measurement, arriving from the other direction.

### Nothing renders a measured leg, and that is deliberate

`web` was never in this ticket's declared packages, and no view reads
`PlanItem.travelFromPrevious`. So the whole user-visible effect of this slice is
a caveat that disappears from the unchecked list when the transitions were
measured — which is the honest half, but it is not the half a traveller notices.
Rendering "2 h 45 from the last stop, measured" belongs with pl-28 and pl-29,
which bring a real backend and a reason to look at a leg.

### Two things about the fixture backend that the next ticket should know

- **Its leg table holds the legs the candidate sets _propose_, not the
  transitions the composer _asks about_.** Those are different questions —
  proposal is Montréal→Québec, a transition is from the end of one placed item to
  the start of the next — so most fixture runs still name travel time, honestly.
  `multi-city` is the shape whose days pair a route leg with the lodging at its
  far end, which is a place measured from itself, and it is what the api suite
  uses. Widening that table is pl-24's file and was deliberately not touched.
- **Every unmeasurable pair is re-asked on every run**, because pl-25 does not
  cache `null`, and for `travel` the cost is amplified: an unstored cell keeps
  its whole row _and_ column in the wanted sets. A run of this pass over ~16
  places with a sparse backend therefore re-requests most of the matrix each
  time. It is one call per run either way, so it does not burn the budget — but
  it does mean the cache buys much less than it looks against a thin backend.

### Tests

**The first version of this section got its own numbers wrong**, and how is
worth recording: it compared against a suite count from `main` while the branch
was based on pl-25. The honest way to read a suite delta is to check out the
actual base and run it — and to `npm run build` there first, because a stale
`dist` from the branch makes ~46 tests fail in ways that look like real
regressions.

At `cac5245`, this branch's base, the planner suite is **628 across 44 files**.
This branch is **669 across 47 files**: +41 tests, +3 files. Measured by checking
the base out and running it there, not by subtracting a remembered number.

Two existing tests changed meaning, and one deliberately did not:

- `unchecked.test.ts`'s "always says travel time was not checked" is now "says
  travel time was not checked **when nothing measured a distance**". The
  assertion is unchanged; what it claims is now about that plan.
- `migrations.test.ts`'s wind-back to `user_version = 4` needed three more
  statements: SQLite refuses to drop a column a trigger names, so the trigger
  goes back to its migration-2 form first. It now covers 5 and 6 together.
- `grounding-cache.test.ts`'s eviction cases were rewritten by pl-25 itself, in
  its second round, to ask whether the _seeded row_ survived rather than whether
  the table was empty — because a run that grounds leaves its own fresh rows
  behind. This branch takes pl-25's version wholesale; the edit it had made to
  the same block was superseded.
