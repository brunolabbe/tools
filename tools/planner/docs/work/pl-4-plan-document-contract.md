---
id: pl-4
tool: planner
title: The plan document — candidates, days, revisions, pinning
kind: work-package
status: ready
milestone: P2
depends_on: [pl-3]
---

# pl-4 — The plan document — candidates, days, revisions, pinning

**Packages:** `contract` (and the migration in `api`)

## Why

A plan is a long-lived, revisable document, and revising it is the product
([00-ANALYSIS.md §6](../00-ANALYSIS.md)). That is only possible if the plan is
structured data with pinning and provenance — a markdown blob can be regenerated
but not amended, cannot say which of its lines were verified, and produces an
unreadable diff.

Contract-first, and on its own, because `agent`, `itinerary`, `api` and `web` all
depend on this shape and pl-5 cannot start without it.

## Build

1. **`Candidate`** — what a specialist returns and the only thing it returns:
   what and where, duration, cost band (not a price), season window, booking lead
   time, the specialist that proposed it, and its `sources`. **Nothing about which
   day it falls on** — that seam is what stops two specialists writing two
   itineraries (§4).
2. **`Provenance`** — source URL and fetch time for a grounded fact, and an
   explicit marker for "the model asserted this". Model-asserted is the default
   until Phase 4 exists, and the UI must be able to say so; that is the honest
   answer to prices being wrong (§5).
3. **`Plan`, `PlanRevision`, `PlanDay`, `PlanItem`.** Revisions **append** — a
   revision is never overwritten, so the plan the user liked is always
   retrievable. An item carries `pinned` and points at the candidate it came from.
4. **Keep the settled vocabulary.** A **trip** is the journey — `TripBrief`,
   `TripShape`. A **plan** is the document this tool keeps about it, so the
   aggregate, its tables, its routes and `PLAN_NOT_FOUND` all say plan. The rename
   from `TRIP_NOT_FOUND` already landed with the design; do not reintroduce
   `Trip` for the document.
5. **Error codes the design needs**, if the review agrees they are right: a brief
   that cannot support a draft, a plan whose constraints cannot be satisfied, a
   revision not found. Propose them in the ticket log before adding — the repo's
   rule is that a code nobody agreed on is not invented locally, and
   `PLAN_INFEASIBLE` in particular is a user-facing promise about what the tool
   checked.
6. **The migration**, in `api`'s existing numbered sequence: plans, revisions,
   days, items, and the brief link. Index what the UI lists by.
7. **Fixtures.** Check in one brief and one candidate set per trip shape under
   `test/fixtures/`. pl-5 and the `itinerary` package are both specified against
   these, so they are part of this ticket's deliverable rather than an afterthought.

## Done when

- The types and schemas exist with `satisfies z.ZodType<T>` throughout, the
  migration applies to an existing database, and the fixtures are checked in.
- A test proves a revision can be added without mutating its predecessor, and
  that a pinned item round-trips.
- The `Trip`/`Plan` naming is consistent across contract, errors and messages,
  and the log says which was chosen and why.
- No composing, no fan-out, no prompts. This ticket adds no runtime logic.

## Log

_Not started._
