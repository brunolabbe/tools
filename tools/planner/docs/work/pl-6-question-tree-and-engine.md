---
id: pl-6
tool: planner
title: The question tree, and the engine that walks it
kind: work-package
status: ready
milestone: P1
depends_on: [pl-3]
---

# pl-6 — The question tree, and the engine that walks it

**Packages:** a new `tools/planner/intake`, scoped `@planner/intake`

## Why

[00-ANALYSIS.md §3](../00-ANALYSIS.md) was amended on 2026-08-14: the intake asks
**authored questions**, and no model is in it. This is that decision, built.

The naive reading is that this ticket replaces a prompt with a `switch`. It does
not. The hard part is not asking questions in order — it is **answer
invalidation**. Someone answers eight questions down the backcountry branch, goes
back, changes the shape to city-and-culture, and those eight answers are now
answers to questions nobody would ask. Getting it wrong does not throw. It
quietly leaves the store holding contradictions that surface much later as a plan
built from a trip the user never described, which §7's failure modes would call
the worst kind: silent and plausible.

The design already had this rule at one field's worth of scope — pl-3's
"changing shape must keep the core slots and swap only the extension". This
generalises it.

## Why its own package

`intake` is pure: no database, no network, **no clock**. It cannot go in
`contract`, which holds no runtime logic, and reachability is logic. It is
deliberately not folded into `itinerary` despite sharing its exactness: an intake
engine inside a package named for the output document is a name that lies, and
the two are exact for unrelated reasons. See the packages table in
[01-ARCHITECTURE.md](../01-ARCHITECTURE.md).

## Build

1. **The tree's vocabulary, in `contract`** — a small addition to pl-3's work,
   agreed the same way. Nodes are a **flat, ordered list with conditions**, not a
   nested tree:

   ```ts
   type Condition =
     | { kind: "equals"; question: QuestionId; value: string }
     | { kind: "includes"; question: QuestionId; value: string }
     | { kind: "answered"; question: QuestionId }
     | { kind: "all" | "any"; of: readonly Condition[] }
     | { kind: "not"; of: Condition };
   ```

   Flat because nesting cannot express a question that depends on two separate
   ancestors — "you are driving **and** it is winter" — and that question is
   exactly the kind this domain is full of. A flat list also reads better in
   review, which matters when the tree is content.

   Each node carries `id`, `prompt`, optional `help`, `when: Condition | null`,
   the `TripBrief` slot it fills, and **`stage: "core" | "refine"`**. `core`
   marks a question without which no first draft can exist. That is §3's
   "draft early, interview less" made into data, and it is nearly free now and
   expensive to retrofit once answers are stored without it.

   **`core` is behaviour, not a label** — decided 2026-08-14, see the roadmap's
   _Still open_. The wizard stops when nothing `core` is unanswered and offers
   the draft there, so this marking is what a user actually runs into. The
   consequence for this ticket: **the `core` nodes and pl-3's
   `missingRequiredSlots` must describe the same set.** A `core` node whose slot
   is not required, or a required slot no `core` node fills, makes the checkpoint
   a lie — the wizard would either stop short of a draftable brief or keep asking
   past one. Test it in both directions against the checked-in tree.

   **Conditions may reference only questions appearing earlier in the tree.**
   This is the constraint that makes everything below a single forward pass — no
   cycle detection, no fixpoint. Document it here; enforce it in step 3.

2. **`tree.ts` — the authored tree.** The fixed core from §3, then branch on
   shape. A skidoo trip and a Rome week diverge after about three questions, so
   the core is short and the branches carry the weight. A `version` integer that
   goes up whenever the nodes change.

   This is **content**, and it gets reviewed as content: does this question earn
   its place, would a real person know the answer, and does the answer change
   what a specialist would do? A question whose answer changes nothing downstream
   is a question to cut.

3. **`validate.ts` — the tree validator**, run as a test rather than at boot. It
   must reject: a duplicate question id; a condition on an unknown id; **a
   condition on a question appearing later**; a node filling a slot that is not
   in `TripBrief`; a choice-kind node with no choices; and a `core` node gated
   behind a `refine` node — because if a question needed for a draft sits behind
   an optional one, `core` has stopped meaning anything. That last one deserves a
   named test.

4. **`reachable(tree, answers)`** — one forward pass in tree order. A node is
   reachable when `when` is null, or evaluates true against the answers to
   _earlier reachable_ nodes. Evaluating against all answers instead is precisely
   the bug this ordering prevents: a stale answer on a dead branch would
   resurrect the branch below it.

5. **`prune(tree, answers)` → `{ kept, dropped }`** — the invalidation rule.
   Pure, and returning both halves rather than mutating, because the UI must be
   able to say "changing this discards these four answers" _before_ anything is
   written. Watch the fixpoint: dropping one answer can strand another. A single
   ordered pass is sufficient given the earlier-references-only rule — prove it
   with a test that would need two passes if it were not.

6. **`nextQuestion(tree, answers)`** — the first reachable unanswered node.
   `null` means done. A slot that was **asked and declined** counts as answered
   (pl-3), and a test should say so, because re-asking a declined question is the
   most visible way this tool can look stupid.

   It also reports **whether anything reachable and `core` is still unanswered**,
   since that is the checkpoint pl-7 renders. Compute it here rather than letting
   the wizard filter the reachable set by stage — the same reason nothing else
   about the tree is evaluated in the browser.

7. **`toBrief(tree, answers)`** — assemble the `TripBrief`. This is where answers
   stop being answers and become the document specialists read.

8. **`validateAnswer(node, value, now)`** — the answer fits its question's kind
   and bounds. `INVALID_DATES` for a return before departure or a departure in
   the past. **`now` is an argument**: a `Date.now()` inside a pure engine is a
   test that fails at midnight.

## Traps

**Answers arrive from HTTP as `unknown`.** They are parsed with the contract's
zod schema at the boundary in pl-7; this package's functions take parsed values
and may assume their shape. Say so in the doc comments, so nobody adds a second
defensive layer that obscures where validation actually happens.

**Do not put reachability behind a model, even a little.** The moment a condition
is "ask the model whether this applies", the package needs a provider, the tests
need a script, and the §3 amendment is undone by increments.

## Done when

- A change that invalidates a branch reports exactly the answers it discards, and
  a stale answer on a dead branch does not reopen it.
- The validator rejects each malformed tree in step 3, each with a named test.
- The checked-in tree passes the validator, and reaches a draft-ready brief —
  `missingRequiredSlots` empty — for at least two shapes that diverge early.
- Answering every reachable `core` node empties `missingRequiredSlots`, and
  leaving any one of them unanswered does not, for each of those two shapes.
- No file in the package imports a database, a network client, or a clock.
- `npm run check` and `npm test -- --project planner` pass.

## Log

_Not started._
