---
id: pl-14
tool: planner
title: Review the question tree as content — budget, drive appetite, vehicle
kind: work-package
status: ready
milestone: P1
depends_on: [pl-6, pl-7]
---

# pl-14 — Review the question tree as content

**Packages:** `contract`, `intake`, `web` — and the tests of all three

## Why

`tools/planner/CLAUDE.md` says the tree is content and gets reviewed as content,
against three questions: does it earn its place, would a real person know the
answer, does the answer change what a specialist would do. It was authored in
pl-6 and has not been reviewed since. This is that review, held on 2026-08-16,
and the four changes it agreed.

**Now is the cheapest moment there will ever be.** Nothing outside `intake` and
`web` reads a brief slot yet — `agent/src` and `api/src` name none of them, and
`itinerary` is not built. Today each of these is a `version` bump and a rename;
once a specialist reads the brief it is a migration with a plan attached.

**This ticket proposes contract edits, and that is deliberate.** The root
`CLAUDE.md` forbids changing a tool's contract unilaterally, so this file is the
"stop and say so": three of the four changes below are contract changes, agreed
in review before the work starts rather than during it.

### The four, and the argument for each

**1. `budget` is not required for a first draft.** It stays a question — it
changes hotel tier, whether flights are in scope, whether an activity makes the
list. What is wrong is that it sits in `REQUIRED_CORE_SLOTS` and therefore blocks
the checkpoint. The bar that field states about itself is "a first draft is
genuinely impossible without it", and a first draft is entirely possible from a
`moderate` default — which is §3's "draft early, interview less" exactly. It is
also inconsistent as it stands: `comfort` drives lodging tier the same way and is
already `refine`. And budget is the question people are least able to answer
honestly up front, because the true answer is "depends what it buys" — which is
the thing a draft supplies.

**2. Drive tolerance is a band, not a decimal.** `road-trip.drive-hours` asks for
a number of hours with `integer: false`, and nobody types 3.5. Hours are the
right _unit_ — distance is only palpable once the road is known, and 400 km is a
lazy afternoon on an interstate and a full day on a mountain pass, so a distance
answer would force the composer to invent a speed to convert it back into the
thing it actually needs. The fix is the control, not the unit: a four-way choice
whose labels carry a distance anchor, matching `effort`, which is the same
question about a day and is already an enum.

**3. `vehicle` conflates two independent facts.** `ROAD_VEHICLES` is
`own-car | rental-car | camper-van | motorhome`, which cannot say _rented camper
van_ — in most markets the commonest camper trip there is. So the tool would
silently miss every rental constraint on the case where they bite hardest. Split
it: what you are driving, and whether it is yours.

**4. The tree version goes to 2**, which is the first real bump and the first
time pl-7's `reconcileWithin` runs against saved answers for a reason other than
a test.

### Considered and not done

**`backcountry.daily-distance` stays a number.** It is the same shape of
complaint — a numeric field where a band would do — and the answer is different:
km on foot does not vary with the surface the way road speed does (the node
already promises the climb is ours to account for), a hiker does think in km, and
it is a `refine` question behind the checkpoint so only an engaged user meets it.

**`travellers` stays core and required.** Argued on the same axis as budget — it
is about stage, not about cutting the question — and left as it is because the
thing that would settle it is whether a first draft for two and a first draft for
seven are the same document, which nothing can answer until a lodging specialist
exists to look at. If it comes back, the change is one line out of
`REQUIRED_CORE_SLOTS` and a `stage` flip.

## Build

Contract first, because the tree will not compile until the slots exist.

1. **`contract/src/brief.ts` — the slot types.**

   - Drop `"budget"` from `REQUIRED_CORE_SLOTS`, and add it to the list of
     absentees in that constant's doc comment with the reason above. The comment
     is the only place the bar is written down; leaving it stale is how the next
     person re-adds the slot.
   - Add `DRIVE_APPETITES` / `DriveAppetite`. Four members, named for the day and
     not for a number: `short-hops`, `half-day`, `long-day`, `all-day`.
   - Replace `ROAD_VEHICLES` / `RoadVehicle` with `ROAD_VEHICLE_KINDS` /
     `RoadVehicleKind` (`car`, `camper-van`, `motorhome`) and `VEHICLE_SOURCES` /
     `VehicleSource` (`own`, `rental`).

     `VEHICLE_SOURCES` duplicates `MACHINE_SOURCES` member for member, and stays
     its own enum. Say so in a comment: one enum covering a motorhome and a
     snowmobile couples two shapes' content, and the two lists are free to
     diverge — a car can gain `borrowed`, a machine can gain an outfitter.

   - On `RoadTripDetails`: `maxDailyDriveHours: Slot<number>` becomes
     `driveAppetite: Slot<DriveAppetite>`, and `vehicle: Slot<RoadVehicle>`
     becomes `vehicleKind: Slot<RoadVehicleKind>` plus
     `vehicleSource: Slot<VehicleSource>`. Follow each through
     `tripShapeDetailsSchema` and `emptyShapeDetails`.
   - `REQUIRED_SHAPE_SLOTS["road-trip"]` becomes
     `["driveAppetite", "vehicleKind"]` — **`vehicleSource` is not required.**
     Whether the camper is rented changes the pickup point and a fee; it does not
     stop a draft existing, which is the same bar budget just failed. Update the
     comment above the row, which currently justifies the pair as "how far a day
     drives and what it drives".

