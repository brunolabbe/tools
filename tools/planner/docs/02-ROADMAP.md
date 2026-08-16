# Roadmap — planner

Describe a vacation — a road trip, a hiking weekend, a skidoo ride up north, a
slow week of history in Europe — answer a guided set of questions about it, have
the specialists that trip actually needs work on it, and keep the plan.

Three claims carry the whole plan, all argued in [00-ANALYSIS.md](./00-ANALYSIS.md):

- **The roster is data.** Which questions matter and which specialists a plan
  needs are a function of the trip's shape (§1, §4).
- **Models generate candidates; code schedules and checks.** Drive times, day
  packing, budgets and opening hours are arithmetic, and arithmetic is where AI
  itineraries embarrass themselves (§2).
- **The intake asks authored questions, and no model is in it.** A checked-in
  question tree, branching on the trip's shape, producing the same `TripBrief`
  an interviewer would have (§3 amendment).

**This tool is not a chat**, at either end. It was scaffolded as one, and the
transcript premise was retired on 2026-08-14 — see
[pl-1](./work/pl-1-conversation-loop.md) before reaching for a conversation loop
here. Two amendments to [00-ANALYSIS.md](./00-ANALYSIS.md) carry it: **§3** for
the intake, and **§6** for revision, decided 2026-08-16 once the vocabulary
removal surfaced the one paragraph §3 had missed. Both record what the decision
costs as well as what it buys, and the cost is the same both times and real: a
tree cannot follow up on something nobody anticipated, and an operation nobody
built cannot be asked for.

The domain used to be deliberately absent from this page. It is now designed at
the level of shape — [00-ANALYSIS.md](./00-ANALYSIS.md) for why, and
[01-ARCHITECTURE.md](./01-ARCHITECTURE.md) for the structure that follows. What
is still open is listed at the bottom, and it is short on purpose.

**The vocabulary is settled:** a **trip** is the journey the user is taking — the
thing a `TripBrief` describes — and a **plan** is the document this tool keeps
about it. The persisted aggregate is the plan, everywhere, including
`PLAN_NOT_FOUND`.

---

## Phase 0 — Scaffold ✅ _complete_

`0f8583e`. Four packages, green suites, the repo's standard shape.

| Package    | State                                                                      |
| ---------- | -------------------------------------------------------------------------- |
| `contract` | `Conversation`/`Message`, the error taxonomy, zod schemas, `ROUTES.health` |
| `agent`    | The `ModelProvider` seam and the scripted provider behind it               |
| `api`      | Fastify, SQLite with numbered migrations, config, logging, `/api/health`   |
| `web`      | The app shell and a health call — no intake UI                             |

The `contract` row is history in the strict sense — none of it is still there.
The brief and the intake replaced `Conversation` and `Message`, migration 3
dropped the tables under them, and
[pl-11](./work/pl-11-retire-the-conversation-vocabulary.md) deleted the types,
the schemas and `CONVERSATION_NOT_FOUND` themselves. Migrations 1 and 3 both
remain in the file: an applied migration is not edited.

Two decisions from Phase 0 survive the domain landing, and are not up for
revisiting casually:

- **No vendor above the seam.** `ModelProvider` is the only way to a model, and
  `createModelProvider` in `api/src/server.ts` is the only place that knows a
  backend by name. Grounding now gets the same treatment. The seam was named
  `ChatProvider` until [pl-8](./work/pl-8-model-provider-seam.md) renamed it; the
  decision it encodes is unchanged.
- **The scripted provider is the default and reports itself by name** in
  `/api/health`. A fresh clone runs with no key and no bill; CI has something
  deterministic to assert against; nobody can mistake it for a model.

The third Phase 0 decision — _the conversation is the only modelled domain_ — has
expired twice over. The brief, the candidate and the plan are what Phases 2 and 3
add; and the conversation itself is gone, not merely joined.

## Phase 1 — The intake produces a brief

The whole intake, and no model anywhere in it. Three pieces in the order the code
forces:

1. **The contract for a brief** ✅ — `TripBrief`, `TripShape`, the three-state slot,
   and `missingRequiredSlots` as a function. Contract-first because four packages
   depend on it. → [pl-3](./work/pl-3-trip-brief-contract.md)
2. **The tree and the engine over it** ✅ — an authored, versioned question tree,
   what it opens, and what an edit discards. Pure: no model, no network, no
   clock. → [pl-6](./work/pl-6-question-tree-and-engine.md)
