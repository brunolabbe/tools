---
id: pl-6
tool: planner
title: The question tree, and the engine that walks it
kind: work-package
status: done
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

### 2026-08-15 — landed

`tools/planner/intake`, scoped `@planner/intake`, with the tree's vocabulary
added to `contract/src/tree.ts`. `npm run check` and `npm test` are green; the
planner suite is 119 tests over 11 files, 83 of them new here.

**The tree is 36 questions, 17 of them `core`.** A draft is eight questions away
for five shapes and seven for a resort — §3's "perhaps eight to ten", and the
same count pl-3's log predicted. The whole tree is 14–16 questions depending on
shape, and nobody has to answer it: the checkpoint is at question eight.

Two nodes are there to prove the tree's own shape rather than to fill a slot
cheaply. `comfort` is gated on `not(all(shape = backcountry, shelter = tent))`
— two ancestors, which a nested tree cannot express and which is the entire
argument for a flat list with conditions. `multi-city.min-nights` is gated on
`answered(multi-city.cities)`, because "the fewest nights in any one of them" is
a question about a list and there is no list until they name one.

#### The contract additions, and one new error code

`tree.ts` carries `Condition`, `QuestionNode`, `QuestionTree`, `Answer` and
`AnswerValue`, plus `answerSchema` for the HTTP boundary. Three notes:

- **`ShapeSlotKeys` is now exported from `brief.ts`.** It was already the type
  behind `REQUIRED_SHAPE_SLOTS`; the tree needs it for the same job.
- **There is no `conditionSchema`.** Conditions never cross a wire — the tree is
  ours, authored in TypeScript and checked by `validateTree` — and a schema
  written for an imagined parser is a second definition to keep in step.
  Answers do cross a wire, so they have one.
- **`INVALID_ANSWER` is a new code**, proposed here the way pl-3 proposed
  `BRIEF_INCOMPLETE`. Nothing covered it: core's input codes are all about a
  URL, and `BRIEF_INCOMPLETE` is about the _document_ being too thin to plan
  from, which is a different sentence and a different fix. This one is about a
  single answer being wrong on its way in — an option that is not on the list, a
  number outside the question's bounds, empty text, a decline of a `core`
  question. `details` carries the question id so the wizard can put the user
  back on it. Dates keep `INVALID_DATES`. `api/src/http-errors.ts` maps it to
  400, because leaving it unmapped means a 500 for a typo.

#### Decisions worth knowing before pl-7

**A node names a slot _target_, not a slot id.** The brief said each node
carries "the `TripBrief` slot it fills", and that is not enough to identify one:
`context` exists on all six extensions and `nightsOut` on exactly one. So
`fills` is `{ scope: "core", slot }` or `{ scope: "shape", shape, slot }`, typed
per shape the way `REQUIRED_SHAPE_SLOTS` is. Two things fall out of it —
`{ shape: "resort", slot: "nightsOut" }` is a compile error rather than a
runtime one, and the validator can check that a shape's question is _gated on
that shape_, which is the rule that stops an answer landing on an extension the
brief is not carrying.

**A `core` question cannot be declined.** Not in the brief, and it is
load-bearing: a declined slot counts as settled, so `missingRequiredSlots` would
call it satisfied. Without this rule someone could shrug their way past the
checkpoint and be told the essentials are done over an empty brief. Declining is
derived from `stage` rather than being a fourth field on a node — a `core`
question is by definition one the draft cannot do without, and a node that could
say otherwise would be a second source of truth about the same thing.

**`equals` and `includes` read text only.** They branch on choices and free
text, not on numbers, dates or budgets — so "ask this only if travelling alone"
is not expressible today. That is deliberate: a numeric comparison is a
condition kind with its own edge cases (units, integers, open bounds) and no
question in the tree needs one. Add it when one does. `includes` is in the
vocabulary and the engine, tested there, and the checked-in tree happens not to
use it yet.

