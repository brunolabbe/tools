# Status — planner

Where the planner stands. Phases live in [02-ROADMAP.md](./02-ROADMAP.md); what
each piece of work did lives in its ticket under [work/](./work/).

**Last updated:** 2026-08-16 · **Phase 0 (scaffold) ✅ · Phase 1 ✅ — the
`TripBrief`, the question tree, and the persistence and wizard over them, driven
end to end in a browser. The tool produces a brief with no model involved
anywhere. Phase 2 has its contract, the composer that turns candidates into days,
and — as of pl-5 — the fan-out that produces them. The two halves meet in a test
and not yet over HTTP: there is no run, no SSE and no progress view**

---

## Where things stand

| Phase                            | State         | Evidence                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Scaffold               | ✅ complete   | `0f8583e`                                                                                                                                                                                                                                                                                                                                                       |
| Phase 1 — The intake             | ✅ complete   | [pl-3](./work/pl-3-trip-brief-contract.md), [pl-6](./work/pl-6-question-tree-and-engine.md) and [pl-7](./work/pl-7-intake-persistence-and-wizard.md) — the brief, the tree, and an intake that survives a reload                                                                                                                                                |
| Phase 2 — The first plan         | in flight     | [pl-4](./work/pl-4-plan-document-contract.md) and [pl-9](./work/pl-9-composer-and-critic.md) done — the plan document, and a composer that fills it from a candidate set; [pl-5](./work/pl-5-orchestrator-and-fan-out.md) has the roster, the specialists and the fan-out and stops before the run; [pl-10](./work/pl-10-plan-view-and-provenance.md) unblocked |
| Phases 3–4 — Grounding, revision | designed only | no tickets yet, on purpose                                                                                                                                                                                                                                                                                                                                      |

**The tool is not a chat, as of 2026-08-14.** It was scaffolded as one. The
intake now asks predetermined questions from an authored, versioned tree, and no
model participates in it — a model is involved later, in the fan-out. The
reasoning, including what the decision costs, is an amendment to
[00-ANALYSIS.md §3](./00-ANALYSIS.md), which had argued the opposite; the
argument was kept and overridden rather than rewritten.
[pl-1](./work/pl-1-conversation-loop.md) was dropped without being started.

**420 unit tests pass across 31 files, plus 2 e2e specs.** `npm run check` is
green. The repo-wide CI runs the unit suite on every push, and
`.github/workflows/planner.yml` now carries two gates — the e2e suite in a real
browser, and the image, which is built, started, and asked for both `/api/health`
and the page. Both are path-filtered, so downloader work does not pay for them.

What exists: the error taxonomy, the `TripBrief` and its schemas, the question
tree and the engine over it (`@planner/intake` — version 2, 37 questions, reachability,
invalidation, brief assembly, answer validation, all pure), the plan document —
`Candidate`, `Provenance`, `Plan`, `PlanRevision`, `PlanDay`, `PlanItem`,
`PlanGap`, with migration 2 behind it and a checked-in candidate set per trip
shape — the `ModelProvider` seam with the scripted provider behind it, **the
fan-out: `@planner/agent`'s roster table, seven specialists behind one interface,
a per-run budget that degrades the roster before anything is sent, and
`runFanOut` over them** — an API
that opens SQLite, answers `/api/health` and serves the UI same-origin, **an
intake that persists — `intakes` and `answers` from migration 3, four routes over
them, and a wizard that stops at the core questions and never discards an answer
without saying so** — a container image the release pipeline publishes, and **the
composer: `@planner/itinerary`, which turns a brief and a candidate set into a
plan revision** (season filter, day packer, budget arithmetic over bands,
constraint check, bounded critic, all pure).

**P1 is reached.** Someone can answer into a branch, be told the essentials are
done, go back and change an early answer, be shown exactly what that costs, and
reload to find the intake where they left it — with no model involved anywhere,
which is what makes the whole claim checkable without a key. Two Playwright specs
assert that whole paragraph against the built bundle.

