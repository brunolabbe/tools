# Status — planner

Where the planner stands. Phases live in [02-ROADMAP.md](./02-ROADMAP.md); what
each piece of work did lives in its ticket under [work/](./work/).

**Last updated:** 2026-08-15 · **Phase 0 (scaffold) ✅ · the intake was
redesigned; both domain contracts — the `TripBrief` and the plan document — are
built, and so is the question tree over the brief. Nothing stores an answer and
nothing composes a plan**

---

## Where things stand

| Phase                            | State         | Evidence                                                                                                                                                                                                                        |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Scaffold               | ✅ complete   | `0f8583e`                                                                                                                                                                                                                       |
| Phase 1 — The intake             | in flight     | [pl-3](./work/pl-3-trip-brief-contract.md) and [pl-6](./work/pl-6-question-tree-and-engine.md) done — the brief and the tree exist; [pl-7](./work/pl-7-intake-persistence-and-wizard.md) is all that stands between here and P1 |
| Phase 2 — The first plan         | in flight     | [pl-4](./work/pl-4-plan-document-contract.md) done — the plan document exists; [pl-5](./work/pl-5-orchestrator-and-fan-out.md) and [pl-9](./work/pl-9-composer-and-critic.md) unblocked                                         |
| Phases 3–4 — Grounding, revision | designed only | no tickets yet, on purpose                                                                                                                                                                                                      |

**The tool is not a chat, as of 2026-08-14.** It was scaffolded as one. The
intake now asks predetermined questions from an authored, versioned tree, and no
model participates in it — a model is involved later, in the fan-out. The
reasoning, including what the decision costs, is an amendment to
[00-ANALYSIS.md §3](./00-ANALYSIS.md), which had argued the opposite; the
argument was kept and overridden rather than rewritten.
[pl-1](./work/pl-1-conversation-loop.md) was dropped without being started.

**178 tests pass across 15 files.** `npm run check` is green. The repo-wide CI
runs the suite on every push, and `.github/workflows/planner.yml` builds this
tool's image and waits for it to report healthy — path-filtered, so downloader
work does not pay for it.

What exists: the error taxonomy, the `TripBrief` and its schemas, the question
tree and the engine over it (`@planner/intake` — 36 questions, reachability,
invalidation, brief assembly, answer validation, all pure), the plan document —
`Candidate`, `Provenance`, `Plan`, `PlanRevision`, `PlanDay`, `PlanItem`,
`PlanGap` — and migration 2 behind it, a checked-in brief and candidate set per
trip shape, the `ModelProvider` seam with the scripted provider behind it, an API
that opens SQLite and answers `/api/health`, a web shell that calls it, and a
container image the release pipeline publishes.

What does not exist: **anywhere to put an answer, and nothing that composes a
plan.** The tree can say what to ask and what an edit discards, and nothing
stores either — no `intakes` or `answers` table, no intake route, no wizard. That
is [pl-7](./work/pl-7-intake-persistence-and-wizard.md), and it is the whole
distance to P1. On the other side, the plan document can express a plan and
nothing writes one: no roster, no specialist, no `itinerary` package, no plan
_route_ or UI. Also absent: grounding of any kind, and any hostname pointing at
the image. **Both domain contracts are built, the tree stands over one of them,
and neither is filled by anything** — pl-7 fills the brief, pl-5 and pl-9 fill
the plan.

