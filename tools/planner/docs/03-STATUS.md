# Status — planner

Where the planner stands. Phases live in [02-ROADMAP.md](./02-ROADMAP.md); what
each piece of work did lives in its ticket under [work/](./work/).

**Last updated:** 2026-08-14 · **Phase 0 (scaffold) ✅ · nothing else started**

---

## Where things stand

| Phase              | State       | Evidence  |
| ------------------ | ----------- | --------- |
| Phase 0 — Scaffold | ✅ complete | `0f8583e` |

**19 tests pass across 4 files.** `npm run check` is green. The repo-wide CI
runs the suite on every push; the planner has no slow gates of its own yet, so
there is no `.github/workflows/planner.yml`.

What exists: the contract's conversation types and error taxonomy, the
`ChatProvider` seam with the scripted provider behind it, an API that opens
SQLite and answers `/api/health`, and a web shell that calls it. What does not
exist: any route that carries a conversation, any conversation UI, any real
provider, and any model of a trip.

## Open tickets

| Ticket                                   | Status | Note                                         |
| ---------------------------------------- | ------ | -------------------------------------------- |
| [pl-1](./work/pl-1-conversation-loop.md) | ready  | The smallest thing that makes the tool exist |

## Known gaps and risks

**The transcript is unbounded.** `MAX_MESSAGE_CHARS` caps a single turn. Nothing
caps the conversation, and every stored turn is re-sent on the next one, so this
must be answered before the tool is pointed at a metered provider.

**A model reply is untrusted input.** It reaches SQL, the UI and any tool the
agent is later given. Validate against a schema from `@planner/contract` before
acting on it — `AGENT_MALFORMED_REPLY` is the code for when it does not fit.
Nothing consumes a reply yet, so nothing enforces this yet either.

**The `AGENT_*` error codes are the planner's, provisionally.** They belong in
`@webtools/core` the day a second tool talks to a model.

**The domain is undesigned on purpose.** Conversations persist; trips do not
exist. Do not add a table, type or schema for one without the design landing
first.

## Running things

```bash
npm run dev:planner            # API (8090) + web (5183), both in watch mode
npm run dev:planner:api        # just the API
npm run dev:planner:web        # just the UI
npm test -- --project planner
npm run check
```

Ports are 8090/5183 rather than 8080/5173 so both tools can run at once.
