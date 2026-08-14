---
id: pl-3
tool: planner
title: The trip brief, in the contract
kind: work-package
status: ready
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

_Not started._
