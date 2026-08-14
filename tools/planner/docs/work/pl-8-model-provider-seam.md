---
id: pl-8
tool: planner
title: Rename the chat seam to a model seam
kind: chore
status: in-flight
milestone: null
depends_on: []
---

# pl-8 — Rename the chat seam to a model seam

**Packages:** `agent`, `api` (plus the docs that name the seam)

## Why

The intake stopped being a conversation on 2026-08-14 —
[00-ANALYSIS.md §3](../00-ANALYSIS.md)'s amendment, and
[pl-1](./pl-1-conversation-loop.md) dropped without being started. The design
documents were rewritten that day. The code was not, and the seam every model
call goes through is still called `ChatProvider`.

The seam itself is not the problem and is not going anywhere: Phase 2's
specialists call a model, that call is message-shaped, and
[01-ARCHITECTURE.md](../01-ARCHITECTURE.md) puts grounding behind the same
pattern. What is wrong is the word. `ChatProvider` and its doc comment —
"the smallest thing that can hold a conversation", "not part of the stored
transcript" — describe a premise this tool retired. Anyone reading `agent/`
before reading the amendment concludes the tool chats.

Done now rather than folded into [pl-5](./pl-5-orchestrator-and-fan-out.md)
because it is at its cheapest while the seam has exactly one implementation and
two consumers. Every ticket after this one adds callers.

This is a rename, not a redesign. The interface shape, the scripted default and
the one-place-names-a-vendor rule are all unchanged.

## Build

1. **`agent/src/provider.ts`** — `ChatProvider` → `ModelProvider`, and
   `ChatRequest` · `ChatReply` · `ChatUsage` · `ChatMessage` likewise. Rewrite
   the header comment: the seam is the smallest thing that can carry one model
   call, and the reference to a stored transcript goes with the transcript.
   `messages` stays the field name — a model request carries messages whoever is
   asking, and that is the provider API's shape, not the chat premise.
2. **`agent/src/providers/scripted.ts`** — follow the rename, and drop
   "conversation loop" / "a conversation that dies mid-test" from the comments.
   The default reply says "configure a chat provider"; it should say model.
3. **`api/src/config.ts`** — `CHAT_PROVIDERS` → `MODEL_PROVIDERS`,
   `ChatProviderName` → `ModelProviderName`, `config.chatProvider` →
   `config.modelProvider`, and the env var `CHAT_PROVIDER` → `MODEL_PROVIDER`.
4. **`api/src/context.ts`, `api/src/server.ts`** — `context.chat` →
   `context.model`, `CreateAppOptions.chat` → `model`, `createChatProvider` →
   `createModelProvider`. `MAX_BODY_BYTES`' comment says requests "carry a
   conversation turn"; no request does.
5. **The health response shape does not change.** It already reports
   `agent: { provider, model }` on the wire, which was never chat-flavoured, so
   `web/` and the contract are untouched.
6. **Docs that name the seam** — this tool's `CLAUDE.md`, `00-ANALYSIS.md §5`,
   `01-ARCHITECTURE.md` (prose, the diagram, and the env table),
   `02-ROADMAP.md`, `03-STATUS.md`, and the root `docs/02-DEPLOYMENT.md` where
   `CHAT_PROVIDER` is named twice. `Dockerfile`'s `ENV` line too.
7. **Leave the dropped tickets alone.** [pl-1](./pl-1-conversation-loop.md)
   describes a chat loop that was never built; rewriting its brief to say model
   would make a dropped ticket lie about what was dropped.

## Not in this ticket

The rest of the chat scaffold — `contract/src/conversation.ts`,
`MAX_MESSAGE_CHARS`, `CONVERSATION_NOT_FOUND`, and migration 1's
`conversations` / `messages` tables. Those are deletions with a migration
attached and they belong to [pl-7](./pl-7-intake-persistence-and-wizard.md),
which drops the tables in migration 2. A rename that also deleted the contract's
types would collide with it.

## Done when

No identifier in `tools/planner/**/src` contains `Chat`; `MODEL_PROVIDER` is the
env var in the config, the Dockerfile and both deployment documents; the health
response is byte-identical to before; and `npm run check` and
`npm test -- --project planner` pass with the suite count unchanged.

## Log

**2026-08-14 — done.**

Renamed as briefed. The seam is `ModelProvider` in
[agent/src/provider.ts](../../agent/src/provider.ts), with `ModelRequest`,
`ModelReply`, `ModelUsage` and `ModelMessage` beside it, and
`createModelProvider` in [api/src/server.ts](../../api/src/server.ts) is still
the only place in the tool that names a backend.

Two things the brief did not anticipate:

**The env var rename is free, and will not be free later.** `CHAT_PROVIDER` is
baked into the published image (`ENV CHAT_PROVIDER=scripted`), so this is
nominally a breaking deployment change. It is not one today: `scripted` is the
only accepted value, it is also the default, and an unknown name falls back to it
rather than throwing — so a deployment still setting `CHAT_PROVIDER=scripted`
gets the identical result from the ignored variable. That stops being true the
day a second provider exists, which is the argument for doing the rename now
rather than with pl-5. No compatibility shim was added, deliberately: reading
both names is a permanent cost paid to avoid a one-line change nobody has made
yet.

**`messages` survived, and should have.** The rename was tempting to push into
`ModelRequest.messages`, and that would have been wrong — a chat-completions
request carries messages regardless of what the product is, so renaming the field
would misdescribe the provider API to make a point about the intake. The comment
saying it was "part of the stored transcript" is what needed to go.

The scripted provider's default reply told the user to "configure a chat
provider". It now says model provider — a user-visible string, and the one place
this rename was more than internal hygiene.

The health response is unchanged: it reports `agent: { provider, model }`, which
was never chat-flavoured, so `web/` and `contract/` were not touched at all.
[pl-1](./pl-1-conversation-loop.md) was left as written, per step 7.
