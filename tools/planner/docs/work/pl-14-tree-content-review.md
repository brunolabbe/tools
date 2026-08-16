---
id: pl-14
tool: planner
title: Review the question tree as content — budget, drive appetite, vehicle
kind: work-package
status: done
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
and the five changes it agreed.

**Now is the cheapest moment there will ever be.** Nothing outside `intake` and
`web` reads a brief slot yet — `agent/src` and `api/src` name none of them, and
`itinerary` is not built. Today each of these is a `version` bump and a rename;
once a specialist reads the brief it is a migration with a plan attached.

**This ticket proposes contract edits, and that is deliberate.** The root
`CLAUDE.md` forbids changing a tool's contract unilaterally, so this file is the
"stop and say so": three of the five changes below are contract changes, agreed
in review before the work starts rather than during it.

### The five, and the argument for each

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

**5. The header's argument for asking `shape` first is wrong, and the ordering it
defends is right.** The file says shape is question one partly because "the fixed
core sits _after_ it and is shape-independent, so switching from a road trip to a
hiking trip costs the shape's own answers and nothing else". That property is not
produced by the ordering. It comes from `withShape` swapping only `details`, and
from every fixed-core node carrying `when: null`, which puts it permanently out
of `prune`'s reach — so a `shape` asked sixth would cost exactly the same answers
as a `shape` asked first. The comment credits the order with a guarantee the data
model already makes unconditionally, and a reviewer who believes it will defend
the order for a reason that would survive its removal.

The ordering keeps its place on the arguments that are actually load-bearing, and
they belong in the comment instead — see below.

### Considered and not done

**`backcountry.daily-distance` stays a number.** It is the same shape of
complaint — a numeric field where a band would do — and the answer is different:
km on foot does not vary with the surface the way road speed does (the node
already promises the climb is ours to account for), a hiker does think in km, and
it is a `refine` question behind the checkpoint so only an engaged user meets it.

**The fixed core does not move ahead of `shape`.** Proposed in the same review:
ask everything common to every trip first — party, origin, dates, budget,
effort — then the kind of trip and its follow-ups, then the optional ones. That
is already the tree's structure; the whole proposal reduces to moving one node
from position one to position six, and it is legal — nothing is conditioned on
the fixed core, and every shape-gated node would still fall after `shape`, so the
earlier-references-only rule survives it.

It is not taken, for three reasons that are about the product rather than the
engine. `shape` has the highest information gain of any question in the tree — it
decides which questions are asked at all and which specialists eventually run —
and it costs the user nothing, so it goes first. Abandonment favours it: someone
who leaves after three questions has left "a road trip from Montreal, ten nights
in September", which is a trip, where the other order leaves "two people, moderate
budget, moderate effort", which describes nobody. And it is the one question that
reads as an invitation rather than as a form.

One argument was raised for it and withdrawn: that asking `shape` first lets the
wizard say how many questions remain. It does not — `ProgressLine` in
`web/src/wizard/Wizard.tsx` shows a count of answers with no denominator, and the
comment above it says that is deliberate. Shape-first is what would make a
denominator _possible_; nothing spends it today, so it is not a reason.

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
   - **Rewrite the header's "Shape first" block.** Drop the claim that the fixed
     core sitting after `shape` is what makes a shape change cheap — that is
     `withShape` and `when: null`, not the order, and the block should say so
     plainly so the next reviewer does not re-derive it. Replace the argument with
     the three that hold: highest information gain, what a half-finished intake is
     worth, and that it is the question a person answers gladly. Then keep the
     part that is true and load-bearing — a condition may only reference a
     question that came earlier, so every shape-gated node falls after this one.

     Note in the block that the alternative was considered on 2026-08-16 and why
     it lost, or the same proposal arrives again with the same reasoning.

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

### 2026-08-16 — landed, all five

The tree is **version 2**: 37 questions, 16 of them `core`, and the checkpoint is
at **seven** questions for a road trip, **six** for a resort. `npm run check` is
green, the planner suite is 218 tests over 19 files (781 repo-wide over 58), and
`npm run e2e:planner` passes with **no spec edited** — which is the claim pl-13
made about content edits, now paid out by a change that retired two ids, moved a
question across the checkpoint and added a third.

The contract edits are the three the ticket proposed and nothing else:
`REQUIRED_CORE_SLOTS` loses `budget`, `DRIVE_APPETITES` and the
`ROAD_VEHICLE_KINDS` / `VEHICLE_SOURCES` pair arrive, `RoadTripDetails` carries
`driveAppetite`, `vehicleKind` and `vehicleSource`, and
`REQUIRED_SHAPE_SLOTS["road-trip"]` is `["driveAppetite", "vehicleKind"]`. Each
constant's doc comment carries the reason, because the comment is the only place
the bar is written down.