2. **`intake/src/tree.ts` — the nodes.**

   - Move the `budget` node into the refine block and set `stage: "refine"`.
     Physically move it: the file's contract with itself is that every `core` node
     comes before every `refine` node, and the header comment says so. Put it
     first in that block, ahead of `destination`.
   - Replace `road-trip.drive-hours` with **a new id**, `road-trip.drive-appetite`,
     `kind: "single-choice"`, still `core`. Labels carry both anchors:

     - `short-hops` — "Short hops — a couple of hours, and we are there"
     - `half-day` — "Half a day — three or four hours, most days"
     - `long-day` — "A long day — five or six, and we do not mind"
     - `all-day` — "We eat miles — seven hours and up"

     The id must change, because the rule is that an id is never reused for a
     different question and a band is a different question from a number of
     hours. Reusing it would reinterpret every saved answer as a choice value
     that is not on the list.

   - Replace `road-trip.vehicle` with **two new ids**: `road-trip.vehicle-kind`
     (`core`, fills `vehicleKind`) and `road-trip.vehicle-source` (`refine`,
     fills `vehicleSource`). Same rule, same reason. The help on the kind
     question is the one that matters — a camper sleeps you, which is what
     changes lodging from hotels to campsites.
   - `road-trip.route-style`'s help currently reads "A one-way rental carries a
     fee worth planning around." Rental is now its own question, so this should
     say what the loop-or-not answer decides on its own terms.
   - The header comment's "Eight questions get most shapes there" is now seven,
     and six for a resort. Fix the number where it appears.
   - **`version: 2`.**

3. **`web` — the labels.** `wizard/Brief.tsx` maps slot ids to short labels and
   names `maxDailyDriveHours`; it needs the three new slots and loses the two old
   ones. Check `wizard/format.ts` and `wizard/controls.tsx` too — both switch on
   the answer _kind_ rather than the slot, so a number becoming a choice should
   cost nothing there, and if it does, that is worth knowing.

4. **The tests that name what changed.** These are not collateral, they are the
   assertion that the change landed:

   - `contract/test/brief.test.ts` — the road-trip fixture and the expected
     `missingRequiredSlots` list for a fresh resort brief, which loses `budget`.
   - `intake/test/tree.test.ts` — the shape-independent core list, which loses
     `budget`.
   - `intake/test/answer.test.ts` — the `4.5` hours case becomes a choice case.
   - `api/test/intakes-routes.test.ts` — the discarded-answer assertion names
     `road-trip.drive-hours` and `road-trip.vehicle`; it now names three ids.
   - The two-directional `core` ↔ `missingRequiredSlots` test from pl-6 should
     need no edit at all. If it does, one of the two sides moved without the
     other and the checkpoint is a lie — stop and find out which.

5. **The prose that names a dead id.** `tools/planner/CLAUDE.md` illustrates the
   e2e rule with "types into `#field-road-trip.drive-hours` or counts eight
   questions". Both halves are now stale. `e2e/intake.spec.ts` and pl-13's log
   use the same example — the spec's comments, not its code, since it reads the
   screen and names no question. Update the rule in `CLAUDE.md`; leave the
   historical logs alone.

## Traps

**The version bump is the interesting part, not the paperwork.** pl-7 decided a
version move re-runs the engine and prunes what no longer fits, reporting the
loss in that request's response. This is the first bump with real answers under
it, and it drops three ids at once for a road trip: the two old road-trip
answers, and nothing else — `budget` moved stage but kept its id, so a saved
budget answer must survive. If a stored budget answer disappears on load, the
node was re-created rather than moved.

**A `core` question cannot be declined, and budget stops being one.** That is the
change working, not a bug: "I have no idea yet" becomes an available answer to
the budget question the moment it is `refine`. Nothing downstream reads budget
today, so nothing has to cope yet — but whatever first does needs a defined
behaviour for `declined`, and it is not this ticket's to invent.

**Do not let the composer's default leak up here.** A band-to-hours mapping
belongs in `itinerary` when it exists, with unit tests, per _models generate
candidates; code schedules and checks_. `intake` stores the band and nothing
more.

## Done when

- The checkpoint arrives after **seven** questions for a road trip and **six**
  for a resort, and `missingRequiredSlots` is empty at each.
- Answering the budget question is still possible after the checkpoint, and
  declining it is accepted where declining a `core` question is not.
- A saved road-trip intake created against tree version 1 loads against version 2
  reporting exactly the drive-hours and vehicle answers as discarded, keeps its
  budget answer, and is not left in a state that 500s.
- A road trip can say it is in a rented camper van, and the brief holds both
  facts separately.
- The tree validator passes, and pl-6's `core` ↔ `missingRequiredSlots` test
  passes in both directions unedited.
- `npm run check` and `npm test -- --project planner` pass; `npm run e2e:planner`
  passes without a spec having been edited, which is the claim pl-13 makes about
  content edits.

## Log

_Empty — the work has not started._
