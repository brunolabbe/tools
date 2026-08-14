# CLAUDE.md — planner

Rules for this tool only. The repo-wide conventions are in the root `CLAUDE.md`
and are not repeated here.

## What this is

A trip planner: describe where you want to go and what you like, talk it through
with an assistant, and keep the resulting plan. The interesting problem is not
the chat — it is that a plan is a **long-lived, revisable document** built over
several sessions, so the conversation has to be persisted, replayed and
summarised rather than held in a request.

The domain beyond that is still being designed. Do not invent it: if a piece of
the itinerary model is missing, ask rather than guessing a shape that a later
design has to unpick.

## Layout

```
contract     types, error taxonomy, zod schemas — no logic
agent        the planning agent: prompts, the conversation loop, the provider seam
api          Fastify, persistence, HTTP
web          React + Vite UI
e2e          Playwright specs (empty until there is a flow worth driving)
```

`api` is the only place that reads `process.env`. The agent is a library and
takes its configuration — including which provider to talk to — as arguments.

## Commands

```bash
npm run dev:planner          # API (8090) + web (5183) together, both in watch mode
npm run dev:planner:api      # just the API
npm run dev:planner:web      # just the UI
npm test -- --project planner
```

The ports are 8090/5183 rather than 8080/5173 so both tools can run at once
without either being reconfigured.

The API's dev script is `node --watch --import tsx`, not `tsx watch` — see the
downloader's note; the same Windows failure applies.

## Rules

**No vendor above the seam.** Everything that talks to a model goes through
`ChatProvider` in `agent/src/provider.ts`. Which backend answers is a deployment
decision — a local model over Ollama, a hosted API, or the scripted one — and
`createChatProvider` in `api/src/server.ts` is the only place in the tool that
knows a provider by name.

**Never drive a chat UI with a browser.** Automating a logged-in claude.ai or
ChatGPT session is against those services' terms and breaks on every DOM change.
If cost is the constraint, the answer is a cheaper provider behind the seam, not
a scraper.

**The scripted provider is the default, and it must stay obvious.** It answers
from a fixed script so a fresh clone runs with no key and no bill, and CI has
something deterministic to assert against. `/api/health` reports the provider by
name for exactly this reason — a scripted assistant must never be mistakable for
a real one.

**A model reply is untrusted input.** It reaches SQL, the UI and any tool the
agent is given. Validate it against a schema from `@planner/contract` before
acting on it; `AGENT_MALFORMED_REPLY` is the code for when it does not fit.

**Never send more of a conversation than the user's plan needs.** Every stored
turn is re-sent on the next turn, so an unbounded transcript is an unbounded
bill. `MAX_MESSAGE_CHARS` caps one turn; the transcript itself needs a
summarisation strategy before this ships against a metered provider.

**Never log a provider key.** `logger.ts` censors `apiKey` and the usual auth
headers as a backstop, not as permission to log a config object whole.

**Planner error codes live in `contract/src/errors.ts`**, in
`PLANNER_ERROR_CODES`. The generic half comes from `@webtools/core` — see the
root `CLAUDE.md` for which is which. The `AGENT_*` codes will belong in core the
day a second tool talks to a model; until then they are ours.
