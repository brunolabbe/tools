# Status — planner

Where the planner stands. Phases live in [02-ROADMAP.md](./02-ROADMAP.md); what
each piece of work did lives in its ticket under [work/](./work/).

**Last updated:** 2026-08-14 · **Phase 0 (scaffold) ✅ · the intake was
redesigned, and Phase 1's first piece — the `TripBrief` — is the only part of the
domain that is built**

---

## Where things stand

| Phase                            | State         | Evidence                                                                                                                                                                               |
| -------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Scaffold               | ✅ complete   | `0f8583e`                                                                                                                                                                              |
| Phase 1 — The intake             | in flight     | [pl-3](./work/pl-3-trip-brief-contract.md) done — the brief exists; [pl-6](./work/pl-6-question-tree-and-engine.md) and [pl-7](./work/pl-7-intake-persistence-and-wizard.md) unblocked |
| Phase 2 — The first plan         | not started   | [pl-4](./work/pl-4-plan-document-contract.md), [pl-5](./work/pl-5-orchestrator-and-fan-out.md)                                                                                         |
| Phases 3–4 — Grounding, revision | designed only | no tickets yet, on purpose                                                                                                                                                             |

**The tool is not a chat, as of 2026-08-14.** It was scaffolded as one. The
intake now asks predetermined questions from an authored, versioned tree, and no
model participates in it — a model is involved later, in the fan-out. The
reasoning, including what the decision costs, is an amendment to
[00-ANALYSIS.md §3](./00-ANALYSIS.md), which had argued the opposite; the
argument was kept and overridden rather than rewritten.
[pl-1](./work/pl-1-conversation-loop.md) was dropped without being started.

**37 tests pass across 5 files.** `npm run check` is green. The repo-wide CI runs
the suite on every push, and `.github/workflows/planner.yml` builds this tool's
image and waits for it to report healthy — path-filtered, so downloader work does
not pay for it.

What exists: the error taxonomy, the `TripBrief` and its schemas, the
`ModelProvider` seam with the scripted provider behind it, an API that opens
SQLite and answers `/api/health`, a web shell that calls it, and a container
image the release pipeline publishes.

What does not exist: the question tree, the `intake` package, any intake route
or UI, the plan document, the roster, a single specialist, the `itinerary`
package, grounding of any kind, and any hostname pointing at the image.

What exists but is **wrong for the current design**, and is scheduled to be
replaced rather than extended: the contract's `Conversation` / `Message` types
and the `conversations` / `messages` tables from migration 1. They go with
migration 2 in [pl-7](./work/pl-7-intake-persistence-and-wizard.md), which is why
[pl-8](./work/pl-8-model-provider-seam.md) renamed the model seam and left them
alone — a rename cannot carry a migration.

**The documentation leads the code by four phases**, which is the intended state
after a design pass and a liability if it lasts. Read
[00-ANALYSIS.md](./00-ANALYSIS.md) and
[01-ARCHITECTURE.md](./01-ARCHITECTURE.md) as _design_, not as description.

## Open tickets

| Ticket                                               | Status    | Note                                                     |
| ---------------------------------------------------- | --------- | -------------------------------------------------------- |
| [pl-1](./work/pl-1-conversation-loop.md)             | dropped   | The chat premise. Read the log before rebuilding it      |
| [pl-2](./work/pl-2-container-image.md)               | in-flight | Image and release component landed; no subdomain yet     |
| [pl-3](./work/pl-3-trip-brief-contract.md)           | done      | The brief, its slots and `missingRequiredSlots` are in   |
| [pl-4](./work/pl-4-plan-document-contract.md)        | ready     | Contract-first; pl-5 cannot start without it             |
| [pl-5](./work/pl-5-orchestrator-and-fan-out.md)      | ready     | The roster is a table, not conditionals                  |
| [pl-6](./work/pl-6-question-tree-and-engine.md)      | ready     | The tree and the invalidation engine. The hard part      |
| [pl-7](./work/pl-7-intake-persistence-and-wizard.md) | ready     | Persistence, routes, and the wizard over them            |
| [pl-8](./work/pl-8-model-provider-seam.md)           | done      | The seam is `ModelProvider`; the env is `MODEL_PROVIDER` |

## Known gaps and risks

**Answer invalidation is the new hard problem, and nothing implements it.**
Change an early answer and every answer below an abandoned branch stops being an
answer to anything. It does not throw — it leaves the store holding
contradictions that surface later as a plan built from a trip nobody described.
See [pl-6](./work/pl-6-question-tree-and-engine.md).

**The `itinerary` package does not exist**, and it is where the design says the
plan is actually decided — day packing, travel time, budget sums, opening-hour
conflicts. Until it does, there is nothing to stop a model being asked to do
arithmetic, which is the failure the analysis is mostly about.

**The `intake` package does not exist either**, so nothing yet _fills_ a
`TripBrief` — the shape is in the contract as of pl-3, but the tree that answers
into it is pl-6, and until that lands nothing produces the input every later
phase is tested from.

**`REQUIRED_SHAPE_SLOTS` and the tree's `core` marking can still disagree**,
because the tree does not exist. The contract half of the checkpoint is in
(`missingRequiredSlots`, and a table typed so a renamed slot breaks it); the test
that the two describe the same set, in both directions, is owed by
[pl-6](./work/pl-6-question-tree-and-engine.md). Until it exists, the wizard's
"the essentials are done" is a promise nothing enforces.

**A model reply is untrusted input**, and from Phase 3 a grounded source is
hostile text. Validate against a schema from `@planner/contract` before acting;
`AGENT_MALFORMED_REPLY` is the code. Nothing consumes a reply yet, so nothing
enforces this yet either.

**The plan run has no budget because it has no run.** The design puts a cap on
specialists, grounding calls and tokens per run, enforced before the fan-out. It
is a cost control and a DoS control at once, and it lands with pl-5 or not at all.

**The transcript risk is gone**, not deferred — there is no transcript, so nothing
is re-sent turn over turn. The per-run budget replaces it as the cost control.
`MAX_MESSAGE_CHARS` is now a constant with no job and should go with migration 2.

**Error codes the design needs are still partly missing** — a plan whose
constraints cannot be satisfied, a revision not found; pl-4 proposes those rather
than adding them silently. pl-3's half is in: `BRIEF_INCOMPLETE` for a brief too
thin to draft from, and a recorded decision that the flexible-date cases need no
code beyond `INVALID_DATES` — same cause, same sentence, different `details`.

`TRIP_NOT_FOUND` is already gone: the vocabulary is settled (a trip is the
journey, a plan is the document) and the code is now `PLAN_NOT_FOUND`. `CONVERSATION_NOT_FOUND` is next
to go, and note it is currently abused by `registerNotFoundHandler` for unknown
URLs — fix that when it is renamed rather than carrying the bug across.

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
