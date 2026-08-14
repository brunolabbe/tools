# Roadmap — planner

Describe a vacation — a road trip, a hiking weekend, a skidoo ride up north, a
slow week of history in Europe — get interviewed about it, have the specialists
that trip actually needs work on it, and keep the plan.

Two claims carry the whole plan, both argued in [00-ANALYSIS.md](./00-ANALYSIS.md):

- **The roster is data.** Which questions matter and which specialists a plan
  needs are a function of the trip's shape, decided at runtime (§1, §4).
- **Models generate candidates; code schedules and checks.** Drive times, day
  packing, budgets and opening hours are arithmetic, and arithmetic is where AI
  itineraries embarrass themselves (§2).

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
| `agent`    | The `ChatProvider` seam and the scripted provider behind it                |
| `api`      | Fastify, SQLite with numbered migrations, config, logging, `/api/health`   |
| `web`      | The app shell and a health call — no conversation UI yet                   |

Two decisions from Phase 0 survive the domain landing, and are not up for
revisiting casually:

- **No vendor above the seam.** `ChatProvider` is the only way to a model, and
  `createChatProvider` in `api/src/server.ts` is the only place that knows a
  backend by name. Grounding now gets the same treatment.
- **The scripted provider is the default and reports itself by name** in
  `/api/health`. A fresh clone runs with no key and no bill; CI has something
  deterministic to assert against; nobody can mistake it for a model.

The third Phase 0 decision — _the conversation is the only modelled domain_ — has
now expired on purpose. The brief, the candidate and the plan are what Phases 2
and 3 add, and they are designed rather than guessed.

## Phase 1 — It holds a conversation

The routes, the store and the transcript UI. Nothing here models a trip; it is
the loop everything later plugs into.
→ [pl-1](./work/pl-1-conversation-loop.md)

## Phase 2 — The interview produces a brief

A `TripBrief` in the contract, and an interviewer that fills it: a small fixed
core, then branch on trip shape, completeness measured against the schema rather
than asked about (§3). The brief is the only thing specialists ever see, which is
what makes everything after this testable from a fixture.
→ [pl-3](./work/pl-3-trip-brief-and-interview.md)

## Phase 3 — The first plan

The three pieces that turn a brief into a document, in the order the code forces:

1. **The contract for a plan** — `Candidate`, `Plan`, `PlanRevision`, `PlanDay`,
   `PlanItem`, provenance, `pinned`. Contract-first because four packages depend
   on it. → [pl-4](./work/pl-4-plan-document-contract.md)
2. **The orchestrator and the fan-out** — roster as a pure function of the brief,
   specialists in parallel, each returning candidates and never a schedule, the
   run as a job with real progress. → [pl-5](./work/pl-5-orchestrator-and-fan-out.md)
3. **The composer and the critic** — the `itinerary` package: packing days under
   travel time, hours, season and budget, and an adversarial feasibility pass over
   the result. Ordinary TypeScript, ordinary unit tests, no model.

All of Phase 3 runs against the scripted provider and no grounding. That is
deliberate: it makes the first plan a claim about the machinery — roster,
fan-out, packing, feasibility, persistence — rather than about a model.

## Phase 4 — Grounding behind a seam

`GroundingProvider` with a fixture default, then one real backend. Distances and
travel times first, opening hours and seasons second, existence third, prices
last and always as bands (§5). Provenance on every item; the cache table; the
SSRF guard lifted to `packages/core` as the second real consumer claims it.

## Phase 5 — Revision is the product

Pin an item, name the days a re-plan may touch, re-run a slice with two
specialists instead of the fleet, and show a diff (§6). Everything before this
produces a first draft; this is what makes the tool worth returning to.

## Later, and not soon

Exports (PDF, calendar, share link), several people editing one plan, accounts.
None of them changes the shape above, which is why they are not in it.

**Permanently out of scope:** booking and payments, and any claim to be a safety
authority for backcountry, marine or winter motorised travel. The reasons are in
§8 and they are not cost-driven, so a cheaper way to do them is not an argument.

---

## Milestones

- **P1 — It holds a conversation.** Describe a trip, get a reply, reload the
  page, transcript intact. Scripted provider, so it is a claim about persistence.
- **P2 — It produces a plan.** An interview fills a brief, a roster is chosen
  from it, specialists return candidates, the composer packs days that survive
  their own constraints. Still scripted and ungrounded: a claim about machinery.
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
- **The transcript strategy.** Still unanswered from Phase 0, and now sharper:
  the brief and the plan are the real state, so older turns can be summarised
  harder than a general chat could risk. Needed before a metered provider.

Later phases have no ticket files yet, on purpose. A brief written three phases
ahead is fiction, and this format keeps briefs and outcomes in the same file
precisely so nobody has to reconcile a stale one.

---

Work is tracked as one file per ticket in [work/](./work/) — see
[docs/01-TICKETS.md](../../../docs/01-TICKETS.md) for the format. Current state
is in [03-STATUS.md](./03-STATUS.md).