3. **Persistence and the wizard** ✅ — answers stored one per row, an intake that
   survives a reload, a UI that never silently drops an answer, and a stop at the
   core questions. → [pl-7](./work/pl-7-intake-persistence-and-wizard.md)

This phase is worth more than it looks. It is the only one that ships something a
user can hold without a model being involved at all, and it is the phase whose
output every later phase is tested from.

**The wizard stops when the core questions are done** — decided 2026-08-14, see
_Still open_ below. In this phase there is nothing to draft yet, so the stop is a
milestone and an exit; the fork gains its other half in Phase 2.

## Phase 2 — The first plan

The three pieces that turn a brief into a document, in the order the code forces:

1. **The contract for a plan** — `Candidate`, `Plan`, `PlanRevision`, `PlanDay`,
   `PlanItem`, provenance, `pinned`. Contract-first because four packages depend
   on it. → [pl-4](./work/pl-4-plan-document-contract.md), amended by
   [pl-15](./work/pl-15-candidate-legs.md), which made a candidate either `at` a
   place or `between` two so a leg's endpoints stop living in its prose.
2. **The orchestrator and the fan-out** — roster as a pure function of the brief,
   specialists in parallel, each returning candidates and never a schedule, the
   run as a job with real progress. → [pl-5](./work/pl-5-orchestrator-and-fan-out.md)
3. **The composer and the critic** ✅ — the `itinerary` package: packing days
   under hours, season, budget and effort, an adversarial feasibility pass over
   the result, and a list of every constraint it could not evaluate. Ordinary
   TypeScript, ordinary unit tests, no model.
   → [pl-9](./work/pl-9-composer-and-critic.md)
4. **The plan, read honestly** — the days, the gaps, and which lines were
   verified rather than asserted. Costs as bands, and a plan that admits what it
   could not check. → [pl-10](./work/pl-10-plan-view-and-provenance.md)

pl-9 depends only on pl-4, not on pl-5: the candidate sets are checked in, so the
composer can be built and tested with no fan-out and no model. It and pl-5 can
run in parallel.

All of Phase 2 runs against the scripted provider and no grounding. That is
deliberate: it makes the first plan a claim about the machinery — roster,
fan-out, packing, feasibility, persistence — rather than about a model. **It also
costs Phase 2 travel time**, decided 2026-08-16 and recorded below.

## Phase 3 — Grounding behind a seam

`GroundingProvider` with a fixture default, then one real backend. Distances and
travel times first, opening hours and seasons second, existence third, prices
last and always as bands (§5). Provenance on every item; the cache table; the
SSRF guard lifted to `packages/core` as the second real consumer claims it.

## Phase 4 — Revision is the product

Pin an item, name the days a re-plan may touch, re-run a slice with two
specialists instead of the fleet, and show a diff (§6). Everything before this
produces a first draft; this is what makes the tool worth returning to.

**Every one of those is an operation on the document, and that is the whole
interface** — §6's amendment. A revision names what it may touch, so a re-plan
reads the brief, the pinned items and its slice and never a history: the cost of
revising does not grow with how many revisions came before. A free-text note may
ride along on a revision for the specialists to read as context; it is never an
instruction to the composer.

## Later, and not soon

Exports (PDF, calendar, share link), several people editing one plan, accounts.
None of them changes the shape above, which is why they are not in it.

**Permanently out of scope:** booking and payments, and any claim to be a safety
authority for backcountry, marine or winter motorised travel. The reasons are in
§8 and they are not cost-driven, so a cheaper way to do them is not an argument.

---

## Milestones

- **P1 — It produces a brief.** Answer the questions, be told the essentials are
  done and allowed to stop there, change an earlier answer and be told exactly
  what that discards, reload the page and find the intake where you left it.
  **No model is involved**, so it is a claim about the tree, the invalidation
  rules and persistence — and it is checkable without a key.
- **P2 — It produces a plan.** A brief chooses a roster, specialists return
  candidates, the composer packs days that survive **the constraints it can
  evaluate** — hours, season, budget, effort, booking deadlines — and the plan
  names every constraint it could not, travel time first among them. Still
  scripted and ungrounded: a claim about machinery, and a narrower claim than
  this line made before 2026-08-16.
- **P3 — The plan is true.** Grounded facts with provenance, against a real model,
  with the run's bill bounded.
- **P4 — The plan is revisable.** Pin, re-plan a slice, read the diff.

## Still open