What exists but is **wrong for the current design**, and is scheduled to be
replaced rather than extended: the contract's `Conversation` / `Message` types
and the `conversations` / `messages` tables from migration 1. They go with
[pl-7](./work/pl-7-intake-persistence-and-wizard.md)'s migration, which is why
[pl-8](./work/pl-8-model-provider-seam.md) renamed the model seam and left them
alone — a rename cannot carry a migration. **pl-4 took migration 2** for the plan
tables and deliberately did not drop them: migrations append, so pl-7's becomes
migration 3, and a migration doing half of pl-7's job would be worse than
leaving them a little longer.

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
| [pl-4](./work/pl-4-plan-document-contract.md)        | done      | The plan document, migration 2, and pl-5's fixtures      |
| [pl-5](./work/pl-5-orchestrator-and-fan-out.md)      | ready     | The roster is a table, not conditionals                  |
| [pl-6](./work/pl-6-question-tree-and-engine.md)      | done      | `@planner/intake`: the tree, reachability, invalidation  |
| [pl-7](./work/pl-7-intake-persistence-and-wizard.md) | ready     | Persistence, routes, and the wizard over them            |
| [pl-8](./work/pl-8-model-provider-seam.md)           | done      | The seam is `ModelProvider`; the env is `MODEL_PROVIDER` |
| [pl-9](./work/pl-9-composer-and-critic.md)           | ready     | The `itinerary` package. Needs only pl-4, so start now   |
| [pl-10](./work/pl-10-plan-view-and-provenance.md)    | ready     | Renders the plan, its gaps and what was verified         |

## Known gaps and risks

**Answer invalidation is implemented and nothing calls it yet.** `prune` says
exactly which answers a change strands, and returns them rather than acting, so
the wizard can warn before anything is lost. Until pl-7 runs it _in the same
transaction as the write_, a crash between the two still leaves an intake
holding answers to questions nobody would ask — the failure is now one caller
away rather than unaddressed.

**Nothing enforces the plan's constraints, because nothing composes a plan.**
The document can now _express_ the honest answers — a `PlanGap` for a section
that could not be covered, `null` for a season nobody established, a cost band
rather than a price — but expressing them is not producing them. Until pl-5 and
the composer land, every one of those is a shape with no writer.

**The `itinerary` package does not exist**, and it is where the design says the
plan is actually decided — day packing, budget sums, opening-hour conflicts.
Until it does, there is nothing to stop a model being asked to do arithmetic,
which is the failure the analysis is mostly about. It is now ticketed as
[pl-9](./work/pl-9-composer-and-critic.md), which depends only on pl-4 and can
start immediately.

**Phase 2 cannot pack under travel time, and that is undecided rather than
missed.** `Place.coordinates` is null until grounding, and §5 puts distances in
Phase 3 — so the composer can pack under hours, season, budget and effort, and
not under legs. Travel time is §2's failure 1, so this narrows what the P2
milestone may claim. The options are laid out in the roadmap's _Still open_;
nobody has chosen.

**`REQUIRED_SHAPE_SLOTS` and the tree's `core` marking now agree, and a test
says so in both directions** — a `core` question whose slot is not required, or
a required slot no `core` question fills, fails `validateTree`. The checkpoint
is enforced rather than promised. What is still owed is the other end of it: no
UI has yet been told to stop there.

**A model reply is untrusted input**, and from Phase 3 a grounded source is
hostile text. Validate against a schema from `@planner/contract` before acting;
`AGENT_MALFORMED_REPLY` is the code. Nothing consumes a reply yet, so nothing
enforces this yet either.

**The plan run has no budget because it has no run.** The design puts a cap on
specialists, grounding calls and tokens per run, enforced before the fan-out. It
is a cost control and a DoS control at once, and it lands with pl-5 or not at all.

**The transcript risk is gone**, not deferred — there is no transcript, so nothing
is re-sent turn over turn. The per-run budget replaces it as the cost control.
`MAX_MESSAGE_CHARS` is now a constant with no job. It should go with the
`Conversation` / `Message` types it bounds, which is
[pl-7](./work/pl-7-intake-persistence-and-wizard.md)'s migration — **not**
migration 2, which pl-4 took for the plan tables and which deliberately left
migration 1 alone.

**The error codes the design needs are all in.** pl-3 added `BRIEF_INCOMPLETE`
and recorded that the flexible-date cases need no code beyond `INVALID_DATES` —
same cause, same sentence, different `details`. pl-6 added `INVALID_ANSWER`, for
a single answer that does not fit its question on its way in, mapped to 400.
pl-4 added `PLAN_INFEASIBLE` (the composer could not build one at all, as
distinct from building one with holes) and `REVISION_NOT_FOUND` (a stale link to
an addressable revision sends a user to the plan, not to the list). A failed
specialist is deliberately **not** an error: it is a `PlanGap` on the revision,
and the plan ships.

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
