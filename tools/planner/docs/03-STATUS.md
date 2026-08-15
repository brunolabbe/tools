# Status — planner

Where the planner stands. Phases live in [02-ROADMAP.md](./02-ROADMAP.md); what
each piece of work did lives in its ticket under [work/](./work/).

**Last updated:** 2026-08-15 · **Phase 0 (scaffold) ✅ · Phase 1 is built: the
`TripBrief`, the question tree, and the persistence and wizard over them. The
tool now produces a brief without a model being involved anywhere**

---

## Where things stand

| Phase                            | State         | Evidence                                                                                                                                                                                                         |
| -------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Scaffold               | ✅ complete   | `0f8583e`                                                                                                                                                                                                        |
| Phase 1 — The intake             | ✅ complete   | [pl-3](./work/pl-3-trip-brief-contract.md), [pl-6](./work/pl-6-question-tree-and-engine.md) and [pl-7](./work/pl-7-intake-persistence-and-wizard.md) — the brief, the tree, and an intake that survives a reload |
| Phase 2 — The first plan         | not started   | [pl-4](./work/pl-4-plan-document-contract.md), [pl-5](./work/pl-5-orchestrator-and-fan-out.md)                                                                                                                   |
| Phases 3–4 — Grounding, revision | designed only | no tickets yet, on purpose                                                                                                                                                                                       |

**The tool is not a chat, as of 2026-08-14.** It was scaffolded as one. The
intake now asks predetermined questions from an authored, versioned tree, and no
model participates in it — a model is involved later, in the fan-out. The
reasoning, including what the decision costs, is an amendment to
[00-ANALYSIS.md §3](./00-ANALYSIS.md), which had argued the opposite; the
argument was kept and overridden rather than rewritten.
[pl-1](./work/pl-1-conversation-loop.md) was dropped without being started.

**212 unit tests pass across 19 files, plus 2 e2e specs.** `npm run check` is
green. The repo-wide CI runs the unit suite on every push, and
`.github/workflows/planner.yml` now carries two gates — the e2e suite in a real
browser, and the image, which is built, started, and asked for both `/api/health`
and the page. Both are path-filtered, so downloader work does not pay for them.

What exists: the error taxonomy, the `TripBrief` and its schemas, the question
tree and the engine over it (`@planner/intake` — 36 questions, reachability,
invalidation, brief assembly, answer validation, all pure), the `ModelProvider`
seam with the scripted provider behind it, an API that opens SQLite and answers
`/api/health`, **an intake that persists — `intakes` and `answers` from migration
2, four routes over them, and a wizard that stops at the core questions and never
discards an answer without saying so** — and a container image the release
pipeline publishes.

**P1 is reached.** Someone can answer into a branch, be told the essentials are
done, go back and change an early answer, be shown exactly what that costs, and
reload to find the intake where they left it — with no model involved anywhere,
which is what makes the whole claim checkable without a key.

What does not exist: the plan document, the roster, a single specialist, the
`itinerary` package, grounding of any kind, and any hostname pointing at the
image.

What exists but is **wrong for the current design**: the contract's
`Conversation` / `Message` types, `MAX_MESSAGE_CHARS`, and
`CONVERSATION_NOT_FOUND`. Migration 3 dropped the tables under them in
[pl-7](./work/pl-7-intake-persistence-and-wizard.md); the types stayed, because
removing a code is a contract change that also has to fix
`registerNotFoundHandler`'s abuse of it for unknown URLs. That is
[pl-11](./work/pl-11-retire-the-conversation-vocabulary.md).

**The documentation leads the code by four phases**, which is the intended state
after a design pass and a liability if it lasts. Read
[00-ANALYSIS.md](./00-ANALYSIS.md) and
[01-ARCHITECTURE.md](./01-ARCHITECTURE.md) as _design_, not as description.

## Open tickets

| Ticket                                                      | Status    | Note                                                     |
| ----------------------------------------------------------- | --------- | -------------------------------------------------------- |
| [pl-1](./work/pl-1-conversation-loop.md)                    | dropped   | The chat premise. Read the log before rebuilding it      |
| [pl-2](./work/pl-2-container-image.md)                      | in-flight | Image and release component landed; no subdomain yet     |
| [pl-3](./work/pl-3-trip-brief-contract.md)                  | done      | The brief, its slots and `missingRequiredSlots` are in   |
| [pl-4](./work/pl-4-plan-document-contract.md)               | ready     | Contract-first; pl-5 cannot start without it             |
| [pl-5](./work/pl-5-orchestrator-and-fan-out.md)             | ready     | The roster is a table, not conditionals                  |
| [pl-6](./work/pl-6-question-tree-and-engine.md)             | done      | `@planner/intake`: the tree, reachability, invalidation  |
| [pl-7](./work/pl-7-intake-persistence-and-wizard.md)        | done      | Persistence, routes, and the wizard over them            |
| [pl-8](./work/pl-8-model-provider-seam.md)                  | done      | The seam is `ModelProvider`; the env is `MODEL_PROVIDER` |
| [pl-11](./work/pl-11-retire-the-conversation-vocabulary.md) | ready     | Delete what migration 3 outlived; `NOT_FOUND` to core    |
| [pl-12](./work/pl-12-render-the-wizard-in-tests.md)         | ready     | 1,100 lines of `.tsx` and no test renders any of it      |
| [pl-13](./work/pl-13-drive-the-intake-end-to-end.md)        | done      | The intake driven in a browser; the image serves the UI  |

