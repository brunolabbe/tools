---
id: pl-11
tool: planner
title: Retire the conversation vocabulary, and name an unknown endpoint properly
kind: chore
status: ready
milestone: null
depends_on: [pl-7]
---

# pl-11 — The conversation is gone; its vocabulary is not

**Packages:** `contract`, `api`, and one addition to `@webtools/core`.

## Why

The tool stopped being a chat on 2026-08-14, and
[pl-7](./pl-7-intake-persistence-and-wizard.md)'s migration 3 dropped the
`conversations` and `messages` tables. What survived them is the vocabulary:

| Still exported                                                    | Where                          |
| ----------------------------------------------------------------- | ------------------------------ |
| `Conversation`, `ConversationDetail`, `Message`, `MessageRole`    | `contract/src/conversation.ts` |
| `conversationSchema`, `conversationDetailSchema`, `messageSchema` | `contract/src/api.ts`          |
| `MAX_MESSAGE_CHARS`                                               | `contract/src/api.ts`          |
| `CONVERSATION_NOT_FOUND`                                          | `contract/src/errors.ts`       |

A zod schema for a table that does not exist is not dead weight, it is a claim:
the next reader has to prove it is stale before ignoring it, and
03-STATUS has been carrying "next to go" across three tickets while nobody owns
it. **Nothing outside the contract references any of it** — checked as of pl-7,
`contract/src/conversation.ts` and `contract/src/api.ts` are the only two files —
so the removal is contained. pl-7 left it alone on purpose: removing a code is a
contract change rather than an addition, and it should not ride along inside a
feature ticket.

**What kept deferring it is real, and it is not the deletion.**
`registerNotFoundHandler` in `api/src/server.ts` raises `CONVERSATION_NOT_FOUND`
for an unknown URL — a code about a missing document, used to describe a missing
route. Delete it and every 404-on-a-typo needs something else to be.

## The decision this ticket carries

**There is no code for "no such endpoint", and there should be one in
`@webtools/core`.**

The downloader does the same thing: `api/src/server.ts:300` raises
`JOB_NOT_FOUND` with the message "No such endpoint." Two tools, independently,
reached for the nearest domain code and re-worded it — which is the repo's rule
for lifting, met exactly: shared code moves to `packages/` **on the second real
consumer**, and this is the second. The root `CLAUDE.md` decides the home
without needing an ADR: a code describing _the transport_ belongs to core, and an
unrecognised route is as transport as it gets.

## Build

1. **`NOT_FOUND` in `CORE_ERROR_CODES`**, under _Input / reachability_, with a
   message in `CORE_ERROR_MESSAGES` that is about a route and not about a
   document — "That endpoint does not exist." Not retryable. Both tools will stop
   compiling until each catalog carries a message for it, which is the
   `satisfies ErrorCatalog` check doing its job rather than something to work
   around.
2. **Map it to 404** in `tools/planner/api/src/http-errors.ts`, and use it in
   `registerNotFoundHandler`. The `details.path` slice already there stays.
3. **Delete `contract/src/conversation.ts`** and its line in `contract/src/index.ts`.
4. **Delete the three schemas and `MAX_MESSAGE_CHARS`** from `contract/src/api.ts`,
   and the imports that go with them.
5. **Delete `CONVERSATION_NOT_FOUND`** from `PLANNER_ERROR_CODES` and
   `DEFAULT_ERROR_MESSAGES`.
6. **The downloader's half is not this ticket.** `JOB_NOT_FOUND` for an unknown
   endpoint is the same bug in `tools/downloader/api/src/server.ts`, and a planner
   ticket must not reach into another tool. Raise a `dl-` ticket for it — the core
   code this one adds is what that one needs, and the two are otherwise unrelated.

## Done when

- `grep -rn "Conversation\|MAX_MESSAGE_CHARS" tools/planner --include=*.ts` finds
  nothing outside a doc or a log.
- `GET /api/nope` answers 404 with `NOT_FOUND`, and the existing assertion in
  `api/test/health.test.ts` — which currently asserts `CONVERSATION_NOT_FOUND` —
  says so instead.
- `npm run check` and `npm test` are green, downloader included: core is shared,
  so a message missing from either catalog fails the build.

## Traps

**A client bundle older than the server cannot parse a code it has never heard
of.** `errorPayloadSchema` is `z.enum(ERROR_CODES)`, so a stale tab receiving
`NOT_FOUND` falls back to the generic "The API answered 404." That is the correct
degradation and it needs no work — but it is worth knowing before someone reads
it as a bug. Both tools deploy their UI same-origin with their API, so the window
is a page that was already open.

**Do not widen this into "tidy the taxonomy".** `AGENT_*` staying planner-local
until a second tool talks to a model is a decision already recorded in
`contract/src/errors.ts`, and it is not this ticket's to revisit.

## Log

_Not started._
