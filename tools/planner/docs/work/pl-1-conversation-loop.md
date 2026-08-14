---
id: pl-1
tool: planner
title: The conversation loop, end to end
kind: work-package
status: ready
milestone: P1
depends_on: []
---

# pl-1 — The conversation loop, end to end

**Packages:** `contract`, `api`, `web` (and the existing seam in `agent`)

## Why

`ROUTES` has exactly one route in it: `health`. Everything else is present —
the tables, the types, the provider seam, the scripted provider — and nothing
connects them. Creating a conversation, appending a turn, getting a reply and
rendering the transcript is the smallest thing that makes this tool exist, and
it is the thing every later decision (a real provider, a transcript strategy,
the trip model) needs somewhere to plug into.

It is scoped to the conversation deliberately. **Nothing here models a trip** —
see [02-ROADMAP.md](../02-ROADMAP.md).

## Build

The contract change comes first and is the part to get agreed before the rest
starts; the root `CLAUDE.md` forbids editing a contract unilaterally, and three
packages depend on this one.

1. **`contract`** — add the routes and their schemas: create a conversation,
   list conversations, fetch one with its turns, append a user turn and get the
   assistant's reply. Write each `satisfies z.ZodType<T>` against the interface
   it mirrors, as `api.ts` already does. `MAX_MESSAGE_CHARS` bounds the turn.
2. **`api`** — a store over the existing tables (the migrations are already
   there), then the routes. The reply path calls the injected `ChatProvider`;
   the route never names a backend. A conversation's `title` is drawn from the
   first user turn, and `updatedAt` moves on every append — the index on it
   exists for the list route.
3. **Validate the reply before it is stored.** A provider's answer is untrusted
   input on its way to SQL and to the UI. `AGENT_MALFORMED_REPLY` is the code.
4. **`web`** — a conversation list, a transcript, a composer. Reloading the page
   must show the same conversation; that is the point of persisting it.
5. Tests at each layer, and against the scripted provider — it exists so this
   can be deterministic without a key or a bill.

**Open question to settle inside this ticket, not after it:** whether the reply
is awaited on the append request or streamed. The seam does not stream today,
and adding streaming to `ChatProvider` before a caller needs it was explicitly
deferred. Await first unless there is a reason not to, and say so in the log.

## Done when

A conversation started in the UI survives a page reload with its turns intact,
the assistant's replies come from the injected provider rather than from
anything the route knows by name, and `npm test -- --project planner` covers the
store, the routes and the reply-validation path.

## Log

_Not started._