What does not exist: **the run** — no `plan_runs` table, no HTTP route that
starts one, no SSE, no progress in the UI, and nothing persisting a plan — plus
grounding of any kind and any hostname pointing at the image. The two halves of
Phase 2 now meet in a unit test rather than over a wire: `agent/test/placeable.test.ts`
runs the real fan-out for each of the six checked-in briefs and composes its
output, and pl-10 renders a result nothing yet stores.

**Nothing in the contract describes a conversation any more.**
[pl-11](./work/pl-11-retire-the-conversation-vocabulary.md) deleted the
`Conversation` / `Message` types, their three zod schemas, `MAX_MESSAGE_CHARS`
and `CONVERSATION_NOT_FOUND` — the vocabulary that outlived the tables migration
3 dropped. An unknown URL now answers `NOT_FOUND` from `@webtools/core`, which is
about a route rather than a document. Migration 1 still creates the tables and
migration 3 still drops them: applied migrations are history and are not edited.

**The documentation leads the code by two phases**, down from four: Phase 1 is
built, and Phase 2 has its contract and its composer. That gap is the intended state after a design
pass and a liability if it lasts, so read
[00-ANALYSIS.md](./00-ANALYSIS.md) and
[01-ARCHITECTURE.md](./01-ARCHITECTURE.md) as _design_ rather than as
description — everything they say about specialists, grounding and revision is
still unwritten.

## Open tickets

| Ticket                                                      | Status    | Note                                                                  |
| ----------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| [pl-1](./work/pl-1-conversation-loop.md)                    | dropped   | The chat premise. Read the log before rebuilding it                   |
| [pl-2](./work/pl-2-container-image.md)                      | in-flight | Image and release component landed; no subdomain yet                  |
| [pl-3](./work/pl-3-trip-brief-contract.md)                  | done      | The brief, its slots and `missingRequiredSlots` are in                |
| [pl-4](./work/pl-4-plan-document-contract.md)               | done      | The plan document, migration 2, and pl-5's fixtures                   |
| [pl-5](./work/pl-5-orchestrator-and-fan-out.md)             | in-flight | Roster, specialists and fan-out in; the run needs a contract decision |
| [pl-6](./work/pl-6-question-tree-and-engine.md)             | done      | `@planner/intake`: the tree, reachability, invalidation               |
| [pl-7](./work/pl-7-intake-persistence-and-wizard.md)        | done      | Persistence, routes, and the wizard over them                         |
| [pl-8](./work/pl-8-model-provider-seam.md)                  | done      | The seam is `ModelProvider`; the env is `MODEL_PROVIDER`              |
| [pl-9](./work/pl-9-composer-and-critic.md)                  | done      | `@planner/itinerary`: season, packing, budget, critic                 |
| [pl-10](./work/pl-10-plan-view-and-provenance.md)           | ready     | Renders the plan, its gaps and what was verified                      |
| [pl-11](./work/pl-11-retire-the-conversation-vocabulary.md) | done      | The vocabulary is gone; `NOT_FOUND` lifted to core                    |
| [pl-12](./work/pl-12-render-the-wizard-in-tests.md)         | ready     | 1,100 lines of `.tsx` and no test renders any of it                   |
| [pl-13](./work/pl-13-drive-the-intake-end-to-end.md)        | done      | The intake driven in a browser; the image serves the UI               |
| [pl-14](./work/pl-14-tree-content-review.md)                | done      | The tree reviewed as content; tree `version` is now 2                 |
| [pl-15](./work/pl-15-candidate-legs.md)                     | done      | A candidate is `at` a place or runs `between` two                     |
| [pl-16](./work/pl-16-the-plan-run.md)                       | ready     | The run as a job; step 1 is what the contract carries                 |

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

**The plan's constraints are enforced, and the plan says which ones were not.**
`@planner/itinerary` filters on season before packing, bounds a day by the
party's own effort and drive answers, sums cost bands without ever collapsing
one to a figure, drops anything past its booking deadline, and refuses to ship a
plan that violates a hard constraint — `PLAN_INFEASIBLE`, kept carefully
distinct from a plan with a `PlanGap`, which ships. What it _cannot_ evaluate
comes back as `UNCHECKED_CONSTRAINTS` on the result rather than as silence.

