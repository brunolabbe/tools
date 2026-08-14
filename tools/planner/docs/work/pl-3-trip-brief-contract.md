---
id: pl-3
tool: planner
title: The trip brief, in the contract
kind: work-package
status: done
milestone: P1
depends_on: []
---

# pl-3 — The trip brief, in the contract

**Packages:** `contract`

## Why

Trip types share almost nothing — a skidoo weekend lives on snow base and fuel
range, a Rome week on opening hours and walkability
([00-ANALYSIS.md §1](../00-ANALYSIS.md)). A form that asks every question in that
table is a form nobody finishes, so which questions get asked has to be a
function of the answers so far.

The output is what matters more than the asking. A **`TripBrief`** — validated,
structured — is the only thing a specialist ever sees (§3, §4). That indirection
is what makes the fan-out testable: given a checked-in brief, the roster is
deterministic and a unit test can assert it. It is also what made the §3
amendment cheap — swapping a model interviewer for an authored tree changed what
fills the brief and nothing that reads it.

This ticket is **contract only**, and it is a gate rather than a queue position:
four packages depend on this shape, and the root `CLAUDE.md` forbids editing a
contract unilaterally. The tree that fills the brief is
[pl-6](./pl-6-question-tree-and-engine.md); the storage and the UI are
[pl-7](./pl-7-intake-persistence-and-wizard.md).

## Build

1. **`TripBrief`.** The fixed core every trip needs: party (count, ages that
   matter, accessibility), dates and their flexibility, origin, budget shape,
   appetite for effort and for discomfort, hard deal-breakers. Then a `TripShape`
   enum — road trip · backcountry · motorised touring · city and culture ·
   resort · multi-city — and a per-shape extension holding that shape's answers.
   Write each schema `satisfies z.ZodType<T>` as `api.ts` already does.

2. **Every slot is explicitly _unknown_, _asked-and-declined_ or _answered_.**
   "The user does not care" is an answer and must never be re-asked. This was
   written for an interviewer that might forget; it matters just as much for a
   tree, because a declined slot must not keep reappearing as the next question.

3. **`missingRequiredSlots(brief)`** returns which slots block a first draft, per
   shape. It was defined here to stop a model claiming it had heard enough (§3);
   with an authored tree there is no such claim to guard against, so it becomes a
   plain fact about the brief — and it is what the wizard's completeness and the
   orchestrator's readiness check both read. It stays in the contract because
   both sides need it and neither should own it.

   It is also load-bearing on a product decision taken 2026-08-14: **the wizard
   stops asking when this list is empty** and offers the draft there. So
   "required" is not a wish about data quality — it is the line where a user is
   allowed to leave. Mark a slot required only if a first draft is genuinely
   impossible without it; anything the plan is merely better for knowing is a
   `refine` question in pl-6, and belongs behind the checkpoint rather than in
   front of it.

4. **A free-text slot per shape.** The §3 amendment names this as the mitigation
   for the one thing an authored tree cannot do — follow up on something nobody
   anticipated. It is carried into the brief and read by specialists as context.
   It is deliberately _not_ a `notes` blob to be parsed back out later: it is
   context for a model to read, never a place to smuggle structure.

5. **Error codes the brief needs**, proposed here rather than added silently: a
   brief too thin to draft from, and whatever the date rules need beyond the
   existing `INVALID_DATES`. Say which, and why each is not already covered.

## Traps

**Dates are the field most likely to be wrong**, and `INVALID_DATES` already
exists for them. Flexibility — "a weekend in February", "two weeks sometime in
spring" — is a first-class case and not a missing date. A brief that can only
hold exact dates forces every user to invent them.

**Changing shape must keep the core slots and swap only the extension.** People
describe a road trip and turn out to mean a hiking trip with a drive at each end.
The type has to make that a cheap operation rather than a rebuild — and note that
this is the same rule the tree generalises into answer invalidation in pl-6, at
the level of one field.

**The brief will want fields nobody thought of.** Add them here rather than
smuggling free text into the context slot, which exists for a different job.

## Done when

`@planner/contract` exports `TripBrief`, `TripShape`, the per-shape extensions
and the slot states, each schema written `satisfies z.ZodType<T>` against its
interface; `missingRequiredSlots` is unit-tested per shape, including that a
declined slot does not count as missing; a shape change preserves the core slots;
and `npm run check` and `npm test -- --project planner` pass. No tree, no
storage, no UI lands in this ticket.

## Log

### 2026-08-14 — landed

`tools/planner/contract/src/brief.ts`, exported from `index.ts`, with
`contract/test/brief.test.ts` beside it. `npm run check` and
`npm test -- --project planner` are green. No tree, no storage, no UI, as the
brief required.

**What is in the contract.** `TripBrief` = a flat `TripBriefCore` of eleven
slots plus `details: TripShapeDetails | null`. `TripShape` is the six shapes
from §1. Each shape gets its own extension type, discriminated on `shape`, and
each extension carries a `context` free-text slot. `Slot<T>` is the three-state
union with `slot.unknown()` / `slot.declined()` / `slot.answered(v)`
constructors and `isAnswered` / `isSettled` predicates. Every schema is written
`satisfies z.ZodType<T>`; `slotSchema` is a generic factory, so it carries an
explicit return type instead, which buys the same proof.