**`toBrief` assembles loosely and then proves it.** The alternative was a writer
function per slot — thirty-odd of them, restating what the tree already says —
so instead assembly goes through one documented cast and the result is parsed
against the contract's own `tripBriefSchema`. A node whose kind or bounds do not
fit its slot therefore fails loudly (`INTERNAL`, with zod paths and codes but
never the user's text) rather than quietly producing a brief with a number where
a date belongs. `tree.test.ts` walks every shape and asserts the assembled brief
parses, which is what makes the backstop a test rather than a hope.

**`prune` returns dropped answers whose node is `null`** when the tree no longer
has that question. That is one half of pl-7's tree-version trap already
answered — re-running the engine against the current tree prunes what no longer
fits, and the caller can see it happened. **The decision itself is still pl-7's**:
this only makes the honest option cheap.

**`nextQuestion` returns `{ node, coreComplete }`** (`IntakeProgress`).
`coreComplete` is true while `node` still holds a `refine` question — that pair
_is_ the checkpoint, and pl-7 renders it. It is computed from the answers, never
stored.

**The purity rule is a test, not a paragraph.** `test/purity.test.ts` scans
`src/` for imports other than the contract, for `Date.now`/`new Date()`, for
`fetch`, and for anything reaching the model seam — the shape of
`packages/core/test/spawn-safety.test.ts`, for the same reason. §3's amendment
gets undone one convenient import at a time, and this is what notices.

#### What the brief got wrong, or left out

- **`validateAnswer(node, value, now)` takes the whole `Answer`**, not just the
  value: declining is one of the things that can be wrong about an answer, and
  the rule above has to live somewhere.
- **Step 3's "a node filling a slot that is not in `TripBrief`"** is now mostly a
  compile error. The runtime check stayed anyway — it costs a line, it reads the
  slot names off `emptyBrief()` rather than restating them, and a test can still
  hand the validator a tree the compiler never saw.
- **The validator gained rules the brief did not list**: two questions filling
  one slot (last-answer-wins in `toBrief`, and which one wins depends on tree
  order — a silent way to lose an answer), a shape question that does not offer
  every shape, an id that will not survive a URL, and number bounds the wrong way
  round.
- **`validateTree` returns problems rather than throwing.** One run names all of
  them, which is what a content review wants.
- **The Dockerfile needed a line.** `npm ci` fails when a workspace in the
  lockfile has no manifest in the image, so the build stage copies
  `tools/planner/intake/package.json`. The runtime stage does not copy its
  `dist` yet, because nothing imports it until pl-7 does — add it there.
- **Tests are still outside the typechecker** (dl-13 has not landed). These were
  written against the contract's own types and checked by hand, the way pl-3's
  were.

**[pl-7](./pl-7-intake-persistence-and-wizard.md)'s brief was amended** with what
this leaves it: the API surface, the five facts that change what it builds, and
three traps it did not have — that `destination` is now a `refine` question so a
checkpointed intake has no title, that a tree edit can turn a saved intake into a
500 through `toBrief`, and that the image's runtime stage does not carry this
package's `dist` yet.

### 2026-08-15 — merged main (pl-4), and the reference this ticket owed

Conflicted with [pl-4](./pl-4-plan-document-contract.md) in two places, both
because the two tickets describe the same repo from different halves of it:

- `contract/src/index.ts` — one export line each, `plan.ts` and `tree.ts`. Both.
- `03-STATUS.md` — four hunks, and none of them had a correct side. Each was
  written as "the other half does not exist yet", which stopped being true when
  both landed. Merged rather than picked: both contracts are built, the tree
  stands over one of them, **neither is filled** — pl-7 fills the brief, pl-5 and
  pl-9 fill the plan. The error-codes paragraph is the clearest case: pl-4's
  "all in" and this ticket's "still partly missing" were each true of their own
  branch and both wrong of the merge, so it now names `INVALID_ANSWER`
  alongside `PLAN_INFEASIBLE` and `REVISION_NOT_FOUND`. The counts are measured,
  not added: **178 planner tests over 15 files**, 741 repo-wide over 54.

**What the brief got wrong, found by the merge and not by the conflict.**
`tsconfig.tests.json` had no `{ "path": "./tools/planner/intake" }`, so
`npm run check` fails TS6307 five times — `intake` is a leaf whose tests import
its own `src`, which that file's comment names as the one case the omission is
loud for. This ticket's log says "tests are still outside the typechecker (dl-13
has not landed)", and that was true when the work was done: dl-13 landed on main
afterwards, and the earlier merge of main into this branch took the new file
without adding the line the new package owed it. So the branch was red on
`check` before this merge touched it, for a reason no conflict marker would ever
have shown. Root `CLAUDE.md`'s "adding a tool" step 3 is the rule — a new
package's tests cost one reference line there — and it applies to a new package
in an existing tool just as much.

Green after: `npm run check` clean, 741 tests over 54 files.