Short, and each one is a real decision someone has to make rather than a gap:

- **Which grounding backend first.** §5 ranks what to buy; it does not pick a
  vendor. Whichever it is, the fixtures come from its real payloads.
- **Whether a specialist streams.** The chat seam does not stream, and adding it
  before a caller needs it was deferred once already. The fan-out's progress is
  per-specialist, which may be enough.

**Whether Phase 2's composer can pack under travel time at all** was answered on
2026-08-16, and the answer is **no — pack without it and name the gap.** The
question was raised by pl-4 and is the one that shaped pl-9: §5 ranks distances
and travel times as the first thing grounding buys, Phase 2 has no grounding,
and `Place.coordinates` is null until Phase 3, so there was nothing to compute a
leg from. The alternatives were a straight-line floor from coordinates —
coordinates are themselves grounding, so that is Phase 3 wearing a hat — and
pulling travel-time grounding forward, which buys the most and costs the
cleanliness of "Phase 2 is a claim about machinery, not about a model".

Three consequences, all landed in [pl-9](./work/pl-9-composer-and-critic.md):

- **P2's milestone is narrower**, and the wording above changed with it. "Days
  that survive their own constraints" was claiming more than the composer
  checks; it now says which constraints, and that the rest are named.
- **Every plan carries the list**, as `UNCHECKED_CONSTRAINTS` on the composer's
  result — travel time always, and beside it opening hours, deal-breakers,
  daily distance, machine range and the rest. A plan looks equally finished
  whether every constraint was enforced or three were skipped for want of data,
  which is what makes silence about it the most consequential lie this package
  could tell.
- **The list does not persist**, and that is a known limit rather than an
  oversight. Every `PlanGapReason` is about a specialist, and "we could not
  check travel time" is not — route-and-logistics ran perfectly. Putting it on
  the revision needs a contract change; pl-9's log has the argument.

**What a tree version change does to a saved intake** was answered on 2026-08-15,
as pl-7 proposed: **re-run the engine against the current tree and prune what no
longer fits.** No historical tree is kept, and it is one code path rather than a
second — the same `prune` every other invalidation goes through, plus a
re-validation of each surviving answer against the question it answers, since a
tightened bound would otherwise surface as an `INTERNAL` on a plain read.

Three consequences, recorded where the code is in
[pl-7](./work/pl-7-intake-persistence-and-wizard.md)'s log:

- Re-validating is scoped to a version move, never to every read. `validateAnswer`
  knows what day it is, so running it on every load would discard a departure date
  for the crime of the date arriving.
- What was dropped is reported in the response for the request that reconciled,
  and `updated_at` does not move for it: the tree moved, nobody touched the intake.
- An answer whose question is gone has no prompt to name it by, so the UI says
  "some earlier answers no longer apply" and never prints an id.

**When the first draft is offered** was answered on 2026-08-14, and it is the one
that shapes Phase 1: **the wizard stops at the core questions.** When nothing
`core` is unanswered it says so and offers two ways on — take the draft, or keep
refining — rather than marching to the end of the tree. §3's "draft early,
interview less", made into behaviour rather than left as a marking.

Three consequences, all of them load-bearing on tickets nobody has started:

- `missingRequiredSlots` (pl-3) and the `core` marking (pl-6) describe the same
  set, and `validateTree` fails the tree in either direction if they stop doing
  so. Both halves are settled as of pl-7: the wizard stops there too.
- pl-7 owns the fork, and owns **re-entry**: refining is something you come back
  to after a draft exists, not a corridor you leave once. It also owns the honest
  progress line at the boundary — "the essentials are done", never a percentage.
- pl-5's specialists must tolerate a brief whose `refine` slots are unknown. That
  is not new work: a declined slot is already unknown to them, and the
  three-state slot from pl-3 is what makes the two indistinguishable downstream.

The **transcript strategy**, open since Phase 0, is closed rather than answered:
there is no transcript. Specialists were always going to read the brief and never
the conversation, and now there is no conversation to be tempted by. What
replaces it as the cost control is the per-run budget in §9.

Later phases have no ticket files yet, on purpose. A brief written three phases
ahead is fiction, and this format keeps briefs and outcomes in the same file
precisely so nobody has to reconcile a stale one.

---

Work is tracked as one file per ticket in [work/](./work/) — see
[docs/01-TICKETS.md](../../../docs/01-TICKETS.md) for the format. Current state
is in [03-STATUS.md](./03-STATUS.md).