**Where the schemas live, and why not `api.ts`.** They sit beside their types in
`brief.ts`. `api.ts` is documented as the HTTP contract and a brief is validated
in places with no HTTP in them — `@planner/intake` assembles one offline, a
specialist reads one it was handed. The property the brief actually asked for is
the `satisfies`, and that is unaffected by the file.

#### Step 5 — the error codes, proposed

**One new code: `BRIEF_INCOMPLETE`.** Raised when something asks for a plan
against a brief whose `missingRequiredSlots` is not empty. Nothing existing
covers it: core has no "your input was incomplete" code at all — its input codes
are about a URL — and the request that raises this one is _well formed_. It is
the document behind it that is not ready, which is a different sentence to a
user and a different fix. Its `details` carries the missing slot ids, so the UI
can send someone back to the right question rather than to the start of the
wizard.

**The date rules need nothing new, and that is the considered answer rather than
a shrug.** `INVALID_DATES` already covers a return before departure, a date in
the past, and a span longer than we will plan. Flexibility adds one case — a
window too narrow to hold the nights asked for ("two weeks between the 1st and
the 7th") — and it is the _same cause_ as the others: these dates contradict
each other. It wants the same sentence in front of a user. What distinguishes it
is `details`, not the taxonomy, and `AppError` already carries those. A code per
date shape would give the UI six ways to say one thing. Both code comments in
`errors.ts` now say this, so nobody re-opens it silently.

#### Decisions worth knowing before pl-6

**`destination` is a core slot and is deliberately _not_ required.** The brief's
core list (from §3) does not mention a destination, but pl-7 step 5 draws an
intake's title from "the destination answer", so the slot has to exist. Making
it optional is what reconciles them, and it is also right on the product: §1's
list of hard facts a user knows is who, when, budget and origin — not where.
"Somewhere warm, you pick" is a real trip to plan, and a _declined_ destination
is an instruction to the roster rather than a hole in the brief.

**Required is six core slots plus one or two per shape** — `shape`, `origin`,
`dates`, `travellers`, `budget`, `effort`, then e.g. `maxDailyDriveHours` and
`vehicle` for a road trip. That is eight answers for most shapes and seven for a
resort, which lands on §3's "perhaps eight to ten", and a test asserts the count
stays there. `comfort`, `ages`, `accessNeeds`, `dealBreakers` and `destination`
are all _refine_: each improves a plan, none of them prevents one, and the bar
here is the line where a user is allowed to leave.

**`REQUIRED_SHAPE_SLOTS` is the table pl-6 must agree with**, and its type keys
each row to that shape's own slot keys — a slot renamed on an extension breaks
the table rather than silently dropping a requirement. pl-6 still owes the test
in both directions against the checked-in tree.

**The extensions are `type` aliases, not `interface`s, on purpose.** A type alias
carries an implicit index signature, which is what lets `missingRequiredSlots`
look a slot up by id without a type assertion. Do not "tidy" them into
interfaces.

**`shape` and `details` are kept in step by construction and by the schema.**
`withShape` is the operation the brief's trap asks for — it spreads the core
through untouched and swaps only `details`, so a road trip that turns out to be
a hiking trip with a drive at each end costs the extension and nothing else.
`tripBriefSchema` has a refinement rejecting a brief whose extension is not its
shape's, so nothing downstream has to consider that case.

**No clock, so `INVALID_DATES` is only half-enforced here.** The schemas check
what is true without one: a return not before its departure, a window that does
not end before it starts, `nights` inside `MAX_TRIP_NIGHTS`. "In the past" and
the window-too-narrow case need `now` or date arithmetic and belong to pl-6's
`validateAnswer`.

#### What the brief got wrong, or left out

- **`missingRequiredSlots` is runtime logic in a package `01-ARCHITECTURE.md`
  describes as having none.** The brief already argued for it and this ticket
  followed that; `emptyBrief`, `emptyShapeDetails` and `withShape` came along on
  the same reasoning — both sides need them and neither should own them. Worth
  saying out loud since the architecture page still reads "no runtime logic".
- **The brief lists "party (count, ages that matter, accessibility)" as one
  item.** It cannot be one slot: pl-6 fills one slot per question node, so it is
  three — `travellers`, `ages`, `accessNeeds` — and only the first is required.
- **`isSettled` takes `Slot<unknown>`, not a generic `Slot<T>`.** A generic
  cannot infer over `brief[id]` where `id` ranges across slots of different value
  types, which is exactly how `missingRequiredSlots` calls it.
- **`slot.unknown()` and `slot.declined()` return their own narrow types** rather
  than `Slot<T>`, so they need no type argument at a call site and a helper that
  only clears a slot can say so in its signature.
- **Tests on this branch are not covered by the typechecker yet** — dl-13 was
  still in flight when this landed. `contract/test/brief.test.ts` was
  typechecked by hand against `tsconfig.base.json` so it does not break the gate
  the day dl-13 merges.
