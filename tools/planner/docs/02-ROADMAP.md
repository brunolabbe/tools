# Roadmap — planner

A trip planner: describe where you want to go, talk it through with an
assistant, and keep the resulting plan.

The interesting problem is not the chat. It is that **a plan is a long-lived,
revisable document** built over several sessions, so the conversation has to be
persisted, replayed and summarised rather than held in a request. Everything
below follows from that.

This roadmap is deliberately shorter than the downloader's. The domain beyond
the conversation is still being designed, and a phase table written for an
itinerary model nobody has agreed on would be fiction. What is written here is
what the code already commits to; what is not written here is not yet decided.

---

## Phase 0 — Scaffold ✅ _complete_

`0f8583e`. The four packages exist, `npm run check` and the suites are green,
and the shape is the repo's standard one.

| Package    | State                                                                      |
| ---------- | -------------------------------------------------------------------------- |
| `contract` | `Conversation`/`Message`, the error taxonomy, zod schemas, `ROUTES.health` |
| `agent`    | The `ChatProvider` seam and the scripted provider behind it                |
| `api`      | Fastify, SQLite with numbered migrations, config, logging, `/api/health`   |
| `web`      | The app shell and a health call — no conversation UI yet                   |

Three decisions from Phase 0 are load-bearing and are not up for revisiting
casually:

- **The conversation is the only modelled domain.** No table, type or schema
  describes a trip, an itinerary or a booking. Guessing one now buys a migration
  to undo rather than a head start.
- **No vendor above the seam.** `ChatProvider` is the only way to a model, and
  `createChatProvider` in `api/src/server.ts` is the only place that knows a
  backend by name.
- **The scripted provider is the default and reports itself by name** in
  `/api/health`. A fresh clone runs with no key and no bill, CI has something
  deterministic to assert against, and nobody can mistake it for a model.

## What comes next

Not scheduled, and listed in the order the code forces rather than in an order
anyone has picked. Each is a consequence of something already written down —
none of it extrapolates the domain.

1. **The conversation loop, end to end.** `ROUTES` has one route in it. Creating
   a conversation, appending a turn, getting a reply and rendering the transcript
   is the smallest thing that makes the tool exist.
   → [pl-1](./work/pl-1-conversation-loop.md)
2. **A transcript strategy.** Every stored turn is re-sent on the next turn, so
   an unbounded transcript is an unbounded bill. `MAX_MESSAGE_CHARS` caps one
   turn; nothing yet caps the conversation. This blocks pointing the tool at a
   metered provider, and the tool's `CLAUDE.md` says so.
3. **A real provider behind the seam**, chosen at deployment. The interface is
   the smallest thing that can hold a conversation on purpose — streaming and
   tool use both belong here eventually, and both wait on the loop above them
   existing.
4. **The trip itself.** Itinerary, dates, places, bookings. **Blocked on
   design**, deliberately: ask rather than guessing a shape a later design has
   to unpick.

## Milestones

- **P1 — It holds a conversation.** Describe a trip in the UI, get a reply,
  reload the page, and the transcript is still there. Against the scripted
  provider, so it is a claim about persistence and replay rather than about a
  model.
- **P2 — It holds a conversation against a real model**, with a transcript
  strategy that bounds the bill. Needs 2 and 3 above.

Beyond P2 the milestones depend on the domain design and are not guessed here.

---

Work is tracked as one file per ticket in [work/](./work/) — see
[docs/01-TICKETS.md](../../../docs/01-TICKETS.md) for the format. Current state
is in [03-STATUS.md](./03-STATUS.md).