**pl-6's `core` ⇄ `missingRequiredSlots` test needed no edit**, in either
direction. Both sides moved together, which is what it exists to prove.

#### What the brief got wrong

- **The api discarded-answer assertion names _two_ ids, not three.** Build step 4
  predicted three. `answerThroughCore` stops at the checkpoint, and
  `road-trip.vehicle-source` is `refine`, so it is never answered and cannot be
  discarded — the shape change costs `road-trip.drive-appetite` and
  `road-trip.vehicle-kind`, exactly the pair the "Done when" list names. The
  third id only ever appears if a suite walks past the checkpoint first.
- **The 4.5-hours case could not simply "become a choice case".** It was the
  tree's only coverage of a `number` node with `integer: false`, and
  `road-trip.drive-hours` was the node it used. So it moved to
  `backcountry.daily-distance` (which §"Considered and not done" deliberately
  left a number) and a separate choice case was added for
  `road-trip.drive-appetite` — one that also asserts a `number` answer is now
  refused there, which is the id-change rule made visible.
- **`intake/test/tree.test.ts`'s shape-independent core list would have passed
  unedited.** The budget node keeps `when: null`, so it stays reachable across a
  shape change whatever its `stage` is; removing `budget` from that list is
  tidying, not a fix. What did need fixing in the same test was its comment,
  which credited `shape` being question one with the guarantee — §5's error,
  reproduced. The identical wrong argument sits in
  `api/test/intakes-routes.test.ts`'s discard test ("the whole reason the fixed
  core sits after `shape`"); both now name `when: null` and `withShape` instead.
- **`contract/test/fixtures/road-trip.json` is unlisted collateral.** It carries
  the old slot names, `fixtures.test.ts` parses it against `tripBriefSchema`, and
  it is the checked-in brief a specialist test will read — so it now holds a
  car that is `own`, with the two facts separate.
- **Three prose counts were stale and unlisted**: `03-STATUS.md`'s "36
  questions" and its test count, and `brief.ts`'s "puts a draftable brief at
  eight answers" above `REQUIRED_SHAPE_SLOTS`. Fixed.

#### Deliberately not changed

`e2e/intake.spec.ts`, `contract/src/api.ts` and `web/src/wizard/Wizard.tsx` all
still cite `road-trip.drive-hours` in a comment, as the counter-example of a
selector or a rendered string that must never appear. That id is now retired,
which makes it a _better_ illustration than a live one, and leaving the spec
untouched is what lets "the e2e suite passed with no spec edited" be checked
rather than asserted. `tools/planner/CLAUDE.md` is the one that had to move,
because it states the rule with an example that read as current fact — it now
names a live id and the right question count.

#### One environment note for the next worktree

A git worktree under `.claude/worktrees/` has no `node_modules` of its own, and
node's parent-directory lookup walks straight up to the main checkout's — so
`@planner/contract` resolved to `/workspaces/tools/tools/planner/contract` and
`tsc --build` reported the new exports as missing no matter how often the
worktree's contract was rebuilt. `npm install` inside the worktree (ten seconds,
workspace symlinks only) fixes it. Worth knowing before debugging a contract
change that "will not compile".

### 2026-08-16 — review pass on the content

Three fixes to the content itself, none of them to the machinery. The suite was
green before them and is green after, which is the point: a tree edit that tests
cannot see is exactly the kind this file exists to catch.

- **The drive-appetite labels carried no distance, and the ticket promised one.**
  §2 argues for "a four-way choice whose labels carry a distance anchor" and
  build step 2 then spells out four labels with only hours in them. The labels
  won, the argument lost, and the argument was the half that came from the review:
  the whole reason the question changed shape is that hours are the honest unit
  and distance is the palpable one, so a label with only hours in it keeps the
  problem it was meant to solve. Each label now carries both — "about 300 km"
  beside "three or four hours" — with a comment saying the kilometres are an
  illustration at an ordinary highway speed and not a second answer, since the
  band was never a promise about how far.

  Worth naming as a failure mode rather than a typo: a brief that argues for
  something in prose and then contradicts itself in a literal gets implemented
  from the literal, every time. The literal is the specification.

- **The help text talked about the form instead of the trip.** "Nobody answers
  this in decimals. Pick the day that sounds like yours." is true of the node's
  history and invisible to a user, who never saw the decimal field. It now says
  what the answer decides — how far apart two nights can be, and how much of a
  day is left on arrival — which is the register every other help line in the
  file uses.

- **`tools/planner/CLAUDE.md` had picked up a changelog.** The e2e rule gained a
  clause about pl-14 retiring an id and moving the count off eight. That belongs
  in this log, where it already is; a rules page states the rule and names a live
  example. Reverted to the original sentence with the id and count updated.

Also: the Why section still said "three of the four changes below", written
before §5 existed.
