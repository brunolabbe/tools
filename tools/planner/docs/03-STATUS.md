# Status — planner

Where the planner stands. Phases live in [02-ROADMAP.md](./02-ROADMAP.md); what
each piece of work did lives in its ticket under [work/](./work/).

**Last updated:** 2026-08-14 · **Phase 0 (scaffold) ✅ · the domain is now
designed on paper and unbuilt in code**

---

## Where things stand

| Phase                             | State         | Evidence                                                                                       |
| --------------------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| Phase 0 — Scaffold                | ✅ complete   | `0f8583e`                                                                                      |
| Phase 1 — It holds a conversation | not started   | [pl-1](./work/pl-1-conversation-loop.md)                                                       |
| Phase 2 — The interview and brief | not started   | [pl-3](./work/pl-3-trip-brief-and-interview.md)                                                |
| Phase 3 — The first plan          | not started   | [pl-4](./work/pl-4-plan-document-contract.md), [pl-5](./work/pl-5-orchestrator-and-fan-out.md) |
| Phases 4–5 — Grounding, revision  | designed only | no tickets yet, on purpose                                                                     |

**19 tests pass across 4 files.** `npm run check` is green. The repo-wide CI runs
the suite on every push, and `.github/workflows/planner.yml` builds this tool's
image and waits for it to report healthy — path-filtered, so downloader work does
not pay for it.

What exists: the contract's conversation types and error taxonomy, the
`ChatProvider` seam with the scripted provider behind it, an API that opens SQLite
and answers `/api/health`, a web shell that calls it, and a container image the
release pipeline publishes.

What does not exist: any route that carries a conversation, any conversation UI,
any real provider, the `TripBrief`, the plan document, the roster, a single
specialist, the `itinerary` package, grounding of any kind, and any hostname
pointing at the image.

**The documentation now leads the code by four phases**, which is the intended
state after a design pass and a liability if it lasts: read
[00-ANALYSIS.md](./00-ANALYSIS.md) and
[01-ARCHITECTURE.md](./01-ARCHITECTURE.md) as _design_, not as description.

## Open tickets

| Ticket                                          | Status    | Note                                                 |
| ----------------------------------------------- | --------- | ---------------------------------------------------- |
| [pl-1](./work/pl-1-conversation-loop.md)        | ready     | The smallest thing that makes the tool exist         |
| [pl-2](./work/pl-2-container-image.md)          | in-flight | Image and release component landed; no subdomain yet |
| [pl-3](./work/pl-3-trip-brief-and-interview.md) | ready     | The brief is what makes everything after it testable |
| [pl-4](./work/pl-4-plan-document-contract.md)   | ready     | Contract-first; pl-5 cannot start without it         |
| [pl-5](./work/pl-5-orchestrator-and-fan-out.md) | ready     | The roster is a table, not conditionals              |

## Known gaps and risks

**The `itinerary` package does not exist**, and it is where the design says the
plan is actually decided — day packing, travel time, budget sums, opening-hour
conflicts. Until it does, there is nothing to stop a model being asked to do
arithmetic, which is the failure the analysis is mostly about.

**The transcript is unbounded.** `MAX_MESSAGE_CHARS` caps a single turn; nothing
caps the conversation, and every stored turn is re-sent on the next one. The
fan-out multiplies this by the roster size, so it must be answered before a
metered provider — and specialists must read the brief, never the transcript.

**A model reply is untrusted input**, and from Phase 4 a grounded source is
hostile text. Validate against a schema from `@planner/contract` before acting;
`AGENT_MALFORMED_REPLY` is the code. Nothing consumes a reply yet, so nothing
enforces this yet either.

**The plan run has no budget because it has no run.** The design puts a cap on
specialists, grounding calls and tokens per run, enforced before the fan-out. It
is a cost control and a DoS control at once, and it lands with pl-5 or not at all.

**Error codes the design needs are not in the taxonomy yet** — a brief too thin to
draft, a plan whose constraints cannot be satisfied, a revision not found. pl-4
proposes them rather than adding them silently. `TRIP_NOT_FOUND` is already gone:
the vocabulary is settled (a trip is the journey, a plan is the document) and the
code is now `PLAN_NOT_FOUND`.

**The `AGENT_*` codes are the planner's, provisionally.** They belong in
`@webtools/core` the day a second tool talks to a model.

**The SSRF guard is the downloader's.** The planner becomes its second real
consumer the first time it fetches a URL a search result handed it; that is when
it lifts to `packages/core`, not by copy-paste before then.

## Running things

```bash
npm run dev:planner            # API (8090) + web (5183), both in watch mode
npm run dev:planner:api        # just the API
npm run dev:planner:web        # just the UI
npm test -- --project planner
npm run check
```

Ports are 8090/5183 rather than 8080/5173 so both tools can run at once.