**Phase 2 does not pack under travel time, and that is now decided rather than
open.** `Place.coordinates` is null until grounding and §5 puts distances in
Phase 3, so a leg has no measured length. (Until
[pl-15](./work/pl-15-candidate-legs.md) it had no ends either; that half is
closed and this one is not.) Decided 2026-08-16: **pack without it
and name the gap**, which narrowed the P2 milestone's wording — see the
roadmap. Every plan carries `travel-time` on its unchecked list, without
exception, and a test per trip shape says so. Daily distance (backcountry) and
machine range (motorised) are unchecked for the same reason.

**The unchecked list does not survive a reload.** Every `PlanGapReason` is about
a _specialist_ — failed, dropped, not applicable, found nothing — and "we could
not check travel time" is not: route-and-logistics ran perfectly and what is
missing is a distance nobody has. So the list lives on `ComposeResult`, and a
plan read back out of the database has lost it. Two ways to close that — persist
it behind a new `PlanGapReason` member that is about a constraint, or re-derive
it on read, which genuinely works because the composer is pure — and neither has
been chosen. It is [pl-10](./work/pl-10-plan-view-and-provenance.md)'s decision
and is laid out in that ticket; the argument for why `PlanGap` cannot carry it as
it stands is in [pl-9](./work/pl-9-composer-and-critic.md)'s log.

**Deal-breakers are not machine-checkable, and §7 assumed they were.**
`dealBreakers` is free text, so no arithmetic decides whether a candidate
violates one, and a keyword match would fail both ways while looking like a
check. The composer states it as unchecked and the specialists that read the
brief carry it. Making it real means a structured constraint on the brief, not a
cleverer string search over the free-text one. Recorded as an amendment to
[00-ANALYSIS.md §7](./00-ANALYSIS.md), which had claimed otherwise — the second
section of the analysis to be overridden by building the thing it describes.

**A candidate can now say where it goes, not only where it is.**
[pl-15](./work/pl-15-candidate-legs.md) replaced `Candidate.place` with
`Candidate.location`, a union of `at` a place and `between` two, and moved the
six checked-in sets onto it. Nothing consumes the endpoints yet — `travel-time`
is still unchecked on every plan — so this is a claim about what is
representable and not about what is true. It was taken before pl-5 because a
route specialist that puts its endpoints in prose is the shape the fixtures had,
and fixing it afterwards would cost a re-run of every stored candidate rather
than six files. Three things it unblocks and none of which is built: travel
time between consecutive items, a detour weighed off a leg, and conditions along
one corridor rather than another.

Two findings from it are worth carrying: **the field had no reader anywhere in
the tool** before this — the packer buckets by `specialist`, so a candidate's
location was written and never consulted, which is why a breaking union was
cheap — and **the fixtures already carry coordinates on eleven places**, four of
them on route candidates. "Coordinates are null until Phase 3" is true of what
the tool produces, not of what pl-4 checked in.

**Something produces candidates now, and they are placeable.**
[pl-5](./work/pl-5-orchestrator-and-fan-out.md) closed the half of this that was
about the fan-out: a roster table, seven specialists behind one interface, and
`runFanOut` over them, answered offline by 48 checked-in scripted candidates. The
finding that came with it is closed too — **an appetite answer bounds what a
specialist may propose**, so a leg longer than the day allows is split rather
than written, and the fan-out refuses one that is not. `agent/test/placeable.test.ts`
composes the real output for all six briefs and asserts that every rostered
schedulable specialist gets at least one candidate onto a day; it also asserts
that `CANDIDATE_LIMIT_OF` and `@planner/itinerary`'s `BUCKET_OF` still agree,
which is the one thing `agent` had to restate to avoid depending on `itinerary`.