**This table has not caught up with pl-4.** It is merged — the plan document
exists and took migration 2 — so "pl-4 · ready" is wrong, and pl-9 and pl-10 have
no rows at all. The "what does not exist" paragraph above says the same thing
twice over. Left for one pass rather than patched from three tickets that each
happened to notice.

## Known gaps and risks

**The image serves the UI as of
[pl-13](./work/pl-13-drive-the-intake-end-to-end.md).** `WEB_DIR` had been parsed
in `api/src/config.ts` and set by the `Dockerfile` since pl-2, and nothing read
it, so the container was an API with a bundle it never handed out — invisible
throughout, because `/api/health` answered perfectly and that was all anything
asked for. `api/src/routes/web.ts` now serves it same-origin, and the workflow
asks the running container for the page as well as for health. That closes
[pl-2](./work/pl-2-container-image.md)'s "serves the UI" acceptance, which was
the thing this had falsified.

**Nothing renders the wizard's components**, which is the half
[pl-12](./work/pl-12-render-the-wizard-in-tests.md) still owns. The browser is
now driven end to end by pl-13, so the two rules that live there — the discard
confirmation and the stop at the checkpoint — are asserted where they actually
run. But that is two specs over one path through the tree, deliberately: it
proves the seams, not the branches. Six trip shapes times three date modes is
component-test work, and until it exists a control that misbehaves off the road-
trip branch has nothing watching it.

**No owner model.** Every visitor shares one store and can read and edit
everyone's intakes, and the list route shows all of them. That is the honest gap
rather than one to paper over with an unguessable id — see the traps in
[pl-2](./work/pl-2-container-image.md).

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
a required slot no `core` question fills, fails `validateTree`. Both ends are
closed as of pl-7: the wizard renders `nextQuestion`'s `coreComplete` rather
than filtering the reachable set itself, and a route test asserts that the
checkpoint and `missingRequiredSlots` agree on the same intake.

**A model reply is untrusted input**, and from Phase 3 a grounded source is
hostile text. Validate against a schema from `@planner/contract` before acting;
`AGENT_MALFORMED_REPLY` is the code. Nothing consumes a reply yet, so nothing
enforces this yet either.

**The plan run has no budget because it has no run.** The design puts a cap on
specialists, grounding calls and tokens per run, enforced before the fan-out. It
is a cost control and a DoS control at once, and it lands with pl-5 or not at all.

**The transcript risk is gone**, not deferred — there is no transcript, so nothing
is re-sent turn over turn. The per-run budget replaces it as the cost control.
`MAX_MESSAGE_CHARS` is a constant with no job: migration 3 has landed and it
outlived the table, so it goes with the removal below rather than with a
migration.

**Error codes the design needs are still partly missing** — a plan whose
constraints cannot be satisfied, a revision not found; pl-4 proposes those rather
than adding them silently. The intake's half is in: `BRIEF_INCOMPLETE` for a
brief too thin to draft from (pl-3), `INVALID_ANSWER` for an answer that does not
fit its question (pl-6, and mapped to 400), `INTAKE_NOT_FOUND` for a missing
intake (pl-7, mapped to 404 — deliberately not `PLAN_NOT_FOUND`, which is a
different aggregate that fails at a different time), and a recorded decision that
the flexible-date cases need no code beyond `INVALID_DATES` — same cause, same
sentence, different `details`.

`TRIP_NOT_FOUND` is already gone: the vocabulary is settled (a trip is the
journey, a plan is the document) and the code is now `PLAN_NOT_FOUND`.
`CONVERSATION_NOT_FOUND` is next to go, and pl-7 deliberately did not take it:
removing a code is a contract change rather than an addition, and it has to fix
`registerNotFoundHandler`'s abuse of it for unknown URLs in the same move rather
than carry the bug across. It needs a ticket, along with `Conversation`,
`Message` and `MAX_MESSAGE_CHARS`.

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

npm run e2e:install            # once, for the browser
npm run e2e:planner            # the intake, in Chromium, against the built bundle
```

Ports are 8090/5183 rather than 8080/5173 so both tools can run at once. The e2e
suite takes 8098 and its own database under `e2e/.artifacts/`, so it does not
collide with either, and it starts the API itself — there is nothing to have
running first.
