---
id: pl-18
tool: planner
title: Ask where they are going third, and let it be blank
kind: work-package
status: done
milestone: P1
depends_on: [pl-6, pl-7, pl-14]
---

# pl-18 — Ask where they are going third, and let it be blank

**Packages:** `contract`, `intake`, `web` — and the tests of all three

## Why

`destination` is question **eighteen**, behind the checkpoint, while `origin` is
question two. So someone who knows perfectly well they are going to Portugal
answers where they are leaving from, then five more questions, and only reaches
the one question they were most ready to answer after being told the essentials
are done.

The ordering is deliberate — [tree.ts](../../intake/src/tree.ts) argues that
skipping it means "we will treat choosing as part of the job", which is a real
and good feature of this tool. What is wrong is the price: **the tree is ordered
for the minority who have not picked a place, and the majority pays for it.**
Call it 95/5. The right way to serve the 5% is the help text on an early
question, not the position of a late one.

### The tree cannot currently say what this needs

`stage: "core"` does three separate jobs today, and they have coincided until now:

1. **Position** — every `core` node sorts before every `refine` node, because
   the wizard stops at the checkpoint (`tree.ts`'s header states this as the
   file's contract with itself; nothing enforces it).
2. **Blocks the draft** — `coreComplete` is false while any reachable `core`
   node is unanswered (`engine.ts`).
3. **Cannot be declined** — `validateAnswer` refuses a `declined` answer to a
   `core` node (`answer.ts`).

"Asked third, may be left blank" needs job 1 without jobs 2 and 3, and there is
no way to write it. `validateTree` closes the door explicitly: a `core` node
whose slot is not in `REQUIRED_*_SLOTS` is reported as a problem.

**The fix is to stop using `stage` as the proxy.** Jobs 2 and 3 are questions
about the _slot_ — is a first draft impossible without it — and the contract
already answers that in `REQUIRED_CORE_SLOTS` / `REQUIRED_SHAPE_SLOTS`. Job 3's
own comment gives the game away: it justifies itself with "its slot is one a
first draft is impossible without", which is a statement about the required
tables and not about where the question sits. The code reads `stage` because the
two sets have been identical since pl-6.

So after this ticket `stage` means **when it is asked**, and requiredness means
**whether it blocks the draft** — and `destination` is the first question that
needs to be one without the other.

### What this is not

**Not a change to what is required.** `REQUIRED_CORE_SLOTS` is untouched;
`destination` was never in it and still is not. A brief with no destination is
draftable before this ticket and after it.

**Not a reachability change.** Nothing in the tree is conditioned on
`destination`, so no branch opens or closes on where it sits. It is an ordering
change and a permissions change, and the engine's forward pass is unaffected.

## Build

1. **`contract/src/tree.ts` — the predicate, and what `stage` means.**

   - Export `isRequiredSlot(target: SlotTarget): boolean`, reading
     `REQUIRED_CORE_SLOTS` / `REQUIRED_SHAPE_SLOTS`. It lives here rather than in
     `brief.ts` because `SlotTarget` is here and `tree.ts` already imports
     `brief.ts` — the other direction is a cycle. `intake`'s `validate.ts` has a
     private `isRequired` that is exactly this; delete that one and import this.
   - Rewrite the `QUESTION_STAGES` doc comment. It currently says the marking and
     `missingRequiredSlots` "describe the same set … `validateTree` checks both".
     That is the claim this ticket retires in one direction. It should now say:
     `stage` is where in the asking order a question falls, `isRequiredSlot` is
     whether it blocks the draft, every required slot must be filled by a `core`
     node, and a `core` node need not fill a required slot — with `destination`
     named as the case, so the next reader does not "fix" it back.

2. **`contract/src/brief.ts` — the comments that state the old invariant.**
   `REQUIRED_CORE_SLOTS`'s comment already lists `destination` among the
   absentees and its reason still holds; add that it is nonetheless asked early,
   or the two files disagree about the same question. `REQUIRED_SHAPE_SLOTS`'s
   comment claims the table and the `core` marking "describe the same set" and
   that pl-6 tests it in both directions — narrow it to the direction that
   survives.

3. **`intake/src/engine.ts` — the checkpoint.** `coreComplete` becomes false on
   the first reachable unanswered node that **fills a required slot**, not the
   first `core` one. Keep the early `break`; it is still correct, but it must not
   fire on a `core` node that is merely early. Update the `IntakeProgress` doc
   comment, which describes the old rule.

4. **`intake/src/answer.ts` — declining.** Refuse a `declined` answer when
   `isRequiredSlot(node.fills)`, not when `node.stage === "core"`. The comment
   above it needs one sentence: an early question that is not required _can_ be
   declined, which is what makes an optional question askable before the
   checkpoint at all.

5. **`intake/src/validate.ts` — the invariant, weakened in one direction and
   strengthened in another.**

   - Drop the "marked core, but X is not required" problem. That is the rule
     being retired.
   - Keep both "required slot with no `core` node" loops, and keep "a core
     question gated behind a refine one".
   - **Add the ordering rule the header comment has always claimed and nothing
     has ever checked**: every `core` node comes before every `refine` node. It
     was previously implied by the invariant being dropped, so removing one
     without adding the other would leave the checkpoint's ordering unpoliced.
     This is the trade that keeps the file honest.

6. **`intake/src/tree.ts` — the move.**

   - `destination` moves to **position three**, directly after `origin`, and
     becomes `stage: "core"`. It keeps its id, so every saved answer survives.
   - Rewrite its help. Today it reads "Skip this and we will treat choosing as
     part of the job", written for a question nobody reaches until after the
     draft is offered. At position three it is the sentence that makes leaving it
     blank feel like an answer rather than an omission.
   - **`version: 3`.**
   - The header comment's "Seven questions get most shapes there, and six a
     resort" is now eight and seven **asked**, seven and six **required**. Say
     both numbers — the gap between them is the point of this ticket.

7. **`web/src/wizard/Wizard.tsx` — the skip button.** It renders on
   `question.stage === "refine"`, with a comment saying the engine refuses to
   decline a `core` question. Both need to follow the new rule, or the one
   question this ticket exists for is the one question with no way to skip it.
   The wizard has the node, so `isRequiredSlot(question.fills)` is in reach.

8. **The tests that name what changed** — these are the assertion that it landed,
   not collateral:
   - `intake/test/validate.test.ts` — the case asserting "core but not required"
     is a problem becomes its opposite, plus a new case for the ordering rule.
   - `intake/test/engine.test.ts` — a reachable, unanswered, non-required `core`
     node must not hold `coreComplete` false.
   - `intake/test/answer.test.ts` — declining `destination` is now accepted;
     declining a required question is still refused.
   - `intake/test/tree.test.ts` — the core list, and the checkpoint counts.
   - `web/test/wizard.test.tsx` — the skip button on an early optional question.
   - **pl-6's two-directional `core` ⇄ `missingRequiredSlots` test is the
     canary.** One of its two directions is deliberately being retired. It must be
     edited to assert the surviving direction only, and if the _other_ direction
     fails for a reason that is not `destination`, stop — something else moved.

## Traps

**A tree version bump with a moved node is not a discard.** `destination` keeps
its id, so `reconcileWithin` must report **nothing** discarded for a saved intake
that answered it. pl-14 proved this shape works when `budget` moved the other way
across the checkpoint; this is the same move in reverse and the same expectation.

**The checkpoint arrives one question later in wall-clock terms.** Eight asked
instead of seven for a road trip — still inside §3's "perhaps eight to ten", but
it is a real cost and the reason it is worth it is the 95%.

**Do not add `destination` to `REQUIRED_CORE_SLOTS` to make a test pass.** That
would make the whole ticket a no-op with extra steps, and it would break the
"somewhere warm, you pick" trip the tool is meant to plan.

**The e2e suite must pass unedited.** `e2e/intake.spec.ts` reads the screen and
names no question, so a reordering plus one new pre-checkpoint question is
exactly the edit it claims to survive. If it goes red, that is a finding about
the spec, not about the tree.

## Done when

- `destination` is question three, and answering it is optional: the wizard
  offers the skip, and `validateAnswer` accepts a `declined` answer to it.
- Declining any question in `REQUIRED_CORE_SLOTS` or `REQUIRED_SHAPE_SLOTS` is
  still refused, and the message still says why.
- The checkpoint arrives after **eight** questions for a road trip and **seven**
  for a resort, with `missingRequiredSlots` empty at each — whether destination
  was answered or skipped.
- `validateTree` reports a problem for a `core` node placed after a `refine` one,
  and reports none for a `core` node whose slot is not required.
- A saved road-trip intake created against tree version 2 loads against version 3
  with **nothing discarded**, and its destination answer intact.
- `npm run check` and `npm test -- --project planner` pass; `npm run e2e:planner`
  passes with no spec edited.

## Review

**Gate: CONCERNS** — 2026-08-16 · `origin/main...worktree-pl-18-destination-early` · code-review at medium

| Done when                                                                                                                      | Proof                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `destination` is question three, optional: wizard offers skip, `validateAnswer` accepts declined                               | `intake/test/tree.test.ts:188` ✓ (decline accepted) · `web/test/wizard.test.tsx:123` ✓ (skip button renders) — "question three" itself has no regression test, see finding                                                                |
| Declining any `REQUIRED_CORE_SLOTS`/`REQUIRED_SHAPE_SLOTS` question still refused, message says why                            | `intake/test/tree.test.ts:170` ✓ (`toThrow(/needed/i)` over every required node)                                                                                                                                                          |
| Checkpoint at 8 asked/7 needed (road trip), 7/6 (resort); `missingRequiredSlots` empty whether destination answered or skipped | `intake/test/tree.test.ts:116` ✓ (counts) · `:61` ✓ (answered) · `:93` ✓ (skipped)                                                                                                                                                        |
| `validateTree` flags a `core` node after a `refine` one; allows a `core` node whose slot isn't required                        | `intake/test/validate.test.ts:134` ✓ · `intake/test/validate.test.ts:125` ✓                                                                                                                                                               |
| v2→v3 reconcile: destination answer intact, nothing discarded                                                                  | `api/test/intakes-routes.test.ts:417` ✓                                                                                                                                                                                                   |
| `npm run check` + `npm test -- --project planner` pass; `npm run e2e:planner` passes, no spec edited                           | `npm run check` ✓ and `npm test -- --project planner` ✓ (490/490), both run directly — `npm run e2e:planner` **unproven (gate)** (`.github/workflows/planner.yml`); spec non-edit confirmed via diff, "passes" not independently verified |

- **low** · `tools/planner/api/src/intakes/title.ts:4-9`'s header comment still says `destination` "is a **refine** question... the first question _past_ the checkpoint" — pl-18 moved it to position three, pre-checkpoint and declinable, and this diff never touched the file. The function's own logic (`isAnswered(brief.destination)`, stage-agnostic) still works; the comment is simply now false, in a codebase where such comments are treated as the contract.
- **low** · No test pins `destination` to literal position three — `validateTree`'s new rule only checks core-before-refine ordering, not exact index. The claim is true only by reading `intake/src/tree.ts` directly.
- NFR: security n/a (no new input/auth/SSRF surface; destination reuses existing bounded `MAX_NOTE_CHARS` text validation) · performance n/a (same O(n) tree scans, one more node) · reliability ✓ (v2→v3 migration proven zero-discard; full suite 490/490 green) · maintainability mixed (clean single-source `isRequiredSlot` decoupling, but see the title.ts finding above)

## Log

### 2026-08-16 — the review's two findings, fixed

**The Review table's `tree.test.ts` line numbers predate the fix below and are
now twelve lines short**, because fixing the second finding meant inserting a
test near the top of that file. The gate's table is left exactly as the reviewer
wrote it — a verdict the author edits is not a verdict — so read those rows as
`:61 → :73`, `:93 → :105`, `:116 → :128`, `:170 → :182`, `:188 → :200`. The other
files' citations are unaffected. Fixing a finding invalidating the citation that
found it is a small structural wart in this process and worth knowing about
before the next review.

Both **low**, both mine, both fixed in the same branch. The gate stays CONCERNS
as written: the e2e row is `unproven (gate)` and stays that way until
`.github/workflows/planner.yml` runs it, which is the row's whole point.

- **`api/src/intakes/title.ts`'s header was stale**, and the sweep that updated
  the contract, the tree, both `CLAUDE.md` rules and six test files missed it
  because nothing in that file mentions `stage` — it reads
  `isAnswered(brief.destination)` and is behaviourally correct either way. The
  comment now says what is durable (a draft never requires a destination, so the
  fallback title exists) and notes what pl-18 changed: **declining is now
  possible**, so the fallback is the live path for a declined destination rather
  than only an unasked one. `api/test/intakes-routes.test.ts:105` already proves
  exactly that, having declined it through HTTP.
- **Nothing pinned `destination` to position three.** Added
  `intake/test/tree.test.ts:37`. Worth naming why the gap existed: I added an
  ordering rule to `validateTree` in this ticket and then assumed it covered the
  claim, and it does not — core-before-refine is satisfied by a destination asked
  eighteenth, which is the arrangement pl-18 exists to end.

#### Also fixed, found by the review's finders rather than named in its gate

- **`intake/test/helpers.ts` carried two contradictory doc blocks**, the old one
  directly above the new: "`fills` is the same slot on every one of them … the
  engine does not read [it]". Both halves false as of this ticket, and it sat
  next to the fix it argued against. Deleted. This is the more dangerous of the
  three stale comments — it is the one that could talk the next reader into
  reverting the fixture change and re-breaking every synthetic core node.
- **`web/test/wizard.test.tsx`'s header** quoted the `CLAUDE.md` rule title this
  ticket renamed. Updated to the current wording.

#### Where I disagree with a finder

One finder called the "core question gated behind a refine one" check in
`validate.ts` redundant now that the ordering check exists, on the grounds that a
backward reference to a `refine` node means that node is already behind us. That
is right for backward references and misses forward ones: a `core` node at index
0 referencing a `refine` node at index 5 trips the gated check and **not** the
ordering check, because no `refine` node has been seen yet. `validateConditions`
reports the forward reference separately, but with a different message and for a
different reason. Both checks stay. Left as a note rather than acted on, because
a review is not the place to delete a rule.

#### The roadmap said the retired invariant was load-bearing

`02-ROADMAP.md` listed "`missingRequiredSlots` and the `core` marking describe the
same set, and `validateTree` fails the tree in either direction" under **"Three
consequences, all of them load-bearing on tickets nobody has started"** — which
is the strongest standing a claim has in these docs, and it was false in one
direction the moment this ticket landed. Amended rather than rewritten, per the
convention `00-ANALYSIS.md` §3 and §7 already use: the original sentence is kept
in the past tense and the amendment says which half died and why.

Worth stating as a lesson rather than a chore. This ticket swept the contract,
the tree, the wizard, both `CLAUDE.md` rules and six test files, and still left
the design document that would be used to argue the change back out. **A code
sweep does not find a claim stated in prose about the code.** The grep that found
it was for the words, not the symbols — `"describe the same set"`, not
`REQUIRED_CORE_SLOTS`.

`00-ANALYSIS.md` §3's amendment had the same problem in one parenthetical —
"every node in the tree is marked `core` (needed before a first draft can exist)"
— and it now carries **a second amendment** rather than an edit, per the
convention that section already demonstrates twice. It was nearly left to the
pl-10 session on the grounds that the file's voice is better set by whoever is
already in it. That was the wrong reason, and the pl-10 session gave the right
one: **an amendment describes code, so it belongs on the branch that moves the
code.** Written into a pl-10 PR, it would put semantics into main that only exist
if this branch lands as-is, and it would put a pl-18 line in a pl-10 release.

`03-STATUS.md` is left to whoever lands last, which is the standing agreement:
line 40's "version 2, 37 questions", line 52's "stops at the core questions", and
the "agree in both directions" claim — which has moved to 243-248 under the pl-10
docs work and is the one most likely to be missed, being far from the summary
paragraph everyone reads. **The test counts in it must be measured, not carried
over from either branch.** 491/37 is right for this branch alone and wrong the
moment #44 lands; whoever writes that line runs the suite and reads the number
off it.

`01-ARCHITECTURE.md` never states the equivalence and needed nothing from this
ticket. It is not untouched in general — pl-10 edits two lines of it.

#### Not done here

The **v2-intake-at-checkpoint** case a finder raised is real and is not covered:
an intake saved under version 2 that never answered `destination` reconciles to
version 3 with `coreComplete` true and `progress.question` set to `destination`,
so the wizard shows the checkpoint rather than the question. That is the
pre-pl-18 behaviour preserved — those intakes were already past the checkpoint —
so it is not a regression, and both v2→v3 fixtures here answer or decline the
question rather than leaving it unasked. Whether a resumed v2 intake should be
shown the question it never got asked is a product decision, not a defect, and it
belongs in its own ticket.

### 2026-08-16 — landed

The tree is **version 3**: `destination` is question three, `stage: "core"`, and
still absent from `REQUIRED_CORE_SLOTS`. The checkpoint is **eight asked, seven
needed** for a road trip and seven/six for a resort. `npm run check` is green,
the planner suite is 490 tests over 37 files, and `npm run e2e:planner` passes
with **no spec edited** — the second content-shaped change to pay that claim out,
after pl-14.

`stage` now means one thing: where a question is asked. `isRequiredSlot(fills)`
in `contract/src/tree.ts` is the single answer to both "does the checkpoint wait
for it" and "may it be declined", and `engine.ts`, `answer.ts` and the wizard's
skip button all read it. `intake`'s private `isRequired` is gone; it was that
function, one package too low.

#### What the brief got wrong

- **`intake/test/answer.test.ts` needed no edit at all.** Build step 8 listed it.
  It tests `validateAnswer` against synthetic nodes, and none of them fills a
  required slot, so the decline cases it owns were unaffected. The two tests that
  actually needed writing were in `tree.test.ts`, against the checked-in tree —
  which is the right place for them, because the claim is about `destination`
  specifically and not about the function.

- **Two test fixtures filled `core.destination` as a throwaway slot, and that is
  now the one slot with special meaning.** `intake/test/helpers.ts`'s `textNode`
  and `web/test/fixtures.ts`'s `BASE` both picked it as an arbitrary truthful
  target — `BASE`'s comment even said "nothing under test reads it". Once the
  engine and the wizard started reading `fills`, every synthetic "core" node in
  both suites became optional, which is why four tests failed with the assertion
  inverted rather than with a type error. `textNode` now picks its slot from its
  stage and `BASE` fills `origin`, both with a comment saying why.

  Worth naming as a failure mode: a fixture value chosen because _nothing reads
  it_ is a fixture that silently mis-models the system the moment something does.
  It fails loudly here only because these tests assert on behaviour that changed.

- **The validator trade was worth more than the ticket claimed.** §5 framed
  "every `core` node before every `refine` node" as compensation for the rule
  being dropped. It is not compensation — that ordering is the tree's oldest
  stated invariant, `tree.ts` has asserted it in a header comment since pl-6, and
  **nothing had ever checked it**. It was simply never violated. The new check
  found no existing problem, which is the honest outcome, but the rule is now
  enforced rather than believed.

- **The v1→v2 fixture could not carry this bump's assertion.** "Done when" wanted
  a version-2 intake with a destination answer, and `saveVersionOneRoadTrip` has
  none — it predates the question mattering. A second fixture and describe block
  (`the version 2 tree meeting version 3`) covers it: nothing discarded, the
  answer intact through to `brief.destination`, and the question not re-asked on
  the way to the checkpoint.

- **`tools/planner/CLAUDE.md` had to move, again.** Its "the intake stops at the
  core questions" rule stated the `core` ⇄ `missingRequiredSlots` equivalence as
  current fact, and its e2e rule counted seven questions. Both now say what is
  true. Same reason as pl-14: a rules page states the rule with a live example.

#### Deliberately not changed

`tools/planner/docs/03-STATUS.md` still says the tree is version 2 with the
checkpoint at seven. Another session holds that file in
[PR #42](https://github.com/brunolabbe/tools/pull/42), which restores a missing
pl-16 row in the same table — editing it here would have meant a conflict over a
paragraph neither change is really about. **It needs a follow-up edit once #42
merges**: tree version 3, the checkpoint counts, and the test totals.