**What still produces nothing is the run.** Nothing starts a fan-out over HTTP,
nothing persists its output, and no UI shows it happening. That is
[pl-16](./work/pl-16-the-plan-run.md), split out of pl-5 because it starts with a
decision about what `@planner/contract` carries for a run rather than with code.

**`REQUIRED_SHAPE_SLOTS` and the tree's `core` marking now agree, and a test
says so in both directions** — a `core` question whose slot is not required, or
a required slot no `core` question fills, fails `validateTree`. Both ends are
closed as of pl-7: the wizard renders `nextQuestion`'s `coreComplete` rather
than filtering the reachable set itself, and a route test asserts that the
checkpoint and `missingRequiredSlots` agree on the same intake.

**A model reply is untrusted input**, and from Phase 3 a grounded source is
hostile text. As of pl-5 this is enforced rather than intended: `askSpecialist`
validates every reply against `candidateSchema.omit({id, specialist})`, re-asks
once with the parse failure fed back, and raises `AGENT_MALFORMED_REPLY` past the
attempt budget. `id` and `specialist` are omitted deliberately — a model that
named its own would be able to lie about who proposed something, which is the one
field `Candidate` carries so that question stays answerable. A specialist still
has no credentials and no tools, so there is nothing yet for a hostile page to
reach; that is Phase 3's to keep true.

**The budget exists; the run does not.** `RunBudget` is a required argument to
`runFanOut` and `applyBudget` degrades the roster from the back of
`SPECIALIST_ORDER` before anything is sent, recording each cut as a
`specialist-dropped-for-budget` gap. What is missing is the layer that would give
it a number from the environment and a job to bound: no `plan_runs` table, no
queue, no `MAX_CONCURRENT_RUNS`, no rate limit on run creation. Until that
exists the DoS half of the control is not in force, because there is no endpoint
to spend anything through.

**At `MAX_SPECIALISTS = 5` the budget specialist is always the one dropped**, on
each of the three shapes that roster six. That is the cap working as designed and
is a gap on those plans rather than a silence — but the default was chosen before
there was a roster to apply it to, and the number is worth reviewing as content
the way `limits.ts` is.

**The transcript risk is gone**, not deferred — there is no transcript, so nothing
is re-sent turn over turn. The per-run budget replaces it as the cost control, and
`MAX_MESSAGE_CHARS` — the ceiling that bounded one turn of the thing that no
longer exists — went with pl-11.

**The error codes the design needs are all in.** The intake's half: `BRIEF_INCOMPLETE`
for a brief too thin to draft from (pl-3), `INVALID_ANSWER` for an answer that
does not fit its question (pl-6, mapped to 400), `INTAKE_NOT_FOUND` for a missing
intake (pl-7, mapped to 404 — deliberately not `PLAN_NOT_FOUND`, which is a
different aggregate that fails at a different time), and a recorded decision that
the flexible-date cases need no code beyond `INVALID_DATES` — same cause, same
sentence, different `details`. The plan's half arrived with pl-4:
`PLAN_INFEASIBLE` (the composer could not build one at all, as distinct from
building one with holes) and `REVISION_NOT_FOUND` (a stale link to an addressable
revision sends a user to the plan, not to the list). A failed specialist is
deliberately **not** an error: it is a `PlanGap` on the revision, and the plan
ships.

`TRIP_NOT_FOUND` and `CONVERSATION_NOT_FOUND` are both gone. The first because
the vocabulary is settled (a trip is the journey, a plan is the document) and the
code is now `PLAN_NOT_FOUND`; the second with
[pl-11](./work/pl-11-retire-the-conversation-vocabulary.md), which could only
remove it by giving `registerNotFoundHandler` something true to raise instead.
That is `NOT_FOUND`, and it is **core's**: this tool and the downloader had each
re-worded their nearest domain code to describe a missing route, which is the
second consumer the lifting rule asks for. The downloader's call site is still
wrong and is [dl-17](../../downloader/docs/work/dl-17-name-an-unknown-endpoint.md),
not this tool's to fix.

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
